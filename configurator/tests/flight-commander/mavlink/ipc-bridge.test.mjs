import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MavlinkIpcCodec,
  registerMavlinkIpc,
} from "../../../js/main/mavlink.js";
import { MavlinkSession } from "../../../js/mavlink/mavlinkSession.js";

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeIpcMain {
  constructor() {
    this.listeners = new Map();
    this.handlers = new Map();
    this.removedListeners = [];
    this.removedHandlers = [];
  }

  on(channel, listener) {
    this.listeners.set(channel, listener);
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeListener(channel, listener) {
    this.removedListeners.push({ channel, listener });
    if (this.listeners.get(channel) === listener)
      this.listeners.delete(channel);
  }

  removeHandler(channel) {
    this.removedHandlers.push(channel);
    this.handlers.delete(channel);
  }
}

test("GCS discovery heartbeat matches known MAVLink wire vectors", () => {
  const payload = {
    type: 6,
    autopilot: 8,
    baseMode: 0,
    customMode: 0,
    systemStatus: 4,
    mavlinkVersion: 3,
  };
  const expectedByVersion = new Map([
    [1, "fe0900ffbe000000000006080004034921"],
    [2, "fd09000000ffbe0000000000000006080004033d48"],
  ]);

  for (const [version, expected] of expectedByVersion) {
    const codec = new MavlinkIpcCodec();
    const encoded = codec.encode("Heartbeat", payload, {
      version,
      systemId: 255,
      componentId: 190,
    });
    assert.equal(Buffer.from(encoded).toString("hex"), expected);
    codec.destroy();
  }
});

test("MAVLink IPC codec round-trips packets and rejects unsafe encode requests", async () => {
  const messages = [];
  const errors = [];
  const codec = new MavlinkIpcCodec({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error),
  });

  const encoded = codec.encode(
    "CommandLong",
    {
      targetSystem: 42,
      targetComponent: 1,
      command: 246,
      confirmation: 0,
      param1: 3,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    },
    {
      version: 2,
      systemId: 255,
      componentId: 190,
    },
  );
  assert(encoded instanceof Uint8Array);
  assert.equal(encoded[0], 0xfd);

  codec.feed(encoded);
  await nextTurn();
  assert.equal(errors.length, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].protocol, "MAV_V2");
  assert.equal(messages[0].generation, 0);
  assert.equal(messages[0].messageName, "COMMAND_LONG");
  assert.equal(messages[0].header.sysid, 255);
  assert.equal(messages[0].data.command, 246);
  assert.equal(messages[0].data._param1, 3);

  assert.throws(
    () => codec.encode("UnsupportedMessage", {}),
    /Unsupported MAVLink message/,
  );
  assert.throws(
    () => codec.encode("Heartbeat", { nonexistentField: 1 }),
    /does not define field/,
  );
  assert.throws(
    () => codec.encode("Heartbeat", {}, { version: 3 }),
    /version must be 1 or 2/,
  );
  assert.throws(() => codec.feed({ unsafe: true }), /feed data must be/);
  codec.destroy();
});

test("MAVLink IPC codec drops stale feeds and tags decoded packets with the active generation", async () => {
  const messages = [];
  const codec = new MavlinkIpcCodec({
    onMessage: (message) => messages.push(message),
  });
  const encoded = codec.encode(
    "Heartbeat",
    {
      type: 6,
      autopilot: 8,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3,
    },
    { version: 2, systemId: 255, componentId: 190 },
  );

  codec.reset(41);
  assert.equal(codec.feed(encoded, 40), false);
  await nextTurn();
  assert.deepEqual(messages, []);

  assert.equal(codec.feed(encoded, 41), true);
  await nextTurn();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].generation, 41);

  assert.throws(
    () => codec.reset(-1),
    /generation must be a non-negative safe integer/,
  );
  codec.destroy();
});

test("MAVLink IPC registration delivers packets and removes every handler on dispose", async () => {
  const ipc = new FakeIpcMain();
  const delivered = [];
  const bridge = registerMavlinkIpc(ipc, () => ({
    isDestroyed: () => false,
    webContents: {
      send: (channel, envelope) => delivered.push({ channel, envelope }),
    },
  }));

  const encoded = await ipc.handlers.get("mavlinkEncode")(
    {},
    "Heartbeat",
    {
      type: 6,
      autopilot: 8,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3,
    },
    { version: 1, systemId: 255, componentId: 190 },
  );
  ipc.listeners.get("mavlinkReset")({}, 73);
  ipc.listeners.get("mavlinkFeed")({}, encoded, 72);
  await nextTurn();
  assert.equal(delivered.length, 0);

  ipc.listeners.get("mavlinkFeed")({}, encoded, 73);
  await nextTurn();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channel, "mavlinkMessage");
  assert.equal(delivered[0].envelope.protocol, "MAV_V1");
  assert.equal(delivered[0].envelope.generation, 73);

  bridge.dispose();
  assert.deepEqual(ipc.removedListeners.map(({ channel }) => channel).sort(), [
    "mavlinkFeed",
    "mavlinkReset",
  ]);
  assert.deepEqual(ipc.removedHandlers, ["mavlinkEncode"]);
  assert.equal(ipc.listeners.size, 0);
  assert.equal(ipc.handlers.size, 0);
});

test("MavlinkSession unregisters the exact raw preload listener token", () => {
  const token = () => {};
  let removed = null;
  const bridge = {
    onMavlinkMessage() {
      return token;
    },
    offMavlinkMessage(value) {
      removed = value;
    },
    mavlinkReset() {},
  };
  const interval = { unref() {} };
  const session = new MavlinkSession({
    bridge,
    setIntervalFn: () => interval,
    clearIntervalFn() {},
  });

  session.init();
  assert.equal(session.ipcHandler, token);
  session.destroy();
  assert.equal(removed, token);
  assert.equal(session.ipcHandler, null);
});
