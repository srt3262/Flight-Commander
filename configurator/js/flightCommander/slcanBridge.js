'use strict';

export const SLCAN_BRIDGE_SCHEMA = 1;
export const SLCAN_BRIDGE_ENTER_ACTION = 1;
export const SLCAN_BRIDGE_RESPONSE_SIZE = 4;

export const SLCAN_BRIDGE_ENTRY_RESULT = Object.freeze({
    ACCEPTED: 0,
    ALREADY_ACTIVE: 1,
    ARMED: 2,
    DRONECAN_OFFLINE: 3,
    INVALID_BITRATE: 4,
    INVALID_PORT: 5,
});

export const SLCAN_BRIDGE_ENTRY_RESULT_LABELS = Object.freeze([
    'SLCAN maintenance bridge accepted',
    'The SLCAN maintenance bridge is already active; reboot the flight controller to exit it',
    'Disarm the aircraft before entering the SLCAN maintenance bridge',
    'The DroneCAN bus must be online before entering the SLCAN maintenance bridge',
    'The active DroneCAN bitrate is not supported by the SLCAN maintenance bridge',
    'The requesting USB serial port is not available',
]);

function dataView(payload) {
    const value = payload?.data ?? payload;
    if (value instanceof DataView) return value;
    if (value instanceof ArrayBuffer) return new DataView(value);
    if (ArrayBuffer.isView(value)) {
        return new DataView(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) {
        const bytes = Uint8Array.from(value);
        return new DataView(bytes.buffer);
    }
    throw new TypeError('The SLCAN bridge response must be byte-addressable.');
}

export function encodeSlcanBridgeEnter() {
    return Uint8Array.of(SLCAN_BRIDGE_ENTER_ACTION);
}

export function decodeSlcanBridgeResponse(payload) {
    const data = dataView(payload);
    if (data.byteLength !== SLCAN_BRIDGE_RESPONSE_SIZE) {
        throw new RangeError(
            `SLCAN bridge response requires ${SLCAN_BRIDGE_RESPONSE_SIZE} bytes; received ${data.byteLength}.`,
        );
    }
    const schema = data.getUint8(0);
    if (schema !== SLCAN_BRIDGE_SCHEMA) {
        throw new RangeError(`Unsupported SLCAN bridge response schema ${schema}.`);
    }
    const result = data.getUint8(1);
    return {
        schema,
        result,
        accepted: result === SLCAN_BRIDGE_ENTRY_RESULT.ACCEPTED,
        bitrateKbps: data.getUint16(2, true),
        message: SLCAN_BRIDGE_ENTRY_RESULT_LABELS[result] ?? `SLCAN bridge rejected with result ${result}`,
    };
}
