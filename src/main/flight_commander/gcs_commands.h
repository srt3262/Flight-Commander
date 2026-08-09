/*
 * Flight Commander Firmware additions are licensed under GNU GPL v3.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "fc/rc_modes.h"

bool flightCommanderGcsModeIsActive(boxId_e modeId);
void flightCommanderGcsObserveRcModes(const boxBitmask_t *rcModes);
bool flightCommanderGcsIsEnabled(void);

bool flightCommanderGcsTakeArmControl(void);
void flightCommanderGcsReleaseArmControl(void);
bool flightCommanderGcsSetMode(boxId_e modeId);
bool flightCommanderGcsSetModeByPermanentId(uint8_t permanentId);
bool flightCommanderGcsStageMissionIndex(uint8_t index);
bool flightCommanderGcsStartMission(uint8_t index);
bool flightCommanderGcsActivateRth(void);
bool flightCommanderGcsActivateLand(void);
void flightCommanderGcsReset(void);
