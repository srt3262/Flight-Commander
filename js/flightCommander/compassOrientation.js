'use strict';

export const COMPASS_ORIENTATION_STATUS_SCHEMA = 1;
export const COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE = 52;
export const COMPASS_ORIENTATION_COMMAND_SCHEMA = 1;
export const COMPASS_ORIENTATION_COMMAND_PAYLOAD_SIZE = 4;
export const COMPASS_ORIENTATION_SOURCE_ONBOARD = 0;
export const COMPASS_ORIENTATION_FACE_NONE = 255;

export const COMPASS_ORIENTATION_PHASE = Object.freeze({
    IDLE: 0,
    COLLECTING: 1,
    SOLVED: 2,
    FAILED: 3,
});

export const COMPASS_ORIENTATION_COMMAND = Object.freeze({
    START: 1,
    CANCEL: 2,
    COMMIT: 3,
    CLEAR: 4,
});

export const COMPASS_ORIENTATION_FLAG = Object.freeze({
    VALID: 1 << 0,
    ACTIVE: 1 << 1,
    SOLVED: 1 << 2,
    ACCEL_CALIBRATED: 1 << 3,
    FIELD_CALIBRATED: 1 << 4,
    COMPASS_PRESENT: 1 << 5,
    ARMED: 1 << 6,
    SAMPLE_ACCEPTED: 1 << 7,
});

export const COMPASS_ORIENTATION_FACES = Object.freeze([
    Object.freeze({ index: 0, label: 'Nose up', axis: '+X' }),
    Object.freeze({ index: 1, label: 'Tail up', axis: '-X' }),
    Object.freeze({ index: 2, label: 'Left side up', axis: '+Y' }),
    Object.freeze({ index: 3, label: 'Right side up', axis: '-Y' }),
    Object.freeze({ index: 4, label: 'Top up', axis: '+Z' }),
    Object.freeze({ index: 5, label: 'Bottom up', axis: '-Z' }),
]);

export const COMPASS_ORIENTATION_FAILURE_LABELS = Object.freeze({
    0: '',
    1: 'The controller is armed. Disarm before learning compass orientation.',
    2: 'Complete and save the six-position accelerometer calibration first.',
    3: 'The onboard compass is not detected.',
    4: 'Magnetic range was too small or too uneven. Move away from metal and high-current wiring, then repeat.',
    5: 'The data matched more than one axis transform. Repeat all six positions with wider, cleaner rotations.',
    6: 'The best transform residual was too large. Keep the requested face upward while rotating around that face.',
    7: 'No physically valid right-handed axis transform could be solved.',
});

const OUTPUT_AXES = Object.freeze(['X', 'Y', 'Z']);
const INPUT_AXES = Object.freeze(['X', 'Y', 'Z']);

function viewOf(payload) {
    if (payload instanceof DataView) return payload;
    if (payload instanceof ArrayBuffer) return new DataView(payload);
    if (ArrayBuffer.isView(payload)) {
        return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    if (Array.isArray(payload)) {
        const bytes = Uint8Array.from(payload);
        return new DataView(bytes.buffer);
    }
    throw new TypeError('Compass-orientation payload must be byte-addressable.');
}

function int8(view, offset) {
    return view.getInt8(offset);
}

export function axisMapIsProper(axisMap) {
    if (!Array.isArray(axisMap) || axisMap.length !== 3) return false;
    const used = new Set();
    let signProduct = 1;
    const permutation = [];
    for (const value of axisMap) {
        if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 3) return false;
        const input = Math.abs(value) - 1;
        if (used.has(input)) return false;
        used.add(input);
        permutation.push(input);
        signProduct *= value < 0 ? -1 : 1;
    }
    let inversions = 0;
    for (let first = 0; first < 3; first += 1) {
        for (let second = first + 1; second < 3; second += 1) {
            if (permutation[first] > permutation[second]) inversions += 1;
        }
    }
    return ((inversions & 1) ? -1 : 1) * signProduct === 1;
}

export function formatAxisMap(axisMap) {
    if (!axisMapIsProper(axisMap)) return 'Not learned';
    return axisMap.map((value, outputAxis) => {
        const sign = value < 0 ? '−' : '+';
        const inputAxis = INPUT_AXES[Math.abs(value) - 1];
        return `Board ${OUTPUT_AXES[outputAxis]} = ${sign}Mag ${inputAxis}`;
    }).join(' · ');
}

export function decodeCompassOrientationStatus(payload) {
    const data = viewOf(payload);
    if (data.byteLength !== COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE) {
        throw new RangeError(
            `Compass-orientation status requires ${COMPASS_ORIENTATION_STATUS_PAYLOAD_SIZE} bytes; received ${data.byteLength}.`,
        );
    }
    const schema = data.getUint8(0);
    if (schema !== COMPASS_ORIENTATION_STATUS_SCHEMA) {
        throw new RangeError(`Unsupported compass-orientation status schema ${schema}.`);
    }
    const flags = data.getUint8(2);
    const phase = data.getUint8(1);
    const failureReason = data.getUint8(3);
    const faceProgress = Array.from({ length: 6 }, (_, index) => data.getUint8(32 + index));
    const faceSamples = Array.from({ length: 6 }, (_, index) => data.getUint8(38 + index));
    const candidateAxisMap = [int8(data, 26), int8(data, 27), int8(data, 28)];
    const storedAxisMap = [int8(data, 29), int8(data, 30), int8(data, 31)];
    return {
        schema,
        phase,
        flags,
        failureReason,
        failureLabel: COMPASS_ORIENTATION_FAILURE_LABELS[failureReason]
            ?? `Compass-orientation failure ${failureReason}.`,
        completedMask: data.getUint8(4),
        currentFace: data.getUint8(5),
        nextFace: data.getUint8(6),
        confidencePercent: data.getUint8(7),
        residualDegrees: data.getUint16(8, true) / 100,
        separationDegrees: data.getUint16(10, true) / 100,
        totalSamples: data.getUint16(12, true),
        currentFaceSamples: data.getUint16(14, true),
        currentFaceRotationDegrees: data.getUint16(16, true) / 100,
        calibrationGeneration: data.getUint32(18, true),
        sensorFingerprint: data.getUint32(22, true),
        candidateAxisMap,
        storedAxisMap,
        candidateMapping: formatAxisMap(candidateAxisMap),
        storedMapping: formatAxisMap(storedAxisMap),
        faceProgress,
        faceSamples,
        detectedFace: data.getUint8(44),
        accelerometerG: [
            data.getInt16(46, true) / 1000,
            data.getInt16(48, true) / 1000,
            data.getInt16(50, true) / 1000,
        ],
        valid: (flags & COMPASS_ORIENTATION_FLAG.VALID) !== 0,
        active: (flags & COMPASS_ORIENTATION_FLAG.ACTIVE) !== 0,
        solved: (flags & COMPASS_ORIENTATION_FLAG.SOLVED) !== 0,
        accelerometerCalibrated: (flags & COMPASS_ORIENTATION_FLAG.ACCEL_CALIBRATED) !== 0,
        fieldCalibrated: (flags & COMPASS_ORIENTATION_FLAG.FIELD_CALIBRATED) !== 0,
        compassPresent: (flags & COMPASS_ORIENTATION_FLAG.COMPASS_PRESENT) !== 0,
        armed: (flags & COMPASS_ORIENTATION_FLAG.ARMED) !== 0,
        sampleAccepted: (flags & COMPASS_ORIENTATION_FLAG.SAMPLE_ACCEPTED) !== 0,
    };
}

export function encodeCompassOrientationCommand(
    command,
    source = COMPASS_ORIENTATION_SOURCE_ONBOARD,
) {
    if (!Object.values(COMPASS_ORIENTATION_COMMAND).includes(Number(command))) {
        throw new RangeError(`Unsupported compass-orientation command ${command}.`);
    }
    if (!Number.isInteger(Number(source)) || Number(source) < 0 || Number(source) > 255) {
        throw new RangeError('Compass-orientation source must fit in one byte.');
    }
    return Uint8Array.of(
        COMPASS_ORIENTATION_COMMAND_SCHEMA,
        Number(command),
        Number(source),
        0,
    );
}

export function compassOrientationStage(status) {
    if (!status) return { label: 'Unavailable', tone: 'warning' };
    if (status.phase === COMPASS_ORIENTATION_PHASE.FAILED) {
        return { label: 'Learning failed', tone: 'error' };
    }
    if (status.active) return { label: 'Learning orientation', tone: 'working' };
    if (status.solved) return { label: 'Ready to store', tone: 'working' };
    if (status.valid) return { label: 'Transform stored', tone: 'ready' };
    if (!status.accelerometerCalibrated) return { label: 'Accelerometer required', tone: 'warning' };
    if (!status.compassPresent) return { label: 'Compass not detected', tone: 'error' };
    return { label: 'Orientation required', tone: 'warning' };
}

// Compatibility entry point retained for extensions that imported the older
// fixed-transform guard. It now exposes the actual learned-orientation state.
export function onboardCompassOrientationRequirement(status = null) {
    return {
        required: true,
        satisfied: Boolean(status?.valid),
        mapping: status?.storedMapping ?? 'Not learned',
    };
}
