"use strict";

const EARTH_RADIUS_M = 6371008.8;
const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const INAV_MISSION_MODE_NAMES = new Set(["AUTO", "NAV WP", "WAYPOINTS"]);

function radians(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceMeters(left, right) {
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(right.longitude - left.longitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function missionCoordinate(item, index) {
  const command = Number(item?.command ?? MAV_CMD_NAV_WAYPOINT);
  const latitude = Number(item?.latitude ?? item?.lat);
  const longitude = Number(item?.longitude ?? item?.lon);
  if (
    command === MAV_CMD_NAV_RETURN_TO_LAUNCH ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    return null;
  }
  return { index, latitude, longitude };
}

export function estimateInavMissionProgress({
  mission,
  latitude,
  longitude,
  modeName,
  previousIndex = null,
  reachedDistanceM = 30,
} = {}) {
  const items = Array.isArray(mission) ? mission : [];
  const missionActive = INAV_MISSION_MODE_NAMES.has(
    String(modeName ?? "")
      .trim()
      .toUpperCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " "),
  );

  if (
    !missionActive ||
    !items.length ||
    !Number.isFinite(Number(latitude)) ||
    !Number.isFinite(Number(longitude))
  ) {
    return {
      estimated: false,
      missionActive,
      missionCurrent: null,
      missionTotal: items.length,
      distanceToWaypoint: null,
    };
  }

  const vehicle = {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
  const previous = Number(previousIndex);

  if (
    Number.isInteger(previous) &&
    Number(items[previous]?.command) === MAV_CMD_NAV_RETURN_TO_LAUNCH
  ) {
    return {
      estimated: true,
      missionActive: true,
      missionCurrent: previous,
      missionTotal: items.length,
      distanceToWaypoint: null,
    };
  }

  const coordinates = items.map(missionCoordinate).filter(Boolean);
  if (!coordinates.length) {
    return {
      estimated: true,
      missionActive: true,
      missionCurrent: 0,
      missionTotal: items.length,
      distanceToWaypoint: null,
    };
  }

  let position = Number.isInteger(previous)
    ? coordinates.findIndex(({ index }) => index >= previous)
    : -1;
  if (position < 0) {
    position = coordinates
      .map((candidate, index) => ({
        candidate: index,
        distance: distanceMeters(vehicle, candidate),
      }))
      .reduce((best, candidate) =>
        candidate.distance < best.distance ? candidate : best,
      ).candidate;
  }

  while (
    position < coordinates.length - 1 &&
    distanceMeters(vehicle, coordinates[position]) <= reachedDistanceM
  ) {
    position += 1;
  }

  const candidate = coordinates[position];
  let missionCurrent = candidate.index;
  let distanceToWaypoint = distanceMeters(vehicle, candidate);
  if (
    distanceToWaypoint <= reachedDistanceM &&
    position === coordinates.length - 1 &&
    items[candidate.index + 1]?.command === MAV_CMD_NAV_RETURN_TO_LAUNCH
  ) {
    missionCurrent = candidate.index + 1;
    distanceToWaypoint = null;
  }

  return {
    estimated: true,
    missionActive: true,
    missionCurrent,
    missionTotal: items.length,
    distanceToWaypoint,
  };
}
