#!/usr/bin/env python3
"""Prepare Flight Commander Firmware 4.0.0 from the retained 3.0.7 source.

The repository deliberately retains the exact firmware source as a release ZIP.
This tool expands that verified source, applies the coordinated 4.0.0 changes,
and leaves a normal buildable source tree for the build workflow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

VERSION = "4.0.0"
SOURCE_DATE_EPOCH = 1785895200


def replace_once(path: Path, old: str, new: str) -> None:
    value = path.read_text(encoding="utf-8")
    if new in value:
        return
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}: {old[:120]!r}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")


def replace_text(path: Path, old: str, new: str) -> None:
    value = path.read_text(encoding="utf-8")
    if old not in value:
        if new in value:
            return
        raise RuntimeError(f"{path}: replacement target not found: {old!r}")
    path.write_text(value.replace(old, new), encoding="utf-8")


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}\n")
    return records


def source_identities(root: Path) -> tuple[str, str]:
    records = source_records(root)
    revision = hashlib.sha1("".join(records).encode()).hexdigest()
    tree = hashlib.sha1(("flight-commander-source-tree-v1\n" + "".join(records)).encode()).hexdigest()
    return revision, tree


DRONECAN_H = r'''#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "common/time.h"
#include "config/parameter_group.h"

typedef enum {
    DRONECAN_BITRATE_125KBPS = 0,
    DRONECAN_BITRATE_250KBPS,
    DRONECAN_BITRATE_500KBPS,
    DRONECAN_BITRATE_1000KBPS,
    DRONECAN_BITRATE_COUNT
} dronecanBitrate_e;

typedef enum {
    STATE_DRONECAN_INIT,
    STATE_DRONECAN_NORMAL,
    STATE_DRONECAN_BUS_OFF
} dronecanState_e;

#define DRONECAN_MAX_NODES 32
#define DRONECAN_NODE_ID_AUTO 0
#define DRONECAN_NODE_ID_DISABLED 255
#define DRONECAN_CONFIG_SCHEMA 2

#define DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY (1U << 0)

typedef enum {
    DRONECAN_TERMINATION_UNCHANGED = 0,
    DRONECAN_TERMINATION_DISABLED = 1,
    DRONECAN_TERMINATION_ENABLED = 2,
} dronecanTermination_e;

typedef enum {
    DRONECAN_NODE_CAPABILITY_GNSS = (1U << 0),
    DRONECAN_NODE_CAPABILITY_RTCM = (1U << 1),
    DRONECAN_NODE_CAPABILITY_BATTERY = (1U << 2),
    DRONECAN_NODE_CAPABILITY_MAG = (1U << 3),
    DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING = (1U << 4),
} dronecanNodeCapability_e;

typedef struct dronecanConfig_s {
    uint8_t nodeID;
    uint8_t bitRateKbps;
    uint8_t gpsNodeID;             // Normal navigation GNSS binding.
    uint8_t batteryNodeID;
    uint8_t primaryGpsSource;
    uint8_t magNodeID;
    uint8_t movingBaseNodeID;      // Fixed aircraft moving-base identity.
    uint8_t movingRoverNodeID;     // Fixed heading-producing rover identity.
    uint8_t pairFlags;
    uint8_t baseTermination;
    uint8_t roverTermination;
} dronecanConfig_t;

typedef struct dronecanNodeInfo_s {
    uint8_t nodeID;
    uint8_t health;
    uint8_t mode;
    uint32_t uptime_sec;
    uint16_t vendor_status_code;
    uint32_t last_seen_ms;
    uint16_t capabilities;
    uint8_t name_len;
    char name[32];
} dronecanNodeInfo_t;

typedef struct dronecanNodeStatus_s {
    uint8_t nodeID;
    uint8_t health;
    uint8_t mode;
    uint32_t last_seen_ms;
} __attribute__((packed)) dronecanNodeStatus_t;

void dronecanInit(void);
void dronecanUpdate(timeUs_t currentTimeUs);
bool dronecanBroadcastRtcm(const uint8_t *data, uint16_t length);
bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength);
dronecanState_e dronecanGetState(void);
uint8_t dronecanGetNodeCount(void);
uint32_t dronecanGetBitrateKbps(void);
const dronecanNodeInfo_t *dronecanGetNode(uint8_t index);
const dronecanNodeInfo_t *dronecanGetNodeById(uint8_t nodeID);
void dronecanMarkNodeCapability(uint8_t nodeID, uint16_t capability);

PG_DECLARE(dronecanConfig_t, dronecanConfig);
'''

GPS_DRONECAN_H = r'''#pragma once

#include "platform.h"

#if defined(USE_GPS_PROTO_DRONECAN)

#include <stdbool.h>
#include <stdint.h>
#include <dronecan_msgs.h>

#include "io/gps.h"

typedef struct gpsDronecanNodeStatus_s {
    uint8_t nodeID;
    bool healthy;
    gpsFixType_e fixType;
    uint8_t satellites;
    uint32_t ageMs;
    gpsLocation_t location;
} gpsDronecanNodeStatus_t;

void gpsRestartDronecan(void);
void gpsHandleDronecan(void);
void dronecanGPSReceiveGNSSFix(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix *fix);
void dronecanGPSReceiveGNSSFix2(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix2 *fix);
void dronecanGPSReceiveGNSSAuxiliary(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Auxiliary *auxiliary);
bool gpsDronecanGetNodeStatus(uint8_t nodeID, gpsDronecanNodeStatus_t *status);

#endif
'''

GPS_DRONECAN_C = r'''/*
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
'''

DRONECAN_PAIR_H = r'''#pragma once

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)

#include <stdbool.h>
#include <stdint.h>

#include "drivers/dronecan/libcanard/canard.h"

struct ardupilot_gnss_RelPosHeading;

#define DRONECAN_PAIR_STATUS_SCHEMA 1
#define DRONECAN_PAIR_COMMAND_SCHEMA 1

typedef enum {
    DRONECAN_PAIR_COMMAND_NONE = 0,
    DRONECAN_PAIR_COMMAND_CONFIGURE = 1,
    DRONECAN_PAIR_COMMAND_VERIFY = 2,
    DRONECAN_PAIR_COMMAND_ABORT = 3,
} dronecanPairCommand_e;

typedef enum {
    DRONECAN_PAIR_STATE_IDLE = 0,
    DRONECAN_PAIR_STATE_DISCOVER_BASE = 1,
    DRONECAN_PAIR_STATE_DISCOVER_ROVER = 2,
    DRONECAN_PAIR_STATE_CONFIGURE_BASE = 3,
    DRONECAN_PAIR_STATE_SAVE_BASE = 4,
    DRONECAN_PAIR_STATE_CONFIGURE_ROVER = 5,
    DRONECAN_PAIR_STATE_SAVE_ROVER = 6,
    DRONECAN_PAIR_STATE_RESTART_BASE = 7,
    DRONECAN_PAIR_STATE_RESTART_ROVER = 8,
    DRONECAN_PAIR_STATE_WAIT_RECONNECT = 9,
    DRONECAN_PAIR_STATE_VERIFY_BASE = 10,
    DRONECAN_PAIR_STATE_VERIFY_ROVER = 11,
    DRONECAN_PAIR_STATE_COMPLETE = 12,
    DRONECAN_PAIR_STATE_ERROR = 13,
    DRONECAN_PAIR_STATE_ABORTED = 14,
} dronecanPairState_e;

typedef enum {
    DRONECAN_PAIR_ERROR_NONE = 0,
    DRONECAN_PAIR_ERROR_BINDING_INCOMPLETE = 1,
    DRONECAN_PAIR_ERROR_DUPLICATE_NODE = 2,
    DRONECAN_PAIR_ERROR_BASE_OFFLINE = 3,
    DRONECAN_PAIR_ERROR_ROVER_OFFLINE = 4,
    DRONECAN_PAIR_ERROR_IDENTITY = 5,
    DRONECAN_PAIR_ERROR_TIMEOUT = 6,
    DRONECAN_PAIR_ERROR_PARAMETER_MISSING = 7,
    DRONECAN_PAIR_ERROR_PARAMETER_REJECTED = 8,
    DRONECAN_PAIR_ERROR_SAVE = 9,
    DRONECAN_PAIR_ERROR_RESTART = 10,
    DRONECAN_PAIR_ERROR_BASE_VERIFY = 11,
    DRONECAN_PAIR_ERROR_ROVER_VERIFY = 12,
    DRONECAN_PAIR_ERROR_ARMED = 13,
    DRONECAN_PAIR_ERROR_COMMAND = 14,
    DRONECAN_PAIR_ERROR_TRANSMIT = 15,
} dronecanPairError_e;

typedef struct dronecanPairStatus_s {
    uint8_t state;
    uint8_t progress;
    uint8_t errorCode;
    uint8_t activeNodeID;
    bool baseOnline;
    bool roverOnline;
    bool baseRoleVerified;
    bool roverRoleVerified;
    bool baseIdentityValid;
    bool roverIdentityValid;
    bool relativeHeadingFresh;
    bool configured;
    uint8_t baseNodeID;
    uint8_t roverNodeID;
    uint8_t baseFixType;
    uint8_t baseSatellites;
    uint16_t baseAgeMs;
    uint8_t roverFixType;
    uint8_t roverSatellites;
    uint16_t roverAgeMs;
    int16_t baseGpsType;
    int16_t roverGpsType;
    int16_t baseAutoConfig;
    int16_t roverAutoConfig;
    int16_t baseTermination;
    int16_t roverTermination;
    uint16_t relativeHeadingCentidegrees;
    uint16_t relativeAccuracyCentidegrees;
    uint16_t relativeDistanceCm;
    uint16_t relativeAgeMs;
    uint32_t relativeHeadingCount;
    uint32_t serviceRequestCount;
    uint32_t serviceResponseCount;
    uint32_t serviceTimeoutCount;
    uint8_t baseSoftwareMajor;
    uint8_t baseSoftwareMinor;
    uint8_t roverSoftwareMajor;
    uint8_t roverSoftwareMinor;
    char baseName[32];
    char roverName[32];
} dronecanPairStatus_t;

void dronecanPairInit(void);
void dronecanPairUpdate(void);
bool dronecanPairStartCommand(uint8_t command);
const dronecanPairStatus_t *dronecanPairGetStatus(void);
bool dronecanPairShouldAcceptResponse(uint16_t dataTypeID, uint64_t *signature);
bool dronecanPairHandleResponse(const CanardRxTransfer *transfer);
void dronecanPairRecordRelPosHeading(uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message);

#endif
'''

DRONECAN_PAIR_C = r'''/*
 * Flight Commander 4.0 DroneCAN moving-baseline pair manager.
 *
 * The paired AP_Periph modules exchange carrier data directly on DroneCAN. The
 * flight controller configures their persistent roles and consumes only the
 * bound rover's RelPosHeading solution.
 */

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)

#include <ctype.h>
#include <math.h>
#include <string.h>

#include "common/maths.h"
#include "drivers/dronecan/dronecan.h"
#include "drivers/dronecan/dronecan_pair.h"
#include "drivers/time.h"
#include "io/gps_dronecan.h"

#include <dronecan_msgs.h>

#define PAIR_REQUEST_TIMEOUT_MS 1500U
#define PAIR_MAX_RETRIES 2U
#define PAIR_RECONNECT_DELAY_MS 3000U
#define PAIR_RECONNECT_TIMEOUT_MS 12000U
#define AP_PERIPH_MOVING_BASE_GPS_TYPE 17
#define AP_PERIPH_MOVING_ROVER_GPS_TYPE 18
#define AP_PERIPH_GPS_AUTO_CONFIG 1

typedef enum {
    STEP_NONE = 0,
    STEP_INFO_BASE,
    STEP_INFO_ROVER,
    STEP_SET_BASE_NODE,
    STEP_SET_BASE_TYPE,
    STEP_SET_BASE_AUTOCONFIG,
    STEP_SET_BASE_TERMINATION,
    STEP_SAVE_BASE,
    STEP_SET_ROVER_NODE,
    STEP_SET_ROVER_TYPE,
    STEP_SET_ROVER_AUTOCONFIG,
    STEP_SET_ROVER_TERMINATION,
    STEP_SAVE_ROVER,
    STEP_RESTART_BASE,
    STEP_RESTART_ROVER,
    STEP_WAIT_RECONNECT,
    STEP_VERIFY_BASE_TYPE,
    STEP_VERIFY_BASE_AUTOCONFIG,
    STEP_VERIFY_BASE_TERMINATION,
    STEP_VERIFY_ROVER_TYPE,
    STEP_VERIFY_ROVER_AUTOCONFIG,
    STEP_VERIFY_ROVER_TERMINATION,
    STEP_COMPLETE,
} pairStep_e;

typedef enum {
    REQUEST_NONE = 0,
    REQUEST_NODE_INFO,
    REQUEST_PARAMETER,
    REQUEST_SAVE,
} pairRequestKind_e;

typedef enum {
    PARAM_NONE = 0,
    PARAM_CAN_NODE,
    PARAM_GPS_TYPE,
    PARAM_GPS_AUTO_CONFIG,
    PARAM_CAN_TERMINATE,
} pairParameter_e;

typedef struct pairPendingRequest_s {
    pairRequestKind_e kind;
    pairParameter_e parameter;
    uint8_t nodeID;
    bool write;
    int64_t expectedValue;
    uint32_t deadlineMs;
} pairPendingRequest_t;

static dronecanPairStatus_t status;
static pairPendingRequest_t pending;
static pairStep_e step;
static uint8_t command;
static uint8_t retries;
static uint32_t reconnectStartedMs;
static uint32_t lastRelPosMs;
static uint8_t nodeInfoTransferID;
static uint8_t parameterTransferID;
static uint8_t executeOpcodeTransferID;
static uint8_t restartTransferID;

static void setError(uint8_t error)
{
    status.state = DRONECAN_PAIR_STATE_ERROR;
    status.errorCode = error;
    status.progress = 0;
    status.activeNodeID = 0;
    pending.kind = REQUEST_NONE;
    step = STEP_NONE;
}

static bool nodeOnline(uint8_t nodeID)
{
    return dronecanGetNodeById(nodeID) != NULL;
}

static void copyName(char destination[32], const uint8_t *source, uint8_t length)
{
    memset(destination, 0, 32);
    memcpy(destination, source, MIN((unsigned)length, 31U));
}

static bool containsIgnoreCase(const char *text, const char *needle)
{
    if (!text || !needle || !*needle) {
        return false;
    }
    for (; *text; text++) {
        const char *left = text;
        const char *right = needle;
        while (*left && *right && tolower((unsigned char)*left) == tolower((unsigned char)*right)) {
            left++;
            right++;
        }
        if (!*right) {
            return true;
        }
    }
    return false;
}

static bool compatibleIdentity(const char *name)
{
    return containsIgnoreCase(name, "holybro") || containsIgnoreCase(name, "ardupilot") ||
        containsIgnoreCase(name, "ap_periph") || containsIgnoreCase(name, "apperiph");
}

static const char *parameterName(pairParameter_e parameter)
{
    switch (parameter) {
    case PARAM_CAN_NODE: return "CAN_NODE";
    case PARAM_GPS_TYPE: return "GPS_TYPE";
    case PARAM_GPS_AUTO_CONFIG: return "GPS_AUTO_CONFIG";
    case PARAM_CAN_TERMINATE: return "CAN_TERMINATE";
    default: return "";
    }
}

static bool sendNodeInfo(uint8_t nodeID)
{
    struct uavcan_protocol_GetNodeInfoRequest request = { 0 };
    uint8_t buffer[1] = { 0 };
    const uint16_t length = uavcan_protocol_GetNodeInfoRequest_encode(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE,
        UAVCAN_PROTOCOL_GETNODEINFO_ID, &nodeInfoTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_NODE_INFO,
        .nodeID = nodeID,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendParameter(uint8_t nodeID, pairParameter_e parameter, bool write, int64_t value)
{
    struct uavcan_protocol_param_GetSetRequest request;
    memset(&request, 0, sizeof(request));
    const char *name = parameterName(parameter);
    request.index = 0;
    request.name.len = MIN(strlen(name), sizeof(request.name.data));
    memcpy(request.name.data, name, request.name.len);
    request.value.union_tag = write ? UAVCAN_PROTOCOL_PARAM_VALUE_INTEGER_VALUE : UAVCAN_PROTOCOL_PARAM_VALUE_EMPTY;
    if (write) {
        request.value.integer_value = value;
    }
    uint8_t buffer[UAVCAN_PROTOCOL_PARAM_GETSET_REQUEST_MAX_SIZE];
    const uint16_t length = uavcan_protocol_param_GetSetRequest_encode(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_PARAM_GETSET_SIGNATURE,
        UAVCAN_PROTOCOL_PARAM_GETSET_ID, &parameterTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_PARAMETER,
        .parameter = parameter,
        .nodeID = nodeID,
        .write = write,
        .expectedValue = value,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendSave(uint8_t nodeID)
{
    struct uavcan_protocol_param_ExecuteOpcodeRequest request = {
        .opcode = UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_REQUEST_OPCODE_SAVE,
        .argument = 0,
    };
    uint8_t buffer[UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_REQUEST_MAX_SIZE];
    const uint16_t length = uavcan_protocol_param_ExecuteOpcodeRequest_encode(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_SIGNATURE,
        UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID, &executeOpcodeTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_SAVE,
        .nodeID = nodeID,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendRestart(uint8_t nodeID)
{
    struct uavcan_protocol_RestartNodeRequest request = {
        .magic_number = UAVCAN_PROTOCOL_RESTARTNODE_REQUEST_MAGIC_NUMBER,
    };
    uint8_t buffer[UAVCAN_PROTOCOL_RESTARTNODE_REQUEST_MAX_SIZE];
    const uint16_t length = uavcan_protocol_RestartNodeRequest_encode(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_RESTARTNODE_SIGNATURE,
        UAVCAN_PROTOCOL_RESTARTNODE_ID, &restartTransferID, buffer, length)) {
        return false;
    }
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static int64_t terminationValue(uint8_t selection)
{
    return selection == DRONECAN_TERMINATION_ENABLED ? 1 : 0;
}

static void setBroadState(void)
{
    switch (step) {
    case STEP_INFO_BASE: status.state = DRONECAN_PAIR_STATE_DISCOVER_BASE; status.progress = 3; break;
    case STEP_INFO_ROVER: status.state = DRONECAN_PAIR_STATE_DISCOVER_ROVER; status.progress = 7; break;
    case STEP_SET_BASE_NODE:
    case STEP_SET_BASE_TYPE:
    case STEP_SET_BASE_AUTOCONFIG:
    case STEP_SET_BASE_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_CONFIGURE_BASE; status.progress = 10 + step * 2; break;
    case STEP_SAVE_BASE: status.state = DRONECAN_PAIR_STATE_SAVE_BASE; status.progress = 35; break;
    case STEP_SET_ROVER_NODE:
    case STEP_SET_ROVER_TYPE:
    case STEP_SET_ROVER_AUTOCONFIG:
    case STEP_SET_ROVER_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_CONFIGURE_ROVER; status.progress = 38 + (step - STEP_SET_ROVER_NODE) * 5; break;
    case STEP_SAVE_ROVER: status.state = DRONECAN_PAIR_STATE_SAVE_ROVER; status.progress = 60; break;
    case STEP_RESTART_BASE: status.state = DRONECAN_PAIR_STATE_RESTART_BASE; status.progress = 64; break;
    case STEP_RESTART_ROVER: status.state = DRONECAN_PAIR_STATE_RESTART_ROVER; status.progress = 68; break;
    case STEP_WAIT_RECONNECT: status.state = DRONECAN_PAIR_STATE_WAIT_RECONNECT; status.progress = 72; break;
    case STEP_VERIFY_BASE_TYPE:
    case STEP_VERIFY_BASE_AUTOCONFIG:
    case STEP_VERIFY_BASE_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_VERIFY_BASE; status.progress = 76 + (step - STEP_VERIFY_BASE_TYPE) * 4; break;
    case STEP_VERIFY_ROVER_TYPE:
    case STEP_VERIFY_ROVER_AUTOCONFIG:
    case STEP_VERIFY_ROVER_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_VERIFY_ROVER; status.progress = 88 + (step - STEP_VERIFY_ROVER_TYPE) * 4; break;
    case STEP_COMPLETE:
        status.state = DRONECAN_PAIR_STATE_COMPLETE; status.progress = 100; break;
    default: break;
    }
}

static void advanceStep(void)
{
    retries = 0;
    pending.kind = REQUEST_NONE;
    switch (step) {
    case STEP_INFO_BASE: step = STEP_INFO_ROVER; break;
    case STEP_INFO_ROVER:
        step = command == DRONECAN_PAIR_COMMAND_CONFIGURE ? STEP_SET_BASE_NODE : STEP_VERIFY_BASE_TYPE;
        break;
    case STEP_SET_BASE_NODE: step = STEP_SET_BASE_TYPE; break;
    case STEP_SET_BASE_TYPE: step = STEP_SET_BASE_AUTOCONFIG; break;
    case STEP_SET_BASE_AUTOCONFIG: step = STEP_SET_BASE_TERMINATION; break;
    case STEP_SET_BASE_TERMINATION: step = STEP_SAVE_BASE; break;
    case STEP_SAVE_BASE: step = STEP_SET_ROVER_NODE; break;
    case STEP_SET_ROVER_NODE: step = STEP_SET_ROVER_TYPE; break;
    case STEP_SET_ROVER_TYPE: step = STEP_SET_ROVER_AUTOCONFIG; break;
    case STEP_SET_ROVER_AUTOCONFIG: step = STEP_SET_ROVER_TERMINATION; break;
    case STEP_SET_ROVER_TERMINATION: step = STEP_SAVE_ROVER; break;
    case STEP_SAVE_ROVER: step = STEP_RESTART_BASE; break;
    case STEP_RESTART_BASE: step = STEP_RESTART_ROVER; break;
    case STEP_RESTART_ROVER:
        reconnectStartedMs = millis();
        step = STEP_WAIT_RECONNECT;
        break;
    case STEP_VERIFY_BASE_TYPE: step = STEP_VERIFY_BASE_AUTOCONFIG; break;
    case STEP_VERIFY_BASE_AUTOCONFIG: step = STEP_VERIFY_BASE_TERMINATION; break;
    case STEP_VERIFY_BASE_TERMINATION: step = STEP_VERIFY_ROVER_TYPE; break;
    case STEP_VERIFY_ROVER_TYPE: step = STEP_VERIFY_ROVER_AUTOCONFIG; break;
    case STEP_VERIFY_ROVER_AUTOCONFIG: step = STEP_VERIFY_ROVER_TERMINATION; break;
    case STEP_VERIFY_ROVER_TERMINATION: step = STEP_COMPLETE; break;
    default: break;
    }
    setBroadState();
}

static bool sendCurrentStep(void)
{
    const dronecanConfig_t *config = dronecanConfig();
    switch (step) {
    case STEP_INFO_BASE: return sendNodeInfo(config->movingBaseNodeID);
    case STEP_INFO_ROVER: return sendNodeInfo(config->movingRoverNodeID);
    case STEP_SET_BASE_NODE: return sendParameter(config->movingBaseNodeID, PARAM_CAN_NODE, true, config->movingBaseNodeID);
    case STEP_SET_BASE_TYPE: return sendParameter(config->movingBaseNodeID, PARAM_GPS_TYPE, true, AP_PERIPH_MOVING_BASE_GPS_TYPE);
    case STEP_SET_BASE_AUTOCONFIG: return sendParameter(config->movingBaseNodeID, PARAM_GPS_AUTO_CONFIG, true, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_SET_BASE_TERMINATION:
        if (config->baseTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingBaseNodeID, PARAM_CAN_TERMINATE, true, terminationValue(config->baseTermination));
    case STEP_SAVE_BASE: return sendSave(config->movingBaseNodeID);
    case STEP_SET_ROVER_NODE: return sendParameter(config->movingRoverNodeID, PARAM_CAN_NODE, true, config->movingRoverNodeID);
    case STEP_SET_ROVER_TYPE: return sendParameter(config->movingRoverNodeID, PARAM_GPS_TYPE, true, AP_PERIPH_MOVING_ROVER_GPS_TYPE);
    case STEP_SET_ROVER_AUTOCONFIG: return sendParameter(config->movingRoverNodeID, PARAM_GPS_AUTO_CONFIG, true, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_SET_ROVER_TERMINATION:
        if (config->roverTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingRoverNodeID, PARAM_CAN_TERMINATE, true, terminationValue(config->roverTermination));
    case STEP_SAVE_ROVER: return sendSave(config->movingRoverNodeID);
    case STEP_RESTART_BASE:
        if (!sendRestart(config->movingBaseNodeID)) return false;
        advanceStep();
        return true;
    case STEP_RESTART_ROVER:
        if (!sendRestart(config->movingRoverNodeID)) return false;
        advanceStep();
        return true;
    case STEP_VERIFY_BASE_TYPE: return sendParameter(config->movingBaseNodeID, PARAM_GPS_TYPE, false, AP_PERIPH_MOVING_BASE_GPS_TYPE);
    case STEP_VERIFY_BASE_AUTOCONFIG: return sendParameter(config->movingBaseNodeID, PARAM_GPS_AUTO_CONFIG, false, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_VERIFY_BASE_TERMINATION:
        if (config->baseTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingBaseNodeID, PARAM_CAN_TERMINATE, false, terminationValue(config->baseTermination));
    case STEP_VERIFY_ROVER_TYPE: return sendParameter(config->movingRoverNodeID, PARAM_GPS_TYPE, false, AP_PERIPH_MOVING_ROVER_GPS_TYPE);
    case STEP_VERIFY_ROVER_AUTOCONFIG: return sendParameter(config->movingRoverNodeID, PARAM_GPS_AUTO_CONFIG, false, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_VERIFY_ROVER_TERMINATION:
        if (config->roverTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingRoverNodeID, PARAM_CAN_TERMINATE, false, terminationValue(config->roverTermination));
    case STEP_COMPLETE:
        status.baseRoleVerified = status.baseGpsType == AP_PERIPH_MOVING_BASE_GPS_TYPE;
        status.roverRoleVerified = status.roverGpsType == AP_PERIPH_MOVING_ROVER_GPS_TYPE;
        status.configured = status.baseRoleVerified && status.roverRoleVerified;
        status.state = DRONECAN_PAIR_STATE_COMPLETE;
        status.progress = 100;
        status.activeNodeID = 0;
        step = STEP_NONE;
        return true;
    default: return true;
    }
}

void dronecanPairInit(void)
{
    memset(&status, 0, sizeof(status));
    status.state = DRONECAN_PAIR_STATE_IDLE;
    status.baseNodeID = DRONECAN_NODE_ID_DISABLED;
    status.roverNodeID = DRONECAN_NODE_ID_DISABLED;
    status.baseGpsType = -1;
    status.roverGpsType = -1;
    status.baseAutoConfig = -1;
    status.roverAutoConfig = -1;
    status.baseTermination = -1;
    status.roverTermination = -1;
    status.baseAgeMs = UINT16_MAX;
    status.roverAgeMs = UINT16_MAX;
    status.relativeAgeMs = UINT16_MAX;
    status.relativeAccuracyCentidegrees = UINT16_MAX;
    pending.kind = REQUEST_NONE;
    step = STEP_NONE;
}

bool dronecanPairStartCommand(uint8_t requestedCommand)
{
    if (requestedCommand == DRONECAN_PAIR_COMMAND_ABORT) {
        pending.kind = REQUEST_NONE;
        step = STEP_NONE;
        status.state = DRONECAN_PAIR_STATE_ABORTED;
        status.activeNodeID = 0;
        return true;
    }
    if (requestedCommand != DRONECAN_PAIR_COMMAND_CONFIGURE && requestedCommand != DRONECAN_PAIR_COMMAND_VERIFY) {
        setError(DRONECAN_PAIR_ERROR_COMMAND);
        return false;
    }
    const dronecanConfig_t *config = dronecanConfig();
    if (config->movingBaseNodeID == DRONECAN_NODE_ID_DISABLED ||
        config->movingRoverNodeID == DRONECAN_NODE_ID_DISABLED) {
        setError(DRONECAN_PAIR_ERROR_BINDING_INCOMPLETE);
        return false;
    }
    if (config->movingBaseNodeID == config->movingRoverNodeID) {
        setError(DRONECAN_PAIR_ERROR_DUPLICATE_NODE);
        return false;
    }
    if (!nodeOnline(config->movingBaseNodeID)) {
        setError(DRONECAN_PAIR_ERROR_BASE_OFFLINE);
        return false;
    }
    if (!nodeOnline(config->movingRoverNodeID)) {
        setError(DRONECAN_PAIR_ERROR_ROVER_OFFLINE);
        return false;
    }

    const uint32_t requestCount = status.serviceRequestCount;
    const uint32_t responseCount = status.serviceResponseCount;
    const uint32_t timeoutCount = status.serviceTimeoutCount;
    const uint32_t headingCount = status.relativeHeadingCount;
    memset(&status, 0, sizeof(status));
    status.serviceRequestCount = requestCount;
    status.serviceResponseCount = responseCount;
    status.serviceTimeoutCount = timeoutCount;
    status.relativeHeadingCount = headingCount;
    status.baseNodeID = config->movingBaseNodeID;
    status.roverNodeID = config->movingRoverNodeID;
    status.baseGpsType = status.roverGpsType = -1;
    status.baseAutoConfig = status.roverAutoConfig = -1;
    status.baseTermination = status.roverTermination = -1;
    status.baseAgeMs = status.roverAgeMs = UINT16_MAX;
    status.relativeAgeMs = status.relativeAccuracyCentidegrees = UINT16_MAX;
    command = requestedCommand;
    step = STEP_INFO_BASE;
    retries = 0;
    pending.kind = REQUEST_NONE;
    setBroadState();
    return true;
}

void dronecanPairUpdate(void)
{
    if (step == STEP_NONE) {
        return;
    }
    const uint32_t now = millis();
    if (pending.kind != REQUEST_NONE) {
        if ((int32_t)(now - pending.deadlineMs) >= 0) {
            status.serviceTimeoutCount++;
            pending.kind = REQUEST_NONE;
            if (retries++ >= PAIR_MAX_RETRIES) {
                setError(DRONECAN_PAIR_ERROR_TIMEOUT);
            }
        }
        return;
    }
    if (step == STEP_WAIT_RECONNECT) {
        const dronecanConfig_t *config = dronecanConfig();
        status.baseOnline = nodeOnline(config->movingBaseNodeID);
        status.roverOnline = nodeOnline(config->movingRoverNodeID);
        const uint32_t elapsed = now - reconnectStartedMs;
        if (elapsed >= PAIR_RECONNECT_DELAY_MS && status.baseOnline && status.roverOnline) {
            step = STEP_VERIFY_BASE_TYPE;
            setBroadState();
        } else if (elapsed > PAIR_RECONNECT_TIMEOUT_MS) {
            setError(!status.baseOnline ? DRONECAN_PAIR_ERROR_BASE_OFFLINE : DRONECAN_PAIR_ERROR_ROVER_OFFLINE);
        }
        return;
    }
    if (!sendCurrentStep()) {
        setError(DRONECAN_PAIR_ERROR_TRANSMIT);
    }
}

bool dronecanPairShouldAcceptResponse(uint16_t dataTypeID, uint64_t *signature)
{
    switch (dataTypeID) {
    case UAVCAN_PROTOCOL_GETNODEINFO_ID: *signature = UAVCAN_PROTOCOL_GETNODEINFO_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_PARAM_GETSET_ID: *signature = UAVCAN_PROTOCOL_PARAM_GETSET_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID: *signature = UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_RESTARTNODE_ID: *signature = UAVCAN_PROTOCOL_RESTARTNODE_RESPONSE_SIGNATURE; return true;
    default: return false;
    }
}

static void storeParameterValue(pairParameter_e parameter, uint8_t nodeID, int64_t value)
{
    const bool base = nodeID == dronecanConfig()->movingBaseNodeID;
    switch (parameter) {
    case PARAM_GPS_TYPE: if (base) status.baseGpsType = value; else status.roverGpsType = value; break;
    case PARAM_GPS_AUTO_CONFIG: if (base) status.baseAutoConfig = value; else status.roverAutoConfig = value; break;
    case PARAM_CAN_TERMINATE: if (base) status.baseTermination = value; else status.roverTermination = value; break;
    default: break;
    }
}

bool dronecanPairHandleResponse(const CanardRxTransfer *transfer)
{
    if (pending.kind == REQUEST_NONE || transfer->source_node_id != pending.nodeID) {
        return false;
    }
    status.serviceResponseCount++;

    if (pending.kind == REQUEST_NODE_INFO && transfer->data_type_id == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        struct uavcan_protocol_GetNodeInfoResponse response;
        if (uavcan_protocol_GetNodeInfoResponse_decode(transfer, &response)) {
            setError(DRONECAN_PAIR_ERROR_IDENTITY);
            return true;
        }
        const bool base = transfer->source_node_id == dronecanConfig()->movingBaseNodeID;
        char *name = base ? status.baseName : status.roverName;
        copyName(name, response.name.data, response.name.len);
        const bool compatible = compatibleIdentity(name);
        if (base) {
            status.baseSoftwareMajor = response.software_version.major;
            status.baseSoftwareMinor = response.software_version.minor;
            status.baseIdentityValid = compatible;
        } else {
            status.roverSoftwareMajor = response.software_version.major;
            status.roverSoftwareMinor = response.software_version.minor;
            status.roverIdentityValid = compatible;
        }
        if ((dronecanConfig()->pairFlags & DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY) && !compatible) {
            setError(DRONECAN_PAIR_ERROR_IDENTITY);
            return true;
        }
        advanceStep();
        return true;
    }

    if (pending.kind == REQUEST_PARAMETER && transfer->data_type_id == UAVCAN_PROTOCOL_PARAM_GETSET_ID) {
        struct uavcan_protocol_param_GetSetResponse response;
        if (uavcan_protocol_param_GetSetResponse_decode(transfer, &response) || response.name.len == 0 ||
            response.value.union_tag != UAVCAN_PROTOCOL_PARAM_VALUE_INTEGER_VALUE) {
            setError(DRONECAN_PAIR_ERROR_PARAMETER_MISSING);
            return true;
        }
        const int64_t value = response.value.integer_value;
        storeParameterValue(pending.parameter, pending.nodeID, value);
        if (pending.write && value != pending.expectedValue) {
            setError(DRONECAN_PAIR_ERROR_PARAMETER_REJECTED);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_GPS_TYPE && value != pending.expectedValue) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_GPS_AUTO_CONFIG && value < 1) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_CAN_TERMINATE && value != pending.expectedValue) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        advanceStep();
        return true;
    }

    if (pending.kind == REQUEST_SAVE && transfer->data_type_id == UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID) {
        struct uavcan_protocol_param_ExecuteOpcodeResponse response;
        if (uavcan_protocol_param_ExecuteOpcodeResponse_decode(transfer, &response) || !response.ok) {
            setError(DRONECAN_PAIR_ERROR_SAVE);
            return true;
        }
        advanceStep();
        return true;
    }

    return false;
}

void dronecanPairRecordRelPosHeading(uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message)
{
    if (!message || sourceNodeID != dronecanConfig()->movingRoverNodeID) {
        return;
    }
    status.relativeHeadingCentidegrees = constrain(lrintf(message->reported_heading_deg * 100.0F), 0, 35999);
    status.relativeAccuracyCentidegrees = message->reported_heading_acc_available
        ? constrain(lrintf(fabsf(message->reported_heading_acc_deg) * 100.0F), 0, UINT16_MAX)
        : UINT16_MAX;
    status.relativeDistanceCm = isfinite(message->relative_distance_m)
        ? constrain(lrintf(message->relative_distance_m * 100.0F), 0, UINT16_MAX) : 0;
    lastRelPosMs = millis();
    status.relativeHeadingCount++;
}

const dronecanPairStatus_t *dronecanPairGetStatus(void)
{
    const dronecanConfig_t *config = dronecanConfig();
    status.baseNodeID = config->movingBaseNodeID;
    status.roverNodeID = config->movingRoverNodeID;
    status.baseOnline = nodeOnline(config->movingBaseNodeID);
    status.roverOnline = nodeOnline(config->movingRoverNodeID);

    gpsDronecanNodeStatus_t gpsStatus;
    if (gpsDronecanGetNodeStatus(config->movingBaseNodeID, &gpsStatus)) {
        status.baseFixType = gpsStatus.fixType;
        status.baseSatellites = gpsStatus.satellites;
        status.baseAgeMs = MIN(gpsStatus.ageMs, UINT16_MAX);
    } else {
        status.baseFixType = 0;
        status.baseSatellites = 0;
        status.baseAgeMs = UINT16_MAX;
    }
    if (gpsDronecanGetNodeStatus(config->movingRoverNodeID, &gpsStatus)) {
        status.roverFixType = gpsStatus.fixType;
        status.roverSatellites = gpsStatus.satellites;
        status.roverAgeMs = MIN(gpsStatus.ageMs, UINT16_MAX);
    } else {
        status.roverFixType = 0;
        status.roverSatellites = 0;
        status.roverAgeMs = UINT16_MAX;
    }
    status.relativeAgeMs = lastRelPosMs ? MIN(millis() - lastRelPosMs, UINT16_MAX) : UINT16_MAX;
    status.relativeHeadingFresh = status.relativeAgeMs <= 1000U;
    status.baseRoleVerified = status.baseGpsType == AP_PERIPH_MOVING_BASE_GPS_TYPE;
    status.roverRoleVerified = status.roverGpsType == AP_PERIPH_MOVING_ROVER_GPS_TYPE;
    status.configured = status.baseRoleVerified && status.roverRoleVerified;
    return &status;
}

#endif
'''


def write_sources(root: Path) -> None:
    (root / "src/main/drivers/dronecan/dronecan.h").write_text(DRONECAN_H, encoding="utf-8")
    (root / "src/main/io/gps_dronecan.h").write_text(GPS_DRONECAN_H, encoding="utf-8")
    (root / "src/main/io/gps_dronecan.c").write_text(GPS_DRONECAN_C, encoding="utf-8")
    (root / "src/main/drivers/dronecan/dronecan_pair.h").write_text(DRONECAN_PAIR_H, encoding="utf-8")
    (root / "src/main/drivers/dronecan/dronecan_pair.c").write_text(DRONECAN_PAIR_C, encoding="utf-8")


def patch_dronecan_core(root: Path) -> None:
    path = root / "src/main/drivers/dronecan/dronecan.c"
    replace_once(path, '#include "drivers/dronecan/dronecan.h"\n',
        '#include "drivers/dronecan/dronecan.h"\n#include "drivers/dronecan/dronecan_pair.h"\n')
    replace_once(path, "#define DRONECAN_MEMORY_POOL_SIZE 2048U", "#define DRONECAN_MEMORY_POOL_SIZE 4096U")
    replace_once(path, "PG_REGISTER_WITH_RESET_TEMPLATE(dronecanConfig_t, dronecanConfig, PG_DRONECAN_CONFIG, 1);",
        "PG_REGISTER_WITH_RESET_TEMPLATE(dronecanConfig_t, dronecanConfig, PG_DRONECAN_CONFIG, 2);")
    replace_once(path,
        '''    .primaryGpsSource = GPS_PRIMARY_SOURCE_UART,
    .magNodeID = DRONECAN_NODE_ID_DISABLED
);''',
        '''    .primaryGpsSource = GPS_PRIMARY_SOURCE_UART,
    .magNodeID = DRONECAN_NODE_ID_DISABLED,
    .movingBaseNodeID = DRONECAN_NODE_ID_DISABLED,
    .movingRoverNodeID = DRONECAN_NODE_ID_DISABLED,
    .pairFlags = DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY,
    .baseTermination = DRONECAN_TERMINATION_UNCHANGED,
    .roverTermination = DRONECAN_TERMINATION_UNCHANGED
);''')
    replace_once(path,
        '''        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING);
#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)
        flightCommanderHeadingReceiveDronecanRelPosHeading(transfer->source_node_id, &message);
#endif
''',
        '''        dronecanMarkNodeCapability(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_RELATIVE_HEADING);
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
        dronecanPairRecordRelPosHeading(transfer->source_node_id, &message);
#endif
#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)
        flightCommanderHeadingReceiveDronecanRelPosHeading(transfer->source_node_id, &message);
#endif
''')
    replace_once(path,
        '''    if (transferType == CanardTransferTypeRequest && dataTypeID == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        *signature = UAVCAN_PROTOCOL_GETNODEINFO_REQUEST_SIGNATURE;
        return true;
    }
    if (transferType != CanardTransferTypeBroadcast) {
        return false;
    }
''',
        '''    if (transferType == CanardTransferTypeRequest && dataTypeID == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        *signature = UAVCAN_PROTOCOL_GETNODEINFO_REQUEST_SIGNATURE;
        return true;
    }
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transferType == CanardTransferTypeResponse && dronecanPairShouldAcceptResponse(dataTypeID, signature)) {
        return true;
    }
#endif
    if (transferType != CanardTransferTypeBroadcast) {
        return false;
    }
''')
    replace_once(path,
        '''    if (transfer->transfer_type == CanardTransferTypeRequest &&
        transfer->data_type_id == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        handleGetNodeInfo(instance, transfer);
        return;
    }
    if (transfer->transfer_type != CanardTransferTypeBroadcast) {
        return;
    }
''',
        '''    if (transfer->transfer_type == CanardTransferTypeRequest &&
        transfer->data_type_id == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        handleGetNodeInfo(instance, transfer);
        return;
    }
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    if (transfer->transfer_type == CanardTransferTypeResponse && dronecanPairHandleResponse(transfer)) {
        return;
    }
#endif
    if (transfer->transfer_type != CanardTransferTypeBroadcast) {
        return;
    }
''')
    replace_once(path,
        '''    activeNodeCount = 0;
    if (canardSTM32CAN1_Init(activeBitrate) != CANARD_OK) {''',
        '''    activeNodeCount = 0;
#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairInit();
#endif
    if (canardSTM32CAN1_Init(activeBitrate) != CANARD_OK) {''')
    replace_once(path,
        '''    processTxQueue();

    if (!nextOneHz || currentTimeUs >= nextOneHz) {''',
        '''#if defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)
    dronecanPairUpdate();
#endif
    processTxQueue();

    if (!nextOneHz || currentTimeUs >= nextOneHz) {''')
    append = r'''

bool dronecanSendServiceRequest(uint8_t destinationNodeID, uint64_t signature,
    uint8_t dataTypeID, uint8_t *transferID, const void *payload, uint16_t payloadLength)
{
    if (!initialized || destinationNodeID < 1 || destinationNodeID > 127 || !transferID) {
        return false;
    }
    return canardRequestOrRespond(&canard, destinationNodeID, signature, dataTypeID,
        transferID, CANARD_TRANSFER_PRIORITY_MEDIUM, CanardRequest, payload, payloadLength) >= 0;
}

const dronecanNodeInfo_t *dronecanGetNodeById(uint8_t nodeID)
{
    return findNode(nodeID, false);
}
'''
    value = path.read_text(encoding="utf-8")
    if "bool dronecanSendServiceRequest(" not in value:
        marker = "\n#endif\n"
        insertion = value.rfind(marker)
        if insertion < 0:
            raise RuntimeError("dronecan.c has no final preprocessor terminator")
        value = value[:insertion] + append + value[insertion:]
        path.write_text(value, encoding="utf-8")


def patch_heading(root: Path) -> None:
    path = root / "src/main/flight_commander/heading_fusion.c"
    replace_once(path,
        '''    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->gpsNodeID, sourceNodeID) || !message->heading_valid) {
        return;
    }
    const bool fixedSolution = gpsDronecanIsHealthy() && gpsDronecanNodeId() == sourceNodeID &&
        gpsDronecanSol.fixType == GPS_FIX_RTK_FIXED;
''',
        '''    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->movingRoverNodeID, sourceNodeID) || !message->heading_valid) {
        return;
    }
    gpsDronecanNodeStatus_t roverStatus;
    const bool fixedSolution = gpsDronecanGetNodeStatus(sourceNodeID, &roverStatus) &&
        roverStatus.healthy && roverStatus.fixType == GPS_FIX_RTK_FIXED;
''')
    replace_once(path,
        '''    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->gpsNodeID, sourceNodeID)) {
        return;
    }
    const bool fixedSolution = gpsDronecanIsHealthy() && gpsDronecanNodeId() == sourceNodeID &&
        gpsDronecanSol.fixType == GPS_FIX_RTK_FIXED;
''',
        '''    if (!baselineProviderEnabled(FLIGHT_COMMANDER_BASELINE_DRONECAN) ||
        !selectedNode(dronecanConfig()->movingRoverNodeID, sourceNodeID)) {
        return;
    }
    gpsDronecanNodeStatus_t roverStatus;
    const bool fixedSolution = gpsDronecanGetNodeStatus(sourceNodeID, &roverStatus) &&
        roverStatus.healthy && roverStatus.fixType == GPS_FIX_RTK_FIXED;
''')
    replace_text(path, "dronecanConfig()->gpsNodeID == DRONECAN_NODE_ID_DISABLED",
        "dronecanConfig()->movingRoverNodeID == DRONECAN_NODE_ID_DISABLED")


def patch_msp(root: Path) -> None:
    protocol = root / "src/main/msp/msp_protocol_v2_flight_commander.h"
    replace_once(protocol,
        "#define MSP2_FLIGHT_COMMANDER_DRONECAN_NODES 0x2F12\n",
        "#define MSP2_FLIGHT_COMMANDER_DRONECAN_NODES 0x2F12\n"
        "#define MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_STATUS    0x2F13\n"
        "#define MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_COMMAND   0x2F14\n")

    fc_msp = root / "src/main/fc/fc_msp.c"
    replace_once(fc_msp, '#include "drivers/dronecan/dronecan.h"\n',
        '#include "drivers/dronecan/dronecan.h"\n#include "drivers/dronecan/dronecan_pair.h"\n')
    replace_once(fc_msp,
        '''    case MSP2_FLIGHT_COMMANDER_DRONECAN_CONFIG:
        sbufWriteU8(dst, dronecanConfig()->nodeID);
        sbufWriteU8(dst, dronecanConfig()->bitRateKbps);
        sbufWriteU8(dst, dronecanConfig()->gpsNodeID);
        sbufWriteU8(dst, dronecanConfig()->batteryNodeID);
        sbufWriteU8(dst, dronecanConfig()->primaryGpsSource);
        sbufWriteU8(dst, dronecanConfig()->magNodeID);
        break;
''',
        '''    case MSP2_FLIGHT_COMMANDER_DRONECAN_CONFIG:
        sbufWriteU8(dst, DRONECAN_CONFIG_SCHEMA);
        sbufWriteU8(dst, dronecanConfig()->nodeID);
        sbufWriteU8(dst, dronecanConfig()->bitRateKbps);
        sbufWriteU8(dst, dronecanConfig()->gpsNodeID);
        sbufWriteU8(dst, dronecanConfig()->batteryNodeID);
        sbufWriteU8(dst, dronecanConfig()->primaryGpsSource);
        sbufWriteU8(dst, dronecanConfig()->magNodeID);
        sbufWriteU8(dst, dronecanConfig()->movingBaseNodeID);
        sbufWriteU8(dst, dronecanConfig()->movingRoverNodeID);
        sbufWriteU8(dst, dronecanConfig()->pairFlags);
        sbufWriteU8(dst, dronecanConfig()->baseTermination);
        sbufWriteU8(dst, dronecanConfig()->roverTermination);
        break;

    case MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_STATUS: {
        const dronecanPairStatus_t *pair = dronecanPairGetStatus();
        uint8_t flags = (pair->baseOnline ? 1U : 0U) |
            (pair->roverOnline ? 2U : 0U) |
            (pair->baseRoleVerified ? 4U : 0U) |
            (pair->roverRoleVerified ? 8U : 0U) |
            (pair->baseIdentityValid ? 16U : 0U) |
            (pair->roverIdentityValid ? 32U : 0U) |
            (pair->relativeHeadingFresh ? 64U : 0U) |
            (pair->configured ? 128U : 0U);
        sbufWriteU8(dst, DRONECAN_PAIR_STATUS_SCHEMA);
        sbufWriteU8(dst, pair->state);
        sbufWriteU8(dst, pair->progress);
        sbufWriteU8(dst, pair->errorCode);
        sbufWriteU8(dst, pair->activeNodeID);
        sbufWriteU8(dst, flags);
        sbufWriteU8(dst, pair->baseNodeID);
        sbufWriteU8(dst, pair->roverNodeID);
        sbufWriteU8(dst, pair->baseFixType);
        sbufWriteU8(dst, pair->baseSatellites);
        sbufWriteU16(dst, pair->baseAgeMs);
        sbufWriteU8(dst, pair->roverFixType);
        sbufWriteU8(dst, pair->roverSatellites);
        sbufWriteU16(dst, pair->roverAgeMs);
        sbufWriteU16(dst, pair->baseGpsType);
        sbufWriteU16(dst, pair->roverGpsType);
        sbufWriteU16(dst, pair->baseAutoConfig);
        sbufWriteU16(dst, pair->roverAutoConfig);
        sbufWriteU16(dst, pair->baseTermination);
        sbufWriteU16(dst, pair->roverTermination);
        sbufWriteU16(dst, pair->relativeHeadingCentidegrees);
        sbufWriteU16(dst, pair->relativeAccuracyCentidegrees);
        sbufWriteU16(dst, pair->relativeDistanceCm);
        sbufWriteU16(dst, pair->relativeAgeMs);
        sbufWriteU32(dst, pair->relativeHeadingCount);
        sbufWriteU32(dst, pair->serviceRequestCount);
        sbufWriteU32(dst, pair->serviceResponseCount);
        sbufWriteU32(dst, pair->serviceTimeoutCount);
        sbufWriteU8(dst, pair->baseSoftwareMajor);
        sbufWriteU8(dst, pair->baseSoftwareMinor);
        sbufWriteU8(dst, pair->roverSoftwareMajor);
        sbufWriteU8(dst, pair->roverSoftwareMinor);
        for (unsigned index = 0; index < 32; index++) sbufWriteU8(dst, pair->baseName[index]);
        for (unsigned index = 0; index < 32; index++) sbufWriteU8(dst, pair->roverName[index]);
        break;
    }
''')
    replace_once(fc_msp,
        '''    case MSP2_FLIGHT_COMMANDER_SET_DRONECAN_CONFIG:
        if (dataSize != 6) {
            return MSP_RESULT_ERROR;
        }
        dronecanConfigMutable()->nodeID = sbufReadU8(src);
        dronecanConfigMutable()->bitRateKbps = sbufReadU8(src);
        dronecanConfigMutable()->gpsNodeID = sbufReadU8(src);
        dronecanConfigMutable()->batteryNodeID = sbufReadU8(src);
        dronecanConfigMutable()->primaryGpsSource = sbufReadU8(src);
        dronecanConfigMutable()->magNodeID = sbufReadU8(src);
        return MSP_RESULT_ACK;
''',
        '''    case MSP2_FLIGHT_COMMANDER_SET_DRONECAN_CONFIG: {
        if (dataSize != 12 || sbufReadU8(src) != DRONECAN_CONFIG_SCHEMA) {
            return MSP_RESULT_ERROR;
        }
        dronecanConfig_t *config = dronecanConfigMutable();
        config->nodeID = sbufReadU8(src);
        config->bitRateKbps = sbufReadU8(src);
        config->gpsNodeID = sbufReadU8(src);
        config->batteryNodeID = sbufReadU8(src);
        config->primaryGpsSource = sbufReadU8(src);
        config->magNodeID = sbufReadU8(src);
        config->movingBaseNodeID = sbufReadU8(src);
        config->movingRoverNodeID = sbufReadU8(src);
        config->pairFlags = sbufReadU8(src);
        config->baseTermination = sbufReadU8(src);
        config->roverTermination = sbufReadU8(src);
        if (config->movingBaseNodeID != DRONECAN_NODE_ID_DISABLED &&
            config->movingBaseNodeID == config->movingRoverNodeID) {
            return MSP_RESULT_ERROR;
        }
        return MSP_RESULT_ACK;
    }

    case MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_COMMAND:
        if (dataSize != 2 || ARMING_FLAG(ARMED) || sbufReadU8(src) != DRONECAN_PAIR_COMMAND_SCHEMA) {
            return MSP_RESULT_ERROR;
        }
        return dronecanPairStartCommand(sbufReadU8(src)) ? MSP_RESULT_ACK : MSP_RESULT_ERROR;
''')


def patch_build(root: Path) -> None:
    for path in [root / "CMakeLists.txt", root / "flight-commander/build-micoair743.sh"]:
        replace_text(path, "3.0.7", VERSION)

    header = root / "src/main/build/flight_commander.h"
    replace_text(header, "FLIGHT_COMMANDER_VERSION_MAJOR 3", "FLIGHT_COMMANDER_VERSION_MAJOR 4")
    replace_text(header, "FLIGHT_COMMANDER_VERSION_PATCH 7", "FLIGHT_COMMANDER_VERSION_PATCH 0")
    replace_once(header,
        "    FLIGHT_COMMANDER_CAPABILITY_MOVING_BASELINE_YAW = (1U << 12),\n",
        "    FLIGHT_COMMANDER_CAPABILITY_MOVING_BASELINE_YAW = (1U << 12),\n"
        "    FLIGHT_COMMANDER_CAPABILITY_DRONECAN_MOVING_BASELINE_MANAGER = (1U << 13),\n")
    replace_text(header, "0x1FFFU", "0x3FFFU")

    overlay = root / "cmake/flight-commander-micoair743.cmake"
    value = overlay.read_text(encoding="utf-8")
    addition = r'''

target_sources(MICOAIR743.elf PRIVATE
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_pair.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.GetNodeInfo_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_res.c
)

target_compile_definitions(MICOAIR743.elf PRIVATE
    USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER
)
'''
    if "dronecan_pair.c" not in value:
        overlay.write_text(value + addition, encoding="utf-8")

    verifier = root / "flight-commander/verify-release.py"
    value = verifier.read_text(encoding="utf-8")
    value = value.replace("3.0.7", VERSION)
    value = value.replace('VERSION = "3.0.7"', f'VERSION = "{VERSION}"')
    value = re.sub(r'EXPECTED_IDENTITY = .*',
        'EXPECTED_IDENTITY = b"FCFW" + bytes((1, 4, 0, 0, 9, 1, 0, 0xFF, 0x3F, 0, 0))', value)
    value = value.replace(r"FLIGHT_COMMANDER_VERSION_MAJOR 3", r"FLIGHT_COMMANDER_VERSION_MAJOR 4")
    value = value.replace(r"FLIGHT_COMMANDER_VERSION_PATCH 7", r"FLIGHT_COMMANDER_VERSION_PATCH 0")
    value = value.replace(r"0x1FFFU", r"0x3FFFU")
    verifier.write_text(value, encoding="utf-8")

    for script in (root / "flight-commander").glob("verify*.py"):
        value = script.read_text(encoding="utf-8")
        value = value.replace("3.0.7", VERSION)
        value = value.replace("bytes((1, 3, 0, 7", "bytes((1, 4, 0, 0")
        value = value.replace("0xFF, 0x1F, 0, 0", "0xFF, 0x3F, 0, 0")
        script.write_text(value, encoding="utf-8")


def write_manifest(root: Path) -> tuple[str, str]:
    revision, tree = source_identities(root)
    manifest = {
        "schema": 1,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "target": "MICOAIR743",
        "inav_release": "9.1.0",
        "inav_commit": "e519b69b02e27c8bdc03b4a0889f1baaae211a54",
        "source_revision": revision,
        "source_tree": tree,
        "source_hash_scheme": "sha1(sorted sha256sum records, excluding RELEASE-MANIFEST.json)",
        "source_tree_hash_scheme": "sha1('flight-commander-source-tree-v1\\n' plus sorted sha256sum records, excluding RELEASE-MANIFEST.json)",
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "capabilities": "0x00003fff",
        "artifact": {
            "filename": "Flight-Commander-Firmware-4.0.0-MICOAIR743.hex",
            "sha256": "PENDING_BUILD",
            "bytes": 0,
        },
        "bench_acceptance": {
            "mapping": {"x": "-native_y", "y": "-native_x", "z": "native_z"},
            "user_alignment": "CW0_DEG",
            "result": "accepted-3.0.7-baseline-preserved",
        },
        "moving_baseline": {
            "module_family": "Holybro DroneCAN H-RTK F9P / AP_Periph compatible",
            "moving_base_gps_type": 17,
            "moving_rover_gps_type": 18,
            "relative_heading_message": "ardupilot.gnss.RelPosHeading",
            "configuration": "one-stage remote parameter setup and verification",
        },
    }
    (root / "RELEASE-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return revision, tree


def prepare(archive: Path, output: Path) -> tuple[Path, str, str]:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    with zipfile.ZipFile(archive) as handle:
        handle.extractall(output)
    children = [path for path in output.iterdir() if path.is_dir()]
    if len(children) != 1:
        raise RuntimeError("Expected one firmware source root in retained archive")
    original = children[0]
    root = output / "Flight-Commander-Firmware-Source-v4.0.0"
    original.rename(root)

    write_sources(root)
    patch_dronecan_core(root)
    patch_heading(root)
    patch_msp(root)
    patch_build(root)
    revision, tree = write_manifest(root)
    print(json.dumps({"root": str(root), "source_revision": revision, "source_tree": tree}))
    return root, revision, tree


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.archive.resolve(), args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
