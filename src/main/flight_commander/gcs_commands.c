/*
 * Flight Commander Firmware additions are licensed under GNU GPL v3.
 */

#include <stdbool.h>
#include <stdint.h>

#include "platform.h"

#ifdef USE_FLIGHT_COMMANDER_GCS_COMMANDS

#include "common/bitarray.h"
#include "common/utils.h"

#include "fc/fc_msp_box.h"
#include "fc/rc_modes.h"
#include "fc/runtime_config.h"

#include "navigation/navigation.h"

#include "flight_commander/gcs_commands.h"

static boxId_e requestedMode = CHECKBOX_ITEM_COUNT;
static boxBitmask_t previousRcModes;
static bool previousRcModesValid;
static bool armControlActive;
static bool forcedRthActive;
static bool forcedLandingActive;
static bool missionIndexStaged;
static bool missionStartPending;
static uint8_t stagedMissionIndex;

static const boxId_e pilotModeControls[] = {
    BOXANGLE,
    BOXHORIZON,
    BOXNAVALTHOLD,
    BOXHEADINGHOLD,
    BOXNAVRTH,
    BOXNAVPOSHOLD,
    BOXMANUAL,
    BOXNAVWP,
    BOXGCSNAV,
    BOXNAVLAUNCH,
    BOXNAVCOURSEHOLD,
    BOXNAVCRUISE,
};

static bool isCommandableMode(boxId_e modeId)
{
    // GCS NAV is the pilot-controlled authorization gate. It must never be
    // possible for a MAVLink command to enable its own authority.
    if (modeId == BOXGCSNAV) {
        return false;
    }
    for (unsigned index = 0; index < ARRAYLEN(pilotModeControls); index++) {
        if (pilotModeControls[index] == modeId) {
            return true;
        }
    }
    return false;
}

static bool hasCommandControl(void)
{
    return requestedMode != CHECKBOX_ITEM_COUNT || forcedRthActive || forcedLandingActive || missionIndexStaged;
}

static void clearNavigationCommands(void)
{
    requestedMode = CHECKBOX_ITEM_COUNT;
    missionIndexStaged = false;
    missionStartPending = false;

    // A disarm has already stopped navigation. Avoid injecting another FSM
    // transition from the disarm path, but cancel GCS-owned commands whenever
    // the pilot changes modes while the aircraft is still armed.
    if (ARMING_FLAG(ARMED)) {
        if (forcedRthActive) {
            abortForcedRTH();
        }
        if (forcedLandingActive) {
            abortForcedEmergLanding();
        }
    }
    forcedRthActive = false;
    forcedLandingActive = false;
}

bool flightCommanderGcsModeIsActive(boxId_e modeId)
{
    return requestedMode == modeId || (modeId == BOXARM && armControlActive);
}

bool flightCommanderGcsIsEnabled(void)
{
    // Read the physical/configured input mask, not IS_RC_MODE_ACTIVE(), so a
    // virtual command can never satisfy its own authorization check.
    return isRcModeActiveFromInput(BOXGCSNAV);
}

void flightCommanderGcsObserveRcModes(const boxBitmask_t *rcModes)
{
    if (!rcModes) {
        return;
    }

    bool pilotModeChanged = false;
    bool pilotArmChanged = false;
    bool gcsNavWasActive = false;
    bool gcsNavIsActive = bitArrayGet(rcModes->bits, BOXGCSNAV);
    if (previousRcModesValid) {
        gcsNavWasActive = bitArrayGet(previousRcModes.bits, BOXGCSNAV);
        pilotArmChanged = bitArrayGet(previousRcModes.bits, BOXARM) != bitArrayGet(rcModes->bits, BOXARM);
        for (unsigned index = 0; index < ARRAYLEN(pilotModeControls); index++) {
            const boxId_e modeId = pilotModeControls[index];
            if (bitArrayGet(previousRcModes.bits, modeId) != bitArrayGet(rcModes->bits, modeId)) {
                pilotModeChanged = true;
                break;
            }
        }
    }

    previousRcModes = *rcModes;
    previousRcModesValid = true;

    // The physical mode controls remain an independent pilot override. A
    // deliberate switch change cancels a persistent GCS request even if the
    // telemetry link has subsequently been lost.
    if (pilotModeChanged && hasCommandControl()) {
        clearNavigationCommands();
    }
    if (pilotArmChanged || (gcsNavWasActive && !gcsNavIsActive)) {
        armControlActive = false;
    }

    // Mission start is deliberately staged without asserting NAV WP while
    // disarmed, because iNav must reject arming with an already-active NAV
    // mode. Apply the retained item and mode only after normal arming succeeds.
    if (missionIndexStaged && ARMING_FLAG(ARMED) && gcsNavIsActive) {
        if (navSetActiveWaypointIndex(stagedMissionIndex)) {
            missionIndexStaged = false;
            if (missionStartPending) {
                requestedMode = BOXNAVWP;
                missionStartPending = false;
            }
        } else {
            clearNavigationCommands();
        }
    }
}

bool flightCommanderGcsTakeArmControl(void)
{
    if (!flightCommanderGcsIsEnabled()) {
        return false;
    }
    armControlActive = true;
    return true;
}

void flightCommanderGcsReleaseArmControl(void)
{
    armControlActive = false;
}

bool flightCommanderGcsSetMode(boxId_e modeId)
{
    if (!flightCommanderGcsIsEnabled() || !isCommandableMode(modeId)) {
        return false;
    }
    if (modeId == BOXNAVWP && !ARMING_FLAG(ARMED)) {
        return flightCommanderGcsStartMission(missionIndexStaged ? stagedMissionIndex : 0);
    }
    clearNavigationCommands();
    requestedMode = modeId;
    return true;
}

bool flightCommanderGcsSetModeByPermanentId(uint8_t permanentId)
{
    const box_t *box = findBoxByPermanentId(permanentId);
    return box && flightCommanderGcsSetMode((boxId_e)box->boxId);
}

bool flightCommanderGcsStageMissionIndex(uint8_t index)
{
    if (!flightCommanderGcsIsEnabled() || !navSetActiveWaypointIndex(index)) {
        return false;
    }
    if (ARMING_FLAG(ARMED)) {
        missionIndexStaged = false;
        if (missionStartPending) {
            requestedMode = BOXNAVWP;
            missionStartPending = false;
        }
    } else {
        missionIndexStaged = true;
        stagedMissionIndex = index;
    }
    return true;
}

bool flightCommanderGcsStartMission(uint8_t index)
{
    if (!flightCommanderGcsIsEnabled()) {
        return false;
    }

    clearNavigationCommands();
    if (!navSetActiveWaypointIndex(index)) {
        return false;
    }

    if (ARMING_FLAG(ARMED)) {
        requestedMode = BOXNAVWP;
    } else {
        stagedMissionIndex = index;
        missionIndexStaged = true;
        missionStartPending = true;
    }
    return true;
}

bool flightCommanderGcsActivateRth(void)
{
    if (!flightCommanderGcsIsEnabled() || !ARMING_FLAG(ARMED)) {
        return false;
    }
    clearNavigationCommands();
    forcedRthActive = true;
    activateForcedRTH();
    if (getStateOfForcedRTH() != RTH_IDLE) {
        return true;
    }
    abortForcedRTH();
    forcedRthActive = false;
    return false;
}

bool flightCommanderGcsActivateLand(void)
{
    if (!flightCommanderGcsIsEnabled() || !ARMING_FLAG(ARMED)) {
        return false;
    }
    clearNavigationCommands();
    forcedLandingActive = true;
    activateForcedEmergLanding();
    if (navigationIsExecutingAnEmergencyLanding()) {
        return true;
    }
    abortForcedEmergLanding();
    forcedLandingActive = false;
    return false;
}

void flightCommanderGcsReset(void)
{
    armControlActive = false;
    clearNavigationCommands();
}

#endif
