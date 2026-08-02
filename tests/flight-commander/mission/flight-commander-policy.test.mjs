import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSurveyCameraCommandsCompatible,
  assertTerrainMissionCompatible,
  missionUsesTerrainProfile,
} from "../../../js/mission/flightCommanderMissionPolicy.js";

const terrainMission = [
  {
    command: 16,
    metadata: {
      terrainElevationM: 125.4,
      terrainClearanceM: 60,
    },
  },
];

test("terrain-profile uploads require the Flight Commander capability", () => {
  assert.equal(missionUsesTerrainProfile(terrainMission), true);
  assert.throws(
    () => assertTerrainMissionCompatible(terrainMission, "inav", false),
    /only be written to Flight Commander Firmware/,
  );
  assert.throws(
    () =>
      assertTerrainMissionCompatible(
        terrainMission,
        "flight-commander",
        false,
      ),
    /terrain-waypoint capability/,
  );
  assert.doesNotThrow(() =>
    assertTerrainMissionCompatible(terrainMission, "flight-commander", true),
  );
});

test("camera command 206 requires the Flight Commander photo capability", () => {
  const cameraMission = [{ command: 16 }, { command: 206, param1: 12.5 }];
  assert.throws(
    () => assertSurveyCameraCommandsCompatible(cameraMission, "inav", false),
    /distance-camera command 206/,
  );
  assert.throws(
    () =>
      assertSurveyCameraCommandsCompatible(
        cameraMission,
        "flight-commander",
        false,
      ),
    /does not advertise/,
  );
  assert.doesNotThrow(() =>
    assertSurveyCameraCommandsCompatible(
      cameraMission,
      "flight-commander",
      true,
    ),
  );
});
