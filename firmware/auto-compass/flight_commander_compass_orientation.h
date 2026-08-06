#pragma once

#include <stdbool.h>
#include <stdint.h>

#define FC_COMPASS_ORIENTATION_CANDIDATE_COUNT 24U
#define FC_COMPASS_ORIENTATION_NONE 255U
#define FC_COMPASS_ORIENTATION_STATUS_TAIL_BYTES 11U

typedef enum {
    FC_COMPASS_ORIENTATION_REQUIRED = 0,
    FC_COMPASS_ORIENTATION_LEARNING = 1,
    FC_COMPASS_ORIENTATION_VERIFIED = 2,
    FC_COMPASS_ORIENTATION_REJECTED = 3,
} fcCompassOrientationState_e;

typedef enum {
    FC_COMPASS_ORIENTATION_FAILURE_NONE = 0,
    FC_COMPASS_ORIENTATION_FAILURE_ACCELEROMETER_NOT_CALIBRATED = 1,
    FC_COMPASS_ORIENTATION_FAILURE_GYRO_NOT_SETTLED = 2,
    FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_SAMPLES = 3,
    FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_POSE_COVERAGE = 4,
    FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_ROTATION = 5,
    FC_COMPASS_ORIENTATION_FAILURE_MAGNETIC_FIELD_DISTURBED = 6,
    FC_COMPASS_ORIENTATION_FAILURE_EXCESSIVE_RESIDUAL = 7,
    FC_COMPASS_ORIENTATION_FAILURE_AMBIGUOUS = 8,
    FC_COMPASS_ORIENTATION_FAILURE_ABORTED = 9,
    FC_COMPASS_ORIENTATION_FAILURE_INTERNAL = 10,
} fcCompassOrientationFailure_e;

typedef struct {
    uint8_t state;
    uint8_t candidateIndex;
    uint8_t failure;
    uint8_t confidence;
    uint8_t facesMask;
    uint16_t samples;
    uint16_t residualCentidegrees;
    uint16_t marginCentidegrees;
} fcCompassOrientationStatus_t;

typedef struct {
    bool accepted;
    uint8_t candidateIndex;
    uint8_t confidence;
    uint16_t residualCentidegrees;
    uint16_t marginCentidegrees;
    float nativeZero[3];
    float nativeGain[3];
} fcCompassOrientationSolution_t;

void fcCompassOrientationInit(uint8_t persistedCandidate, bool persistedValid);

bool fcCompassOrientationStart(
    bool accelerometerCalibrated,
    bool gyroSettled,
    uint32_t nowMs
);

void fcCompassOrientationAbort(void);

bool fcCompassOrientationActive(void);
bool fcCompassOrientationValid(void);
uint8_t fcCompassOrientationCandidate(void);

bool fcCompassOrientationAddSample(
    const float canonicalMag[3],
    int16_t rollDecidegrees,
    int16_t pitchDecidegrees,
    int16_t yawDecidegrees,
    uint32_t nowMs
);

bool fcCompassOrientationFinish(fcCompassOrientationSolution_t *solution);

void fcCompassOrientationCommit(uint8_t candidateIndex);
void fcCompassOrientationApply(uint8_t candidateIndex, float vector[3]);
void fcCompassOrientationMatrix(uint8_t candidateIndex, int8_t matrix[9]);

const fcCompassOrientationStatus_t *fcCompassOrientationStatus(void);
