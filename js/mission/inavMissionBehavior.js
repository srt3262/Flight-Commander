"use strict";

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_LOITER_UNLIM = 17;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_NAV_LAND = 21;
const INAV_ACTION_WAYPOINT = 1;
const INAV_END_MISSION = 165;
const INAV_MIN_EXPLICIT_WAYPOINT_SPEED_CM_S = 50;
const INAV_MAX_WAYPOINT_SPEED_CM_S = 32767;

export const INAV_MISSION_BEHAVIOR_STATUS = Object.freeze({
  EXPLICIT: "explicit",
  DEFAULT: "default",
  NONE: "none",
  AMBIGUOUS: "ambiguous",
  UNAVAILABLE: "unavailable",
  MIXED: "mixed",
});

export const INAV_MISSION_BEHAVIOR_WARNING = Object.freeze({
  SPEED_AMBIGUOUS: "INAV_SPEED_AMBIGUOUS",
  SPEED_FIXED_WING_UNAVAILABLE: "INAV_SPEED_FIXED_WING_UNAVAILABLE",
  SPEED_NO_WAYPOINTS: "INAV_SPEED_NO_WAYPOINTS",
  COMPLETION_MULTI_SEGMENT: "INAV_COMPLETION_MULTI_SEGMENT",
});

const COMPLETION_ACTION_BY_COMMAND = Object.freeze({
  [MAV_CMD_NAV_LOITER_UNLIM]: "hold",
  [MAV_CMD_NAV_RETURN_TO_LAUNCH]: "rtl",
  [MAV_CMD_NAV_LAND]: "land",
});
const FIXED_WING_VEHICLE_CLASSES = new Set([
  "airplane",
  "arduplane",
  "fixedwing",
  "flyingwing",
  "plane",
  "wing",
]);

function deepClone(value, seen = new WeakMap()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags);
    copy.lastIndex = value.lastIndex;
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value.entries()) {
      copy.set(deepClone(key, seen), deepClone(item, seen));
    }
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value.values()) copy.add(deepClone(item, seen));
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    seen.set(value, copy);
    return copy;
  }
  const copy = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      descriptor.value = deepClone(descriptor.value, seen);
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

function cloneMission(mission) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Decoded INAV mission must be an array.");
  }
  return deepClone(mission);
}

function normalizedVehicleClass(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isFixedWingVehicle(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, "fixedWing")
    ? options.fixedWing === true
    : FIXED_WING_VEHICLE_CLASSES.has(
        normalizedVehicleClass(options.vehicleClass),
      );
}

function missionCommand(item) {
  const command = Number(item?.command);
  return Number.isInteger(command) ? command : null;
}

function completionActionForItem(item) {
  return COMPLETION_ACTION_BY_COMMAND[missionCommand(item)] ?? "none";
}

function warning(code, field, message, details = {}) {
  return { code, field, message, ...details };
}

function ordinaryWaypointIndexes(mission) {
  const indexes = [];
  mission.forEach((item, index) => {
    if (missionCommand(item) === MAV_CMD_NAV_WAYPOINT) indexes.push(index);
  });
  return indexes;
}

function canonicalWaypointP1(item) {
  const metadata = item?.metadata;
  if (
    metadata == null ||
    metadata.inavAction !== INAV_ACTION_WAYPOINT ||
    !Object.prototype.hasOwnProperty.call(metadata, "inavP1")
  ) {
    return null;
  }
  const value = metadata.inavP1;
  return typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > INAV_MAX_WAYPOINT_SPEED_CM_S ||
    (value > 0 && value < INAV_MIN_EXPLICIT_WAYPOINT_SPEED_CM_S)
    ? null
    : value;
}

function ambiguousSpeedResult(indexes, values, reason, message) {
  const issue = warning(
    INAV_MISSION_BEHAVIOR_WARNING.SPEED_AMBIGUOUS,
    "cruiseSpeed",
    `${message} The existing waypoint P1 values will be preserved unchanged.`,
    {
      reason,
      itemIndexes: [...indexes],
      p1ValuesCmS: [...values],
    },
  );
  return {
    status: INAV_MISSION_BEHAVIOR_STATUS.AMBIGUOUS,
    available: false,
    preserve: true,
    cruiseSpeedMps: 0,
    waypointIndexes: [...indexes],
    p1ValuesCmS: [...values],
    warning: issue,
  };
}

function inferCruiseSpeed(mission, options) {
  const indexes = ordinaryWaypointIndexes(mission);
  const rawValues = indexes.map((index) => mission[index]?.metadata?.inavP1);
  if (isFixedWingVehicle(options)) {
    const issue = warning(
      INAV_MISSION_BEHAVIOR_WARNING.SPEED_FIXED_WING_UNAVAILABLE,
      "cruiseSpeed",
      "INAV fixed-wing waypoint-speed semantics cannot be inferred from mission P1 alone. The existing waypoint P1 values will be preserved unchanged.",
      { itemIndexes: [...indexes], p1ValuesCmS: [...rawValues] },
    );
    return {
      status: INAV_MISSION_BEHAVIOR_STATUS.UNAVAILABLE,
      available: false,
      preserve: true,
      cruiseSpeedMps: 0,
      waypointIndexes: indexes,
      p1ValuesCmS: rawValues,
      warning: issue,
    };
  }
  if (indexes.length === 0) {
    const issue = warning(
      INAV_MISSION_BEHAVIOR_WARNING.SPEED_NO_WAYPOINTS,
      "cruiseSpeed",
      "This INAV mission has no ordinary WAYPOINT items, so a cruise speed is unavailable.",
      { itemIndexes: [], p1ValuesCmS: [] },
    );
    return {
      status: INAV_MISSION_BEHAVIOR_STATUS.UNAVAILABLE,
      available: false,
      preserve: true,
      cruiseSpeedMps: 0,
      waypointIndexes: [],
      p1ValuesCmS: [],
      warning: issue,
    };
  }
  const values = indexes.map((index) => canonicalWaypointP1(mission[index]));
  if (values.some((value) => value == null)) {
    return ambiguousSpeedResult(
      indexes,
      rawValues,
      "invalid-waypoint-p1",
      `INAV waypoint speed is ambiguous because P1 must be 0 or an integer from ${INAV_MIN_EXPLICIT_WAYPOINT_SPEED_CM_S} to ${INAV_MAX_WAYPOINT_SPEED_CM_S} cm/s on every ordinary WAYPOINT item.`,
    );
  }
  const defaults = values.filter((value) => value === 0).length;
  if (defaults === values.length) {
    return {
      status: INAV_MISSION_BEHAVIOR_STATUS.DEFAULT,
      available: true,
      preserve: true,
      cruiseSpeedMps: 0,
      waypointIndexes: indexes,
      p1ValuesCmS: values,
      warning: null,
    };
  }
  if (defaults > 0) {
    return ambiguousSpeedResult(
      indexes,
      values,
      "mixed-default-and-explicit",
      "INAV waypoint speed is ambiguous because some WAYPOINT items use the controller default (P1 = 0) while others contain an explicit speed.",
    );
  }
  if (new Set(values).size !== 1) {
    return ambiguousSpeedResult(
      indexes,
      values,
      "differing-explicit-values",
      "INAV waypoint speed is ambiguous because the WAYPOINT items contain different explicit P1 speeds.",
    );
  }
  return {
    status: INAV_MISSION_BEHAVIOR_STATUS.EXPLICIT,
    available: true,
    preserve: false,
    cruiseSpeedMps: values[0] / 100,
    waypointIndexes: indexes,
    p1ValuesCmS: values,
    warning: null,
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function segmentTerminalIndexes(mission) {
  if (mission.length === 0) return [];
  const indexes = [];
  for (let index = 0; index < mission.length; index += 1) {
    const item = mission[index];
    const next = mission[index + 1];
    const segment = nonNegativeInteger(item?.metadata?.inavMultiMissionIndex);
    const nextSegment = nonNegativeInteger(
      next?.metadata?.inavMultiMissionIndex,
    );
    if (
      Number(item?.metadata?.inavEndMission) === INAV_END_MISSION ||
      (next != null &&
        segment != null &&
        nextSegment != null &&
        segment !== nextSegment)
    ) {
      indexes.push(index);
    }
  }
  if (indexes.at(-1) !== mission.length - 1) indexes.push(mission.length - 1);
  return indexes;
}

function inferCompletion(mission) {
  const finalItemIndex = mission.length - 1;
  const finalCommand =
    finalItemIndex >= 0 ? missionCommand(mission[finalItemIndex]) : null;
  const completionAction =
    finalItemIndex >= 0
      ? completionActionForItem(mission[finalItemIndex])
      : "none";
  const terminalIndexes = segmentTerminalIndexes(mission);
  const segmentTerminals = terminalIndexes.map((itemIndex, segmentIndex) => ({
    segmentIndex:
      nonNegativeInteger(mission[itemIndex]?.metadata?.inavMultiMissionIndex) ??
      segmentIndex,
    itemIndex,
    command: missionCommand(mission[itemIndex]),
    action: completionActionForItem(mission[itemIndex]),
  }));
  if (segmentTerminals.length > 1) {
    const issue = warning(
      INAV_MISSION_BEHAVIOR_WARNING.COMPLETION_MULTI_SEGMENT,
      "completionAction",
      `This INAV mission contains ${segmentTerminals.length} mission segments. One overall completion selector cannot safely represent every segment terminal; the existing terminal items will be preserved unchanged.`,
      {
        itemIndexes: [...terminalIndexes],
        segmentTerminals: deepClone(segmentTerminals),
      },
    );
    return {
      status: INAV_MISSION_BEHAVIOR_STATUS.MIXED,
      available: false,
      preserve: true,
      completionAction,
      finalItemIndex,
      finalCommand,
      multiSegment: true,
      segmentTerminals,
      warning: issue,
    };
  }
  return {
    status:
      completionAction === "none"
        ? INAV_MISSION_BEHAVIOR_STATUS.NONE
        : INAV_MISSION_BEHAVIOR_STATUS.EXPLICIT,
    available: true,
    preserve: false,
    completionAction,
    finalItemIndex,
    finalCommand,
    multiSegment: false,
    segmentTerminals,
    warning: null,
  };
}

export function deriveInavMissionBehavior(mission, options = {}) {
  const cloned = cloneMission(mission);
  const cruiseSpeed = inferCruiseSpeed(cloned, options);
  const completion = inferCompletion(cloned);
  return {
    mission: cloned,
    behavior: {
      cruiseSpeedMps: cruiseSpeed.cruiseSpeedMps,
      completionAction: completion.completionAction,
    },
    cruiseSpeed,
    completion,
    warnings: [cruiseSpeed.warning, completion.warning].filter(Boolean),
  };
}
