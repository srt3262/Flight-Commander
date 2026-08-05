#pragma once

#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)

#include <stdbool.h>
#include <stdint.h>

#include "common/streambuf.h"
#include "common/vector.h"
#include "config/parameter_group.h"

#include <dronecan_msgs.h>

#define FLIGHT_COMMANDER_HEADING_CONFIG_SCHEMA 2U
#define FLIGHT_COMMANDER_HEADING_STATUS_SCHEMA 2U
#define FLIGHT_COMMANDER_HEADING_CONFIG_PAYLOAD_SIZE 71U
#define FLIGHT_COMMANDER_HEADING_STATUS_PAYLOAD_SIZE 39U
#define FLIGHT_COMMANDER_HEADING_SOURCE_COUNT 4U
#define FLIGHT_COMMANDER_HEADING_SOURCE_NONE 255U

typedef enum {
    FLIGHT_COMMANDER_HEADING_ONBOARD_MAG = 0,
    FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG = 1,
    FLIGHT_COMMANDER_HEADING_DRONECAN_MAG = 2,
    FLIGHT_COMMANDER_HEADING_MOVING_BASELINE = 3,
} flightCommanderHeadingSource_e;

typedef enum {
    FLIGHT_COMMANDER_BASELINE_AUTO = 0,
    FLIGHT_COMMANDER_BASELINE_UART = 1,
    FLIGHT_COMMANDER_BASELINE_DRONECAN = 2,
} flightCommanderBaselineProvider_e;

typedef struct flightCommanderHeadingSourceConfig_s {
    uint8_t enabled;
    uint8_t priority;
    uint8_t weight;
    int16_t yawOffsetCentidegrees;
} flightCommanderHeadingSourceConfig_t;

typedef struct flightCommanderHeadingConfig_s {
    uint8_t movingBaselineEnabled;
    uint8_t movingBaselineFixedOnly;
    uint8_t movingBaselineProvider;
    uint8_t externalMagHardware;
    flightCommanderHeadingSourceConfig_t sources[FLIGHT_COMMANDER_HEADING_SOURCE_COUNT];
    uint16_t expectedBaselineCm;
    uint16_t baselineToleranceCm;
    uint16_t maxHeadingAccuracyCentidegrees;
    uint16_t sourceTimeoutMs;
    uint16_t maxDisagreementCentidegrees;
    int16_t externalMagAlignmentDecidegrees[3];
    int16_t externalMagZero[3];
    int16_t externalMagGain[3];
    int16_t dronecanMagAlignmentDecidegrees[3];
    int16_t dronecanMagZeroMilliGauss[3];
    uint16_t dronecanMagGainMilliGauss[3];
    uint8_t dronecanMagCalibrationNodeID;
} flightCommanderHeadingConfig_t;

typedef struct flightCommanderHeadingSourceStatus_s {
    uint16_t headingCentidegrees;
    uint16_t ageMs;
    uint8_t quality;
    uint8_t healthy;
} flightCommanderHeadingSourceStatus_t;

typedef struct flightCommanderHeadingStatus_s {
    uint8_t healthyMask;
    uint8_t activeMask;
    uint8_t rejectedMask;
    uint8_t anchorSource;
    uint8_t baselineProvider;
    uint8_t baselineFixed;
    uint8_t baselineNodeID;
    uint16_t fusedHeadingCentidegrees;
    uint16_t baselineHeadingCentidegrees;
    uint16_t baselineDistanceCm;
    uint16_t baselineAccuracyCentidegrees;
    uint8_t calibratedMask;
    uint8_t calibratingMask;
    uint8_t calibrationFailedMask;
    flightCommanderHeadingSourceStatus_t sources[FLIGHT_COMMANDER_HEADING_SOURCE_COUNT];
} flightCommanderHeadingStatus_t;

void flightCommanderHeadingInit(void);
void flightCommanderHeadingSetMagneticNorth(const fpVector3_t *magneticNorthEarth);
void flightCommanderHeadingUpdate(void);
void flightCommanderHeadingCalibrationUpdate(timeUs_t currentTimeUs);
void flightCommanderHeadingWriteConfig(sbuf_t *dst);
bool flightCommanderHeadingReadConfig(sbuf_t *src);
void flightCommanderHeadingWriteStatus(sbuf_t *dst);
const flightCommanderHeadingStatus_t *flightCommanderHeadingGetStatus(void);
float flightCommanderHeadingGetOnboardMagWeight(void);
bool flightCommanderHeadingGetMagSource(
    flightCommanderHeadingSource_e source,
    fpVector3_t *magneticFieldBody,
    float *weight);
bool flightCommanderHeadingGetAbsoluteReference(fpVector3_t *headingEarth, float *weight);
bool flightCommanderHeadingHasActiveReference(void);

void flightCommanderHeadingReceiveDronecanMag(
    uint8_t sourceNodeID,
    const struct uavcan_equipment_ahrs_MagneticFieldStrength2 *message);
void flightCommanderHeadingReceiveDronecanHeading(
    uint8_t sourceNodeID,
    const struct ardupilot_gnss_Heading *message);
void flightCommanderHeadingReceiveDronecanRelPosHeading(
    uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message);
void flightCommanderHeadingReceiveUartRelPosHeading(
    int32_t heading1e5Degrees,
    uint32_t accuracy1e5Degrees,
    int32_t distanceCentimeters,
    int8_t highPrecisionDistance0p1Millimeters,
    uint32_t flags);

PG_DECLARE(flightCommanderHeadingConfig_t, flightCommanderHeadingConfig);

#endif
