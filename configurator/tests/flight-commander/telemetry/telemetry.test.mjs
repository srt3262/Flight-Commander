import assert from "node:assert/strict";
import { test } from "node:test";

import normalizeInavTelemetry from "../../../js/telemetry/inavTelemetry.js";
import normalizeLtmTelemetry from "../../../js/telemetry/ltmTelemetry.js";

test("INAV normalization preserves scale, corrects pitch, and reports native 3D fix accurately", () => {
  const enabled = new Set(["ARM", "NAV WP"]);
  const telemetry = normalizeInavTelemetry({
    connected: true,
    AUX_CONFIG: ["ARM", "ANGLE", "NAV WP"],
    isModeEnabled: (mode) => enabled.has(mode),
    MIXER_CONFIG: { platformType: 1 },
    GPS_DATA: {
      lat: 400000000,
      lon: -750000000,
      alt: 147,
      speed: 1234,
      fix: 2,
      numSat: 13,
      hdop: 87,
      ground_course: 900,
    },
    SENSOR_DATA: {
      altitude: 120.5,
      verticalSpeed: -1.25,
      air_speed: 1500,
      kinematics: [10, 5, -1],
    },
    ANALOG: {
      voltage: 15.8,
      amperage: 12.3,
      battery_percentage: 73,
    },
    NAV_STATUS: {
      mode: 3,
      activeWpNumber: 2,
      activeWpAction: 1,
      error: 0,
    },
    MISSION_PLANNER: {
      getCountBusyPoints: () => 4,
      getWaypoint: () => ({
        getLatMap: () => 40.001,
        getLonMap: () => -75,
      }),
    },
  });

  assert.equal(telemetry.vehicleTypeName, "Airplane");
  assert.equal(telemetry.armed, true);
  assert.equal(telemetry.modeName, "NAV WP");
  assert.equal(telemetry.latitude, 40);
  assert.equal(telemetry.longitude, -75);
  assert.equal(telemetry.altitudeMsl, 147);
  assert.equal(telemetry.groundSpeed, 12.34);
  assert.equal(telemetry.airSpeed, 15);
  assert.equal(telemetry.heading, 359);
  assert.equal(telemetry.pitch, -5);
  assert.equal(telemetry.gpsFix, 3);
  assert.equal(telemetry.missionCurrent, 1);
  assert.equal(telemetry.missionTotal, 4);
  assert(
    telemetry.distanceToWaypoint > 110 && telemetry.distanceToWaypoint < 112,
  );
});

test("INAV normalization uses explicit connection state and fails safely on invalid values", () => {
  const telemetry = normalizeInavTelemetry({
    connected: false,
    CONFIG: { apiVersion: "9.1.0" },
    AUX_CONFIG: [],
    isModeEnabled: () => {
      throw new Error("not available");
    },
    GPS_DATA: { fix: 0, hdop: 65535, speed: "invalid" },
    ANALOG: { battery_percentage: 255 },
  });
  assert.equal(telemetry.connected, false);
  assert.equal(telemetry.gpsFix, 1);
  assert.equal(telemetry.hdop, null);
  assert.equal(telemetry.groundSpeed, null);
  assert.equal(telemetry.altitudeMsl, null);
  assert.equal(telemetry.batteryRemaining, null);
  assert.equal(telemetry.modeName, "ACRO");
});

test("LTM normalization keeps armed semantics and separates consumed mAh from current", () => {
  const telemetry = normalizeLtmTelemetry(
    {
      armed: true,
      flightmodeName: "WAYPOINTS",
      navigationMode: 3,
      activeWaypointNumber: 3,
      navigationAction: 1,
      navigationError: 0,
      latitude: 400000000,
      longitude: -750000000,
      altitude: 12345,
      homeAltitude: 10000,
      groundSpeed: 22,
      airspeed: 24,
      heading: 180,
      roll: -3,
      pitch: 7,
      voltage: 15400,
      consumedMah: 321,
      gpsFix: 3,
      gpsSats: 12,
      hdop: 95,
    },
    true,
  );

  assert.equal(telemetry.connected, true);
  assert.equal(telemetry.armed, true);
  assert.equal(telemetry.missionCurrent, 2);
  assert.equal(telemetry.relativeAltitude, 23.45);
  assert.equal(telemetry.altitudeMsl, 123.45);
  assert.equal(telemetry.pitch, -7);
  assert.equal(telemetry.voltage, 15.4);
  assert.equal(telemetry.current, null);
  assert.equal(telemetry.consumedMah, 321);
  assert.equal(telemetry.linkLost, false);
});

test("LTM supports the inherited misspelled consumption field without inventing amperage", () => {
  const telemetry = normalizeLtmTelemetry(
    {
      currectDrawn: 456,
      navigationError: 4,
      activeWaypointNumber: 0,
    },
    false,
  );
  assert.equal(telemetry.consumedMah, 456);
  assert.equal(telemetry.current, null);
  assert.equal(telemetry.missionReached, null);
  assert.equal(telemetry.linkLost, true);
});
