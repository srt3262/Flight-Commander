#pragma once

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)

#include <stdbool.h>
#include <stdint.h>

#include "drivers/dronecan/libcanard/canard.h"

struct ardupilot_gnss_RelPosHeading;

#define DRONECAN_PAIR_STATUS_SCHEMA 1
#define DRONECAN_PAIR_COMMAND_SCHEMA 1

typedef enum {
    DRONECAN_PAIR_COMMAND_NONE = 0,
    DRONECAN_PAIR_COMMAND_CONFIGURE = 1,
    DRONECAN_PAIR_COMMAND_VERIFY = 2,
    DRONECAN_PAIR_COMMAND_ABORT = 3,
} dronecanPairCommand_e;

typedef enum {
    DRONECAN_PAIR_STATE_IDLE = 0,
    DRONECAN_PAIR_STATE_DISCOVER_BASE = 1,
    DRONECAN_PAIR_STATE_DISCOVER_ROVER = 2,
    DRONECAN_PAIR_STATE_CONFIGURE_BASE = 3,
    DRONECAN_PAIR_STATE_SAVE_BASE = 4,
    DRONECAN_PAIR_STATE_CONFIGURE_ROVER = 5,
    DRONECAN_PAIR_STATE_SAVE_ROVER = 6,
    DRONECAN_PAIR_STATE_RESTART_BASE = 7,
    DRONECAN_PAIR_STATE_RESTART_ROVER = 8,
    DRONECAN_PAIR_STATE_WAIT_RECONNECT = 9,
    DRONECAN_PAIR_STATE_VERIFY_BASE = 10,
    DRONECAN_PAIR_STATE_VERIFY_ROVER = 11,
    DRONECAN_PAIR_STATE_COMPLETE = 12,
    DRONECAN_PAIR_STATE_ERROR = 13,
    DRONECAN_PAIR_STATE_ABORTED = 14,
} dronecanPairState_e;

typedef enum {
    DRONECAN_PAIR_ERROR_NONE = 0,
    DRONECAN_PAIR_ERROR_BINDING_INCOMPLETE = 1,
    DRONECAN_PAIR_ERROR_DUPLICATE_NODE = 2,
    DRONECAN_PAIR_ERROR_BASE_OFFLINE = 3,
    DRONECAN_PAIR_ERROR_ROVER_OFFLINE = 4,
    DRONECAN_PAIR_ERROR_IDENTITY = 5,
    DRONECAN_PAIR_ERROR_TIMEOUT = 6,
    DRONECAN_PAIR_ERROR_PARAMETER_MISSING = 7,
    DRONECAN_PAIR_ERROR_PARAMETER_REJECTED = 8,
    DRONECAN_PAIR_ERROR_SAVE = 9,
    DRONECAN_PAIR_ERROR_RESTART = 10,
    DRONECAN_PAIR_ERROR_BASE_VERIFY = 11,
    DRONECAN_PAIR_ERROR_ROVER_VERIFY = 12,
    DRONECAN_PAIR_ERROR_ARMED = 13,
    DRONECAN_PAIR_ERROR_COMMAND = 14,
    DRONECAN_PAIR_ERROR_TRANSMIT = 15,
} dronecanPairError_e;

typedef struct dronecanPairStatus_s {
    uint8_t state;
    uint8_t progress;
    uint8_t errorCode;
    uint8_t activeNodeID;
    bool baseOnline;
    bool roverOnline;
    bool baseRoleVerified;
    bool roverRoleVerified;
    bool baseIdentityValid;
    bool roverIdentityValid;
    bool relativeHeadingFresh;
    bool configured;
    uint8_t baseNodeID;
    uint8_t roverNodeID;
    uint8_t baseFixType;
    uint8_t baseSatellites;
    uint16_t baseAgeMs;
    uint8_t roverFixType;
    uint8_t roverSatellites;
    uint16_t roverAgeMs;
    int16_t baseGpsType;
    int16_t roverGpsType;
    int16_t baseAutoConfig;
    int16_t roverAutoConfig;
    int16_t baseTermination;
    int16_t roverTermination;
    uint16_t relativeHeadingCentidegrees;
    uint16_t relativeAccuracyCentidegrees;
    uint16_t relativeDistanceCm;
    uint16_t relativeAgeMs;
    uint32_t relativeHeadingCount;
    uint32_t serviceRequestCount;
    uint32_t serviceResponseCount;
    uint32_t serviceTimeoutCount;
    uint8_t baseSoftwareMajor;
    uint8_t baseSoftwareMinor;
    uint8_t roverSoftwareMajor;
    uint8_t roverSoftwareMinor;
    char baseName[32];
    char roverName[32];
} dronecanPairStatus_t;

void dronecanPairInit(void);
void dronecanPairUpdate(void);
bool dronecanPairStartCommand(uint8_t command);
const dronecanPairStatus_t *dronecanPairGetStatus(void);
bool dronecanPairShouldAcceptResponse(uint16_t dataTypeID, uint64_t *signature);
bool dronecanPairHandleResponse(const CanardRxTransfer *transfer);
void dronecanPairRecordRelPosHeading(uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message);

#endif
