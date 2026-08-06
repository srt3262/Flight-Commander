import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPASS_ORIENTATION_CANDIDATES,
  applyCompassOrientation,
  preserveLastVerifiedCompassOrientation,
  rotateWorldVectorToBody,
  solveCompassOrientation,
} from '../../../js/flightCommander/compassVectorMatching.js';

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function transposeMatrixVector(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[3] * vector[1] + matrix[6] * vector[2],
    matrix[1] * vector[0] + matrix[4] * vector[1] + matrix[7] * vector[2],
    matrix[2] * vector[0] + matrix[5] * vector[1] + matrix[8] * vector[2],
  ];
}

function quaternionMultiply(left, right) {
  const [lw, lx, ly, lz] = left;
  const [rw, rx, ry, rz] = right;
  return [
    lw * rw - lx * rx - ly * ry - lz * rz,
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
  ];
}

function axisQuaternion(axis, radians) {
  const half = radians / 2;
  const sine = Math.sin(half);
  const vector = [0, 0, 0];
  vector[axis] = sine;
  return [Math.cos(half), ...vector];
}

function eulerQuaternion(roll, pitch, yaw) {
  return normalize(quaternionMultiply(
    axisQuaternion(2, yaw),
    quaternionMultiply(axisQuaternion(1, pitch), axisQuaternion(0, roll)),
  ));
}

function deterministicNoise(index, axis, scale) {
  const value = Math.sin((index + 1) * (axis + 2) * 1.61803398875);
  return value * scale;
}

function syntheticSamples({
  matrix,
  count = 360,
  bias = [38, -24, 17],
  gain = [1.16, 0.83, 1.04],
  noise = 0.004,
  stationary = false,
} = {}) {
  const earthField = normalize([0.43, 0.12, 0.895]);
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const phase = index / Math.max(1, count - 1);
    const quaternion = stationary
      ? [1, 0, 0, 0]
      : eulerQuaternion(
        1.35 * Math.sin(phase * Math.PI * 6),
        1.30 * Math.sin(phase * Math.PI * 5 + 0.7),
        phase * Math.PI * 8 + 0.45 * Math.sin(phase * Math.PI * 4),
      );
    const bodyField = rotateWorldVectorToBody(quaternion, earthField);
    const canonicalField = transposeMatrixVector(matrix, bodyField);
    const raw = canonicalField.map((value, axis) => (
      value / gain[axis]
      + bias[axis]
      + deterministicNoise(index, axis, noise)
    ));
    samples.push({ mag: raw, quaternion });
  }
  return samples;
}

test('enumerates exactly the 24 proper signed-permutation rotations', () => {
  assert.equal(COMPASS_ORIENTATION_CANDIDATES.length, 24);
  const unique = new Set(COMPASS_ORIENTATION_CANDIDATES.map(({ matrix }) => matrix.join(',')));
  assert.equal(unique.size, 24);
  for (const { matrix } of COMPASS_ORIENTATION_CANDIDATES) {
    const x = applyCompassOrientation(matrix, [1, 0, 0]);
    const y = applyCompassOrientation(matrix, [0, 1, 0]);
    const z = applyCompassOrientation(matrix, [0, 0, 1]);
    assert.equal(Math.hypot(...x), 1);
    assert.equal(Math.hypot(...y), 1);
    assert.equal(Math.hypot(...z), 1);
    const cross = [
      x[1] * y[2] - x[2] * y[1],
      x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0],
    ];
    assert.deepEqual(cross, z);
  }
});

test('recovers the MICOAIR743 canonical IST8310-to-body quarter-turn without a target hard-code', () => {
  const expectedMatrix = [
    0, 1, 0,
    -1, 0, 0,
    0, 0, 1,
  ];
  const result = solveCompassOrientation(syntheticSamples({ matrix: expectedMatrix }), {
    minimumSamples: 150,
    minimumFaces: 5,
    minimumCumulativeRotationDegrees: 500,
  });
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.matrix, expectedMatrix);
  assert.ok(result.confidence >= 70, `confidence ${result.confidence}`);
  assert.ok(result.diagnostics.bestResidualDegrees < 5);
  assert.ok(result.diagnostics.marginDegrees > 5);
});

test('recovers a different proper mounting instead of assuming the prior board mapping', () => {
  const expected = COMPASS_ORIENTATION_CANDIDATES.find(({ label }) => (
    label === 'X←−Z, Y←−X, Z←Y'
  ));
  assert.ok(expected);
  const result = solveCompassOrientation(syntheticSamples({
    matrix: expected.matrix,
    bias: [-62, 31, 44],
    gain: [0.78, 1.21, 0.96],
  }));
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  assert.equal(result.candidateIndex, expected.index);
  assert.deepEqual(result.matrix, [...expected.matrix]);
});

test('rejects a stationary single-pose data set as unobservable', () => {
  const matrix = COMPASS_ORIENTATION_CANDIDATES[7].matrix;
  const result = solveCompassOrientation(syntheticSamples({ matrix, stationary: true }));
  assert.equal(result.accepted, false);
  assert.ok([
    'insufficient-pose-coverage',
    'insufficient-rotation',
  ].includes(result.reason), result.reason);
});

test('rejects too few synchronized samples before evaluating a mapping', () => {
  const matrix = COMPASS_ORIENTATION_CANDIDATES[3].matrix;
  const result = solveCompassOrientation(syntheticSamples({ matrix, count: 40 }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'insufficient-samples');
});

test('retains the last verified mapping after a rejected replacement pass', () => {
  const previous = {
    valid: true,
    candidateIndex: 4,
    matrix: [...COMPASS_ORIENTATION_CANDIDATES[4].matrix],
    label: COMPASS_ORIENTATION_CANDIDATES[4].label,
    confidence: 88,
  };
  const rejected = { accepted: false, reason: 'ambiguous-orientation' };
  const retained = preserveLastVerifiedCompassOrientation(previous, rejected);
  assert.equal(retained.candidateIndex, previous.candidateIndex);
  assert.deepEqual(retained.matrix, previous.matrix);
  assert.equal(retained.retainedAfterRejectedAttempt, true);
});
