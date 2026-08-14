import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = resolve(configuratorRoot, '..');
const source = (relative) => readFileSync(resolve(sourceRoot, relative), 'utf8');

const navigation = source('src/main/navigation/navigation.c');
const estimator = source('src/main/navigation/navigation_pos_estimator.c');
const flightCore = source('src/main/fc/fc_core.c');
const msp = source('src/main/fc/fc_msp.c');
const mavlink = source('src/main/telemetry/mavlink.c');

test('disarmed bench telemetry always reports calibrated barometer motion', () => {
  const helperStart = navigation.indexOf('float getTelemetryRelativeAltitude(void)');
  const helperEnd = navigation.indexOf('\n}', helperStart);
  const helper = navigation.slice(helperStart, helperEnd);

  assert.notEqual(helperStart, -1);
  assert.match(helper, /if \(ARMING_FLAG\(ARMED\)\)/);
  assert.match(helper, /telemetryRelativeAltitudeArmOffsetValid = false;/);
  assert.match(helper, /sensors\(SENSOR_BARO\)/);
  assert.match(helper, /baroIsCalibrationComplete\(\)/);
  assert.match(helper, /return baroGetLatestAltitude\(\);/);
  assert.match(helper, /return getEstimatedActualPosition\(Z\);/);
});

test('every arming path captures a fresh zero for fused relative altitude', () => {
  const resetStart = navigation.indexOf('void resetTelemetryRelativeAltitude(void)');
  const resetEnd = navigation.indexOf('\n}', resetStart);
  const reset = navigation.slice(resetStart, resetEnd);

  assert.match(reset, /telemetryRelativeAltitudeArmOffset = getEstimatedActualPosition\(Z\);/);
  assert.match(reset, /telemetryRelativeAltitudeArmOffsetValid = true;/);
  assert.match(
    navigation,
    /return getEstimatedActualPosition\(Z\) - telemetryRelativeAltitudeArmOffset;/,
  );

  const armResets = flightCore.match(/ENABLE_ARMING_FLAG\(ARMED\);\s*resetTelemetryRelativeAltitude\(\);/g) ?? [];
  assert.equal(armResets.length, 2);
});

test('navigation reference reset behavior remains unchanged for flight control', () => {
  assert.match(
    estimator,
    /case NAV_RESET_ON_FIRST_ARM:\s*return !ARMING_FLAG\(ARMED\) && !ARMING_FLAG\(WAS_EVER_ARMED\);/,
  );
  assert.doesNotMatch(estimator, /getTelemetryRelativeAltitude/);
});

test('MSP and MAVLink ground-station altitude fields use the display-safe relative altitude', () => {
  const mspAltitude = msp.slice(msp.indexOf('case MSP_ALTITUDE:'), msp.indexOf('case MSP2_INAV_FULL_LOCAL_POSE:'));
  assert.match(mspAltitude, /getTelemetryRelativeAltitude\(\)/);

  const globalPosition = mavlink.slice(
    mavlink.indexOf('mavlink_msg_global_position_int_pack'),
    mavlink.indexOf('mavlink_msg_gps_global_origin_pack'),
  );
  assert.match(globalPosition, /getTelemetryRelativeAltitude\(\) \* 10/);

  const hud = mavlink.slice(mavlink.indexOf('void mavlinkSendHUD(void)'), mavlink.indexOf('void mavlinkSendBatteryTemperatureStatusText'));
  assert.match(hud, /mavAltitude = getTelemetryRelativeAltitude\(\) \/ 100\.0f;/);
});
