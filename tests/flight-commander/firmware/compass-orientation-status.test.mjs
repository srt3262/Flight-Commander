import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPASS_ORIENTATION_FAILURE,
  COMPASS_ORIENTATION_STATE,
  compassOrientationPresentation,
  normalizeCompassOrientationStatus,
} from '../../../js/flightCommander/compassOrientation.js';

test('normalizes appended flat firmware status fields', () => {
  const status = normalizeCompassOrientationStatus({
    compassOrientationState: COMPASS_ORIENTATION_STATE.VERIFIED,
    compassOrientationCandidate: 9,
    compassOrientationSamples: 287,
    compassOrientationFacesMask: 0x3f,
    compassOrientationResidualCentidegrees: 321,
    compassOrientationMarginCentidegrees: 1140,
    compassOrientationConfidence: 94,
    compassOrientationMapping: 'X←Y, Y←−X, Z←Z',
  });
  assert.equal(status.supported, true);
  assert.equal(status.verified, true);
  assert.equal(status.faces, 6);
  assert.equal(status.residualDegrees, 3.21);
  assert.equal(status.marginDegrees, 11.4);
  assert.equal(status.mapping, 'X←Y, Y←−X, Z←Z');
});

test('blocks orientation learning until accelerometer calibration is complete', () => {
  const presentation = compassOrientationPresentation({
    compassOrientationState: COMPASS_ORIENTATION_STATE.REQUIRED,
  }, false);
  assert.equal(presentation.buttonDisabled, true);
  assert.match(presentation.title, /Accelerometer calibration required/);
});

test('shows live learning coverage and samples', () => {
  const presentation = compassOrientationPresentation({
    compassOrientationState: COMPASS_ORIENTATION_STATE.LEARNING,
    compassOrientationSamples: 183,
    compassOrientationFacesMask: 0b00111111,
  }, true);
  assert.equal(presentation.tone, 'working');
  assert.match(presentation.detail, /6\/6 faces/);
  assert.match(presentation.detail, /183 synchronized samples/);
});

test('shows explicit firmware rejection reason', () => {
  const presentation = compassOrientationPresentation({
    compassOrientationState: COMPASS_ORIENTATION_STATE.REJECTED,
    compassOrientationFailure: COMPASS_ORIENTATION_FAILURE.AMBIGUOUS_ORIENTATION,
  }, true);
  assert.equal(presentation.tone, 'error');
  assert.match(presentation.detail, /best two mappings were too similar/i);
});
