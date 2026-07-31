import assert from "node:assert/strict";
import test from "node:test";

import {
  initializeExplicitMavlinkTransport,
  queueGroundControlActivation,
  runCriticalMavlinkTransition,
} from "../../../js/gcs/mavlinkTransportStartup.js";

test("explicit MAVLink renders waiting state and installs recovery before attach", () => {
  const order = [];
  const result = initializeExplicitMavlinkTransport({
    showWaitingState() {
      order.push("waiting");
    },
    scheduleNoHeartbeatTimeout() {
      order.push("timeout");
    },
    attachSession() {
      order.push("attach");
    },
    onFailure() {
      order.push("failure");
    },
  });

  assert.deepEqual(order, ["waiting", "timeout", "attach"]);
  assert.equal(result.ok, true);
});

test("an attach exception is contained after the waiting UI and timeout exist", () => {
  const order = [];
  const failure = new Error("subscriber failed");
  const result = initializeExplicitMavlinkTransport({
    showWaitingState() {
      order.push("waiting");
    },
    scheduleNoHeartbeatTimeout() {
      order.push("timeout");
    },
    attachSession() {
      order.push("attach");
      throw failure;
    },
    onFailure(error) {
      order.push(`failure:${error.message}`);
    },
  });

  assert.deepEqual(order, [
    "waiting",
    "timeout",
    "attach",
    "failure:subscriber failed",
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
});

test("Ground Control activation waits for a concurrent tab switch and runs once", () => {
  const scheduled = [];
  let busy = true;
  let open = false;
  let activations = 0;
  const cancel = queueGroundControlActivation({
    isCurrent: () => true,
    isBusy: () => busy,
    isOpen: () => open,
    activate() {
      activations += 1;
      open = true;
    },
    schedule(callback, delay) {
      const handle = { callback, delay, canceled: false };
      scheduled.push(handle);
      return handle;
    },
    cancelSchedule(handle) {
      handle.canceled = true;
    },
  });

  assert.equal(activations, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 100);
  busy = false;
  scheduled.shift().callback();
  assert.equal(activations, 1);
  assert.equal(scheduled.length, 0);
  cancel();
});

test("a critical connected transition invokes explicit recovery on failure", () => {
  const events = [];
  const failure = new Error("Ground Control renderer failed");
  const result = runCriticalMavlinkTransition({
    transition() {
      events.push("transition");
      throw failure;
    },
    onFailure(error) {
      events.push(`recover:${error.message}`);
    },
  });

  assert.deepEqual(events, [
    "transition",
    "recover:Ground Control renderer failed",
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
});

test("Ground Control activation stops after a bounded number of refused attempts", () => {
  const scheduled = [];
  let exhausted = 0;
  queueGroundControlActivation({
    isCurrent: () => true,
    isBusy: () => false,
    isOpen: () => false,
    activate() {},
    maxAttempts: 2,
    schedule(callback) {
      scheduled.push(callback);
      return callback;
    },
    cancelSchedule() {},
    onExhausted() {
      exhausted += 1;
    },
  });

  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.equal(exhausted, 1);
  assert.equal(scheduled.length, 0);
});
