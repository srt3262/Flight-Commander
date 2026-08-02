"use strict";

import MWNP from "../mwnp.js";

export const MAV_CMD_NAV_WAYPOINT = 16;
export const MAV_CMD_NAV_LOITER_UNLIM = 17;
export const MAV_CMD_NAV_LOITER_TIME = 19;
export const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
export const MAV_CMD_NAV_LAND = 21;
export const MAV_CMD_NAV_ROI = 80;
export const MAV_CMD_CONDITION_YAW = 115;
export const MAV_CMD_DO_JUMP = 177;
export const MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206;
export const MAV_FRAME_MISSION = 2;
export const MAV_FRAME_GLOBAL_INT = 5;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
export const INAV_END_MISSION = 0xa5;
export const INAV_MISSION_CONVERSION_ERROR = "INAV_MISSION_CONVERSION_ERROR";
export const INAV_INSERTED_SEGMENT_FIELD = "flightCommanderInavSegmentIndex";

const INAV_ACTION_TO_MAV_CMD = new Map([
  [MWNP.WPTYPE.WAYPOINT, MAV_CMD_NAV_WAYPOINT],
  [MWNP.WPTYPE.POSHOLD_UNLIM, MAV_CMD_NAV_LOITER_UNLIM],
  [MWNP.WPTYPE.POSHOLD_TIME, MAV_CMD_NAV_LOITER_TIME],
  [MWNP.WPTYPE.RTH, MAV_CMD_NAV_RETURN_TO_LAUNCH],
  [MWNP.WPTYPE.SET_POI, MAV_CMD_NAV_ROI],
  [MWNP.WPTYPE.JUMP, MAV_CMD_DO_JUMP],
  [MWNP.WPTYPE.SET_HEAD, MAV_CMD_CONDITION_YAW],
  [MWNP.WPTYPE.LAND, MAV_CMD_NAV_LAND],
  [MWNP.WPTYPE.FLIGHT_COMMANDER_CAMERA_TRIGGER_DISTANCE, MAV_CMD_DO_SET_CAM_TRIGG_DIST],
]);
const MAV_CMD_TO_INAV_ACTION = new Map(
  [...INAV_ACTION_TO_MAV_CMD].map(([action, command]) => [command, action]),
);

export const INAV_MSP_COMMAND_NAMES = Object.freeze({
  [MAV_CMD_NAV_WAYPOINT]: "WAYPOINT",
  [MAV_CMD_NAV_LOITER_UNLIM]: "POSHOLD UNLIMITED",
  [MAV_CMD_NAV_LOITER_TIME]: "POSHOLD TIME",
  [MAV_CMD_NAV_RETURN_TO_LAUNCH]: "RETURN TO HOME",
  [MAV_CMD_NAV_ROI]: "SET POINT OF INTEREST",
  [MAV_CMD_DO_JUMP]: "JUMP",
  [MAV_CMD_CONDITION_YAW]: "SET HEADING",
  [MAV_CMD_NAV_LAND]: "LAND",
  [MAV_CMD_DO_SET_CAM_TRIGG_DIST]: "CAMERA TRIGGER DISTANCE",
});

export const INAV_REQUIRED_RAW_METADATA_FIELDS = Object.freeze([
  "inavAction",
  "inavP1",
  "inavP2",
  "inavP3",
  "inavEndMission",
  "inavMultiMissionIndex",
  "inavNumber",
  "inavLatitudeE7",
  "inavLongitudeE7",
  "inavAltitudeCm",
]);

export const INAV_RAW_METADATA_FIELDS = Object.freeze([
  ...INAV_REQUIRED_RAW_METADATA_FIELDS,
  "inavSegmentItemNumber",
]);

export class InavMissionConversionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InavMissionConversionError";
    this.code = INAV_MISSION_CONVERSION_ERROR;
  }
}

function conversionError(message) {
  return new InavMissionConversionError(message);
}

function finiteInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw conversionError(`${label} must be an integer; received ${value}.`);
  }
  if (number < minimum || number > maximum) {
    throw conversionError(
      `${label} must be between ${minimum} and ${maximum}; received ${number}.`,
    );
  }
  return number;
}

function optionalNumber(value, label) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw conversionError(
      `${label} must be a finite number; received ${value}.`,
    );
  }
  return number;
}

export function commandForInavAction(action, itemNumber = null) {
  const normalized = finiteInteger(
    action,
    itemNumber == null
      ? "INAV mission action"
      : `INAV mission item ${itemNumber} action`,
    0,
    255,
  );
  const command = INAV_ACTION_TO_MAV_CMD.get(normalized);
  if (command == null) {
    throw conversionError(
      `${itemNumber == null ? "INAV mission" : `INAV mission item ${itemNumber}`} uses unsupported action ${normalized}; it will not be converted to a waypoint.`,
    );
  }
  return command;
}

export function actionForMavCommand(command, itemNumber = null) {
  const normalized = Number(command);
  const action = MAV_CMD_TO_INAV_ACTION.get(normalized);
  if (action == null) {
    throw conversionError(
      `${itemNumber == null ? "Mission" : `Mission item ${itemNumber}`} command ${Number.isFinite(normalized) ? normalized : String(command)} cannot be represented by INAV MSP. Remove or replace it before writing the mission.`,
    );
  }
  return action;
}

function hasOwn(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function metadataNumber(metadata, key) {
  return hasOwn(metadata, key)
    ? optionalNumber(metadata[key], `INAV metadata ${key}`)
    : null;
}

function hasAnyInavRawMetadata(metadata) {
  return INAV_RAW_METADATA_FIELDS.some((key) => hasOwn(metadata, key));
}

export function hasInavMissionMetadata(mission) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  return mission.some((item) => hasAnyInavRawMetadata(item?.metadata));
}

export function inavMetadataForInsertedItem(item, additions = {}) {
  const metadata = item?.metadata ?? {};
  const result = { ...metadata };
  const segment = metadataNumber(metadata, "inavMultiMissionIndex");
  for (const field of INAV_RAW_METADATA_FIELDS) delete result[field];
  if (segment != null) {
    result[INAV_INSERTED_SEGMENT_FIELD] = finiteInteger(
      segment,
      "Inserted INAV mission item multi-mission index",
      0,
      255,
    );
  }
  return { ...result, ...additions };
}

function rawCoordinate(value, rawValue, scale, label) {
  const normalized = optionalNumber(value, label);
  const raw = optionalNumber(rawValue, `${label} raw value`);
  if (raw != null) {
    const decoded = raw / scale;
    if (normalized == null || Math.abs(normalized - decoded) <= 0.5 / scale) {
      return finiteInteger(raw, label, -2147483648, 2147483647);
    }
  }
  return normalized == null
    ? 0
    : finiteInteger(
        Math.round(normalized * scale),
        label,
        -2147483648,
        2147483647,
      );
}

function rawAltitude(value, rawValue, label) {
  return rawCoordinate(value, rawValue, 100, label);
}

function parameterValue(item, metadata, sharedKey, rawKey, label) {
  const shared = optionalNumber(item?.[sharedKey], label);
  const raw = metadataNumber(metadata, rawKey);
  if (raw != null && shared != null && shared !== raw) {
    throw conversionError(
      `${label} is ambiguous: the shared mission value is ${shared}, but INAV metadata contains ${raw}.`,
    );
  }
  return finiteInteger(raw ?? shared ?? 0, label, -32768, 32767);
}

function jumpParameterValue(item, metadata, itemNumber) {
  const label = `Mission item ${itemNumber} JUMP target`;
  const shared = optionalNumber(item?.param1, label);
  const raw = metadataNumber(metadata, "inavP1");
  if (raw != null) {
    const target = finiteInteger(raw, `${label} raw INAV value`, 1, 255);
    if (shared != null && shared !== target - 1) {
      throw conversionError(
        `${label} is ambiguous: the shared zero-based sequence is ${shared}, but INAV metadata contains one-based target ${target}.`,
      );
    }
    return target;
  }
  return finiteInteger(shared, `${label} zero-based sequence`, 0, 254) + 1;
}

function photoDistanceParameterValue(item, metadata, itemNumber) {
  const label = `Mission item ${itemNumber} camera trigger distance`;
  const shared = optionalNumber(item?.param1, `${label} in metres`);
  const raw = metadataNumber(metadata, "inavP1");
  const distanceCm = finiteInteger(
    Math.round((shared ?? 0) * 100),
    `${label} in centimetres`,
    0,
    32767,
  );
  if (raw != null && shared != null && raw !== distanceCm) {
    throw conversionError(
      `${label} is ambiguous: the shared value is ${shared} m, but INAV metadata contains ${raw} cm.`,
    );
  }
  return finiteInteger(raw ?? distanceCm, `${label} in centimetres`, 0, 32767);
}

function p3WithAltitudeFrame(item, p3, itemNumber) {
  const frame = optionalNumber(item?.frame, `Mission item ${itemNumber} frame`);
  if (frame == null) return p3;
  if (frame === MAV_FRAME_GLOBAL_INT) return p3 | 1;
  if (frame === MAV_FRAME_GLOBAL_RELATIVE_ALT_INT) return p3 & -2;
  return p3;
}

function validateDecodedRecord(record, index) {
  const number = index + 1;
  return {
    number: finiteInteger(
      record.number ?? number,
      `INAV mission item ${number} number`,
      0,
      255,
    ),
    action: finiteInteger(
      record.action,
      `INAV mission item ${number} action`,
      0,
      255,
    ),
    latitudeE7: finiteInteger(
      record.latitudeE7,
      `INAV mission item ${number} latitude`,
      -2147483648,
      2147483647,
    ),
    longitudeE7: finiteInteger(
      record.longitudeE7,
      `INAV mission item ${number} longitude`,
      -2147483648,
      2147483647,
    ),
    altitudeCm: finiteInteger(
      record.altitudeCm,
      `INAV mission item ${number} altitude`,
      -2147483648,
      2147483647,
    ),
    p1: finiteInteger(
      record.p1,
      `INAV mission item ${number} P1`,
      -32768,
      32767,
    ),
    p2: finiteInteger(
      record.p2,
      `INAV mission item ${number} P2`,
      -32768,
      32767,
    ),
    p3: finiteInteger(
      record.p3,
      `INAV mission item ${number} P3`,
      -32768,
      32767,
    ),
    endMission: finiteInteger(
      record.endMission,
      `INAV mission item ${number} end flag`,
      0,
      255,
    ),
  };
}

export function decodeInavMissionRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("INAV mission records must be an array.");
  }
  let multiMissionIndex = 0;
  let segmentItemNumber = 1;
  return records.map((record, index) => {
    const raw = validateDecodedRecord(record, index);
    const command = commandForInavAction(raw.action, index + 1);
    const photoTrigger =
      raw.action === MWNP.WPTYPE.FLIGHT_COMMANDER_CAMERA_TRIGGER_DISTANCE;
    const param1 =
      photoTrigger
        ? raw.p1 / 100
        : raw.action === MWNP.WPTYPE.JUMP
        ? finiteInteger(
            raw.p1,
            `INAV mission item ${index + 1} JUMP target`,
            1,
            255,
          ) - 1
        : raw.p1;
    const item = {
      frame:
        photoTrigger
          ? MAV_FRAME_MISSION
          : (raw.p3 & 1) !== 0
          ? MAV_FRAME_GLOBAL_INT
          : MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
      command,
      current: false,
      autocontinue: true,
      param1,
      param2: raw.p2,
      param3: raw.p3,
      param4: Number.NaN,
      latitude: raw.latitudeE7 / 1e7,
      longitude: raw.longitudeE7 / 1e7,
      altitude: raw.altitudeCm / 100,
      metadata: {
        inavAction: raw.action,
        inavP1: raw.p1,
        inavP2: raw.p2,
        inavP3: raw.p3,
        inavEndMission: raw.endMission,
        inavMultiMissionIndex: multiMissionIndex,
        inavNumber: raw.number,
        inavSegmentItemNumber: segmentItemNumber,
        inavLatitudeE7: raw.latitudeE7,
        inavLongitudeE7: raw.longitudeE7,
        inavAltitudeCm: raw.altitudeCm,
      },
    };
    if (raw.endMission === INAV_END_MISSION) {
      multiMissionIndex += 1;
      segmentItemNumber = 1;
    } else {
      segmentItemNumber += 1;
    }
    return item;
  });
}

function rejectLegacyLossyMetadata(item, metadata, itemNumber) {
  if (!hasAnyInavRawMetadata(metadata)) return item;
  const missing = INAV_REQUIRED_RAW_METADATA_FIELDS.filter(
    (key) =>
      !hasOwn(metadata, key) || metadata[key] == null || metadata[key] === "",
  );
  if (missing.length === 0) return item;
  throw conversionError(
    `Mission item ${itemNumber} came from an older lossy INAV conversion and does not contain all raw mission values (missing ${missing.join(", ")}). Re-download the mission from the controller before writing it.`,
  );
}

export function encodeInavMissionItems(mission, options = {}) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  const requestedSpeed =
    options.speedCmS != null && options.speedCmS !== ""
      ? Number(options.speedCmS)
      : null;
  const speed =
    requestedSpeed == null || requestedSpeed === 0
      ? null
      : finiteInteger(requestedSpeed, "INAV waypoint speed", 1, 32767);
  let activeMissionIndex = 0;
  const records = mission.map((item, index) => {
    const itemNumber = index + 1;
    const metadata = item?.metadata ?? {};
    rejectLegacyLossyMetadata(item, metadata, itemNumber);
    const action = actionForMavCommand(item?.command, itemNumber);
    const photoTrigger =
      action === MWNP.WPTYPE.FLIGHT_COMMANDER_CAMERA_TRIGGER_DISTANCE;
    if (photoTrigger && !options.allowFlightCommanderPhotoTriggers) {
      throw conversionError(
        `Mission item ${itemNumber} command ${MAV_CMD_DO_SET_CAM_TRIGG_DIST} is a Flight Commander extension. Connect Flight Commander Firmware with photo-trigger capability before writing it.`,
      );
    }
    const rawAction = metadataNumber(metadata, "inavAction");
    if (rawAction != null && rawAction !== action) {
      throw conversionError(
        `Mission item ${itemNumber} command maps to INAV action ${action}, but its metadata contains action ${rawAction}. Re-download or repair the plan before writing it.`,
      );
    }
    const rawNumber = metadataNumber(metadata, "inavNumber");
    if (rawNumber != null && rawNumber !== itemNumber) {
      throw conversionError(
        `Mission item ${itemNumber} contains raw INAV item number ${rawNumber}. Reorder or re-download the plan before writing it; item numbers will not be silently changed.`,
      );
    }
    const p1 =
      photoTrigger
        ? photoDistanceParameterValue(item, metadata, itemNumber)
        : action === MWNP.WPTYPE.WAYPOINT && speed != null
        ? speed
        : action === MWNP.WPTYPE.JUMP
          ? jumpParameterValue(item, metadata, itemNumber)
          : parameterValue(
              item,
              metadata,
              "param1",
              "inavP1",
              `Mission item ${itemNumber} P1`,
            );
    const p2 = parameterValue(
      item,
      metadata,
      "param2",
      "inavP2",
      `Mission item ${itemNumber} P2`,
    );
    const p3Raw = parameterValue(
        item,
        metadata,
        "param3",
        "inavP3",
        `Mission item ${itemNumber} P3`,
    );
    const p3 = photoTrigger ? p3Raw : p3WithAltitudeFrame(item, p3Raw, itemNumber);
    if (photoTrigger && (p2 !== 0 || p3 !== 0)) {
      throw conversionError(
        `Mission item ${itemNumber} camera trigger supports only distance in param1; param2 and param3 must be zero.`,
      );
    }
    const endMission = finiteInteger(
      metadataNumber(metadata, "inavEndMission") ??
        (index === mission.length - 1 ? INAV_END_MISSION : 0),
      `Mission item ${itemNumber} end flag`,
      0,
      255,
    );
    const multiMissionIndex = finiteInteger(
      metadataNumber(metadata, "inavMultiMissionIndex") ?? activeMissionIndex,
      `Mission item ${itemNumber} multi-mission index`,
      0,
      255,
    );
    if (multiMissionIndex !== activeMissionIndex) {
      throw conversionError(
        `Mission item ${itemNumber} has multi-mission index ${multiMissionIndex}, but its end flags place it in mission ${activeMissionIndex}.`,
      );
    }
    const record = {
      number: itemNumber,
      action,
      latitudeE7: photoTrigger ? 0 : rawCoordinate(
        item?.latitude ?? item?.lat,
        metadataNumber(metadata, "inavLatitudeE7"),
        1e7,
        `Mission item ${itemNumber} latitude`,
      ),
      longitudeE7: photoTrigger ? 0 : rawCoordinate(
        item?.longitude ?? item?.lon,
        metadataNumber(metadata, "inavLongitudeE7"),
        1e7,
        `Mission item ${itemNumber} longitude`,
      ),
      altitudeCm: photoTrigger ? 0 : rawAltitude(
        item?.altitude ?? item?.alt,
        metadataNumber(metadata, "inavAltitudeCm"),
        `Mission item ${itemNumber} altitude`,
      ),
      p1,
      p2,
      p3,
      endMission,
      multiMissionIndex,
    };
    if (endMission === INAV_END_MISSION) activeMissionIndex += 1;
    return record;
  });

  records.forEach((record, index) => {
    if (![0, INAV_END_MISSION].includes(record.endMission)) {
      throw conversionError(
        `Mission item ${index + 1} has unsupported INAV end flag 0x${record.endMission.toString(16).toUpperCase()}; only 0 or 0xA5 is valid.`,
      );
    }
  });
  if (records.length && records.at(-1).endMission !== INAV_END_MISSION) {
    throw conversionError(
      "The final INAV mission item must carry end flag 0xA5. Reorder, repair, or re-download the mission before writing it.",
    );
  }

  const segments = new Map();
  for (const record of records) {
    if (!segments.has(record.multiMissionIndex)) {
      segments.set(record.multiMissionIndex, []);
    }
    segments.get(record.multiMissionIndex).push(record);
  }
  for (const [segmentIndex, segment] of segments) {
    segment.forEach((record, index) => {
      if (record.action !== MWNP.WPTYPE.JUMP) return;
      const target =
        finiteInteger(
          record.p1,
          `INAV mission ${segmentIndex + 1} JUMP item ${index + 1} target`,
          1,
          255,
        ) - 1;
      if (index === 0) {
        throw conversionError(
          `INAV mission ${segmentIndex + 1} cannot begin with a JUMP item.`,
        );
      }
      if (target >= segment.length) {
        throw conversionError(
          `INAV mission ${segmentIndex + 1} JUMP item ${index + 1} targets item ${target + 1}, outside its ${segment.length}-item segment.`,
        );
      }
      if (Math.abs(target - index) <= 1) {
        throw conversionError(
          `INAV mission ${segmentIndex + 1} JUMP item ${index + 1} targets itself or an immediately adjacent item (${target + 1}), which INAV rejects.`,
        );
      }
      if (record.p2 < -1) {
        throw conversionError(
          `INAV mission ${segmentIndex + 1} JUMP item ${index + 1} repeat count ${record.p2} is below INAV's minimum of -1.`,
        );
      }
      const targetAction = segment[target].action;
      if (
        ![
          MWNP.WPTYPE.WAYPOINT,
          MWNP.WPTYPE.POSHOLD_TIME,
          MWNP.WPTYPE.LAND,
        ].includes(targetAction)
      ) {
        throw conversionError(
          `INAV mission ${segmentIndex + 1} JUMP item ${index + 1} targets non-geographic action ${targetAction}; target a WAYPOINT, POSHOLD TIME, or LAND item.`,
        );
      }
    });
  }
  return records;
}

export function reindexInavMissionItems(mission) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  const result = mission.map((item) => ({
    ...item,
    metadata: { ...(item?.metadata ?? {}) },
  }));
  if (!hasInavMissionMetadata(result) || !result.length) return result;
  if (result.length > 255) {
    throw conversionError(
      `INAV mission item numbering supports at most 255 items; received ${result.length}.`,
    );
  }

  const identities = new Set();
  result.forEach((item, index) => {
    const metadata = item.metadata;
    rejectLegacyLossyMetadata(item, metadata, index + 1);
    if (!hasOwn(metadata, "inavAction")) return;
    const number = finiteInteger(
      metadataNumber(metadata, "inavNumber"),
      `Mission item ${index + 1} raw INAV item number`,
      1,
      255,
    );
    if (identities.has(number)) {
      throw conversionError(
        `Mission topology contains duplicate raw INAV item number ${number}. Re-download the mission before editing it.`,
      );
    }
    identities.add(number);
  });

  const explicitSegments = result.map((item, index) => {
    const segment =
      metadataNumber(item.metadata, "inavMultiMissionIndex") ??
      optionalNumber(
        item.metadata?.[INAV_INSERTED_SEGMENT_FIELD],
        `Mission item ${index + 1} inserted multi-mission index`,
      );
    return segment == null
      ? null
      : finiteInteger(
          segment,
          `Mission item ${index + 1} multi-mission index`,
          0,
          255,
        );
  });
  const previousSegments = [];
  let previous = null;
  for (let index = 0; index < explicitSegments.length; index += 1) {
    if (explicitSegments[index] != null) previous = explicitSegments[index];
    previousSegments[index] = previous;
  }
  const followingSegments = [];
  let following = null;
  for (let index = explicitSegments.length - 1; index >= 0; index -= 1) {
    if (explicitSegments[index] != null) following = explicitSegments[index];
    followingSegments[index] = following;
  }
  const segmentAssignments = explicitSegments.map((segment, index) => {
    if (segment != null) return segment;
    const before = previousSegments[index];
    const after = followingSegments[index];
    if (before != null && after != null && before !== after) {
      throw conversionError(
        `Mission item ${index + 1} was inserted between INAV missions ${before + 1} and ${after + 1}. Assign it to one mission before writing the plan.`,
      );
    }
    return before ?? after ?? 0;
  });

  const normalizedSegments = new Map();
  const closedSegments = new Set();
  let activeSegment = null;
  for (const segment of segmentAssignments) {
    if (activeSegment === segment) continue;
    if (activeSegment != null) closedSegments.add(activeSegment);
    if (closedSegments.has(segment)) {
      throw conversionError(
        `INAV mission segment ${segment + 1} is split into non-contiguous blocks. Reorder the plan before writing it.`,
      );
    }
    activeSegment = segment;
    if (!normalizedSegments.has(segment)) {
      normalizedSegments.set(segment, normalizedSegments.size);
    }
  }

  const hasJump = result.some(
    (item) => Number(item?.metadata?.inavAction) === MWNP.WPTYPE.JUMP,
  );
  const originalSegmentNumbers = new Map();
  const maximumSegmentNumbers = new Map();
  result.forEach((item, index) => {
    if (!hasOwn(item.metadata, "inavAction")) return;
    const segment = segmentAssignments[index];
    const next = (maximumSegmentNumbers.get(segment) ?? 0) + 1;
    const stored = metadataNumber(item.metadata, "inavSegmentItemNumber");
    if (stored == null && hasJump) {
      throw conversionError(
        `Mission item ${index + 1} lacks the INAV segment-local identity needed to preserve JUMP targets during an edit. Re-download the mission with this Flight Commander version before changing its item order.`,
      );
    }
    const identity =
      stored == null
        ? next
        : finiteInteger(
            stored,
            `Mission item ${index + 1} segment-local number`,
            1,
            255,
          );
    maximumSegmentNumbers.set(
      segment,
      Math.max(maximumSegmentNumbers.get(segment) ?? 0, identity),
    );
    originalSegmentNumbers.set(index, identity);
  });

  const remappedNumbers = new Map();
  const newSegmentNumbers = new Map();
  result.forEach((item, index) => {
    const segment = segmentAssignments[index];
    const next = (newSegmentNumbers.get(segment) ?? 0) + 1;
    newSegmentNumbers.set(segment, next);
    const original = originalSegmentNumbers.get(index);
    if (original != null) remappedNumbers.set(`${segment}:${original}`, next);
  });

  result.forEach((item, index) => {
    const metadata = item.metadata;
    if (
      !hasOwn(metadata, "inavAction") ||
      finiteInteger(
        metadataNumber(metadata, "inavAction"),
        `Mission item ${index + 1} raw INAV action`,
        0,
        255,
      ) !== MWNP.WPTYPE.JUMP
    ) {
      return;
    }
    const rawTarget = finiteInteger(
      metadataNumber(metadata, "inavP1"),
      `Mission item ${index + 1} INAV JUMP target`,
      1,
      255,
    );
    const sharedTarget = optionalNumber(
      item.param1,
      `Mission item ${index + 1} JUMP target`,
    );
    if (sharedTarget != null && sharedTarget !== rawTarget - 1) {
      throw conversionError(
        `Mission item ${index + 1} JUMP target is ambiguous: the shared zero-based sequence is ${sharedTarget}, but INAV metadata contains one-based target ${rawTarget}.`,
      );
    }
    const segment = segmentAssignments[index];
    const target = remappedNumbers.get(`${segment}:${rawTarget}`);
    if (target == null) {
      throw conversionError(
        `Mission item ${index + 1} JUMP targets removed INAV mission ${segment + 1} item ${rawTarget}. Restore the target waypoint or remove the JUMP before writing the mission.`,
      );
    }
    item.param1 = target - 1;
    metadata.inavP1 = target;
  });

  result.forEach((item, index) => {
    const metadata = item.metadata;
    const segment = normalizedSegments.get(segmentAssignments[index]);
    const terminal =
      index === result.length - 1 ||
      normalizedSegments.get(segmentAssignments[index + 1]) !== segment;
    const storedEnd = metadataNumber(metadata, "inavEndMission");
    if (hasOwn(metadata, "inavAction")) {
      metadata.inavNumber = index + 1;
      metadata.inavMultiMissionIndex = segment;
      metadata.inavEndMission = terminal
        ? INAV_END_MISSION
        : storedEnd == null || storedEnd === INAV_END_MISSION
          ? 0
          : finiteInteger(
              storedEnd,
              `Mission item ${index + 1} end flag`,
              0,
              255,
            );
    } else {
      for (const field of INAV_RAW_METADATA_FIELDS) delete metadata[field];
    }
  });

  return decodeInavMissionRecords(encodeInavMissionItems(result, {
    allowFlightCommanderPhotoTriggers: result.some(
      (item) => Number(item?.command) === MAV_CMD_DO_SET_CAM_TRIGG_DIST,
    ),
  })).map(
    (decoded, index) => {
      const metadata = { ...result[index].metadata };
      for (const field of INAV_RAW_METADATA_FIELDS) delete metadata[field];
      delete metadata[INAV_INSERTED_SEGMENT_FIELD];
      return {
        ...result[index],
        ...decoded,
        metadata: { ...metadata, ...decoded.metadata },
      };
    },
  );
}

export function normalizeMissionForInavMsp(mission, options = {}) {
  return decodeInavMissionRecords(encodeInavMissionItems(mission, options));
}
