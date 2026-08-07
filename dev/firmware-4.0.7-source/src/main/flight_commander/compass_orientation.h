#pragma once

#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION)

#include <stdbool.h>
#include <stdint.h>

#include "common/streambuf.h"
#include "common/time.h"
#include "config/parameter_group.h"

#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_CONFIG_SCHEMA 1U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS_SCHEMA 1U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE 52U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_SCHEMA 1U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_PAYLOAD_SIZE 4U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT 6U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_AXIS_COUNT 3U
#define FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE 255U

typedef enum {
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_IDLE = 0,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING = 1,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_SOLVED = 2,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED = 3,
} flightCommanderCompassOrientationPhase_e;

typedef enum {
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_NONE = 0,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_ARMED = 1,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_ACCELEROMETER_REQUIRED = 2,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_COMPASS_REQUIRED = 3,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_MAGNETIC_RANGE = 4,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_AMBIGUOUS = 5,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_RESIDUAL = 6,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_INVALID_TRANSFORM = 7,
} flightCommanderCompassOrientationFailure_e;

typedef enum {
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_START = 1,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_CANCEL = 2,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_COMMIT = 3,
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_CLEAR = 4,
} flightCommanderCompassOrientationCommand_e;

typedef enum {
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_VALID = (1U << 0),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ACTIVE = (1U << 1),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_SOLVED = (1U << 2),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ACCEL_CALIBRATED = (1U << 3),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_FIELD_CALIBRATED = (1U << 4),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_COMPASS_PRESENT = (1U << 5),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ARMED = (1U << 6),
    FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_SAMPLE_ACCEPTED = (1U << 7),
} flightCommanderCompassOrientationFlag_e;

typedef struct flightCommanderCompassOrientationConfig_s {
    uint8_t schemaVersion;
    uint8_t valid;
    int8_t axisMap[FLIGHT_COMMANDER_COMPASS_ORIENTATION_AXIS_COUNT];
    uint8_t confidencePercent;
    uint16_t residualCentiDegrees;
    uint16_t separationCentiDegrees;
    uint32_t sensorFingerprint;
    uint32_t calibrationGeneration;
} flightCommanderCompassOrientationConfig_t;

void flightCommanderCompassOrientationInit(void);
void flightCommanderCompassOrientationObserve(timeUs_t currentTimeUs, const float nativeMag[3]);
void flightCommanderCompassOrientationApply(float vector[3]);
bool flightCommanderCompassOrientationIsValid(void);
uint32_t flightCommanderCompassOrientationGeneration(void);
void flightCommanderCompassOrientationWriteStatus(sbuf_t *dst);
bool flightCommanderCompassOrientationReadCommand(sbuf_t *src);
void flightCommanderCompassOrientationInvalidateFieldCalibration(void);

PG_DECLARE(flightCommanderCompassOrientationConfig_t, flightCommanderCompassOrientationConfig);

#endif
