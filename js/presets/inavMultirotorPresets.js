"use strict";

const ROLL_PITCH_BASELINE = Object.freeze({
  p: 40,
  i: 75,
  d: 23,
  ff: 100,
});

const YAW_BASELINE = Object.freeze({
  p: 45,
  i: 80,
  d: 0,
  ff: 100,
});

export const LARGE_MULTIROTOR_TUNING_PROFILES = Object.freeze([
  Object.freeze({
    title: 'Multirotor with 10" propellers',
    propInches: 10,
    filterHz: 75,
    axisRatio: 110,
    response: 90,
    damping: 120,
    stability: 110,
    aggressiveness: 85,
    rate: 100,
    expo: 100,
    snappiness: 0,
  }),
  Object.freeze({
    title: 'Multirotor with 12" propellers',
    propInches: 12,
    filterHz: 60,
    axisRatio: 110,
    response: 85,
    damping: 125,
    stability: 112,
    aggressiveness: 80,
    rate: 100,
    expo: 100,
    snappiness: 0,
  }),
  Object.freeze({
    title: 'Multirotor with 15" propellers',
    propInches: 15,
    filterHz: 50,
    axisRatio: 110,
    response: 78,
    damping: 130,
    stability: 115,
    aggressiveness: 75,
    rate: 95,
    expo: 105,
    snappiness: 0,
  }),
  Object.freeze({
    title: 'Multirotor with 17" propellers',
    propInches: 17,
    filterHz: 45,
    axisRatio: 110,
    response: 72,
    damping: 135,
    stability: 118,
    aggressiveness: 70,
    rate: 90,
    expo: 110,
    snappiness: 0,
  }),
]);

function firmwareInteger(value) {
  return Math.trunc(value);
}

function yawScale(value) {
  return 1 + ((value - 100) * 0.005);
}

/**
 * Mirrors INAV 9.1's flight/ez_tune.c generator so each preset can show the
 * concrete baseline PIDs that the firmware will derive from its EZ Tune values.
 */
export function deriveInavEzTunePids(profile) {
  const pitchRatio = profile.axisRatio / 100;
  const roll = Object.freeze({
    p: firmwareInteger(ROLL_PITCH_BASELINE.p * profile.response / 100),
    i: firmwareInteger(ROLL_PITCH_BASELINE.i * profile.stability / 100),
    d: firmwareInteger(ROLL_PITCH_BASELINE.d * profile.damping / 100),
    ff: firmwareInteger(ROLL_PITCH_BASELINE.ff * profile.aggressiveness / 100),
  });
  const pitch = Object.freeze({
    p: firmwareInteger(ROLL_PITCH_BASELINE.p * profile.response / 100 * pitchRatio),
    i: firmwareInteger(ROLL_PITCH_BASELINE.i * profile.stability / 100 * pitchRatio),
    d: firmwareInteger(ROLL_PITCH_BASELINE.d * profile.damping / 100 * pitchRatio),
    ff: firmwareInteger(ROLL_PITCH_BASELINE.ff * profile.aggressiveness / 100 * pitchRatio),
  });
  const yaw = Object.freeze({
    p: firmwareInteger(YAW_BASELINE.p * yawScale(profile.response)),
    i: firmwareInteger(YAW_BASELINE.i * yawScale(profile.stability)),
    d: firmwareInteger(YAW_BASELINE.d * yawScale(profile.damping)),
    ff: firmwareInteger(YAW_BASELINE.ff * yawScale(profile.aggressiveness)),
  });
  return Object.freeze({ roll, pitch, yaw });
}

const setting = (key, value) => Object.freeze({ key, value });

function pidTuple(pid) {
  return `${pid.p}/${pid.i}/${pid.d}/${pid.ff}`;
}

export function createLargeMultirotorPreset(profile) {
  const pids = deriveInavEzTunePids(profile);
  return Object.freeze({
    title: profile.title,
    description:
      `INAV 9.1 conservative baseline · ${profile.filterHz} Hz filters · `
      + `generated roll P/I/D/FF ${pidTuple(pids.roll)}`,
    id: profile.propInches,
    propInches: profile.propInches,
    presetFamily: "flight-commander-large-multirotor",
    notRecommended: false,
    reboot: true,
    mixerToApply: 3,
    wizardPages: Object.freeze(["receiver", "gps"]),
    tuning: Object.freeze({ ...profile, pids }),
    settings: Object.freeze([
      setting("model_preview_type", 3),
      setting("gyro_hardware_lpf", "256HZ"),
      setting("motor_pwm_protocol", "DSHOT300"),
      setting("ez_enabled", "ON"),
      setting("ez_filter_hz", profile.filterHz),
      setting("ez_axis_ratio", profile.axisRatio),
      setting("ez_response", profile.response),
      setting("ez_damping", profile.damping),
      setting("ez_stability", profile.stability),
      setting("ez_aggressiveness", profile.aggressiveness),
      setting("ez_rate", profile.rate),
      setting("ez_expo", profile.expo),
      setting("ez_snappiness", profile.snappiness),
      setting("airmode_type", "THROTTLE_THRESHOLD"),
      setting("airmode_throttle_threshold", 1150),
      setting("mc_iterm_relax", "RPY"),
      setting("d_boost_min", 1.0),
      setting("d_boost_max", 1.0),
      setting("antigravity_gain", 2),
      setting("antigravity_accelerator", 5),
      setting("tpa_rate", 20),
      setting("tpa_breakpoint", 1200),
      setting("platform_type", "MULTIROTOR"),
      // `applied_defaults` is an INAV firmware enum. Reuse its supported
      // large-multirotor value rather than writing a Flight Commander-only ID.
      setting("applied_defaults", 5),
      setting("failsafe_procedure", "DROP"),
    ]),
  });
}

export const INAV_LARGE_MULTIROTOR_PRESETS = Object.freeze(
  LARGE_MULTIROTOR_TUNING_PROFILES.map(createLargeMultirotorPreset),
);
