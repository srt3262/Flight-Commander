"use strict";

export const INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED =
  "INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED";

export class InavPersistentMissionEraseUnsupportedError extends Error {
  constructor() {
    super(
      "Stock INAV 9.1 cannot save an empty mission to persistent storage. " +
        "The active RAM mission can be cleared over MAVLink, but a stored mission can " +
        "only be replaced with another valid mission.",
    );
    this.name = "InavPersistentMissionEraseUnsupportedError";
    this.code = INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED;
  }
}

export function createInavPersistentMissionEraseUnsupportedError() {
  return new InavPersistentMissionEraseUnsupportedError();
}

export function normalizeInavDownloadedMission(mission) {
  if (!Array.isArray(mission))
    throw new TypeError("INAV mission must be an array.");
  return [...mission];
}
