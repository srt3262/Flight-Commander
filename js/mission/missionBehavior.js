"use strict";

import { encodeInavMissionItems } from "./inavMissionCodec.js";

export const MAV_CMD_NAV_WAYPOINT = 16;
export const MAV_CMD_NAV_LOITER_UNLIM = 17;
export const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
export const MAV_CMD_NAV_LAND = 21;
export const MAV_CMD_DO_JUMP = 177;
export const MAV_CMD_DO_CHANGE_SPEED = 178;
export const MAV_FRAME_MISSION = 2;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
export const INAV_SPEED_CM_S_MAX = 32767;
export const INAV_SPEED_M_S_MAX = INAV_SPEED_CM_S_MAX / 100;
export const ARDUPILOT_SPEED_COMMAND_CONFLICT =
  "ARDUPILOT_SPEED_COMMAND_CONFLICT";

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
const COMPLETION_ACTIONS_BY_COMMAND = Object.freeze(
  Object.fromEntries(
    Object.entries(COMPLETION_COMMANDS).map(([action, command]) => [
      command,
      action,
    ]),
  ),
);
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

function isNavigationItem(item) {
  const command = missionCommand(item);
  return (
    item?.metadata?.flightCommanderGenerated !== "mission-completion" &&
    command != null &&
    command >= 16 &&
    command < 95
  );
}

function firstNavigationItemIndex(mission) {
  return mission.findIndex(isNavigationItem);
}

function speedCommandIndexes(mission) {
  const result = [];
  mission.forEach((item, index) => {
    if (missionCommand(item) === MAV_CMD_DO_CHANGE_SPEED) result.push(index);
  });
  return result;
}

function validatedMavlinkJumpTarget(item, index, missionLength) {
  const target = Number(item?.param1);
  if (!Number.isInteger(target) || target < 0 || target >= missionLength) {
    throw new Error(
      `Mission item ${index + 1} has invalid MAVLink DO_JUMP target ${item?.param1}.`,
    );
  }
  return target;
}

function remapMavlinkJumpsForInsertion(mission, index) {
  mission.forEach((item, itemIndex) => {
    if (missionCommand(item) !== MAV_CMD_DO_JUMP) return;
    const target = validatedMavlinkJumpTarget(item, itemIndex, mission.length);
    if (target >= index) item.param1 = target + 1;
  });
}

function remapMavlinkJumpsForRemoval(mission, index) {
  mission.forEach((item, itemIndex) => {
    if (missionCommand(item) !== MAV_CMD_DO_JUMP) return;
    const target = validatedMavlinkJumpTarget(item, itemIndex, mission.length);
    if (target === index) {
      throw new Error(
        `Mission item ${itemIndex + 1} DO_JUMP targets the global speed command that would be removed. Change or remove that JUMP before setting cruise speed to 0.`,
      );
    }
    if (target > index) item.param1 = target - 1;
  });
}

function validateMavlinkJumpTargets(mission) {
  mission.forEach((item, index) => {
    if (missionCommand(item) === MAV_CMD_DO_JUMP) {
      validatedMavlinkJumpTarget(item, index, mission.length);
    }
  });
}

function normalizedCanonicalSpeed(item) {
  const speed = Number(item?.param2);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  try {
    return speedMpsToCmS(speed) / 100;
  } catch {
    return null;
  }
}

function isCanonicalArduPilotGlobalSpeedCommand(item, index, mission) {
  const navigationIndex = firstNavigationItemIndex(mission);
  return (
    missionCommand(item) === MAV_CMD_DO_CHANGE_SPEED &&
    navigationIndex >= 0 &&
    index === navigationIndex + 1 &&
    Number(item?.frame) === MAV_FRAME_MISSION &&
    Number(item?.param1) === 1 &&
    normalizedCanonicalSpeed(item) != null &&
    Number(item?.param3) === -1 &&
    Number(item?.param4) === 0 &&
    Number(item?.latitude ?? item?.lat ?? 0) === 0 &&
    Number(item?.longitude ?? item?.lon ?? 0) === 0 &&
    Number(item?.altitude ?? item?.alt ?? 0) === 0 &&
    item?.autocontinue !== false
  );
}

function ardupilotSpeedConflict(indexes) {
  return {
    code: ARDUPILOT_SPEED_COMMAND_CONFLICT,
    itemIndexes: [...indexes],
    message:
      indexes.length > 1
        ? `The mission contains ${indexes.length} MAV_CMD_DO_CHANGE_SPEED items. Flight Commander cannot safely replace per-leg or custom speed changes with one global cruise-speed setting; keep cruise speed at 0 or remove the custom items.`
        : "The mission contains a noncanonical MAV_CMD_DO_CHANGE_SPEED item. Flight Commander cannot safely replace a per-leg or custom speed change with one global cruise-speed setting; keep cruise speed at 0 or remove the custom item.",
  };
}

function speedConflictError(indexes) {
  const conflict = ardupilotSpeedConflict(indexes);
  const error = new Error(conflict.message);
  error.code = conflict.code;
  error.itemIndexes = conflict.itemIndexes;
  return error;
}

export function deriveArduPilotMissionBehavior(mission) {
  const result = cloneMission(mission);
  const behavior = { ...DEFAULT_MISSION_BEHAVIOR };
  const conflicts = [];
  const speedIndexes = speedCommandIndexes(result);
  if (
    speedIndexes.length === 1 &&
    isCanonicalArduPilotGlobalSpeedCommand(
      result[speedIndexes[0]],
      speedIndexes[0],
      result,
    )
  ) {
    behavior.cruiseSpeedMps = normalizedCanonicalSpeed(result[speedIndexes[0]]);
  } else if (speedIndexes.length > 0) {
    conflicts.push(ardupilotSpeedConflict(speedIndexes));
  }
  const completionAction =
    COMPLETION_ACTIONS_BY_COMMAND[missionCommand(result.at(-1))];
  if (completionAction) behavior.completionAction = completionAction;
  return {
    mission: result,
    behavior,
    conflicts,
    conflict: conflicts[0] ?? null,
  };
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

function speedMissionItem(speedMps) {
  const speedCmS = speedMpsToCmS(speedMps);
  return speedCmS === 0
    ? null
    : {
        frame: MAV_FRAME_MISSION,
        command: MAV_CMD_DO_CHANGE_SPEED,
        current: false,
        autocontinue: true,
        param1: 1,
        param2: speedCmS / 100,
        param3: -1,
        param4: 0,
        latitude: 0,
        longitude: 0,
        altitude: 0,
        metadata: {
          flightCommanderGenerated: "mission-cruise-speed",
          speedUnit: "m/s",
        },
      };
}

export function compileArduPilotMission(mission, behavior = {}) {
  const normalized = normalizeMissionBehavior(behavior);
  validateMavlinkJumpTargets(mission);
  const result = appendCompletionAction(mission, normalized.completionAction);
  const speedItem = speedMissionItem(normalized.cruiseSpeedMps);
  const speedIndexes = speedCommandIndexes(result);
  if (!speedItem) {
    if (
      speedIndexes.length === 1 &&
      isCanonicalArduPilotGlobalSpeedCommand(
        result[speedIndexes[0]],
        speedIndexes[0],
        result,
      )
    ) {
      remapMavlinkJumpsForRemoval(result, speedIndexes[0]);
      result.splice(speedIndexes[0], 1);
    }
    return result;
  }
  if (firstNavigationItemIndex(result) < 0) {
    throw new Error(
      "ArduPilot mission cruise speed requires at least one navigation item.",
    );
  }
  if (speedIndexes.length > 0) {
    if (
      speedIndexes.length !== 1 ||
      !isCanonicalArduPilotGlobalSpeedCommand(
        result[speedIndexes[0]],
        speedIndexes[0],
        result,
      )
    ) {
      throw speedConflictError(speedIndexes);
    }
    const speedIndex = speedIndexes[0];
    result[speedIndex] = { ...result[speedIndex], param2: speedItem.param2 };
    return result;
  }
  const insertionIndex = firstNavigationItemIndex(result) + 1;
  remapMavlinkJumpsForInsertion(result, insertionIndex);
  result.splice(insertionIndex, 0, speedItem);
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
