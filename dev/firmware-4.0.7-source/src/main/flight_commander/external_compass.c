/*
 * Flight Commander target-scoped external compass support.
 *
 * The MICOAIR743 target's official INAV 9.1.0 compass remains on I2C2.  These
 * tagged descriptors expose the target's external I2C1 connector to a second
 * magDev_t while reusing INAV's unmodified compass drivers.
 *
 * This file is free software: you may copy, redistribute and/or modify it
 * under the terms of the GNU General Public License Version 3.
 */

#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)

#include <string.h>

#include "common/axis.h"
#include "common/utils.h"
#include "drivers/bus.h"
#include "drivers/io.h"
#include "drivers/compass/compass.h"
#include "drivers/compass/compass_ak8963.h"
#include "drivers/compass/compass_ak8975.h"
#include "drivers/compass/compass_hmc5883l.h"
#include "drivers/compass/compass_ist8308.h"
#include "drivers/compass/compass_ist8310.h"
#include "drivers/compass/compass_lis3mdl.h"
#include "drivers/compass/compass_mag3110.h"
#include "drivers/compass/compass_mlx90393.h"
#include "drivers/compass/compass_qmc5883l.h"
#include "drivers/compass/compass_qmc5883p.h"
#include "drivers/compass/compass_vcm5883.h"
#include "drivers/time.h"
#include "flight_commander/external_compass.h"
#include "flight_commander/heading_fusion.h"
#include "sensors/compass.h"

#define FLIGHT_COMMANDER_EXTERNAL_MAG_TAG 1U

#ifdef USE_MAG_HMC5883
BUSDEV_REGISTER_I2C_TAG(fc_ext_hmc5883, DEVHW_HMC5883, BUS_I2C1, 0x1E, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_QMC5883
BUSDEV_REGISTER_I2C_TAG(fc_ext_qmc5883, DEVHW_QMC5883, BUS_I2C1, 0x0D, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_QMC5883P
BUSDEV_REGISTER_I2C_TAG(fc_ext_qmc5883p, DEVHW_QMC5883P, BUS_I2C1, 0x2C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_AK8963
BUSDEV_REGISTER_I2C_TAG(fc_ext_ak8963, DEVHW_AK8963, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_AK8975
BUSDEV_REGISTER_I2C_TAG(fc_ext_ak8975, DEVHW_AK8975, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_MAG3110
BUSDEV_REGISTER_I2C_TAG(fc_ext_mag3110, DEVHW_MAG3110, BUS_I2C1, 0x0E, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_IST8310
BUSDEV_REGISTER_I2C_TAG(fc_ext_ist8310_0, DEVHW_IST8310_0, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
BUSDEV_REGISTER_I2C_TAG(fc_ext_ist8310_1, DEVHW_IST8310_1, BUS_I2C1, 0x0E, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_IST8308
BUSDEV_REGISTER_I2C_TAG(fc_ext_ist8308, DEVHW_IST8308, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_LIS3MDL
BUSDEV_REGISTER_I2C_TAG(fc_ext_lis3mdl, DEVHW_LIS3MDL, BUS_I2C1, 0x1E, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_VCM5883
BUSDEV_REGISTER_I2C_TAG(fc_ext_vcm5883, DEVHW_VCM5883, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif
#ifdef USE_MAG_MLX90393
BUSDEV_REGISTER_I2C_TAG(fc_ext_mlx90393, DEVHW_MLX90393, BUS_I2C1, 0x0C, NONE,
    FLIGHT_COMMANDER_EXTERNAL_MAG_TAG, DEVFLAGS_NONE, 0);
#endif

static magDev_t externalMag;
static int16_t externalRaw[XYZ_AXIS_COUNT];
static timeMs_t externalUpdatedAtMs;
static bool externalDetected;
static bool externalSampleAvailable;

bool flightCommanderExternalCompassHardwareSupported(uint8_t hardware)
{
    switch ((magSensor_e)hardware) {
    case MAG_NONE:
    case MAG_AUTODETECT:
    case MAG_HMC5883:
    case MAG_AK8975:
    case MAG_MAG3110:
    case MAG_AK8963:
    case MAG_IST8310:
    case MAG_QMC5883:
    case MAG_QMC5883P:
    case MAG_IST8308:
    case MAG_LIS3MDL:
    case MAG_VCM5883:
    case MAG_MLX90393:
        return true;
    default:
        return false;
    }
}

bool flightCommanderExternalCompassIsConfigured(void)
{
    const flightCommanderHeadingConfig_t *config = flightCommanderHeadingConfig();
    return config->sources[FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG].enabled &&
        config->externalMagHardware != MAG_NONE &&
        flightCommanderExternalCompassHardwareSupported(config->externalMagHardware);
}

static bool detectHardware(magSensor_e hardware)
{
    switch (hardware) {
    case MAG_QMC5883:
#ifdef USE_MAG_QMC5883
        return qmc5883Detect(&externalMag);
#else
        return false;
#endif
    case MAG_QMC5883P:
#ifdef USE_MAG_QMC5883P
        return qmc5883pDetect(&externalMag);
#else
        return false;
#endif
    case MAG_HMC5883:
#ifdef USE_MAG_HMC5883
        return hmc5883lDetect(&externalMag);
#else
        return false;
#endif
    case MAG_AK8975:
#ifdef USE_MAG_AK8975
        return ak8975Detect(&externalMag);
#else
        return false;
#endif
    case MAG_AK8963:
#ifdef USE_MAG_AK8963
        return ak8963Detect(&externalMag);
#else
        return false;
#endif
    case MAG_MAG3110:
#ifdef USE_MAG_MAG3110
        return mag3110detect(&externalMag);
#else
        return false;
#endif
    case MAG_IST8310:
#ifdef USE_MAG_IST8310
        return ist8310Detect(&externalMag);
#else
        return false;
#endif
    case MAG_IST8308:
#ifdef USE_MAG_IST8308
        return ist8308Detect(&externalMag);
#else
        return false;
#endif
    case MAG_LIS3MDL:
#ifdef USE_MAG_LIS3MDL
        return lis3mdlDetect(&externalMag);
#else
        return false;
#endif
    case MAG_VCM5883:
#ifdef USE_MAG_VCM5883
        return vcm5883Detect(&externalMag);
#else
        return false;
#endif
    case MAG_MLX90393:
#ifdef USE_MAG_MLX90393
        return mlx90393Detect(&externalMag);
#else
        return false;
#endif
    default:
        return false;
    }
}

static bool detectConfiguredHardware(magSensor_e hardware)
{
    if (hardware != MAG_AUTODETECT) {
        return detectHardware(hardware);
    }

    // Match the official INAV compass autodetection order for supported I2C devices.
    static const magSensor_e autodetectOrder[] = {
        MAG_QMC5883,
        MAG_QMC5883P,
        MAG_HMC5883,
        MAG_AK8975,
        MAG_AK8963,
        MAG_MAG3110,
        MAG_IST8310,
        MAG_IST8308,
        MAG_LIS3MDL,
        MAG_VCM5883,
        MAG_MLX90393,
    };
    for (unsigned index = 0; index < ARRAYLEN(autodetectOrder); index++) {
        if (detectHardware(autodetectOrder[index])) {
            return true;
        }
    }
    return false;
}

void flightCommanderExternalCompassInit(void)
{
    memset(&externalMag, 0, sizeof(externalMag));
    memset(externalRaw, 0, sizeof(externalRaw));
    externalUpdatedAtMs = 0;
    externalDetected = false;
    externalSampleAvailable = false;

    if (!flightCommanderExternalCompassIsConfigured()) {
        return;
    }

    externalMag.magSensorToUse = FLIGHT_COMMANDER_EXTERNAL_MAG_TAG;
    if (!detectConfiguredHardware((magSensor_e)flightCommanderHeadingConfig()->externalMagHardware)) {
        return;
    }
    if (!externalMag.init || !externalMag.read || !externalMag.init(&externalMag)) {
        if (externalMag.busDev) {
            busDeviceDeInit(externalMag.busDev);
        }
        memset(&externalMag, 0, sizeof(externalMag));
        return;
    }
    externalDetected = true;
}

void flightCommanderExternalCompassUpdate(timeUs_t currentTimeUs)
{
    UNUSED(currentTimeUs);
    if (!externalDetected || !externalMag.read(&externalMag)) {
        return;
    }
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        externalRaw[axis] = externalMag.magADCRaw[axis];
    }
    externalUpdatedAtMs = millis();
    externalSampleAvailable = true;
}

bool flightCommanderExternalCompassGetSample(fpVector3_t *raw, timeMs_t *updatedAtMs)
{
    if (!externalDetected || !externalSampleAvailable) {
        return false;
    }
    raw->x = externalRaw[X];
    raw->y = externalRaw[Y];
    raw->z = externalRaw[Z];
    *updatedAtMs = externalUpdatedAtMs;
    return true;
}

#endif
