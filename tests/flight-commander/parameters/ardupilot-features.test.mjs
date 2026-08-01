import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARDUPILOT_FEATURE_DEFINITIONS,
  ardupilotFeatureDefinition,
  discoverArduPilotFeatureParameters,
} from "../../../js/ardupilot/featureDefinitions.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("feature pages select only parameters reported by the connected firmware", () => {
  const parameters = [
    { id: "SERVO1_FUNCTION", value: 33 },
    { id: "MOT_PWM_TYPE", value: 6 },
    { id: "FS_THR_ENABLE", value: 1 },
    { id: "GPS_TYPE", value: 1 },
    { id: "LOG_BITMASK", value: 0 },
  ];
  const outputs = discoverArduPilotFeatureParameters(
    parameters,
    ardupilotFeatureDefinition("outputs"),
  );
  assert.deepEqual(outputs.map((parameter) => parameter.id), [
    "MOT_PWM_TYPE",
    "SERVO1_FUNCTION",
  ]);
  assert.equal(ardupilotFeatureDefinition("ardupilot_failsafe").id, "failsafe");
  assert.equal(ARDUPILOT_FEATURE_DEFINITIONS.length, 8);
});

test("ArduPilot navigation exposes the complete INAV-style setup tree", () => {
  const index = source("index.html");
  const configurator = source("js/configurator_main.js");
  const allowedTabs = source("js/gui.js");
  const setup = source("tabs/ardupilot_setup.html");
  const expectedTabs = [
    "ardupilot_setup",
    "ardupilot_status",
    "ardupilot_ports",
    "ardupilot_configuration",
    "ardupilot_receiver",
    "ardupilot_modes",
    "ardupilot_outputs",
    "ardupilot_failsafe",
    "ardupilot_pid_tuning",
    "ardupilot_sensors",
    "ardupilot_gps_navigation",
    "ardupilot_power",
    "ardupilot_osd",
    "ardupilot_logging",
  ];
  for (const tab of expectedTabs) {
    assert.match(index, new RegExp(`tab_${tab}`));
    assert.match(configurator, new RegExp(`['\"]${tab}['\"]`));
    assert.match(allowedTabs, new RegExp(`['\"]${tab}['\"]`));
    if (tab !== "ardupilot_setup") {
      assert.match(setup, new RegExp(`data-open-ardupilot-tab=["']${tab}["']`));
    }
  }
});

test("custom ArduPilot pages provide explanations and guarded Save & reboot", () => {
  for (const path of [
    "tabs/ardupilot_setup.html",
    "tabs/ardupilot_ports.html",
    "tabs/ardupilot_receiver.html",
    "tabs/ardupilot_modes.html",
    "tabs/ardupilot_feature.html",
    "tabs/ardupilot_pid_tuning.html",
    "tabs/mavlink_parameters.html",
  ]) {
    const html = source(path);
    assert.match(html, /Save &amp; reboot/);
  }
  assert.match(source("tabs/ardupilot_modes.html"), /Detect moved channel/);
  assert.match(source("tabs/ardupilot_receiver.html"), /Start endpoint capture/);
  assert.match(source("tabs/ardupilot_pid_tuning.html"), /P — response/);
  assert.match(source("tabs/ardupilot_pid_tuning.html"), /Main PID Gains/);
  assert.match(source("tabs/ardupilot_pid_tuning.html"), /Filters &amp; Mechanics/);
  assert.match(source("tabs/ardupilot_pid_tuning.js"), /data-ap-pid-slider/);
  assert.match(source("tabs/mavlink_parameters.html"), /All ArduPilot Parameters/);
  assert.match(source("tabs/mavlink_parameters.html"), /Complete native fallback/);
  assert.match(source("tabs/ardupilot_feature.js"), /ardupilotParameterExplanation/);
  assert.match(source("tabs/ardupilot_setup_common.js"), /Official metadata is unavailable/);
  assert.match(source("js/ardupilot/setupService.js"), /ARDUPILOT_REBOOT_AUTOPILOT = 1/);
});
