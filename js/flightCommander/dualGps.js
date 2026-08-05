'use strict';

export const GPS_PRIMARY_SOURCE_UART = 0;
export const GPS_PRIMARY_SOURCE_DRONECAN = 1;
export const DRONECAN_NODE_ID_AUTO = 0;
export const DRONECAN_NODE_ID_DISABLED = 255;

export const DRONECAN_CONFIG_SCHEMA = 2;
export const DRONECAN_CONFIG_PAYLOAD_SIZE = 12;

export const DRONECAN_TERMINATION_UNCHANGED = 0;
export const DRONECAN_TERMINATION_DISABLED = 1;
export const DRONECAN_TERMINATION_ENABLED = 2;

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

function nodeId(value, label, { allowAutomatic = true, allowDisabled = true } = {}) {
    const numeric = Number(value);
    const special = (allowAutomatic && numeric === DRONECAN_NODE_ID_AUTO)
        || (allowDisabled && numeric === DRONECAN_NODE_ID_DISABLED);
    if (!Number.isInteger(numeric) || (!special && (numeric < 1 || numeric > 127))) {
        const choices = [allowAutomatic ? 'Automatic' : null, allowDisabled ? 'Disabled' : null, 'node 1 through 127']
            .filter(Boolean)
            .join(', ');
        throw new RangeError(`${label} must be ${choices}.`);
    }
    return numeric;
}

function termination(value, label) {
    const numeric = Number(value);
    if (![DRONECAN_TERMINATION_UNCHANGED, DRONECAN_TERMINATION_DISABLED, DRONECAN_TERMINATION_ENABLED].includes(numeric)) {
        throw new RangeError(`${label} must be Unchanged, Disabled, or Enabled.`);
    }
    return numeric;
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
        baselineHeadingCentidegrees: data.getUint16(36, true),
        baselineDistanceCm: data.getUint16(38, true),
    };
}

export function createDefaultDronecanConfig() {
    return {
        schema: DRONECAN_CONFIG_SCHEMA,
        nodeId: 10,
        bitrate: 3,
        navigationNodeId: DRONECAN_NODE_ID_DISABLED,
        // Compatibility alias used by extensions written for Flight Commander 3.x.
        gpsNodeId: DRONECAN_NODE_ID_DISABLED,
        batteryNodeId: DRONECAN_NODE_ID_DISABLED,
        primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
        magNodeId: DRONECAN_NODE_ID_DISABLED,
        movingBaseNodeId: DRONECAN_NODE_ID_DISABLED,
        movingRoverNodeId: DRONECAN_NODE_ID_DISABLED,
        requireApPeriphIdentity: true,
        baseTermination: DRONECAN_TERMINATION_UNCHANGED,
        roverTermination: DRONECAN_TERMINATION_UNCHANGED,
    };
}

export function decodeDronecanConfig(payload) {
    const data = dataView(payload);

    // Flight Commander 3.x compatibility. Version 4 firmware always emits the
    // schema byte and the complete pair binding.
    if (data.byteLength >= 4 && data.byteLength < DRONECAN_CONFIG_PAYLOAD_SIZE) {
        const legacy = createDefaultDronecanConfig();
        legacy.schema = 1;
        legacy.nodeId = data.getUint8(0);
        legacy.bitrate = data.getUint8(1);
        legacy.navigationNodeId = data.getUint8(2);
        legacy.gpsNodeId = legacy.navigationNodeId;
        legacy.batteryNodeId = data.getUint8(3);
        if (data.byteLength >= 5) legacy.primaryGpsSource = data.getUint8(4);
        if (data.byteLength >= 6) legacy.magNodeId = data.getUint8(5);
        return legacy;
    }

    if (data.byteLength !== DRONECAN_CONFIG_PAYLOAD_SIZE) {
        throw new RangeError(
            `DroneCAN configuration schema ${DRONECAN_CONFIG_SCHEMA} requires ${DRONECAN_CONFIG_PAYLOAD_SIZE} bytes; received ${data.byteLength}.`,
        );
    }
    const schema = data.getUint8(0);
    if (schema !== DRONECAN_CONFIG_SCHEMA) {
        throw new RangeError(`Unsupported DroneCAN configuration schema ${schema}.`);
    }
    const navigationNodeId = data.getUint8(3);
    return {
        schema,
        nodeId: data.getUint8(1),
        bitrate: data.getUint8(2),
        navigationNodeId,
        gpsNodeId: navigationNodeId,
        batteryNodeId: data.getUint8(4),
        primaryGpsSource: data.getUint8(5),
        magNodeId: data.getUint8(6),
        movingBaseNodeId: data.getUint8(7),
        movingRoverNodeId: data.getUint8(8),
        requireApPeriphIdentity: (data.getUint8(9) & 1) !== 0,
        baseTermination: data.getUint8(10),
        roverTermination: data.getUint8(11),
    };
}

export function validateDronecanConfig(config) {
    const navigationNodeId = nodeId(
        config?.navigationNodeId ?? config?.gpsNodeId,
        'The DroneCAN navigation GPS node',
    );
    const value = {
        ...createDefaultDronecanConfig(),
        ...config,
        schema: DRONECAN_CONFIG_SCHEMA,
        nodeId: nodeId(config?.nodeId, 'The Flight Commander DroneCAN node ID', {
            allowAutomatic: false,
            allowDisabled: false,
        }),
        bitrate: Number(config?.bitrate),
        navigationNodeId,
        gpsNodeId: navigationNodeId,
        batteryNodeId: nodeId(config?.batteryNodeId, 'The DroneCAN battery node'),
        primaryGpsSource: Number(config?.primaryGpsSource),
        magNodeId: nodeId(config?.magNodeId, 'The DroneCAN magnetometer node'),
        movingBaseNodeId: nodeId(config?.movingBaseNodeId, 'The moving-base GNSS node', {
            allowAutomatic: false,
        }),
        movingRoverNodeId: nodeId(config?.movingRoverNodeId, 'The moving-rover GNSS node', {
            allowAutomatic: false,
        }),
        requireApPeriphIdentity: config?.requireApPeriphIdentity !== false,
        baseTermination: termination(config?.baseTermination, 'Moving-base CAN termination'),
        roverTermination: termination(config?.roverTermination, 'Moving-rover CAN termination'),
    };

    if (!Number.isInteger(value.bitrate) || value.bitrate < 0 || value.bitrate > 3) {
        throw new RangeError('The DroneCAN bitrate selection is invalid.');
    }
    if (![GPS_PRIMARY_SOURCE_UART, GPS_PRIMARY_SOURCE_DRONECAN].includes(value.primaryGpsSource)) {
        throw new RangeError('Select UART GPS or DroneCAN GPS as the navigation primary.');
    }
    if (value.primaryGpsSource === GPS_PRIMARY_SOURCE_DRONECAN
        && value.navigationNodeId === DRONECAN_NODE_ID_DISABLED) {
        throw new RangeError('Enable a DroneCAN navigation GNSS node before selecting it as primary.');
    }

    const baseConfigured = value.movingBaseNodeId !== DRONECAN_NODE_ID_DISABLED;
    const roverConfigured = value.movingRoverNodeId !== DRONECAN_NODE_ID_DISABLED;
    if (baseConfigured !== roverConfigured) {
        throw new RangeError('Select both a moving-base node and a moving-rover node, or disable both.');
    }
    if (baseConfigured && value.movingBaseNodeId === value.movingRoverNodeId) {
        throw new RangeError('The moving base and moving rover must be different DroneCAN nodes.');
    }

    return value;
}

export function encodeDronecanConfig(config) {
    const value = validateDronecanConfig(config);
    return Uint8Array.of(
        DRONECAN_CONFIG_SCHEMA,
        value.nodeId,
        value.bitrate,
        value.navigationNodeId,
        value.batteryNodeId,
        value.primaryGpsSource,
        value.magNodeId,
        value.movingBaseNodeId,
        value.movingRoverNodeId,
        value.requireApPeriphIdentity ? 1 : 0,
        value.baseTermination,
        value.roverTermination,
    );
}
