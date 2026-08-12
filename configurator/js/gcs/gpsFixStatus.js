"use strict";

export const GROUND_CONTROL_GPS_FIX_STATES = Object.freeze({
  NO_FIX: Object.freeze({ key: "no-fix", label: "No Fix", hudLabel: "NO FIX" }),
  THREE_D_FIX: Object.freeze({ key: "3d-fix", label: "3D Fix", hudLabel: "3D FIX" }),
  RTK_FLOAT: Object.freeze({ key: "rtk-float", label: "RTK Float", hudLabel: "RTK FLOAT" }),
  RTK_FIX: Object.freeze({ key: "rtk-fix", label: "RTK Fix", hudLabel: "RTK FIX" }),
});

// Flight Commander MSP reports the native firmware gpsFixType_e values:
// 0 no fix, 1 2D, 2 3D, 3 RTK float, and 4 RTK fixed. Ground Control uses
// MAVLink's canonical values internally so MSP and MAVLink render identically.
export function canonicalFlightCommanderMspGpsFix(value) {
  const fix = Number(value);
  if (!Number.isFinite(fix) || fix < 2) return 1;
  if (fix === 2) return 3;
  if (fix === 3) return 5;
  return 6;
}

export function groundControlGpsFixStatus(value) {
  const fix = Number(value);
  if (Number.isFinite(fix) && fix >= 6) {
    return GROUND_CONTROL_GPS_FIX_STATES.RTK_FIX;
  }
  if (fix === 5) {
    return GROUND_CONTROL_GPS_FIX_STATES.RTK_FLOAT;
  }
  if (Number.isFinite(fix) && fix >= 3) {
    return GROUND_CONTROL_GPS_FIX_STATES.THREE_D_FIX;
  }
  return GROUND_CONTROL_GPS_FIX_STATES.NO_FIX;
}

export default groundControlGpsFixStatus;
