'use strict';

export const HEADING_CONFIG_SCHEMA = 2;
export const HEADING_STATUS_SCHEMA = 2;
export const HEADING_CONFIG_PAYLOAD_SIZE = 71;
export const HEADING_STATUS_PAYLOAD_SIZE = 39;

export const HEADING_SOURCE_ONBOARD_MAG = 0;
export const HEADING_SOURCE_EXTERNAL_I2C_MAG = 1;
export const HEADING_SOURCE_DRONECAN_MAG = 2;
export const HEADING_SOURCE_MOVING_BASELINE = 3;
export const HEADING_SOURCE_COUNT = 4;
export const HEADING_SOURCE_NONE = 255;

export const BASELINE_PROVIDER_AUTO = 0;
export const BASELINE_PROVIDER_UART = 1;
export const BASELINE_PROVIDER_DRONECAN = 2;

export const HEADING_SOURCE_LABELS = Object.freeze([
    'Onboard compass',
    'UART GPS-module compass (external I²C)',
    'DroneCAN GPS-module compass',
    'Moving-baseline GNSS yaw',
]);

export const EXTERNAL_MAG_HARDWARE = Object.freeze([
    { value: 0, label: 'Disabled / none' },
    { value: 1, label: 'Automatic detection' },
    { value: 2, label: 'HMC5883' },
    { value: 3, label: 'AK8975' },
    { value: 4, label: 'MAG3110' },
    { value: 5, label: 'AK8963' },
    { value: 6, label: 'IST8310' },
    { value: 7, label: 'QMC5883' },
    { value: 8, label: 'QMC5883P' },
    { value: 10, label: 'IST8308' },
    { value: 11, label: 'LIS3MDL' },
    { value: 14, label: 'VCM5883' },
    { value: 15, label: 'MLX90393' },
]);

const EXTERNAL_MAG_HARDWARE_VALUES = new Set(
    EXTERNAL_MAG_HARDWARE.map(({ value }) => value),
);

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
    throw new TypeError('Flight Commander heading payload must be byte-addressable.');
}

function finiteInteger(value, label, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
        throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
    }
    return numeric;
}

function signed16(value, label, minimum = -32768, maximum = 32767) {
    return finiteInteger(value, label, minimum, maximum);
}

function normalizeSource(source, index) {
    return {
        enabled: Boolean(source?.enabled),
        priority: finiteInteger(source?.priority, `${HEADING_SOURCE_LABELS[index]} priority`, 1, HEADING_SOURCE_COUNT),
        weight: finiteInteger(source?.weight, `${HEADING_SOURCE_LABELS[index]} weight`, 0, 100),
        yawOffsetCentidegrees: signed16(
            source?.yawOffsetCentidegrees,
            `${HEADING_SOURCE_LABELS[index]} yaw offset`,
            -18000,
            18000,
        ),
    };
}

export function clearLegacyCompassYawOffsets(config) {
    if (!Array.isArray(config?.sources)) return false;

    let changed = false;
    for (const sourceIndex of [
        HEADING_SOURCE_ONBOARD_MAG,
        HEADING_SOURCE_EXTERNAL_I2C_MAG,
        HEADING_SOURCE_DRONECAN_MAG,
    ]) {
        const source = config.sources[sourceIndex];
        if (source && Number(source.yawOffsetCentidegrees) !== 0) {
            source.yawOffsetCentidegrees = 0;
            changed = true;
        }
    }
    return changed;
}

export function createDefaultHeadingConfig() {
    return {
        movingBaselineEnabled: false,
        movingBaselineFixedOnly: true,
        movingBaselineProvider: BASELINE_PROVIDER_AUTO,
        externalMagHardware: 1,
        sources: [
            { enabled: true, priority: 1, weight: 100, yawOffsetCentidegrees: 0 },
            { enabled: false, priority: 2, weight: 75, yawOffsetCentidegrees: 0 },
            { enabled: false, priority: 3, weight: 50, yawOffsetCentidegrees: 0 },
            { enabled: false, priority: 4, weight: 25, yawOffsetCentidegrees: 0 },
        ],
        expectedBaselineCm: 50,
        baselineToleranceCm: 20,
        maxHeadingAccuracyCentidegrees: 500,
        sourceTimeoutMs: 750,
        maxDisagreementCentidegrees: 4500,
        externalMagAlignmentDecidegrees: [0, 0, 0],
        externalMagZero: [0, 0, 0],
        externalMagGain: [1024, 1024, 1024],
        dronecanMagAlignmentDecidegrees: [0, 0, 0],
        dronecanMagZeroMilliGauss: [0, 0, 0],
        dronecanMagGainMilliGauss: [0, 0, 0],
        dronecanMagCalibrationNodeId: 0,
    };
}

export function decodeHeadingConfig(payload) {
    const data = viewOf(payload);
    if (data.byteLength !== HEADING_CONFIG_PAYLOAD_SIZE) {
        throw new RangeError(`Heading configuration requires ${HEADING_CONFIG_PAYLOAD_SIZE} bytes; received ${data.byteLength}.`);
    }
    if (data.getUint8(0) !== HEADING_CONFIG_SCHEMA) {
        throw new RangeError(`Unsupported heading configuration schema ${data.getUint8(0)}.`);
    }
    const flags = data.getUint8(1);
    let offset = 4;
    const sources = [];
    for (let index = 0; index < HEADING_SOURCE_COUNT; index += 1) {
        sources.push({
            enabled: data.getUint8(offset) !== 0,
            priority: data.getUint8(offset + 1),
            weight: data.getUint8(offset + 2),
            yawOffsetCentidegrees: data.getInt16(offset + 3, true),
        });
        offset += 5;
    }
    const result = {
        movingBaselineEnabled: (flags & (1 << 0)) !== 0,
        movingBaselineFixedOnly: (flags & (1 << 1)) !== 0,
        movingBaselineProvider: data.getUint8(2),
        externalMagHardware: data.getUint8(3),
        sources,
        expectedBaselineCm: data.getUint16(offset, true),
        baselineToleranceCm: data.getUint16(offset + 2, true),
        maxHeadingAccuracyCentidegrees: data.getUint16(offset + 4, true),
        sourceTimeoutMs: data.getUint16(offset + 6, true),
        maxDisagreementCentidegrees: data.getUint16(offset + 8, true),
        externalMagAlignmentDecidegrees: [
            data.getInt16(offset + 10, true),
            data.getInt16(offset + 12, true),
            data.getInt16(offset + 14, true),
        ],
        externalMagZero: [
            data.getInt16(offset + 16, true),
            data.getInt16(offset + 18, true),
            data.getInt16(offset + 20, true),
        ],
        externalMagGain: [
            data.getInt16(offset + 22, true),
            data.getInt16(offset + 24, true),
            data.getInt16(offset + 26, true),
        ],
        dronecanMagAlignmentDecidegrees: [
            data.getInt16(offset + 28, true),
            data.getInt16(offset + 30, true),
            data.getInt16(offset + 32, true),
        ],
        dronecanMagZeroMilliGauss: [
            data.getInt16(offset + 34, true),
            data.getInt16(offset + 36, true),
            data.getInt16(offset + 38, true),
        ],
        dronecanMagGainMilliGauss: [
            data.getUint16(offset + 40, true),
            data.getUint16(offset + 42, true),
            data.getUint16(offset + 44, true),
        ],
        dronecanMagCalibrationNodeId: data.getUint8(offset + 46),
    };
    return result;
}

export function validateHeadingConfig(config, dronecanConfig = {}) {
    if (!Array.isArray(config?.sources) || config.sources.length !== HEADING_SOURCE_COUNT) {
        throw new RangeError(`Heading configuration requires exactly ${HEADING_SOURCE_COUNT} sources.`);
    }
    const normalized = {
        ...config,
        movingBaselineEnabled: Boolean(config.movingBaselineEnabled),
        movingBaselineFixedOnly: Boolean(config.movingBaselineFixedOnly),
        movingBaselineProvider: finiteInteger(config.movingBaselineProvider, 'Moving-baseline provider', 0, 2),
        externalMagHardware: finiteInteger(config.externalMagHardware, 'External compass hardware', 0, 16),
        sources: config.sources.map(normalizeSource),
        expectedBaselineCm: finiteInteger(config.expectedBaselineCm, 'Expected antenna baseline', 30, 1000),
        baselineToleranceCm: finiteInteger(config.baselineToleranceCm, 'Antenna baseline tolerance', 1, 999),
        maxHeadingAccuracyCentidegrees: finiteInteger(config.maxHeadingAccuracyCentidegrees, 'Maximum heading accuracy', 10, 4500),
        sourceTimeoutMs: finiteInteger(config.sourceTimeoutMs, 'Heading source timeout', 100, 5000),
        maxDisagreementCentidegrees: finiteInteger(config.maxDisagreementCentidegrees, 'Maximum source disagreement', 500, 9000),
        externalMagAlignmentDecidegrees: config.externalMagAlignmentDecidegrees?.map((value, axis) =>
            signed16(value, `External compass ${['roll', 'pitch', 'yaw'][axis]} alignment`, -1800, 3600)),
        externalMagZero: config.externalMagZero?.map((value, axis) => signed16(value, `External compass zero axis ${axis}`)),
        externalMagGain: config.externalMagGain?.map((value, axis) => finiteInteger(value, `External compass gain axis ${axis}`, 1, 32767)),
        dronecanMagAlignmentDecidegrees: config.dronecanMagAlignmentDecidegrees?.map((value, axis) =>
            signed16(value, `DroneCAN compass ${['roll', 'pitch', 'yaw'][axis]} alignment`, -1800, 3600)),
        dronecanMagZeroMilliGauss: config.dronecanMagZeroMilliGauss?.map((value, axis) =>
            signed16(value, `DroneCAN compass zero axis ${axis}`)),
        dronecanMagGainMilliGauss: config.dronecanMagGainMilliGauss?.map((value, axis) =>
            finiteInteger(value, `DroneCAN compass gain axis ${axis}`, 0, 5000)),
        dronecanMagCalibrationNodeId: finiteInteger(
            config.dronecanMagCalibrationNodeId,
            'DroneCAN compass calibration node',
            0,
            127,
        ),
    };
    clearLegacyCompassYawOffsets(normalized);
    if (!EXTERNAL_MAG_HARDWARE_VALUES.has(normalized.externalMagHardware)) {
        throw new RangeError('External compass hardware is not supported on the MICOAIR743 external I²C1 connector.');
    }
    for (const [label, values] of [
        ['External compass alignment', normalized.externalMagAlignmentDecidegrees],
        ['External compass zero', normalized.externalMagZero],
        ['External compass gain', normalized.externalMagGain],
        ['DroneCAN compass alignment', normalized.dronecanMagAlignmentDecidegrees],
        ['DroneCAN compass zero', normalized.dronecanMagZeroMilliGauss],
        ['DroneCAN compass gain', normalized.dronecanMagGainMilliGauss],
    ]) {
        if (!Array.isArray(values) || values.length !== 3) {
            throw new RangeError(`${label} requires roll/X, pitch/Y, and yaw/Z values.`);
        }
    }
    const calibratedCanAxes = normalized.dronecanMagGainMilliGauss.filter((value) => value > 0).length;
    if (calibratedCanAxes !== 0 && calibratedCanAxes !== 3) {
        throw new RangeError('DroneCAN compass calibration must contain all three axis gains or none.');
    }
    if ((normalized.dronecanMagCalibrationNodeId === 0) !== (calibratedCanAxes === 0)) {
        throw new RangeError('DroneCAN compass calibration gains must be bound to one CAN node.');
    }
    if (normalized.baselineToleranceCm >= normalized.expectedBaselineCm) {
        throw new RangeError('Antenna baseline tolerance must be smaller than the expected baseline.');
    }
    if (!normalized.sources.some((source) => source.enabled && source.weight > 0)) {
        throw new RangeError('Enable at least one heading source with a non-zero weight.');
    }
    const activePriorities = normalized.sources
        .filter((source) => source.enabled && source.weight > 0)
        .map((source) => source.priority);
    if (new Set(activePriorities).size !== activePriorities.length) {
        throw new RangeError('Every enabled heading source with a non-zero weight must have a unique priority.');
    }
    if (normalized.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG].enabled && normalized.externalMagHardware === 0) {
        throw new RangeError('Select an external compass type before enabling the UART GPS-module compass.');
    }
    if (normalized.sources[HEADING_SOURCE_DRONECAN_MAG].enabled &&
        Number(dronecanConfig?.magNodeId ?? 255) === 255) {
        throw new RangeError('Enable a DroneCAN magnetometer node before selecting the DroneCAN compass source.');
    }
    if (normalized.movingBaselineEnabled !== normalized.sources[HEADING_SOURCE_MOVING_BASELINE].enabled) {
        throw new RangeError('Moving-baseline enable and its heading-source enable must match.');
    }
    if (normalized.movingBaselineEnabled
        && normalized.movingBaselineProvider === BASELINE_PROVIDER_DRONECAN
        && Number(dronecanConfig?.gpsNodeId ?? 255) === 255) {
        throw new RangeError('Enable a DroneCAN GNSS node before using DroneCAN moving-baseline yaw.');
    }
    return normalized;
}

export function encodeHeadingConfig(config, dronecanConfig) {
    const value = validateHeadingConfig(config, dronecanConfig);
    const bytes = new Uint8Array(HEADING_CONFIG_PAYLOAD_SIZE);
    const data = new DataView(bytes.buffer);
    data.setUint8(0, HEADING_CONFIG_SCHEMA);
    data.setUint8(1, (value.movingBaselineEnabled ? 1 : 0) | (value.movingBaselineFixedOnly ? 2 : 0));
    data.setUint8(2, value.movingBaselineProvider);
    data.setUint8(3, value.externalMagHardware);
    let offset = 4;
    for (const source of value.sources) {
        data.setUint8(offset, source.enabled ? 1 : 0);
        data.setUint8(offset + 1, source.priority);
        data.setUint8(offset + 2, source.weight);
        data.setInt16(offset + 3, source.yawOffsetCentidegrees, true);
        offset += 5;
    }
    for (const number of [
        value.expectedBaselineCm,
        value.baselineToleranceCm,
        value.maxHeadingAccuracyCentidegrees,
        value.sourceTimeoutMs,
        value.maxDisagreementCentidegrees,
    ]) {
        data.setUint16(offset, number, true);
        offset += 2;
    }
    for (const number of [
        ...value.externalMagAlignmentDecidegrees,
        ...value.externalMagZero,
        ...value.externalMagGain,
        ...value.dronecanMagAlignmentDecidegrees,
        ...value.dronecanMagZeroMilliGauss,
        ...value.dronecanMagGainMilliGauss,
    ]) {
        data.setInt16(offset, number, true);
        offset += 2;
    }
    data.setUint8(offset, value.dronecanMagCalibrationNodeId);
    return bytes;
}

export function decodeHeadingStatus(payload) {
    const data = viewOf(payload);
    if (data.byteLength !== HEADING_STATUS_PAYLOAD_SIZE) {
        throw new RangeError(`Heading status requires ${HEADING_STATUS_PAYLOAD_SIZE} bytes; received ${data.byteLength}.`);
    }
    if (data.getUint8(0) !== HEADING_STATUS_SCHEMA) {
        throw new RangeError(`Unsupported heading status schema ${data.getUint8(0)}.`);
    }
    const calibratedMask = data.getUint8(16);
    const calibratingMask = data.getUint8(17);
    const calibrationFailedMask = data.getUint8(18);
    let offset = 19;
    const sources = [];
    for (let index = 0; index < HEADING_SOURCE_COUNT; index += 1) {
        sources.push({
            healthy: (data.getUint8(1) & (1 << index)) !== 0,
            active: (data.getUint8(2) & (1 << index)) !== 0,
            rejected: (data.getUint8(3) & (1 << index)) !== 0,
            calibrated: (calibratedMask & (1 << index)) !== 0,
            calibrating: (calibratingMask & (1 << index)) !== 0,
            calibrationFailed: (calibrationFailedMask & (1 << index)) !== 0,
            headingCentidegrees: data.getUint16(offset, true),
            ageMs: data.getUint16(offset + 2, true),
            quality: data.getUint8(offset + 4),
        });
        offset += 5;
    }
    return {
        healthyMask: data.getUint8(1),
        activeMask: data.getUint8(2),
        rejectedMask: data.getUint8(3),
        calibratedMask,
        calibratingMask,
        calibrationFailedMask,
        anchorSource: data.getUint8(4),
        baselineProvider: data.getUint8(5),
        baselineFixed: data.getUint8(6) !== 0,
        baselineNodeId: data.getUint8(7),
        fusedHeadingCentidegrees: data.getUint16(8, true),
        baselineHeadingCentidegrees: data.getUint16(10, true),
        baselineDistanceCm: data.getUint16(12, true),
        baselineAccuracyCentidegrees: data.getUint16(14, true),
        sources,
    };
}

function angularDifferenceDegrees(left, right) {
    return ((left - right + 540) % 360) - 180;
}

export function previewWeightedHeading(samples, config) {
    const enabled = samples
        .map((sample, index) => ({ sample, index, config: config.sources[index] }))
        .filter(({ sample, config: source }) => source.enabled && source.weight > 0 && sample?.healthy);
    if (enabled.length === 0) {
        return { anchorSource: HEADING_SOURCE_NONE, activeSources: [], rejectedSources: [], fusedHeadingDegrees: null };
    }
    enabled.sort((left, right) => left.config.priority - right.config.priority || left.index - right.index);
    const anchor = enabled[0];
    const maximumDifference = config.maxDisagreementCentidegrees / 100;
    const active = [];
    const rejected = [];
    let sine = 0;
    let cosine = 0;
    for (const candidate of enabled) {
        if (Math.abs(angularDifferenceDegrees(candidate.sample.headingDegrees, anchor.sample.headingDegrees)) > maximumDifference) {
            rejected.push(candidate.index);
            continue;
        }
        const radians = candidate.sample.headingDegrees * Math.PI / 180;
        const weightedQuality = candidate.config.weight * Math.max(0, Math.min(1, Number(candidate.sample.quality ?? 1)));
        sine += Math.sin(radians) * weightedQuality;
        cosine += Math.cos(radians) * weightedQuality;
        active.push(candidate.index);
    }
    const fused = (Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360;
    return {
        anchorSource: anchor.index,
        activeSources: active,
        rejectedSources: rejected,
        fusedHeadingDegrees: fused,
    };
}
