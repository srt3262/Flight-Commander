'use strict';

export const DRONECAN_PAIR_STATUS_SCHEMA = 1;
export const DRONECAN_PAIR_STATUS_PAYLOAD_SIZE = 120;
export const DRONECAN_PAIR_COMMAND_SCHEMA = 1;

export const DRONECAN_PAIR_COMMAND_NONE = 0;
export const DRONECAN_PAIR_COMMAND_CONFIGURE = 1;
export const DRONECAN_PAIR_COMMAND_VERIFY = 2;
export const DRONECAN_PAIR_COMMAND_ABORT = 3;

export const DRONECAN_PAIR_STATE = Object.freeze({
    IDLE: 0,
    DISCOVER_BASE: 1,
    DISCOVER_ROVER: 2,
    CONFIGURE_BASE: 3,
    SAVE_BASE: 4,
    CONFIGURE_ROVER: 5,
    SAVE_ROVER: 6,
    RESTART_BASE: 7,
    RESTART_ROVER: 8,
    WAIT_RECONNECT: 9,
    VERIFY_BASE: 10,
    VERIFY_ROVER: 11,
    COMPLETE: 12,
    ERROR: 13,
    ABORTED: 14,
});

export const DRONECAN_PAIR_STATE_LABELS = Object.freeze([
    'Idle',
    'Reading moving-base identity',
    'Reading moving-rover identity',
    'Configuring moving base',
    'Saving moving-base parameters',
    'Configuring moving rover',
    'Saving moving-rover parameters',
    'Restarting moving base',
    'Restarting moving rover',
    'Waiting for both nodes to reconnect',
    'Verifying moving-base role',
    'Verifying moving-rover role',
    'Configuration complete',
    'Configuration error',
    'Configuration aborted',
]);

export const DRONECAN_PAIR_ERROR_LABELS = Object.freeze([
    'No error',
    'Pair binding is incomplete',
    'Moving base and rover use the same node ID',
    'Moving-base node is offline',
    'Moving-rover node is offline',
    'Node identity is not compatible with AP_Periph setup',
    'DroneCAN service request timed out',
    'Required AP_Periph parameter was not found',
    'AP_Periph rejected a parameter value',
    'AP_Periph parameter save failed',
    'AP_Periph restart failed',
    'Moving-base role verification failed',
    'Moving-rover role verification failed',
    'The aircraft must be disarmed',
    'The command payload is invalid',
    'DroneCAN transmit queue rejected the request',
]);

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
    throw new TypeError('DroneCAN moving-baseline payload must be byte-addressable.');
}

function fixedAscii(view, offset, length) {
    const bytes = [];
    for (let index = 0; index < length; index += 1) {
        const value = view.getUint8(offset + index);
        if (value === 0) break;
        bytes.push(value);
    }
    return String.fromCharCode(...bytes).replace(/[^\x20-\x7e]/g, '');
}

export function createDefaultDronecanPairStatus() {
    return {
        schema: DRONECAN_PAIR_STATUS_SCHEMA,
        state: DRONECAN_PAIR_STATE.IDLE,
        progress: 0,
        errorCode: 0,
        activeNodeId: 0,
        baseOnline: false,
        roverOnline: false,
        baseRoleVerified: false,
        roverRoleVerified: false,
        baseIdentityValid: false,
        roverIdentityValid: false,
        relativeHeadingFresh: false,
        configured: false,
        baseNodeId: 255,
        roverNodeId: 255,
        baseFixType: 0,
        baseSatellites: 0,
        baseAgeMs: 0xffff,
        roverFixType: 0,
        roverSatellites: 0,
        roverAgeMs: 0xffff,
        baseGpsType: -1,
        roverGpsType: -1,
        baseAutoConfig: -1,
        roverAutoConfig: -1,
        baseTermination: -1,
        roverTermination: -1,
        relativeHeadingCentidegrees: 0,
        relativeAccuracyCentidegrees: 0xffff,
        relativeDistanceCm: 0,
        relativeAgeMs: 0xffff,
        relativeHeadingCount: 0,
        serviceRequestCount: 0,
        serviceResponseCount: 0,
        serviceTimeoutCount: 0,
        baseSoftwareMajor: 0,
        baseSoftwareMinor: 0,
        roverSoftwareMajor: 0,
        roverSoftwareMinor: 0,
        baseName: '',
        roverName: '',
    };
}

export function decodeDronecanPairStatus(payload) {
    const data = viewOf(payload);
    if (data.byteLength !== DRONECAN_PAIR_STATUS_PAYLOAD_SIZE) {
        throw new RangeError(
            `DroneCAN pair status requires ${DRONECAN_PAIR_STATUS_PAYLOAD_SIZE} bytes; received ${data.byteLength}.`,
        );
    }
    const schema = data.getUint8(0);
    if (schema !== DRONECAN_PAIR_STATUS_SCHEMA) {
        throw new RangeError(`Unsupported DroneCAN pair status schema ${schema}.`);
    }
    const flags = data.getUint8(5);
    return {
        schema,
        state: data.getUint8(1),
        progress: data.getUint8(2),
        errorCode: data.getUint8(3),
        activeNodeId: data.getUint8(4),
        baseOnline: (flags & (1 << 0)) !== 0,
        roverOnline: (flags & (1 << 1)) !== 0,
        baseRoleVerified: (flags & (1 << 2)) !== 0,
        roverRoleVerified: (flags & (1 << 3)) !== 0,
        baseIdentityValid: (flags & (1 << 4)) !== 0,
        roverIdentityValid: (flags & (1 << 5)) !== 0,
        relativeHeadingFresh: (flags & (1 << 6)) !== 0,
        configured: (flags & (1 << 7)) !== 0,
        baseNodeId: data.getUint8(6),
        roverNodeId: data.getUint8(7),
        baseFixType: data.getUint8(8),
        baseSatellites: data.getUint8(9),
        baseAgeMs: data.getUint16(10, true),
        roverFixType: data.getUint8(12),
        roverSatellites: data.getUint8(13),
        roverAgeMs: data.getUint16(14, true),
        baseGpsType: data.getInt16(16, true),
        roverGpsType: data.getInt16(18, true),
        baseAutoConfig: data.getInt16(20, true),
        roverAutoConfig: data.getInt16(22, true),
        baseTermination: data.getInt16(24, true),
        roverTermination: data.getInt16(26, true),
        relativeHeadingCentidegrees: data.getUint16(28, true),
        relativeAccuracyCentidegrees: data.getUint16(30, true),
        relativeDistanceCm: data.getUint16(32, true),
        relativeAgeMs: data.getUint16(34, true),
        relativeHeadingCount: data.getUint32(36, true),
        serviceRequestCount: data.getUint32(40, true),
        serviceResponseCount: data.getUint32(44, true),
        serviceTimeoutCount: data.getUint32(48, true),
        baseSoftwareMajor: data.getUint8(52),
        baseSoftwareMinor: data.getUint8(53),
        roverSoftwareMajor: data.getUint8(54),
        roverSoftwareMinor: data.getUint8(55),
        baseName: fixedAscii(data, 56, 32),
        roverName: fixedAscii(data, 88, 32),
    };
}

export function encodeDronecanPairCommand(command) {
    const numeric = Number(command);
    if (![DRONECAN_PAIR_COMMAND_CONFIGURE, DRONECAN_PAIR_COMMAND_VERIFY, DRONECAN_PAIR_COMMAND_ABORT].includes(numeric)) {
        throw new RangeError('DroneCAN pair command must be Configure, Verify, or Abort.');
    }
    return Uint8Array.of(DRONECAN_PAIR_COMMAND_SCHEMA, numeric);
}

export function describeDronecanPairStatus(status) {
    const state = DRONECAN_PAIR_STATE_LABELS[status?.state] ?? `Unknown state ${status?.state}`;
    if (status?.errorCode) {
        return `${state}: ${DRONECAN_PAIR_ERROR_LABELS[status.errorCode] ?? `error ${status.errorCode}`}`;
    }
    return state;
}
