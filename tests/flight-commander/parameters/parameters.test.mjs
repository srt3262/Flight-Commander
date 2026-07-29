import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ArduPilotParameterMetadataProvider,
  normalizeArduPilotMetadata,
  vehicleProfileForMavType,
} from "../../../js/parameters/ardupilotParameterMetadata.js";
import {
  buildParameterCatalog,
  matchesSearch,
  parameterView,
  validateParameterValue,
} from "../../../js/parameters/ardupilotParameterModel.js";

test("official metadata is normalized from nested records and arrays", () => {
  const metadata = normalizeArduPilotMetadata({
    Vehicle: {
      BATT_LOW_VOLT: {
        DisplayName: "Low battery voltage",
        Description: "Failsafe threshold",
        Range: { low: "9.0", high: "25.2" },
        Units: "V",
        User: "Standard",
        Values: { 0: "Disabled", 1: "Enabled" },
      },
    },
  });
  const record = metadata.get("BATT_LOW_VOLT");
  assert.equal(record.displayName, "Low battery voltage");
  assert.equal(record.min, 9);
  assert.equal(record.max, 25.2);
  assert.equal(record.user, "standard");
  assert.deepEqual(record.values, [
    { value: 0, label: "Disabled" },
    { value: 1, label: "Enabled" },
  ]);

  const arrayMetadata = normalizeArduPilotMetadata({
    parameters: [{ name: "RTL_ALT", min: 100, max: 5000 }],
  });
  assert.equal(arrayMetadata.get("RTL_ALT").max, 5000);
});

test("metadata provider uses version-matched official data and binds fetch safely", async () => {
  const cacheValues = new Map();
  const fetchCalls = [];
  let receiver;
  const provider = new ArduPilotParameterMetadataProvider({
    fetchImpl(url) {
      receiver = this;
      fetchCalls.push(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          parameters: [{ name: "RTL_ALT", DisplayName: "RTL altitude" }],
        }),
      });
    },
    cache: {
      get: (key) => cacheValues.get(key),
      set: (key, value) => cacheValues.set(key, value),
    },
    now: () => 12345,
  });

  const result = await provider.load(1, {
    firmwareVersion: { major: 4, minor: 6 },
  });
  assert.equal(result.profile.id, "plane");
  assert.equal(result.source, "official");
  assert.equal(result.versionMatched, true);
  assert.match(fetchCalls[0], /Plane-4\.6\/apm\.pdef\.json$/);
  assert.equal(receiver, provider);
  assert.equal(result.metadata.get("RTL_ALT").displayName, "RTL altitude");

  const cached = await provider.load(1, {
    firmwareVersion: { major: 4, minor: 6 },
  });
  assert.equal(cached.source, "cache");
  assert.equal(fetchCalls.length, 1);
});

test("metadata provider falls back to stale cache and then inferred mode", async () => {
  let stored;
  const cache = {
    get: () => stored,
    set: (key, value) => {
      stored = value;
    },
  };
  const working = new ArduPilotParameterMetadataProvider({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        parameters: [{ name: "ARMING_CHECK", DisplayName: "Checks" }],
      }),
    }),
    cache,
    now: () => 100,
    cacheTtlMs: 1,
  });
  await working.load(2);

  const stale = new ArduPilotParameterMetadataProvider({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    cache,
    now: () => 1000,
    cacheTtlMs: 1,
  });
  const staleResult = await stale.load(2);
  assert.equal(staleResult.source, "cache");
  assert.equal(staleResult.stale, true);
  assert.match(staleResult.warning, /cached copy/);

  const inferred = await new ArduPilotParameterMetadataProvider({
    fetchImpl: false,
    cache: { get: () => null, set() {} },
  }).load(2);
  assert.equal(inferred.source, "inferred");
  assert.equal(inferred.metadata.size, 0);
});

test("parameter catalog, search, control type, and range validation match the UI model", () => {
  const metadata = normalizeArduPilotMetadata({
    parameters: [
      {
        name: "BATT_MONITOR",
        DisplayName: "Battery monitor",
        Description: "Battery sensor type",
        User: "Standard",
        Values: { 0: "Disabled", 1: "Enabled" },
        Range: { low: 0, high: 1 },
      },
      {
        name: "SERVO1_FUNCTION",
        DisplayName: "Servo function",
        User: "Advanced",
        Values: { 0: "Disabled", 33: "Motor 1" },
      },
    ],
  });
  const parameters = [
    { id: "SERVO1_FUNCTION", value: 33, type: 6 },
    { id: "BATT_MONITOR", value: 1, type: 6 },
  ];

  const battery = parameterView(parameters[1], metadata);
  assert.equal(battery.controlKind, "boolean");
  assert.equal(battery.category.id, "power");
  assert.equal(matchesSearch(battery, "sensor type"), true);
  assert.deepEqual(validateParameterValue(battery, 1), {
    valid: true,
    value: 1,
  });
  assert.equal(validateParameterValue(battery, 2).valid, false);
  assert.match(validateParameterValue(battery, "abc").message, /numeric value/);

  const standard = buildParameterCatalog(parameters, metadata);
  assert.equal(standard.length, 1);
  assert.equal(standard[0].groups[0].parameters[0].id, "BATT_MONITOR");

  const advanced = buildParameterCatalog(parameters, metadata, {
    level: "advanced",
  });
  assert.equal(
    advanced.reduce((sum, category) => sum + category.count, 0),
    2,
  );
});

test("MAV vehicle type mapping selects the correct official parameter profile", () => {
  assert.equal(vehicleProfileForMavType(1).id, "plane");
  assert.equal(vehicleProfileForMavType(10).id, "rover");
  assert.equal(vehicleProfileForMavType(12).id, "sub");
  assert.equal(vehicleProfileForMavType(2).id, "copter");
});
