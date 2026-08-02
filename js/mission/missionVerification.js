"use strict";

import { normalizeMissionForInavMsp } from "./inavMissionCodec.js";

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206;
const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_MISSION = 2;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
const MAV_FRAME_GLOBAL_INT = 5;
const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
const INAV_MAVLINK_SUPPORTED_COMMAND_SET = new Set([
  MAV_CMD_NAV_WAYPOINT,
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
]);
const FLIGHT_COMMANDER_MAVLINK_SUPPORTED_COMMAND_SET = new Set([
  ...INAV_MAVLINK_SUPPORTED_COMMAND_SET,
  MAV_CMD_DO_SET_CAM_TRIGG_DIST,
]);
const INAV_INSERTED_SEGMENT_FIELD = "flightCommanderInavSegmentIndex";
const MISSION_PARAMETER_FIELDS = Object.freeze([
  "param1",
  "param2",
  "param3",
  "param4",
]);
const DEFAULT_COORDINATE_TOLERANCE_DEG = 1e-6;
const DEFAULT_ALTITUDE_TOLERANCE_M = 0.02;

function normalizeProtocol(protocol) {
  const normalized = String(protocol ?? "")
    .trim()
    .toLowerCase();
  if (["msp", "inav", "inav/msp"].includes(normalized)) return "msp";
  if (["mavlink", "mavlink1", "mavlink2"].includes(normalized)) {
    return "mavlink";
  }
  throw new Error(`Unsupported mission protocol "${protocol}".`);
}

function missionCommand(item, fallback) {
  const value = item?.command;
  if (value == null && fallback != null) return fallback;
  const command = Number(value);
  return Number.isFinite(command) ? command : null;
}

function normalizeFirmwareProfile(options = {}) {
  const profile =
    typeof options === "string"
      ? options
      : (options.firmwareProfile ?? options.profile);
  if (profile == null || profile === "") return "inav";
  const normalized = String(profile).trim().toLowerCase();
  if (["inav", "inav-mavlink", "inav/mavlink"].includes(normalized)) {
    return "inav";
  }
  if (
    ["flight-commander", "flightcommander", "fcfw"].includes(normalized)
  ) {
    return "flight-commander";
  }
  throw new Error(`Unsupported firmware profile "${profile}".`);
}

function validateInavMavlinkRepresentation(mission, profile) {
  const profileLabel =
    profile === "flight-commander" ? "Flight Commander" : "Official INAV";
  mission.forEach((item, index) => {
    const metadata = item?.metadata;
    const rawMetadataKey = Object.keys(metadata ?? {}).find(
      (key) => key.startsWith("inav") || key === INAV_INSERTED_SEGMENT_FIELD,
    );
    if (rawMetadataKey) {
      throw new Error(
        `${profileLabel} MAVLink cannot losslessly write mission item ${index + 1} ` +
          `because it contains raw INAV metadata (${rawMetadataKey}). ` +
          "Use wired MSP to preserve the complete mission.",
      );
    }
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    const photoTrigger =
      profile === "flight-commander" &&
      command === MAV_CMD_DO_SET_CAM_TRIGG_DIST;
    for (const field of MISSION_PARAMETER_FIELDS) {
      const value = item?.[field];
      if (value == null || value === "") continue;
      const number = Number(value);
      if (photoTrigger && field === "param1") {
        if (!Number.isFinite(number) || number < 0 || number > 327.67) {
          throw new Error(
            `Flight Commander mission item ${index + 1} camera trigger distance ` +
              `must be between 0 and 327.67 m; received ${value}.`,
          );
        }
        continue;
      }
      if (Number.isFinite(number) && number !== 0) {
        throw new Error(
          `${profileLabel} MAVLink mission item ${index + 1} command ${command} ` +
            `has nonzero ${field} ${number}, which this mission command cannot preserve. ` +
            "Set it to zero and try again.",
        );
      }
    }
    const allowedFrames =
      command === MAV_CMD_NAV_RETURN_TO_LAUNCH || photoTrigger
        ? [MAV_FRAME_MISSION]
        : profile === "flight-commander"
          ? [
              MAV_FRAME_GLOBAL,
              MAV_FRAME_GLOBAL_RELATIVE_ALT,
              MAV_FRAME_GLOBAL_INT,
              MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            ]
          : [MAV_FRAME_GLOBAL_RELATIVE_ALT, MAV_FRAME_GLOBAL_RELATIVE_ALT_INT];
    if (
      item?.frame != null &&
      item.frame !== "" &&
      !allowedFrames.includes(Number(item.frame))
    ) {
      throw new Error(
        `${profileLabel} MAVLink mission item ${index + 1} command ${command} ` +
          `requires frame ${allowedFrames.join(" or ")}; received ${item.frame}. ` +
          "Correct the frame or use wired MSP.",
      );
    }
    if (item?.autocontinue != null && item.autocontinue !== "") {
      const value = item.autocontinue;
      const enabled =
        value === true ||
        value === 1 ||
        String(value).trim().toLowerCase() === "true" ||
        String(value).trim() === "1";
      if (!enabled) {
        throw new Error(
          `${profileLabel} MAVLink mission item ${index + 1} requires ` +
            "autocontinue=true. Correct the item or use wired MSP.",
        );
      }
    }
  });
}

export function filterExpectedMissionForProtocol(
  mission,
  protocol,
  options = {},
) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Expected mission must be an array.");
  }
  const normalizedProtocol = normalizeProtocol(protocol);
  const profile = normalizeFirmwareProfile(options);
  if (normalizedProtocol === "msp") {
    return normalizeMissionForInavMsp(mission, {
      allowFlightCommanderPhotoTriggers: profile === "flight-commander",
    });
  }
  const supportedCommands =
    profile === "flight-commander"
      ? FLIGHT_COMMANDER_MAVLINK_SUPPORTED_COMMAND_SET
      : INAV_MAVLINK_SUPPORTED_COMMAND_SET;
  const profileLabel =
    profile === "flight-commander" ? "Flight Commander" : "Official INAV";
  mission.forEach((item, index) => {
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    if (!supportedCommands.has(command)) {
      throw new Error(
        `${profileLabel} MAVLink mission item ${index + 1} uses unsupported ` +
          `command ${command}.`,
      );
    }
  });
  validateInavMavlinkRepresentation(mission, profile);
  return mission.map((item) => {
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    const photoTrigger =
      profile === "flight-commander" &&
      command === MAV_CMD_DO_SET_CAM_TRIGG_DIST;
    const absoluteWaypoint =
      profile === "flight-commander" &&
      command === MAV_CMD_NAV_WAYPOINT &&
      [MAV_FRAME_GLOBAL, MAV_FRAME_GLOBAL_INT].includes(Number(item.frame));
    return {
      ...item,
      command,
      param1: photoTrigger
        ? Math.round(Number(item.param1 ?? 0) * 100) / 100
        : 0,
      param2: 0,
      param3: 0,
      param4: 0,
      frame:
        command === MAV_CMD_NAV_RETURN_TO_LAUNCH || photoTrigger
          ? MAV_FRAME_MISSION
          : absoluteWaypoint
            ? MAV_FRAME_GLOBAL
          : MAV_FRAME_GLOBAL_RELATIVE_ALT,
      autocontinue: true,
      ...(photoTrigger
        ? { latitude: 0, longitude: 0, altitude: 0 }
        : {}),
    };
  });
}

const INAV_METADATA_FIELDS = Object.freeze([
  ["inavAction", "action"],
  ["inavP1", "P1"],
  ["inavP2", "P2"],
  ["inavP3", "P3"],
  ["inavEndMission", "end flag"],
  ["inavMultiMissionIndex", "multi-mission index"],
  ["inavLatitudeE7", "raw latitude"],
  ["inavLongitudeE7", "raw longitude"],
  ["inavAltitudeCm", "raw altitude"],
]);

function mismatch(reason) {
  return { ok: false, reason };
}

function compareInavMetadata(expected, actual, index) {
  for (const [field, label] of INAV_METADATA_FIELDS) {
    const expectedValue = expected?.metadata?.[field];
    const actualValue = actual?.metadata?.[field];
    if (expectedValue == null) {
      return mismatch(
        `Mission item ${index + 1} expected INAV ${label} is missing.`,
      );
    }
    if (actualValue == null) {
      return mismatch(
        `Mission item ${index + 1} read-back INAV ${label} is missing.`,
      );
    }
    if (Number(expectedValue) !== Number(actualValue)) {
      return mismatch(
        `Mission item ${index + 1} INAV ${label} mismatch: expected ` +
          `${expectedValue}, read back ${actualValue}.`,
      );
    }
  }
  return null;
}

function missionNumber(item, primary, fallback) {
  const value = item?.[primary] ?? item?.[fallback];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toleranceOption(options, key, fallback) {
  const value = options?.[key];
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${key} must be a non-negative finite number.`);
  }
  return number;
}

function compareNumericField(
  expected,
  actual,
  index,
  primary,
  fallback,
  tolerance,
  units,
) {
  const expectedValue = missionNumber(expected, primary, fallback);
  if (expectedValue == null) return null;
  const actualValue = missionNumber(actual, primary, fallback);
  if (actualValue == null) {
    return mismatch(
      `Mission item ${index + 1} ${primary} is missing; expected ${expectedValue}.`,
    );
  }
  const difference = Math.abs(expectedValue - actualValue);
  return difference > tolerance
    ? mismatch(
        `Mission item ${index + 1} ${primary} mismatch: expected ` +
          `${expectedValue}, read back ${actualValue} (difference ` +
          `${difference} ${units}, tolerance ${tolerance} ${units}).`,
      )
    : null;
}

export function compareMissionReadback(expected, actual, options = {}) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) {
    throw new TypeError("Expected and read-back missions must both be arrays.");
  }
  if (expected.length !== actual.length) {
    return mismatch(
      `Mission item count mismatch: expected ${expected.length}, ` +
        `read back ${actual.length}.`,
    );
  }
  const coordinateTolerance = toleranceOption(
    options,
    "coordinateToleranceDeg",
    DEFAULT_COORDINATE_TOLERANCE_DEG,
  );
  const altitudeTolerance = toleranceOption(
    options,
    "altitudeToleranceM",
    DEFAULT_ALTITUDE_TOLERANCE_M,
  );
  for (let index = 0; index < expected.length; index += 1) {
    const expectedItem = expected[index];
    const actualItem = actual[index];
    const expectedCommand = missionCommand(expectedItem, MAV_CMD_NAV_WAYPOINT);
    const actualCommand = missionCommand(actualItem);
    if (expectedCommand !== actualCommand) {
      return mismatch(
        `Mission item ${index + 1} command mismatch: expected ` +
          `${expectedCommand}, read back ${actualCommand}.`,
      );
    }
    if (options.compareInavFields) {
      const result = compareInavMetadata(expectedItem, actualItem, index);
      if (result) return result;
    }
    if (options.compareProtocolFields) {
      const expectedFrame = missionNumber(expectedItem, "frame");
      const actualFrame = missionNumber(actualItem, "frame");
      if (expectedFrame != null && expectedFrame !== actualFrame) {
        return mismatch(
          `Mission item ${index + 1} frame mismatch: expected ` +
            `${expectedFrame}, read back ${actualFrame}.`,
        );
      }
      if (
        expectedItem?.autocontinue != null &&
        !!expectedItem.autocontinue !== !!actualItem?.autocontinue
      ) {
        return mismatch(
          `Mission item ${index + 1} autocontinue mismatch: expected ` +
            `${!!expectedItem.autocontinue}, read back ` +
            `${!!actualItem?.autocontinue}.`,
        );
      }
      for (const field of MISSION_PARAMETER_FIELDS) {
        const result = compareNumericField(
          expectedItem,
          actualItem,
          index,
          field,
          null,
          0,
          "parameter units",
        );
        if (result) return result;
      }
    }
    if (expectedCommand === MAV_CMD_NAV_RETURN_TO_LAUNCH) continue;
    for (const [primary, fallback, tolerance, units] of [
      ["latitude", "lat", coordinateTolerance, "deg"],
      ["longitude", "lon", coordinateTolerance, "deg"],
      ["altitude", "alt", altitudeTolerance, "m"],
    ]) {
      const result = compareNumericField(
        expectedItem,
        actualItem,
        index,
        primary,
        fallback,
        tolerance,
        units,
      );
      if (result) return result;
    }
  }
  return { ok: true, reason: "" };
}

export function assertMissionReadback(expected, actual, options = {}) {
  const result = compareMissionReadback(expected, actual, options);
  if (!result.ok) {
    throw new Error(`Mission readback verification failed: ${result.reason}`);
  }
  return result;
}
