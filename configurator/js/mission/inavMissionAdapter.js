"use strict";

import FC from "../fc.js";
import MSP from "../msp.js";
import MSPCodes from "../msp/MSPCodes.js";
import mspHelper from "../msp/MSPHelper.js";
import Waypoint from "../waypoint.js";
import WaypointCollection from "../waypointCollection.js";
import {
  decodeInavMissionRecords,
  encodeInavMissionItems,
  normalizeMissionForInavMsp,
} from "./inavMissionCodec.js";
import {
  createInavPersistentMissionEraseUnsupportedError,
  normalizeInavDownloadedMission,
} from "./inavMissionModel.js";

export function missionToInavCollection(mission, options = {}) {
  const collection = new WaypointCollection();
  encodeInavMissionItems(mission, options).forEach((record) => {
    collection.put(
      new Waypoint(
        record.number,
        record.action,
        record.latitudeE7,
        record.longitudeE7,
        record.altitudeCm,
        record.p1,
        record.p2,
        record.p3,
        record.endMission,
        true,
        false,
        "",
        record.multiMissionIndex,
      ),
    );
  });
  collection.setCountBusyPoints(collection.get().length);
  return collection;
}

export function inavCollectionToMission(collection) {
  const mission = decodeInavMissionRecords(
    collection.get().map((waypoint) => ({
      number: waypoint.getNumber(),
      action: waypoint.getAction(),
      latitudeE7: waypoint.getLat(),
      longitudeE7: waypoint.getLon(),
      altitudeCm: waypoint.getAlt(),
      p1: waypoint.getP1(),
      p2: waypoint.getP2(),
      p3: waypoint.getP3(),
      endMission: waypoint.getEndMission(),
      multiMissionIndex: waypoint.getMultiMissionIdx?.(),
    })),
  );
  return normalizeInavDownloadedMission(mission);
}

function sendMspCommand(code, payload = false, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`INAV did not respond to MSP command ${code}.`));
      }
    }, timeoutMs);
    MSP.send_message(code, payload, false, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!response || response.unsupported) {
        reject(new Error(`INAV rejected MSP command ${code}.`));
        return;
      }
      resolve(response);
    });
  });
}

export class InavMissionAdapter {
  async download(options = {}) {
    if (options.loadFromEeprom) {
      await sendMspCommand(
        MSPCodes.MSP_WP_MISSION_LOAD,
        [0],
        options.timeoutMs,
      );
    }
    await new Promise((resolve) => mspHelper.loadWaypoints(resolve));
    return inavCollectionToMission(FC.MISSION_PLANNER);
  }

  async upload(mission, options = {}) {
    const collection = missionToInavCollection(mission, options);
    if (collection.get().length === 0) {
      throw new Error(
        "INAV persistent mission storage requires at least one supported mission item.",
      );
    }
    const maximum = FC.MISSION_PLANNER.getMaxWaypoints();
    if (collection.get().length > maximum) {
      throw new Error(`INAV reports a maximum of ${maximum} mission items.`);
    }
    FC.MISSION_PLANNER.reinit();
    FC.MISSION_PLANNER.copy(collection);
    await new Promise((resolve) => mspHelper.saveWaypoints(resolve));
    if (options.saveToEeprom) {
      await sendMspCommand(
        MSPCodes.MSP_WP_MISSION_SAVE,
        [0],
        options.timeoutMs,
      );
      await sendMspCommand(MSPCodes.MSP_EEPROM_WRITE, false, options.timeoutMs);
    }
    return {
      uploaded: collection.get().length,
      omitted: 0,
      normalizedMission: normalizeMissionForInavMsp(mission, options),
    };
  }

  async clear() {
    throw createInavPersistentMissionEraseUnsupportedError();
  }
}

export const inavMissionAdapter = new InavMissionAdapter();
