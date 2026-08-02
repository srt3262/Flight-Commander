import assert from "node:assert/strict";
import test from "node:test";

import {
  ARDUPILOT_INAV_PAGE_SCHEMAS,
  canonicalTemplateNames,
  fromInavUiValue,
  resolveInavUiBinding,
  toInavUiValue,
} from "../../../js/ardupilot/inavUiParity.js";

test("ArduPilot compatibility pages name canonical INAV templates", () => {
  assert.deepEqual(canonicalTemplateNames(), [
    "adjustments",
    "advanced_tuning",
    "auxiliary",
    "calibration",
    "cli",
    "configuration",
    "failsafe",
    "gps",
    "javascript_programming",
    "led_strip",
    "logging",
    "magnetometer",
    "mixer",
    "onboard_logging",
    "osd",
    "outputs",
    "pid_tuning",
    "ports",
    "programming",
    "receiver",
    "search",
    "sensors",
    "setup",
  ]);
  for (const schema of Object.values(ARDUPILOT_INAV_PAGE_SCHEMAS)) {
    assert.ok(schema.template);
    assert.ok(Array.isArray(schema.bindings));
  }
});

test("bindings resolve only parameters reported by the connected controller", () => {
  const binding = ARDUPILOT_INAV_PAGE_SCHEMAS.outputs.bindings[0];
  assert.equal(resolveInavUiBinding([
    { id: "Q_M_PWM_TYPE", value: 6 },
  ], binding).id, "Q_M_PWM_TYPE");
  assert.equal(resolveInavUiBinding([
    { id: "SERVO1_FUNCTION", value: 33 },
  ], binding), null);
});

test("canonical controls round-trip transformed native values", () => {
  const idle = ARDUPILOT_INAV_PAGE_SCHEMAS.outputs.bindings
    .find((binding) => binding.key === "armed-idle");
  assert.equal(toInavUiValue(idle, 0.1), 10);
  assert.equal(fromInavUiValue(idle, 12), 0.12);

  const rate = ARDUPILOT_INAV_PAGE_SCHEMAS.gps_navigation.bindings
    .find((binding) => binding.key === "gps-rate");
  assert.equal(toInavUiValue(rate, 200), 5);
  assert.equal(fromInavUiValue(rate, 10), 100);
});
