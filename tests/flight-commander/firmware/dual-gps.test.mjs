import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRONECAN_NODE_ID_DISABLED,
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

test('DroneCAN configuration can select either active GPS as primary', () => {
  const base = {
    nodeId: 10,
    bitrate: 3,
    gpsNodeId: 42,
    batteryNodeId: 0,
  };
  assert.deepEqual(
    Array.from(encodeDronecanConfig({
      ...base,
      primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    })),
    [10, 3, 42, 0, GPS_PRIMARY_SOURCE_UART, DRONECAN_NODE_ID_DISABLED],
  );
  assert.deepEqual(
    decodeDronecanConfig(encodeDronecanConfig({
      ...base,
      primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
    })),
    {
      ...base,
      primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
      magNodeId: DRONECAN_NODE_ID_DISABLED,
    },
  );
  assert.throws(
    () => encodeDronecanConfig({
      ...base,
      gpsNodeId: DRONECAN_NODE_ID_DISABLED,
      primaryGpsSource: GPS_PRIMARY_SOURCE_DRONECAN,
    }),
    /Enable a DroneCAN GPS\/RTK node/,
  );
  assert.deepEqual(
    Array.from(encodeDronecanConfig({
      ...base,
      batteryNodeId: DRONECAN_NODE_ID_DISABLED,
      primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    })),
    [10, 3, 42, DRONECAN_NODE_ID_DISABLED, GPS_PRIMARY_SOURCE_UART, DRONECAN_NODE_ID_DISABLED],
  );
});

test('legacy four-byte DroneCAN config safely defaults to UART primary', () => {
  assert.deepEqual(decodeDronecanConfig([10, 2, 0, 0]), {
    nodeId: 10,
    bitrate: 2,
    gpsNodeId: 0,
    batteryNodeId: 0,
    primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    magNodeId: DRONECAN_NODE_ID_DISABLED,
  });
});

test('DroneCAN compass selection is independent of GPS selection', () => {
  const encoded = encodeDronecanConfig({
    nodeId: 10,
    bitrate: 2,
    gpsNodeId: 42,
    batteryNodeId: DRONECAN_NODE_ID_DISABLED,
    primaryGpsSource: GPS_PRIMARY_SOURCE_UART,
    magNodeId: 73,
  });
  assert.deepEqual(Array.from(encoded), [10, 2, 42, 255, 0, 73]);
  assert.equal(decodeDronecanConfig(encoded).magNodeId, 73);
});
