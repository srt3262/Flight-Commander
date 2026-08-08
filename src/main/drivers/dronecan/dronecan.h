#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "common/time.h"
#include "config/parameter_group.h"

typedef enum {
    DRONECAN_BITRATE_125KBPS = 0,
    DRONECAN_BITRATE_250KBPS,
    DRONECAN_BITRATE_500KBPS,
    DRONECAN_BITRATE_1000KBPS,
    DRONECAN_BITRATE_COUNT
} dronecanBitrate_e;

typedef enum {
    STATE_DRONECAN_INIT,
    STATE_DRONECAN_NORMAL,
    STATE_DRONECAN_BUS_OFF
} dronecanState_e;

#define DRONECAN_MAX_NODES 32
#define DRONECAN_NODE_ID_AUTO 0
#define DRONECAN_NODE_ID_DISABLED 255
#define DRONECAN_CONFIG_SCHEMA 2

#define DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY (1U << 0)

typedef enum {
    DRONECAN_TERMINATION_UNCHANGED = 0,
    DRONECAN_TERMINATION_DISABLED = 1,
    DRONECAN_TERMINATION_ENABLED = 2,
} dronecanTermination_e;

typedef enum {
    DRONECAN_NODE_CAPABILITY_GNSS = (1U << 0),
    DRONECAN_NODE_CAPABILITY_RTCM = (1U << 1),
    DRONECAN_NODE_CAPABILITY_BATTERY = (1U << 2),
    DRONECAN_NODE_CAPABILITY_MAG = (1U << 3),
    DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING = (1U << 4),
} dronecanNodeCapability_e;

typedef struct dronecanConfig_s {
    uint8_t nodeID;
    uint8_t bitRateKbps;
    uint8_t gpsNodeID;             // Normal navigation GNSS binding.
    uint8_t batteryNodeID;
    uint8_t primaryGpsSource;
    uint8_t magNodeID;
    uint8_t movingBaseNodeID;      // Fixed aircraft moving-base identity.
    uint8_t movingRoverNodeID;     // Fixed heading-producing rover identity.
    uint8_t pairFlags;
    uint8_t baseTermination;
    uint8_t roverTermination;
} dronecanConfig_t;

typedef struct dronecanNodeInfo_s {
    uint8_t nodeID;
    uint8_t health;
    uint8_t mode;
    uint32_t uptime_sec;
    uint16_t vendor_status_code;
    uint32_t last_seen_ms;
    uint16_t capabilities;
    uint8_t name_len;
    char name[32];
} dronecanNodeInfo_t;

typedef struct dronecanNodeStatus_s {
    uint8_t nodeID;
    uint8_t health;
    uint8_t mode;
    uint32_t last_seen_ms;
} __attribute__((packed)) dronecanNodeStatus_t;

void dronecanInit(void);
void dronecanUpdate(timeUs_t currentTimeUs);
bool dronecanBroadcastRtcm(const uint8_t *data, uint16_t length);
bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength);
bool dronecanBroadcastTransfer(uint64_t signature, uint16_t dataTypeID,
    uint8_t *transferID, uint8_t priority, const void *payload, uint16_t payloadLength);
dronecanState_e dronecanGetState(void);
uint8_t dronecanGetNodeCount(void);
uint32_t dronecanGetBitrateKbps(void);
const dronecanNodeInfo_t *dronecanGetNode(uint8_t index);
const dronecanNodeInfo_t *dronecanGetNodeById(uint8_t nodeID);
void dronecanMarkNodeCapability(uint8_t nodeID, uint16_t capability);

PG_DECLARE(dronecanConfig_t, dronecanConfig);
