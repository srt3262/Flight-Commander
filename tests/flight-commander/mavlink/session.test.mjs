import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  FIRMWARE_FAMILY_ARDUPILOT,
  FIRMWARE_FAMILY_INAV,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MavlinkSession,
} from "../../../js/mavlink/mavlinkSession.js";
import {
  canonicalMessageName,
  normalizeMavlinkEnvelope,
} from "../../../js/mavlink/frameNormalizer.js";

class FakeBridge {
  constructor() {
    this.encoded = [];
    this.resetCount = 0;
    this.unsubscribed = false;
  }

  onMavlinkMessage(listener) {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = null;
    };
  }

  mavlinkReset() {
    this.resetCount += 1;
  }

  mavlinkFeed(bytes) {
    this.fed = Array.from(bytes);
  }

  async mavlinkEncode(messageName, payload, options) {
    this.encoded.push({ messageName, payload, options });
    return Uint8Array.of(0xfd, this.encoded.length);
  }
}

class FakeConnection {
  constructor() {
    this.listeners = new Set();
    this.sent = [];
  }

  addOnReceiveListener(listener) {
    this.listeners.add(listener);
  }

  removeOnReceiveCallback(listener) {
    this.listeners.delete(listener);
  }

  send(bytes, callback) {
    this.sent.push(Array.from(bytes));
    callback({ resultCode: 0, bytesSent: bytes.length });
  }
}

function heartbeat({
  autopilot = 3,
  type = 2,
  customMode = 0,
  baseMode = 0,
  systemStatus = 4,
  sysid = 1,
  compid = 1,
} = {}) {
  return {
    messageName: "HEARTBEAT",
    data: {
      autopilot,
      type,
      customMode,
      baseMode,
      systemStatus,
    },
    header: { sysid, compid },
    protocol: "MAVLinkV2",
  };
}

const sessions = new Set();

function createAttachedSession(options = {}) {
  const bridge = new FakeBridge();
  const connection = new FakeConnection();
  const session = new MavlinkSession({
    bridge,
    firmwareDetectionTimeoutMs: 25,
    ...options,
  });
  session.attach(connection);
  sessions.add(session);
  return { session, bridge, connection };
}

afterEach(() => {
  for (const session of sessions) session.destroy();
  sessions.clear();
});

describe("decoded frame normalization", () => {
  test("normalizes node-mavlink-style names, headers, protocol and payloads", () => {
    const frame = normalizeMavlinkEnvelope({
      name: "GLOBAL_POSITION_INT",
      message: {
        lat: 351234567,
        lon: -789123456,
      },
      header: {
        systemId: 42,
        componentId: 7,
        payload_length: 28,
      },
      protocolVersion: 2,
    });

    assert.equal(frame.messageName, "GlobalPositionInt");
    assert.deepEqual(frame.data, {
      lat: 351234567,
      lon: -789123456,
    });
    assert.equal(frame.header.sysid, 42);
    assert.equal(frame.header.compid, 7);
    assert.equal(frame.header.payloadLength, 28);
    assert.equal(frame.protocol, "MAV_V2");
    assert.equal(canonicalMessageName("COMMAND_ACK"), "CommandAck");
  });

  test("rejects decoded frames with no message identity", () => {
    assert.throws(
      () => normalizeMavlinkEnvelope({ data: { value: 1 } }),
      /does not identify its message type/,
    );
  });
});

describe("MAVLink state normalization and firmware detection", () => {
  test("normalizes heartbeat, position, attitude, battery and sentinel values", () => {
    const { session } = createAttachedSession({
      firmwareFamilyOverride: FIRMWARE_FAMILY_ARDUPILOT,
    });

    session.handleMessage(
      heartbeat({
        customMode: 5,
        baseMode: MAV_MODE_FLAG_SAFETY_ARMED,
      }),
    );
    session.handleMessage({
      name: "GLOBAL_POSITION_INT",
      message: {
        lat: 350000000,
        lon: -780000000,
        alt: 123450,
        relative_alt: 23450,
        vx: 300,
        vy: 400,
        hdg: 65535,
      },
      header: { systemId: 1, componentId: 1 },
    });
    session.handleMessage({
      name: "ATTITUDE",
      message: {
        roll: Math.PI / 2,
        pitch: -Math.PI / 4,
        yaw: Math.PI,
      },
      header: { systemId: 1, componentId: 1 },
    });
    session.handleMessage({
      name: "SYS_STATUS",
      message: {
        voltage_battery: 25200,
        current_battery: -1,
        battery_remaining: 73,
      },
      header: { systemId: 1, componentId: 1 },
    });
    session.handleMessage({
      name: "GPS_RAW_INT",
      message: {
        fix_type: 6,
        satellites_visible: 255,
        eph: 65535,
      },
      header: { systemId: 1, componentId: 1 },
    });

    const state = session.snapshot();
    assert.equal(state.connected, true);
    assert.equal(state.protocolVersion, 2);
    assert.equal(state.systemId, 1);
    assert.equal(state.armed, true);
    assert.equal(state.modeName, "LOITER");
    assert.equal(state.latitude, 35);
    assert.equal(state.longitude, -78);
    assert.equal(state.altitudeMsl, 123.45);
    assert.equal(state.relativeAltitude, 23.45);
    assert.equal(state.groundSpeed, 5);
    assert.equal(state.heading, null);
    assert.ok(Math.abs(state.roll - 90) < 1e-9);
    assert.ok(Math.abs(state.pitch + 45) < 1e-9);
    assert.ok(Math.abs(state.yaw - 180) < 1e-9);
    assert.equal(state.voltage, 25.2);
    assert.equal(state.current, null);
    assert.equal(state.batteryRemaining, 73);
    assert.equal(state.gpsFix, 6);
    assert.equal(state.satellites, null);
    assert.equal(state.hdop, null);
  });

  test("identifies generic-autopilot heartbeat as INAV", () => {
    const { session } = createAttachedSession();
    session.handleMessage(heartbeat({ autopilot: 0 }));
    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_INAV);
    assert.equal(session.state.firmwareFamilySource, "heartbeat");
  });

  test("uses parameter stream fingerprint to distinguish INAV from ArduPilot", () => {
    const inav = createAttachedSession().session;
    inav.handleMessage(heartbeat({ autopilot: 3, sysid: 11 }));
    assert.equal(inav.state.firmwareFamily, "unknown");
    assert.equal(inav.state.firmwareFamilySource, "probing");
    inav.handleMessage({
      name: "PARAM_VALUE",
      message: { param_count: 0, param_id: "", param_value: 0 },
      header: { systemId: 11, componentId: 1 },
    });
    assert.equal(inav.state.firmwareFamily, FIRMWARE_FAMILY_INAV);
    assert.equal(inav.state.firmwareFamilySource, "parameter-fingerprint");

    const ardupilot = createAttachedSession().session;
    ardupilot.handleMessage(heartbeat({ autopilot: 3, sysid: 12 }));
    ardupilot.handleMessage({
      name: "PARAM_VALUE",
      message: { param_count: 900, param_id: "SYSID_THISMAV", param_value: 1 },
      header: { systemId: 12, componentId: 1 },
    });
    assert.equal(ardupilot.state.firmwareFamily, FIRMWARE_FAMILY_ARDUPILOT);
    assert.equal(ardupilot.state.firmwareFamilySource, "parameter-stream");
  });

  test("falls back to ArduPilot when the compatibility fingerprint probe is silent", async () => {
    const { session } = createAttachedSession({
      firmwareDetectionTimeoutMs: 10,
    });
    session.handleMessage(heartbeat({ autopilot: 3, sysid: 21 }));
    assert.equal(session.state.firmwareFamilySource, "probing");

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_ARDUPILOT);
    assert.equal(session.state.firmwareFamilySource, "probe-timeout");
  });
});

describe("commands, acknowledgements and cleanup", () => {
  test("confirms mode and arm commands from subsequent heartbeat state", async () => {
    const { session, bridge } = createAttachedSession({
      firmwareFamilyOverride: FIRMWARE_FAMILY_ARDUPILOT,
    });
    session.handleMessage(heartbeat({ customMode: 0 }));

    const modePromise = session.setMode("GUIDED", { timeoutMs: 100 });
    await Promise.resolve();
    session.handleMessage(heartbeat({ customMode: 4 }));
    assert.equal((await modePromise).modeName, "GUIDED");
    assert.equal(
      bridge.encoded.some(
        ({ messageName, payload }) =>
          messageName === "SetMode" && payload.customMode === 4,
      ),
      true,
    );

    const armPromise = session.setArmed(true, { timeoutMs: 100 });
    await Promise.resolve();
    session.handleMessage(
      heartbeat({
        customMode: 4,
        baseMode: MAV_MODE_FLAG_SAFETY_ARMED,
      }),
    );
    assert.equal((await armPromise).armed, true);
  });

  test("accepts progress ACK, rejects negative ACK, and times out cleanly", async () => {
    const { session } = createAttachedSession({
      firmwareFamilyOverride: FIRMWARE_FAMILY_ARDUPILOT,
    });
    session.handleMessage(heartbeat());

    const progress = [];
    const accepted = session.sendCommandLong(
      300,
      {},
      {
        timeoutMs: 100,
        onProgress: (ack) => progress.push(ack.progress),
      },
    );
    await Promise.resolve();
    session.handleMessage({
      name: "COMMAND_ACK",
      message: { command: 300, result: 5, progress: 45 },
      header: { systemId: 1, componentId: 1 },
    });
    session.handleMessage({
      name: "COMMAND_ACK",
      message: { command: 300, result: 0 },
      header: { systemId: 1, componentId: 1 },
    });
    assert.equal((await accepted).result, 0);
    assert.deepEqual(progress, [45]);

    const denied = session.sendCommandLong(400, {}, { timeoutMs: 100 });
    await Promise.resolve();
    session.handleMessage({
      name: "COMMAND_ACK",
      message: { command: 400, result: 2 },
      header: { systemId: 1, componentId: 1 },
    });
    await assert.rejects(denied, /Command 400 was denied/);

    await assert.rejects(
      session.sendCommandLong(511, {}, { timeoutMs: 10 }),
      /Timed out waiting for COMMAND_ACK/,
    );
    assert.equal(session.listeners.get("message")?.size ?? 0, 0);
  });

  test("destroy removes transport, IPC, interval and event listeners", () => {
    const { session, bridge, connection } = createAttachedSession();
    session.on("state", () => {});
    assert.equal(connection.listeners.size, 1);
    assert.ok(session.watchdog != null);

    session.destroy();

    assert.equal(connection.listeners.size, 0);
    assert.equal(bridge.unsubscribed, true);
    assert.equal(session.watchdog, null);
    assert.equal(session.gcsHeartbeat, null);
    assert.equal(session.firmwareDetectionTimer, null);
    assert.equal(session.listeners.size, 0);
    sessions.delete(session);
  });
});
