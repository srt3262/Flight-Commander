import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const text = (path) => readFileSync(resolve(root, path), "utf8");

test("Flight Commander 4.1.2 exposes no stock-INAV product mode", () => {
  const packageJson = JSON.parse(text("package.json"));
  const flasherHtml = text("tabs/firmware_flasher.html");
  const flasherSource = text("tabs/firmware_flasher.js");
  const serial = text("js/serial_backend.js");
  const session = text("js/mavlink/mavlinkSession.js");
  const ground = text("tabs/flight_data.js");
  const planner = text("tabs/flight_planner.js");
  const landing = text("tabs/landing.html");
  const alignmentTargets = text("js/flightCommander/alignmentTargets.js");
  const plannerHtml = text("tabs/flight_planner.html");
  const docs = [
    text("README.md"),
    text("docs/CONNECTIONS.md"),
    text("docs/FIRMWARE_FLASHING.md"),
    text("docs/GROUND_CONTROL.md"),
  ].join("\n");

  assert.equal(packageJson.version, "4.1.2");
  assert.match(flasherHtml, /Flight Commander Firmware only/);
  assert.doesNotMatch(flasherHtml, /value="inav"|Official INAV/);
  assert.doesNotMatch(flasherSource, /repos\/iNavFlight\/inav(?:-nightly)?\/releases/);
  assert.match(flasherSource, /parsedHexContainsFlightCommanderIdentity/);
  assert.match(serial, /identity\.family !== FIRMWARE_FAMILY_FLIGHT_COMMANDER/);
  assert.doesNotMatch(serial, /Official INAV|compatibility mode/);
  assert.doesNotMatch(session, /setFirmwareFamily\(FIRMWARE_FAMILY_INAV, "heartbeat"\)/);
  assert.match(session, /FIRMWARE_FAMILY_UNKNOWN, "probing"/);
  assert.match(ground, /return family === 'flight-commander'/);
  assert.doesNotMatch(ground, /MAVLink · Official INAV|commands disabled for official INAV/i);
  assert.doesNotMatch(planner, /Official INAV|Flight Commander\/INAV-compatible/);
  assert.match(landing, /Flight Commander Firmware the only/);
  assert.match(alignmentTargets, /Active Flight Commander target magnetometer alignment and diagnostics/);
  assert.doesNotMatch(alignmentTargets, /Active INAV target|INAV target compass path/);
  assert.doesNotMatch(plannerHtml, /INAV's persistent|resets INAV's native/);
  assert.doesNotMatch(docs, /Official INAV|official-INAV compatibility|unsupported firmware compatibility|Live compatibility telemetry/);
});
