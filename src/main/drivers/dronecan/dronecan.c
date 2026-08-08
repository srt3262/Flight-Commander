#include "platform.h"

#if defined(USE_DRONECAN)

#include <inttypes.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "build/flight_commander.h"
#include "build/version.h"
#include "common/log.h"
#include "common/maths.h"
#include "common/time.h"
#include "common/utils.h"
#include "config/parameter_group.h"
#include "config/parameter_group_ids.h"
#include "drivers/time.h"
#include "fc/runtime_config.h"
#include "flight_commander/heading_fusion.h"
#include "flight_commander/rtcm.h"
#include "io/gps.h"
#include "io/gps_dronecan.h"
#include "sensors/battery_sensor_dronecan.h"
#include "sensors/diagnostics.h"

#include "drivers/dronecan/dronecan.h"
#include "drivers/dronecan/dronecan_allocator.h"
#include "drivers/dronecan/dronecan_pair.h"
#include "drivers/dronecan/libcanard/canard.h"
#include "drivers/dronecan/libcanard/canard_stm32_driver.h"

#include <dronecan_msgs.h>

#define DRONECAN_NODE_TIMEOUT_MS 5000U
#define DRONECAN_MEMORY_POOL_SIZE 4096U

PG_REGISTER_WITH_RESET_TEMPLATE(dronecanConfig_t, dronecanConfig, PG_DRONECAN_CONFIG, 2);

PG_RESET_TEMPLATE(dronecanConfig_t, dronecanConfig,
    .nodeID = 10,
    .bitRateKbps = DRONECAN_BITRATE_1000KBPS,
    .gpsNodeID = DRONECAN_NODE_ID_DISABLED,
    .batteryNodeID = DRONECAN_NODE_ID_DISABLED,
    .primaryGpsSource = GPS_PRIMARY_SOURCE_UART,
    .magNodeID = DRONECAN_NODE_ID_DISABLED,
    .movingBaseNodeID = DRONECAN_NODE_ID_DISABLED,
    .movingRoverNodeID = DRONECAN_NODE_ID_DISABLED,
    .pairFlags = DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY,
    .baseTermination = DRONECAN_TERMINATION_UNCHANGED,
    .roverTermination = DRONECAN_TERMINATION_UNCHANGED
);

static CanardInstance canard;
static uint8_t memoryPool[DRONECAN_MEMORY_POOL_SIZE];
static struct uavcan_protocol_NodeStatus localNodeStatus;
static dronecanState_e state = STATE_DRONECAN_INIT;
static dronecanNodeInfo_t nodeTable[DRONECAN_MAX_NODES];
static uint8_t activeNodeCount;
static uint32_t activeBitrate;
static bool initialized;

static dronecanNodeInfo_t *findNode(uint8_t nodeID, bool create)
{
    for (unsigned index = 0; index < activeNodeCount; index++) {
        if (nodeTable[index].nodeID == nodeID) {
            return &nodeTable[index];
        }
    }
    if (!create || !nodeID || nodeID > 127 || activeNodeCount >= DRONECAN_MAX_NODES) {
        return NULL;
    }
    dronecanNodeInfo_t *node = &nodeTable[activeNodeCount++];
    memset(node, 0, sizeof(*node));
    node->nodeID = nodeID;
    node->last_seen_ms = millis();
    return node;
}

static dronecanNodeInfo_t *touchNode(uint8_t nodeID)
{
    dronecanNodeInfo_t *node = findNode(nodeID, true);
    if (node) {
        node->last_seen_ms = millis();
    }
    return node;
}

void dronecanMarkNodeCapability(uint8_t nodeID, uint16_t capability)
{
    dronecanNodeInfo_t *node = touchNode(nodeID);
    if (node) {
        node->capabilities |= capability;
    }
}

static void handleNodeStatus(const CanardRxTransfer *transfer)
{
    struct uavcan_protocol_NodeStatus message;
    if (uavcan_protocol_NodeStatus_decode(transfer, &message)) {
        return;
    }
    dronecanNodeInfo_t *node = touchNode(transfer->source_node_id);
    if (!node) {
        return;
    }
    node->health = message.health;
    node->mode = message.mode;
    node->uptime_sec = message.uptime_sec;
    node->vendor_status_code = message.vendor_specific_status_code;
}

static void handleGnssAuxiliary(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_gnss_Auxiliary message;
    if (!uavcan_equipment_gnss_Auxiliary_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_GNSS);
        dronecanGPSReceiveGNSSAuxiliary(transfer->source_node_id, &message);
    }
}

static void handleGnssFix(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_gnss_Fix message;
    if (!uavcan_equipment_gnss_Fix_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_GNSS);
        dronecanGPSReceiveGNSSFix(transfer->source_node_id, &message);
    }
}

static void handleGnssFix2(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_gnss_Fix2 message;
    if (!uavcan_equipment_gnss_Fix2_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_GNSS);
        dronecanGPSReceiveGNSSFix2(transfer->source_node_id, &message);
    }
}

static void handleRtcmStream(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_gnss_RTCMStream message;
    if (uavcan_equipment_gnss_RTCMStream_decode(transfer, &message)) {
        return;
    }
    dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_RTCM);
    if (message.protocol_id == UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_PROTOCOL_ID_RTCM3) {
        gpsQueueRtcmData(message.data.data, message.data.len);
    }
}

static void handleBatteryInfo(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_power_BatteryInfo message;
    if (!uavcan_equipment_power_BatteryInfo_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_BATTERY);
        dronecanBatterySensorReceiveInfo(transfer->source_node_id, &message);
    }
}

static void handleMagneticField(const CanardRxTransfer *transfer)
{
    struct uavcan_equipment_ahrs_MagneticFieldStrength2 message;
    if (!uavcan_equipment_ahrs_MagneticFieldStrength2_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_MAG);
#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)
        flightCommanderHeadingReceiveDronecanMag(transfer->source_node_id, &message);
#endif
    }
}

static void handleHeading(const CanardRxTransfer *transfer)
{
    struct ardupilot_gnss_Heading message;
    if (!ardupilot_gnss_Heading_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING);
#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)
        flightCommanderHeadingReceiveDronecanHeading(transfer->source_node_id, &message);
#endif
    }
}

static void handleRelPosHeading(const CanardRxTransfer *transfer)
{
    struct ardupilot_gnss_RelPosHeading message;
    if (!ardupilot_gnss_RelPosHeading_decode(transfer, &message)) {
        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING);
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
        dronecanPairRecordRelPosHeading(transfer->source_node_id, &message);
#endif
#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)
        flightCommanderHeadingReceiveDronecanRelPosHeading(transfer->source_node_id, &message);
#endif
    }
}

static void handleGetNodeInfo(CanardInstance *instance, CanardRxTransfer *transfer)
{
    uint8_t buffer[UAVCAN_PROTOCOL_GETNODEINFO_RESPONSE_MAX_SIZE];
    struct uavcan_protocol_GetNodeInfoResponse response;
    memset(&response, 0, sizeof(response));

    localNodeStatus.uptime_sec = millis() / 1000U;
    response.status = localNodeStatus;
    response.software_version.major = FLIGHT_COMMANDER_VERSION_MAJOR;
    response.software_version.minor = FLIGHT_COMMANDER_VERSION_MINOR;
    response.software_version.vcs_commit = strtoul(shortGitRevision, NULL, 16);
    response.hardware_version.major = 1;
    canardSTM32GetUniqueID(response.hardware_version.unique_id);
    const char nodeName[] = "org.flightcommander.flightcontroller";
    memcpy(response.name.data, nodeName, MIN(sizeof(nodeName) - 1U, sizeof(response.name.data)));
    response.name.len = MIN(sizeof(nodeName) - 1U, sizeof(response.name.data));

    const uint16_t length = uavcan_protocol_GetNodeInfoResponse_encode(&response, buffer);
    canardRequestOrRespond(instance, transfer->source_node_id,
        UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE, UAVCAN_PROTOCOL_GETNODEINFO_ID,
        &transfer->transfer_id, transfer->priority, CanardResponse, buffer, length);
}

static bool shouldAcceptTransfer(const CanardInstance *instance, uint64_t *signature,
    uint16_t dataTypeID, CanardTransferType transferType, uint8_t sourceNodeID)
{
    UNUSED(instance);
    UNUSED(sourceNodeID);
    if (transferType == CanardTransferTypeRequest && dataTypeID == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        *signature = UAVCAN_PROTOCOL_GETNODEINFO_REQUEST_SIGNATURE;
        return true;
    }
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
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
        return false;
    }
    switch (dataTypeID) {
    case UAVCAN_PROTOCOL_NODESTATUS_ID:
        *signature = UAVCAN_PROTOCOL_NODESTATUS_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_GNSS_AUXILIARY_ID:
        *signature = UAVCAN_EQUIPMENT_GNSS_AUXILIARY_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_GNSS_FIX_ID:
        *signature = UAVCAN_EQUIPMENT_GNSS_FIX_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_GNSS_FIX2_ID:
        *signature = UAVCAN_EQUIPMENT_GNSS_FIX2_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_ID:
        *signature = UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_POWER_BATTERYINFO_ID:
        *signature = UAVCAN_EQUIPMENT_POWER_BATTERYINFO_SIGNATURE;
        return true;
    case UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH2_ID:
        *signature = UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH2_SIGNATURE;
        return true;
    case ARDUPILOT_GNSS_HEADING_ID:
        *signature = ARDUPILOT_GNSS_HEADING_SIGNATURE;
        return true;
    case ARDUPILOT_GNSS_RELPOSHEADING_ID:
        *signature = ARDUPILOT_GNSS_RELPOSHEADING_SIGNATURE;
        return true;
    default:
        return false;
    }
}

static void onTransferReceived(CanardInstance *instance, CanardRxTransfer *transfer)
{
    if (transfer->transfer_type == CanardTransferTypeRequest &&
        transfer->data_type_id == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        handleGetNodeInfo(instance, transfer);
        return;
    }
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
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
        return;
    }
    switch (transfer->data_type_id) {
    case UAVCAN_PROTOCOL_NODESTATUS_ID: handleNodeStatus(transfer); break;
    case UAVCAN_EQUIPMENT_GNSS_AUXILIARY_ID: handleGnssAuxiliary(transfer); break;
    case UAVCAN_EQUIPMENT_GNSS_FIX_ID: handleGnssFix(transfer); break;
    case UAVCAN_EQUIPMENT_GNSS_FIX2_ID: handleGnssFix2(transfer); break;
    case UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_ID: handleRtcmStream(transfer); break;
    case UAVCAN_EQUIPMENT_POWER_BATTERYINFO_ID: handleBatteryInfo(transfer); break;
    case UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH2_ID: handleMagneticField(transfer); break;
    case ARDUPILOT_GNSS_HEADING_ID: handleHeading(transfer); break;
    case ARDUPILOT_GNSS_RELPOSHEADING_ID: handleRelPosHeading(transfer); break;
    default: break;
    }
}

static void processTxQueue(void)
{
    const CanardCANFrame *frame;
    while ((frame = canardPeekTxQueue(&canard)) != NULL) {
        const int16_t result = canardSTM32Transmit(frame);
        if (result > 0 || result < 0) {
            canardPopTxQueue(&canard);
        } else {
            break;
        }
    }
}

static void compactExpiredNodes(void)
{
    const timeMs_t now = millis();
    for (unsigned index = 0; index < activeNodeCount;) {
        if (now - nodeTable[index].last_seen_ms <= DRONECAN_NODE_TIMEOUT_MS) {
            index++;
            continue;
        }
        activeNodeCount--;
        if (index != activeNodeCount) {
            nodeTable[index] = nodeTable[activeNodeCount];
        }
    }
}

static void sendNodeStatus(void)
{
    uint8_t buffer[UAVCAN_PROTOCOL_NODESTATUS_MAX_SIZE];
    static uint8_t transferID;
    localNodeStatus.uptime_sec = millis() / 1000U;
    localNodeStatus.health = isHardwareHealthy() ? UAVCAN_PROTOCOL_NODESTATUS_HEALTH_OK :
        UAVCAN_PROTOCOL_NODESTATUS_HEALTH_CRITICAL;
    localNodeStatus.mode = UAVCAN_PROTOCOL_NODESTATUS_MODE_OPERATIONAL;
    localNodeStatus.vendor_specific_status_code = armingFlags;
    const uint16_t length = uavcan_protocol_NodeStatus_encode(&localNodeStatus, buffer);
    canardBroadcast(&canard, UAVCAN_PROTOCOL_NODESTATUS_SIGNATURE, UAVCAN_PROTOCOL_NODESTATUS_ID,
        &transferID, CANARD_TRANSFER_PRIORITY_LOW, buffer, length);
}

void dronecanInit(void)
{
    switch (dronecanConfig()->bitRateKbps) {
    case DRONECAN_BITRATE_125KBPS: activeBitrate = 125000; break;
    case DRONECAN_BITRATE_250KBPS: activeBitrate = 250000; break;
    case DRONECAN_BITRATE_500KBPS: activeBitrate = 500000; break;
    case DRONECAN_BITRATE_1000KBPS: activeBitrate = 1000000; break;
    default: activeBitrate = 500000; break;
    }
    state = STATE_DRONECAN_INIT;
    initialized = false;
    activeNodeCount = 0;
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairInit();
#endif
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)
    dronecanAllocatorInit();
#endif
    if (canardSTM32CAN1_Init(activeBitrate) != CANARD_OK) {
        state = STATE_DRONECAN_BUS_OFF;
        return;
    }
    canardInit(&canard, memoryPool, sizeof(memoryPool), onTransferReceived, shouldAcceptTransfer, NULL);
    if (dronecanConfig()->nodeID >= 1 && dronecanConfig()->nodeID <= 127) {
        canardSetLocalNodeID(&canard, dronecanConfig()->nodeID);
        initialized = true;
        state = STATE_DRONECAN_NORMAL;
    }
}

void dronecanUpdate(timeUs_t currentTimeUs)
{
    static timeUs_t nextOneHz;
    static timeUs_t busOffSince;
    canardProtocolStatus_t protocolStatus = { 0 };

    if (!initialized) {
        return;
    }
    if (state == STATE_DRONECAN_BUS_OFF) {
        if (currentTimeUs - busOffSince >= 100000U) {
            canardSTM32RecoverFromBusOff();
            canardSTM32GetProtocolStatus(&protocolStatus);
            busOffSince = currentTimeUs;
            if (!protocolStatus.BusOff) {
                state = STATE_DRONECAN_NORMAL;
            }
        }
        return;
    }

    processTxQueue();
    CanardCANFrame frame;
    int32_t pending = canardSTM32GetRxFifoFillLevel();
    while (pending-- > 0) {
        const int16_t result = canardSTM32Recieve(&frame);
        if (result > 0) {
            canardHandleRxFrame(&canard, &frame, currentTimeUs);
        }
    }
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairUpdate();
#endif
    processTxQueue();

    if (!nextOneHz || currentTimeUs >= nextOneHz) {
        nextOneHz = currentTimeUs + 1000000U;
        canardCleanupStaleTransfers(&canard, currentTimeUs);
        compactExpiredNodes();
        sendNodeStatus();
    }
    canardSTM32GetProtocolStatus(&protocolStatus);
    if (protocolStatus.BusOff) {
        state = STATE_DRONECAN_BUS_OFF;
        busOffSince = currentTimeUs;
    }
}

bool dronecanBroadcastRtcm(const uint8_t *data, uint16_t length)
{
    if (!initialized || !data || !length) {
        return false;
    }
    static uint8_t transferID;
    while (length) {
        struct uavcan_equipment_gnss_RTCMStream message = { 0 };
        uint8_t buffer[UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_MAX_SIZE];
        message.protocol_id = UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_PROTOCOL_ID_RTCM3;
        message.data.len = MIN(length, sizeof(message.data.data));
        memcpy(message.data.data, data, message.data.len);
        const uint16_t encodedLength = uavcan_equipment_gnss_RTCMStream_encode(&message, buffer);
        if (canardBroadcast(&canard, UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_SIGNATURE,
            UAVCAN_EQUIPMENT_GNSS_RTCMSTREAM_ID, &transferID, CANARD_TRANSFER_PRIORITY_LOW,
            buffer, encodedLength) < 0) {
            return false;
        }
        data += message.data.len;
        length -= message.data.len;
    }
    return true;
}

dronecanState_e dronecanGetState(void)
{
    return state;
}

uint8_t dronecanGetNodeCount(void)
{
    return activeNodeCount;
}

uint32_t dronecanGetBitrateKbps(void)
{
    return activeBitrate / 1000U;
}

const dronecanNodeInfo_t *dronecanGetNode(uint8_t index)
{
    return index < activeNodeCount ? &nodeTable[index] : NULL;
}


bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength)
{
    if (!initialized || destinationNodeID < 1 || destinationNodeID > 127 || !transferID) {
        return false;
    }
    return canardRequestOrRespond(&canard, destinationNodeID, signature, dataTypeID,
        transferID, CANARD_TRANSFER_PRIORITY_MEDIUM, CanardRequest, payload, payloadLength) >= 0;
}

const dronecanNodeInfo_t *dronecanGetNodeById(uint8_t nodeID)
{
    return findNode(nodeID, false);
}


bool dronecanBroadcastTransfer(uint64_t signature, uint16_t dataTypeID,
    uint8_t *transferID, uint8_t priority, const void *payload, uint16_t payloadLength)
{
    if (!initialized || !transferID) {
        return false;
    }
    return canardBroadcast(&canard, signature, dataTypeID, transferID, priority,
        payload, payloadLength) >= 0;
}

#endif
