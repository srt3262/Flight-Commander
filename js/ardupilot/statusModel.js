"use strict";

export const MAV_SYSTEM_STATUS_NAMES = Object.freeze({
  0: "Uninitialized",
  1: "Booting",
  2: "Calibrating",
  3: "Standby",
  4: "Active",
  5: "Critical",
  6: "Emergency",
  7: "Power off",
  8: "Flight termination",
});

export const MAV_GPS_FIX_NAMES = Object.freeze({
  0: "No GPS",
  1: "No fix",
  2: "2D fix",
  3: "3D fix",
  4: "DGPS",
  5: "RTK float",
  6: "RTK fixed",
  7: "Static",
  8: "PPP",
});

export const MAV_SENSOR_STATUS_DEFINITIONS = Object.freeze([
  Object.freeze({ bit: 0, id: "gyro", label: "Gyroscope" }),
  Object.freeze({ bit: 1, id: "accelerometer", label: "Accelerometer" }),
  Object.freeze({ bit: 2, id: "compass", label: "Compass" }),
  Object.freeze({ bit: 3, id: "barometer", label: "Barometer" }),
  Object.freeze({ bit: 4, id: "airspeed", label: "Airspeed" }),
  Object.freeze({ bit: 5, id: "gps", label: "GPS" }),
  Object.freeze({ bit: 6, id: "optical-flow", label: "Optical flow" }),
  Object.freeze({ bit: 16, id: "receiver", label: "RC receiver" }),
  Object.freeze({ bit: 21, id: "ahrs", label: "AHRS" }),
  Object.freeze({ bit: 24, id: "logging", label: "Logging" }),
  Object.freeze({ bit: 25, id: "battery", label: "Battery monitor" }),
  Object.freeze({ bit: 26, id: "proximity", label: "Proximity" }),
  Object.freeze({ bit: 28, id: "prearm", label: "Pre-arm checks" }),
  Object.freeze({ bit: 29, id: "avoidance", label: "Obstacle avoidance" }),
]);

function maskHasBit(mask, bit) {
  if (mask == null || mask === "") return null;
  const numeric = Number(mask);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric / (2 ** bit)) % 2 === 1;
}

export function ardupilotSensorStatusRows(state = {}) {
  return MAV_SENSOR_STATUS_DEFINITIONS.map((definition) => {
    const present = maskHasBit(state.sensorsPresent, definition.bit);
    const enabled = maskHasBit(state.sensorsEnabled, definition.bit);
    const healthy = maskHasBit(state.sensorsHealthy, definition.bit);
    let status = "unknown";
    let statusLabel = "Waiting for SYS_STATUS";
    if (present === false) {
      status = "unavailable";
      statusLabel = "Not installed";
    } else if (present === true && enabled === false) {
      status = "disabled";
      statusLabel = "Disabled";
    } else if (present === true && enabled === true && healthy === true) {
      status = "healthy";
      statusLabel = "Healthy";
    } else if (present === true && enabled === true && healthy === false) {
      status = "unhealthy";
      statusLabel = "Needs attention";
    }
    return Object.freeze({ ...definition, present, enabled, healthy, status, statusLabel });
  });
}

export function ardupilotSystemStatusName(value) {
  return MAV_SYSTEM_STATUS_NAMES[Number(value)] ?? `State ${value ?? "unknown"}`;
}

export function ardupilotGpsFixName(value) {
  return MAV_GPS_FIX_NAMES[Number(value)] ?? `Fix ${value ?? "unknown"}`;
}

export function ardupilotRssiPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 255
    ? Math.round((numeric / 255) * 100)
    : null;
}

export function formatArduPilotBootTime(timeBootMs) {
  const milliseconds = Number(timeBootMs);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function recentArduPilotReadinessMessages(entries, limit = 8) {
  const relevant = /(?:prearm|pre-arm|arm:|failsafe|ekf|compass|gps|battery|sensor|calibrat)/i;
  const seen = new Set();
  return Array.from(entries ?? [])
    .filter((entry) => relevant.test(String(entry?.text ?? "")))
    .reverse()
    .filter((entry) => {
      const text = String(entry.text).trim();
      if (!text || seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, Math.max(0, Number(limit) || 0))
    .reverse();
}
