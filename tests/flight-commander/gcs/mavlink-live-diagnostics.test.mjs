import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flightData = readFileSync(resolve(root, "tabs/flight_data.js"), "utf8");
const session = readFileSync(resolve(root, "js/mavlink/mavlinkSession.js"), "utf8");
const backend = readFileSync(resolve(root, "js/serial_backend.js"), "utf8");

test("Ground Control leaves the global diagnostics log operator-controlled", () => {
  const start = flightData.indexOf("flightData.suspendGlobalLog = function () {");
  const end = flightData.indexOf("flightData.initialize = function (callback) {", start);
  assert.ok(start >= 0 && end > start);
  const block = flightData.slice(start, end);
  assert.doesNotMatch(block, /trigger\('click'\)/);
  assert.doesNotMatch(block, /addEventListener\(/);
  assert.doesNotMatch(block, /stopImmediatePropagation/);
  assert.match(block, /prop\('disabled', false\)/);
  assert.match(block, /removeClass\('fc-ground-control-locked'\)/);
});

test("MAVLink timeout diagnostics distinguish bytes, frames, and heartbeats", () => {
  assert.match(session, /stage: "vehicle-heartbeat-timeout"/);
  assert.match(session, /millisecondsSinceSerialByte/);
  assert.match(session, /millisecondsSinceValidFrame/);
  assert.match(session, /receivedByteCount/);
  assert.match(session, /decodedFrameCount/);
  assert.match(session, /stage: "vehicle-heartbeat-restored"/);
  assert.match(backend, /case 'vehicle-heartbeat-timeout'/);
  assert.match(backend, /inbound serial bytes are still arriving/);
  assert.match(backend, /case 'vehicle-heartbeat-restored'/);
});
