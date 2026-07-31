import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  GROUND_CONTROL_UNIT_SYSTEMS,
  METERS_PER_SECOND_TO_MILES_PER_HOUR,
  METERS_TO_FEET,
  convertGroundControlValue,
  formatGroundControlValue,
  getGroundControlUnitProfile,
  groundControlUnitLabel,
  normalizeGroundControlUnitSystem,
  toGroundControlDisplayState,
} from "../../../js/gcs/groundControlUnits.js";

test("normalizes the two supported unit systems with a metric fallback", () => {
  assert.equal(DEFAULT_GROUND_CONTROL_UNIT_SYSTEM, "metric");
  assert.equal(normalizeGroundControlUnitSystem("metric"), "metric");
  assert.equal(normalizeGroundControlUnitSystem(" IMPERIAL "), "imperial");
  assert.equal(normalizeGroundControlUnitSystem("OSD"), "metric");
  assert.equal(normalizeGroundControlUnitSystem(null), "metric");
});

test("exposes immutable labels, multipliers, and readable HUD tape steps", () => {
  const metric = getGroundControlUnitProfile(
    GROUND_CONTROL_UNIT_SYSTEMS.METRIC,
  );
  const imperial = getGroundControlUnitProfile(
    GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL,
  );

  assert.equal(Object.isFrozen(metric), true);
  assert.deepEqual(metric.hudTapeSteps.groundSpeed, {
    compact: 2,
    regular: 5,
  });
  assert.deepEqual(metric.hudTapeSteps.relativeAltitude, {
    compact: 5,
    regular: 10,
  });
  assert.deepEqual(imperial.hudTapeSteps.groundSpeed, {
    compact: 5,
    regular: 10,
  });
  assert.deepEqual(imperial.hudTapeSteps.relativeAltitude, {
    compact: 20,
    regular: 50,
  });
  assert.equal(imperial.altitude.symbol, "ft");
  assert.equal(imperial.horizontalSpeed.symbol, "mph");
  assert.equal(imperial.verticalSpeed.symbol, "ft/s");
});

test("converts only display quantities from canonical SI values", () => {
  assert.equal(convertGroundControlValue(100, "relativeAltitude", "metric"), 100);
  assert.equal(
    convertGroundControlValue(100, "relativeAltitude", "imperial"),
    100 * METERS_TO_FEET,
  );
  assert.equal(
    convertGroundControlValue(100, "distanceToWaypoint", "imperial"),
    100 * METERS_TO_FEET,
  );
  assert.equal(
    convertGroundControlValue(10, "groundSpeed", "imperial"),
    10 * METERS_PER_SECOND_TO_MILES_PER_HOUR,
  );
  assert.equal(
    convertGroundControlValue(10, "airSpeed", "imperial"),
    10 * METERS_PER_SECOND_TO_MILES_PER_HOUR,
  );
  assert.equal(
    convertGroundControlValue(-2, "climbRate", "imperial"),
    -2 * METERS_TO_FEET,
  );
});

test("keeps unavailable and non-finite telemetry unavailable", () => {
  for (const value of [null, undefined, "", "not-a-number", Number.NaN, Infinity]) {
    assert.equal(
      convertGroundControlValue(value, "groundSpeed", "imperial"),
      null,
    );
  }
  assert.equal(convertGroundControlValue(0, "groundSpeed", "imperial"), 0);
  assert.equal(convertGroundControlValue("2.5", "groundSpeed", "metric"), 2.5);
  assert.throws(
    () => convertGroundControlValue(1, "temperature", "metric"),
    /Unsupported Ground Control quantity/,
  );
});

test("creates a converted display snapshot without mutating canonical SI state", () => {
  const canonical = {
    relativeAltitude: 30,
    groundSpeed: 10,
    airSpeed: 12,
    climbRate: -1.5,
    distanceToWaypoint: 250,
    heading: 90,
    voltage: 22.8,
  };
  const original = { ...canonical };
  const display = toGroundControlDisplayState(canonical, "imperial");

  assert.deepEqual(canonical, original);
  assert.notEqual(display, canonical);
  assert.equal(display.relativeAltitude, 30 * METERS_TO_FEET);
  assert.equal(
    display.groundSpeed,
    10 * METERS_PER_SECOND_TO_MILES_PER_HOUR,
  );
  assert.equal(display.airSpeed, 12 * METERS_PER_SECOND_TO_MILES_PER_HOUR);
  assert.equal(display.climbRate, -1.5 * METERS_TO_FEET);
  assert.equal(display.distanceToWaypoint, 250 * METERS_TO_FEET);
  assert.equal(display.heading, 90);
  assert.equal(display.voltage, 22.8);
});

test("formats symbols and spoken units consistently", () => {
  assert.equal(
    formatGroundControlValue(10, "groundSpeed", "metric"),
    "10.0 m/s",
  );
  assert.equal(
    formatGroundControlValue(10, "groundSpeed", "imperial", { decimals: 2 }),
    "22.37 mph",
  );
  assert.equal(
    formatGroundControlValue(10, "relativeAltitude", "imperial", {
      decimals: 0,
      spoken: true,
    }),
    "33 feet",
  );
  assert.equal(
    groundControlUnitLabel("climbRate", "imperial", { spoken: true }),
    "feet per second",
  );
  assert.equal(formatGroundControlValue(null, "distance", "metric"), "--");
});
