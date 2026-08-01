import assert from "node:assert/strict";
import test from "node:test";

import {
  arduPilotDisplayMetadata,
  arduPilotUnitConversion,
  formatArduPilotDisplayNumber,
  fromArduPilotDisplayValue,
  toArduPilotDisplayIncrement,
  toArduPilotDisplayValue,
} from "../../../js/parameters/ardupilotParameterUnits.js";

test("ArduPilot metric parameter displays preserve native values and units", () => {
  assert.deepEqual(ardupilotSummary("m", "metric"), {
    displayUnit: "m",
    scale: 1,
    offset: 0,
    converted: false,
  });
  assert.equal(toArduPilotDisplayValue(12.5, "m", "metric"), 12.5);
  assert.equal(fromArduPilotDisplayValue(12.5, "m", "metric"), 12.5);
});

test("ArduPilot imperial parameter displays convert common flight quantities", () => {
  assert.equal(toArduPilotDisplayValue(10, "m", "imperial"), 32.80839895);
  assert.equal(toArduPilotDisplayValue(100, "cm", "imperial"), 3.280839895);
  assert.equal(toArduPilotDisplayValue(10, "m/s", "imperial"), 22.36936292);
  assert.equal(toArduPilotDisplayValue(100, "cm/s", "imperial"), 3.280839895);
  assert.equal(toArduPilotDisplayValue(20, "degC", "imperial"), 68);
  assert.equal(ardupilotSummary("m/s/s", "imperial").displayUnit, "ft/s²");
  assert.equal(ardupilotSummary("kg", "imperial").displayUnit, "lb");
});

test("display edits round-trip to exact controller-native units", () => {
  for (const [value, units] of [
    [123.45, "m"],
    [250, "cm/s"],
    [-12.25, "degC"],
    [3.5, "kg"],
  ]) {
    const displayed = toArduPilotDisplayValue(value, units, "imperial");
    const restored = fromArduPilotDisplayValue(displayed, units, "imperial");
    assert.ok(Math.abs(restored - value) <= Math.max(1e-8, Math.abs(value) * 1e-8));
  }
});

test("metadata limits and steps convert without applying temperature offsets to increments", () => {
  const source = Object.freeze({
    units: "degC",
    min: -10,
    max: 80,
    increment: 0.5,
  });
  const display = arduPilotDisplayMetadata(source, "imperial");
  assert.equal(display.units, "°F");
  assert.equal(display.min, 14);
  assert.equal(display.max, 176);
  assert.equal(display.increment, 0.9);
  assert.equal(display.nativeUnits, "degC");
  assert.equal(source.units, "degC");
  assert.equal(toArduPilotDisplayIncrement(1, "m", "imperial"), 3.280839895);
});

test("unknown and dimensionless metadata tokens are never guessed", () => {
  const unknown = arduPilotUnitConversion("m/s/m", "imperial");
  assert.equal(unknown.displayUnit, "m/s/m");
  assert.equal(unknown.converted, false);
  assert.equal(toArduPilotDisplayValue(7, "m/s/m", "imperial"), 7);
  assert.equal(toArduPilotDisplayValue(null, "m", "imperial"), null);
  assert.equal(formatArduPilotDisplayNumber(null), "");
});

function ardupilotSummary(units, system) {
  const selected = arduPilotUnitConversion(units, system);
  return {
    displayUnit: selected.displayUnit,
    scale: selected.scale,
    offset: selected.offset,
    converted: selected.converted,
  };
}
