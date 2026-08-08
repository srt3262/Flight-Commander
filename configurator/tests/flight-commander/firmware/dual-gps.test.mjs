import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRONECAN_CONFIG_PAYLOAD_SIZE,
  DRONECAN_NODE_ID_DISABLED,
  DRONECAN_TERMINATION_ENABLED,
  DRONECAN_TERMINATION_UNCHANGED,
  GPS_PRIMARY_SOURCE_DRONECAN,
  GPS_PRIMARY_SOURCE_UART,
  decodeDronecanConfig,
  decodeDualGpsStatus,
  encodeDronecanConfig,
} from '../../../js/flightCommander/dualGps.js';

test('dual-GPS status keeps UART and DroneCAN RTK solutions independent', () => {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 0b00111111);
  view.setUint8(1, GPS_PRIMARY_SOURCE_DRONECAN);
  view.setUint8(2, 0);
  view.setUint8(3, 3);
  view.setUint8(4, 21);
  view.setUint8(5, 42);
  view.setUint8(6, 4);
  view.setUint8(7, 27);
  view.setInt32(8, 351234567, true);
  view.setInt32(12, -801234567, true);
  view.setInt32(16, 12345, true);
  view.setInt32(20, 351234890, true);
  view.setInt32(24, -801234111, true);
  view.setInt32(28, 12400, true);
  view.setUint32(32, 85, true);

  const status = decodeDualGpsStatus(bytes);
  assert.equal(status.primarySource, GPS_PRIMARY_SOURCE_DRONECAN);
  assert.equal(status.uartHealthy, true);
  assert.equal(status.dronecanHealthy, true);
  assert.equal(status.uartRtk, true);
  assert.equal(status.dronecanRtk, true);
  assert.equal(status.uartFixType, 3);
  assert.equal(status.dronecanFixType, 4);
  assert.equal(status.dronecanNodeId, 42);
  assert.equal(status.uartLongitude, -801234567);
  assert.equal(status.dronecanLongitude, -801234111);
});

test('DroneCAN configuration keeps navigation, base, rover and compass identities independent', () => {
  const encoded = encodeDronecanConfig({
    nodeId: 10,
    bitrate: 3,
    navigationNodeId: 42,
    batteryNodeId: DRONECAN_NODE_ID_DISABLED,
    primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
    magNodeId: 73,
    movingBaseNodeId: 41,
    movingRoverNodeId: 42,
    requireApPeriphIdentity: true,
    baseTermination: DRONECAN_TERMINATION_UNCHANGED,
    roverTermination: DRONECAN_TERMINATION_ENABLED,
  });

  assert.equal(encoded.byteLength, DRONECAN_CONFIG_PAYLOAD_SIZE);
  assert.deepEqual(Array.from(encoded), [2, 10, 3, 42, 255, 1, 73, 41, 42, 1, 0, 2]);
  assert.deepEqual(decodeDronecanConfig(encoded), {
    schema: 2,
    nodeId: 10,
    bitrate: 3,
    navigationNodeId: 42,
    gpsNodeId: 42,
    batteryNodeId: 255,
    primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
    magNodeId: 73,
    movingBaseNodeId: 41,
    movingRoverNodeId: 42,
    requireApPeriphIdentity: true,
    baseTermination: DRONECAN_TERMINATION_UNCHANGED,
    roverTermination: DRONECAN_TERMINATION_ENABLED,
  });
});

test('DroneCAN navigation primary fails closed without a navigation GNSS binding', () => {
  assert.throws(
    () => encodeDronecanConfig({
      nodeId: 10,
      bitrate: 3,
      navigationNodeId: DRONECAN_NODE_ID_DISABLED,
      batteryNodeId: DRONECAN_NODE_ID_DISABLED,
      primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
      magNodeId: DRONECAN_NODE_ID_DISABLED,
      movingBaseNodeId: DRONECAN_NODE_ID_DISABLED,
      movingRoverNodeId: DRONECAN_NODE_ID_DISABLED,
      baseTermination: DRONECAN_TERMINATION_UNCHANGED,
      roverTermination: DRONECAN_TERMINATION_UNCHANGED,
    }),
    /Enable a DroneCAN navigation GNSS node/,
  );
});

test('legacy four-byte DroneCAN config safely defaults new pair fields', () => {
  assert.deepEqual(decodeDronecanConfig([10, 2, 0, 0]), {
    schema: 1,
    nodeId: 10,
    bitrate: 2,
    navigationNodeId: 0,
    gpsNodeId: 0,
    batteryNodeId: 0,
    primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    magNodeId: DRONECAN_NODE_ID_DISABLED,
    movingBaseNodeId: DRONECAN_NODE_ID_DISABLED,
    movingRoverNodeId: DRONECAN_NODE_ID_DISABLED,
    requireApPeriphIdentity: true,
    baseTermination: DRONECAN_TERMINATION_UNCHANGED,
    roverTermination: DRONECAN_TERMINATION_UNCHANGED,
  });
});

test('pair validation rejects incomplete or duplicate node roles', () => {
  const base = {
    nodeId: 10,
    bitrate: 3,
    navigationNodeId: 42,
    batteryNodeId: DRONECAN_NODE_ID_DISABLED,
    primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    magNodeId: DRONECAN_NODE_ID_DISABLED,
    requireApPeriphIdentity: true,
    baseTermination: DRONECAN_TERMINATION_UNCHANGED,
    roverTermination: DRONECAN_TERMINATION_UNCHANGED,
  };

  assert.throws(
    () => encodeDronecanConfig({
      ...base,
      movingBaseNodeId: 41,
      movingRoverNodeId: DRONECAN_NODE_ID_DISABLED,
    }),
    /Select both a moving-base node and a moving-rover node/,
  );
  assert.throws(
    () => encodeDronecanConfig({
      ...base,
      movingBaseNodeId: 42,
      movingRoverNodeId: 42,
    }),
    /must be different/,
  );
});
