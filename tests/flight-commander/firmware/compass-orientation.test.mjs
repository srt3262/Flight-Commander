import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMPASS_ORIENTATION_COMMAND,
  COMPASS_ORIENTATION_FLAG,
  COMPASS_ORIENTATION_PHASE,
  COMPASS_ORIENTATION_SOURCE_DRONECAN,
  COMPASS_ORIENTATION_SOURCE_EXTERNAL_I2C,
  COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE,
  axisMapIsProper,
  compassOrientationStage,
  decodeCompassOrientationStatus,
  encodeCompassOrientationCommand,
  formatAxisMap,
} from '../../../js/flightCommander/compassOrientation.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function statusPayload(source = COMPASS_ORIENTATION_SOURCE_EXTERNAL_I2C) {
  const payload = new Uint8Array(COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE);
  const view = new DataView(payload.buffer);
  payload[0] = 2;
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
  view.setUint32(22, 0xe1000007, true);
  payload.set([0xff, 0xfe, 0x03], 26);
  payload.set([0x02, 0xff, 0x03], 29);
  payload.set([100, 70, 100, 30, 90, 10], 32);
  payload.set([40, 28, 40, 12, 36, 4], 38);
  payload[44] = 2;
  payload[45] = source;
  view.setInt16(46, 15, true);
  view.setInt16(48, 1002, true);
  view.setInt16(50, -8, true);
  return payload;
}

describe('source-selective learned compass orientation protocol', () => {
  test('accepts only complete proper signed-axis mappings', () => {
    assert.equal(axisMapIsProper([1, 2, 3]), true);
    assert.equal(axisMapIsProper([2, -1, 3]), true);
    assert.equal(axisMapIsProper([-1, -2, 3]), true);
    assert.equal(axisMapIsProper([1, 1, 3]), false);
    assert.equal(axisMapIsProper([1, 2, -3]), false);
    assert.equal(axisMapIsProper([0, 2, 3]), false);
    assert.equal(formatAxisMap([2, -1, 3]), 'Board X = +Mag Y · Board Y = −Mag X · Board Z = +Mag Z');
  });

  test('decodes the selected source, face coverage, quality and live vectors', () => {
    const status = decodeCompassOrientationStatus(statusPayload());
    assert.equal(status.source, COMPASS_ORIENTATION_SOURCE_EXTERNAL_I2C);
    assert.equal(status.sourceLabel, 'External / UART GPS-module compass');
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
    assert.equal(status.sensorFingerprint, 0xe1000007);
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

  test('encodes start, clear and selection for one explicit compass', () => {
    assert.deepEqual(
      [...encodeCompassOrientationCommand(
        COMPASS_ORIENTATION_COMMAND.START,
        COMPASS_ORIENTATION_SOURCE_EXTERNAL_I2C,
      )],
      [2, 1, 1, 0],
    );
    assert.deepEqual(
      [...encodeCompassOrientationCommand(
        COMPASS_ORIENTATION_COMMAND.CLEAR,
        COMPASS_ORIENTATION_SOURCE_DRONECAN,
      )],
      [2, 4, 2, 0],
    );
    assert.deepEqual(
      [...encodeCompassOrientationCommand(
        COMPASS_ORIENTATION_COMMAND.SELECT,
        COMPASS_ORIENTATION_SOURCE_DRONECAN,
      )],
      [2, 5, 2, 0],
    );
    assert.throws(() => encodeCompassOrientationCommand(99), /Unsupported/);
    assert.throws(
      () => encodeCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.START, 3),
      /source/,
    );
  });

  test('Configurator selects one enabled compass for both learning and gain calibration', () => {
    const html = readFileSync(resolve(projectRoot, 'tabs/calibration.html'), 'utf8');
    const js = readFileSync(resolve(projectRoot, 'tabs/calibration.js'), 'utf8');
    const msp = readFileSync(resolve(projectRoot, 'js/msp/MSPCodes.js'), 'utf8');
    assert.match(html, /compassCalibrationSource/);
    assert.match(html, /Six-Side Compass Orientation \/ Alignment/);
    assert.match(html, /compassFieldCalibrationStart/);
    assert.doesNotMatch(html, /All enabled compasses are being calibrated together/);
    assert.match(js, /individualCompassCalibration/);
    assert.match(js, /COMPASS_ORIENTATION_COMMAND\.SELECT/);
    assert.match(js, /sendCompassCalibrationCommand\(target\.index/);
    assert.match(js, /orientationBlocksFieldCalibration/);
    assert.match(msp, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS:\s*0x2F23/);
    assert.match(msp, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\s*0x2F24/);
    assert.match(msp, /MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND:\s*0x2F25/);
  });

  test('firmware stores three independent transforms and applies them before field calibration', () => {
    const orientationHeader = readFileSync(resolve(
      projectRoot,
      'dev/firmware-4.0.7-source/src/main/flight_commander/compass_orientation.h',
    ), 'utf8');
    const orientationSource = readFileSync(resolve(
      projectRoot,
      'dev/firmware-4.0.7-source/src/main/flight_commander/compass_orientation.c',
    ), 'utf8');
    const headingSource = readFileSync(resolve(
      projectRoot,
      'dev/firmware-4.0.7-source/src/main/flight_commander/heading_fusion.c',
    ), 'utf8');
    assert.match(orientationHeader, /SOURCE_COUNT 3U/);
    assert.match(orientationHeader, /sources\[FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_COUNT\]/);
    assert.match(orientationSource, /session\.source/);
    assert.match(orientationSource, /InvalidateFieldCalibration\(session\.source\)/);
    assert.match(headingSource, /flightCommanderCompassOrientationObserve\(\s*micros\(\), FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG/);
    assert.match(headingSource, /flightCommanderCompassOrientationObserve\(\s*micros\(\), FLIGHT_COMMANDER_HEADING_DRONECAN_MAG/);
    assert.match(headingSource, /activeFieldCalibrationSource/);
    assert.match(headingSource, /headingSourceOrientationIsValid/);
    assert.match(headingSource, /headingSourceOrientationIsValid\(index\) && externalMagIsCalibrated/);
    assert.match(headingSource, /headingSourceOrientationIsValid\(index\) && dronecanMagIsCalibrated/);
    assert.match(headingSource, /if \(!headingSourceOrientationIsValid\(source\)\)/);
  });
});
