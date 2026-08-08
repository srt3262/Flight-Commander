/*
 * Flight Commander target-scoped external compass support.
 *
 * This file is free software: you may copy, redistribute and/or modify it
 * under the terms of the GNU General Public License Version 3.
 */

#pragma once

#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_HEADING_FUSION)

#include <stdbool.h>
#include <stdint.h>

#include "common/time.h"
#include "common/vector.h"

void flightCommanderExternalCompassInit(void);
void flightCommanderExternalCompassUpdate(timeUs_t currentTimeUs);
bool flightCommanderExternalCompassIsConfigured(void);
bool flightCommanderExternalCompassIsDetected(void);
bool flightCommanderExternalCompassHardwareSupported(uint8_t hardware);
bool flightCommanderExternalCompassGetSample(fpVector3_t *raw, timeMs_t *updatedAtMs);

#endif
