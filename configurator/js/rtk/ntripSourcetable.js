"use strict";

function optionalNumber(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseNtripSourcetable(value) {
  const records = [];
  const seen = new Set();
  for (const rawLine of String(value ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("STR;")) continue;
    const fields = line.split(";");
    if (fields.length < 18) continue;
    const mountpoint = fields[1]?.trim();
    if (!mountpoint || seen.has(mountpoint)) continue;
    seen.add(mountpoint);
    records.push(Object.freeze({
      mountpoint,
      identifier: fields[2]?.trim() || mountpoint,
      format: fields[3]?.trim() || "Unknown",
      formatDetails: fields[4]?.trim() || "",
      carrier: optionalNumber(fields[5]),
      navigationSystems: fields[6]?.trim() || "",
      network: fields[7]?.trim() || "",
      country: fields[8]?.trim() || "",
      latitude: optionalNumber(fields[9]),
      longitude: optionalNumber(fields[10]),
      requiresNmea: String(fields[11]).toUpperCase() === "1",
      networkSolution: String(fields[12]).toUpperCase() === "1",
      generator: fields[13]?.trim() || "",
      compression: fields[14]?.trim() || "none",
      authentication: fields[15]?.trim() || "N",
      fee: String(fields[16]).toUpperCase() === "Y",
      bitrate: optionalNumber(fields[17]),
      misc: fields.slice(18).join(";").trim(),
    }));
  }
  return Object.freeze(records);
}

export function mountpointDistanceKm(record, position) {
  if (position?.latitude == null || position?.longitude == null ||
      record?.latitude == null || record?.longitude == null) return null;
  const lat1 = Number(position?.latitude);
  const lon1 = Number(position?.longitude);
  const lat2 = Number(record?.latitude);
  const lon2 = Number(record?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const radians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * radians;
  const deltaLon = (lon2 - lon1) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) *
    Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const F9P_OBSERVATION_MESSAGES = /\b(?:1004|1012|10[789][4-7]|11[12][4-7])\b/;
const F9P_REFERENCE_MESSAGES = /\b100[56]\b/;
const F9P_NAVIGATION_SYSTEMS = /\b(?:GPS|GLO(?:NASS)?|GAL(?:ILEO)?|BDS|BEIDOU|QZSS)\b/i;

export function f9pMountpointCompatibility(record = {}) {
  if (!/RTCM\s*3(?:\b|\.)/i.test(String(record.format ?? ""))) {
    return Object.freeze({
      compatible: false,
      level: "incompatible",
      label: "Not F9P compatible",
      reason: "not RTCM3",
    });
  }
  const compression = String(record.compression ?? "none").trim().toLowerCase();
  if (compression && compression !== "none") {
    return Object.freeze({
      compatible: false,
      level: "incompatible",
      label: "Not F9P compatible",
      reason: `unsupported ${compression} compression`,
    });
  }
  const systems = String(record.navigationSystems ?? "").trim();
  if (systems && !F9P_NAVIGATION_SYSTEMS.test(systems)) {
    return Object.freeze({
      compatible: false,
      level: "incompatible",
      label: "Not F9P compatible",
      reason: "no F9P-supported constellation",
    });
  }
  if (Number(record.carrier) === 1) {
    return Object.freeze({
      compatible: true,
      level: "limited",
      label: "F9P limited",
      reason: "single-frequency corrections",
    });
  }

  const details = String(record.formatDetails ?? "").trim();
  if (!details) {
    return Object.freeze({
      compatible: true,
      level: "unknown",
      label: "F9P compatibility unknown",
      reason: "caster does not publish RTCM message details",
    });
  }
  if (!F9P_REFERENCE_MESSAGES.test(details)) {
    return Object.freeze({
      compatible: false,
      level: "incompatible",
      label: "Not F9P compatible",
      reason: "missing reference-station position message 1005/1006",
    });
  }
  if (!F9P_OBSERVATION_MESSAGES.test(details)) {
    return Object.freeze({
      compatible: false,
      level: "incompatible",
      label: "Not F9P compatible",
      reason: "missing supported observation messages",
    });
  }
  return Object.freeze({
    compatible: true,
    level: "compatible",
    label: "F9P compatible",
    reason: "RTCM3 reference and carrier observations available",
  });
}

export function sortNtripMountpoints(records = [], position = null) {
  return [...records].sort((left, right) => {
    const leftDistance = mountpointDistanceKm(left, position);
    const rightDistance = mountpointDistanceKm(right, position);
    if (leftDistance != null && rightDistance != null) return leftDistance - rightDistance;
    if (leftDistance != null) return -1;
    if (rightDistance != null) return 1;
    return left.mountpoint.localeCompare(right.mountpoint);
  });
}
