"use strict";

import { normalizeMissionForInavMsp } from "./inavMissionCodec.js";

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_DO_CHANGE_SPEED = 178;
const MAV_FRAME_MISSION = 2;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
const INAV_MAVLINK_SUPPORTED_COMMAND_SET = new Set([
  MAV_CMD_NAV_WAYPOINT,
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
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
const DEFAULT_SPEED_TOLERANCE_M_S = 0.01;

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
  if (profile == null || profile === "") return null;
  const normalized = String(profile).trim().toLowerCase();
  if (["inav", "inav-mavlink", "inav/mavlink"].includes(normalized)) {
    return "inav";
  }
  if (["ardupilot", "ardupilotmega", "ardu-pilot"].includes(normalized)) {
    return "ardupilot";
  }
  throw new Error(`Unsupported firmware profile "${profile}".`);
}

function validateInavMavlinkRepresentation(mission) {
  mission.forEach((item, index) => {
    const metadata = item?.metadata;
    const rawMetadataKey = Object.keys(metadata ?? {}).find(
      (key) => key.startsWith("inav") || key === INAV_INSERTED_SEGMENT_FIELD,
    );
    if (rawMetadataKey) {
      throw new Error(
        `INAV MAVLink cannot losslessly write mission item ${index + 1} ` +
          `because it contains raw INAV metadata (${rawMetadataKey}). ` +
          "Use wired MSP to preserve the complete mission.",
      );
    }
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    for (const field of MISSION_PARAMETER_FIELDS) {
      const value = item?.[field];
      if (value == null || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number) && number !== 0) {
        throw new Error(
          `INAV MAVLink mission item ${index + 1} command ${command} ` +
            `has nonzero ${field} ${number}, which stock INAV cannot preserve. ` +
            "Set it to zero or use wired MSP.",
        );
      }
    }
    const allowedFrames =
      command === MAV_CMD_NAV_RETURN_TO_LAUNCH
        ? [MAV_FRAME_MISSION]
        : [MAV_FRAME_GLOBAL_RELATIVE_ALT, MAV_FRAME_GLOBAL_RELATIVE_ALT_INT];
    if (
      item?.frame != null &&
      item.frame !== "" &&
      !allowedFrames.includes(Number(item.frame))
    ) {
      throw new Error(
        `INAV MAVLink mission item ${index + 1} command ${command} ` +
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
          `INAV MAVLink mission item ${index + 1} requires ` +
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
  const firmwareProfile = normalizeFirmwareProfile(options);
  if (normalizedProtocol === "msp") {
    return normalizeMissionForInavMsp(mission);
  }
  if (normalizedProtocol === "mavlink" && firmwareProfile !== "inav") {
    return [...mission];
  }
  mission.forEach((item, index) => {
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    if (!INAV_MAVLINK_SUPPORTED_COMMAND_SET.has(command)) {
      throw new Error(
        `INAV MAVLink mission item ${index + 1} uses unsupported ` +
          `command ${command}. Use wired MSP to preserve and write ` +
          "the complete mission.",
      );
    }
  });
  validateInavMavlinkRepresentation(mission);
  return mission.map((item) => {
    const command = missionCommand(item, MAV_CMD_NAV_WAYPOINT);
    return {
      ...item,
      command,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      frame:
        command === MAV_CMD_NAV_RETURN_TO_LAUNCH
          ? MAV_FRAME_MISSION
          : MAV_FRAME_GLOBAL_RELATIVE_ALT,
      autocontinue: true,
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

function compareChangeSpeedParameters(expected, actual, index, options) {
  return (
    compareNumericField(
      expected,
      actual,
      index,
      "param1",
      null,
      0,
      "selector units",
    ) ||
    compareNumericField(
      expected,
      actual,
      index,
      "param2",
      null,
      toleranceOption(
        options,
        "speedToleranceMps",
        DEFAULT_SPEED_TOLERANCE_M_S,
      ),
      "m/s",
    )
  );
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
    if (expectedCommand === MAV_CMD_DO_CHANGE_SPEED) {
      const result = compareChangeSpeedParameters(
        expectedItem,
        actualItem,
        index,
        options,
      );
      if (result) return result;
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
