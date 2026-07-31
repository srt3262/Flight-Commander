import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  FIRMWARE_FAMILY_ARDUPILOT,
  FIRMWARE_FAMILY_INAV,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MavlinkSession,
} from "../../../js/mavlink/mavlinkSession.js";
import { MavlinkIpcCodec } from "../../../js/main/mavlink.js";
import {
  canonicalMessageName,
  normalizeMavlinkEnvelope,
} from "../../../js/mavlink/frameNormalizer.js";

class FakeBridge {
  constructor() {
    this.encoded = [];
    this.resetCount = 0;
    this.resetGenerations = [];
    this.feeds = [];
    this.unsubscribed = false;
  }

  onMavlinkMessage(listener) {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = null;
    };
  }

  mavlinkReset(generation) {
    this.resetCount += 1;
    this.resetGenerations.push(generation);
  }

  mavlinkFeed(bytes, generation) {
    this.fed = Array.from(bytes);
    this.feeds.push({
      bytes: Array.from(bytes),
      generation,
    });
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

  receive(bytes) {
    for (const listener of [...this.listeners]) {
      listener({ data: bytes });
    }
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

function referencedSetTimeout(callback, delay) {
  return { timer: setTimeout(callback, delay) };
}

function clearReferencedTimeout(handle) {
  clearTimeout(handle?.timer ?? handle);
}

function createAttachedSession(options = {}) {
  const bridge = new FakeBridge();
  const connection = new FakeConnection();
  const session = new MavlinkSession({
    bridge,
    firmwareDetectionTimeoutMs: 25,
    discoveryDelayMs: 0,
    setTimeoutFn: referencedSetTimeout,
    clearTimeoutFn: clearReferencedTimeout,
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

  test("publishes the validated connection before firmware state updates", () => {
    const { session } = createAttachedSession();
    const events = [];
    session.on("connected", () => events.push("connected"));
    session.on("state", (state) => {
      if (state.connected) events.push("state");
    });

    session.handleMessage(heartbeat({ autopilot: 0 }));

    assert.equal(events[0], "connected");
    assert.equal(events.filter((event) => event === "connected").length, 1);
    assert.equal(events.includes("state"), true);
  });

  test("does not unlock the vehicle session for malformed or non-vehicle heartbeats", () => {
    const { session } = createAttachedSession();
    let connectedEvents = 0;
    session.on("connected", () => {
      connectedEvents += 1;
    });

    const missingType = heartbeat();
    delete missingType.data.type;
    const missingAutopilot = heartbeat();
    delete missingAutopilot.data.autopilot;
    const missingComponent = heartbeat();
    delete missingComponent.header.compid;

    const rejected = [
      heartbeat({ sysid: 0 }),
      heartbeat({ compid: 0 }),
      heartbeat({ type: 6 }),
      heartbeat({ autopilot: 8 }),
      heartbeat({ type: 256 }),
      heartbeat({ autopilot: 3.5 }),
      missingType,
      missingAutopilot,
      missingComponent,
    ];
    for (const frame of rejected) {
      assert.equal(session.handleMessage(frame), false);
      assert.equal(session.state.connected, false);
      assert.equal(session.state.systemId, null);
    }
    assert.equal(connectedEvents, 0);

    assert.equal(
      session.handleMessage(heartbeat({ type: 0, autopilot: 0 })),
      true,
    );
    assert.equal(session.state.connected, true);
    assert.equal(session.state.systemId, 1);
    assert.equal(connectedEvents, 1);
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
  test("drops queued bytes and decoded frames from an earlier attachment", () => {
    const {
      session,
      bridge,
      connection: firstConnection,
    } = createAttachedSession();
    const firstGeneration = session.attachmentGeneration;
    const queuedFirstRead = [...firstConnection.listeners][0];
    const secondConnection = new FakeConnection();

    session.attach(secondConnection);
    const secondGeneration = session.attachmentGeneration;
    assert.notEqual(secondGeneration, firstGeneration);

    queuedFirstRead({ data: Uint8Array.of(0xfd, 0x01) });
    assert.deepEqual(bridge.feeds, []);

    secondConnection.receive(Uint8Array.of(0xfd, 0x02));
    assert.deepEqual(bridge.feeds, [
      {
        bytes: [0xfd, 0x02],
        generation: secondGeneration,
      },
    ]);

    bridge.listener({
      ...heartbeat(),
      generation: firstGeneration,
    });
    bridge.listener(heartbeat());
    assert.equal(session.state.connected, false);

    bridge.listener({
      ...heartbeat(),
      generation: secondGeneration,
    });
    assert.equal(session.state.connected, true);
  });

  test("does not send an asynchronously encoded command on a replacement attachment", async () => {
    const { session, bridge } = createAttachedSession();
    await Promise.resolve();
    await Promise.resolve();

    let releaseCommand;
    const normalEncode = bridge.mavlinkEncode.bind(bridge);
    bridge.mavlinkEncode = (messageName, payload, options) => {
      if (messageName !== "CommandLong") {
        return normalEncode(messageName, payload, options);
      }
      bridge.encoded.push({ messageName, payload, options });
      return new Promise((resolve) => {
        releaseCommand = () => resolve(Uint8Array.of(0xfd, 0x7f));
      });
    };

    const pending = session.send("CommandLong", {
      targetSystem: 1,
      targetComponent: 1,
      command: 400,
    });
    await Promise.resolve();
    assert.equal(typeof releaseCommand, "function");

    const replacement = new FakeConnection();
    session.attach(replacement);
    releaseCommand();

    await assert.rejects(
      pending,
      (error) => error.code === "MAVLINK_SESSION_DETACHED",
    );
    assert.equal(
      replacement.sent.some((bytes) => bytes.length === 2 && bytes[1] === 0x7f),
      false,
    );
  });

  test("does not report a stale discovery result on a replacement attachment", async () => {
    const bridge = new FakeBridge();
    let releaseFirstProbe;
    let heartbeatEncodes = 0;
    const normalEncode = bridge.mavlinkEncode.bind(bridge);
    bridge.mavlinkEncode = (messageName, payload, options) => {
      if (messageName === "Heartbeat" && heartbeatEncodes++ === 0) {
        return new Promise((resolve) => {
          releaseFirstProbe = () => resolve(Uint8Array.of(0xfe, 0x01));
        });
      }
      return normalEncode(messageName, payload, options);
    };
    const firstConnection = new FakeConnection();
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 0,
    });
    sessions.add(session);
    const diagnostics = [];
    session.on("transportDiagnostic", (entry) => diagnostics.push(entry));

    session.attach(firstConnection);
    await Promise.resolve();
    assert.equal(typeof releaseFirstProbe, "function");

    const replacement = new FakeConnection();
    session.attach(replacement);
    await Promise.resolve();
    await Promise.resolve();
    releaseFirstProbe();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      diagnostics.some(({ stage }) => stage === "discovery-heartbeat-failed"),
      false,
    );
    assert.equal(
      diagnostics.every(
        ({ generation }) => generation === session.attachmentGeneration,
      ),
      true,
    );
    assert.equal(firstConnection.sent.length, 0);
    assert.equal(replacement.sent.length > 0, true);
  });

  test("keeps discovery single-flight when MAVLink encoding is delayed", async () => {
    const bridge = new FakeBridge();
    let releaseFirstProbe;
    let heartbeatEncodes = 0;
    const normalEncode = bridge.mavlinkEncode.bind(bridge);
    bridge.mavlinkEncode = (messageName, payload, options) => {
      if (messageName === "Heartbeat") {
        heartbeatEncodes += 1;
        if (heartbeatEncodes === 1) {
          bridge.encoded.push({ messageName, payload, options });
          return new Promise((resolve) => {
            releaseFirstProbe = () => resolve(Uint8Array.of(0xfe, 0x01));
          });
        }
      }
      return normalEncode(messageName, payload, options);
    };
    const intervals = [];
    const connection = new FakeConnection();
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 0,
      setIntervalFn(callback, delay) {
        const handle = { callback, delay, unref() {} };
        intervals.push(handle);
        return handle;
      },
      clearIntervalFn() {},
    });
    sessions.add(session);

    session.attach(connection);
    const discoveryInterval = intervals.at(-1);
    assert.equal(typeof releaseFirstProbe, "function");
    discoveryInterval.callback();
    assert.equal(heartbeatEncodes, 1);
    assert.equal(connection.sent.length, 0);

    releaseFirstProbe();
    await new Promise((resolve) => setImmediate(resolve));
    discoveryInterval.callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(heartbeatEncodes, 2);
    assert.equal(connection.sent.length, 2);
    assert.deepEqual(
      bridge.encoded
        .filter(({ messageName }) => messageName === "Heartbeat")
        .map(({ options }) => options.version),
      [1, 1],
    );
  });

  test("detach before the settle deadline prevents a late discovery timer", () => {
    const bridge = new FakeBridge();
    const connection = new FakeConnection();
    const timeouts = [];
    const intervals = [];
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 1000,
      setTimeoutFn(callback, delay) {
        const handle = { callback, delay, cleared: false, unref() {} };
        timeouts.push(handle);
        return handle;
      },
      clearTimeoutFn(handle) {
        handle.cleared = true;
      },
      setIntervalFn(callback, delay) {
        const handle = { callback, delay, cleared: false, unref() {} };
        intervals.push(handle);
        return handle;
      },
      clearIntervalFn(handle) {
        handle.cleared = true;
      },
    });
    sessions.add(session);

    session.attach(connection);
    const settle = timeouts.find(({ delay }) => delay === 1000);
    assert.ok(settle);
    session.detach();
    assert.equal(settle.cleared, true);

    // Model a callback which was already queued when clearTimeout ran.
    settle.callback();
    assert.equal(bridge.encoded.length, 0);
    assert.equal(connection.sent.length, 0);
    assert.equal(session.gcsHeartbeat, null);
    assert.equal(intervals.length, 1); // The session watchdog only.
  });

  test("destroy while discovery encoding is pending cannot write or emit completion", async () => {
    const bridge = new FakeBridge();
    let releaseProbe;
    bridge.mavlinkEncode = () =>
      new Promise((resolve) => {
        releaseProbe = () => resolve(Uint8Array.of(0xfe, 0x01));
      });
    const connection = new FakeConnection();
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 0,
    });
    const diagnostics = [];
    session.on("transportDiagnostic", (entry) => diagnostics.push(entry));
    session.attach(connection);
    assert.equal(typeof releaseProbe, "function");

    session.destroy();
    releaseProbe();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(connection.sent.length, 0);
    assert.deepEqual(diagnostics, []);
  });

  test("starts and stops the GCS discovery heartbeat with the transport", async () => {
    const { session, bridge, connection } = createAttachedSession();

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      bridge.encoded.some(
        ({ messageName, payload }) =>
          messageName === "Heartbeat" &&
          payload.type === 6 &&
          payload.autopilot === 8,
      ),
      true,
    );
    assert.equal(connection.sent.length > 0, true);
    assert.ok(session.gcsHeartbeat != null);
    assert.equal(session.state.connected, false);

    session.detach();
    assert.equal(session.gcsHeartbeat, null);
    assert.equal(connection.listeners.size, 0);
  });

  test("isolates a failing state subscriber without wedging transport startup", async () => {
    const listenerErrors = [];
    const bridge = new FakeBridge();
    const connection = new FakeConnection();
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 0,
      listenerErrorHandler(error, eventName) {
        listenerErrors.push({ error, eventName });
      },
    });
    sessions.add(session);
    session.on("state", () => {
      throw new Error("broken renderer subscriber");
    });

    assert.doesNotThrow(() => session.attach(connection));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(session.connection, connection);
    assert.equal(connection.listeners.size, 1);
    assert.ok(session.gcsHeartbeat != null);
    assert.equal(connection.sent.length > 0, true);
    assert.equal(listenerErrors.length, 1);
    assert.equal(listenerErrors[0].eventName, "state");
    assert.match(listenerErrors[0].error.message, /broken renderer subscriber/);
  });

  test("settles with MAVLink v1, decodes chunked INAV, then uses the observed v2 protocol", async () => {
    const timeoutHandles = [];
    const intervalHandles = [];
    let bridgeListener = null;
    const codec = new MavlinkIpcCodec({
      onMessage(envelope) {
        bridgeListener?.(envelope);
      },
    });
    const bridge = {
      encoded: [],
      onMavlinkMessage(listener) {
        bridgeListener = listener;
        return listener;
      },
      offMavlinkMessage(listener) {
        if (bridgeListener === listener) bridgeListener = null;
      },
      mavlinkReset(generation) {
        codec.reset(generation);
      },
      mavlinkFeed(bytes, generation) {
        codec.feed(bytes, generation);
      },
      async mavlinkEncode(messageName, payload, options) {
        this.encoded.push({ messageName, payload, options });
        return codec.encode(messageName, payload, options);
      },
    };
    const connection = new FakeConnection();
    const session = new MavlinkSession({
      bridge,
      discoveryDelayMs: 1000,
      setTimeoutFn(callback, delay) {
        const handle = { callback, delay, cleared: false, unref() {} };
        timeoutHandles.push(handle);
        return handle;
      },
      clearTimeoutFn(handle) {
        handle.cleared = true;
      },
      setIntervalFn(callback, delay) {
        const handle = { callback, delay, cleared: false, unref() {} };
        intervalHandles.push(handle);
        return handle;
      },
      clearIntervalFn(handle) {
        handle.cleared = true;
      },
    });
    sessions.add(session);

    session.attach(connection);
    assert.equal(connection.sent.length, 0);
    const settle = timeoutHandles.find(({ delay }) => delay === 1000);
    assert.ok(settle);
    settle.callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      connection.sent[0],
      Array.from(Buffer.from("fe0900ffbe000000000006080004034921", "hex")),
    );

    const discoveryInterval = intervalHandles.at(-1);
    assert.equal(discoveryInterval.delay, 1000);
    discoveryInterval.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.sent[1][0], 0xfe);

    const vehicleCodec = new MavlinkIpcCodec();
    const vehicleHeartbeat = vehicleCodec.encode(
      "Heartbeat",
      {
        type: 2,
        autopilot: 0,
        baseMode: 0,
        customMode: 0,
        systemStatus: 4,
        mavlinkVersion: 3,
      },
      { version: 2, systemId: 1, componentId: 1 },
    );
    connection.receive(vehicleHeartbeat.subarray(0, 3));
    connection.receive(vehicleHeartbeat.subarray(3, 11));
    connection.receive(vehicleHeartbeat.subarray(11));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(session.state.connected, true);
    assert.equal(session.state.protocolVersion, 2);
    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_INAV);
    assert.equal(session.state.systemId, 1);
    const heartbeatsBeforeProtocolLock = bridge.encoded.filter(
      ({ messageName }) => messageName === "Heartbeat",
    ).length;
    discoveryInterval.callback();
    await new Promise((resolve) => setImmediate(resolve));
    const heartbeats = bridge.encoded.filter(
      ({ messageName }) => messageName === "Heartbeat",
    );
    assert.equal(heartbeats.length, heartbeatsBeforeProtocolLock + 1);
    assert.equal(heartbeats.at(-1).options.version, 2);
    session.destroy();
    sessions.delete(session);
    codec.destroy();
    vehicleCodec.destroy();
  });

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

  test("detaching rejects state, ACK, firmware, mission, and mode waits", async () => {
    const { session } = createAttachedSession();
    session.handleMessage(heartbeat({ customMode: 0 }));
    session.state.missionTotal = 3;
    session.state.missionId = 91;
    session.state.timeBootMs = 5000;

    const missionContext = {
      sequence: 1,
      expectedMissionTotal: 3,
      expectedMissionId: 91,
      expectedTimeBootMs: 5000,
      expectedBootGeneration: 0,
      checkpoint: {
        sequence: 1,
        missionTotal: 3,
        missionId: 91,
        timeBootMs: 5000,
        bootGeneration: 0,
      },
    };
    const missionWaiter = session.createMissionCurrentWaiter(missionContext, {
      timeoutMs: 1000,
    });
    const operations = [
      [
        "state",
        session.waitForState((state) => state.armed, 1000, "armed state"),
      ],
      ["ACK", session.waitForCommandAck(300, { timeoutMs: 1000 })],
      ["firmware", session.waitForFirmwareFamily({ timeoutMs: 1000 })],
      ["mission message", session.waitFor("MissionCount", () => true, 1000)],
      ["mission current", missionWaiter.promise],
      ["mode", session.setMode("GUIDED", { timeoutMs: 1000 })],
    ];
    const results = operations.map(([name, operation]) =>
      operation.then(
        () => ({ name, resolved: true }),
        (error) => ({ name, error }),
      ),
    );

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    session.attach(new FakeConnection());

    for (const result of await Promise.all(results)) {
      assert.equal(result.resolved, undefined);
      assert.equal(result.error?.code, "MAVLINK_SESSION_DETACHED", result.name);
    }
    assert.equal(session.listeners.get("message")?.size ?? 0, 0);
    assert.equal(session.listeners.get("detached")?.size ?? 0, 0);

    session.handleMessage(heartbeat({ customMode: 4 }));
    assert.equal(session.state.modeName, "GUIDED");
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
