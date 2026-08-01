"use strict";

const DEFINITIONS = [
  {
    id: "configuration",
    tab: "ardupilot_configuration",
    title: "Vehicle Configuration",
    navigationLabel: "Configuration",
    summary: "Common vehicle behavior and board-level configuration, arranged like INAV’s Configuration page.",
    guidance: "Start with INAV-style setup. ArduPilot extras contain vehicle-specific settings without a safe INAV equivalent, and every control shows the exact native parameter it writes.",
    context: "vehicle configuration",
    patterns: [
      /^(AHRS|PILOT|SYSID|SCHED|BRD_|FORMAT_VERSION|ARMING|ARM_|DISARM|THR_DZ|MANUAL_|FLIGHT_OPTIONS|ANGLE_MAX|ACRO_)/,
    ],
    caution: "Board, arming, and vehicle-behavior changes can prevent arming or alter control response. Verify the explanation for every staged value.",
  },
  {
    id: "outputs",
    tab: "ardupilot_outputs",
    title: "Motors & Outputs",
    navigationLabel: "Motors & Outputs",
    summary: "Motor, servo, relay, and output-protocol settings in one INAV-style page.",
    guidance: "Output functions, limits, rates, and motor options come directly from the connected firmware. Remove propellers before changing or testing outputs.",
    context: "motor and output configuration",
    patterns: [/^(SERVO\d+_|SERVO_|MOT_|MOTOR|DSHOT|RELAY|RPM|RSC_|H_)/],
    caution: "Incorrect output functions, ordering, direction, or limits can cause immediate unsafe motor movement. Remove propellers and verify every output after saving.",
  },
  {
    id: "failsafe",
    tab: "ardupilot_failsafe",
    title: "Safety & Failsafe",
    navigationLabel: "Safety & Failsafe",
    summary: "Arming, radio, battery, geofence, return, landing, and crash-response behavior grouped like INAV Failsafe.",
    guidance: "Read the action and threshold descriptions together. Failsafes can interact, so bench-test loss of RC, telemetry, and power warnings before flight.",
    context: "safety and failsafe behavior",
    patterns: [
      /^(ARMING|ARM_|DISARM|FS_|BATT_FS_|GCS_FS_|RC_FS_|THR_FAILSAFE|FENCE|RTL_|Q_RTL|LAND_|CRASH_|PARACHUTE|BRD_SAFETY|FLIGHT_OPTIONS)/,
    ],
    caution: "A wrong failsafe action or threshold can prevent arming or produce an unsafe response to signal or power loss. Test every configured trigger without propellers.",
  },
  {
    id: "sensors",
    tab: "ardupilot_sensors",
    title: "Sensors & Calibration",
    navigationLabel: "Sensors & Calibration",
    summary: "IMU, compass, barometer, airspeed, rangefinder, proximity, optical-flow, and external-navigation settings.",
    guidance: "This page mirrors INAV’s sensor-oriented setup while retaining ArduPilot’s per-sensor instances and priorities. Calibration commands remain firmware-specific; these controls configure the parameters those procedures use.",
    context: "sensor and calibration configuration",
    patterns: [/^(INS_|COMPASS|BARO|ARSPD|RNGFND|PRX|FLOW|VISO|BEACON|TEMP|IMU|AHRS_)/],
    caution: "Sensor orientation, priority, scale, and calibration values directly affect attitude and navigation. Re-run the applicable calibration and verify health before arming.",
  },
  {
    id: "gps_navigation",
    tab: "ardupilot_gps_navigation",
    title: "GPS & Navigation",
    navigationLabel: "GPS & Navigation",
    summary: "GPS, estimator, loiter, waypoint, avoidance, rally, return, and guided-navigation settings.",
    guidance: "The connected vehicle decides which navigation controls exist. INAV-style setup keeps routine GPS, waypoint, return, and terrain choices visible; ArduPilot extras exposes firmware-specific estimator and controller details.",
    context: "GPS and navigation configuration",
    patterns: [/^(GPS|EK[234F]_|NAV|WP|WPNAV|LOIT|TERR|OA_|AVOID|CIRCLE|RALLY|FOLL|GUIDED|POSCONTROL|FENCE|RTL_)/],
    caution: "Navigation values change position holding, path following, avoidance, and return behavior. Verify GPS/EKF health and test in a clear area.",
  },
  {
    id: "power",
    tab: "ardupilot_power",
    title: "Power & Battery",
    navigationLabel: "Power & Battery",
    summary: "Battery monitors, voltage/current scaling, ESC telemetry, generators, and engine power settings.",
    guidance: "Match monitor type, sensor scaling, capacity, and failsafe thresholds to the installed power system. Live readings should be checked against a trusted meter.",
    context: "power and battery configuration",
    patterns: [/^(BATT|BATTERY|ESC_|GEN_|EFI_|ICE_|PWR|VOLT|CURR)/],
    caution: "Incorrect voltage, current, or capacity calibration makes remaining-power and battery failsafe estimates unreliable. Validate readings before flight.",
  },
  {
    id: "osd",
    tab: "ardupilot_osd",
    title: "OSD & Notifications",
    navigationLabel: "OSD & Notifications",
    summary: "On-screen display elements, screen behavior, annunciators, LEDs, buzzers, and notification preferences.",
    guidance: "ArduPilot names OSD elements by screen and slot. Search by the displayed label or exact parameter to find the item you want.",
    context: "OSD and notification configuration",
    patterns: [/^(OSD|NTF_)/],
    caution: "Confirm that critical warnings, flight mode, battery state, and failsafe indications remain visible after changing the display.",
  },
  {
    id: "logging",
    tab: "ardupilot_logging",
    title: "Logging",
    navigationLabel: "Logging",
    summary: "Onboard log selection, rates, storage behavior, and file-transfer settings in an INAV-like data page.",
    guidance: "Logging helps diagnose tuning, sensor, and failsafe behavior. Higher rates and additional message groups consume more storage and processing time.",
    context: "onboard logging configuration",
    patterns: [/^(LOG_|LOGGING|FILE_)/],
    caution: "Keep enough storage and processing margin for reliable flight control. Verify that a new log is created after changing storage settings.",
  },
];

export const ARDUPILOT_FEATURE_DEFINITIONS = Object.freeze(
  DEFINITIONS.map((definition) => Object.freeze({
    ...definition,
    patterns: Object.freeze([...definition.patterns]),
  })),
);

export function ardupilotFeatureDefinition(id) {
  return ARDUPILOT_FEATURE_DEFINITIONS.find(
    (definition) => definition.id === id || definition.tab === id,
  ) ?? null;
}

export function matchesArduPilotFeatureParameter(definition, id) {
  const normalized = String(id ?? "").trim().toUpperCase();
  return Boolean(
    definition?.patterns?.some((pattern) => pattern.test(normalized)),
  );
}

export function discoverArduPilotFeatureParameters(
  parameters,
  definition,
) {
  return Object.freeze(
    Array.from(parameters ?? [])
      .filter((parameter) => matchesArduPilotFeatureParameter(
        definition,
        parameter.id,
      ))
      .sort((left, right) => left.id.localeCompare(
        right.id,
        undefined,
        { numeric: true },
      )),
  );
}
