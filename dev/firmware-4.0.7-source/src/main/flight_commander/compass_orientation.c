#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION)

#include <math.h>
#include <string.h>

#include "common/axis.h"
#include "common/maths.h"
#include "common/streambuf.h"
#include "config/parameter_group.h"
#include "config/parameter_group_ids.h"
#include "fc/config.h"
#include "fc/runtime_config.h"
#include "flight_commander/compass_orientation.h"
#include "flight_commander/heading_fusion.h"
#include "sensors/acceleration.h"
#include "sensors/compass.h"
#include "sensors/gyro.h"
#include "sensors/sensors.h"

#define ORIENTATION_SAMPLE_COUNT_PER_FACE 40U
#define ORIENTATION_MAX_SAMPLE_COUNT \
    (FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT * ORIENTATION_SAMPLE_COUNT_PER_FACE)
#define ORIENTATION_MIN_FACE_SAMPLES 24U
#define ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES 270.0F
#define ORIENTATION_SAMPLE_SPACING_DEGREES 8.0F
#define ORIENTATION_ACCEL_MIN_G 0.75F
#define ORIENTATION_ACCEL_MAX_G 1.25F
#define ORIENTATION_DOMINANT_AXIS_MIN 0.78F
#define ORIENTATION_OTHER_AXIS_MAX 0.58F
#define ORIENTATION_MIN_AXIAL_RATE_DPS 18.0F
#define ORIENTATION_MAX_SAMPLE_INTERVAL_US 100000U
#define ORIENTATION_MIN_MAG_HALF_SPAN 40.0F
#define ORIENTATION_MAX_MAG_SPAN_RATIO 4.0F
#define ORIENTATION_MAX_RESIDUAL_DEGREES 6.0F
#define ORIENTATION_MIN_SCORE_SEPARATION_DEGREES 8.0F
#define ORIENTATION_ONBOARD_SENSOR_FINGERPRINT 0x0E8310C1U
#define ORIENTATION_EXTERNAL_SENSOR_FINGERPRINT 0xE1000000U
#define ORIENTATION_DRONECAN_SENSOR_FINGERPRINT 0xCA000000U

typedef struct orientationSample_s {
    float acc[XYZ_AXIS_COUNT];
    float mag[XYZ_AXIS_COUNT];
} orientationSample_t;

typedef struct orientationSession_s {
    orientationSample_t samples[ORIENTATION_MAX_SAMPLE_COUNT];
    uint16_t faceSampleCount[FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT];
    float faceRotationDegrees[FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT];
    float faceNextSampleDegrees[FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT];
    int8_t candidateAxisMap[XYZ_AXIS_COUNT];
    uint16_t totalSampleCount;
    uint16_t residualCentiDegrees;
    uint16_t separationCentiDegrees;
    timeUs_t previousObservationUs;
    uint8_t previousFace;
    uint8_t detectedFace;
    uint8_t confidencePercent;
    uint8_t phase;
    uint8_t failureReason;
    uint8_t source;
    bool sampleAccepted;
} orientationSession_t;

PG_REGISTER_WITH_RESET_FN(flightCommanderCompassOrientationConfig_t,
    flightCommanderCompassOrientationConfig,
    PG_FLIGHT_COMMANDER_COMPASS_ORIENTATION,
    2);

static orientationSession_t session;
static uint8_t selectedSource = FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD;

static bool commitSession(void);

// Every entry is a right-handed signed permutation. The learned transform is
// therefore an axis/sign mapping, never a free-form matrix that could distort
// magnetic-field magnitude or silently mirror the attitude coordinate frame.
static const int8_t properAxisMaps[24][XYZ_AXIS_COUNT] = {
    { -3, -2, -1 }, { -3, -1,  2 }, { -3,  1, -2 }, { -3,  2,  1 },
    { -2, -3,  1 }, { -2, -1, -3 }, { -2,  1,  3 }, { -2,  3, -1 },
    { -1, -3, -2 }, { -1, -2,  3 }, { -1,  2, -3 }, { -1,  3,  2 },
    {  1, -3,  2 }, {  1, -2, -3 }, {  1,  2,  3 }, {  1,  3, -2 },
    {  2, -3, -1 }, {  2, -1,  3 }, {  2,  1, -3 }, {  2,  3,  1 },
    {  3, -2,  1 }, {  3, -1, -2 }, {  3,  1,  2 }, {  3,  2, -1 },
};

static bool sourceIsSupported(uint8_t source)
{
    return source < FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_COUNT;
}

static uint32_t sourceFingerprint(uint8_t source)
{
    switch (source) {
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD:
        return ORIENTATION_ONBOARD_SENSOR_FINGERPRINT;
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_EXTERNAL_I2C:
        return ORIENTATION_EXTERNAL_SENSOR_FINGERPRINT |
            flightCommanderHeadingConfig()->externalMagHardware;
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_DRONECAN: {
        const uint8_t nodeID = flightCommanderHeadingCompassNodeID(source);
        return nodeID == 0 ? 0 : ORIENTATION_DRONECAN_SENSOR_FINGERPRINT | nodeID;
    }
    default:
        return 0;
    }
}

static bool axisMapIsProper(const int8_t axisMap[XYZ_AXIS_COUNT])
{
    bool used[XYZ_AXIS_COUNT] = { false, false, false };
    int permutation[XYZ_AXIS_COUNT];
    int signProduct = 1;

    for (unsigned outputAxis = 0; outputAxis < XYZ_AXIS_COUNT; outputAxis++) {
        const int value = axisMap[outputAxis];
        const int inputAxis = ABS(value) - 1;
        if (value == 0 || inputAxis < 0 || inputAxis >= XYZ_AXIS_COUNT || used[inputAxis]) {
            return false;
        }
        used[inputAxis] = true;
        permutation[outputAxis] = inputAxis;
        signProduct *= value < 0 ? -1 : 1;
    }

    int inversions = 0;
    for (unsigned first = 0; first < XYZ_AXIS_COUNT; first++) {
        for (unsigned second = first + 1; second < XYZ_AXIS_COUNT; second++) {
            if (permutation[first] > permutation[second]) {
                inversions++;
            }
        }
    }
    const int permutationSign = (inversions & 1) ? -1 : 1;
    return permutationSign * signProduct == 1;
}

static void applyAxisMap(float output[XYZ_AXIS_COUNT], const float input[XYZ_AXIS_COUNT],
    const int8_t axisMap[XYZ_AXIS_COUNT])
{
    for (unsigned outputAxis = 0; outputAxis < XYZ_AXIS_COUNT; outputAxis++) {
        const int map = axisMap[outputAxis];
        const unsigned inputAxis = (unsigned)(ABS(map) - 1);
        output[outputAxis] = map < 0 ? -input[inputAxis] : input[inputAxis];
    }
}

static flightCommanderCompassOrientationSourceConfig_t *sourceConfigMutable(uint8_t source)
{
    return sourceIsSupported(source)
        ? &flightCommanderCompassOrientationConfigMutable()->sources[source]
        : NULL;
}

static const flightCommanderCompassOrientationSourceConfig_t *sourceConfig(uint8_t source)
{
    return sourceIsSupported(source)
        ? &flightCommanderCompassOrientationConfig()->sources[source]
        : NULL;
}

static bool storedConfigIsValid(uint8_t source,
    const flightCommanderCompassOrientationSourceConfig_t *config)
{
    const uint32_t fingerprint = sourceFingerprint(source);
    return config &&
        flightCommanderCompassOrientationConfig()->schemaVersion ==
            FLIGHT_COMMANDER_COMPASS_ORIENTATION_CONFIG_SCHEMA &&
        config->valid &&
        fingerprint != 0 &&
        config->sensorFingerprint == fingerprint &&
        config->calibrationGeneration != 0 &&
        axisMapIsProper(config->axisMap);
}

static void resetSourceConfig(uint8_t source,
    flightCommanderCompassOrientationSourceConfig_t *config)
{
    memset(config, 0, sizeof(*config));
    config->axisMap[X] = 1;
    config->axisMap[Y] = 2;
    config->axisMap[Z] = 3;
    config->sensorFingerprint = sourceFingerprint(source);
}

void pgResetFn_flightCommanderCompassOrientationConfig(
    flightCommanderCompassOrientationConfig_t *config)
{
    memset(config, 0, sizeof(*config));
    config->schemaVersion = FLIGHT_COMMANDER_COMPASS_ORIENTATION_CONFIG_SCHEMA;
    for (uint8_t source = 0;
        source < FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_COUNT;
        source++) {
        resetSourceConfig(source, &config->sources[source]);
    }
}

static void resetSession(void)
{
    const uint8_t source = selectedSource;
    memset(&session, 0, sizeof(session));
    session.source = source;
    session.previousFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
    session.detectedFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
}

void flightCommanderCompassOrientationInit(void)
{
    resetSession();
    flightCommanderCompassOrientationConfig_t *config =
        flightCommanderCompassOrientationConfigMutable();
    if (config->schemaVersion != FLIGHT_COMMANDER_COMPASS_ORIENTATION_CONFIG_SCHEMA) {
        pgResetFn_flightCommanderCompassOrientationConfig(config);
        return;
    }

    for (uint8_t source = 0;
        source < FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_COUNT;
        source++) {
        flightCommanderCompassOrientationSourceConfig_t *stored = &config->sources[source];
        if (!storedConfigIsValid(source, stored)) {
            resetSourceConfig(source, stored);
        }
    }
}

bool flightCommanderCompassOrientationIsValid(uint8_t source)
{
    return storedConfigIsValid(source, sourceConfig(source));
}

uint32_t flightCommanderCompassOrientationGeneration(uint8_t source)
{
    const flightCommanderCompassOrientationSourceConfig_t *config = sourceConfig(source);
    return flightCommanderCompassOrientationIsValid(source)
        ? config->calibrationGeneration
        : 0;
}

uint8_t flightCommanderCompassOrientationSelectedSource(void)
{
    return selectedSource;
}

void flightCommanderCompassOrientationApply(uint8_t source, float vector[XYZ_AXIS_COUNT])
{
    const flightCommanderCompassOrientationSourceConfig_t *config = sourceConfig(source);
    if (!storedConfigIsValid(source, config)) {
        return;
    }

    const float input[XYZ_AXIS_COUNT] = { vector[X], vector[Y], vector[Z] };
    applyAxisMap(vector, input, config->axisMap);
}

static int detectFace(const float normalizedAcc[XYZ_AXIS_COUNT])
{
    unsigned dominantAxis = X;
    float dominantMagnitude = fabsf(normalizedAcc[X]);
    for (unsigned axis = Y; axis < XYZ_AXIS_COUNT; axis++) {
        const float magnitude = fabsf(normalizedAcc[axis]);
        if (magnitude > dominantMagnitude) {
            dominantMagnitude = magnitude;
            dominantAxis = axis;
        }
    }

    float otherMaximum = 0.0F;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        if (axis != dominantAxis) {
            otherMaximum = MAX(otherMaximum, fabsf(normalizedAcc[axis]));
        }
    }
    if (dominantMagnitude < ORIENTATION_DOMINANT_AXIS_MIN ||
        otherMaximum > ORIENTATION_OTHER_AXIS_MAX) {
        return -1;
    }

    return (int)(dominantAxis * 2U +
        (normalizedAcc[dominantAxis] < 0.0F ? 1U : 0U));
}

static uint16_t faceSampleBase(unsigned face)
{
    uint16_t base = 0;
    for (unsigned index = 0; index < face; index++) {
        base += session.faceSampleCount[index];
    }
    return base;
}

static void insertFaceSample(unsigned face, const float normalizedAcc[XYZ_AXIS_COUNT],
    const float nativeMag[XYZ_AXIS_COUNT])
{
    if (session.faceSampleCount[face] >= ORIENTATION_SAMPLE_COUNT_PER_FACE ||
        session.totalSampleCount >= ORIENTATION_MAX_SAMPLE_COUNT) {
        return;
    }

    const uint16_t insertIndex = faceSampleBase(face) + session.faceSampleCount[face];
    if (insertIndex < session.totalSampleCount) {
        memmove(&session.samples[insertIndex + 1], &session.samples[insertIndex],
            (session.totalSampleCount - insertIndex) * sizeof(session.samples[0]));
    }

    orientationSample_t *sample = &session.samples[insertIndex];
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        sample->acc[axis] = normalizedAcc[axis];
        sample->mag[axis] = nativeMag[axis];
    }
    session.faceSampleCount[face]++;
    session.totalSampleCount++;
    session.sampleAccepted = true;
}

static bool allFacesComplete(void)
{
    for (unsigned face = 0;
        face < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT;
        face++) {
        if (session.faceSampleCount[face] < ORIENTATION_MIN_FACE_SAMPLES ||
            session.faceRotationDegrees[face] < ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES) {
            return false;
        }
    }
    return true;
}

static void solveOrientation(void)
{
    float minimum[XYZ_AXIS_COUNT] = { INFINITY, INFINITY, INFINITY };
    float maximum[XYZ_AXIS_COUNT] = { -INFINITY, -INFINITY, -INFINITY };
    for (unsigned sampleIndex = 0; sampleIndex < session.totalSampleCount; sampleIndex++) {
        for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            minimum[axis] = MIN(minimum[axis], session.samples[sampleIndex].mag[axis]);
            maximum[axis] = MAX(maximum[axis], session.samples[sampleIndex].mag[axis]);
        }
    }

    float center[XYZ_AXIS_COUNT];
    float halfSpan[XYZ_AXIS_COUNT];
    float minimumHalfSpan = INFINITY;
    float maximumHalfSpan = 0.0F;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        center[axis] = (maximum[axis] + minimum[axis]) * 0.5F;
        halfSpan[axis] = (maximum[axis] - minimum[axis]) * 0.5F;
        minimumHalfSpan = MIN(minimumHalfSpan, halfSpan[axis]);
        maximumHalfSpan = MAX(maximumHalfSpan, halfSpan[axis]);
    }

    if (!isfinite(minimumHalfSpan) || minimumHalfSpan < ORIENTATION_MIN_MAG_HALF_SPAN ||
        maximumHalfSpan > minimumHalfSpan * ORIENTATION_MAX_MAG_SPAN_RATIO) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_MAGNETIC_RANGE;
        return;
    }

    float bestScore = INFINITY;
    float secondScore = INFINITY;
    int bestCandidate = -1;

    for (unsigned candidate = 0;
        candidate < (sizeof(properAxisMaps) / sizeof(properAxisMaps[0]));
        candidate++) {
        float meanAngle = 0.0F;
        float meanSquareAngle = 0.0F;
        unsigned accepted = 0;

        for (unsigned sampleIndex = 0;
            sampleIndex < session.totalSampleCount;
            sampleIndex++) {
            float normalizedNative[XYZ_AXIS_COUNT];
            for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                normalizedNative[axis] =
                    (session.samples[sampleIndex].mag[axis] - center[axis]) /
                    halfSpan[axis];
            }

            float candidateMag[XYZ_AXIS_COUNT];
            applyAxisMap(candidateMag, normalizedNative, properAxisMaps[candidate]);
            const float magnitude = sqrtf(
                sq(candidateMag[X]) + sq(candidateMag[Y]) + sq(candidateMag[Z]));
            if (!isfinite(magnitude) || magnitude < 0.1F) {
                continue;
            }
            for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                candidateMag[axis] /= magnitude;
            }

            const float dot = constrainf(
                candidateMag[X] * session.samples[sampleIndex].acc[X] +
                candidateMag[Y] * session.samples[sampleIndex].acc[Y] +
                candidateMag[Z] * session.samples[sampleIndex].acc[Z],
                -1.0F,
                1.0F);
            const float angle = acosf(dot);
            meanAngle += angle;
            meanSquareAngle += angle * angle;
            accepted++;
        }

        if (accepted != session.totalSampleCount || accepted == 0) {
            continue;
        }
        meanAngle /= accepted;
        meanSquareAngle /= accepted;
        const float variance = MAX(0.0F, meanSquareAngle - meanAngle * meanAngle);
        const float score = sqrtf(variance) * (180.0F / M_PIf);

        if (score < bestScore) {
            secondScore = bestScore;
            bestScore = score;
            bestCandidate = candidate;
        } else if (score < secondScore) {
            secondScore = score;
        }
    }

    if (bestCandidate < 0 || !isfinite(bestScore) || !isfinite(secondScore)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_INVALID_TRANSFORM;
        return;
    }

    const float separation = secondScore - bestScore;
    session.residualCentiDegrees = (uint16_t)constrain(
        lrintf(bestScore * 100.0F), 0, UINT16_MAX);
    session.separationCentiDegrees = (uint16_t)constrain(
        lrintf(separation * 100.0F), 0, UINT16_MAX);

    if (bestScore > ORIENTATION_MAX_RESIDUAL_DEGREES) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_RESIDUAL;
        return;
    }
    if (separation < ORIENTATION_MIN_SCORE_SEPARATION_DEGREES) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_AMBIGUOUS;
        return;
    }

    memcpy(session.candidateAxisMap, properAxisMaps[bestCandidate],
        sizeof(session.candidateAxisMap));
    if (!axisMapIsProper(session.candidateAxisMap)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_INVALID_TRANSFORM;
        return;
    }

    const float residualAuthority = constrainf(
        1.0F - bestScore / ORIENTATION_MAX_RESIDUAL_DEGREES, 0.0F, 1.0F);
    const float separationAuthority = constrainf(separation / 20.0F, 0.0F, 1.0F);
    session.confidencePercent = (uint8_t)constrain(
        lrintf((0.55F * residualAuthority + 0.45F * separationAuthority) * 100.0F),
        1,
        100);
    session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_NONE;
    session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_SOLVED;
}

void flightCommanderCompassOrientationObserve(timeUs_t currentTimeUs,
    uint8_t source,
    const float nativeMag[XYZ_AXIS_COUNT])
{
    if (source != session.source) {
        return;
    }
    session.sampleAccepted = false;
    if (session.phase != FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING) {
        return;
    }
    if (ARMING_FLAG(ARMED)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_ARMED;
        return;
    }

    float normalizedAcc[XYZ_AXIS_COUNT];
    accGetBoardFrame(normalizedAcc);
    const float accMagnitude = sqrtf(
        sq(normalizedAcc[X]) + sq(normalizedAcc[Y]) + sq(normalizedAcc[Z]));
    if (!isfinite(accMagnitude) || accMagnitude < ORIENTATION_ACCEL_MIN_G ||
        accMagnitude > ORIENTATION_ACCEL_MAX_G) {
        session.detectedFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
        session.previousFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
        session.previousObservationUs = currentTimeUs;
        return;
    }
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        normalizedAcc[axis] /= accMagnitude;
    }

    const int detectedFace = detectFace(normalizedAcc);
    if (detectedFace < 0) {
        session.detectedFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
        session.previousFace = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
        session.previousObservationUs = currentTimeUs;
        return;
    }
    session.detectedFace = detectedFace;

    float gyroVector[XYZ_AXIS_COUNT];
    gyroGetBoardFrame(gyroVector);
    const float axialRate =
        gyroVector[X] * normalizedAcc[X] +
        gyroVector[Y] * normalizedAcc[Y] +
        gyroVector[Z] * normalizedAcc[Z];
    const float totalRateSquared =
        sq(gyroVector[X]) + sq(gyroVector[Y]) + sq(gyroVector[Z]);
    const float lateralRate = sqrtf(MAX(0.0F, totalRateSquared - sq(axialRate)));

    const timeDelta_t elapsedUs = cmpTimeUs(currentTimeUs, session.previousObservationUs);
    const bool continuousFace = session.previousFace == detectedFace &&
        session.previousObservationUs != 0 && elapsedUs > 0 &&
        elapsedUs <= (timeDelta_t)ORIENTATION_MAX_SAMPLE_INTERVAL_US;
    session.previousObservationUs = currentTimeUs;
    session.previousFace = detectedFace;

    if (!continuousFace || fabsf(axialRate) < ORIENTATION_MIN_AXIAL_RATE_DPS ||
        fabsf(axialRate) < lateralRate * 1.5F) {
        return;
    }

    const float elapsedSeconds = elapsedUs * 1e-6F;
    session.faceRotationDegrees[detectedFace] = MIN(
        360.0F,
        session.faceRotationDegrees[detectedFace] + fabsf(axialRate) * elapsedSeconds);

    if (session.faceRotationDegrees[detectedFace] + 0.01F >=
            session.faceNextSampleDegrees[detectedFace]) {
        insertFaceSample(detectedFace, normalizedAcc, nativeMag);
        session.faceNextSampleDegrees[detectedFace] += ORIENTATION_SAMPLE_SPACING_DEGREES;
    }

    if (allFacesComplete()) {
        solveOrientation();
        if (session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_SOLVED) {
            // A complete, unambiguous source-specific solve is committed and
            // saved immediately so unplugging the Configurator cannot lose it.
            (void)commitSession();
        }
    }
}

void flightCommanderCompassOrientationInvalidateFieldCalibration(uint8_t source)
{
    if (source == FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD) {
        compassConfig_t *compass = compassConfigMutable();
        for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            compass->magZero.raw[axis] = 0;
            compass->magGain[axis] = 1024;
        }
        compass->magCalibrationSignature = 0;
        DISABLE_STATE(COMPASS_CALIBRATED);
        return;
    }
    flightCommanderHeadingInvalidateCompassFieldCalibration(source);
}

static bool startSession(uint8_t source)
{
    selectedSource = source;
    resetSession();
    if (ARMING_FLAG(ARMED)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_ARMED;
        return false;
    }
    if (!sensors(SENSOR_ACC) || !STATE(ACCELEROMETER_CALIBRATED)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason =
            FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_ACCELEROMETER_REQUIRED;
        return false;
    }
    if (!flightCommanderHeadingCompassSourcePresent(source)) {
        session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_FAILED;
        session.failureReason = FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_COMPASS_REQUIRED;
        return false;
    }

    session.phase = FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING;
    return true;
}

static bool commitSession(void)
{
    if (session.phase != FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_SOLVED ||
        !axisMapIsProper(session.candidateAxisMap) ||
        !sourceIsSupported(session.source) ||
        ARMING_FLAG(ARMED)) {
        return false;
    }

    flightCommanderCompassOrientationSourceConfig_t *config =
        sourceConfigMutable(session.source);
    const uint32_t fingerprint = sourceFingerprint(session.source);
    if (!config || fingerprint == 0) {
        return false;
    }
    config->valid = true;
    memcpy(config->axisMap, session.candidateAxisMap, sizeof(config->axisMap));
    config->confidencePercent = session.confidencePercent;
    config->residualCentiDegrees = session.residualCentiDegrees;
    config->separationCentiDegrees = session.separationCentiDegrees;
    config->sensorFingerprint = fingerprint;
    config->calibrationGeneration++;
    if (config->calibrationGeneration == 0) {
        config->calibrationGeneration = 1;
    }

    flightCommanderCompassOrientationInvalidateFieldCalibration(session.source);
    saveConfigAndNotify();
    const uint8_t source = session.source;
    resetSession();
    return storedConfigIsValid(source, sourceConfig(source));
}

static bool clearStoredOrientation(uint8_t source)
{
    if (ARMING_FLAG(ARMED) || !sourceIsSupported(source)) {
        return false;
    }

    resetSourceConfig(source, sourceConfigMutable(source));
    flightCommanderCompassOrientationInvalidateFieldCalibration(source);
    selectedSource = source;
    resetSession();
    saveConfigAndNotify();
    return true;
}

bool flightCommanderCompassOrientationReadCommand(sbuf_t *src)
{
    if (sbufBytesRemaining(src) !=
            FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_PAYLOAD_SIZE ||
        sbufReadU8(src) != FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_SCHEMA) {
        return false;
    }

    const uint8_t command = sbufReadU8(src);
    const uint8_t source = sbufReadU8(src);
    (void)sbufReadU8(src);
    if (!sourceIsSupported(source)) {
        return false;
    }

    if (command == FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_SELECT) {
        if (session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING) {
            return source == session.source;
        }
        selectedSource = source;
        resetSession();
        return true;
    }

    if (session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING &&
        source != session.source &&
        command != FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_CANCEL) {
        return false;
    }
    selectedSource = source;

    switch (command) {
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_START:
        return startSession(source);
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_CANCEL:
        resetSession();
        return true;
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_COMMIT:
        return source == session.source && commitSession();
    case FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_CLEAR:
        return clearStoredOrientation(source);
    default:
        return false;
    }
}

static uint8_t nextIncompleteFace(void)
{
    for (unsigned face = 0;
        face < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT;
        face++) {
        if (session.faceSampleCount[face] < ORIENTATION_MIN_FACE_SAMPLES ||
            session.faceRotationDegrees[face] < ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES) {
            return face;
        }
    }
    return FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_NONE;
}

void flightCommanderCompassOrientationWriteStatus(sbuf_t *dst)
{
    const flightCommanderCompassOrientationSourceConfig_t *config =
        sourceConfig(selectedSource);
    uint8_t flags = 0;
    if (flightCommanderCompassOrientationIsValid(selectedSource)) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_VALID;
    }
    if (session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_COLLECTING) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ACTIVE;
    }
    if (session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_SOLVED) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_SOLVED;
    }
    if (STATE(ACCELEROMETER_CALIBRATED)) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ACCEL_CALIBRATED;
    }
    if (flightCommanderHeadingCompassFieldCalibrated(selectedSource)) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_FIELD_CALIBRATED;
    }
    if (flightCommanderHeadingCompassSourcePresent(selectedSource)) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_COMPASS_PRESENT;
    }
    if (ARMING_FLAG(ARMED)) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_ARMED;
    }
    if (session.sampleAccepted) {
        flags |= FLIGHT_COMMANDER_COMPASS_ORIENTATION_FLAG_SAMPLE_ACCEPTED;
    }

    uint8_t completedMask = 0;
    for (unsigned face = 0;
        face < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT;
        face++) {
        if (session.faceSampleCount[face] >= ORIENTATION_MIN_FACE_SAMPLES &&
            session.faceRotationDegrees[face] >= ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES) {
            completedMask |= 1U << face;
        }
    }

    const uint8_t currentFace = session.detectedFace;
    const uint16_t currentFaceSamples =
        currentFace < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT
            ? session.faceSampleCount[currentFace]
            : 0;
    const uint16_t currentFaceRotation =
        currentFace < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT
            ? (uint16_t)constrain(
                lrintf(session.faceRotationDegrees[currentFace] * 100.0F),
                0,
                36000)
            : 0;

    const bool reportStoredResult =
        session.phase == FLIGHT_COMMANDER_COMPASS_ORIENTATION_PHASE_IDLE;
    const uint8_t reportedConfidence = reportStoredResult && config
        ? config->confidencePercent
        : session.confidencePercent;
    const uint16_t reportedResidual = reportStoredResult && config
        ? config->residualCentiDegrees
        : session.residualCentiDegrees;
    const uint16_t reportedSeparation = reportStoredResult && config
        ? config->separationCentiDegrees
        : session.separationCentiDegrees;

    sbufWriteU8(dst, FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS_SCHEMA);
    sbufWriteU8(dst, session.phase);
    sbufWriteU8(dst, flags);
    sbufWriteU8(dst, session.failureReason);
    sbufWriteU8(dst, completedMask);
    sbufWriteU8(dst, currentFace);
    sbufWriteU8(dst, nextIncompleteFace());
    sbufWriteU8(dst, reportedConfidence);
    sbufWriteU16(dst, reportedResidual);
    sbufWriteU16(dst, reportedSeparation);
    sbufWriteU16(dst, session.totalSampleCount);
    sbufWriteU16(dst, currentFaceSamples);
    sbufWriteU16(dst, currentFaceRotation);
    sbufWriteU32(dst, config ? config->calibrationGeneration : 0);
    sbufWriteU32(dst, sourceFingerprint(selectedSource));
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        sbufWriteU8(dst, (uint8_t)session.candidateAxisMap[axis]);
    }
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        sbufWriteU8(dst, (uint8_t)(config ? config->axisMap[axis] : 0));
    }
    for (unsigned face = 0;
        face < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT;
        face++) {
        sbufWriteU8(dst, (uint8_t)constrain(
            lrintf(session.faceRotationDegrees[face] * 100.0F /
                ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES),
            0,
            100));
    }
    for (unsigned face = 0;
        face < FLIGHT_COMMANDER_COMPASS_ORIENTATION_FACE_COUNT;
        face++) {
        sbufWriteU8(dst, (uint8_t)MIN(session.faceSampleCount[face], UINT8_MAX));
    }
    sbufWriteU8(dst, session.detectedFace);
    sbufWriteU8(dst, selectedSource);
    float boardFrameAcc[XYZ_AXIS_COUNT];
    accGetBoardFrame(boardFrameAcc);
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        sbufWriteU16(dst, (uint16_t)(int16_t)constrain(
            lrintf(boardFrameAcc[axis] * 1000.0F), INT16_MIN, INT16_MAX));
    }
}

#endif
