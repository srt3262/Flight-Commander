'use strict';

export const DSHOT_PROTOCOL_IDS = Object.freeze([4, 5, 6]);
export const ESC_TELEMETRY_DATA_INVALID = 255;

export const DSHOT_CONFIGURATION_STATUS = Object.freeze({
    UNSUPPORTED: 'unsupported',
    DSHOT_REQUIRED: 'dshot-required',
    DISABLED: 'disabled',
    INVALID_MOTOR_POLES: 'invalid-motor-poles',
    READY: 'ready',
});

export function isDshotProtocol(protocol) {
    const value = Number(protocol);
    return Number.isInteger(value) && DSHOT_PROTOCOL_IDS.includes(value);
}

export function validateMotorPoleCount(motorPoles) {
    const value = Number(motorPoles);
    if (!Number.isInteger(value)) {
        return { valid: false, value: null, reason: 'not-an-integer' };
    }
    if (value < 4 || value > 255) {
        return { valid: false, value, reason: 'out-of-range' };
    }
    return { valid: true, value, reason: null };
}

export function getDshotConfigurationState({
    protocol,
    bidirectionalSupported = false,
    bidirectionalEnabled = false,
    extendedTelemetrySupported = false,
    extendedTelemetryEnabled = false,
    motorPoles,
} = {}) {
    const dshotProtocol = isDshotProtocol(protocol);
    const bidirectionalAllowed = Boolean(bidirectionalSupported) && dshotProtocol;
    const bidirectionalActive = bidirectionalAllowed && Boolean(bidirectionalEnabled);
    const extendedTelemetryAllowed = Boolean(extendedTelemetrySupported) && bidirectionalActive;
    const motorPoleValidation = validateMotorPoleCount(motorPoles);

    let status = DSHOT_CONFIGURATION_STATUS.READY;
    if (!bidirectionalSupported) {
        status = DSHOT_CONFIGURATION_STATUS.UNSUPPORTED;
    } else if (!dshotProtocol) {
        status = DSHOT_CONFIGURATION_STATUS.DSHOT_REQUIRED;
    } else if (!bidirectionalEnabled) {
        status = DSHOT_CONFIGURATION_STATUS.DISABLED;
    } else if (!motorPoleValidation.valid) {
        status = DSHOT_CONFIGURATION_STATUS.INVALID_MOTOR_POLES;
    }

    return {
        status,
        dshotProtocol,
        bidirectionalAllowed,
        bidirectionalActive,
        extendedTelemetryAllowed,
        extendedTelemetryActive: extendedTelemetryAllowed && Boolean(extendedTelemetryEnabled),
        motorPoleValidation,
        telemetryReady: status === DSHOT_CONFIGURATION_STATUS.READY,
    };
}

export function normalizeDshotDependencies(configuration = {}) {
    const state = getDshotConfigurationState(configuration);
    return {
        bidirectionalEnabled: state.bidirectionalAllowed
            ? Boolean(configuration.bidirectionalEnabled)
            : false,
        extendedTelemetryEnabled: state.extendedTelemetryAllowed
            ? Boolean(configuration.extendedTelemetryEnabled)
            : false,
    };
}

function payloadView(payload) {
    if (payload instanceof DataView) {
        return payload;
    }
    if (payload instanceof ArrayBuffer) {
        return new DataView(payload);
    }
    if (ArrayBuffer.isView(payload)) {
        return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    if (Array.isArray(payload)) {
        const bytes = Uint8Array.from(payload);
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    throw new TypeError('ESC telemetry payload must be byte-addressable.');
}

function limitedMotorCount(count, maximumMotorCount) {
    if (maximumMotorCount === undefined || maximumMotorCount === null) {
        return count;
    }
    const maximum = Number(maximumMotorCount);
    if (!Number.isInteger(maximum) || maximum < 0) {
        throw new RangeError('Maximum motor count must be a non-negative integer.');
    }
    return Math.min(count, maximum);
}

export function decodeEscRpmPayload(payload, maximumMotorCount) {
    const view = payloadView(payload);
    if (view.byteLength === 0 || view.byteLength % 4 !== 0) {
        throw new RangeError('ESC RPM payload must contain one 32-bit RPM value per motor.');
    }

    const motorCount = limitedMotorCount(view.byteLength / 4, maximumMotorCount);
    const motors = [];
    for (let index = 0; index < motorCount; index++) {
        motors.push({
            index,
            rpm: view.getUint32(index * 4, true),
        });
    }
    return motors;
}

export function decodeEscTelemetryPayload(payload, maximumMotorCount) {
    const view = payloadView(payload);
    if (view.byteLength < 1) {
        throw new RangeError('ESC telemetry payload is missing its motor count.');
    }

    const reportedMotorCount = view.getUint8(0);
    if (reportedMotorCount === 0) {
        if (view.byteLength !== 1) {
            throw new RangeError('ESC telemetry payload has data but reports no motors.');
        }
        return [];
    }

    const dataLength = view.byteLength - 1;
    if (dataLength % reportedMotorCount !== 0) {
        throw new RangeError('ESC telemetry payload length does not match its motor count.');
    }

    const stride = dataLength / reportedMotorCount;
    // escSensorData_t is naturally aligned to 16 bytes on supported FC targets.
    // Accept the 13-byte packed form too so recorded/test payloads remain portable.
    const aligned = stride >= 16;
    if (!aligned && stride < 13) {
        throw new RangeError('ESC telemetry motor record is too short.');
    }

    const motorCount = limitedMotorCount(reportedMotorCount, maximumMotorCount);
    const motors = [];
    for (let index = 0; index < motorCount; index++) {
        const offset = 1 + index * stride;
        const dataAge = view.getUint8(offset);
        motors.push({
            index,
            dataAge,
            valid: dataAge !== ESC_TELEMETRY_DATA_INVALID,
            temperature: view.getInt16(offset + (aligned ? 2 : 1), true),
            voltage: view.getInt16(offset + (aligned ? 4 : 3), true),
            current: view.getInt32(offset + (aligned ? 8 : 5), true),
            rpm: view.getUint32(offset + (aligned ? 12 : 9), true),
        });
    }
    return motors;
}
