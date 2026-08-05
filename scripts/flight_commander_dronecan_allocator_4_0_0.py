#!/usr/bin/env python3
"""Install a non-redundant DroneCAN dynamic node-ID allocator.

Holybro/AP_Periph GNSS modules commonly start with CAN_NODE=0 and request a
runtime node ID. Flight Commander 4.0.0 must allocate those temporary IDs before
its moving-base/moving-rover manager can discover, identify, and persistently
configure the two modules.
"""

from __future__ import annotations

from pathlib import Path


ALLOCATOR_H = r'''#pragma once

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)

#include <stdbool.h>
#include <stdint.h>

#include "drivers/dronecan/libcanard/canard.h"

void dronecanAllocatorInit(void);
bool dronecanAllocatorShouldAccept(uint8_t transferType, uint16_t dataTypeID, uint64_t *signature);
void dronecanAllocatorHandleTransfer(const CanardRxTransfer *transfer);
uint8_t dronecanAllocatorAllocationCount(void);

#endif
'''


ALLOCATOR_C = r'''/*
 * Flight Commander 4.0 non-redundant DroneCAN dynamic node-ID allocator.
 *
 * Anonymous allocatees send their 128-bit hardware unique ID in up to three
 * single-frame requests. The allocator confirms each accumulated prefix and
 * assigns a deterministic free node ID when all 16 bytes have arrived. The
 * moving-baseline setup manager subsequently writes that assigned ID into the
 * AP_Periph CAN_NODE parameter, making the two GNSS nodes static after setup.
 */

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)

#include <string.h>

#define CANARD_DSDLC_INTERNAL

#include "drivers/dronecan/dronecan.h"
#include "drivers/dronecan/dronecan_allocator.h"
#include "drivers/time.h"

#include <dronecan_msgs.h>

#define DRONECAN_ALLOCATOR_MAX_ENTRIES 16U
#define DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH 16U
#define DRONECAN_ALLOCATOR_TRANSACTION_TIMEOUT_MS 3000U
#define DRONECAN_ALLOCATOR_HIGHEST_ASSIGNABLE_NODE_ID 125U
#define DRONECAN_ALLOCATOR_LOWEST_ASSIGNABLE_NODE_ID 1U

typedef struct dronecanAllocationEntry_s {
    bool used;
    uint8_t nodeID;
    uint8_t uniqueID[DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH];
} dronecanAllocationEntry_t;

static dronecanAllocationEntry_t allocationTable[DRONECAN_ALLOCATOR_MAX_ENTRIES];
static uint8_t pendingUniqueID[DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH];
static uint8_t pendingLength;
static uint8_t pendingPreferredNodeID;
static uint32_t pendingUpdatedMs;
static uint8_t responseTransferID;

static uint16_t encodeAllocation(
    struct uavcan_protocol_dynamic_node_id_Allocation *message,
    uint8_t *buffer)
{
    uint32_t bitOffset = 0;
    memset(buffer, 0, UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_MAX_SIZE);
    _uavcan_protocol_dynamic_node_id_Allocation_encode(buffer, &bitOffset, message, true);
    return (bitOffset + 7U) / 8U;
}

static bool decodeAllocation(
    const CanardRxTransfer *transfer,
    struct uavcan_protocol_dynamic_node_id_Allocation *message)
{
    uint32_t bitOffset = 0;
    if (_uavcan_protocol_dynamic_node_id_Allocation_decode(transfer, &bitOffset, message, true)) {
        return false;
    }
    return ((bitOffset + 7U) / 8U) == transfer->payload_len;
}

static bool configuredNodeID(uint8_t nodeID)
{
    const dronecanConfig_t *config = dronecanConfig();
    return nodeID == config->nodeID ||
        nodeID == config->gpsNodeID ||
        nodeID == config->batteryNodeID ||
        nodeID == config->magNodeID ||
        nodeID == config->movingBaseNodeID ||
        nodeID == config->movingRoverNodeID;
}

static bool allocationTableContainsNodeID(uint8_t nodeID)
{
    for (unsigned index = 0; index < DRONECAN_ALLOCATOR_MAX_ENTRIES; index++) {
        if (allocationTable[index].used && allocationTable[index].nodeID == nodeID) {
            return true;
        }
    }
    return false;
}

static bool nodeIDAvailable(uint8_t nodeID)
{
    if (nodeID < DRONECAN_ALLOCATOR_LOWEST_ASSIGNABLE_NODE_ID ||
        nodeID > DRONECAN_ALLOCATOR_HIGHEST_ASSIGNABLE_NODE_ID ||
        configuredNodeID(nodeID) || allocationTableContainsNodeID(nodeID)) {
        return false;
    }
    return dronecanGetNodeById(nodeID) == NULL;
}

static uint8_t findFreeNodeID(uint8_t preferred)
{
    if (preferred >= DRONECAN_ALLOCATOR_LOWEST_ASSIGNABLE_NODE_ID &&
        preferred <= DRONECAN_ALLOCATOR_HIGHEST_ASSIGNABLE_NODE_ID) {
        for (uint16_t candidate = preferred; candidate <= DRONECAN_ALLOCATOR_HIGHEST_ASSIGNABLE_NODE_ID; candidate++) {
            if (nodeIDAvailable(candidate)) {
                return candidate;
            }
        }
        for (int16_t candidate = (int16_t)preferred - 1; candidate >= DRONECAN_ALLOCATOR_LOWEST_ASSIGNABLE_NODE_ID; candidate--) {
            if (nodeIDAvailable(candidate)) {
                return candidate;
            }
        }
        return 0;
    }

    for (int16_t candidate = DRONECAN_ALLOCATOR_HIGHEST_ASSIGNABLE_NODE_ID;
        candidate >= DRONECAN_ALLOCATOR_LOWEST_ASSIGNABLE_NODE_ID; candidate--) {
        if (nodeIDAvailable(candidate)) {
            return candidate;
        }
    }
    return 0;
}

static dronecanAllocationEntry_t *findAllocation(const uint8_t uniqueID[DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH])
{
    for (unsigned index = 0; index < DRONECAN_ALLOCATOR_MAX_ENTRIES; index++) {
        if (allocationTable[index].used &&
            memcmp(allocationTable[index].uniqueID, uniqueID, DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH) == 0) {
            return &allocationTable[index];
        }
    }
    return NULL;
}

static dronecanAllocationEntry_t *createAllocation(
    const uint8_t uniqueID[DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH],
    uint8_t preferred)
{
    dronecanAllocationEntry_t *entry = findAllocation(uniqueID);
    if (entry) {
        return entry;
    }

    uint8_t nodeID = findFreeNodeID(preferred);
    if (!nodeID) {
        return NULL;
    }
    for (unsigned index = 0; index < DRONECAN_ALLOCATOR_MAX_ENTRIES; index++) {
        if (!allocationTable[index].used) {
            allocationTable[index].used = true;
            allocationTable[index].nodeID = nodeID;
            memcpy(allocationTable[index].uniqueID, uniqueID, DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH);
            return &allocationTable[index];
        }
    }
    return NULL;
}

static void sendAllocationResponse(uint8_t nodeID, const uint8_t *uniqueID, uint8_t uniqueIDLength)
{
    struct uavcan_protocol_dynamic_node_id_Allocation response;
    memset(&response, 0, sizeof(response));
    response.node_id = nodeID;
    response.first_part_of_unique_id = false;
    response.unique_id.len = uniqueIDLength;
    memcpy(response.unique_id.data, uniqueID, uniqueIDLength);

    uint8_t buffer[UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_MAX_SIZE];
    const uint16_t payloadLength = encodeAllocation(&response, buffer);
    dronecanBroadcastTransfer(
        UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_SIGNATURE,
        UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID,
        &responseTransferID,
        CANARD_TRANSFER_PRIORITY_LOW,
        buffer,
        payloadLength);
}

void dronecanAllocatorInit(void)
{
    memset(allocationTable, 0, sizeof(allocationTable));
    memset(pendingUniqueID, 0, sizeof(pendingUniqueID));
    pendingLength = 0;
    pendingPreferredNodeID = 0;
    pendingUpdatedMs = 0;
    responseTransferID = 0;
}

bool dronecanAllocatorShouldAccept(uint8_t transferType, uint16_t dataTypeID, uint64_t *signature)
{
    if (transferType != CanardTransferTypeBroadcast ||
        dataTypeID != UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID) {
        return false;
    }
    *signature = UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_SIGNATURE;
    return true;
}

void dronecanAllocatorHandleTransfer(const CanardRxTransfer *transfer)
{
    // Allocator responses and confirmations are regular non-anonymous broadcasts;
    // only anonymous source node 0 carries an allocation request.
    if (!transfer || transfer->source_node_id != 0) {
        return;
    }

    struct uavcan_protocol_dynamic_node_id_Allocation request;
    memset(&request, 0, sizeof(request));
    if (!decodeAllocation(transfer, &request) || request.unique_id.len == 0 ||
        request.unique_id.len > DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH) {
        return;
    }

    const uint32_t now = millis();
    if (pendingUpdatedMs && now - pendingUpdatedMs > DRONECAN_ALLOCATOR_TRANSACTION_TIMEOUT_MS) {
        pendingLength = 0;
    }

    if (request.first_part_of_unique_id) {
        pendingLength = 0;
        pendingPreferredNodeID = request.node_id;
        memset(pendingUniqueID, 0, sizeof(pendingUniqueID));
    } else if (pendingLength == 0) {
        return;
    }

    if ((unsigned)pendingLength + request.unique_id.len > DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH) {
        pendingLength = 0;
        return;
    }

    memcpy(&pendingUniqueID[pendingLength], request.unique_id.data, request.unique_id.len);
    pendingLength += request.unique_id.len;
    pendingUpdatedMs = now;

    if (pendingLength < DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH) {
        sendAllocationResponse(0, pendingUniqueID, pendingLength);
        return;
    }

    dronecanAllocationEntry_t *entry = createAllocation(pendingUniqueID, pendingPreferredNodeID);
    if (entry) {
        sendAllocationResponse(entry->nodeID, pendingUniqueID, DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH);
    }
    pendingLength = 0;
}

uint8_t dronecanAllocatorAllocationCount(void)
{
    uint8_t count = 0;
    for (unsigned index = 0; index < DRONECAN_ALLOCATOR_MAX_ENTRIES; index++) {
        if (allocationTable[index].used) {
            count++;
        }
    }
    return count;
}

#endif
'''


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f"{path}: expected one allocator integration anchor, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def apply_dynamic_node_allocator(root: Path) -> None:
    root = Path(root)
    allocator_h = root / "src/main/drivers/dronecan/dronecan_allocator.h"
    allocator_c = root / "src/main/drivers/dronecan/dronecan_allocator.c"
    allocator_h.write_text(ALLOCATOR_H, encoding="utf-8")
    allocator_c.write_text(ALLOCATOR_C, encoding="utf-8")

    header = root / "src/main/drivers/dronecan/dronecan.h"
    replace_once(
        header,
        '''bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength);
''',
        '''bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength);
bool dronecanBroadcastTransfer(uint64_t signature, uint16_t dataTypeID,
    uint8_t *transferID, uint8_t priority, const void *payload, uint16_t payloadLength);
''',
    )

    source = root / "src/main/drivers/dronecan/dronecan.c"
    replace_once(
        source,
        '#include "drivers/dronecan/dronecan.h"\n',
        '#include "drivers/dronecan/dronecan.h"\n#include "drivers/dronecan/dronecan_allocator.h"\n',
    )
    replace_once(
        source,
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transferType == CanardTransferTypeResponse && dronecanPairShouldAcceptResponse(dataTypeID, signature)) {
        return true;
    }
#endif
    if (transferType != CanardTransferTypeBroadcast) {
''',
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transferType == CanardTransferTypeResponse && dronecanPairShouldAcceptResponse(dataTypeID, signature)) {
        return true;
    }
#endif
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)
    if (dronecanAllocatorShouldAccept(transferType, dataTypeID, signature)) {
        return true;
    }
#endif
    if (transferType != CanardTransferTypeBroadcast) {
''',
    )
    replace_once(
        source,
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transfer->transfer_type == CanardTransferTypeResponse && dronecanPairHandleResponse(transfer)) {
        return;
    }
#endif
    if (transfer->transfer_type != CanardTransferTypeBroadcast) {
''',
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transfer->transfer_type == CanardTransferTypeResponse && dronecanPairHandleResponse(transfer)) {
        return;
    }
#endif
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)
    if (transfer->transfer_type == CanardTransferTypeBroadcast &&
        transfer->data_type_id == UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID) {
        dronecanAllocatorHandleTransfer(transfer);
        return;
    }
#endif
    if (transfer->transfer_type != CanardTransferTypeBroadcast) {
''',
    )
    replace_once(
        source,
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairInit();
#endif
    if (canardSTM32CAN1_Init(activeBitrate) != CANARD_OK) {
''',
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairInit();
#endif
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)
    dronecanAllocatorInit();
#endif
    if (canardSTM32CAN1_Init(activeBitrate) != CANARD_OK) {
''',
    )

    text = source.read_text(encoding="utf-8")
    generic_broadcast = r'''

bool dronecanBroadcastTransfer(uint64_t signature, uint16_t dataTypeID,
    uint8_t *transferID, uint8_t priority, const void *payload, uint16_t payloadLength)
{
    if (!initialized || !transferID) {
        return false;
    }
    return canardBroadcast(&canard, signature, dataTypeID, transferID, priority,
        payload, payloadLength) >= 0;
}
'''
    if "bool dronecanBroadcastTransfer(" not in text:
        marker = "\n#endif\n"
        offset = text.rfind(marker)
        if offset < 0:
            raise RuntimeError("dronecan.c has no final preprocessor terminator")
        source.write_text(text[:offset] + generic_broadcast + text[offset:], encoding="utf-8")

    overlay = root / "cmake/flight-commander-micoair743.cmake"
    text = overlay.read_text(encoding="utf-8")
    if "dronecan_allocator.c" not in text:
        text += r'''

target_sources(MICOAIR743.elf PRIVATE
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_allocator.c
)

target_compile_definitions(MICOAIR743.elf PRIVATE
    USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR
)
'''
        overlay.write_text(text, encoding="utf-8")

    guide = root / "flight-commander/DRONECAN_MOVING_BASELINE.md"
    guide.write_text(
        "# DroneCAN moving-baseline provisioning\n\n"
        "Flight Commander 4.0.0 includes a non-redundant dynamic node-ID allocator. "
        "AP_Periph modules with `CAN_NODE=0` receive temporary unique IDs automatically. "
        "The moving-baseline manager then identifies the selected modules, writes those IDs "
        "back to `CAN_NODE`, assigns `GPS_TYPE=17` and `GPS_TYPE=18`, saves, restarts, and "
        "verifies the pair.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    arguments = parser.parse_args()
    apply_dynamic_node_allocator(arguments.root)
