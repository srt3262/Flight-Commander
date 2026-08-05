#pragma once

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
    uint8_t gpsNodeID;
    uint8_t batteryNodeID;
    uint8_t primaryGpsSource;
    uint8_t magNodeID;
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

// Wire format for MSP2_INAV_DRONECAN_NODES records (7 bytes each, packed).
typedef struct dronecanNodeStatus_s {
    uint8_t nodeID;
    uint8_t health;
    uint8_t mode;
    uint32_t last_seen_ms;
} __attribute__((packed)) dronecanNodeStatus_t;

void dronecanInit(void);
void dronecanUpdate(timeUs_t currentTimeUs);
bool dronecanBroadcastRtcm(const uint8_t *data, uint16_t length);
dronecanState_e dronecanGetState(void);
uint8_t dronecanGetNodeCount(void);
uint32_t dronecanGetBitrateKbps(void);
const dronecanNodeInfo_t *dronecanGetNode(uint8_t index);
void dronecanMarkNodeCapability(uint8_t nodeID, uint16_t capability);

PG_DECLARE(dronecanConfig_t, dronecanConfig);
