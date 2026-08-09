import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import normalizeInavTelemetry from "../../js/telemetry/inavTelemetry.js";
import {
  PRIMARY_FLIGHT_MODES,
  primaryModeForDisplay,
  primaryModeFromActiveModes,
  primaryModeFromMavlink,
  primaryModeFromName,
} from "../../js/telemetry/primaryFlightMode.js";

test("MSP primary mode vocabulary and priority ignore secondary boxes", () => {
  assert.equal(primaryModeFromActiveModes([]), "ACRO");
  assert.equal(primaryModeFromActiveModes(["AIR MODE", "MC BRAKING"]), "ACRO");
  assert.equal(primaryModeFromActiveModes(["ANGLE"]), "ANGLE");
  assert.equal(
    primaryModeFromActiveModes(["ANGLE", "NAV ALTHOLD"]),
    "ANGLE/ALT HLD",
  );
  assert.equal(
    primaryModeFromActiveModes([
      "ANGLE",
      "NAV ALTHOLD",
      "NAV POSHOLD",
      "MC BRAKING",
    ]),
    "GPS POS HLD",
  );
  assert.equal(primaryModeFromActiveModes(["WP PLANNER"]), "MISSION");
  assert.equal(primaryModeFromActiveModes(["NAV WP", "NAV RTH"]), "RTH");
});

test("MSP mode ranges reveal selected GPS hold before navigation engages", () => {
  const fc = {
    connected: true,
    AUX_CONFIG: ["ANGLE", "NAV ALTHOLD", "NAV POSHOLD", "MC BRAKING"],
    AUX_CONFIG_IDS: [1, 3, 11, 46],
    MODE_RANGES: [
      { id: 11, auxChannelIndex: 0, range: { start: 1700, end: 2100 } },
      { id: 46, auxChannelIndex: 1, range: { start: 1700, end: 2100 } },
    ],
    RC: { channels: [1500, 1500, 1000, 1500, 1800, 1800] },
    isModeEnabled: (name) => name === "MC BRAKING",
    MIXER_CONFIG: { platformType: 0 },
    CONFIG: { apiVersion: "2.6.0" },
  };
  assert.equal(normalizeInavTelemetry(fc).modeName, "GPS POS HLD");
});

test("MAVLink custom modes normalize to the same six labels", () => {
  const expected = new Map([
    [0, "ANGLE"],
    [1, "ACRO"],
    [2, "ANGLE/ALT HLD"],
    [3, "MISSION"],
    [4, "GPS POS HLD"],
    [5, "GPS POS HLD"],
    [6, "RTH"],
    [16, "GPS POS HLD"],
    [17, "ACRO"],
  ]);
  for (const [customMode, label] of expected) {
    assert.equal(primaryModeFromMavlink(2, customMode), label);
  }
  assert.deepEqual(
    new Set(Object.values(PRIMARY_FLIGHT_MODES)),
    new Set(["ACRO", "ANGLE", "ANGLE/ALT HLD", "GPS POS HLD", "RTH", "MISSION"]),
  );
});

test("raw mode aliases and display state never expose secondary labels", () => {
  assert.equal(primaryModeFromName("STABILIZE"), "ANGLE");
  assert.equal(primaryModeFromName("ALT_HOLD"), "ANGLE/ALT HLD");
  assert.equal(primaryModeFromName("GUIDED"), "GPS POS HLD");
  assert.equal(primaryModeFromName("AUTO"), "MISSION");
  assert.equal(primaryModeFromName("MC BRAKING"), "ACRO");
  assert.equal(primaryModeForDisplay({ connected: false }, "mavlink"), null);
  assert.equal(
    primaryModeForDisplay(
      { connected: true, vehicleType: 2, customMode: 0, modeName: "STABILIZE" },
      "mavlink",
    ),
    "ANGLE",
  );
  assert.equal(
    primaryModeForDisplay({ connected: true, modeName: "MC BRAKING" }, "msp"),
    "ACRO",
  );
});

test("firmware and backup sources retain the 4.1.7 display contract", () => {
  const backup = readFileSync(
    new URL("../../js/backup_restore.js", import.meta.url),
    "utf8",
  );
  const mainProcess = readFileSync(
    new URL("../../js/main/main.js", import.meta.url),
    "utf8",
  );
  const flightData = readFileSync(
    new URL("../../tabs/flight_data.js", import.meta.url),
    "utf8",
  );
  const runtime = readFileSync(
    new URL("../../../src/main/fc/runtime_config.c", import.meta.url),
    "utf8",
  );
  const mspBoxes = readFileSync(
    new URL("../../../src/main/fc/fc_msp_box.c", import.meta.url),
    "utf8",
  );

  assert.match(backup, /flight_commander_backup_/);
  assert.match(backup, /Flight Commander Backup\/Restore/);
  assert.doesNotMatch(backup, /`\$\{prefix \|\| ''\}inav_backup_/i);
  assert.doesNotMatch(backup, /# INAV (?:Auto-)?Backup/);
  assert.match(mainProcess, /FLIGHT_COMMANDER_BACKUP_DIRECTORY = 'flight-commander-backups'/);
  assert.match(mainProcess, /copyFileSync/);
  assert.match(flightData, /flightDataModeValue'\)\.text\(indicatedModeName\)/);
  assert.match(flightData, /hud\?\.render\(\{ \.\.\.state, modeName: indicatedModeName \}\)/);
  assert.match(runtime, /flightCommanderPrimaryModeForTelemetry/);
  assert.ok(runtime.indexOf("if (rthRequested)") < runtime.indexOf("if (missionRequested)"));
  assert.ok(
    runtime.indexOf("if (missionRequested)") <
      runtime.indexOf("if (positionHoldRequested)"),
  );
  assert.ok(
    runtime.indexOf("if (positionHoldRequested)") <
      runtime.indexOf("angleRequested && altitudeHoldRequested"),
  );
  assert.match(mspBoxes, /PRIMARY_MODE_ACTIVE_OR_SELECTED\(NAV_POSHOLD_MODE, BOXNAVPOSHOLD\)/);
});
