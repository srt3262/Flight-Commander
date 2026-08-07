#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)

#include <math.h>
#include <string.h>

#include "common/axis.h"
#include "common/maths.h"
#include "common/quaternion.h"
#include "common/streambuf.h"
#include "common/vector.h"
#include "config/parameter_group.h"
#include "config/parameter_group_ids.h"
#include "drivers/time.h"
#include "drivers/dronecan/dronecan.h"
#include "fc/config.h"
#include "fc/runtime_config.h"
#include "flight/imu.h"
#include "flight_commander/external_compass.h"
#include "flight_commander/compass_orientation.h"
#include "flight_commander/heading_fusion.h"
#include "io/gps.h"
#include "io/gps_dronecan.h"
#include "sensors/compass.h"
#include "sensors/sensors.h"

PG_REGISTER_WITH_RESET_FN(flightCommanderHeadingConfig_t, flightCommanderHeadingConfig,
    PG_FLIGHT_COMMANDER_HEADING_CONFIG, 0);

void pgResetFn_flightCommanderHeadingConfig(flightCommanderHeadingConfig_t *config)
{
    memset(config, 0, sizeof(*config));
    config->movingBaselineFixedOnly = true;
    config->movingBaselineProvider = FLIGHT_COMMANDER_BASELINE_AUTO;
    config->externalMagHardware = 1;
    config->sources[0] = (flightCommanderHeadingSourceConfig_t){ true, 1, 100, 0 };
    config->sources[1] = (flightCommanderHeadingSourceConfig_t){ false, 2, 0, 0 };
    config->sources[2] = (flightCommanderHeadingSourceConfig_t){ false, 3, 0, 0 };
    config->sources[3] = (flightCommanderHeadingSourceConfig_t){ false, 4, 0, 0 };
    config->expectedBaselineCm = 50;
    config->baselineToleranceCm = 20;
    config->maxHeadingAccuracyCentidegrees = 500;
    config->sourceTimeoutMs = 750;
    config->maxDisagreementCentidegrees = 4500;
    for (unsigned axis = 0; axis < 3; axis++) {
        config->externalMagGain[axis] = 1024;
    }
}

typedef struct headingSample_s {
    uint16_t headingCentidegrees;
    uint16_t accuracyCentidegrees;
    uint8_t quality;
    uint8_t nodeID;
    timeMs_t updatedAtMs;
    bool hasMeasurement;
    bool valid;
    bool fixed;
} headingSample_t;

static headingSample_t samples[FLIGHT_COMMANDER_HEADING_SOURCE_COUNT];
static fpVector3_t magneticFieldBody[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE];
static bool magneticFieldValid[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE];
static fpVector3_t correctedMagneticNorthEarth = { .v = { 1.0F, 0.0F, 0.0F } };
static flightCommanderHeadingStatus_t headingStatus;
static timeMs_t externalSampleProcessedAtMs;
static bool externalSampleProcessed;

#define FLIGHT_COMMANDER_MAG_CALIBRATION_MIN_SAMPLES 48U
#define FLIGHT_COMMANDER_MAG_CALIBRATION_MIN_AXIS_HALF_SPAN 10.0F
#define FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_GAIN_RATIO 2.5F
#define FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_ZERO_RATIO 4.0F
#define FLIGHT_COMMANDER_MAG_FIELD_NEARNESS 0.25F
// Match INAV's original soft magnetic-field weighting. A fresh, nonzero
// compass sample remains a usable heading source while its quality smoothly
// reduces its authority; only a rounded-zero quality is rejected outright.
// Keep displayed field quality honest while separating it from liveness.
// A fresh finite magnetic heading at Q0 remains available, but its correction
// authority is floored at only one percent so it cannot outweigh a better source.
#define FLIGHT_COMMANDER_MAG_FUSION_QUALITY_FLOOR 1U
#define FLIGHT_COMMANDER_STARTUP_STABLE_SAMPLE_COUNT 4U
#define FLIGHT_COMMANDER_STARTUP_MAX_STEP_CENTIDEGREES 500U

typedef struct customMagCalibration_s {
    fpVector3_t previous;
    fpVector3_t minimum;
    fpVector3_t maximum;
    uint32_t sampleCount;
    uint32_t lastSequence;
    uint8_t nodeID;
    bool enabled;
    bool previousValid;
    bool extremaValid;
} customMagCalibration_t;

static customMagCalibration_t customMagCalibration[FLIGHT_COMMANDER_HEADING_SOURCE_COUNT];
static fpVector3_t dronecanRawMilliGauss;
static uint32_t dronecanRawSequence;
static uint8_t dronecanRawNodeID;
static timeUs_t customMagCalibrationStartedAtUs;
static bool customMagCalibrationActive;
static uint8_t activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
static bool calibrationVectorIsPlausible(const int16_t zero[XYZ_AXIS_COUNT],
    const int16_t gain[XYZ_AXIS_COUNT]);
static uint16_t normalizeHeading(int32_t headingCentidegrees);

static bool magneticFieldToTrueHeading(const fpVector3_t *fieldBody,
    uint16_t *headingCentidegrees)
{
    if (!fieldBody || !headingCentidegrees ||
        !isfinite(fieldBody->x) || !isfinite(fieldBody->y) ||
        !isfinite(fieldBody->z)) {
        return false;
    }

    fpVector3_t fieldEarth;
    quaternionRotateVectorInv(&fieldEarth, fieldBody, &orientation);
    fieldEarth.z = 0.0F;
    const float horizontalNormSquared = vectorNormSquared(&fieldEarth);
    if (!isfinite(horizontalNormSquared) || horizontalNormSquared <= 0.01F) {
        return false;
    }
    vectorNormalize(&fieldEarth, &fieldEarth);

    // Use INAV's live declination vector and the exact measured-to-reference
    // correction sign used by its Mahony filter.  The live vector may be
    // updated by automatic GPS declination after startup.
    const float cross = fieldEarth.x * correctedMagneticNorthEarth.y -
        fieldEarth.y * correctedMagneticNorthEarth.x;
    const float dot = fieldEarth.x * correctedMagneticNorthEarth.x +
        fieldEarth.y * correctedMagneticNorthEarth.y;
    const int32_t estimatedMinusMeasuredCentidegrees = lrintf(
        atan2_approx(cross, dot) * (18000.0F / M_PIf));
    // fieldEarth was produced with the current attitude estimate, so the
    // measured-to-reference angle is (estimated yaw - true yaw).  Subtracting
    // it makes the reported source heading independent of the current AHRS
    // yaw.  Adding it would double the current yaw error and could make a good
    // compass disagree with moving-baseline heading while AHRS was converging.
    *headingCentidegrees = normalizeHeading(
        DECIDEGREES_TO_CENTIDEGREES(attitude.values.yaw) -
        estimatedMinusMeasuredCentidegrees);
    return true;
}

static uint16_t normalizeHeading(int32_t headingCentidegrees)
{
    headingCentidegrees %= 36000;
    if (headingCentidegrees < 0) {
        headingCentidegrees += 36000;
    }
    return headingCentidegrees;
}

static int16_t sourceAlignmentYawOffset(const flightCommanderHeadingConfig_t *config, unsigned index)
{
    return index == FLIGHT_COMMANDER_HEADING_MOVING_BASELINE
        ? config->sources[index].yawOffsetCentidegrees
        : 0;
}

static int16_t angularDifference(uint16_t left, uint16_t right)
{
    int32_t difference = (int32_t)left - right;
    while (difference > 18000) {
        difference -= 36000;
    }
    while (difference < -18000) {
        difference += 36000;
    }
    return difference;
}

static uint8_t accuracyToQuality(uint16_t accuracyCentidegrees)
{
    const uint16_t maximum = MAX(flightCommanderHeadingConfig()->maxHeadingAccuracyCentidegrees, 1U);
    if (accuracyCentidegrees >= maximum) {
        return 1;
    }
    return constrain(100U - ((uint32_t)accuracyCentidegrees * 99U / maximum), 1U, 100U);
}

static uint8_t magneticFieldQuality(const fpVector3_t *fieldBody)
{
    const float magnitude = fast_fsqrtf(vectorNormSquared(fieldBody));
    if (!isfinite(magnitude) || magnitude <= 0.0F) {
        return 0;
    }
    const float nearness = bellCurve(
        (magnitude - 1024.0F) / 1024.0F,
        FLIGHT_COMMANDER_MAG_FIELD_NEARNESS);
    return constrain(lrintf(nearness * 100.0F), 0, 100);
}

static uint8_t effectiveSourceQuality(unsigned index)
{
    if (index >= FLIGHT_COMMANDER_HEADING_SOURCE_COUNT) {
        return 0;
    }
    const uint8_t quality = samples[index].quality;
    return index < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE && samples[index].valid
        ? MAX(quality, FLIGHT_COMMANDER_MAG_FUSION_QUALITY_FLOOR)
        : quality;
}

static bool selectedNode(uint8_t configured, uint8_t source)
{
    return configured != DRONECAN_NODE_ID_DISABLED &&
        (configured == DRONECAN_NODE_ID_AUTO || configured == source);
}

static void updateLiveSourceStatus(unsigned index, timeMs_t now)
{
    flightCommanderHeadingSourceStatus_t *status = &headingStatus.sources[index];
    const headingSample_t *sample = &samples[index];
    const uint32_t age = sample->hasMeasurement ? now - sample->updatedAtMs : UINT32_MAX;
    status->headingCentidegrees = sample->headingCentidegrees;
    status->ageMs = age > UINT16_MAX ? UINT16_MAX : (uint16_t)age;
    status->quality = sample->quality;
    status->healthy = sample->valid && age <= flightCommanderHeadingConfig()->sourceTimeoutMs;
}

void flightCommanderHeadingInit(void)
{
    flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfigMutable();
    for (unsigned index = FLIGHT_COMMANDER_HEADING_ONBOARD_MAG;
        index < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE; index++) {
        config->sources[index].yawOffsetCentidegrees = 0;
    }
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        // Migrate the old 75/50/25 placeholder values. Disabled sources have no
        // contribution, so their saved/default weight is always represented as 0.
        if (!config->sources[index].enabled) {
            config->sources[index].weight = 0;
        }
    }
    memset(samples, 0, sizeof(samples));
    memset(magneticFieldBody, 0, sizeof(magneticFieldBody));
    memset(magneticFieldValid, 0, sizeof(magneticFieldValid));
    memset(&headingStatus, 0, sizeof(headingStatus));
    externalSampleProcessedAtMs = 0;
    externalSampleProcessed = false;
    memset(customMagCalibration, 0, sizeof(customMagCalibration));
    vectorZero(&dronecanRawMilliGauss);
    dronecanRawSequence = 0;
    dronecanRawNodeID = DRONECAN_NODE_ID_DISABLED;
    customMagCalibrationStartedAtUs = 0;
    customMagCalibrationActive = false;
    activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
    headingStatus.anchorSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
    headingStatus.baselineNodeID = DRONECAN_NODE_ID_DISABLED;

    flightCommanderExternalCompassInit();
}

void flightCommanderHeadingSetMagneticNorth(const fpVector3_t *magneticNorthEarth)
{
    if (!magneticNorthEarth || vectorNormSquared(magneticNorthEarth) <= 0.01F) {
        return;
    }
    correctedMagneticNorthEarth = *magneticNorthEarth;
    correctedMagneticNorthEarth.z = 0.0F;
    vectorNormalize(&correctedMagneticNorthEarth, &correctedMagneticNorthEarth);
}

static bool externalMagIsCalibrated(const flightCommanderHeadingConfig_t *config)
{
    bool adjusted = false;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        if (config->externalMagZero[axis] != 0 || config->externalMagGain[axis] != 1024) {
            adjusted = true;
        }
    }
    return adjusted && calibrationVectorIsPlausible(config->externalMagZero, config->externalMagGain);
}

static bool dronecanMagIsCalibrated(const flightCommanderHeadingConfig_t *config)
{
    if (config->dronecanMagCalibrationNodeID == 0) {
        return false;
    }
    uint16_t minimumGain = UINT16_MAX;
    uint16_t maximumGain = 0;
    int32_t maximumZero = 0;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        const uint16_t gain = config->dronecanMagGainMilliGauss[axis];
        if (gain == 0 || gain > 5000) {
            return false;
        }
        minimumGain = MIN(minimumGain, gain);
        maximumGain = MAX(maximumGain, gain);
        maximumZero = MAX(maximumZero, ABS((int32_t)config->dronecanMagZeroMilliGauss[axis]));
    }
    return maximumGain <= minimumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_GAIN_RATIO &&
        maximumZero <= maximumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_ZERO_RATIO;
}

static bool calibrationVectorIsPlausible(const int16_t zero[XYZ_AXIS_COUNT],
    const int16_t gain[XYZ_AXIS_COUNT])
{
    int16_t minimumGain = INT16_MAX;
    int16_t maximumGain = 0;
    int32_t maximumZero = 0;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        if (gain[axis] <= 0) {
            return false;
        }
        minimumGain = MIN(minimumGain, gain[axis]);
        maximumGain = MAX(maximumGain, gain[axis]);
        maximumZero = MAX(maximumZero, ABS((int32_t)zero[axis]));
    }
    return maximumGain <= minimumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_GAIN_RATIO &&
        maximumZero <= maximumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_ZERO_RATIO;
}

static bool onboardMagIsCalibrated(void)
{
    const compassConfig_t *config = compassConfig();
    const bool adjusted = config->magZero.raw[X] != 0 || config->magZero.raw[Y] != 0 ||
        config->magZero.raw[Z] != 0 || config->magGain[X] != 1024 ||
        config->magGain[Y] != 1024 || config->magGain[Z] != 1024;
    // The official INAV compass task owns the onboard calibration result.
    // Flight Commander reports that state without applying a second solver or
    // rejecting values that INAV has already accepted.
    return adjusted && compassIsCalibrationComplete();
}

static bool headingSourceOrientationIsValid(unsigned index)
{
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    if (index <= FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {
        return flightCommanderCompassOrientationIsValid(index);
    }
#else
    UNUSED(index);
#endif
    return true;
}

static bool headingSourceIsCalibrated(unsigned index, const flightCommanderHeadingConfig_t *config)
{
    switch (index) {
    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:
        return onboardMagIsCalibrated();
    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:
        return headingSourceOrientationIsValid(index) && externalMagIsCalibrated(config);
    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:
        return headingSourceOrientationIsValid(index) && dronecanMagIsCalibrated(config) &&
            (!samples[index].valid || samples[index].nodeID == config->dronecanMagCalibrationNodeID);
    case FLIGHT_COMMANDER_HEADING_MOVING_BASELINE:
        return samples[index].valid;
    default:
        return false;
    }
}

bool flightCommanderHeadingCompassSourcePresent(uint8_t source)
{
    switch (source) {
    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:
        return sensors(SENSOR_MAG);
    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:
        return flightCommanderExternalCompassIsConfigured() &&
            flightCommanderExternalCompassIsDetected();
    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:
        return flightCommanderHeadingConfig()->sources[source].enabled &&
            dronecanRawSequence != 0 &&
            flightCommanderHeadingCompassNodeID(source) != 0;
    default:
        return false;
    }
}

uint8_t flightCommanderHeadingCompassNodeID(uint8_t source)
{
    if (source != FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {
        return 0;
    }
    if (dronecanRawNodeID != DRONECAN_NODE_ID_DISABLED && dronecanRawNodeID != 0) {
        return dronecanRawNodeID;
    }
    if (flightCommanderHeadingConfig()->dronecanMagCalibrationNodeID != 0) {
        return flightCommanderHeadingConfig()->dronecanMagCalibrationNodeID;
    }
    const uint8_t configured = dronecanConfig()->magNodeID;
    return configured > 0 && configured <= 127 ? configured : 0;
}

bool flightCommanderHeadingCompassFieldCalibrated(uint8_t source)
{
    if (!headingSourceOrientationIsValid(source)) {
        return false;
    }
    switch (source) {
    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:
        return onboardMagIsCalibrated();
    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:
        return externalMagIsCalibrated(flightCommanderHeadingConfig());
    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:
        return dronecanMagIsCalibrated(flightCommanderHeadingConfig());
    default:
        return false;
    }
}

void flightCommanderHeadingInvalidateCompassFieldCalibration(uint8_t source)
{
    flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfigMutable();
    if (source == FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG) {
        for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            config->externalMagZero[axis] = 0;
            config->externalMagGain[axis] = 1024;
        }
    } else if (source == FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {
        for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            config->dronecanMagZeroMilliGauss[axis] = 0;
            config->dronecanMagGainMilliGauss[axis] = 0;
        }
        config->dronecanMagCalibrationNodeID = 0;
    } else {
        return;
    }
    headingStatus.calibratedMask &= ~(1U << source);
    headingStatus.calibratingMask &= ~(1U << source);
    headingStatus.calibrationFailedMask &= ~(1U << source);
}

static void resetCustomCalibrationContext(customMagCalibration_t *context)
{
    memset(context, 0, sizeof(*context));
}

static void pushCustomMagCalibrationSample(customMagCalibration_t *context,
    const fpVector3_t *sample)
{
    if (!context->extremaValid) {
        context->minimum = *sample;
        context->maximum = *sample;
        context->extremaValid = true;
    } else {
        for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            context->minimum.v[axis] = MIN(context->minimum.v[axis], sample->v[axis]);
            context->maximum.v[axis] = MAX(context->maximum.v[axis], sample->v[axis]);
        }
    }
    if (!context->previousValid) {
        context->previous = *sample;
        context->previousValid = true;
        return;
    }

    float differenceMagnitudeSquared = 0.0F;
    float averageMagnitudeSquared = 0.0F;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        const float difference = sample->v[axis] - context->previous.v[axis];
        const float average = (sample->v[axis] + context->previous.v[axis]) * 0.5F;
        differenceMagnitudeSquared += difference * difference;
        averageMagnitudeSquared += average * average;
    }
    if (averageMagnitudeSquared > 0.01F &&
        differenceMagnitudeSquared / averageMagnitudeSquared > sq(0.14F)) {
        context->previous = *sample;
        context->sampleCount++;
    }
}

static bool solveCustomMagCalibration(customMagCalibration_t *context,
    float zero[XYZ_AXIS_COUNT],
    float gain[XYZ_AXIS_COUNT])
{
    if (!context->enabled || !context->extremaValid ||
        context->sampleCount < FLIGHT_COMMANDER_MAG_CALIBRATION_MIN_SAMPLES) {
        return false;
    }
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        const float span = context->maximum.v[axis] - context->minimum.v[axis];
        zero[axis] = (context->maximum.v[axis] + context->minimum.v[axis]) * 0.5F;
        gain[axis] = span * 0.5F;
        if (!isfinite(zero[axis]) || !isfinite(gain[axis]) ||
            gain[axis] < FLIGHT_COMMANDER_MAG_CALIBRATION_MIN_AXIS_HALF_SPAN) {
            return false;
        }
    }
    const float minimumGain = MIN(gain[X], MIN(gain[Y], gain[Z]));
    const float maximumGain = MAX(gain[X], MAX(gain[Y], gain[Z]));
    const float maximumZero = MAX(fabsf(zero[X]), MAX(fabsf(zero[Y]), fabsf(zero[Z])));
    if (maximumGain > minimumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_GAIN_RATIO ||
        maximumZero > maximumGain * FLIGHT_COMMANDER_MAG_CALIBRATION_MAX_ZERO_RATIO) {
        return false;
    }
    return true;
}

static bool prepareCustomCalibration(uint8_t source, timeUs_t currentTimeUs)
{
    customMagCalibration_t *context = &customMagCalibration[source];
    resetCustomCalibrationContext(context);
    context->enabled = true;

    if (source == FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG) {
        fpVector3_t raw;
        timeMs_t updatedAtMs;
        if (flightCommanderExternalCompassGetSample(&raw, &updatedAtMs)) {
            context->lastSequence = updatedAtMs;
        }
    } else if (source == FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {
        context->lastSequence = dronecanRawSequence;
        context->nodeID = flightCommanderHeadingCompassNodeID(source);
        if (context->nodeID == 0) {
            return false;
        }
    } else {
        return false;
    }

    customMagCalibrationStartedAtUs = currentTimeUs;
    customMagCalibrationActive = true;
    activeFieldCalibrationSource = source;
    headingStatus.calibratingMask |= 1U << source;
    return true;
}

bool flightCommanderHeadingStartCompassFieldCalibration(uint8_t source)
{
    if (ARMING_FLAG(ARMED) || source >= FLIGHT_COMMANDER_HEADING_MOVING_BASELINE ||
        activeFieldCalibrationSource != FLIGHT_COMMANDER_HEADING_SOURCE_NONE ||
        !flightCommanderHeadingCompassSourcePresent(source)) {
        return false;
    }
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    if (!flightCommanderCompassOrientationIsValid(source)) {
        return false;
    }
#endif

    headingStatus.calibrationFailedMask &= ~(1U << source);
    headingStatus.calibratingMask &= ~(1U << source);
    activeFieldCalibrationSource = source;
    if (source == FLIGHT_COMMANDER_HEADING_ONBOARD_MAG) {
        headingStatus.calibratingMask |= 1U << source;
        ENABLE_STATE(CALIBRATE_MAG);
        return true;
    }
    if (!prepareCustomCalibration(source, micros())) {
        activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
        headingStatus.calibrationFailedMask |= 1U << source;
        return false;
    }
    return true;
}

bool flightCommanderHeadingReadCompassCalibrationCommand(sbuf_t *src)
{
    if (sbufBytesRemaining(src) !=
            FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND_PAYLOAD_SIZE ||
        sbufReadU8(src) != FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND_SCHEMA) {
        return false;
    }
    const uint8_t command = sbufReadU8(src);
    const uint8_t source = sbufReadU8(src);
    (void)sbufReadU8(src);
    return command == FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND_START &&
        flightCommanderHeadingStartCompassFieldCalibration(source);
}

void flightCommanderHeadingOnboardCalibrationStarted(void)
{
    if (activeFieldCalibrationSource == FLIGHT_COMMANDER_HEADING_ONBOARD_MAG) {
        headingStatus.calibratingMask |= 1U << FLIGHT_COMMANDER_HEADING_ONBOARD_MAG;
    }
}

void flightCommanderHeadingOnboardCalibrationFinished(bool success)
{
    if (activeFieldCalibrationSource != FLIGHT_COMMANDER_HEADING_ONBOARD_MAG) {
        return;
    }
    headingStatus.calibratingMask &= ~(1U << FLIGHT_COMMANDER_HEADING_ONBOARD_MAG);
    if (success) {
        headingStatus.calibrationFailedMask &= ~(1U << FLIGHT_COMMANDER_HEADING_ONBOARD_MAG);
    } else {
        headingStatus.calibrationFailedMask |= 1U << FLIGHT_COMMANDER_HEADING_ONBOARD_MAG;
    }
    activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
}

static void finishCustomMagCalibration(void)
{
    const uint8_t source = activeFieldCalibrationSource;
    flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfigMutable();
    customMagCalibration_t *context = source < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE
        ? &customMagCalibration[source]
        : NULL;
    float zero[XYZ_AXIS_COUNT];
    float gain[XYZ_AXIS_COUNT];
    bool valid = context && solveCustomMagCalibration(context, zero, gain);

    if (source == FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG) {
        for (unsigned axis = 0; valid && axis < XYZ_AXIS_COUNT; axis++) {
            valid = zero[axis] >= INT16_MIN && zero[axis] <= INT16_MAX &&
                gain[axis] <= INT16_MAX;
        }
        if (valid) {
            for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                config->externalMagZero[axis] = lrintf(zero[axis]);
                config->externalMagGain[axis] = lrintf(gain[axis]);
            }
        }
    } else if (source == FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {
        valid = valid && context->nodeID != 0;
        for (unsigned axis = 0; valid && axis < XYZ_AXIS_COUNT; axis++) {
            valid = zero[axis] >= INT16_MIN && zero[axis] <= INT16_MAX &&
                gain[axis] <= 5000.0F;
        }
        if (valid) {
            config->dronecanMagCalibrationNodeID = context->nodeID;
            for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                config->dronecanMagZeroMilliGauss[axis] = lrintf(zero[axis]);
                config->dronecanMagGainMilliGauss[axis] = lrintf(gain[axis]);
            }
        }
    } else {
        valid = false;
    }

    if (!valid && source < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE) {
        headingStatus.calibrationFailedMask |= 1U << source;
    } else if (valid) {
        headingStatus.calibrationFailedMask &= ~(1U << source);
    }
    if (source < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE) {
        headingStatus.calibratingMask &= ~(1U << source);
    }
    memset(customMagCalibration, 0, sizeof(customMagCalibration));
    customMagCalibrationActive = false;
    customMagCalibrationStartedAtUs = 0;
    activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
    saveConfigAndNotify();
}

static fpVector3_t orientedCalibrationSample(uint8_t source, const fpVector3_t *raw)
{
    float values[XYZ_AXIS_COUNT] = { raw->x, raw->y, raw->z };
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    flightCommanderCompassOrientationApply(source, values);
#endif
    return (fpVector3_t){ .v = { values[X], values[Y], values[Z] } };
}

void flightCommanderHeadingCalibrationUpdate(timeUs_t currentTimeUs)
{
    if (!customMagCalibrationActive ||
        activeFieldCalibrationSource >= FLIGHT_COMMANDER_HEADING_MOVING_BASELINE) {
        return;
    }

    customMagCalibration_t *context =
        &customMagCalibration[activeFieldCalibrationSource];
    if (activeFieldCalibrationSource == FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG) {
        fpVector3_t raw;
        timeMs_t updatedAtMs;
        if (flightCommanderExternalCompassGetSample(&raw, &updatedAtMs) &&
            updatedAtMs != context->lastSequence) {
            context->lastSequence = updatedAtMs;
            const fpVector3_t oriented = orientedCalibrationSample(
                activeFieldCalibrationSource, &raw);
            pushCustomMagCalibrationSample(context, &oriented);
        }
    } else if (activeFieldCalibrationSource == FLIGHT_COMMANDER_HEADING_DRONECAN_MAG &&
        dronecanRawSequence != context->lastSequence &&
        dronecanRawNodeID == context->nodeID) {
        context->lastSequence = dronecanRawSequence;
        pushCustomMagCalibrationSample(context, &dronecanRawMilliGauss);
    }

    const timeUs_t durationUs =
        (timeUs_t)compassConfig()->magCalibrationTimeLimit * 1000000U;
    if (currentTimeUs - customMagCalibrationStartedAtUs >= durationUs) {
        finishCustomMagCalibration();
    }
}

static void updateExternalCompassSample(void)
{
    fpVector3_t raw;
    timeMs_t updatedAtMs;
    if (!flightCommanderExternalCompassGetSample(&raw, &updatedAtMs) ||
        (externalSampleProcessed && updatedAtMs == externalSampleProcessedAtMs)) {
        return;
    }
    externalSampleProcessed = true;
    externalSampleProcessedAtMs = updatedAtMs;

    float native[XYZ_AXIS_COUNT] = { raw.x, raw.y, raw.z };
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    flightCommanderCompassOrientationObserve(
        micros(), FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG, native);
    flightCommanderCompassOrientationApply(
        FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG, native);
#endif

    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    fpVector3_t corrected;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        corrected.v[axis] = (native[axis] - config->externalMagZero[axis]) *
            1024.0F / config->externalMagGain[axis];
    }

    const fp_angles_t alignmentAngles = {
        .angles = {
            .roll = DECIDEGREES_TO_RADIANS(config->externalMagAlignmentDecidegrees[0]),
            .pitch = DECIDEGREES_TO_RADIANS(config->externalMagAlignmentDecidegrees[1]),
            .yaw = DECIDEGREES_TO_RADIANS(config->externalMagAlignmentDecidegrees[2]),
        }
    };
    fpMat3_t alignment;
    fpVector3_t aligned;
    rotationMatrixFromAngles(&alignment, &alignmentAngles);
    rotationMatrixRotateVector(&aligned, &corrected, &alignment);

    headingSample_t *sample = &samples[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG];
    magneticFieldBody[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG] = aligned;
    sample->quality = magneticFieldQuality(&aligned);
    magneticFieldValid[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG] =
        magneticFieldToTrueHeading(&aligned, &sample->headingCentidegrees);
    sample->accuracyCentidegrees = 0;
    sample->nodeID = DRONECAN_NODE_ID_DISABLED;
    sample->updatedAtMs = updatedAtMs;
    sample->hasMeasurement = true;
    sample->valid = magneticFieldValid[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG];
}

void flightCommanderHeadingUpdate(void)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    const timeMs_t now = millis();
    headingStatus.healthyMask = 0;
    headingStatus.activeMask = 0;
    headingStatus.rejectedMask = 0;
    headingStatus.anchorSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;

    headingSample_t *onboard = &samples[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG];
    magneticFieldBody[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG] = (fpVector3_t){
        .v = { mag.magADC[X], mag.magADC[Y], mag.magADC[Z] }
    };
    const uint16_t onboardAgeMs = compassGetSampleAgeMs();
    onboard->hasMeasurement = onboardAgeMs != UINT16_MAX;
    onboard->updatedAtMs = now - (onboard->hasMeasurement ? onboardAgeMs : 0U);
    onboard->quality = magneticFieldQuality(
        &magneticFieldBody[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG]);
    magneticFieldValid[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG] = compassIsHealthy() &&
        magneticFieldToTrueHeading(
            &magneticFieldBody[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG],
            &onboard->headingCentidegrees);
    onboard->valid = magneticFieldValid[FLIGHT_COMMANDER_HEADING_ONBOARD_MAG];

    updateExternalCompassSample();

    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        updateLiveSourceStatus(index, now);
        if (headingStatus.sources[index].healthy) {
            headingStatus.healthyMask |= 1U << index;
        }
    }

    headingStatus.calibratedMask = 0;
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        if (headingSourceIsCalibrated(index, config)) {
            headingStatus.calibratedMask |= 1U << index;
        }
    }

    unsigned anchor = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
    uint8_t anchorPriority = UINT8_MAX;
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        if (config->sources[index].enabled && config->sources[index].weight &&
            (headingStatus.calibratedMask & (1U << index)) &&
            headingStatus.sources[index].healthy && config->sources[index].priority < anchorPriority) {
            anchor = index;
            anchorPriority = config->sources[index].priority;
        }
    }

    if (anchor != FLIGHT_COMMANDER_HEADING_SOURCE_NONE) {
        headingStatus.anchorSource = anchor;
        const uint16_t anchorHeading = normalizeHeading(
            headingStatus.sources[anchor].headingCentidegrees + sourceAlignmentYawOffset(config, anchor));
        float sine = 0.0F;
        float cosine = 0.0F;
        for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
            if (!config->sources[index].enabled || !config->sources[index].weight ||
                !(headingStatus.calibratedMask & (1U << index)) ||
                !headingStatus.sources[index].healthy) {
                continue;
            }
            const uint16_t corrected = normalizeHeading(
                headingStatus.sources[index].headingCentidegrees + sourceAlignmentYawOffset(config, index));
            if (ABS(angularDifference(corrected, anchorHeading)) > config->maxDisagreementCentidegrees) {
                headingStatus.rejectedMask |= 1U << index;
                continue;
            }
            const float radians = corrected * (M_PIf / 18000.0F);
            const float weight = config->sources[index].weight * effectiveSourceQuality(index) / 100.0F;
            sine += sin_approx(radians) * weight;
            cosine += cos_approx(radians) * weight;
            headingStatus.activeMask |= 1U << index;
        }
        if (headingStatus.activeMask) {
            float fused = atan2_approx(sine, cosine) * (18000.0F / M_PIf);
            headingStatus.fusedHeadingCentidegrees = normalizeHeading(lrintf(fused));
        }
    }

}

static bool validateConfig(const flightCommanderHeadingConfig_t *config)
{
    if (config->movingBaselineProvider > FLIGHT_COMMANDER_BASELINE_DRONECAN ||
        !flightCommanderExternalCompassHardwareSupported(config->externalMagHardware) ||
        config->expectedBaselineCm < 30 || config->baselineToleranceCm == 0 ||
        config->baselineToleranceCm >= config->expectedBaselineCm ||
        config->sourceTimeoutMs < 100 || config->sourceTimeoutMs > 5000 ||
        config->maxDisagreementCentidegrees < 500 || config->maxDisagreementCentidegrees > 9000 ||
        config->maxHeadingAccuracyCentidegrees < 10 || config->maxHeadingAccuracyCentidegrees > 4500) {
        return false;
    }

    uint8_t priorities = 0;
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        const flightCommanderHeadingSourceConfig_t *source = &config->sources[index];
        if (source->priority < 1 || source->priority > FLIGHT_COMMANDER_HEADING_SOURCE_COUNT ||
            source->weight > 100 || source->yawOffsetCentidegrees < -18000 ||
            source->yawOffsetCentidegrees > 18000) {
            return false;
        }
        if (source->enabled && source->weight) {
            if (priorities & (1U << source->priority)) {
                return false;
            }
            priorities |= 1U << source->priority;
        }
    }
    if (config->movingBaselineEnabled != config->sources[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE].enabled) {
        return false;
    }
    if (config->sources[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG].enabled &&
        config->externalMagHardware == MAG_NONE) {
        return false;
    }
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        if (config->externalMagGain[axis] <= 0) {
            return false;
        }
    }
    if (config->sources[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG].enabled &&
        dronecanConfig()->magNodeID == DRONECAN_NODE_ID_DISABLED) {
        return false;
    }
    if (config->movingBaselineEnabled && config->movingBaselineProvider == FLIGHT_COMMANDER_BASELINE_DRONECAN &&
        dronecanConfig()->movingRoverNodeID == DRONECAN_NODE_ID_DISABLED) {
        return false;
    }
    return true;
}

void flightCommanderHeadingWriteConfig(sbuf_t *dst)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    sbufWriteU8(dst, FLIGHT_COMMANDER_HEADING_CONFIG_SCHEMA);
    sbufWriteU8(dst, (config->movingBaselineEnabled ? 1U : 0U) | (config->movingBaselineFixedOnly ? 2U : 0U));
    sbufWriteU8(dst, config->movingBaselineProvider);
    sbufWriteU8(dst, config->externalMagHardware);
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        sbufWriteU8(dst, config->sources[index].enabled);
        sbufWriteU8(dst, config->sources[index].priority);
        sbufWriteU8(dst, config->sources[index].weight);
        sbufWriteU16(dst, sourceAlignmentYawOffset(config, index));
    }
    sbufWriteU16(dst, config->expectedBaselineCm);
    sbufWriteU16(dst, config->baselineToleranceCm);
    sbufWriteU16(dst, config->maxHeadingAccuracyCentidegrees);
    sbufWriteU16(dst, config->sourceTimeoutMs);
    sbufWriteU16(dst, config->maxDisagreementCentidegrees);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->externalMagAlignmentDecidegrees[axis]);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->externalMagZero[axis]);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->externalMagGain[axis]);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->dronecanMagAlignmentDecidegrees[axis]);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->dronecanMagZeroMilliGauss[axis]);
    for (unsigned axis = 0; axis < 3; axis++) sbufWriteU16(dst, config->dronecanMagGainMilliGauss[axis]);
    sbufWriteU8(dst, config->dronecanMagCalibrationNodeID);
}

bool flightCommanderHeadingReadConfig(sbuf_t *src)
{
    if (sbufBytesRemaining(src) != FLIGHT_COMMANDER_HEADING_CONFIG_PAYLOAD_SIZE ||
        sbufReadU8(src) != FLIGHT_COMMANDER_HEADING_CONFIG_SCHEMA) {
        return false;
    }
    flightCommanderHeadingConfig_t value = *flightCommanderHeadingConfig();
    const uint8_t flags = sbufReadU8(src);
    value.movingBaselineEnabled = flags & 1U;
    value.movingBaselineFixedOnly = (flags >> 1) & 1U;
    value.movingBaselineProvider = sbufReadU8(src);
    value.externalMagHardware = sbufReadU8(src);
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        value.sources[index].enabled = sbufReadU8(src);
        value.sources[index].priority = sbufReadU8(src);
        value.sources[index].weight = sbufReadU8(src);
        if (!value.sources[index].enabled) {
            value.sources[index].weight = 0;
        }
        value.sources[index].yawOffsetCentidegrees = sbufReadU16(src);
    }
    for (unsigned index = FLIGHT_COMMANDER_HEADING_ONBOARD_MAG;
        index < FLIGHT_COMMANDER_HEADING_MOVING_BASELINE; index++) {
        value.sources[index].yawOffsetCentidegrees = 0;
    }
    value.expectedBaselineCm = sbufReadU16(src);
    value.baselineToleranceCm = sbufReadU16(src);
    value.maxHeadingAccuracyCentidegrees = sbufReadU16(src);
    value.sourceTimeoutMs = sbufReadU16(src);
    value.maxDisagreementCentidegrees = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.externalMagAlignmentDecidegrees[axis] = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.externalMagZero[axis] = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.externalMagGain[axis] = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.dronecanMagAlignmentDecidegrees[axis] = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.dronecanMagZeroMilliGauss[axis] = sbufReadU16(src);
    for (unsigned axis = 0; axis < 3; axis++) value.dronecanMagGainMilliGauss[axis] = sbufReadU16(src);
    value.dronecanMagCalibrationNodeID = sbufReadU8(src);
    if (!validateConfig(&value)) {
        return false;
    }
    *flightCommanderHeadingConfigMutable() = value;
    return true;
}

void flightCommanderHeadingWriteStatus(sbuf_t *dst)
{
    flightCommanderHeadingUpdate();
    sbufWriteU8(dst, FLIGHT_COMMANDER_HEADING_STATUS_SCHEMA);
    sbufWriteU8(dst, headingStatus.healthyMask);
    sbufWriteU8(dst, headingStatus.activeMask);
    sbufWriteU8(dst, headingStatus.rejectedMask);
    sbufWriteU8(dst, headingStatus.anchorSource);
    sbufWriteU8(dst, headingStatus.baselineProvider);
    sbufWriteU8(dst, headingStatus.baselineFixed);
    sbufWriteU8(dst, headingStatus.baselineNodeID);
    sbufWriteU16(dst, headingStatus.fusedHeadingCentidegrees);
    sbufWriteU16(dst, headingStatus.baselineHeadingCentidegrees);
    sbufWriteU16(dst, headingStatus.baselineDistanceCm);
    sbufWriteU16(dst, headingStatus.baselineAccuracyCentidegrees);
    sbufWriteU8(dst, headingStatus.calibratedMask);
    sbufWriteU8(dst, headingStatus.calibratingMask);
    sbufWriteU8(dst, headingStatus.calibrationFailedMask);
    for (unsigned index = 0; index < FLIGHT_COMMANDER_HEADING_SOURCE_COUNT; index++) {
        sbufWriteU16(dst, headingStatus.sources[index].headingCentidegrees);
        sbufWriteU16(dst, headingStatus.sources[index].ageMs);
        sbufWriteU8(dst, headingStatus.sources[index].quality);
    }
}

static float activeSourceWeight(unsigned source)
{
    if (source >= FLIGHT_COMMANDER_HEADING_SOURCE_COUNT ||
        !(headingStatus.activeMask & (1U << source))) {
        return 0.0F;
    }
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    return constrainf(
        config->sources[source].weight * effectiveSourceQuality(source) / 10000.0F,
        0.0F,
        1.0F);
}

float flightCommanderHeadingGetOnboardMagWeight(void)
{
    return activeSourceWeight(FLIGHT_COMMANDER_HEADING_ONBOARD_MAG);
}

bool flightCommanderHeadingGetMagSource(
    flightCommanderHeadingSource_e source,
    fpVector3_t *fieldBody,
    float *weight)
{
    if (source >= FLIGHT_COMMANDER_HEADING_MOVING_BASELINE ||
        !magneticFieldValid[source]) {
        return false;
    }
    const float sourceWeight = activeSourceWeight(source);
    if (sourceWeight <= 0.0F) {
        return false;
    }
    *fieldBody = magneticFieldBody[source];
    *weight = sourceWeight;
    return true;
}

bool flightCommanderHeadingGetAbsoluteReference(fpVector3_t *headingEarth, float *weight)
{
    const float sourceWeight = activeSourceWeight(FLIGHT_COMMANDER_HEADING_MOVING_BASELINE);
    if (sourceWeight <= 0.0F) {
        return false;
    }
    const float headingRadians = normalizeHeading(
        samples[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE].headingCentidegrees +
        sourceAlignmentYawOffset(
            flightCommanderHeadingConfig(), FLIGHT_COMMANDER_HEADING_MOVING_BASELINE)) *
        (M_PIf / 18000.0F);
    // quaternionRotateVectorInv() represents a positive INAV yaw as
    // (cos(yaw), -sin(yaw)) in the earth frame.  Build the GNSS reference in
    // that same frame.  Negating this vector points exactly 180 degrees away
    // from the reported Base-to-Rover heading.
    headingEarth->x = cos_approx(headingRadians);
    headingEarth->y = -sin_approx(headingRadians);
    headingEarth->z = 0.0F;
    *weight = sourceWeight;
    return true;
}

bool flightCommanderHeadingGetFusedHeading(uint16_t *headingCentidegrees)
{
    typedef struct startupHeadingState_s {
        uint16_t candidateHeadingCentidegrees;
        timeMs_t sampleUpdatedAtMs;
        uint8_t source;
        uint8_t stableSampleCount;
        bool hasCandidate;
    } startupHeadingState_t;
    static startupHeadingState_t startup = {
        .source = FLIGHT_COMMANDER_HEADING_SOURCE_NONE,
    };

    // Startup initialization must work without an MSP client polling status.
    flightCommanderHeadingUpdate();

    if (!headingCentidegrees || headingStatus.activeMask == 0 ||
        headingStatus.anchorSource >= FLIGHT_COMMANDER_HEADING_SOURCE_COUNT) {
        startup.source = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
        startup.stableSampleCount = 0;
        startup.hasCandidate = false;
        return false;
    }

    const unsigned anchor = headingStatus.anchorSource;
    const headingSample_t *sample = &samples[anchor];
    if (!sample->hasMeasurement || !sample->valid ||
        !headingStatus.sources[anchor].healthy) {
        startup.source = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;
        startup.stableSampleCount = 0;
        startup.hasCandidate = false;
        return false;
    }

    const uint16_t fused = headingStatus.fusedHeadingCentidegrees;
    if (startup.hasCandidate && startup.source == anchor &&
        startup.sampleUpdatedAtMs == sample->updatedAtMs) {
        if (startup.stableSampleCount >= FLIGHT_COMMANDER_STARTUP_STABLE_SAMPLE_COUNT) {
            *headingCentidegrees = fused;
            return true;
        }
        return false;
    }

    if (startup.hasCandidate && startup.source == anchor &&
        ABS(angularDifference(fused, startup.candidateHeadingCentidegrees)) <=
            FLIGHT_COMMANDER_STARTUP_MAX_STEP_CENTIDEGREES) {
        startup.stableSampleCount = MIN(
            startup.stableSampleCount + 1U,
            FLIGHT_COMMANDER_STARTUP_STABLE_SAMPLE_COUNT);
    } else {
        startup.stableSampleCount = 1;
    }
    startup.candidateHeadingCentidegrees = fused;
    startup.sampleUpdatedAtMs = sample->updatedAtMs;
    startup.source = anchor;
    startup.hasCandidate = true;

    if (startup.stableSampleCount < FLIGHT_COMMANDER_STARTUP_STABLE_SAMPLE_COUNT) {
        return false;
    }

    *headingCentidegrees = fused;
    return true;
}

bool flightCommanderHeadingHasActiveReference(void)
{
    return headingStatus.activeMask != 0;
}

const flightCommanderHeadingStatus_t *flightCommanderHeadingGetStatus(void)
{
    flightCommanderHeadingUpdate();
    return &headingStatus;
}

void flightCommanderHeadingReceiveDronecanMag(
    uint8_t sourceNodeID,
    const struct uavcan_equipment_ahrs_MagneticFieldStrength2 *message)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    if (!selectedNode(dronecanConfig()->magNodeID, sourceNodeID)) {
        return;
    }
    customMagCalibration_t *calibration =
        &customMagCalibration[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG];
    if (customMagCalibrationActive && calibration->enabled) {
        if (calibration->nodeID == 0) {
            calibration->nodeID = sourceNodeID;
        }
        if (calibration->nodeID != sourceNodeID) {
            return;
        }
    } else if (config->dronecanMagCalibrationNodeID != 0 &&
        config->dronecanMagCalibrationNodeID != sourceNodeID) {
        return;
    }

    float native[XYZ_AXIS_COUNT];
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        native[axis] = message->magnetic_field_ga[axis] * 1000.0F;
    }
    dronecanRawNodeID = sourceNodeID;
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    flightCommanderCompassOrientationObserve(
        micros(), FLIGHT_COMMANDER_HEADING_DRONECAN_MAG, native);
    flightCommanderCompassOrientationApply(
        FLIGHT_COMMANDER_HEADING_DRONECAN_MAG, native);
#endif

    fpVector3_t corrected;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        dronecanRawMilliGauss.v[axis] = native[axis];
        corrected.v[axis] = dronecanRawMilliGauss.v[axis] -
            config->dronecanMagZeroMilliGauss[axis];
        if (config->dronecanMagGainMilliGauss[axis]) {
            corrected.v[axis] *= 1000.0F /
                config->dronecanMagGainMilliGauss[axis];
        }
    }
    dronecanRawSequence++;

    const fp_angles_t alignmentAngles = {
        .angles = {
            .roll = DECIDEGREES_TO_RADIANS(config->dronecanMagAlignmentDecidegrees[0]),
            .pitch = DECIDEGREES_TO_RADIANS(config->dronecanMagAlignmentDecidegrees[1]),
            .yaw = DECIDEGREES_TO_RADIANS(config->dronecanMagAlignmentDecidegrees[2]),
        }
    };
    fpMat3_t alignment;
    fpVector3_t aligned;
    rotationMatrixFromAngles(&alignment, &alignmentAngles);
    rotationMatrixRotateVector(&aligned, &corrected, &alignment);

    headingSample_t *sample = &samples[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG];
    magneticFieldBody[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG] = aligned;
    sample->quality = magneticFieldQuality(&aligned);
    magneticFieldValid[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG] =
        magneticFieldToTrueHeading(&aligned, &sample->headingCentidegrees);
    sample->accuracyCentidegrees = 0;
    sample->nodeID = sourceNodeID;
    sample->updatedAtMs = millis();
    sample->hasMeasurement = true;
    sample->valid = magneticFieldValid[FLIGHT_COMMANDER_HEADING_DRONECAN_MAG];
}

static bool baselineProviderEnabled(uint8_t provider)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    return config->movingBaselineEnabled &&
        config->sources[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE].enabled &&
        (config->movingBaselineProvider == FLIGHT_COMMANDER_BASELINE_AUTO ||
            config->movingBaselineProvider == provider);
}

static void receiveBaseline(uint8_t provider, uint8_t sourceNodeID, float headingDegrees,
    float accuracyDegrees, bool accuracyValid, float distanceMeters,
    bool fixedSolution, bool fixedStatusKnown)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    headingSample_t *sample = &samples[FLIGHT_COMMANDER_HEADING_MOVING_BASELINE];
    headingSample_t candidate = { 0 };
    candidate.headingCentidegrees = normalizeHeading(lrintf(headingDegrees * 100.0F));
    candidate.accuracyCentidegrees = accuracyValid
        ? constrain(lrintf(fabsf(accuracyDegrees) * 100.0F), 0, UINT16_MAX)
        : UINT16_MAX;
    candidate.quality = accuracyValid ? accuracyToQuality(candidate.accuracyCentidegrees) : 0;
    candidate.nodeID = sourceNodeID;
    candidate.updatedAtMs = millis();
    candidate.hasMeasurement = true;
    candidate.fixed = fixedStatusKnown
        ? fixedSolution
        : accuracyValid && candidate.accuracyCentidegrees <= config->maxHeadingAccuracyCentidegrees;
    candidate.valid = isfinite(headingDegrees) && accuracyValid &&
        candidate.accuracyCentidegrees <= config->maxHeadingAccuracyCentidegrees &&
        (!config->movingBaselineFixedOnly || candidate.fixed);

    uint16_t distanceCentimeters = 0;
    if (isfinite(distanceMeters) && distanceMeters >= 0.0F) {
        distanceCentimeters = constrain(lrintf(distanceMeters * 100.0F), 0, UINT16_MAX);
        if (ABS((int32_t)distanceCentimeters - config->expectedBaselineCm) > config->baselineToleranceCm) {
            candidate.valid = false;
        }
    }

    const bool existingFresh = sample->valid &&
        candidate.updatedAtMs - sample->updatedAtMs <= config->sourceTimeoutMs;
    const bool differentProvider = headingStatus.baselineProvider != provider;
    if (config->movingBaselineProvider == FLIGHT_COMMANDER_BASELINE_AUTO &&
        differentProvider && existingFresh &&
        (!candidate.valid || sample->accuracyCentidegrees <= candidate.accuracyCentidegrees)) {
        return;
    }

    *sample = candidate;
    headingStatus.baselineProvider = provider;
    headingStatus.baselineFixed = candidate.fixed;
    headingStatus.baselineNodeID = sourceNodeID;
    headingStatus.baselineHeadingCentidegrees = candidate.headingCentidegrees;
    headingStatus.baselineAccuracyCentidegrees = candidate.accuracyCentidegrees;
    headingStatus.baselineDistanceCm = distanceCentimeters;
}

void flightCommanderHeadingReceiveDronecanHeading(
    uint8_t sourceNodeID,
    const struct ardupilot_gnss_Heading *message)
{
    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->movingRoverNodeID, sourceNodeID) || !message->heading_valid) {
        return;
    }
    gpsDronecanNodeStatus_t roverStatus;
    const bool fixedSolution = gpsDronecanGetNodeStatus(sourceNodeID, &roverStatus) &&
        roverStatus.healthy && roverStatus.fixType == GPS_FIX_RTK_FIXED;
    receiveBaseline(FLIGHT_COMMANDER_BASELINE_DRONECAN, sourceNodeID,
        RADIANS_TO_DEGREES(message->heading_rad),
        RADIANS_TO_DEGREES(message->heading_accuracy_rad), message->heading_accuracy_valid,
        NAN, fixedSolution, true);
}

void flightCommanderHeadingReceiveDronecanRelPosHeading(
    uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message)
{
    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->movingRoverNodeID, sourceNodeID)) {
        return;
    }
    gpsDronecanNodeStatus_t roverStatus;
    const bool fixedSolution = gpsDronecanGetNodeStatus(sourceNodeID, &roverStatus) &&
        roverStatus.healthy && roverStatus.fixType == GPS_FIX_RTK_FIXED;
    receiveBaseline(FLIGHT_COMMANDER_BASELINE_DRONECAN, sourceNodeID,
        message->reported_heading_deg, message->reported_heading_acc_deg,
        message->reported_heading_acc_available, message->relative_distance_m,
        fixedSolution, true);
}

void flightCommanderHeadingReceiveUartRelPosHeading(
    int32_t heading1e5Degrees,
    uint32_t accuracy1e5Degrees,
    int32_t distanceCentimeters,
    int8_t highPrecisionDistance0p1Millimeters,
    uint32_t flags)
{
    enum {
        UBX_RELPOS_GNSS_FIX_OK = 1U << 0,
        UBX_RELPOS_DIFFERENTIAL_SOLUTION = 1U << 1,
        UBX_RELPOS_VALID = 1U << 2,
        UBX_RELPOS_CARRIER_SOLUTION_SHIFT = 3,
        UBX_RELPOS_CARRIER_SOLUTION_MASK = 3U << UBX_RELPOS_CARRIER_SOLUTION_SHIFT,
        UBX_RELPOS_CARRIER_SOLUTION_FIXED = 2U,
        UBX_RELPOS_MOVING_BASE = 1U << 5,
        UBX_RELPOS_HEADING_VALID = 1U << 8,
    };
    const uint32_t validFlags = UBX_RELPOS_GNSS_FIX_OK |
        UBX_RELPOS_DIFFERENTIAL_SOLUTION | UBX_RELPOS_VALID |
        UBX_RELPOS_MOVING_BASE | UBX_RELPOS_HEADING_VALID;
    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_UART) ||
        (flags & validFlags) != validFlags) {
        return;
    }

    const uint32_t carrierSolution =
        (flags & UBX_RELPOS_CARRIER_SOLUTION_MASK) >> UBX_RELPOS_CARRIER_SOLUTION_SHIFT;
    const float distanceMeters =
        (distanceCentimeters + highPrecisionDistance0p1Millimeters * 0.01F) * 0.01F;
    receiveBaseline(FLIGHT_COMMANDER_BASELINE_UART, DRONECAN_NODE_ID_DISABLED,
        heading1e5Degrees * 1e-5F, accuracy1e5Degrees * 1e-5F, true,
        distanceMeters, carrierSolution == UBX_RELPOS_CARRIER_SOLUTION_FIXED, true);
}

#endif
