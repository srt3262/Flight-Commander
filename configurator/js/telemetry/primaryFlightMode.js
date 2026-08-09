"use strict";

export const PRIMARY_FLIGHT_MODES = Object.freeze({
  ACRO: "ACRO",
  ANGLE: "ANGLE",
  ANGLE_ALT_HOLD: "ANGLE/ALT HLD",
  GPS_POSITION_HOLD: "GPS POS HLD",
  RETURN_TO_HOME: "RTH",
  MISSION: "MISSION",
});

const PRIMARY_MODE_NAMES = new Set(Object.values(PRIMARY_FLIGHT_MODES));
const PLANE_TYPES = new Set([1, 19, 20, 21]);

function modeSet(activeModes) {
  return new Set(
    (Array.isArray(activeModes) ? activeModes : [])
      .filter((mode) => typeof mode === "string")
      .map((mode) => mode.trim().toUpperCase()),
  );
}

export function primaryModeFromActiveModes(activeModes = []) {
  const modes = modeSet(activeModes);
  if (modes.has("NAV RTH")) return PRIMARY_FLIGHT_MODES.RETURN_TO_HOME;
  if (modes.has("NAV WP") || modes.has("WP PLANNER")) {
    return PRIMARY_FLIGHT_MODES.MISSION;
  }
  if (modes.has("NAV POSHOLD")) {
    return PRIMARY_FLIGHT_MODES.GPS_POSITION_HOLD;
  }
  if (modes.has("ANGLE") && modes.has("NAV ALTHOLD")) {
    return PRIMARY_FLIGHT_MODES.ANGLE_ALT_HOLD;
  }
  if (modes.has("ANGLE")) return PRIMARY_FLIGHT_MODES.ANGLE;
  return PRIMARY_FLIGHT_MODES.ACRO;
}

export function primaryModeFromMavlink(vehicleType, customMode) {
  const mode = Number(customMode);
  if (!Number.isFinite(mode)) return PRIMARY_FLIGHT_MODES.ACRO;

  if (PLANE_TYPES.has(Number(vehicleType))) {
    switch (mode) {
      case 10:
        return PRIMARY_FLIGHT_MODES.MISSION;
      case 11:
      case 21:
        return PRIMARY_FLIGHT_MODES.RETURN_TO_HOME;
      case 12:
      case 15:
      case 19:
        return PRIMARY_FLIGHT_MODES.GPS_POSITION_HOLD;
      case 6:
      case 18:
        return PRIMARY_FLIGHT_MODES.ANGLE_ALT_HOLD;
      case 2:
      case 5:
      case 17:
        return PRIMARY_FLIGHT_MODES.ANGLE;
      default:
        return PRIMARY_FLIGHT_MODES.ACRO;
    }
  }

  switch (mode) {
    case 0:
      return PRIMARY_FLIGHT_MODES.ANGLE;
    case 2:
      return PRIMARY_FLIGHT_MODES.ANGLE_ALT_HOLD;
    case 3:
      return PRIMARY_FLIGHT_MODES.MISSION;
    case 4:
    case 5:
    case 16:
      return PRIMARY_FLIGHT_MODES.GPS_POSITION_HOLD;
    case 6:
    case 21:
    case 27:
      return PRIMARY_FLIGHT_MODES.RETURN_TO_HOME;
    default:
      return PRIMARY_FLIGHT_MODES.ACRO;
  }
}

export function primaryModeFromName(value) {
  const name = String(value ?? "")
    .trim()
    .toUpperCase();
  if (PRIMARY_MODE_NAMES.has(name)) return name;
  if (["NAV RTH", "RTL", "QRTL", "SMART_RTL"].includes(name)) {
    return PRIMARY_FLIGHT_MODES.RETURN_TO_HOME;
  }
  if (["NAV WP", "WP PLANNER", "AUTO", "WAYPOINTS"].includes(name)) {
    return PRIMARY_FLIGHT_MODES.MISSION;
  }
  if (["NAV POSHOLD", "POSHOLD", "LOITER", "GUIDED", "QLOITER"].includes(name)) {
    return PRIMARY_FLIGHT_MODES.GPS_POSITION_HOLD;
  }
  if (["NAV ALTHOLD", "ALT_HOLD", "FLY_BY_WIRE_B", "QHOVER"].includes(name)) {
    return PRIMARY_FLIGHT_MODES.ANGLE_ALT_HOLD;
  }
  if (["STABILIZE", "FLY_BY_WIRE_A", "QSTABILIZE"].includes(name)) {
    return PRIMARY_FLIGHT_MODES.ANGLE;
  }
  return PRIMARY_FLIGHT_MODES.ACRO;
}

export function primaryModeForDisplay(state = {}, protocol = "") {
  if (!state?.connected) return null;
  if (protocol === "mavlink") {
    return primaryModeFromMavlink(state.vehicleType, state.customMode);
  }
  return primaryModeFromName(state.modeName);
}
