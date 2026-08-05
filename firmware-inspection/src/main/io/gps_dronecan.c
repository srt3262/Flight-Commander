/*
 * Flight Commander DroneCAN GNSS integration.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#include "platform.h"

#if defined(USE_GPS_PROTO_DRONECAN)

#include <math.h>
#include <string.h>

#include "common/axis.h"
#include "common/maths.h"

#include "config/feature.h"

#include "fc/config.h"

#include "drivers/time.h"
#include "drivers/dronecan/dronecan.h"

#include "io/gps.h"
#include "io/gps_dronecan.h"
#include "io/gps_private.h"

#include <dronecan_msgs.h>

#define DRONECAN_GPS_TIMEOUT_MS 1000U

gpsSolutionData_t gpsDronecanSol;
gpsStatistics_t gpsDronecanStats;

static bool newDataReady;
static timeMs_t lastMessageMs;
static timeMs_t previousMessageMs;
static uint8_t activeNodeID = DRONECAN_NODE_ID_DISABLED;
static uint16_t lastHDOP = 9999;

static uint8_t gpsMapFixStatus(uint8_t status)
{
    if (status == UAVCAN_EQUIPMENT_GNSS_FIX2_STATUS_2D_FIX) {
        return GPS_FIX_2D;
    }
    if (status >= UAVCAN_EQUIPMENT_GNSS_FIX2_STATUS_3D_FIX) {
        return GPS_FIX_3D;
    }
    return GPS_NO_FIX;
}

static bool acceptsNode(uint8_t sourceNodeID)
{
    if (!gpsDronecanIsEnabled()) {
        return false;
    }

    const uint8_t configuredNodeID = dronecanConfig()->gpsNodeID;
    if (configuredNodeID != 0) {
        return configuredNodeID == sourceNodeID;
    }

    return activeNodeID == DRONECAN_NODE_ID_DISABLED ||
        activeNodeID == sourceNodeID ||
        gpsDronecanAgeMs() > DRONECAN_GPS_TIMEOUT_MS;
}

static void recordMessage(uint8_t sourceNodeID)
{
    previousMessageMs = lastMessageMs;
    lastMessageMs = millis();
    activeNodeID = sourceNodeID;
    gpsDronecanStats.packetCount++;
    gpsDronecanStats.lastMessageDt = lastMessageMs - previousMessageMs;
    dronecanMarkNodeCapability(sourceNodeID,
        DRONECAN_NODE_CAPABILITY_GNSS | DRONECAN_NODE_CAPABILITY_RTCM);
    newDataReady = true;
}

static void populateVelocity(const float nedVelocity[3])
{
    gpsDronecanSol.velNED[X] = constrain(lrintf(nedVelocity[X] * 100.0F), INT16_MIN, INT16_MAX);
    gpsDronecanSol.velNED[Y] = constrain(lrintf(nedVelocity[Y] * 100.0F), INT16_MIN, INT16_MAX);
    gpsDronecanSol.velNED[Z] = constrain(lrintf(nedVelocity[Z] * 100.0F), INT16_MIN, INT16_MAX);
    gpsDronecanSol.groundSpeed = constrain(
        lrintf(calc_length_pythagorean_2D(nedVelocity[X], nedVelocity[Y]) * 100.0F),
        0,
        INT16_MAX);

    float course = atan2_approx(nedVelocity[Y], nedVelocity[X]);
    if (course < 0.0F) {
        course += 2.0F * M_PIf;
    }
    gpsDronecanSol.groundCourse = RADIANS_TO_DECIDEGREES(course);
    gpsDronecanSol.flags.validVelNE = true;
    gpsDronecanSol.flags.validVelD = true;
}

static void populateAccuracy(const float *covariance, uint8_t covarianceLength)
{
    gpsDronecanSol.flags.validEPE = false;
    if (covarianceLength >= 6) {
        const float varianceNorth = MAX(covariance[0], 0.0F);
        const float varianceEast = MAX(covariance[2], 0.0F);
        const float varianceDown = MAX(covariance[5], 0.0F);
        gpsDronecanSol.eph = gpsConstrainEPE(lrintf(sqrtf(varianceNorth + varianceEast) * 100.0F));
        gpsDronecanSol.epv = gpsConstrainEPE(lrintf(sqrtf(varianceDown) * 100.0F));
        gpsDronecanSol.flags.validEPE = true;
    }
}

void gpsRestartDronecan(void)
{
    gpsDronecanReset();
}

void gpsHandleDronecan(void)
{
    if (newDataReady) {
        newDataReady = false;
        gpsProcessNewDronecanData();
    }
}

void gpsDronecanReset(void)
{
    memset(&gpsDronecanSol, 0, sizeof(gpsDronecanSol));
    memset(&gpsDronecanStats, 0, sizeof(gpsDronecanStats));
    gpsDronecanSol.eph = 9999;
    gpsDronecanSol.epv = 9999;
    gpsDronecanSol.hdop = 9999;
    activeNodeID = DRONECAN_NODE_ID_DISABLED;
    lastMessageMs = 0;
    previousMessageMs = 0;
    lastHDOP = 9999;
    newDataReady = false;
}

bool gpsDronecanIsEnabled(void)
{
    return feature(FEATURE_GPS) && dronecanConfig()->gpsNodeID != DRONECAN_NODE_ID_DISABLED;
}

uint32_t gpsDronecanAgeMs(void)
{
    return lastMessageMs ? millis() - lastMessageMs : UINT32_MAX;
}

bool gpsDronecanIsHealthy(void)
{
    return gpsDronecanIsEnabled() && gpsDronecanAgeMs() <= DRONECAN_GPS_TIMEOUT_MS;
}

uint8_t gpsDronecanNodeId(void)
{
    return activeNodeID != DRONECAN_NODE_ID_DISABLED ? activeNodeID : dronecanConfig()->gpsNodeID;
}

void dronecanGPSReceiveGNSSFix(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix *fix)
{
    if (!acceptsNode(sourceNodeID)) {
        return;
    }

    gpsDronecanSol.fixType = gpsMapFixStatus(fix->status);
    gpsDronecanSol.numSat = fix->sats_used;
    gpsDronecanSol.llh.lon = fix->longitude_deg_1e8 / 10;
    gpsDronecanSol.llh.lat = fix->latitude_deg_1e8 / 10;
    gpsDronecanSol.llh.alt = fix->height_msl_mm / 10;
    gpsDronecanSol.hdop = fix->pdop > 0.0F ? gpsConstrainHDOP(lrintf(fix->pdop * 100.0F)) : lastHDOP;
    gpsDronecanSol.flags.validTime = false;
    populateVelocity(fix->ned_velocity);
    populateAccuracy(fix->position_covariance.data, fix->position_covariance.len);
    recordMessage(sourceNodeID);
}

void dronecanGPSReceiveGNSSFix2(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix2 *fix)
{
    if (!acceptsNode(sourceNodeID)) {
        return;
    }

    gpsDronecanSol.fixType = gpsMapFixStatus(fix->status);
    if (gpsDronecanSol.fixType >= GPS_FIX_3D && fix->mode == UAVCAN_EQUIPMENT_GNSS_FIX2_MODE_RTK) {
        gpsDronecanSol.fixType = fix->sub_mode == UAVCAN_EQUIPMENT_GNSS_FIX2_SUB_MODE_RTK_FIXED
            ? GPS_FIX_RTK_FIXED
            : GPS_FIX_RTK_FLOAT;
    }
    gpsDronecanSol.numSat = fix->sats_used;
    gpsDronecanSol.llh.lon = fix->longitude_deg_1e8 / 10;
    gpsDronecanSol.llh.lat = fix->latitude_deg_1e8 / 10;
    gpsDronecanSol.llh.alt = fix->height_msl_mm / 10;
    gpsDronecanSol.hdop = fix->pdop > 0.0F ? gpsConstrainHDOP(lrintf(fix->pdop * 100.0F)) : lastHDOP;
    gpsDronecanSol.flags.validTime = false;
    populateVelocity(fix->ned_velocity);
    populateAccuracy(fix->covariance.data, fix->covariance.len);
    recordMessage(sourceNodeID);
}

void dronecanGPSReceiveGNSSAuxiliary(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Auxiliary *auxiliary)
{
    if (!acceptsNode(sourceNodeID)) {
        return;
    }
    if (auxiliary->hdop > 0.0F) {
        lastHDOP = gpsConstrainHDOP(lrintf(auxiliary->hdop * 100.0F));
    }
    dronecanMarkNodeCapability(sourceNodeID, DRONECAN_NODE_CAPABILITY_GNSS);
}

#endif
