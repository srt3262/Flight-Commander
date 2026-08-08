const PLATFORM_NAMES = {
  0: "Multirotor",
  1: "Airplane",
  2: "Helicopter",
  3: "Tricopter",
  4: "Rover",
  5: "Boat",
};

const MODE_PRIORITY = [
  "FAILSAFE",
  "NAV RTH",
  "NAV WP",
  "WP PLANNER",
  "NAV LAUNCH",
  "GCS NAV",
  "NAV POSHOLD",
  "NAV CRUISE",
  "NAV COURSE HOLD",
  "NAV ALTHOLD",
  "AUTO TUNE",
  "MANUAL",
  "ANGLE",
  "HORIZON",
  "HEADING HOLD",
  "AIR MODE",
];

function finiteNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeInavGpsFix(value) {
  const fix = finiteNumber(value);
  if (fix === null || fix <= 0) {
    return 1;
  }
  return fix === 1 ? 2 : 3;
}

export function canonicalInavPitch(value) {
  const pitch = finiteNumber(value);
  return pitch === null ? null : -pitch;
}

function scaledNumber(value, divisor) {
  const number = finiteNumber(value);
  return number === null ? null : number / divisor;
}

function activeModeNames(fc) {
  if (
    !Array.isArray(fc?.AUX_CONFIG) ||
    typeof fc?.isModeEnabled !== "function"
  ) {
    return [];
  }
  return fc.AUX_CONFIG.filter((mode) => {
    if (typeof mode !== "string") {
      return false;
    }
    try {
      return Boolean(fc.isModeEnabled(mode));
    } catch {
      return false;
    }
  });
}

function currentModeName(activeModes) {
  return (
    MODE_PRIORITY.find((mode) => activeModes.includes(mode)) ??
    activeModes.find((mode) => !["ARM", "PREARM"].includes(mode)) ??
    "ACRO"
  );
}

function missionCount(missionPlanner) {
  if (!missionPlanner) {
    return 0;
  }
  if (typeof missionPlanner.getCountBusyPoints === "function") {
    try {
      const count = finiteNumber(missionPlanner.getCountBusyPoints());
      if (count !== null) {
        return Math.max(0, Math.trunc(count));
      }
    } catch {
      // Try the less specialized representations below.
    }
  }
  if (typeof missionPlanner.get === "function") {
    try {
      const mission = missionPlanner.get();
      return Array.isArray(mission) ? mission.length : 0;
    } catch {
      return 0;
    }
  }
  return Array.isArray(missionPlanner) ? missionPlanner.length : 0;
}

function waypointForNumber(missionPlanner, number) {
  if (!missionPlanner || !Number.isInteger(number) || number <= 0) {
    return null;
  }
  try {
    if (typeof missionPlanner.getWaypoint === "function") {
      return missionPlanner.getWaypoint(number) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function waypointDistanceMeters(gps, missionPlanner, number) {
  const waypoint = waypointForNumber(missionPlanner, number);
  const latitude = scaledNumber(gps?.lat, 1e7);
  const longitude = scaledNumber(gps?.lon, 1e7);
  const waypointLatitude =
    typeof waypoint?.getLatMap === "function"
      ? finiteNumber(waypoint.getLatMap())
      : null;
  const waypointLongitude =
    typeof waypoint?.getLonMap === "function"
      ? finiteNumber(waypoint.getLonMap())
      : null;
  if (
    latitude === null ||
    longitude === null ||
    waypointLatitude === null ||
    waypointLongitude === null
  ) {
    return null;
  }

  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(waypointLatitude - latitude);
  const longitudeDelta = radians(waypointLongitude - longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude)) *
      Math.cos(radians(waypointLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    6371008.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function connectionState(fc) {
  if (typeof fc?.connected === "boolean") {
    return fc.connected;
  }
  if (typeof fc?.connectionValid === "boolean") {
    return fc.connectionValid;
  }
  const apiVersion = fc?.CONFIG?.apiVersion;
  return (
    typeof apiVersion === "string" &&
    apiVersion.length > 0 &&
    apiVersion !== "0.0.0"
  );
}

function headingDegrees(gps, sensors) {
  const heading = finiteNumber(sensors?.kinematics?.[2]);
  if (heading !== null) {
    return ((heading % 360) + 360) % 360;
  }
  const groundCourse = finiteNumber(gps?.ground_course);
  return groundCourse !== null && groundCourse >= 0 && groundCourse < 3600
    ? groundCourse / 10
    : null;
}

export function normalizeInavTelemetry(fc = {}) {
  const gps = fc.GPS_DATA ?? {};
  const sensors = fc.SENSOR_DATA ?? {};
  const analog = fc.ANALOG ?? {};
  const activeModes = activeModeNames(fc);
  const platformType = finiteNumber(fc.MIXER_CONFIG?.platformType);
  const connected = connectionState(fc);
  const batteryPercentage = finiteNumber(analog.battery_percentage);
  const totalWaypoints = missionCount(fc.MISSION_PLANNER);
  const navigation = fc.NAV_STATUS ?? {};
  const activeWaypointNumber = finiteNumber(navigation.activeWpNumber);
  const missionActive =
    Number(navigation.mode) === 3 || activeModes.includes("NAV WP");
  const missionComplete = Number(navigation.error) === 4;
  const missionCurrent =
    missionActive && activeWaypointNumber !== null && activeWaypointNumber > 0
      ? Math.max(0, Math.trunc(activeWaypointNumber) - 1)
      : null;

  return {
    connected,
    autopilotName: "INAV",
    vehicleTypeName: PLATFORM_NAMES[platformType] ?? "Unknown INAV vehicle",
    armed: activeModes.includes("ARM"),
    modeName: currentModeName(activeModes),
    latitude: scaledNumber(gps.lat, 1e7),
    longitude: scaledNumber(gps.lon, 1e7),
    relativeAltitude: finiteNumber(sensors.altitude),
    altitudeMsl:
      finiteNumber(gps.fix) > 0 ? finiteNumber(gps.alt) : null,
    climbRate: finiteNumber(sensors.verticalSpeed),
    groundSpeed: scaledNumber(gps.speed, 100),
    airSpeed: scaledNumber(sensors.air_speed, 100),
    heading: headingDegrees(gps, sensors),
    roll: finiteNumber(sensors.kinematics?.[0]),
    pitch: canonicalInavPitch(sensors.kinematics?.[1]),
    voltage: finiteNumber(analog.voltage),
    current: finiteNumber(analog.amperage),
    batteryRemaining:
      batteryPercentage !== null &&
      batteryPercentage >= 0 &&
      batteryPercentage <= 100
        ? batteryPercentage
        : null,
    gpsFix: normalizeInavGpsFix(gps.fix),
    satellites: finiteNumber(gps.numSat) ?? 0,
    hdop: gps.hdop === 65535 ? null : scaledNumber(gps.hdop, 100),
    missionActive,
    missionState: missionComplete
      ? 5
      : missionActive
        ? 3
        : totalWaypoints > 0
          ? 2
          : 1,
    missionTotal: totalWaypoints,
    missionCurrent,
    missionReached: missionComplete ? Math.max(0, totalWaypoints - 1) : null,
    distanceToWaypoint:
      missionCurrent === null
        ? null
        : waypointDistanceMeters(
            gps,
            fc.MISSION_PLANNER,
            Math.trunc(activeWaypointNumber),
          ),
    navigationAction: finiteNumber(navigation.activeWpAction),
    navigationError: finiteNumber(navigation.error),
    linkLost: typeof fc.linkLost === "boolean" ? fc.linkLost : false,
  };
}

export default normalizeInavTelemetry;
