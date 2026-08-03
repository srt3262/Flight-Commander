import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compassCalibrationState,
  enumerateCompassCalibrationTargets,
} from '../../../js/flightCommander/compassCalibration.js';
import { createDefaultHeadingConfig } from '../../../js/flightCommander/headingFusion.js';
import {
  ALIGN_CW90_DEG,
  onboardCompassOrientationRequirement,
} from '../../../js/flightCommander/compassOrientation.js';

const legacyCalibration = {
  magZero: { X: 12, Y: -8, Z: 3 },
  magGain: { X: 1010, Y: 1030, Z: 995 },
};

test('legacy INAV exposes one configured primary compass with current values', () => {
  const targets = enumerateCompassCalibrationTargets({
    sensorConfig: { magnetometer: 1 },
    calibrationData: legacyCalibration,
  });
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].zero, [12, -8, 3]);
  assert.deepEqual(targets[0].gain, [1010, 1030, 995]);
  assert.equal(targets[0].calibrated, true);
});

test('auto magnetometer setting still exposes a physically detected onboard compass', () => {
  const targets = enumerateCompassCalibrationTargets({
    activeSensors: 1 << 2,
    sensorConfig: { magnetometer: 0 },
    calibrationData: legacyCalibration,
  });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].key, 'legacy-primary');
});

test('Flight Commander lists each enabled and detected physical compass independently', () => {
  const headingConfig = createDefaultHeadingConfig();
  headingConfig.sources[1].enabled = true;
  headingConfig.sources[2].enabled = true;
  headingConfig.externalMagZero = [21, 22, 23];
  headingConfig.externalMagGain = [1001, 1002, 1003];
  headingConfig.dronecanMagZeroMilliGauss = [31, 32, 33];
  headingConfig.dronecanMagGainMilliGauss = [490, 500, 510];
  headingConfig.dronecanMagCalibrationNodeId = 73;

  const targets = enumerateCompassCalibrationTargets({
    supportsHeadingFusion: true,
    sensorConfig: { magnetometer: 1 },
    calibrationData: legacyCalibration,
    headingConfig,
    headingStatus: {
      sources: [
        { healthy: true, calibrated: true, ageMs: 10 },
        { healthy: true, calibrated: true, ageMs: 20 },
        { healthy: true, calibrated: true, ageMs: 30 },
      ],
    },
    dronecanConfig: { magNodeId: 73 },
    dronecanStatus: { nodes: [{ nodeId: 73, capabilities: 1 << 3 }] },
  });

  assert.deepEqual(targets.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(targets[1].zero, [21, 22, 23]);
  assert.deepEqual(targets[2].gain, [490, 500, 510]);
  assert.equal(targets[2].nodeId, 73);
});

test('enabled external and CAN sources are omitted until their hardware is detected', () => {
  const headingConfig = createDefaultHeadingConfig();
  headingConfig.sources[1].enabled = true;
  headingConfig.sources[2].enabled = true;

  const targets = enumerateCompassCalibrationTargets({
    supportsHeadingFusion: true,
    sensorConfig: { magnetometer: 1 },
    calibrationData: legacyCalibration,
    headingConfig,
    headingStatus: { sources: [{ healthy: true, calibrated: true, ageMs: 10 }] },
    dronecanConfig: { magNodeId: 0 },
    dronecanStatus: { nodes: [] },
  });
  assert.deepEqual(targets.map(({ index }) => index), [0]);
});

test('calibration state gives active and failed sessions precedence', () => {
  assert.equal(compassCalibrationState({ calibrating: true, failed: true }).tone, 'working');
  assert.equal(compassCalibrationState({ failed: true, calibrated: true }).tone, 'error');
  assert.equal(compassCalibrationState({ calibrated: true }).tone, 'ready');
  assert.equal(compassCalibrationState({ calibrated: false }).tone, 'warning');
});

test('MICOAIR743 onboard IST8310 requires unflipped CW90 before calibration', () => {
  const badDefault = onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743', boardIdentifier: 'M743' },
    sensorConfig: { magnetometer: 1 },
    sensorAlignment: { align_mag: 0 },
    customAngles: { roll: 0, pitch: 0, yaw: 0 },
  });
  assert.equal(badDefault.alignMag, ALIGN_CW90_DEG);
  assert.equal(badDefault.needsCorrection, true);

  const corrected = onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743' },
    sensorConfig: { magnetometer: 1 },
    sensorAlignment: { align_mag: ALIGN_CW90_DEG },
    customAngles: { roll: 0, pitch: 0, yaw: 0 },
  });
  assert.equal(corrected.ready, true);
  assert.equal(corrected.label, 'CW90 (unflipped)');
});

test('custom mag angles override the MICOAIR743 preset and keep calibration blocked', () => {
  const requirement = onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743' },
    sensorConfig: { magnetometer: 1 },
    sensorAlignment: { align_mag: ALIGN_CW90_DEG },
    customAngles: { roll: 0, pitch: 0, yaw: 900 },
  });
  assert.equal(requirement.needsCorrection, true);

  assert.equal(onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743V2' },
    sensorConfig: { magnetometer: 1 },
    sensorAlignment: { align_mag: 0 },
    customAngles: { roll: 0, pitch: 0, yaw: 0 },
  }), null);

});

test('MICOAIR743 orientation guard follows detected hardware instead of the AUTO selector value', () => {
  const detected = onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743' },
    activeSensors: 1 << 2,
    sensorConfig: { magnetometer: 0 },
    sensorAlignment: { align_mag: 0 },
    customAngles: { roll: 0, pitch: 0, yaw: 0 },
  });
  assert.equal(detected.needsCorrection, true);

  const absent = onboardCompassOrientationRequirement({
    config: { target: 'MICOAIR743' },
    activeSensors: 0,
    sensorConfig: { magnetometer: 1 },
    sensorAlignment: { align_mag: 0 },
    customAngles: { roll: 0, pitch: 0, yaw: 0 },
  });
  assert.equal(absent, null);
});
