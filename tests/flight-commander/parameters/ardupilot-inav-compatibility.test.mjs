import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARDUPILOT_INAV_COMPATIBILITY,
  discoverInavCompatibleControls,
  fromInavCompatibleDisplayValue,
  inavCompatibleDisplayMetadata,
  toInavCompatibleDisplayValue,
} from "../../../js/ardupilot/inavCompatibility.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("INAV-style definitions cover every generic ArduPilot feature page", () => {
  assert.deepEqual(Object.keys(ARDUPILOT_INAV_COMPATIBILITY).sort(), [
    "configuration",
    "failsafe",
    "gps_navigation",
    "logging",
    "osd",
    "outputs",
    "power",
    "sensors",
  ]);
  for (const sections of Object.values(ARDUPILOT_INAV_COMPATIBILITY)) {
    assert.ok(sections.length > 0);
    for (const section of sections) {
      assert.ok(section.label);
      assert.ok(section.description);
      assert.ok(section.controls.every((control) => (
        control.label && control.description
      )));
    }
  }
});

test("discovery uses only parameters actually reported by the connected vehicle", () => {
  const result = discoverInavCompatibleControls([
    { id: "Q_FRAME_CLASS", value: 1 },
    { id: "AHRS_ORIENTATION", value: 0 },
    { id: "ANGLE_MAX", value: 4500 },
    { id: "BRD_OPTIONS", value: 0 },
  ], "configuration");

  const controls = result.sections.flatMap((section) => section.controls);
  assert.deepEqual(controls.map((control) => control.nativeId), [
    "Q_FRAME_CLASS",
    "AHRS_ORIENTATION",
    "ANGLE_MAX",
  ]);
  assert.deepEqual(result.unmatchedParameters.map((parameter) => parameter.id), [
    "BRD_OPTIONS",
  ]);
  assert.equal(controls.some((control) => control.nativeId === "FRAME_CLASS"), false);
});

test("dynamic output functions become familiar per-output assignments", () => {
  const result = discoverInavCompatibleControls([
    { id: "SERVO10_FUNCTION", value: 34 },
    { id: "SERVO2_FUNCTION", value: 33 },
    { id: "SERVO2_MIN", value: 1000 },
  ], "outputs");
  const assignments = result.sections
    .find((section) => section.id === "output-assignment")
    .controls;

  assert.deepEqual(assignments.map((item) => item.label), [
    "Output 2 function",
    "Output 10 function",
  ]);
  assert.deepEqual(result.unmatchedParameters.map((parameter) => parameter.id), [
    "SERVO2_MIN",
  ]);
});

test("guided presentations round-trip UI units without changing native storage", () => {
  const configuration = discoverInavCompatibleControls([
    { id: "ANGLE_MAX", value: 4500 },
  ], "configuration");
  const angle = configuration.sections[0].controls[0];
  assert.equal(toInavCompatibleDisplayValue(angle, 4500), 45);
  assert.equal(fromInavCompatibleDisplayValue(angle, 52.5), 5250);
  assert.deepEqual(
    inavCompatibleDisplayMetadata(angle, { units: "cdeg", min: 1000, max: 8000 }),
    { units: "°", min: 10, max: 80, increment: 1 },
  );

  const navigation = discoverInavCompatibleControls([
    { id: "GPS_RATE_MS", value: 200 },
  ], "gps_navigation");
  const rate = navigation.sections[0].controls[0];
  assert.equal(toInavCompatibleDisplayValue(rate, 200), 5);
  assert.equal(fromInavCompatibleDisplayValue(rate, 10), 100);
});

test("feature UI defaults to guided controls and retains explicit native fallbacks", () => {
  const html = source("tabs/ardupilot_feature.html");
  const javascript = source("tabs/ardupilot_feature.js");
  assert.match(html, /INAV-style setup/);
  assert.match(html, /ArduPilot extras/);
  assert.match(html, /data-open-ardupilot-tab="mavlink_parameters"/);
  assert.match(javascript, /discoverInavCompatibleControls/);
  assert.match(javascript, /mappedControl\.nativeId/);
  assert.match(javascript, /fromInavCompatibleDisplayValue/);
});
