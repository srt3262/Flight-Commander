import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMPASS_ORIENTATION_COMMAND,
  COMPASS_ORIENTATION_FLAG,
  COMPASS_ORIENTATION_PHASE,
  COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE,
  axisMapIsProper,
  compassOrientationStage,
  decodeCompassOrientationStatus,
  encodeCompassOrientationCommand,
  formatAxisMap,
} from '../../../js/flightCommander/compassOrientation.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function statusPayload() {
  const payload = new Uint8Array(COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE);
  const view = new DataView(payload.buffer);
  payload[0] = 1;
  payload[1] = COMPASS_ORIENTATION_PHASE.COLLECTING;
  payload[2] = COMPASS_ORIENTATION_FLAG.ACTIVE |
    COMPASS_ORIENTATION_FLAG.ACCEL_CALIBRATED |
    COMPASS_ORIENTATION_FLAG.COMPASS_PRESENT |
    COMPASS_ORIENTATION_FLAG.SAMPLE_ACCEPTED;
  payload[3] = 0;
  payload[4] = 0b000101;
  payload[5] = 2;
  payload[6] = 1;
  payload[7] = 96;
  view.setUint16(8, 175, true);
  view.setUint16(10, 1325, true);
  view.setUint16(12, 144, true);
  view.setUint16(14, 27, true);
  view.setUint16(16, 28125, true);
  view.setUint32(18, 7, true);
  view.setUint32(22, 0x0e8310c1, true);
  payload.set([0xff, 0xfe, 0x03], 26); // [-1, -2, +3]
  payload.set([0x02, 0xff, 0x03], 29); // [+2, -1, +3]
  payload.set([100, 70, 100, 30, 90, 10], 32);
  payload.set([40, 28, 40, 12, 36, 4], 38);
  payload[44] = 2;
  view.setInt16(46, 15, true);
  view.setInt16(48, 1002, true);
  view.setInt16(50, -8, true);
  return payload;
}

describe('learned compass orientation protocol', () => {
  test('accepts only complete proper signed-axis mappings', () => {
    assert.equal(axisMapIsProper([1, 2, 3]), true);
    assert.equal(axisMapIsProper([2, -1, 3]), true);
    assert.equal(axisMapIsProper([-1, -2, 3]), true);
    assert.equal(axisMapIsProper([1, 1, 3]), false);
    assert.equal(axisMapIsProper([1, 2, -3]), false);
    assert.equal(axisMapIsProper([0, 2, 3]), false);
    assert.equal(formatAxisMap([2, -1, 3]), 'Board X = +Mag Y · Board Y = −Mag X · Board Z = +Mag Z');
  });

  test('decodes face coverage, mapping quality, sensor identity and live vectors', () => {
    const status = decodeCompassOrientationStatus(statusPayload());
    assert.equal(status.active, true);
    assert.equal(status.accelerometerCalibrated, true);
    assert.equal(status.compassPresent, true);
    assert.equal(status.sampleAccepted, true);
    assert.equal(status.currentFace, 2);
    assert.equal(status.nextFace, 1);
    assert.equal(status.confidencePercent, 96);
    assert.equal(status.residualDegrees, 1.75);
    assert.equal(status.separationDegrees, 13.25);
    assert.equal(status.currentFaceRotationDegrees, 281.25);
    assert.equal(status.calibrationGeneration, 7);
    assert.equal(status.sensorFingerprint, 0x0e8310c1);
    assert.deepEqual(status.candidateAxisMap, [-1, -2, 3]);
    assert.deepEqual(status.storedAxisMap, [2, -1, 3]);
    assert.deepEqual(status.faceProgress, [100, 70, 100, 30, 90, 10]);
    assert.deepEqual(status.faceSamples, [40, 28, 40, 12, 36, 4]);
    assert.deepEqual(status.accelerometerG, [0.015, 1.002, -0.008]);
    assert.deepEqual(compassOrientationStage(status), {
      label: 'Learning orientation',
      tone: 'working',
    });
  });

  test('encodes explicit start, cancel, commit and clear commands', () => {
    assert.deepEqual(
      [...encodeCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.START)],
      [1, 1, 0, 0],
    );
    assert.deepEqual(
      [...encodeCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.CLEAR)],
      [1, 4, 0, 0],
    );
    assert.throws(() => encodeCompassOrientationCommand(99), /Unsupported/);
  });

  test('Configurator gates field calibration behind the learned transform', () => {
    const html = readFileSync(resolve(projectRoot, 'tabs/calibration.html'), 'utf8');
    const js = readFileSync(resolve(projectRoot, 'tabs/calibration.js'), 'utf8');
    const msp = readFileSync(resolve(projectRoot, 'js/msp/MSPCodes.js'), 'utf8');
    assert.match(html, /Compass Orientation Learning/);
    assert.match(html, /compassOrientationFaces/);
    assert.match(html, /Clear and relearn/);
    assert.match(js, /compassOrientationLearning/);
    assert.match(js, /COMPASS_ORIENTATION_COMMAND\.START/);
    assert.match(js, /orientationBlocksFieldCalibration/);
    assert.match(msp, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS:\s*0x2F23/);
    assert.match(msp, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\s*0x2F24/);
  });
});
