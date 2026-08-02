"use strict";

const MIN_USABLE_COORDINATE = 1e-7;

export function isUsableMapCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;

  // MAVLink vehicles can publish GLOBAL_POSITION_INT with the unknown-position
  // sentinel (0, 0) before a receiver has a fix. Treating that as a real
  // aircraft position opens the map at maximum zoom over Null Island, where
  // satellite providers correctly return their "map data not available" tile.
  return Math.abs(lat) > MIN_USABLE_COORDINATE
    || Math.abs(lon) > MIN_USABLE_COORDINATE;
}

export function selectMavlinkMapPosition(state = {}) {
  if (
    Number(state.gpsFix) >= 2
    && isUsableMapCoordinate(state.latitude, state.longitude)
  ) {
    return {
      latitude: Number(state.latitude),
      longitude: Number(state.longitude),
      source: "vehicle",
    };
  }

  if (isUsableMapCoordinate(state.homeLatitude, state.homeLongitude)) {
    return {
      latitude: Number(state.homeLatitude),
      longitude: Number(state.homeLongitude),
      source: "home",
    };
  }

  return null;
}
