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
  if (!missionUsesTerrainProfile(mission)) return;
  if (target === "flight-commander" && terrainSupported) return;
  throw new Error(
    "This terrain-profiled plan can only be written to Flight Commander Firmware " +
      "that advertises terrain-waypoint capability. No mission data was written.",
  );
}

export function assertSurveyCameraCommandsCompatible(
  mission,
  target,
  photoTriggersSupported = false,
) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Mission must be an array.");
  }
  if (target === "flight-commander" && photoTriggersSupported) return;
  const cameraItems = mission
    .map((item, index) =>
      Number(item?.command) === MAV_CMD_DO_SET_CAM_TRIGG_DIST ? index + 1 : null,
    )
    .filter(Number.isInteger);
  if (!cameraItems.length) return;
  throw new Error(
    `This plan contains Flight Commander distance-camera command 206 at mission item` +
      `${cameraItems.length === 1 ? "" : "s"} ${cameraItems.join(", ")}. ` +
      "The connected firmware does not advertise a lossless camera-trigger mission command. " +
      "Select Automatic or Navigation only, regenerate the survey, and try again. " +
      "No mission data was written.",
  );
}
