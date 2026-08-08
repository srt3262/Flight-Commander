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

test("terrain-profile uploads follow the Flight Commander product contract", () => {
  assert.equal(missionUsesTerrainProfile(terrainMission), true);
  assert.doesNotThrow(() => assertTerrainMissionCompatible(terrainMission, "inav", false));
  assert.doesNotThrow(() =>
    assertTerrainMissionCompatible(terrainMission, "flight-commander", false),
  );
  assert.doesNotThrow(() =>
    assertTerrainMissionCompatible(terrainMission, "flight-commander", true),
  );
});

test("camera command 206 follows the Flight Commander product contract", () => {
  const cameraMission = [{ command: 16 }, { command: 206, param1: 12.5 }];
  assert.doesNotThrow(() => assertSurveyCameraCommandsCompatible(cameraMission, "inav", false));
  assert.doesNotThrow(() =>
    assertSurveyCameraCommandsCompatible(cameraMission, "flight-commander", false),
  );
  assert.doesNotThrow(() =>
    assertSurveyCameraCommandsCompatible(
      cameraMission,
      "flight-commander",
      true,
    ),
  );
});
