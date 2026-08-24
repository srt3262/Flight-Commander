/*
 * This file is part of Betaflight.
 *
 * Betaflight is free software. You can redistribute this software
 * and/or modify this software under the terms of the GNU General
 * Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later
 * version.
 *
 * Betaflight is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this software.
 *
 * If not, see <http://www.gnu.org/licenses/>.
 */

#include <float.h>
#include <string.h>

#include "platform.h"
#include "common/utils.h"
#include "config/config_reset.h"
#include "config/parameter_group.h"
#include "config/parameter_group_ids.h"
#include "drivers/dshot.h"

PG_REGISTER_WITH_RESET_TEMPLATE(dshotConfig_t, dshotConfig, PG_FLIGHT_COMMANDER_DSHOT_CONFIG, 0);

PG_RESET_TEMPLATE(dshotConfig_t, dshotConfig,
    .useDshotTelemetry = 0,
    .useDshotEdt = 0
);

#ifdef USE_DSHOT

#include "common/filter.h"
#include "common/maths.h"

#include "config/feature.h"

#include "fc/config.h"

#include "flight/mixer.h"
#include "drivers/pwm_mapping.h"

#define DSHOT_RPM_LPF_HZ 150

bool useDshotTelemetry = false;
dshotTelemetryState_t dshotTelemetryState;

static pt1Filter_t motorFreqLpf[MAX_SUPPORTED_MOTORS];
static float motorFrequencyHz[MAX_SUPPORTED_MOTORS];
static float dshotRpm[MAX_SUPPORTED_MOTORS];
static float erpmToHz;
static bool edtAlwaysDecode;
static timeUs_t lastValidTelemetryUs[MAX_SUPPORTED_MOTORS][DSHOT_TELEMETRY_TYPE_COUNT];

static const dshotTelemetryType_e extendedTelemetryLookup[8] = {
    DSHOT_TELEMETRY_TYPE_ERPM,
    DSHOT_TELEMETRY_TYPE_TEMPERATURE,
    DSHOT_TELEMETRY_TYPE_VOLTAGE,
    DSHOT_TELEMETRY_TYPE_CURRENT,
    DSHOT_TELEMETRY_TYPE_DEBUG1,
    DSHOT_TELEMETRY_TYPE_DEBUG2,
    DSHOT_TELEMETRY_TYPE_DEBUG3,
    DSHOT_TELEMETRY_TYPE_STATE_EVENTS,
};

static float erpmToRpm(uint32_t erpm)
{
    return erpm * erpmToHz * 60.0f;
}

static bool isDshotTelemetryTypeFresh(uint8_t motorIndex, dshotTelemetryType_e type, timeUs_t now)
{
    if (motorIndex >= MAX_SUPPORTED_MOTORS || type >= DSHOT_TELEMETRY_TYPE_COUNT) {
        return false;
    }

    const timeUs_t lastUpdateUs = lastValidTelemetryUs[motorIndex][type];
    return lastUpdateUs != 0 && (timeUs_t)(now - lastUpdateUs) <= DSHOT_TELEMETRY_TIMEOUT_US;
}

static uint32_t dshotDecodeErpmTelemetryValue(uint16_t value)
{
    if (value == 0x0fff) {
        return 0;
    }

    value = (value & 0x01ff) << ((value & 0xfe00) >> 9);
    if (!value) {
        return DSHOT_TELEMETRY_INVALID;
    }

    return (1000000 * 60 / 100 + value / 2) / value;
}

static void dshotDecodeTelemetryValue(uint8_t motorIndex, uint32_t *decoded, dshotTelemetryType_e *type)
{
    const uint16_t value = dshotTelemetryState.motorState[motorIndex].rawValue;
    const bool edtEnabled = edtAlwaysDecode || (dshotTelemetryState.motorState[motorIndex].telemetryTypes & DSHOT_EXTENDED_TELEMETRY_MASK) != 0;
    const unsigned telemetryType = (value & 0x0f00) >> 8;
    const bool isErpm = !edtEnabled || (telemetryType & 0x01) || (telemetryType == 0);

    if (isErpm) {
        *decoded = dshotDecodeErpmTelemetryValue(value);
        *type = DSHOT_TELEMETRY_TYPE_ERPM;
    } else {
        const unsigned typeIndex = telemetryType >> 1;
        *type = typeIndex < ARRAYLEN(extendedTelemetryLookup) ? extendedTelemetryLookup[typeIndex] : DSHOT_TELEMETRY_TYPE_STATE_EVENTS;
        *decoded = value & 0x00ff;
    }
}

void dshotResetTelemetry(void)
{
    memset(&dshotTelemetryState, 0, sizeof(dshotTelemetryState));
    memset(dshotRpm, 0, sizeof(dshotRpm));
    memset(motorFrequencyHz, 0, sizeof(motorFrequencyHz));
    memset(lastValidTelemetryUs, 0, sizeof(lastValidTelemetryUs));
}

bool isDshotTelemetryConfigured(void)
{
    return useDshotTelemetry;
}

bool isDshotTelemetryActive(void)
{
    if (!useDshotTelemetry || getMotorCount() == 0) {
        return false;
    }

    for (uint8_t motorIndex = 0; motorIndex < getMotorCount(); motorIndex++) {
        if (!isDshotTelemetryMotorActive(motorIndex)) {
            return false;
        }
    }

    return true;
}

bool isDshotTelemetryMotorActive(uint8_t motorIndex)
{
    if (!useDshotTelemetry || motorIndex >= getMotorCount()) {
        return false;
    }

    return isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_ERPM, micros());
}

void initDshotTelemetry(timeUs_t looptimeUs)
{
    useDshotTelemetry = feature(FEATURE_PWM_OUTPUT_ENABLE)
        && dshotConfig()->useDshotTelemetry
        && (motorConfig()->motorPwmProtocol >= PWM_TYPE_DSHOT150);
    edtAlwaysDecode = dshotConfig()->useDshotEdt != 0;

    dshotResetTelemetry();

    if (!useDshotTelemetry) {
        return;
    }

    erpmToHz = ERPM_PER_LSB / 60.0f / (motorConfig()->motorPoleCount / 2.0f);

    for (unsigned i = 0; i < MAX_SUPPORTED_MOTORS; i++) {
        pt1FilterInit(&motorFreqLpf[i], DSHOT_RPM_LPF_HZ, looptimeUs * 1e-6f);
    }
}

uint16_t dshotProcessPacket(uint16_t rawValue, uint8_t motorIndex)
{
    if (!useDshotTelemetry || motorIndex >= MAX_SUPPORTED_MOTORS) {
        return rawValue;
    }

    if (rawValue == DSHOT_TELEMETRY_INVALID || rawValue == DSHOT_TELEMETRY_NOEDGE) {
        if (rawValue == DSHOT_TELEMETRY_INVALID) {
            dshotTelemetryState.invalidPacketCount++;
        }
        return rawValue;
    }

    dshotTelemetryState.readCount++;
    dshotTelemetryState.motorState[motorIndex].rawValue = rawValue;

    dshotTelemetryType_e type;
    uint32_t decoded;
    dshotDecodeTelemetryValue(motorIndex, &decoded, &type);
    if (decoded == DSHOT_TELEMETRY_INVALID) {
        dshotTelemetryState.invalidPacketCount++;
        return DSHOT_TELEMETRY_INVALID;
    }

    dshotTelemetryState.motorState[motorIndex].telemetryData[type] = decoded;
    dshotTelemetryState.motorState[motorIndex].telemetryTypes |= (1 << type);
    lastValidTelemetryUs[motorIndex][type] = micros();

    if (type == DSHOT_TELEMETRY_TYPE_TEMPERATURE && decoded > dshotTelemetryState.motorState[motorIndex].maxTemp) {
        dshotTelemetryState.motorState[motorIndex].maxTemp = decoded;
    }

    if (type == DSHOT_TELEMETRY_TYPE_ERPM) {
        dshotRpm[motorIndex] = erpmToRpm(decoded);
        motorFrequencyHz[motorIndex] = pt1FilterApply(&motorFreqLpf[motorIndex], erpmToHz * decoded);
    }
    dshotTelemetryState.rawValueState = DSHOT_RAW_VALUE_STATE_PROCESSED;

    return rawValue;
}

uint16_t getDshotErpm(uint8_t motorIndex)
{
    return dshotTelemetryState.motorState[motorIndex].telemetryData[DSHOT_TELEMETRY_TYPE_ERPM];
}

float getDshotRpm(uint8_t motorIndex)
{
    return isDshotTelemetryMotorActive(motorIndex) ? dshotRpm[motorIndex] : 0.0f;
}

float getDshotRpmAverage(void)
{
    if (!useDshotTelemetry) {
        return 0.0f;
    }

    const timeUs_t now = micros();
    float rpmTotal = 0.0f;
    unsigned rpmCount = 0;
    for (uint8_t motorIndex = 0; motorIndex < getMotorCount(); motorIndex++) {
        if (isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_ERPM, now)) {
            rpmTotal += dshotRpm[motorIndex];
            rpmCount++;
        }
    }

    return rpmCount ? rpmTotal / rpmCount : 0.0f;
}

float getMotorFrequencyHz(uint8_t motorIndex)
{
    return isDshotTelemetryMotorActive(motorIndex) ? motorFrequencyHz[motorIndex] : 0.0f;
}

bool getDshotEscSensorData(escSensorData_t *data, uint8_t motorIndex)
{
    if (!useDshotTelemetry || motorIndex >= getMotorCount()) {
        return false;
    }

    const dshotTelemetryMotorState_t *state = &dshotTelemetryState.motorState[motorIndex];
    const timeUs_t now = micros();
    if (!isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_ERPM, now)) {
        return false;
    }

    data->rpm = state->telemetryData[DSHOT_TELEMETRY_TYPE_ERPM];
    data->temperature = isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_TEMPERATURE, now) ? state->telemetryData[DSHOT_TELEMETRY_TYPE_TEMPERATURE] : 0;
    data->voltage = isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_VOLTAGE, now) ? state->telemetryData[DSHOT_TELEMETRY_TYPE_VOLTAGE] * 25 : 0;
    data->current = isDshotTelemetryTypeFresh(motorIndex, DSHOT_TELEMETRY_TYPE_CURRENT, now) ? state->telemetryData[DSHOT_TELEMETRY_TYPE_CURRENT] * 100 : 0;

    return true;
}

#endif

#ifndef USE_DSHOT
bool useDshotTelemetry = false;
dshotTelemetryState_t dshotTelemetryState;

void initDshotTelemetry(timeUs_t looptimeUs) { UNUSED(looptimeUs); }
void dshotResetTelemetry(void) {}
bool isDshotTelemetryConfigured(void) { return false; }
bool isDshotTelemetryActive(void) { return false; }
bool isDshotTelemetryMotorActive(uint8_t motorIndex) { UNUSED(motorIndex); return false; }
uint16_t dshotProcessPacket(uint16_t rawValue, uint8_t motorIndex) { UNUSED(motorIndex); return rawValue; }
float getDshotRpm(uint8_t motorIndex) { UNUSED(motorIndex); return 0.0f; }
uint16_t getDshotErpm(uint8_t motorIndex) { UNUSED(motorIndex); return 0; }
float getDshotRpmAverage(void) { return 0.0f; }
float getMotorFrequencyHz(uint8_t motorIndex) { UNUSED(motorIndex); return 0.0f; }
bool getDshotEscSensorData(escSensorData_t *data, uint8_t motorIndex) { UNUSED(data); UNUSED(motorIndex); return false; }
#endif
