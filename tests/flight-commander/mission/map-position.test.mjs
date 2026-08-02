import assert from "node:assert/strict";
import test from "node:test";

import {
  isUsableMapCoordinate,
  selectMavlinkMapPosition,
} from "../../../js/maps/mapPosition.js";

test("Flight Planner rejects MAVLink Null Island before GPS fix", () => {
  assert.equal(isUsableMapCoordinate(0, 0), false);
  assert.equal(selectMavlinkMapPosition({
    gpsFix: 0,
    latitude: 0,
    longitude: 0,
  }), null);
});

test("Flight Planner accepts a fixed vehicle position", () => {
  assert.deepEqual(selectMavlinkMapPosition({
    gpsFix: 3,
    latitude: 34.8,
    longitude: -78.9,
  }), {
    latitude: 34.8,
    longitude: -78.9,
    source: "vehicle",
  });
});

test("Flight Planner falls back to a valid home instead of an unfixed vehicle", () => {
  assert.deepEqual(selectMavlinkMapPosition({
    gpsFix: 1,
    latitude: 0,
    longitude: 0,
    homeLatitude: 34.9,
    homeLongitude: -79.0,
  }), {
    latitude: 34.9,
    longitude: -79.0,
    source: "home",
  });
});

test("Flight Planner rejects out-of-range coordinates", () => {
  assert.equal(isUsableMapCoordinate(91, -78), false);
  assert.equal(isUsableMapCoordinate(35, -181), false);
});
