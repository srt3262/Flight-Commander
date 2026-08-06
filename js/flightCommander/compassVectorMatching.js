'use strict';

const EPSILON = 1e-9;

function dot(left, right) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(vector) {
    return Math.sqrt(dot(vector, vector));
}

function normalize(vector) {
    const magnitude = length(vector);
    if (!Number.isFinite(magnitude) || magnitude < EPSILON) return null;
    return vector.map((value) => value / magnitude);
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function permutationParity(permutation) {
    let inversions = 0;
    for (let left = 0; left < permutation.length; left += 1) {
        for (let right = left + 1; right < permutation.length; right += 1) {
            if (permutation[left] > permutation[right]) inversions += 1;
        }
    }
    return inversions % 2 === 0 ? 1 : -1;
}

function matrixDeterminant(matrix) {
    return (
        matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
        - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
        + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
    );
}

function createCandidateMatrix(permutation, signs) {
    const matrix = new Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
        matrix[row * 3 + permutation[row]] = signs[row];
    }
    return matrix;
}

function axisToken(row) {
    const axes = ['X', 'Y', 'Z'];
    const source = row.findIndex((value) => value !== 0);
    const sign = row[source] < 0 ? '−' : '';
    return `${sign}${axes[source]}`;
}

function matrixLabel(matrix) {
    return [0, 1, 2]
        .map((row) => `${['X', 'Y', 'Z'][row]}←${axisToken(matrix.slice(row * 3, row * 3 + 3))}`)
        .join(', ');
}

export const COMPASS_ORIENTATION_CANDIDATES = Object.freeze((() => {
    const permutations = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2],
        [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const candidates = [];
    for (const permutation of permutations) {
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const signs = [sx, sy, sz];
                    if (permutationParity(permutation) * sx * sy * sz !== 1) continue;
                    const matrix = createCandidateMatrix(permutation, signs);
                    if (Math.round(matrixDeterminant(matrix)) !== 1) continue;
                    candidates.push(Object.freeze({
                        index: candidates.length,
                        matrix: Object.freeze(matrix),
                        label: matrixLabel(matrix),
                    }));
                }
            }
        }
    }
    return candidates;
})());

export function applyCompassOrientation(matrix, vector) {
    return [
        matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
        matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
        matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
    ];
}

function quaternionNormalize(quaternion) {
    const magnitude = Math.sqrt(quaternion.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(magnitude) || magnitude < EPSILON) return null;
    return quaternion.map((value) => value / magnitude);
}

export function rotateBodyVectorToWorld(quaternion, vector) {
    const normalized = quaternionNormalize(quaternion);
    if (!normalized) return null;
    const [w, x, y, z] = normalized;
    const [vx, vy, vz] = vector;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    ];
}

export function rotateWorldVectorToBody(quaternion, vector) {
    const normalized = quaternionNormalize(quaternion);
    if (!normalized) return null;
    return rotateBodyVectorToWorld(
        [normalized[0], -normalized[1], -normalized[2], -normalized[3]],
        vector,
    );
}

export function estimateNativeCompassCalibration(samples) {
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    for (const sample of samples ?? []) {
        if (!Array.isArray(sample?.mag) || sample.mag.length !== 3) continue;
        if (!sample.mag.every(Number.isFinite)) continue;
        for (let axis = 0; axis < 3; axis += 1) {
            minimum[axis] = Math.min(minimum[axis], sample.mag[axis]);
            maximum[axis] = Math.max(maximum[axis], sample.mag[axis]);
        }
        count += 1;
    }
    if (count === 0) return null;
    const zero = minimum.map((value, axis) => (value + maximum[axis]) / 2);
    const radius = minimum.map((value, axis) => (maximum[axis] - value) / 2);
    if (radius.some((value) => !Number.isFinite(value) || value < EPSILON)) return null;
    const averageRadius = radius.reduce((sum, value) => sum + value, 0) / 3;
    const gain = radius.map((value) => averageRadius / value);
    return { count, minimum, maximum, zero, gain, radius, averageRadius };
}

export function applyNativeCompassCalibration(calibration, vector) {
    return vector.map(
        (value, axis) => (value - calibration.zero[axis]) * calibration.gain[axis],
    );
}

function gravityFaceMask(samples) {
    let mask = 0;
    for (const sample of samples) {
        let gravity = sample.gravityBody;
        if (!Array.isArray(gravity) && Array.isArray(sample.quaternion)) {
            gravity = rotateWorldVectorToBody(sample.quaternion, [0, 0, 1]);
        }
        const normalized = normalize(gravity ?? []);
        if (!normalized) continue;
        let axis = 0;
        for (let candidate = 1; candidate < 3; candidate += 1) {
            if (Math.abs(normalized[candidate]) > Math.abs(normalized[axis])) axis = candidate;
        }
        if (Math.abs(normalized[axis]) < 0.72) continue;
        const signOffset = normalized[axis] >= 0 ? 0 : 1;
        mask |= 1 << (axis * 2 + signOffset);
    }
    return mask;
}

function bitCount(value) {
    let remaining = value >>> 0;
    let count = 0;
    while (remaining !== 0) {
        count += remaining & 1;
        remaining >>>= 1;
    }
    return count;
}

function quaternionRelativeAngleDegrees(left, right) {
    const qLeft = quaternionNormalize(left);
    const qRight = quaternionNormalize(right);
    if (!qLeft || !qRight) return 0;
    const absoluteDot = Math.abs(
        qLeft[0] * qRight[0]
        + qLeft[1] * qRight[1]
        + qLeft[2] * qRight[2]
        + qLeft[3] * qRight[3],
    );
    return 2 * Math.acos(clamp(absoluteDot, -1, 1)) * 180 / Math.PI;
}

function cumulativeRotationDegrees(samples) {
    let total = 0;
    let previous = null;
    for (const sample of samples) {
        if (!Array.isArray(sample.quaternion)) continue;
        if (previous) total += quaternionRelativeAngleDegrees(previous, sample.quaternion);
        previous = sample.quaternion;
    }
    return total;
}

function scoreCandidate(candidate, preparedSamples) {
    const worldVectors = [];
    const sum = [0, 0, 0];
    for (const sample of preparedSamples) {
        const body = applyCompassOrientation(candidate.matrix, sample.mag);
        const world = normalize(rotateBodyVectorToWorld(sample.quaternion, body));
        if (!world) continue;
        worldVectors.push(world);
        for (let axis = 0; axis < 3; axis += 1) sum[axis] += world[axis];
    }
    const mean = normalize(sum);
    if (!mean || worldVectors.length === 0) {
        return { ...candidate, residualDegrees: Infinity, coherence: 0, samples: 0 };
    }
    let squaredAngleSum = 0;
    for (const world of worldVectors) {
        const angle = Math.acos(clamp(dot(world, mean), -1, 1));
        squaredAngleSum += angle * angle;
    }
    const residualDegrees = Math.sqrt(squaredAngleSum / worldVectors.length) * 180 / Math.PI;
    return {
        ...candidate,
        residualDegrees,
        coherence: length(sum) / worldVectors.length,
        samples: worldVectors.length,
        meanWorldField: mean,
    };
}

function calibratedFieldSpread(preparedSamples) {
    const magnitudes = preparedSamples.map((sample) => length(sample.mag));
    const mean = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
    if (!Number.isFinite(mean) || mean < EPSILON) return Infinity;
    const minimum = Math.min(...magnitudes);
    const maximum = Math.max(...magnitudes);
    return (maximum - minimum) / mean;
}

export const DEFAULT_COMPASS_VECTOR_MATCHING_LIMITS = Object.freeze({
    minimumSamples: 160,
    minimumFaces: 5,
    minimumCumulativeRotationDegrees: 540,
    maximumFieldSpread: 0.25,
    maximumResidualDegrees: 12,
    minimumMarginDegrees: 5,
});

export function solveCompassOrientation(samples, options = {}) {
    const limits = { ...DEFAULT_COMPASS_VECTOR_MATCHING_LIMITS, ...options };
    const usable = (samples ?? []).filter((sample) => (
        Array.isArray(sample?.mag)
        && sample.mag.length === 3
        && sample.mag.every(Number.isFinite)
        && Array.isArray(sample.quaternion)
        && sample.quaternion.length === 4
        && sample.quaternion.every(Number.isFinite)
    ));
    const facesMask = gravityFaceMask(usable);
    const faces = bitCount(facesMask);
    const cumulativeRotation = cumulativeRotationDegrees(usable);
    const calibration = estimateNativeCompassCalibration(usable);
    const diagnostics = {
        samples: usable.length,
        faces,
        facesMask,
        cumulativeRotationDegrees: cumulativeRotation,
    };

    if (usable.length < limits.minimumSamples) {
        return { accepted: false, reason: 'insufficient-samples', diagnostics };
    }
    if (faces < limits.minimumFaces) {
        return { accepted: false, reason: 'insufficient-pose-coverage', diagnostics };
    }
    if (cumulativeRotation < limits.minimumCumulativeRotationDegrees) {
        return { accepted: false, reason: 'insufficient-rotation', diagnostics };
    }
    if (!calibration) {
        return { accepted: false, reason: 'calibration-envelope-invalid', diagnostics };
    }

    const prepared = usable.map((sample) => ({
        quaternion: sample.quaternion,
        mag: applyNativeCompassCalibration(calibration, sample.mag),
    }));
    const fieldSpread = calibratedFieldSpread(prepared);
    diagnostics.fieldSpread = fieldSpread;
    if (!Number.isFinite(fieldSpread) || fieldSpread > limits.maximumFieldSpread) {
        return {
            accepted: false,
            reason: 'magnetic-field-disturbed',
            diagnostics,
            calibration,
        };
    }

    const scores = COMPASS_ORIENTATION_CANDIDATES
        .map((candidate) => scoreCandidate(candidate, prepared))
        .sort((left, right) => left.residualDegrees - right.residualDegrees);
    const best = scores[0];
    const second = scores[1];
    const marginDegrees = second.residualDegrees - best.residualDegrees;
    diagnostics.bestResidualDegrees = best.residualDegrees;
    diagnostics.secondResidualDegrees = second.residualDegrees;
    diagnostics.marginDegrees = marginDegrees;

    if (best.residualDegrees > limits.maximumResidualDegrees) {
        return {
            accepted: false,
            reason: 'excessive-residual',
            diagnostics,
            calibration,
            best,
            second,
            scores,
        };
    }
    if (marginDegrees < limits.minimumMarginDegrees) {
        return {
            accepted: false,
            reason: 'ambiguous-orientation',
            diagnostics,
            calibration,
            best,
            second,
            scores,
        };
    }

    const residualScore = 1 - best.residualDegrees / limits.maximumResidualDegrees;
    const marginScore = clamp(marginDegrees / (limits.minimumMarginDegrees * 3), 0, 1);
    const coverageScore = clamp((faces - limits.minimumFaces + 1) / 2, 0, 1);
    const confidence = Math.round(100 * clamp(
        residualScore * 0.55 + marginScore * 0.30 + coverageScore * 0.15,
        0,
        1,
    ));

    return {
        accepted: true,
        reason: 'accepted',
        candidateIndex: best.index,
        matrix: [...best.matrix],
        label: best.label,
        confidence,
        diagnostics,
        calibration,
        best,
        second,
        scores,
    };
}

export function preserveLastVerifiedCompassOrientation(previous, attempted) {
    if (attempted?.accepted) {
        return {
            valid: true,
            candidateIndex: attempted.candidateIndex,
            matrix: [...attempted.matrix],
            label: attempted.label,
            confidence: attempted.confidence,
            diagnostics: { ...attempted.diagnostics },
        };
    }
    return previous ? { ...previous, retainedAfterRejectedAttempt: true } : null;
}
