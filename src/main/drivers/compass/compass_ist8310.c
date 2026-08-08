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
#include <string.h>

#include "platform.h"

#ifdef USE_MAG_IST8310

#include "common/axis.h"
#include "common/maths.h"
#include "common/utils.h"

#include "drivers/bus.h"
#include "drivers/compass/compass.h"
#include "drivers/compass/compass_ist8310.h"
#include "drivers/time.h"

#define IST8310_REG_WHOAMI 0x00
#define IST8310_REG_STATUS1 0x02
#define IST8310_REG_CNTRL1 0x0A
#define IST8310_REG_CNTRL2 0x0B
#define IST8310_REG_AVERAGE 0x41
#define IST8310_REG_PDCNTL 0x42

#define IST8310_CHIP_ID 0x10
#define IST8310_STATUS1_DRDY 0x01
#define IST8310_ODR_SINGLE 0x01
#define IST8310_AVG_16 0x24
#define IST8310_PULSE_DURATION_NORMAL 0xC0
#define IST8310_CNTRL2_RESET 0x01

#define IST8310_LSB_TO_MILLIGAUSS 3
#define IST8310_MAX_RAW_XY 5334
#define IST8310_MAX_RAW_Z 8334

// Heading fusion reschedules the compass task to 40 Hz. A 16x-averaged single
// conversion needs only 6 ms, so three consecutive 25 ms polls without DRDY
// indicate a stalled conversion. Recover well before the 500 ms compass-health
// timeout instead of beginning recovery at its boundary.
#define IST8310_CONVERSION_TIMEOUT_MS 75U
#define IST8310_FULL_RESET_AFTER_TIMEOUTS 2U
#define IST8310_RESET_INITIAL_WAIT_MS 50U
#define IST8310_RESET_POLL_INTERVAL_MS 10U
#define IST8310_RESET_POLL_ATTEMPTS 95U
#define IST8310_RUNTIME_RESET_TIMEOUT_MS 1000U
#define IST8310_DETECTION_MAX_RETRY_COUNT 5U

// One transfer begins at STATUS1 and atomically receives DRDY plus X/Y/Z data.
#define IST8310_SAMPLE_FRAME_SIZE 7U
#define IST8310_FRAME_STATUS 0U
#define IST8310_FRAME_X_LSB 1U
#define IST8310_FRAME_X_MSB 2U
#define IST8310_FRAME_Y_LSB 3U
#define IST8310_FRAME_Y_MSB 4U
#define IST8310_FRAME_Z_LSB 5U
#define IST8310_FRAME_Z_MSB 6U

typedef enum {
    IST8310_PHASE_CONVERTING = 0,
    IST8310_PHASE_WAIT_RESET,
} ist8310Phase_e;

typedef struct ist8310State_s {
    timeMs_t phaseStartedAtMs;
    uint16_t dataReadyMisses;
    uint16_t readErrors;
    uint16_t conversionRecoveries;
    uint16_t deviceResets;
    uint16_t invalidSamples;
    uint8_t consecutiveTimeouts;
    uint8_t phase;
} ist8310State_t;

STATIC_ASSERT(sizeof(ist8310State_t) <= BUS_SCRATCHPAD_MEMORY_SIZE,
    ist8310_state_exceeds_bus_scratchpad);

static ist8310State_t *ist8310State(magDev_t *mag)
{
    return (ist8310State_t *)busDeviceGetScratchpadMemory(mag->busDev);
}

static bool ist8310ResetBlocking(magDev_t *mag)
{
    if (!busWrite(mag->busDev, IST8310_REG_CNTRL2, IST8310_CNTRL2_RESET)) {
        return false;
    }

    // The part can require tens of milliseconds after power-up. The previous
    // 10-20 ms window intermittently accepted a device before reset completed.
    delay(IST8310_RESET_INITIAL_WAIT_MS);

    for (unsigned attempt = 0; attempt < IST8310_RESET_POLL_ATTEMPTS; attempt++) {
        uint8_t control2 = 0xFF;
        if (busRead(mag->busDev, IST8310_REG_CNTRL2, &control2) &&
            (control2 & IST8310_CNTRL2_RESET) == 0) {
            return true;
        }
        delay(IST8310_RESET_POLL_INTERVAL_MS);
    }

    return false;
}

static bool ist8310Configure(magDev_t *mag)
{
    return busWrite(mag->busDev, IST8310_REG_AVERAGE, IST8310_AVG_16) &&
        busWrite(mag->busDev, IST8310_REG_PDCNTL, IST8310_PULSE_DURATION_NORMAL);
}

static bool ist8310StartMeasurement(magDev_t *mag, ist8310State_t *state)
{
    if (!busWrite(mag->busDev, IST8310_REG_CNTRL1, IST8310_ODR_SINGLE)) {
        return false;
    }

    state->phaseStartedAtMs = millis();
    state->phase = IST8310_PHASE_CONVERTING;
    return true;
}

static void ist8310BeginRuntimeReset(magDev_t *mag, ist8310State_t *state)
{
    state->deviceResets++;
    state->phaseStartedAtMs = millis();
    state->phase = IST8310_PHASE_WAIT_RESET;
    if (!busWrite(mag->busDev, IST8310_REG_CNTRL2, IST8310_CNTRL2_RESET)) {
        state->readErrors++;
    }
}

static void ist8310ServiceRuntimeReset(magDev_t *mag, ist8310State_t *state)
{
    const timeMs_t now = millis();
    const timeMs_t elapsed = now - state->phaseStartedAtMs;
    if (elapsed < IST8310_RESET_INITIAL_WAIT_MS) {
        return;
    }

    uint8_t control2 = 0xFF;
    if (busRead(mag->busDev, IST8310_REG_CNTRL2, &control2) &&
        (control2 & IST8310_CNTRL2_RESET) == 0) {
        if (ist8310Configure(mag) && ist8310StartMeasurement(mag, state)) {
            state->consecutiveTimeouts = 0;
            return;
        }
        state->readErrors++;
        ist8310BeginRuntimeReset(mag, state);
        return;
    }

    if (elapsed >= IST8310_RUNTIME_RESET_TIMEOUT_MS) {
        // Retry a reset command without blocking the cooperative scheduler.
        ist8310BeginRuntimeReset(mag, state);
    }
}

static void ist8310RecoverConversion(magDev_t *mag, ist8310State_t *state)
{
    state->conversionRecoveries++;
    state->dataReadyMisses = 0;
    state->consecutiveTimeouts++;

    // One lost trigger is recoverable without resetting the device. A second
    // consecutive timeout means the conversion state machine is wedged, so
    // reset and reconfigure it. The reset is serviced across later task calls
    // so recovery never blocks the flight-control scheduler.
    if (state->consecutiveTimeouts < IST8310_FULL_RESET_AFTER_TIMEOUTS &&
        ist8310StartMeasurement(mag, state)) {
        return;
    }

    ist8310BeginRuntimeReset(mag, state);
}

static bool ist8310Init(magDev_t *mag)
{
    ist8310State_t *state = ist8310State(mag);
    if (!state) {
        return false;
    }
    memset(state, 0, sizeof(*state));

    return ist8310ResetBlocking(mag) && ist8310Configure(mag) &&
        ist8310StartMeasurement(mag, state);
}

static bool ist8310SampleInRange(int16_t nativeX, int16_t nativeY, int16_t nativeZ)
{
    return ABS((int32_t)nativeX) <= IST8310_MAX_RAW_XY &&
        ABS((int32_t)nativeY) <= IST8310_MAX_RAW_XY &&
        ABS((int32_t)nativeZ) <= IST8310_MAX_RAW_Z;
}

static void ist8310StoreSample(magDev_t *mag, int16_t nativeX, int16_t nativeY, int16_t nativeZ)
{
    // Canonical right-handed IST8310 chip frame. Board-specific installation
    // orientation is learned and applied later in sensors/compass.c, so the
    // driver never combines a physical board transform with user alignment.
    mag->magADCRaw[X] =  nativeX * IST8310_LSB_TO_MILLIGAUSS;
    mag->magADCRaw[Y] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;
    mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;
}

static bool ist8310Read(magDev_t *mag)
{
    ist8310State_t *state = ist8310State(mag);
    if (!state) {
        return false;
    }

    if (state->phase == IST8310_PHASE_WAIT_RESET) {
        ist8310ServiceRuntimeReset(mag, state);
        return false;
    }

    uint8_t frame[IST8310_SAMPLE_FRAME_SIZE];
    if (!busReadBuf(mag->busDev, IST8310_REG_STATUS1, frame, sizeof(frame))) {
        state->readErrors++;
        if (millis() - state->phaseStartedAtMs >= IST8310_CONVERSION_TIMEOUT_MS) {
            ist8310RecoverConversion(mag, state);
        }
        return false;
    }

    if ((frame[IST8310_FRAME_STATUS] & IST8310_STATUS1_DRDY) == 0) {
        state->dataReadyMisses++;
        if (millis() - state->phaseStartedAtMs >= IST8310_CONVERSION_TIMEOUT_MS) {
            ist8310RecoverConversion(mag, state);
        }
        return false;
    }

    state->dataReadyMisses = 0;
    state->consecutiveTimeouts = 0;

    const int16_t nativeX = (int16_t)((uint16_t)frame[IST8310_FRAME_X_MSB] << 8 |
        frame[IST8310_FRAME_X_LSB]);
    const int16_t nativeY = (int16_t)((uint16_t)frame[IST8310_FRAME_Y_MSB] << 8 |
        frame[IST8310_FRAME_Y_LSB]);
    const int16_t nativeZ = (int16_t)((uint16_t)frame[IST8310_FRAME_Z_MSB] << 8 |
        frame[IST8310_FRAME_Z_LSB]);

    // Reading the data registers completes the current conversion. Start the
    // next conversion immediately. A failed trigger enters nonblocking reset
    // recovery now instead of waiting until the source becomes stale.
    if (!ist8310StartMeasurement(mag, state)) {
        state->readErrors++;
        ist8310BeginRuntimeReset(mag, state);
    }

    if (!ist8310SampleInRange(nativeX, nativeY, nativeZ)) {
        state->invalidSamples++;
        return false;
    }

    ist8310StoreSample(mag, nativeX, nativeY, nativeZ);
    return true;
}

static bool deviceDetect(magDev_t *mag)
{
    if (!ist8310ResetBlocking(mag)) {
        return false;
    }

    for (unsigned retryCount = 0; retryCount < IST8310_DETECTION_MAX_RETRY_COUNT; retryCount++) {
        uint8_t signature = 0;
        if (busRead(mag->busDev, IST8310_REG_WHOAMI, &signature) &&
            signature == IST8310_CHIP_ID) {
            return true;
        }
        delay(10);
    }

    return false;
}

bool ist8310Detect(magDev_t *mag)
{
    for (uint8_t index = 0; index < 2; index++) {
        mag->busDev = busDeviceInit(
            BUSTYPE_ANY,
            DEVHW_IST8310_0 + index,
            mag->magSensorToUse,
            OWNER_COMPASS);
        if (!mag->busDev) {
            continue;
        }

        if (deviceDetect(mag)) {
            mag->init = ist8310Init;
            mag->read = ist8310Read;
            return true;
        }

        busDeviceDeInit(mag->busDev);
    }

    return false;
}

#endif
