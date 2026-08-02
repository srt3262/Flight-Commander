import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASELINE_PROVIDER_DRONECAN,
  HEADING_CONFIG_PAYLOAD_SIZE,
  HEADING_SOURCE_DRONECAN_MAG,
  HEADING_SOURCE_EXTERNAL_I2C_MAG,
  HEADING_SOURCE_MOVING_BASELINE,
  createDefaultHeadingConfig,
  decodeHeadingConfig,
  decodeHeadingStatus,
  encodeHeadingConfig,
  previewWeightedHeading,
} from '../../../js/flightCommander/headingFusion.js';

const enabledCan = { gpsNodeId: 42, magNodeId: 73 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('heading configuration round-trips the exact 71-byte firmware schema with per-node CAN calibration', () => {
  const config = createDefaultHeadingConfig();
  config.sources[0].yawOffsetCentidegrees = -1234;
  config.externalMagAlignmentDecidegrees = [-900, 125, 3600];
  config.externalMagZero = [-120, 44, 918];
  config.externalMagGain = [988, 1024, 1102];
  config.dronecanMagAlignmentDecidegrees = [15, -20, 450];
  config.dronecanMagZeroMilliGauss = [-85, 12, 44];
  config.dronecanMagGainMilliGauss = [480, 515, 502];
  config.dronecanMagCalibrationNodeId = 73;

  const encoded = encodeHeadingConfig(config, enabledCan);
  assert.equal(encoded.byteLength, HEADING_CONFIG_PAYLOAD_SIZE);
  assert.deepEqual(decodeHeadingConfig(encoded), config);
});

test('enabled heading sources form an unambiguous priority order', () => {
  const config = createDefaultHeadingConfig();
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].enabled = true;
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].priority = 1;
  assert.throws(
    () => encodeHeadingConfig(config, enabledCan),
    /unique priority/,
  );

  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].priority = 2;
  assert.doesNotThrow(() => encodeHeadingConfig(config, enabledCan));
});

test('CAN compass and moving-baseline modes fail closed without assigned nodes', () => {
  const canCompass = createDefaultHeadingConfig();
  canCompass.sources[HEADING_SOURCE_DRONECAN_MAG].enabled = true;
  canCompass.sources[HEADING_SOURCE_DRONECAN_MAG].priority = 2;
  assert.throws(
    () => encodeHeadingConfig(canCompass, { gpsNodeId: 255, magNodeId: 255 }),
    /DroneCAN magnetometer node/,
  );

  const movingBaseline = createDefaultHeadingConfig();
  movingBaseline.sources[HEADING_SOURCE_MOVING_BASELINE].enabled = true;
  movingBaseline.sources[HEADING_SOURCE_MOVING_BASELINE].priority = 2;
  movingBaseline.movingBaselineEnabled = true;
  movingBaseline.movingBaselineProvider = BASELINE_PROVIDER_DRONECAN;
  assert.throws(
    () => encodeHeadingConfig(movingBaseline, { gpsNodeId: 255, magNodeId: 255 }),
    /DroneCAN GNSS node/,
  );
});

test('moving-baseline enable and source selection cannot diverge', () => {
  const config = createDefaultHeadingConfig();
  config.movingBaselineEnabled = true;
  assert.throws(
    () => encodeHeadingConfig(config, enabledCan),
    /must match/,
  );
});

test('DroneCAN compass calibration is complete and bound to one node or absent', () => {
  const partial = createDefaultHeadingConfig();
  partial.dronecanMagGainMilliGauss = [500, 0, 500];
  partial.dronecanMagCalibrationNodeId = 73;
  assert.throws(
    () => encodeHeadingConfig(partial, enabledCan),
    /all three axis gains/,
  );

  const unbound = createDefaultHeadingConfig();
  unbound.dronecanMagGainMilliGauss = [500, 500, 500];
  assert.throws(
    () => encodeHeadingConfig(unbound, enabledCan),
    /bound to one CAN node/,
  );
});

test('weighted fusion handles north wraparound and priority-based failover', () => {
  const config = createDefaultHeadingConfig();
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].enabled = true;
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].priority = 2;
  config.sources[0].weight = 100;
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].weight = 100;

  const aroundNorth = previewWeightedHeading([
    { healthy: true, headingDegrees: 359, quality: 1 },
    { healthy: true, headingDegrees: 1, quality: 1 },
  ], config);
  assert.equal(aroundNorth.anchorSource, 0);
  assert.deepEqual(aroundNorth.activeSources, [0, 1]);
  assert.ok(aroundNorth.fusedHeadingDegrees < 0.01 || aroundNorth.fusedHeadingDegrees > 359.99);

  const failover = previewWeightedHeading([
    { healthy: false, headingDegrees: 10, quality: 1 },
    { healthy: true, headingDegrees: 20, quality: 1 },
  ], config);
  assert.equal(failover.anchorSource, HEADING_SOURCE_EXTERNAL_I2C_MAG);
  assert.deepEqual(failover.activeSources, [HEADING_SOURCE_EXTERNAL_I2C_MAG]);
  assert.equal(failover.fusedHeadingDegrees, 20);
});

test('a source outside the configured disagreement guard is rejected', () => {
  const config = createDefaultHeadingConfig();
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].enabled = true;
  config.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].priority = 2;
  config.maxDisagreementCentidegrees = 3000;

  const result = previewWeightedHeading([
    { healthy: true, headingDegrees: 5, quality: 1 },
    { healthy: true, headingDegrees: 100, quality: 1 },
  ], config);
  assert.deepEqual(result.activeSources, [0]);
  assert.deepEqual(result.rejectedSources, [HEADING_SOURCE_EXTERNAL_I2C_MAG]);
  assert.equal(result.fusedHeadingDegrees, 5);
});

test('heading status decodes live masks, baseline geometry, quality, and age', () => {
  const bytes = new Uint8Array(39);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 2);
  view.setUint8(1, 0b1111);
  view.setUint8(2, 0b1001);
  view.setUint8(3, 0b0100);
  view.setUint8(4, HEADING_SOURCE_MOVING_BASELINE);
  view.setUint8(5, BASELINE_PROVIDER_DRONECAN);
  view.setUint8(6, 1);
  view.setUint8(7, 42);
  view.setUint16(8, 35950, true);
  view.setUint16(10, 1250, true);
  view.setUint16(12, 75, true);
  view.setUint16(14, 42, true);
  view.setUint8(16, 0b0111);
  view.setUint8(17, 0b0100);
  view.setUint8(18, 0b0010);
  for (let source = 0; source < 4; source += 1) {
    const offset = 19 + source * 5;
    view.setUint16(offset, 1000 + source, true);
    view.setUint16(offset + 2, source === 2 ? 0xffff : source * 10, true);
    view.setUint8(offset + 4, 90 - source);
  }

  const status = decodeHeadingStatus(bytes);
  assert.equal(status.fusedHeadingCentidegrees, 35950);
  assert.equal(status.anchorSource, HEADING_SOURCE_MOVING_BASELINE);
  assert.equal(status.baselineFixed, true);
  assert.equal(status.baselineNodeId, 42);
  assert.equal(status.baselineDistanceCm, 75);
  assert.equal(status.sources[0].active, true);
  assert.equal(status.sources[2].rejected, true);
  assert.equal(status.sources[0].calibrated, true);
  assert.equal(status.sources[1].calibrationFailed, true);
  assert.equal(status.sources[2].calibrating, true);
  assert.equal(status.sources[2].ageMs, 0xffff);
  assert.equal(status.sources[3].quality, 87);
});
