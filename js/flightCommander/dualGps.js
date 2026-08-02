'use strict';

export const GPS_PRIMARY_SOURCE_UART = 0;
export const GPS_PRIMARY_SOURCE_DRONECAN = 1;
export const DRONECAN_NODE_ID_AUTO = 0;
export const DRONECAN_NODE_ID_DISABLED = 255;

function dataView(payload) {
    if (payload instanceof DataView) return payload;
    if (payload instanceof ArrayBuffer) return new DataView(payload);
    if (ArrayBuffer.isView(payload)) {
        return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    if (Array.isArray(payload)) {
        const bytes = Uint8Array.from(payload);
        return new DataView(bytes.buffer);
    }
    throw new TypeError('Flight Commander GPS payload must be byte-addressable.');
}

export function decodeDualGpsStatus(payload) {
    const data = dataView(payload);
    if (data.byteLength < 40) {
        throw new RangeError(`Dual-GPS status requires 40 bytes; received ${data.byteLength}.`);
    }
    const flags = data.getUint8(0);
    return {
        primarySource: data.getUint8(1),
        uartEnabled: (flags & (1 << 0)) !== 0,
        uartHealthy: (flags & (1 << 1)) !== 0,
        dronecanEnabled: (flags & (1 << 2)) !== 0,
        dronecanHealthy: (flags & (1 << 3)) !== 0,
        uartRtk: (flags & (1 << 4)) !== 0,
        dronecanRtk: (flags & (1 << 5)) !== 0,
        uartProvider: data.getUint8(2),
        uartFixType: data.getUint8(3),
        uartSatellites: data.getUint8(4),
        dronecanNodeId: data.getUint8(5),
        dronecanFixType: data.getUint8(6),
        dronecanSatellites: data.getUint8(7),
        uartLatitude: data.getInt32(8, true),
        uartLongitude: data.getInt32(12, true),
        uartAltitudeCm: data.getInt32(16, true),
        dronecanLatitude: data.getInt32(20, true),
        dronecanLongitude: data.getInt32(24, true),
        dronecanAltitudeCm: data.getInt32(28, true),
        dronecanAgeMs: data.getUint32(32, true),
        baselineHeadingCentidegrees: data.getInt16(36, true),
        baselineDistanceCm: data.getUint16(38, true),
    };
}

export function decodeDronecanConfig(payload) {
    const data = dataView(payload);
    if (data.byteLength < 4) {
        throw new RangeError(`DroneCAN configuration requires at least 4 bytes; received ${data.byteLength}.`);
    }
    return {
        nodeId: data.getUint8(0),
        bitrate: data.getUint8(1),
        gpsNodeId: data.getUint8(2),
        batteryNodeId: data.getUint8(3),
        primaryGpsSource: data.byteLength >= 5
            ? data.getUint8(4)
            : GPS_PRIMARY_SOURCE_UART,
        magNodeId: data.byteLength >= 6
            ? data.getUint8(5)
            : DRONECAN_NODE_ID_DISABLED,
    };
}

export function encodeDronecanConfig(config) {
    const values = {
        nodeId: Number(config?.nodeId),
        bitrate: Number(config?.bitrate),
        gpsNodeId: Number(config?.gpsNodeId),
        batteryNodeId: Number(config?.batteryNodeId),
        primaryGpsSource: Number(config?.primaryGpsSource),
        magNodeId: Number(config?.magNodeId ?? DRONECAN_NODE_ID_DISABLED),
    };
    if (!Number.isInteger(values.nodeId) || values.nodeId < 1 || values.nodeId > 127) {
        throw new RangeError('The Flight Commander DroneCAN node ID must be between 1 and 127.');
    }
    if (!Number.isInteger(values.bitrate) || values.bitrate < 0 || values.bitrate > 3) {
        throw new RangeError('The DroneCAN bitrate selection is invalid.');
    }
    if (!Number.isInteger(values.gpsNodeId)
        || values.gpsNodeId < 0
        || (values.gpsNodeId > 127 && values.gpsNodeId !== DRONECAN_NODE_ID_DISABLED)) {
        throw new RangeError('The DroneCAN GPS node must be Automatic, Disabled, or node 1 through 127.');
    }
    if (!Number.isInteger(values.batteryNodeId)
        || values.batteryNodeId < 0
        || (values.batteryNodeId > 127 && values.batteryNodeId !== DRONECAN_NODE_ID_DISABLED)) {
        throw new RangeError('The DroneCAN battery node must be Automatic, Disabled, or node 1 through 127.');
    }
    if (!Number.isInteger(values.magNodeId)
        || values.magNodeId < 0
        || (values.magNodeId > 127 && values.magNodeId !== DRONECAN_NODE_ID_DISABLED)) {
        throw new RangeError('The DroneCAN magnetometer node must be Automatic, Disabled, or node 1 through 127.');
    }
    if (![GPS_PRIMARY_SOURCE_UART, GPS_PRIMARY_SOURCE_DRONECAN]
        .includes(values.primaryGpsSource)) {
        throw new RangeError('Select UART GPS or DroneCAN GPS as the navigation primary.');
    }
    if (values.primaryGpsSource === GPS_PRIMARY_SOURCE_DRONECAN
        && values.gpsNodeId === DRONECAN_NODE_ID_DISABLED) {
        throw new RangeError('Enable a DroneCAN GPS/RTK node before selecting it as the navigation primary.');
    }
    return Uint8Array.of(
        values.nodeId,
        values.bitrate,
        values.gpsNodeId,
        values.batteryNodeId,
        values.primaryGpsSource,
        values.magNodeId,
    );
}
