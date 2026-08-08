"use strict";

function coordinate(value, latitude) {
  const number = Number(value);
  const limit = latitude ? 90 : 180;
  if (!Number.isFinite(number) || number < -limit || number > limit) {
    throw new RangeError(`${latitude ? "Latitude" : "Longitude"} is invalid.`);
  }
  const absolute = Math.abs(number);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return {
    value: `${String(degrees).padStart(latitude ? 2 : 3, "0")}${minutes.toFixed(7).padStart(10, "0")}`,
    hemisphere: latitude
      ? (number < 0 ? "S" : "N")
      : (number < 0 ? "W" : "E"),
  };
}

export function nmeaChecksum(value) {
  let checksum = 0;
  for (const character of String(value)) checksum ^= character.charCodeAt(0);
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

export function buildNmeaGga(position = {}, date = new Date()) {
  const latitude = coordinate(position.latitude, true);
  const longitude = coordinate(position.longitude, false);
  const altitudeMsl = Number(position.altitudeMsl ?? 0);
  const geoidSeparation = Number(position.geoidSeparation ?? 0);
  if (!Number.isFinite(altitudeMsl) || !Number.isFinite(geoidSeparation)) {
    throw new RangeError("GGA altitude is invalid.");
  }
  const fixQuality = Math.max(0, Math.min(8, Math.trunc(Number(position.fixQuality ?? 1))));
  const satellites = Math.max(0, Math.min(99, Math.trunc(Number(position.satellites ?? 12))));
  const hdop = Number.isFinite(Number(position.hdop)) ? Number(position.hdop) : 1;
  const utc = `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}.00`;
  const body = [
    "GPGGA",
    utc,
    latitude.value,
    latitude.hemisphere,
    longitude.value,
    longitude.hemisphere,
    fixQuality,
    String(satellites).padStart(2, "0"),
    hdop.toFixed(1),
    altitudeMsl.toFixed(3),
    "M",
    geoidSeparation.toFixed(3),
    "M",
    "",
    "",
  ].join(",");
  return `$${body}*${nmeaChecksum(body)}`;
}
