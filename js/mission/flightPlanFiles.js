"use strict";

const FORMAT_NAME = "flight-commander-flight-plan";
const FORMAT_VERSION = 1;
const INAV_END_MISSION = 0xa5;
const MAV_CMD_DO_JUMP = 177;
const INAV_RAW_PARAMETER_KEYS = Object.freeze(["inavP1", "inavP2", "inavP3"]);
const INAV_BOUNDARY_METADATA_KEYS = Object.freeze([
  "inavEndMission",
  "inavMultiMissionIndex",
]);

function hasOwn(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function hasMetadataValue(metadata, key) {
  return hasOwn(metadata, key) && metadata[key] != null && metadata[key] !== "";
}

function inavMetadataInteger(metadata, key, itemNumber) {
  if (!hasMetadataValue(metadata, key)) return null;
  const value = Number(metadata[key]);
  if (!Number.isInteger(value)) {
    throw new Error(
      `INAV mission item ${itemNumber} has an invalid ${key} value. ` +
        "Save as a Flight Commander Plan (.flightplan.json) to preserve its raw metadata.",
    );
  }
  return value;
}

function assertQgcWplCanRepresentInavMission(mission) {
  mission.forEach((item, index) => {
    const metadata = item?.metadata;
    if (metadata == null || typeof metadata !== "object") return;
    const itemNumber = index + 1;
    if (
      hasOwn(metadata, "inavAction") &&
      INAV_RAW_PARAMETER_KEYS.some((key) => !hasMetadataValue(metadata, key))
    ) {
      throw new Error(
        `INAV mission item ${itemNumber} contains incomplete raw P1/P2/P3 metadata ` +
          "that QGC WPL cannot preserve. Re-download the mission if necessary, " +
          "then save it as a Flight Commander Plan (.flightplan.json).",
      );
    }
    if (
      hasOwn(metadata, "inavAction") &&
      INAV_BOUNDARY_METADATA_KEYS.some(
        (key) => !hasMetadataValue(metadata, key),
      )
    ) {
      throw new Error(
        `INAV mission item ${itemNumber} is missing raw end or multi-mission ` +
          "boundary metadata that QGC WPL cannot preserve. Re-download the mission " +
          "if necessary, then save it as a Flight Commander Plan (.flightplan.json).",
      );
    }
    const segment = inavMetadataInteger(
      metadata,
      "inavMultiMissionIndex",
      itemNumber,
    );
    if (segment != null && segment !== 0) {
      throw new Error(
        `INAV mission item ${itemNumber} belongs to mission ${segment + 1}. ` +
          "QGC WPL cannot preserve INAV multi-mission boundaries; save as a " +
          "Flight Commander Plan (.flightplan.json) instead.",
      );
    }
    const endFlag = inavMetadataInteger(metadata, "inavEndMission", itemNumber);
    if (endFlag == null) return;
    const expected = index === mission.length - 1 ? INAV_END_MISSION : 0;
    if (endFlag !== expected) {
      const description =
        endFlag === INAV_END_MISSION
          ? "an internal multi-mission boundary"
          : `raw end flag 0x${endFlag.toString(16).toUpperCase()}`;
      throw new Error(
        `INAV mission item ${itemNumber} contains ${description}, which QGC WPL ` +
          "cannot preserve. Save as a Flight Commander Plan (.flightplan.json) instead.",
      );
    }
  });
}

export function serializeFlightPlan(flightPlan) {
  return JSON.stringify(
    {
      format: FORMAT_NAME,
      version: FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      ...flightPlan,
    },
    null,
    2,
  );
}

function parseFlightPlanJson(text) {
  const flightPlan = JSON.parse(text);
  if (
    flightPlan.format !== FORMAT_NAME ||
    flightPlan.version !== FORMAT_VERSION
  ) {
    throw new Error(
      "This is not a supported Flight Commander flight-plan file.",
    );
  }
  if (!Array.isArray(flightPlan.mission)) {
    throw new Error("The flight-plan file does not contain a mission array.");
  }
  return flightPlan;
}

export function serializeQgcWpl(mission) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  assertQgcWplCanRepresentInavMission(mission);
  const rows = ["QGC WPL 110"];
  mission.forEach((item, index) => {
    rows.push(
      [
        index,
        item.current ? 1 : 0,
        item.frame ?? 6,
        item.command ?? 16,
        item.param1 ?? 0,
        item.param2 ?? 0,
        item.param3 ?? 0,
        Number.isFinite(item.param4) ? item.param4 : 0,
        item.latitude ?? item.lat ?? 0,
        item.longitude ?? item.lon ?? 0,
        item.altitude ?? item.alt ?? 0,
        item.autocontinue === false ? 0 : 1,
      ].join("\t"),
    );
  });
  return `${rows.join("\n")}\n`;
}

function parseQgcWpl(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows[0] !== "QGC WPL 110") {
    throw new Error("Only QGC WPL 110 waypoint files are supported.");
  }
  const withSequence = rows.slice(1).map((row, index) => {
    const fields = row.split(/\s+/);
    if (fields.length < 12) {
      throw new Error(`Waypoint row ${index + 1} has fewer than 12 fields.`);
    }
    return {
      sequence: Number(fields[0]),
      current: !!Number(fields[1]),
      frame: Number(fields[2]),
      command: Number(fields[3]),
      param1: Number(fields[4]),
      param2: Number(fields[5]),
      param3: Number(fields[6]),
      param4: Number(fields[7]),
      latitude: Number(fields[8]),
      longitude: Number(fields[9]),
      altitude: Number(fields[10]),
      autocontinue: !!Number(fields[11]),
    };
  });
  if (
    withSequence.some((item) =>
      Object.values(item).some(
        (value) => typeof value === "number" && !Number.isFinite(value),
      ),
    )
  ) {
    throw new Error("The waypoint file contains a non-numeric field.");
  }
  if (
    withSequence.some(
      ({ sequence }) => !Number.isInteger(sequence) || sequence < 0,
    )
  ) {
    throw new Error(
      "QGC waypoint sequence numbers must be non-negative integers.",
    );
  }
  const sequences = withSequence.map(({ sequence }) => sequence);
  if (new Set(sequences).size !== sequences.length) {
    throw new Error(
      "The waypoint file contains duplicate QGC sequence numbers.",
    );
  }
  const sorted = [...withSequence].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (sorted.some(({ sequence }, index) => sequence !== index)) {
    throw new Error(
      "QGC waypoint sequence numbers must form one contiguous range starting at 0.",
    );
  }
  const mission = sorted.map(({ sequence, ...item }) => item);
  mission.forEach((item, index) => {
    if (Number(item.command) !== MAV_CMD_DO_JUMP) return;
    const target = Number(item.param1);
    if (!Number.isInteger(target) || target < 0 || target >= mission.length) {
      throw new Error(
        `Waypoint row ${index + 1} has invalid DO_JUMP target ${item.param1}; ` +
          `the target must be an integer from 0 to ${mission.length - 1}.`,
      );
    }
  });
  return {
    format: "qgc-wpl-110",
    version: 110,
    mission,
    polygon: null,
    settings: {},
  };
}

export function parseFlightPlan(text) {
  const trimmed = String(text).trimStart();
  return trimmed.startsWith("QGC WPL ")
    ? parseQgcWpl(trimmed)
    : parseFlightPlanJson(trimmed);
}
