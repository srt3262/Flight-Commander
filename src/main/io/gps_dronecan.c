/*
 * Flight Commander DroneCAN GNSS integration.
 *
 * Flight Commander 4.0 tracks every observed GNSS node independently while
 * retaining the existing selectable navigation-primary interface.
 */

#include "platform.h"

#if defined(USE_GPS_PROTO_DRONECAN)

#include <limits.h>
#include <math.h>
#include <string.h>

#include "common/axis.h"
#include "common/maths.h"
#include "config/feature.h"
#include "drivers/dronecan/dronecan.h"
#include "drivers/time.h"
#include "fc/config.h"
#include "io/gps.h"
#include "io/gps_dronecan.h"
#include "io/gps_private.h"

#include <dronecan_msgs.h>

#define DRONECAN_GPS_TIMEOUT_MS 1000U
#define DRONECAN_GPS_TRACKED_NODES 8U

typedef struct dronecanGpsSlot_s {
    uint8_t nodeID;
    gpsSolutionData_t solution;
    gpsStatistics_t statistics;
    timeMs_t lastMessageMs;
    timeMs_t previousMessageMs;
    uint16_t hdop;
} dronecanGpsSlot_t;

gpsSolutionData_t gpsDronecanSol;
gpsStatistics_t gpsDronecanStats;

static dronecanGpsSlot_t slots[DRONECAN_GPS_TRACKED_NODES];
static bool newDataReady;
static timeMs_t lastMessageMs;
static uint8_t activeNodeID = DRONECAN_NODE_ID_DISABLED;

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

static dronecanGpsSlot_t *findSlot(uint8_t nodeID, bool create)
{
    dronecanGpsSlot_t *oldest = NULL;
    for (unsigned index = 0; index < DRONECAN_GPS_TRACKED_NODES; index++) {
        dronecanGpsSlot_t *slot = &slots[index];
        if (slot->nodeID == nodeID) {
            return slot;
        }
        if (slot->nodeID == DRONECAN_NODE_ID_DISABLED) {
            oldest = slot;
            break;
        }
        if (!oldest || slot->lastMessageMs < oldest->lastMessageMs) {
            oldest = slot;
        }
    }
    if (!create || !oldest || nodeID == DRONECAN_NODE_ID_DISABLED || nodeID == 0) {
        return NULL;
    }
    memset(oldest, 0, sizeof(*oldest));
    oldest->nodeID = nodeID;
    oldest->solution.eph = 9999;
    oldest->solution.epv = 9999;
    oldest->solution.hdop = 9999;
    oldest->hdop = 9999;
    return oldest;
}

static bool acceptsNavigationNode(uint8_t sourceNodeID)
{
    if (!gpsDronecanIsEnabled()) {
        return false;
    }
    const uint8_t configuredNodeID = dronecanConfig()->gpsNodeID;
    if (configuredNodeID != DRONECAN_NODE_ID_AUTO) {
        return configuredNodeID == sourceNodeID;
    }
    return activeNodeID == DRONECAN_NODE_ID_DISABLED || activeNodeID == sourceNodeID ||
        gpsDronecanAgeMs() > DRONECAN_GPS_TIMEOUT_MS;
}

static void populateVelocity(gpsSolutionData_t *solution, const float nedVelocity[3])
{
    solution->velNED[X] = constrain(lrintf(nedVelocity[X] * 100.0F), INT16_MIN, INT16_MAX);
    solution->velNED[Y] = constrain(lrintf(nedVelocity[Y] * 100.0F), INT16_MIN, INT16_MAX);
    solution->velNED[Z] = constrain(lrintf(nedVelocity[Z] * 100.0F), INT16_MIN, INT16_MAX);
    solution->groundSpeed = constrain(
        lrintf(calc_length_pythagorean_2D(nedVelocity[X], nedVelocity[Y]) * 100.0F), 0, INT16_MAX);
    float course = atan2_approx(nedVelocity[Y], nedVelocity[X]);
    if (course < 0.0F) {
        course += 2.0F * M_PIf;
    }
    solution->groundCourse = RADIANS_TO_DECIDEGREES(course);
    solution->flags.validVelNE = true;
    solution->flags.validVelD = true;
}

static void populateAccuracy(gpsSolutionData_t *solution, const float *covariance, uint8_t covarianceLength)
{
    solution->flags.validEPE = false;
    if (covarianceLength >= 6) {
        const float varianceNorth = MAX(covariance[0], 0.0F);
        const float varianceEast = MAX(covariance[2], 0.0F);
        const float varianceDown = MAX(covariance[5], 0.0F);
        solution->eph = gpsConstrainEPE(lrintf(sqrtf(varianceNorth + varianceEast) * 100.0F));
        solution->epv = gpsConstrainEPE(lrintf(sqrtf(varianceDown) * 100.0F));
        solution->flags.validEPE = true;
    }
}

static void recordSlot(dronecanGpsSlot_t *slot)
{
    slot->previousMessageMs = slot->lastMessageMs;
    slot->lastMessageMs = millis();
    slot->statistics.packetCount++;
    slot->statistics.lastMessageDt = slot->lastMessageMs - slot->previousMessageMs;
    dronecanMarkNodeCapability(slot->nodeID,
        DRONECAN_NODE_CAPABILITY_GNSS | DRONECAN_NODE_CAPABILITY_RTCM);
    if (acceptsNavigationNode(slot->nodeID)) {
        gpsDronecanSol = slot->solution;
        gpsDronecanStats = slot->statistics;
        activeNodeID = slot->nodeID;
        lastMessageMs = slot->lastMessageMs;
        newDataReady = true;
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
    memset(slots, 0, sizeof(slots));
    for (unsigned index = 0; index < DRONECAN_GPS_TRACKED_NODES; index++) {
        slots[index].nodeID = DRONECAN_NODE_ID_DISABLED;
    }
    gpsDronecanSol.eph = 9999;
    gpsDronecanSol.epv = 9999;
    gpsDronecanSol.hdop = 9999;
    activeNodeID = DRONECAN_NODE_ID_DISABLED;
    lastMessageMs = 0;
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

bool gpsDronecanGetNodeStatus(uint8_t nodeID, gpsDronecanNodeStatus_t *status)
{
    dronecanGpsSlot_t *slot = findSlot(nodeID, false);
    if (!slot || !status || !slot->lastMessageMs) {
        return false;
    }
    const uint32_t age = millis() - slot->lastMessageMs;
    *status = (gpsDronecanNodeStatus_t) {
        .nodeID = nodeID,
        .healthy = age <= DRONECAN_GPS_TIMEOUT_MS,
        .fixType = slot->solution.fixType,
        .satellites = slot->solution.numSat,
        .ageMs = age,
        .location = slot->solution.llh,
    };
    return true;
}

void dronecanGPSReceiveGNSSFix(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix *fix)
{
    dronecanGpsSlot_t *slot = findSlot(sourceNodeID, true);
    if (!slot) {
        return;
    }
    slot->solution.fixType = gpsMapFixStatus(fix->status);
    slot->solution.numSat = fix->sats_used;
    slot->solution.llh.lon = fix->longitude_deg_1e8 / 10;
    slot->solution.llh.lat = fix->latitude_deg_1e8 / 10;
    slot->solution.llh.alt = fix->height_msl_mm / 10;
    slot->solution.hdop = fix->pdop > 0.0F ? gpsConstrainHDOP(lrintf(fix->pdop * 100.0F)) : slot->hdop;
    slot->solution.flags.validTime = false;
    populateVelocity(&slot->solution, fix->ned_velocity);
    populateAccuracy(&slot->solution, fix->position_covariance.data, fix->position_covariance.len);
    recordSlot(slot);
}

void dronecanGPSReceiveGNSSFix2(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix2 *fix)
{
    dronecanGpsSlot_t *slot = findSlot(sourceNodeID, true);
    if (!slot) {
        return;
    }
    slot->solution.fixType = gpsMapFixStatus(fix->status);
    if (slot->solution.fixType >= GPS_FIX_3D && fix->mode == UAVCAN_EQUIPMENT_GNSS_FIX2_MODE_RTK) {
        slot->solution.fixType = fix->sub_mode == UAVCAN_EQUIPMENT_GNSS_FIX2_SUB_MODE_RTK_FIXED
            ? GPS_FIX_RTK_FIXED : GPS_FIX_RTK_FLOAT;
    }
    slot->solution.numSat = fix->sats_used;
    slot->solution.llh.lon = fix->longitude_deg_1e8 / 10;
    slot->solution.llh.lat = fix->latitude_deg_1e8 / 10;
    slot->solution.llh.alt = fix->height_msl_mm / 10;
    slot->solution.hdop = fix->pdop > 0.0F ? gpsConstrainHDOP(lrintf(fix->pdop * 100.0F)) : slot->hdop;
    slot->solution.flags.validTime = false;
    populateVelocity(&slot->solution, fix->ned_velocity);
    populateAccuracy(&slot->solution, fix->covariance.data, fix->covariance.len);
    recordSlot(slot);
}

void dronecanGPSReceiveGNSSAuxiliary(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Auxiliary *auxiliary)
{
    dronecanGpsSlot_t *slot = findSlot(sourceNodeID, true);
    if (!slot) {
        return;
    }
    if (auxiliary->hdop > 0.0F) {
        slot->hdop = gpsConstrainHDOP(lrintf(auxiliary->hdop * 100.0F));
    }
    dronecanMarkNodeCapability(sourceNodeID, DRONECAN_NODE_CAPABILITY_GNSS);
}

#endif
