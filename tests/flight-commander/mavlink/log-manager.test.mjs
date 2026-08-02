import assert from "node:assert/strict";
import test from "node:test";

import { MavlinkLogManager } from "../../../js/mavlink/logManager.js";

class EventSession {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
    this.responses = [];
  }

  target() {
    return { targetSystem: 1, targetComponent: 1 };
  }

  on(name, listener) {
    this.listeners.set(name, listener);
    return () => this.listeners.delete(name);
  }

  emit(name, envelope) {
    this.listeners.get(name)?.(envelope);
  }

  waitFor(_names, predicate) {
    return new Promise((resolve) => {
      this.waiter = { predicate, resolve };
    });
  }

  async send(name, payload) {
    this.sent.push({ name, payload });
    if (name === "LogRequestList") {
      queueMicrotask(() => {
        for (const entry of this.responses) {
          this.emit("message:LogEntry", { data: entry });
        }
      });
    }
    if (name === "LogRequestData") {
      const data = this.log.slice(payload.ofs, payload.ofs + payload.count);
      const envelope = { data: { id: payload.id, ofs: payload.ofs, count: data.length, data } };
      queueMicrotask(() => {
        assert.ok(this.waiter.predicate(envelope));
        this.waiter.resolve(envelope);
      });
    }
  }
}

test("lists DataFlash logs in ID order and treats the zero-log sentinel as empty", async () => {
  const session = new EventSession();
  const manager = new MavlinkLogManager({ session });
  session.responses = [
    { id: 3, numLogs: 2, lastLogNum: 3, timeUtc: 20, size: 200 },
    { id: 2, numLogs: 2, lastLogNum: 3, timeUtc: 10, size: 100 },
  ];
  const logs = await manager.list();
  assert.deepEqual(logs.map((entry) => entry.id), [2, 3]);

  session.responses = [{ id: 0, numLogs: 0, lastLogNum: 0, timeUtc: 0, size: 0 }];
  assert.deepEqual(await manager.list(), []);
});

test("downloads all log bytes and always closes the transfer", async () => {
  const session = new EventSession();
  session.log = Uint8Array.from({ length: 205 }, (_value, index) => index & 0xff);
  const manager = new MavlinkLogManager({ session });
  const progress = [];
  const data = await manager.download({ id: 4, size: session.log.length }, {
    onProgress: (entry) => progress.push(entry.received),
  });
  assert.deepEqual(data, session.log);
  assert.deepEqual(
    session.sent.filter((entry) => entry.name === "LogRequestData").map((entry) => entry.payload.ofs),
    [0, 90, 180],
  );
  assert.equal(session.sent.at(-1).name, "LogRequestEnd");
  assert.equal(progress.at(-1), session.log.length);
});
