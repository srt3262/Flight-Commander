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
