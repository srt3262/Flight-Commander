import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const backend = readFileSync(resolve(root, "js/serial_backend.js"), "utf8");

test("waiting serial MAVLink links use a bounded COM refresh loop", () => {
  assert.match(backend, /MAVLINK_WAITING_REFRESH_DELAY_MS = 12000/);
  assert.match(backend, /MAVLINK_WAITING_REOPEN_SETTLE_MS = 750/);
  assert.match(
    backend,
    /privateScope\.onMavlinkTransportOpen[\s\S]*privateScope\.scheduleMavlinkWaitingRefresh\(\)/,
  );
  assert.match(
    backend,
    /privateScope\.onMavlinkConnected[\s\S]*privateScope\.cancelMavlinkWaitingRefresh\(\)/,
  );
});

test("radio recovery cycles only the vehicle serial transport", () => {
  const start = backend.indexOf(
    "privateScope.refreshMavlinkWaitingTransport = function () {",
  );
  const end = backend.indexOf("    publicScope.init = function() {", start);
  assert.ok(start >= 0 && end > start);
  const block = backend.slice(start, end);
  assert.match(block, /connection\.disconnect/);
  assert.match(block, /connection\.connect/);
  assert.match(block, /mavlinkSession\.detach/);
  assert.doesNotMatch(block, /privateScope\.reConnect/);
  assert.doesNotMatch(block, /tab_switch_cleanup/);
  assert.doesNotMatch(block, /rtkBaseStation/);
});

test("RTK base cleanup does not disconnect the independent USB base", () => {
  const rtk = readFileSync(resolve(root, "tabs/rtk_base.js"), "utf8");
  const cleanupStart = rtk.indexOf("rtkBaseTab.cleanup = function cleanup");
  const cleanupEnd = rtk.indexOf("export default rtkBaseTab", cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.doesNotMatch(
    rtk.slice(cleanupStart, cleanupEnd),
    /rtkBaseStation\.disconnect/,
  );

  const html = readFileSync(resolve(root, "tabs/rtk_base.html"), "utf8");
  assert.match(html, /survey while the aircraft is off/i);
  assert.match(html, /does not close or reset this independent base session/i);
});
