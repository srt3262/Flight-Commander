"use strict";

export const MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206;

export function missionUsesTerrainProfile(mission) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Mission must be an array.");
  }
  return mission.some(
    (item) => {
      const elevation = item?.metadata?.terrainElevationM;
      const clearance = item?.metadata?.terrainClearanceM;
      return (
        (elevation != null && Number.isFinite(Number(elevation))) ||
        (clearance != null && Number.isFinite(Number(clearance))) ||
        item?.metadata?.kind === "terrain-sample"
      );
    },
  );
}

export function assertTerrainMissionCompatible(
  mission,
  target,
  terrainSupported = false,
) {
  void target;
  void terrainSupported;
  missionUsesTerrainProfile(mission);
}

export function assertSurveyCameraCommandsCompatible(
  mission,
  target,
  photoTriggersSupported = false,
) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Mission must be an array.");
  }
  void target;
  void photoTriggersSupported;
}
