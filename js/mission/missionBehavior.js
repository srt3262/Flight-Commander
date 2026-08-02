"use strict";

import { encodeInavMissionItems } from "./inavMissionCodec.js";

export const MAV_CMD_NAV_WAYPOINT = 16;
export const MAV_CMD_NAV_LOITER_UNLIM = 17;
export const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
export const MAV_CMD_NAV_LAND = 21;
export const MAV_FRAME_MISSION = 2;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
export const INAV_SPEED_CM_S_MAX = 32767;
export const INAV_SPEED_M_S_MAX = INAV_SPEED_CM_S_MAX / 100;

export const MISSION_BEHAVIOR_ACTIONS = Object.freeze({
  NONE: "none",
  HOLD: "hold",
  RTL: "rtl",
  LAND: "land",
});

export const DEFAULT_MISSION_BEHAVIOR = Object.freeze({
  cruiseSpeedMps: 0,
  completionAction: MISSION_BEHAVIOR_ACTIONS.NONE,
});

const TERMINAL_COMMANDS = new Set([
  MAV_CMD_NAV_LOITER_UNLIM,
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
  MAV_CMD_NAV_LAND,
]);
const COMPLETION_COMMANDS = Object.freeze({
  [MISSION_BEHAVIOR_ACTIONS.HOLD]: MAV_CMD_NAV_LOITER_UNLIM,
  [MISSION_BEHAVIOR_ACTIONS.RTL]: MAV_CMD_NAV_RETURN_TO_LAUNCH,
  [MISSION_BEHAVIOR_ACTIONS.LAND]: MAV_CMD_NAV_LAND,
});
const ACTION_LABELS = Object.freeze({
  [MISSION_BEHAVIOR_ACTIONS.NONE]: "no added action",
  [MISSION_BEHAVIOR_ACTIONS.HOLD]: "hold / loiter",
  [MISSION_BEHAVIOR_ACTIONS.RTL]: "return to launch",
  [MISSION_BEHAVIOR_ACTIONS.LAND]: "land",
});

function normalizeAction(value, label) {
  const normalized =
    String(value ?? "")
      .trim()
      .toLowerCase() || MISSION_BEHAVIOR_ACTIONS.NONE;
  if (!Object.values(MISSION_BEHAVIOR_ACTIONS).includes(normalized)) {
    throw new RangeError(
      `${label} must be none, hold, RTL, or land; received "${value}".`,
    );
  }
  return normalized;
}

export function speedMpsToCmS(value) {
  if (value == null || value === "") return 0;
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < 0) {
    throw new RangeError(
      "Mission cruise speed must be a non-negative finite value in m/s.",
    );
  }
  const centimetersPerSecond = Math.round(speed * 100);
  if (centimetersPerSecond > INAV_SPEED_CM_S_MAX) {
    throw new RangeError(
      `Mission cruise speed cannot exceed ${INAV_SPEED_M_S_MAX.toFixed(2)} m/s because INAV stores waypoint speed as signed 16-bit cm/s.`,
    );
  }
  return centimetersPerSecond;
}

export function normalizeMissionBehavior(behavior = {}) {
  return {
    cruiseSpeedMps:
      speedMpsToCmS(
        behavior.cruiseSpeedMps ??
          behavior.cruiseSpeed ??
          DEFAULT_MISSION_BEHAVIOR.cruiseSpeedMps,
      ) / 100,
    completionAction: normalizeAction(
      behavior.completionAction ?? behavior.onCompletion,
      "Mission completion action",
    ),
  };
}

function cloneMission(mission) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  return mission.map((item) => ({
    ...item,
    ...(item?.metadata ? { metadata: { ...item.metadata } } : {}),
  }));
}

function missionCommand(item) {
  const command = Number(item?.command);
  return Number.isInteger(command) ? command : null;
}

function missionNumber(item, primary, alternative) {
  const value = item?.[primary] ?? item?.[alternative];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finalGeographicItem(mission) {
  for (let index = mission.length - 1; index >= 0; index -= 1) {
    const item = mission[index];
    const command = Number(item?.command ?? MAV_CMD_NAV_WAYPOINT);
    const latitude = missionNumber(item, "latitude", "lat");
    const longitude = missionNumber(item, "longitude", "lon");
    if (
      latitude != null &&
      longitude != null &&
      command !== MAV_CMD_NAV_RETURN_TO_LAUNCH &&
      ([16, 17, 19, 21, 22].includes(command) ||
        latitude !== 0 ||
        longitude !== 0)
    ) {
      return {
        item,
        latitude,
        longitude,
        altitude: missionNumber(item, "altitude", "alt") ?? 0,
      };
    }
  }
  return null;
}

function terminalMissionItem(action, mission) {
  const normalized = normalizeAction(action, "Mission completion action");
  if (normalized === MISSION_BEHAVIOR_ACTIONS.NONE) return null;
  const command = COMPLETION_COMMANDS[normalized];
  if (command === MAV_CMD_NAV_RETURN_TO_LAUNCH) {
    return {
      frame: MAV_FRAME_MISSION,
      command,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: Number.NaN,
      latitude: 0,
      longitude: 0,
      altitude: 0,
      metadata: {
        flightCommanderGenerated: "mission-completion",
        completionAction: normalized,
      },
    };
  }
  const final = finalGeographicItem(mission);
  if (!final) {
    throw new Error(
      `${ACTION_LABELS[normalized]} at mission completion requires at least one geographic waypoint.`,
    );
  }
  return {
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
    command,
    current: false,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: Number.NaN,
    latitude: final.latitude,
    longitude: final.longitude,
    altitude: normalized === MISSION_BEHAVIOR_ACTIONS.LAND ? 0 : final.altitude,
    metadata: {
      flightCommanderGenerated: "mission-completion",
      completionAction: normalized,
    },
  };
}

export function appendCompletionAction(mission, action) {
  const result = cloneMission(mission);
  const normalized = normalizeAction(action, "Mission completion action");
  if (normalized === MISSION_BEHAVIOR_ACTIONS.NONE) return result;
  const requestedCommand = COMPLETION_COMMANDS[normalized];
  const existingCommand = Number(result.at(-1)?.command);
  if (TERMINAL_COMMANDS.has(existingCommand)) {
    if (existingCommand === requestedCommand) return result;
    throw new Error(
      `The mission already ends with command ${existingCommand}. Remove that terminal item or select "No added action" before choosing a different completion behavior.`,
    );
  }
  const lastItem = result.at(-1);
  if (Number(lastItem?.metadata?.inavEndMission) === 165) {
    lastItem.metadata.inavEndMission = 0;
  }
  result.push(terminalMissionItem(normalized, result));
  return result;
}

export function compileInavMspMission(mission, behavior = {}) {
  const normalized = normalizeMissionBehavior(behavior);
  encodeInavMissionItems(mission);
  const segments = new Set(
    mission
      .map((item) => Number(item?.metadata?.inavMultiMissionIndex))
      .filter((index) => Number.isInteger(index) && index >= 0),
  );
  if (
    segments.size > 1 &&
    normalized.completionAction !== MISSION_BEHAVIOR_ACTIONS.NONE
  ) {
    const requested = COMPLETION_COMMANDS[normalized.completionAction];
    if (missionCommand(mission.at(-1)) !== requested) {
      throw new Error(
        "One overall completion action cannot modify an INAV multi-mission plan. Preserve each segment terminal or edit the individual mission segments.",
      );
    }
  }
  return {
    mission: appendCompletionAction(mission, normalized.completionAction),
    speedCmS: speedMpsToCmS(normalized.cruiseSpeedMps),
  };
}

export function assertInavMavlinkBehaviorSupported(behavior = {}) {
  const normalized = normalizeMissionBehavior(behavior);
  if (speedMpsToCmS(normalized.cruiseSpeedMps) !== 0) {
    throw new Error(
      "INAV mission cruise speed cannot be written over stock MAVLink. Set cruise speed to 0 (controller default) or use the wired MSP mission link.",
    );
  }
  if (
    ![MISSION_BEHAVIOR_ACTIONS.NONE, MISSION_BEHAVIOR_ACTIONS.RTL].includes(
      normalized.completionAction,
    )
  ) {
    throw new Error(
      `INAV MAVLink cannot represent the selected ${ACTION_LABELS[normalized.completionAction]} completion action. Use RTL, no added action, or write the mission through MSP.`,
    );
  }
  return normalized;
}

export function compileInavMavlinkMission(mission, behavior = {}) {
  const normalized = assertInavMavlinkBehaviorSupported(behavior);
  return appendCompletionAction(mission, normalized.completionAction);
}
