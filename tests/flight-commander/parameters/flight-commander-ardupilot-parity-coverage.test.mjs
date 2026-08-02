import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARDUPILOT_FLIGHT_COMMANDER_PARITY,
  coveredIntentKeys,
  parityContractSummary,
} from "../../../js/ardupilot/flightCommanderParity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function templateSettings(template) {
  const html = fs.readFileSync(path.join(root, "tabs", `${template}.html`), "utf8");
  return [...new Set([
    ...[...html.matchAll(/data-setting=["']([^"']+)/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-setting-placeholder=["']([^"']+)/g)].map((match) => match[1]),
  ])].sort();
}

test("every static Flight Commander INAV setting has an ArduPilot translation contract", () => {
  for (const [pageKey, page] of Object.entries(ARDUPILOT_FLIGHT_COMMANDER_PARITY)) {
    const template = page.template;
    const covered = new Set(coveredIntentKeys(pageKey));
    const missing = templateSettings(template).filter((setting) => !covered.has(setting));
    assert.deepEqual(missing, [], `${template} settings without parity contracts`);
  }
});

test("all parity groups declare direct, composite, equivalent, or workflow behavior", () => {
  const valid = new Set(["direct", "composite", "equivalent", "workflow"]);
  for (const [pageKey, page] of Object.entries(ARDUPILOT_FLIGHT_COMMANDER_PARITY)) {
    assert.ok(page.template, `${pageKey} must name its Flight Commander template`);
    assert.ok(page.groups.length, `${pageKey} must declare at least one contract group`);
    for (const group of page.groups) {
      assert.ok(valid.has(group.translation), `${pageKey}/${group.key} translation type`);
      assert.ok(group.title.trim(), `${pageKey}/${group.key} title`);
      assert.ok(group.description.trim(), `${pageKey}/${group.key} equivalent explanation`);
      for (const control of group.controls) {
        assert.ok(control.label.trim(), `${pageKey}/${group.key}/${control.key} label`);
        assert.ok(control.description.trim(), `${pageKey}/${group.key}/${control.key} description`);
        assert.ok(control.candidates.length, `${pageKey}/${group.key}/${control.key} candidates`);
      }
    }
  }
});

test("parity catalog accounts for the complete tab family instead of a short allowlist", () => {
  const summary = parityContractSummary();
  assert.deepEqual(Object.keys(summary).sort(), [
    "adjustments",
    "advanced_tuning",
    "calibration",
    "cli",
    "configuration",
    "failsafe",
    "gps_navigation",
    "javascript_programming",
    "led_strip",
    "logging",
    "magnetometer",
    "mixer",
    "modes",
    "osd",
    "outputs",
    "pid_tuning",
    "ports",
    "programming",
    "receiver",
    "search",
    "sensors",
    "setup",
    "tethered_logging",
  ]);
  const totalIntents = Object.values(summary).reduce((total, page) => total + page.intents, 0);
  assert.ok(totalIntents >= 300, `expected complete intent coverage, got ${totalIntents}`);
});

test("runtime adapter has no unsupported/unmapped fallback path", () => {
  const source = fs.readFileSync(path.join(root, "tabs", "ardupilot_inav_ui.js"), "utf8");
  assert.doesNotMatch(source, /No safe equivalent/i);
  assert.doesNotMatch(source, /Use All Parameters when/i);
  assert.doesNotMatch(source, /Controller-managed on this firmware/);
  assert.match(source, /renderParityContractGroups/);
  assert.match(source, /describeReplacedInavControls/);
  assert.match(source, /fc-ap-inav-equivalent-note/);
  assert.match(source, /appendIntentCoverage/);
  assert.match(source, /data-fc-parity-intent/);
});

test("canonical Flight Commander rows remain visible when ArduPilot uses an equivalent", () => {
  const source = fs.readFileSync(path.join(root, "tabs", "ardupilot_inav_ui.js"), "utf8");
  assert.doesNotMatch(source, /function hideReplacedInavControls/);
  assert.match(source, /input\.attr\(\{ 'aria-hidden': 'true', tabindex: '-1' \}\)\.hide\(\)/);
  assert.match(source, /setting\.append\(explanation\)/);
  for (const renderer of ["renderConfiguration", "renderFailsafe", "renderOutputRows", "renderGps"]) {
    const body = source.match(new RegExp(`function ${renderer}\\(tab\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.match(body, /data-fc-parity-canonical-layout/);
    assert.doesNotMatch(body, /\.hide\(\)/);
  }
});

test("ArduPilot navigation mirrors every Flight Commander INAV tab", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const connected = html.match(/<ul class="mode-connected">([\s\S]*?)<ul class="mode-mavlink"/)?.[1] ?? "";
  const mavlink = html.match(/<ul class="mode-mavlink"[^>]*>([\s\S]*?)<ul class="mode-telemetry"/)?.[1] ?? "";
  const classes = (source) => [...source.matchAll(/<li class="tab_([^"\s]+)/g)].map((match) => match[1]);
  const inavTabs = classes(connected).filter((tab) => tab !== "flight_data");
  const ardupilotTabs = new Set(classes(mavlink));
  const route = Object.freeze({
    setup: "ardupilot_setup",
    calibration: "ardupilot_calibration",
    magnetometer: "ardupilot_magnetometer",
    configuration: "ardupilot_configuration",
    ports: "ardupilot_ports",
    mixer: "ardupilot_mixer",
    outputs: "ardupilot_outputs",
    receiver: "ardupilot_receiver",
    auxiliary: "ardupilot_modes",
    failsafe: "ardupilot_failsafe",
    pid_tuning: "ardupilot_pid_tuning",
    advanced_tuning: "ardupilot_advanced_tuning",
    adjustments: "ardupilot_adjustments",
    gps: "ardupilot_gps_navigation",
    flight_planner: "flight_planner",
    sensors: "ardupilot_sensors",
    osd: "ardupilot_osd",
    led_strip: "ardupilot_led_strip",
    onboard_logging: "ardupilot_logging",
    logging: "ardupilot_tethered_logging",
    programming: "ardupilot_programming",
    javascript_programming: "ardupilot_javascript_programming",
    cli: "ardupilot_cli",
    search: "ardupilot_search",
  });
  assert.deepEqual(Object.keys(route), inavTabs);
  for (const [inavTab, ardupilotTab] of Object.entries(route)) {
    assert.ok(ardupilotTabs.has(ardupilotTab), `${inavTab} must route to ${ardupilotTab}`);
  }
  assert.ok(ardupilotTabs.has("mavlink_parameters"), "native All Parameters fallback must remain available");
});

test("Programming, CLI and Search are working translations rather than inert templates", () => {
  const source = fs.readFileSync(path.join(root, "tabs", "ardupilot_inav_ui.js"), "utf8");
  assert.match(source, /mavlinkFtpClient\.upload/);
  assert.match(source, /mavlinkFtpClient\.download/);
  assert.match(source, /executeConsoleCommand/);
  assert.match(source, /translatedSearchIndex/);
  assert.match(source, /ARDUPILOT_SCRIPT_PATH/);
});
