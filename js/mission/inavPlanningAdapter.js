"use strict";

import FC from "../fc.js";
import MSP from "../msp.js";
import MSPCodes from "../msp/MSPCodes.js";
import mspHelper from "../msp/MSPHelper.js";
import Safehome from "../safehome.js";
import SafehomeCollection from "../safehomeCollection.js";
import { FwApproach } from "../fwApproach.js";
import FwApproachCollection from "../fwApproachCollection.js";
import { Geozone, GeozoneVertex } from "../geozone.js";
import GeozoneCollection from "../geozoneCollection.js";
import {
  INAV_MAX_FW_APPROACHES,
  assertGeozonesValid,
  assertSafehomesAndApproachesValid,
  normalizeInavPlanningData,
} from "./inavPlanningModel.js";

const DEFAULT_TRANSFER_TIMEOUT_MS = 90000;

export function callMspHelper(
  method,
  description,
  timeoutMs = DEFAULT_TRANSFER_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out while ${description}.`));
      }
    }, timeoutMs);
    const complete = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (response?.unsupported) {
        reject(
          new Error(
            `The connected INAV firmware does not support ${description}.`,
          ),
        );
        return;
      }
      resolve(response);
    };
    try {
      method.call(mspHelper, complete);
    } catch (error) {
      clearTimeout(timeout);
      settled = true;
      reject(error);
    }
  });
}

function approachFromFc(approach, slot) {
  return {
    slot,
    approachAltitudeCm: Number(approach?.getApproachAltAsl?.() ?? 0),
    landingAltitudeCm: Number(approach?.getLandAltAsl?.() ?? 0),
    direction: Number(approach?.getApproachDirection?.() ?? 0),
    heading1Deg: Number(approach?.getLandHeading1?.() ?? 0),
    heading2Deg: Number(approach?.getLandHeading2?.() ?? 0),
    seaLevelReference: !!approach?.getIsSeaLevelRef?.(),
  };
}

export function snapshotInavPlanningCollections() {
  const safehomes = (FC.SAFEHOMES?.get?.() ?? []).map((safehome, number) => ({
    number,
    latitude: Number(safehome.getLat()) / 1e7,
    longitude: Number(safehome.getLon()) / 1e7,
  }));
  const approaches = Array.from({ length: INAV_MAX_FW_APPROACHES }, (_, slot) =>
    approachFromFc(FC.FW_APPROACH?.get?.()[slot], slot),
  );
  const geozones = (FC.GEOZONES?.get?.() ?? []).map((geozone, number) => ({
    number,
    type: Number(geozone.getType()),
    shape: Number(geozone.getShape()),
    minAltitudeCm: Number(geozone.getMinAltitude()),
    maxAltitudeCm: Number(geozone.getMaxAltitude()),
    seaLevelReference: !!geozone.getSealevelRef(),
    radiusCm: Number(geozone.getRadius() ?? 0),
    action: Number(geozone.getFenceAction()),
    vertices: geozone.getVertices().map((vertex, vertexNumber) => ({
      number: vertexNumber,
      latitude: Number(vertex.getLat()) / 1e7,
      longitude: Number(vertex.getLon()) / 1e7,
    })),
  }));
  return normalizeInavPlanningData({ safehomes, approaches, geozones });
}

function applySafehomesAndApproachesToFc(planning) {
  const normalized = assertSafehomesAndApproachesValid(planning);
  FC.SAFEHOMES = new SafehomeCollection();
  normalized.safehomes.forEach((safehome, index) => {
    FC.SAFEHOMES.put(
      new Safehome(
        index,
        1,
        Math.round(safehome.latitude * 1e7),
        Math.round(safehome.longitude * 1e7),
      ),
    );
  });
  FC.FW_APPROACH = new FwApproachCollection();
  normalized.approaches.forEach((approach, index) => {
    FC.FW_APPROACH.put(
      new FwApproach(
        index,
        approach.approachAltitudeCm,
        approach.landingAltitudeCm,
        approach.direction,
        approach.heading1Deg,
        approach.heading2Deg,
        approach.seaLevelReference ? 1 : 0,
      ),
    );
  });
  return snapshotInavPlanningCollections();
}

function applyGeozonesToFc(planning) {
  const normalized = assertGeozonesValid(planning);
  FC.GEOZONES = new GeozoneCollection();
  normalized.geozones.forEach((geozone, index) => {
    const vertices = geozone.vertices.map(
      (vertex, vertexIndex) =>
        new GeozoneVertex(
          vertexIndex,
          Math.round(vertex.latitude * 1e7),
          Math.round(vertex.longitude * 1e7),
        ),
    );
    FC.GEOZONES.put(
      new Geozone(
        geozone.type,
        geozone.shape,
        geozone.minAltitudeCm,
        geozone.maxAltitudeCm,
        geozone.seaLevelReference ? 1 : 0,
        geozone.radiusCm,
        geozone.action,
        vertices,
        index,
      ),
    );
  });
  return snapshotInavPlanningCollections();
}

function canonicalSafehomesAndApproaches(planning) {
  const normalized = assertSafehomesAndApproachesValid(planning);
  return {
    safehomes: normalized.safehomes.map((safehome, number) => ({
      number,
      latitude: Math.round(safehome.latitude * 1e7) / 1e7,
      longitude: Math.round(safehome.longitude * 1e7) / 1e7,
    })),
    approaches: normalized.approaches,
  };
}

function canonicalGeozones(planning) {
  return assertGeozonesValid(planning).geozones.map((geozone, number) => ({
    ...geozone,
    number,
    radiusCm: geozone.shape === 0 ? geozone.radiusCm : 0,
    vertices: geozone.vertices.map((vertex, vertexNumber) => ({
      number: vertexNumber,
      latitude: Math.round(vertex.latitude * 1e7) / 1e7,
      longitude: Math.round(vertex.longitude * 1e7) / 1e7,
    })),
  }));
}

function assertEqual(label, expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `${label} readback verification failed. ` +
        "The controller returned different planning data.",
    );
  }
}

export class InavPlanningAdapter {
  async download(options = {}) {
    await callMspHelper(
      mspHelper.loadSafehomes,
      "reading INAV safe homes",
      options.timeoutMs,
    );
    await callMspHelper(
      mspHelper.loadFwApproach,
      "reading INAV fixed-wing landing approaches",
      options.timeoutMs,
    );
    if (options.includeGeozones) {
      await callMspHelper(
        mspHelper.loadGeozones,
        "reading INAV geozones",
        options.timeoutMs,
      );
    }
    return snapshotInavPlanningCollections();
  }

  async uploadSafehomesAndApproaches(planning, options = {}) {
    const expected = canonicalSafehomesAndApproaches(planning);
    applySafehomesAndApproachesToFc(planning);
    await callMspHelper(
      mspHelper.saveSafehomes,
      "writing INAV safe homes",
      options.timeoutMs,
    );
    await callMspHelper(
      mspHelper.saveFwApproach,
      "writing INAV fixed-wing landing approaches",
      options.timeoutMs,
    );
    await callMspHelper(
      mspHelper.saveToEeprom,
      "saving INAV safe homes and landing approaches to EEPROM",
      options.timeoutMs,
    );
    const readback = await this.download({
      includeGeozones: false,
      timeoutMs: options.timeoutMs,
    });
    assertEqual("Safe-home and landing-approach", expected, {
      safehomes: readback.safehomes,
      approaches: readback.approaches,
    });
    return readback;
  }

  async uploadGeozones(planning, options = {}) {
    const expected = canonicalGeozones(planning);
    applyGeozonesToFc(planning);
    await callMspHelper(
      mspHelper.saveGeozones,
      "writing INAV geozones",
      options.timeoutMs,
    );
    await callMspHelper(
      mspHelper.saveToEeprom,
      "saving INAV geozones to EEPROM",
      options.timeoutMs,
    );
    await callMspHelper(
      mspHelper.loadGeozones,
      "reading back INAV geozones",
      options.timeoutMs,
    );
    const readback = snapshotInavPlanningCollections();
    assertEqual("Geozone", expected, readback.geozones);
    return readback;
  }

  async approachLengthCm() {
    try {
      const setting = await mspHelper.getSetting("nav_fw_land_approach_length");
      const value = Number(setting?.value);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  reboot() {
    return new Promise((resolve) => {
      let complete = false;
      const finish = () => {
        if (!complete) {
          complete = true;
          resolve();
        }
      };
      setTimeout(finish, 1500);
      MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, finish);
    });
  }
}

export const inavPlanningAdapter = new InavPlanningAdapter();
