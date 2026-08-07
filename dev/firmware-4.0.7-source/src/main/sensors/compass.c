/*
 * This file is part of Cleanflight.
 *
 * Cleanflight is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Cleanflight is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Cleanflight.  If not, see <http://www.gnu.org/licenses/>.
 */

#include <stdbool.h>
#include <stdint.h>
#include <math.h>
#include <limits.h>

#include "platform.h"
#include "build/debug.h"

#include "common/axis.h"
#include "common/maths.h"
#include "common/utils.h"

#include "config/parameter_group.h"
#include "config/parameter_group_ids.h"

#include "drivers/compass/compass.h"
#include "drivers/compass/compass_ak8963.h"
#include "drivers/compass/compass_ak8975.h"
#include "drivers/compass/compass_fake.h"
#include "drivers/compass/compass_hmc5883l.h"
#include "drivers/compass/compass_mag3110.h"
#include "drivers/compass/compass_ist8310.h"
#include "drivers/compass/compass_ist8308.h"
#include "drivers/compass/compass_qmc5883l.h"
#include "drivers/compass/compass_qmc5883p.h"
#include "drivers/compass/compass_mpu9250.h"
#include "drivers/compass/compass_lis3mdl.h"
#include "drivers/compass/compass_rm3100.h"
#include "drivers/compass/compass_vcm5883.h"
#include "drivers/compass/compass_mlx90393.h"
#include "drivers/compass/compass_msp.h"
#include "drivers/io.h"
#include "drivers/light_led.h"
#include "drivers/time.h"

#include "fc/config.h"
#include "fc/runtime_config.h"
#include "fc/settings.h"

#include "io/gps.h"
#include "io/beeper.h"

#include "sensors/boardalignment.h"
#include "sensors/compass.h"
#include "sensors/gyro.h"
#include "sensors/sensors.h"

#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
#include "flight_commander/compass_orientation.h"
#endif

mag_t mag;                   // mag access functions

#ifdef USE_MAG

PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 8);

#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
#define COMPASS_RESET_ALIGN FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
#else
#define COMPASS_RESET_ALIGN SETTING_ALIGN_MAG_DEFAULT
#endif

PG_RESET_TEMPLATE(compassConfig_t, compassConfig,
    .mag_align = COMPASS_RESET_ALIGN,
    .mag_hardware = SETTING_MAG_HARDWARE_DEFAULT,
    .mag_declination = SETTING_MAG_DECLINATION_DEFAULT,
#ifdef USE_DUAL_MAG
    .mag_to_use = SETTING_MAG_TO_USE_DEFAULT,
#endif
    .magCalibrationTimeLimit = SETTING_MAG_CALIBRATION_TIME_DEFAULT,
    .rollDeciDegrees = SETTING_ALIGN_MAG_ROLL_DEFAULT,
    .pitchDeciDegrees = SETTING_ALIGN_MAG_PITCH_DEFAULT,
    .yawDeciDegrees = SETTING_ALIGN_MAG_YAW_DEFAULT,
    .magGain = {SETTING_MAGGAIN_X_DEFAULT, SETTING_MAGGAIN_Y_DEFAULT, SETTING_MAGGAIN_Z_DEFAULT},
);

static bool magUpdatedAtLeastOnce = false;
static timeUs_t magLastUpdatedAtUs;

#define COMPASS_SAMPLE_TIMEOUT_US 500000
#define COMPASS_CALIBRATION_MIN_SAMPLES 24U
#define COMPASS_CALIBRATION_MIN_GAIN 200
#define COMPASS_CALIBRATION_MAX_GAIN 2500
#define COMPASS_CALIBRATION_MAX_GAIN_RATIO 2.5F
#define COMPASS_CALIBRATION_MAX_ZERO_RATIO 4.0F
#define COMPASS_CALIBRATION_SIGNATURE_OFFSET 2166136261U
#define COMPASS_CALIBRATION_SIGNATURE_PRIME 16777619U
#define COMPASS_CALIBRATION_SIGNATURE_MAGIC 0x46434D47U

#ifndef FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION
#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 0U
#endif

static uint32_t compassCalibrationSignatureMix(uint32_t signature, uint32_t value)
{
    for (unsigned index = 0; index < sizeof(value); index++) {
        signature ^= value & 0xFFU;
        signature *= COMPASS_CALIBRATION_SIGNATURE_PRIME;
        value >>= 8;
    }
    return signature;
}

static uint32_t compassCalibrationSignature(const compassConfig_t *config)
{
    uint32_t signature = COMPASS_CALIBRATION_SIGNATURE_OFFSET;
    signature = compassCalibrationSignatureMix(
        signature,
        COMPASS_CALIBRATION_SIGNATURE_MAGIC
    );
    signature = compassCalibrationSignatureMix(
        signature,
        config->magCalibrationRevision
    );
    signature = compassCalibrationSignatureMix(signature, config->mag_hardware);
#ifdef USE_DUAL_MAG
    signature = compassCalibrationSignatureMix(signature, config->mag_to_use);
#endif
    signature = compassCalibrationSignatureMix(signature, config->mag_align);
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    signature = compassCalibrationSignatureMix(
        signature,
        flightCommanderCompassOrientationGeneration()
    );
#endif
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->rollDeciDegrees
    );
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->pitchDeciDegrees
    );
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->yawDeciDegrees
    );
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        signature = compassCalibrationSignatureMix(
            signature,
            (uint32_t)(uint16_t)config->magZero.raw[axis]
        );
        signature = compassCalibrationSignatureMix(
            signature,
            (uint32_t)(uint16_t)config->magGain[axis]
        );
    }
    return signature;
}

static bool compassCalibrationValuesValid(const compassConfig_t *config)
{
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    if (!flightCommanderCompassOrientationIsValid()) {
        return false;
    }
#endif
    if (config->magCalibrationRevision !=
            FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION ||
        config->magCalibrationSignature == 0 ||
        config->magCalibrationSignature != compassCalibrationSignature(config)) {
        return false;
    }

    const bool adjusted =
        config->magZero.raw[X] != 0 ||
        config->magZero.raw[Y] != 0 ||
        config->magZero.raw[Z] != 0 ||
        config->magGain[X] != 1024 ||
        config->magGain[Y] != 1024 ||
        config->magGain[Z] != 1024;
    if (!adjusted) {
        return false;
    }

    int32_t minimumGain = INT32_MAX;
    int32_t maximumGain = 0;
    int32_t maximumZero = 0;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        const int32_t gain = config->magGain[axis];
        if (gain < COMPASS_CALIBRATION_MIN_GAIN ||
            gain > COMPASS_CALIBRATION_MAX_GAIN) {
            return false;
        }
        minimumGain = MIN(minimumGain, gain);
        maximumGain = MAX(maximumGain, gain);
        maximumZero = MAX(maximumZero, ABS((int32_t)config->magZero.raw[axis]));
    }

    return maximumGain <= minimumGain * COMPASS_CALIBRATION_MAX_GAIN_RATIO &&
        maximumZero <= maximumGain * COMPASS_CALIBRATION_MAX_ZERO_RATIO;
}

bool compassDetect(magDev_t *dev, magSensor_e magHardwareToUse)
{
    magSensor_e magHardware = MAG_NONE;
    requestedSensors[SENSOR_INDEX_MAG] = magHardwareToUse;

    dev->magAlign.useExternal = false;
    dev->magAlign.onBoard = ALIGN_DEFAULT;

    switch (magHardwareToUse) {
    case MAG_AUTODETECT:
        FALLTHROUGH;

    case MAG_QMC5883:
#ifdef USE_MAG_QMC5883
        if (qmc5883Detect(dev)) {
            magHardware = MAG_QMC5883;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_QMC5883P:
#ifdef USE_MAG_QMC5883P
        if (qmc5883pDetect(dev)) {
            magHardware = MAG_QMC5883P;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_HMC5883:
#ifdef USE_MAG_HMC5883
        if (hmc5883lDetect(dev)) {
            magHardware = MAG_HMC5883;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_AK8975:
#ifdef USE_MAG_AK8975
        if (ak8975Detect(dev)) {
            magHardware = MAG_AK8975;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_AK8963:
#ifdef USE_MAG_AK8963
        if (ak8963Detect(dev)) {
            magHardware = MAG_AK8963;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_MAG3110:
#ifdef USE_MAG_MAG3110
        if (mag3110detect(dev)) {
            magHardware = MAG_MAG3110;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_IST8310:
#ifdef USE_MAG_IST8310
        if (ist8310Detect(dev)) {
            magHardware = MAG_IST8310;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_IST8308:
#ifdef USE_MAG_IST8308
        if (ist8308Detect(dev)) {
            magHardware = MAG_IST8308;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_MPU9250:
#ifdef USE_MAG_MPU9250
        if (mpu9250CompassDetect(dev)) {
            magHardware = MAG_MPU9250;
            break;
        }
#endif
        FALLTHROUGH;

    case MAG_LIS3MDL:
#ifdef USE_MAG_LIS3MDL
        if (lis3mdlDetect(dev)) {
            magHardware = MAG_LIS3MDL;
            break;
        }
#endif

        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_MSP:
#ifdef USE_MAG_MSP
        // Skip autodetection for MSP mag
        if (magHardwareToUse != MAG_AUTODETECT && mspMagDetect(dev)) {
            magHardware = MAG_MSP;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_RM3100:
#ifdef USE_MAG_RM3100
        if (rm3100MagDetect(dev)) {
            magHardware = MAG_RM3100;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_VCM5883:
#ifdef USE_MAG_VCM5883
        if (vcm5883Detect(dev)) {
            magHardware = MAG_VCM5883;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_MLX90393:
#ifdef USE_MAG_MLX90393
        if (mlx90393Detect(dev)) {
            magHardware = MAG_MLX90393;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_FAKE:
#ifdef USE_FAKE_MAG
        if (fakeMagDetect(dev)) {
            magHardware = MAG_FAKE;
            break;
        }
#endif
        /* If we are asked for a specific sensor - break out, otherwise - fall through and continue */
        if (magHardwareToUse != MAG_AUTODETECT) {
            break;
        }
        FALLTHROUGH;

    case MAG_NONE:
        magHardware = MAG_NONE;
        break;
    }

    if (magHardware == MAG_NONE) {
        sensorsClear(SENSOR_MAG);
        return false;
    }

    detectedSensors[SENSOR_INDEX_MAG] = magHardware;
    sensorsSet(SENSOR_MAG);
    return true;
}

bool compassInit(void)
{
#ifdef USE_DUAL_MAG
    mag.dev.magSensorToUse = compassConfig()->mag_to_use;
#else
    mag.dev.magSensorToUse = 0;
#endif

    if (!compassDetect(&mag.dev, compassConfig()->mag_hardware)) {
        return false;
    }
    // initialize and calibration. turn on led during mag calibration (calibration routine blinks it)
    LED1_ON;
    const bool ret = mag.dev.init(&mag.dev);
    LED1_OFF;

    if (!ret) {
        sensorsClear(SENSOR_MAG);
    }

    if (compassConfig()->rollDeciDegrees != 0 ||
        compassConfig()->pitchDeciDegrees != 0 ||
        compassConfig()->yawDeciDegrees != 0) {

        // Externally aligned compass
        mag.dev.magAlign.useExternal = true;

        fp_angles_t compassAngles = {
             .angles.roll = DECIDEGREES_TO_RADIANS(compassConfig()->rollDeciDegrees),
             .angles.pitch = DECIDEGREES_TO_RADIANS(compassConfig()->pitchDeciDegrees),
             .angles.yaw = DECIDEGREES_TO_RADIANS(compassConfig()->yawDeciDegrees),
        };
        rotationMatrixFromAngles(&mag.dev.magAlign.externalRotation, &compassAngles);
    } else {
        mag.dev.magAlign.useExternal = false;
        if (compassConfig()->mag_align != ALIGN_DEFAULT) {
            mag.dev.magAlign.onBoard = compassConfig()->mag_align;
        } else {
#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
            mag.dev.magAlign.onBoard = FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN;
#else
            mag.dev.magAlign.onBoard = CW270_DEG_FLIP;  // The most popular default is 270FLIP for external mags
#endif
        }
    }

    return ret;
}

uint16_t compassGetSampleAgeMs(void)
{
    if (!magUpdatedAtLeastOnce) {
        return UINT16_MAX;
    }

    const timeDelta_t ageUs = cmpTimeUs(micros(), magLastUpdatedAtUs);
    if (ageUs <= 0) {
        return 0;
    }

    const uint32_t ageMs = (uint32_t)ageUs / 1000U;
    return ageMs > UINT16_MAX ? UINT16_MAX : (uint16_t)ageMs;
}

bool compassIsHealthy(void)
{
    return compassGetSampleAgeMs() <= COMPASS_SAMPLE_TIMEOUT_US / 1000U &&
        ((mag.magADC[X] != 0) || (mag.magADC[Y] != 0) || (mag.magADC[Z] != 0));
}

bool compassIsReady(void)
{
    return magUpdatedAtLeastOnce;
}

bool compassIsCalibrationComplete(void)
{
#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    return flightCommanderCompassOrientationIsValid() && STATE(COMPASS_CALIBRATED);
#else
    return STATE(COMPASS_CALIBRATED);
#endif
}

void compassUpdate(timeUs_t currentTimeUs)
{
#ifdef USE_SIMULATOR
	if (ARMING_FLAG(SIMULATOR_MODE_HITL)) {
		magUpdatedAtLeastOnce = true;
		return;
	}
#endif
    static sensorCalibrationState_t calState;
    static timeUs_t calStartedAt = 0;
    static int16_t magPrev[XYZ_AXIS_COUNT];
    static float magMinimum[XYZ_AXIS_COUNT];
    static float magMaximum[XYZ_AXIS_COUNT];
    static uint32_t calibrationSampleCount;

#if defined(SITL_BUILD)
    ENABLE_STATE(COMPASS_CALIBRATED);
#else
    if (compassCalibrationValuesValid(compassConfig())) {
        ENABLE_STATE(COMPASS_CALIBRATED);
    } else {
        DISABLE_STATE(COMPASS_CALIBRATED);
    }
#endif

    if (!mag.dev.read(&mag.dev)) {
        // A single-shot IST8310 conversion may not be ready on every 40 Hz
        // compass task invocation. Preserve the last valid sample rather than
        // injecting a zero vector into the attitude estimator.
        return;
    }

    magLastUpdatedAtUs = currentTimeUs;
    for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        mag.magADC[axis] = mag.dev.magADCRaw[axis];
    }

#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    // Learn only from the untouched canonical driver sample. The saved
    // signed-axis transform is then applied before conventional magnetic
    // offset/gain calibration and before any user or board alignment.
    flightCommanderCompassOrientationObserve(currentTimeUs, mag.magADC);
    flightCommanderCompassOrientationApply(mag.magADC);
#endif

#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
    if (STATE(CALIBRATE_MAG) && !flightCommanderCompassOrientationIsValid()) {
        DISABLE_STATE(CALIBRATE_MAG);
        beeper(BEEPER_ACTION_FAIL);
    }
#endif

    if (STATE(CALIBRATE_MAG)) {
        calStartedAt = currentTimeUs;
        calibrationSampleCount = 1;

        sensorCalibrationResetState(&calState);
        sensorCalibrationPushSampleForOffsetCalculation(&calState, mag.magADC);

        for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            magPrev[axis] = lrintf(mag.magADC[axis]);
            magMinimum[axis] = mag.magADC[axis];
            magMaximum[axis] = mag.magADC[axis];
        }

        // Keep the previous stored calibration untouched until the complete
        // candidate has passed every validity check.
        beeper(BEEPER_ACTION_SUCCESS);
        DISABLE_STATE(CALIBRATE_MAG);
    }

    if (calStartedAt != 0) {
        if ((currentTimeUs - calStartedAt) < (compassConfig()->magCalibrationTimeLimit * 1000000)) {
            LED0_TOGGLE;

            float differenceMagnitudeSquared = 0.0F;
            float averageMagnitudeSquared = 0.0F;

            for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                const float difference = mag.magADC[axis] - magPrev[axis];
                const float average = (mag.magADC[axis] + magPrev[axis]) * 0.5F;
                differenceMagnitudeSquared += difference * difference;
                averageMagnitudeSquared += average * average;
                magMinimum[axis] = MIN(magMinimum[axis], mag.magADC[axis]);
                magMaximum[axis] = MAX(magMaximum[axis], mag.magADC[axis]);
            }

            // Keep samples separated by about eight degrees so repeated or
            // stale readings cannot make a singular data set look complete.
            if (averageMagnitudeSquared > 0.01F &&
                differenceMagnitudeSquared / averageMagnitudeSquared > sq(0.14F)) {
                sensorCalibrationPushSampleForOffsetCalculation(&calState, mag.magADC);
                calibrationSampleCount++;

                for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                    magPrev[axis] = lrintf(mag.magADC[axis]);
                }
            }
        } else {
            float candidateZeroFloat[XYZ_AXIS_COUNT];
            int16_t candidateZero[XYZ_AXIS_COUNT];
            int16_t candidateGain[XYZ_AXIS_COUNT];
            int32_t minimumGain = INT32_MAX;
            int32_t maximumGain = 0;

            bool valid =
                calibrationSampleCount >= COMPASS_CALIBRATION_MIN_SAMPLES &&
                sensorCalibrationSolveForOffset(&calState, candidateZeroFloat);

            for (int axis = 0; valid && axis < XYZ_AXIS_COUNT; axis++) {
                const float zero = candidateZeroFloat[axis];
                const float positiveRadius = magMaximum[axis] - zero;
                const float negativeRadius = zero - magMinimum[axis];
                const float gain = (positiveRadius + negativeRadius) * 0.5F;

                if (!isfinite(zero) || !isfinite(gain) ||
                    zero < INT16_MIN || zero > INT16_MAX ||
                    positiveRadius < COMPASS_CALIBRATION_MIN_GAIN ||
                    negativeRadius < COMPASS_CALIBRATION_MIN_GAIN ||
                    gain < COMPASS_CALIBRATION_MIN_GAIN ||
                    gain > COMPASS_CALIBRATION_MAX_GAIN) {
                    valid = false;
                    break;
                }

                candidateZero[axis] = lrintf(zero);
                candidateGain[axis] = lrintf(gain);
                minimumGain = MIN(minimumGain, candidateGain[axis]);
                maximumGain = MAX(maximumGain, candidateGain[axis]);
            }

            if (valid &&
                maximumGain > minimumGain * COMPASS_CALIBRATION_MAX_GAIN_RATIO) {
                valid = false;
            }

            if (valid) {
                compassConfig_t *config = compassConfigMutable();
                for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                    config->magZero.raw[axis] = candidateZero[axis];
                    config->magGain[axis] = candidateGain[axis];
                }
                config->magCalibrationRevision =
                    FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION;
                config->magCalibrationSignature =
                    compassCalibrationSignature(config);
                saveConfigAndNotify();
                beeper(BEEPER_ACTION_SUCCESS);
            } else {
                // The previous calibration remains intact. With no previous
                // valid calibration, the compass remains explicitly
                // uncalibrated instead of saving zeros or tiny gains.
                beeper(BEEPER_ACTION_FAIL);
            }

            calStartedAt = 0;
        }
    } else if (compassCalibrationValuesValid(compassConfig())) {
        for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
            const int32_t gain = compassConfig()->magGain[axis];
            mag.magADC[axis] =
                (mag.magADC[axis] - compassConfig()->magZero.raw[axis]) * 1024.0F / gain;
        }
    }

    if (mag.dev.magAlign.useExternal) {
        const fpVector3_t v = {
            .x = mag.magADC[X],
            .y = mag.magADC[Y],
            .z = mag.magADC[Z],
         };

        fpVector3_t rotated;

        rotationMatrixRotateVector(&rotated, &v, &mag.dev.magAlign.externalRotation);
        applyTailSitterAlignment(&rotated);
         mag.magADC[X] = rotated.x;
         mag.magADC[Y] = rotated.y;
         mag.magADC[Z] = rotated.z;

    } else {
        // On-board compass
        applySensorAlignment(mag.magADC, mag.magADC, mag.dev.magAlign.onBoard);
        applyBoardAlignment(mag.magADC);
    }

    magUpdatedAtLeastOnce = true;
}

#endif
