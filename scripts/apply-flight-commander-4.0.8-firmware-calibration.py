#!/usr/bin/env python3
"""Apply the source-selective Flight Commander 4.0.8 compass calibration changes."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dev/firmware-4.0.7-source/src/main"


def read(relative: str) -> str:
    return (SOURCE / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    (SOURCE / relative).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one literal match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


def update_heading_fusion() -> None:
    text = read("flight_commander/heading_fusion.c")
    text = replace_once(
        text,
        '#include "flight_commander/external_compass.h"\n#include "flight_commander/heading_fusion.h"',
        '#include "flight_commander/external_compass.h"\n#include "flight_commander/compass_orientation.h"\n#include "flight_commander/heading_fusion.h"',
        "heading fusion orientation include",
    )
    text = replace_once(
        text,
        "static bool customMagCalibrationActive;\n",
        "static bool customMagCalibrationActive;\n"
        "static uint8_t activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;\n",
        "active field source declaration",
    )
    text = replace_once(
        text,
        "    customMagCalibrationStartedAtUs = 0;\n    customMagCalibrationActive = false;\n",
        "    customMagCalibrationStartedAtUs = 0;\n"
        "    customMagCalibrationActive = false;\n"
        "    activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE;\n",
        "field source initialization",
    )

    helper_block = r'''
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
'''
    text = replace_once(
        text,
        "\nstatic void resetCustomCalibrationContext(customMagCalibration_t *context)\n",
        helper_block + "\nstatic void resetCustomCalibrationContext(customMagCalibration_t *context)\n",
        "heading source helper insertion",
    )

    calibration_block = r'''static void resetCustomCalibrationContext(customMagCalibration_t *context)
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
'''
    text = regex_once(
        text,
        r"static void resetCustomCalibrationContext\(customMagCalibration_t \*context\).*?\nstatic void updateExternalCompassSample\(void\)",
        calibration_block + "\nstatic void updateExternalCompassSample(void)",
        "source-selective calibration runtime",
    )

    external_update = r'''static void updateExternalCompassSample(void)
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
'''
    text = regex_once(
        text,
        r"static void updateExternalCompassSample\(void\).*?\nvoid flightCommanderHeadingUpdate\(void\)",
        external_update + "\nvoid flightCommanderHeadingUpdate(void)",
        "external orientation application",
    )

    dronecan_receive = r'''void flightCommanderHeadingReceiveDronecanMag(
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
'''
    text = regex_once(
        text,
        r"void flightCommanderHeadingReceiveDronecanMag\(.*?\nstatic bool baselineProviderEnabled\(uint8_t provider\)",
        dronecan_receive + "\nstatic bool baselineProviderEnabled(uint8_t provider)",
        "DroneCAN orientation application",
    )
    write("flight_commander/heading_fusion.c", text)


def update_compass() -> None:
    text = read("sensors/compass.c")
    text = replace_once(
        text,
        '#include "flight_commander/compass_orientation.h"\n#endif',
        '#include "flight_commander/compass_orientation.h"\n'
        '#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n'
        '#include "flight_commander/heading_fusion.h"\n'
        '#endif\n'
        '#endif',
        "compass heading include",
    )
    text = text.replace(
        "flightCommanderCompassOrientationGeneration()",
        "flightCommanderCompassOrientationGeneration(\n            FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD)",
    )
    text = text.replace(
        "flightCommanderCompassOrientationIsValid()",
        "flightCommanderCompassOrientationIsValid(\n        FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD)",
    )
    text = replace_once(
        text,
        "    flightCommanderCompassOrientationObserve(currentTimeUs, mag.magADC);\n"
        "    flightCommanderCompassOrientationApply(mag.magADC);",
        "    flightCommanderCompassOrientationObserve(\n"
        "        currentTimeUs,\n"
        "        FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD,\n"
        "        mag.magADC);\n"
        "    flightCommanderCompassOrientationApply(\n"
        "        FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD,\n"
        "        mag.magADC);",
        "onboard source-aware orientation",
    )
    text = replace_once(
        text,
        "        beeper(BEEPER_ACTION_SUCCESS);\n        DISABLE_STATE(CALIBRATE_MAG);\n",
        "        beeper(BEEPER_ACTION_SUCCESS);\n"
        "#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n"
        "        flightCommanderHeadingOnboardCalibrationStarted();\n"
        "#endif\n"
        "        DISABLE_STATE(CALIBRATE_MAG);\n",
        "onboard calibration started notification",
    )
    text = replace_once(
        text,
        "                saveConfigAndNotify();\n                beeper(BEEPER_ACTION_SUCCESS);\n            } else {",
        "                saveConfigAndNotify();\n"
        "                beeper(BEEPER_ACTION_SUCCESS);\n"
        "#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n"
        "                flightCommanderHeadingOnboardCalibrationFinished(true);\n"
        "#endif\n"
        "            } else {",
        "onboard calibration success notification",
    )
    text = replace_once(
        text,
        "                beeper(BEEPER_ACTION_FAIL);\n            }\n\n            calStartedAt = 0;",
        "                beeper(BEEPER_ACTION_FAIL);\n"
        "#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n"
        "                flightCommanderHeadingOnboardCalibrationFinished(false);\n"
        "#endif\n"
        "            }\n\n"
        "            calStartedAt = 0;",
        "onboard calibration failure notification",
    )
    write("sensors/compass.c", text)


def update_msp_contract() -> None:
    protocol = read("msp/msp_protocol_v2_flight_commander.h")
    protocol = replace_once(
        protocol,
        "#define MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND 0x2F24",
        "#define MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND 0x2F24\n"
        "#define MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND 0x2F25",
        "targeted field calibration MSP ID",
    )
    write("msp/msp_protocol_v2_flight_commander.h", protocol)

    build = read("build/flight_commander.h")
    build = build.replace(
        "#define FLIGHT_COMMANDER_VERSION_PATCH 7",
        "#define FLIGHT_COMMANDER_VERSION_PATCH 8",
    )
    build = replace_once(
        build,
        "    FLIGHT_COMMANDER_CAPABILITY_COMPASS_ORIENTATION_LEARNING = (1U << 14),\n",
        "    FLIGHT_COMMANDER_CAPABILITY_COMPASS_ORIENTATION_LEARNING = (1U << 14),\n"
        "    FLIGHT_COMMANDER_CAPABILITY_INDIVIDUAL_COMPASS_CALIBRATION = (1U << 15),\n",
        "individual compass capability",
    )
    build = build.replace(
        "#define FLIGHT_COMMANDER_CAPABILITIES ((uint32_t)0x7FFFU)",
        "#define FLIGHT_COMMANDER_CAPABILITIES ((uint32_t)0xFFFFU)",
    )
    write("build/flight_commander.h", build)

    msp = read("fc/fc_msp.c")
    msp = replace_once(
        msp,
        "    case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\n"
        "        if (ARMING_FLAG(ARMED) || !flightCommanderCompassOrientationReadCommand(src)) {\n"
        "            return MSP_RESULT_ERROR;\n"
        "        }\n"
        "        break;\n"
        "#endif",
        "    case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\n"
        "        if (ARMING_FLAG(ARMED) || !flightCommanderCompassOrientationReadCommand(src)) {\n"
        "            return MSP_RESULT_ERROR;\n"
        "        }\n"
        "        break;\n"
        "#endif\n\n"
        "#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n"
        "    case MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND:\n"
        "        if (ARMING_FLAG(ARMED) ||\n"
        "            !flightCommanderHeadingReadCompassCalibrationCommand(src)) {\n"
        "            return MSP_RESULT_ERROR;\n"
        "        }\n"
        "        break;\n"
        "#endif",
        "targeted field command handler",
    )
    msp = replace_once(
        msp,
        "    case MSP_MAG_CALIBRATION:\n"
        "        if (!ARMING_FLAG(ARMED))\n"
        "            ENABLE_STATE(CALIBRATE_MAG);\n"
        "        else\n"
        "            return MSP_RESULT_ERROR;\n"
        "        break;",
        "    case MSP_MAG_CALIBRATION:\n"
        "#ifdef USE_FLIGHT_COMMANDER_HEADING_FUSION\n"
        "        if (ARMING_FLAG(ARMED) ||\n"
        "            !flightCommanderHeadingStartCompassFieldCalibration(\n"
        "                FLIGHT_COMMANDER_HEADING_ONBOARD_MAG)) {\n"
        "            return MSP_RESULT_ERROR;\n"
        "        }\n"
        "#else\n"
        "        if (!ARMING_FLAG(ARMED))\n"
        "            ENABLE_STATE(CALIBRATE_MAG);\n"
        "        else\n"
        "            return MSP_RESULT_ERROR;\n"
        "#endif\n"
        "        break;",
        "legacy onboard-only calibration compatibility",
    )
    write("fc/fc_msp.c", msp)


def main() -> None:
    update_heading_fusion()
    update_compass()
    update_msp_contract()
    print("Applied Flight Commander 4.0.8 source-selective firmware calibration changes")


if __name__ == "__main__":
    main()
