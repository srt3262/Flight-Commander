import { canonicalInavPitch } from "./inavTelemetry.js";

function finite(value, divisor = 1) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number / divisor : null;
}

export function normalizeLtmTelemetry(state = {}, isReceiving = false) {
  const missionActive =
    state.flightmodeName === "WAYPOINTS" || Number(state.navigationMode) === 3;
  const activeWaypointNumber = finite(state.activeWaypointNumber);
  const missionCurrent =
    missionActive && activeWaypointNumber > 0
      ? Math.trunc(activeWaypointNumber) - 1
      : null;

  return {
    connected: isReceiving,
    autopilotName: "INAV",
    vehicleTypeName: "LTM telemetry",
    armed: Boolean(state.armed),
    modeName: state.flightmodeName ?? "Unknown",
    latitude: finite(state.latitude, 1e7),
    longitude: finite(state.longitude, 1e7),
    relativeAltitude: finite(state.altitude, 100),
    climbRate: null,
    groundSpeed: finite(state.groundSpeed),
    airSpeed: finite(state.airspeed),
    heading: finite(state.heading),
    roll: finite(state.roll),
    pitch: canonicalInavPitch(state.pitch),
    voltage: finite(state.voltage, 1000),
    current: null,
    consumedMah: finite(state.consumedMah ?? state.currectDrawn),
    batteryRemaining: null,
    gpsFix: finite(state.gpsFix) ?? 0,
    satellites: finite(state.gpsSats) ?? 0,
    hdop: finite(state.hdop, 100),
    missionActive,
    missionState: missionActive ? 3 : 0,
    missionTotal: null,
    missionCurrent,
    missionReached: Number(state.navigationError) === 4 ? missionCurrent : null,
    distanceToWaypoint: null,
    navigationAction: finite(state.navigationAction),
    navigationError: finite(state.navigationError),
    linkLost: !isReceiving,
  };
}

export default normalizeLtmTelemetry;
