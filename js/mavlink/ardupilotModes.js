"use strict";

/**
 * ArduPilot encodes the active flight mode in HEARTBEAT.custom_mode.  The
 * numeric value is vehicle-family specific, so mode lookup must always include
 * MAV_TYPE rather than treating custom_mode as a global enumeration.
 */
export const COPTER_MODES = Object.freeze({
  0: "STABILIZE",
  1: "ACRO",
  2: "ALT_HOLD",
  3: "AUTO",
  4: "GUIDED",
  5: "LOITER",
  6: "RTL",
  7: "CIRCLE",
  9: "LAND",
  11: "DRIFT",
  13: "SPORT",
  14: "FLIP",
  15: "AUTOTUNE",
  16: "POSHOLD",
  17: "BRAKE",
  18: "THROW",
  19: "AVOID_ADSB",
  20: "GUIDED_NOGPS",
  21: "SMART_RTL",
  22: "FLOWHOLD",
  23: "FOLLOW",
  24: "ZIGZAG",
  25: "SYSTEMID",
  26: "AUTOROTATE",
  27: "AUTO_RTL",
  28: "TURTLE",
});

export const PLANE_MODES = Object.freeze({
  0: "MANUAL",
  1: "CIRCLE",
  2: "STABILIZE",
  3: "TRAINING",
  4: "ACRO",
  5: "FLY_BY_WIRE_A",
  6: "FLY_BY_WIRE_B",
  7: "CRUISE",
  8: "AUTOTUNE",
  10: "AUTO",
  11: "RTL",
  12: "LOITER",
  13: "TAKEOFF",
  14: "AVOID_ADSB",
  15: "GUIDED",
  16: "INITIALIZING",
  17: "QSTABILIZE",
  18: "QHOVER",
  19: "QLOITER",
  20: "QLAND",
  21: "QRTL",
  22: "QAUTOTUNE",
  23: "QACRO",
  24: "THERMAL",
  25: "LOITER_ALT_QLAND",
  26: "AUTOLAND",
});

const QUADPLANE_ONLY_MODE_NUMBERS = new Set([17, 18, 19, 20, 21, 22, 23, 25]);

export const FIXED_WING_MODES = Object.freeze(
  Object.fromEntries(
    Object.entries(PLANE_MODES).filter(
      ([number]) => !QUADPLANE_ONLY_MODE_NUMBERS.has(Number(number)),
    ),
  ),
);

export const ROVER_MODES = Object.freeze({
  0: "MANUAL",
  1: "ACRO",
  3: "STEERING",
  4: "HOLD",
  5: "LOITER",
  6: "FOLLOW",
  7: "SIMPLE",
  8: "DOCK",
  9: "CIRCLE",
  10: "AUTO",
  11: "RTL",
  12: "SMART_RTL",
  15: "GUIDED",
  16: "INITIALIZING",
});

export const SUB_MODES = Object.freeze({
  0: "STABILIZE",
  1: "ACRO",
  2: "ALT_HOLD",
  3: "AUTO",
  4: "GUIDED",
  7: "CIRCLE",
  9: "SURFACE",
  16: "POSHOLD",
  19: "MANUAL",
  20: "MOTOR_DETECT",
  21: "SURFTRAK",
});

export const AUTOTUNE_MODE_NAMES = new Set(["AUTOTUNE", "QAUTOTUNE"]);

export const VEHICLE_TYPES = Object.freeze({
  0: "Generic",
  1: "Fixed Wing",
  2: "Quadrotor",
  3: "Coaxial Helicopter",
  4: "Helicopter",
  10: "Ground Rover",
  11: "Surface Boat",
  12: "Submarine",
  13: "Hexarotor",
  14: "Octorotor",
  15: "Tricopter",
  19: "VTOL",
  20: "VTOL Quadrotor",
  21: "VTOL Tiltrotor",
  29: "Dodecarotor",
});

const PLANE_TYPES = new Set([1, 19, 20, 21]);
const ROVER_TYPES = new Set([10, 11]);
const QUADPLANE_TYPES = new Set([19, 20, 21]);

export function vehicleFamily(vehicleType) {
  const type = Number(vehicleType);
  if (PLANE_TYPES.has(type)) return "plane";
  if (ROVER_TYPES.has(type)) return "rover";
  if (type === 12) return "sub";
  return "copter";
}

export function modeMapForVehicle(vehicleType) {
  const type = Number(vehicleType);
  switch (vehicleFamily(type)) {
    case "plane":
      return QUADPLANE_TYPES.has(type) ? PLANE_MODES : FIXED_WING_MODES;
    case "rover":
      return ROVER_MODES;
    case "sub":
      return SUB_MODES;
    default:
      return COPTER_MODES;
  }
}

export function modeName(vehicleType, customMode) {
  return (
    modeMapForVehicle(vehicleType)[Number(customMode)] ?? `MODE_${customMode}`
  );
}

export function modeNumber(vehicleType, name) {
  const wanted = String(name ?? "")
    .trim()
    .toUpperCase();
  const match = Object.entries(modeMapForVehicle(vehicleType)).find(
    ([, candidate]) => candidate === wanted,
  );
  return match ? Number(match[0]) : null;
}

export function autotuneModes(vehicleType) {
  const type = Number(vehicleType);
  const family = vehicleFamily(type);
  if (family === "plane") {
    return QUADPLANE_TYPES.has(type) ? ["AUTOTUNE", "QAUTOTUNE"] : ["AUTOTUNE"];
  }
  return family === "copter" ? ["AUTOTUNE"] : [];
}
