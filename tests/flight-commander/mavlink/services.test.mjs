import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
  MavlinkMissionManager,
  withAbortSignal,
} from "../../../js/mavlink/services.js";

function referencedSetTimeout(callback, delay) {
  return { timer: setTimeout(callback, delay) };
}

function clearReferencedTimeout(handle) {
  clearTimeout(handle?.timer ?? handle);
}

const referencedTimerOptions = {
  setTimeoutFn: referencedSetTimeout,
  clearTimeoutFn: clearReferencedTimeout,
};

class FakeSession {
  constructor(onSend = () => {}) {
    this.state = {
      systemId: 7,
      componentId: 1,
      firmwareFamily: "inav",
    };
    this.listeners = new Map();
    this.sent = [];
    this.onSend = onSend;
  }

  target() {
    return { targetSystem: 7, targetComponent: 1 };
  }

  on(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
    return () => {
      this.listeners.get(name)?.delete(listener);
      if (this.listeners.get(name)?.size === 0) this.listeners.delete(name);
    };
  }

  emit(name, envelope) {
    for (const listener of [...(this.listeners.get(name) ?? [])])
      listener(envelope);
  }

  message(messageName, data, { sysid = 7, compid = 1 } = {}) {
    this.emit("message", {
      messageName,
      data,
      header: { sysid, compid },
    });
  }

  async send(messageName, payload) {
    this.sent.push({ messageName, payload });
    queueMicrotask(() => this.onSend(messageName, payload, this));
    return 1;
  }

  waitFor(names, predicate, timeoutMs) {
    const wanted = new Set(Array.isArray(names) ? names : [names]);
    return new Promise((resolve, reject) => {
      const unsubscribe = this.on("message", (envelope) => {
        if (!wanted.has(envelope.messageName) || !predicate(envelope)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(envelope);
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("waitFor timeout"));
      }, timeoutMs);
    });
  }

  listenerCount(name) {
    if (name) return this.listeners.get(name)?.size ?? 0;
    return [...this.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}

describe("MavlinkMissionManager", () => {
  test("downloads INAV legacy mission items in sequence and cleans waiters", async () => {
    const session = new FakeSession((messageName, payload, source) => {
      if (messageName === "MissionRequestList") {
        source.message("MissionCount", { count: 2, missionType: 0 });
      } else if (messageName === "MissionRequest") {
        source.message("MissionItem", {
          seq: payload.seq,
          frame: 3,
          command: payload.seq === 0 ? 16 : MAV_CMD_NAV_RETURN_TO_LAUNCH,
          current: payload.seq === 0 ? 1 : 0,
          autocontinue: 1,
          param1: 0,
          param2: 0,
          param3: 0,
          param4: Number.NaN,
          x: payload.seq === 0 ? 35.1234567 : 0,
          y: payload.seq === 0 ? -78.9123456 : 0,
          z: payload.seq === 0 ? 60 : 0,
          missionType: 0,
        });
      }
    });
    const manager = new MavlinkMissionManager(session, referencedTimerOptions);
    const progress = [];

    const items = await manager.download({
      timeoutMs: 100,
      retries: 0,
      onProgress: (event) => progress.push(event.completed),
    });

    assert.equal(items.length, 2);
    assert.equal(items[0].latitude, 35.1234567);
    assert.equal(items[0].longitude, -78.9123456);
    assert.equal(items[1].command, MAV_CMD_NAV_RETURN_TO_LAUNCH);
    assert.deepEqual(progress, [1, 2]);
    assert.equal(session.sent.at(-1).messageName, "MissionAck");
    assert.equal(
      session.sent.some(({ messageName }) => messageName.endsWith("Int")),
      false,
    );
    assert.equal(session.listenerCount(), 0);
  });

  test("uploads INAV legacy items and blocks unsupported command 206", async () => {
    const session = new FakeSession((messageName, payload, source) => {
      if (messageName === "MissionCount") {
        source.message("MissionRequest", { seq: 0, missionType: 0 });
      } else if (messageName === "MissionItem") {
        source.message("MissionAck", { type: 0, missionType: 0 });
      }
    });
    const manager = new MavlinkMissionManager(session, referencedTimerOptions);
    const result = await manager.upload(
      [
        {
          command: 16,
          latitude: 35,
          longitude: -78,
          altitude: 50,
        },
      ],
      {
        timeoutMs: 100,
        initialRetries: 0,
      },
    );

    assert.equal(result.type, 0);
    const item = session.sent.find(
      ({ messageName }) => messageName === "MissionItem",
    );
    assert.equal(item.payload.x, 35);
    assert.equal(item.payload.y, -78);
    assert.equal(session.listenerCount(), 0);

    const inav = new FakeSession();
    inav.state.firmwareFamily = "inav";
    const inavManager = new MavlinkMissionManager(inav, referencedTimerOptions);
    await assert.rejects(
      inavManager.upload([
        {
          command: 206,
          latitude: 35,
          longitude: -78,
          altitude: 50,
        },
      ]),
      /unsupported command 206/,
    );
    assert.equal(inav.sent.length, 0);
  });

  test("clear verifies a zero-item readback and timeout removes listeners", async () => {
    const session = new FakeSession((messageName, payload, source) => {
      if (messageName === "MissionClearAll") {
        source.message("MissionAck", { type: 0, missionType: 0 });
      } else if (messageName === "MissionRequestList") {
        source.message("MissionCount", { count: 0, missionType: 0 });
      }
    });
    const manager = new MavlinkMissionManager(session, referencedTimerOptions);
    const result = await manager.clear({
      timeoutMs: 100,
      retries: 0,
      verifyDelayMs: 0,
    });
    assert.equal(result.cleared, true);
    assert.equal(result.verified, true);
    assert.equal(result.persistent, false);
    assert.equal(result.volatile, true);
    assert.equal(result.storage, "volatile");
    assert.equal(session.listenerCount(), 0);

    const silentSession = new FakeSession();
    const silentManager = new MavlinkMissionManager(
      silentSession,
      referencedTimerOptions,
    );
    await assert.rejects(
      silentManager.download({ timeoutMs: 10, retries: 0 }),
      /Mission list request failed/,
    );
    assert.equal(silentSession.listenerCount(), 0);
  });

  test("detach intrinsically cancels a mission read and reconnect installs one fresh listener", async () => {
    const session = new FakeSession();
    const manager = new MavlinkMissionManager(session, referencedTimerOptions);
    const download = manager.download({
      timeoutMs: 1000,
      retries: 0,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.listenerCount("message"), 1);
    assert.equal(session.listenerCount("detached"), 1);

    session.emit("detached", {});
    await assert.rejects(download, { name: "AbortError" });
    assert.equal(session.listenerCount(), 0);

    session.message("MissionCount", { count: 0, missionType: 0 });
    assert.equal(
      session.sent.some(({ messageName }) => messageName === "MissionAck"),
      false,
    );

    const reconnectedDownload = manager.download({
      timeoutMs: 1000,
      retries: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.listenerCount("message"), 1);
    assert.equal(session.listenerCount("detached"), 1);
    session.message("MissionCount", { count: 0, missionType: 0 });
    assert.deepEqual(await reconnectedDownload, []);
    assert.equal(session.listenerCount(), 0);
  });

  test("detach intrinsically cancels mission upload and clear verification delay", async () => {
    const uploadSession = new FakeSession();
    const uploadManager = new MavlinkMissionManager(
      uploadSession,
      referencedTimerOptions,
    );
    const upload = uploadManager.upload(
      [{ command: 16, latitude: 35, longitude: -78, altitude: 50 }],
      { timeoutMs: 1000, initialRetries: 0 },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(uploadSession.listenerCount("message"), 1);
    assert.equal(uploadSession.listenerCount("detached"), 1);
    uploadSession.emit("detached", {});
    await assert.rejects(upload, { name: "AbortError" });
    assert.equal(uploadSession.listenerCount(), 0);

    const clearSession = new FakeSession((messageName, payload, source) => {
      if (messageName === "MissionClearAll") {
        source.message("MissionAck", { type: 0, missionType: 0 });
      }
    });
    const clearManager = new MavlinkMissionManager(
      clearSession,
      referencedTimerOptions,
    );
    const clear = clearManager.clear({
      timeoutMs: 1000,
      retries: 0,
      verifyDelayMs: 1000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(clearSession.listenerCount("message"), 0);
    assert.equal(clearSession.listenerCount("detached"), 1);
    clearSession.emit("detached", {});
    await assert.rejects(clear, { name: "AbortError" });
    assert.equal(clearSession.listenerCount(), 0);
    assert.equal(
      clearSession.sent.some(
        ({ messageName }) => messageName === "MissionRequestList",
      ),
      false,
    );
  });
});

test("withAbortSignal prevents a detached firmware-identification result from escaping", async () => {
  let resolveIdentification;
  const identification = new Promise((resolve) => {
    resolveIdentification = resolve;
  });
  const controller = new AbortController();
  const guarded = withAbortSignal(identification, controller.signal);

  controller.abort();
  resolveIdentification({ firmwareFamily: "inav" });

  await assert.rejects(guarded, { name: "AbortError" });
});

test("mission defaults retain the Chromium timer receiver", async () => {
  const originalTimers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const calls = [];
  const checkedTimer = (name) =>
    function (...args) {
      assert.equal(
        this,
        globalThis,
        `${name} must retain the host receiver`,
      );
      calls.push(name);
      return name.startsWith("set")
        ? { name, args, unref() {} }
        : undefined;
    };

  try {
    globalThis.setTimeout = checkedTimer("setTimeout");
    globalThis.clearTimeout = checkedTimer("clearTimeout");

    const missionSession = new FakeSession();
    const missionManager = new MavlinkMissionManager(missionSession);
    const waiter = missionManager.createResponseWaiter(
      "Never",
      () => true,
      100,
    );
    const cancellation = new Error("receiver test complete");
    const canceledPromise = waiter.promise.catch((error) => error);
    waiter.cancel(cancellation);
    assert.equal(await canceledPromise, cancellation);
    assert.ok(calls.includes("setTimeout"));
    assert.ok(calls.includes("clearTimeout"));
  } finally {
    Object.assign(globalThis, originalTimers);
  }
});
