"use strict";

export const MAV_CMD_DO_JUMP = 177;

function cloneMissionItem(item) {
  return {
    ...item,
    ...(item?.metadata ? { metadata: { ...item.metadata } } : {}),
  };
}

function cloneMission(mission) {
  if (!Array.isArray(mission)) throw new TypeError("Mission must be an array.");
  return mission.map(cloneMissionItem);
}

function jumpTarget(item, index, missionLength) {
  const target = Number(item?.param1);
  if (!Number.isInteger(target) || target < 0 || target >= missionLength) {
    throw new Error(
      `Mission item ${index + 1} has invalid MAVLink DO_JUMP target ${item?.param1}.`,
    );
  }
  return target;
}

export function insertMissionItem(mission, index, item) {
  const result = cloneMission(mission);
  if (!Number.isInteger(index) || index < 0 || index > result.length) {
    throw new RangeError(`Mission insertion index ${index} is out of range.`);
  }
  result.forEach((candidate, candidateIndex) => {
    if (Number(candidate.command) !== MAV_CMD_DO_JUMP) return;
    const target = jumpTarget(candidate, candidateIndex, result.length);
    if (target >= index) candidate.param1 = target + 1;
  });
  result.splice(index, 0, cloneMissionItem(item));
  return result;
}

export function removeMissionItem(mission, index) {
  const result = cloneMission(mission);
  if (!Number.isInteger(index) || index < 0 || index >= result.length) {
    throw new RangeError(`Mission removal index ${index} is out of range.`);
  }
  result.forEach((candidate, candidateIndex) => {
    if (
      candidateIndex === index ||
      Number(candidate.command) !== MAV_CMD_DO_JUMP
    )
      return;
    const target = jumpTarget(candidate, candidateIndex, result.length);
    if (target === index) {
      throw new Error(
        `Mission item ${candidateIndex + 1} DO_JUMP targets item ${index + 1}. Remove or retarget the JUMP before deleting that item.`,
      );
    }
    if (target > index) candidate.param1 = target - 1;
  });
  result.splice(index, 1);
  return result;
}
