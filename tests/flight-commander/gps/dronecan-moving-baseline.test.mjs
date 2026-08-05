import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DRONECAN_CONFIG_PAYLOAD_SIZE,
    DRONECAN_NODE_ID_DISABLED,
    DRONECAN_TERMINATION_ENABLED,
    decodeDronecanConfig,
    encodeDronecanConfig,
} from '../../../js/flightCommander/dualGps.js';
import {
    DRONECAN_PAIR_COMMAND_CONFIGURE,
    DRONECAN_PAIR_STATE,
    DRONECAN_PAIR_STATUS_PAYLOAD_SIZE,
    decodeDronecanPairStatus,
    encodeDronecanPairCommand,
} from '../../../js/flightCommander/dronecanMovingBaseline.js';

test('DroneCAN 4.0 configuration preserves independent base, rover, navigation and compass bindings', () => {
    const encoded = encodeDronecanConfig({
        nodeId: 10,
        bitrate: 3,
        navigationNodeId: 42,
        batteryNodeId: DRONECAN_NODE_ID_DISABLED,
        primaryGpsSource: 1,
        magNodeId: 43,
        movingBaseNodeId: 41,
        movingRoverNodeId: 42,
        requireApPeriphIdentity: true,
        baseTermination: 0,
        roverTermination: DRONECAN_TERMINATION_ENABLED,
    });

    assert.equal(encoded.byteLength, DRONECAN_CONFIG_PAYLOAD_SIZE);
    assert.deepEqual(decodeDronecanConfig(encoded), {
        schema: 2,
        nodeId: 10,
        bitrate: 3,
        navigationNodeId: 42,
        gpsNodeId: 42,
        batteryNodeId: 255,
        primaryGpsSource: 1,
        magNodeId: 43,
        movingBaseNodeId: 41,
        movingRoverNodeId: 42,
        requireApPeriphIdentity: true,
        baseTermination: 0,
        roverTermination: 2,
    });
});

test('DroneCAN pair validation rejects incomplete and duplicate role bindings', () => {
    const common = {
        nodeId: 10,
        bitrate: 3,
        navigationNodeId: 42,
        batteryNodeId: 255,
        primaryGpsSource: 1,
        magNodeId: 255,
        requireApPeriphIdentity: true,
        baseTermination: 0,
        roverTermination: 0,
    };

    assert.throws(
        () => encodeDronecanConfig({ ...common, movingBaseNodeId: 41, movingRoverNodeId: 255 }),
        /both a moving-base node and a moving-rover node/i,
    );
    assert.throws(
        () => encodeDronecanConfig({ ...common, movingBaseNodeId: 42, movingRoverNodeId: 42 }),
        /must be different/i,
    );
});

test('pair status decoder exposes role verification and live relative-heading telemetry', () => {
    const bytes = new Uint8Array(DRONECAN_PAIR_STATUS_PAYLOAD_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, 1);
    view.setUint8(1, DRONECAN_PAIR_STATE.COMPLETE);
    view.setUint8(2, 100);
    view.setUint8(5, 0xff);
    view.setUint8(6, 41);
    view.setUint8(7, 42);
    view.setUint8(8, 4);
    view.setUint8(9, 29);
    view.setUint16(10, 120, true);
    view.setUint8(12, 4);
    view.setUint8(13, 31);
    view.setUint16(14, 80, true);
    view.setInt16(16, 17, true);
    view.setInt16(18, 18, true);
    view.setInt16(20, 1, true);
    view.setInt16(22, 1, true);
    view.setUint16(28, 18325, true);
    view.setUint16(30, 35, true);
    view.setUint16(32, 51, true);
    view.setUint16(34, 62, true);
    view.setUint32(36, 900, true);
    view.setUint8(52, 1);
    view.setUint8(53, 6);
    view.setUint8(54, 1);
    view.setUint8(55, 6);
    new TextEncoder().encodeInto('org.ardupilot.holybro.base', bytes.subarray(56, 88));
    new TextEncoder().encodeInto('org.ardupilot.holybro.rover', bytes.subarray(88, 120));

    const decoded = decodeDronecanPairStatus(bytes);
    assert.equal(decoded.configured, true);
    assert.equal(decoded.baseRoleVerified, true);
    assert.equal(decoded.roverRoleVerified, true);
    assert.equal(decoded.baseGpsType, 17);
    assert.equal(decoded.roverGpsType, 18);
    assert.equal(decoded.relativeHeadingCentidegrees, 18325);
    assert.equal(decoded.relativeDistanceCm, 51);
    assert.match(decoded.baseName, /holybro\.base/);
    assert.match(decoded.roverName, /holybro\.rover/);
});

test('pair command wire contract is explicit and versioned', () => {
    assert.deepEqual(
        [...encodeDronecanPairCommand(DRONECAN_PAIR_COMMAND_CONFIGURE)],
        [1, DRONECAN_PAIR_COMMAND_CONFIGURE],
    );
    assert.throws(() => encodeDronecanPairCommand(99), /Configure, Verify, or Abort/);
});
