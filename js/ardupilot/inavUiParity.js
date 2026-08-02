"use strict";

import { ARDUPILOT_FLIGHT_COMMANDER_PARITY } from "./flightCommanderParity.js";

function binding(key, selector, candidates, options = {}) {
  return Object.freeze({
    key,
    selector,
    candidates: Object.freeze([...candidates]),
    ...options,
  });
}

const percentPresentation = Object.freeze({
  units: "%",
  toDisplay: (value) => Number(value) * 100,
  toNative: (value) => Number(value) / 100,
});

const centidegreePresentation = Object.freeze({
  units: "°",
  toDisplay: (value) => Number(value) / 100,
  toNative: (value) => Number(value) * 100,
});

const gpsRatePresentation = Object.freeze({
  units: "Hz",
  toDisplay: (value) => {
    const milliseconds = Number(value);
    return milliseconds > 0 ? 1000 / milliseconds : 0;
  },
  toNative: (value) => {
    const hertz = Number(value);
    return hertz > 0 ? 1000 / hertz : 0;
  },
});

const DIRECT_PAGE_SCHEMAS = Object.freeze({
  setup: Object.freeze({
    template: "setup",
    bindings: Object.freeze([]),
  }),
  ports: Object.freeze({
    template: "ports",
    bindings: Object.freeze([]),
  }),
  receiver: Object.freeze({
    template: "receiver",
    bindings: Object.freeze([]),
  }),
  modes: Object.freeze({
    template: "auxiliary",
    bindings: Object.freeze([]),
  }),
  pid_tuning: Object.freeze({
    template: "pid_tuning",
    bindings: Object.freeze([]),
  }),
  sensors: Object.freeze({
    template: "sensors",
    bindings: Object.freeze([]),
  }),
  adjustments: Object.freeze({
    template: "adjustments",
    bindings: Object.freeze([]),
  }),
  led_strip: Object.freeze({
    template: "led_strip",
    bindings: Object.freeze([]),
  }),
  tethered_logging: Object.freeze({
    template: "logging",
    bindings: Object.freeze([]),
  }),
  configuration: Object.freeze({
    template: "configuration",
    bindings: Object.freeze([
      binding("rangefinder-type", "#sensor-rangefinder", ["RNGFND1_TYPE", "RNGFND_TYPE"]),
      binding("optical-flow-type", "#sensor-opflow", ["FLOW_TYPE"]),
      binding("battery-monitor", "#vbat_meter_type", ["BATT_MONITOR", "BATT1_MONITOR"]),
      binding("voltage-scale", "#voltagescale", ["BATT_VOLT_MULT", "BATT1_VOLT_MULT"]),
      binding("current-scale", "#currentscale", ["BATT_AMP_PERVLT", "BATT1_AMP_PERVLT"]),
      binding("current-offset", "#currentoffset", ["BATT_AMP_OFFSET", "BATT1_AMP_OFFSET"]),
      binding("battery-capacity", "#battery_capacity", ["BATT_CAPACITY", "BATT1_CAPACITY"]),
    ]),
  }),
  mixer: Object.freeze({
    template: "mixer",
    bindings: Object.freeze([
      binding("frame-class", "#platform-type", ["FRAME_CLASS", "Q_FRAME_CLASS"]),
      binding("frame-type", "#mixer-preset", ["FRAME_TYPE", "Q_FRAME_TYPE"]),
    ]),
  }),
  outputs: Object.freeze({
    template: "outputs",
    bindings: Object.freeze([
      binding("motor-protocol", "#esc-protocol", ["MOT_PWM_TYPE", "Q_M_PWM_TYPE"]),
      binding("servo-rate", "#servo-rate", ["SERVO_RATE"]),
      binding("armed-idle", "#throttle_idle", ["MOT_SPIN_ARM", "Q_M_SPIN_ARM"], {
        presentation: percentPresentation,
      }),
      binding("thrust-expo", "#throttle_scale", ["MOT_THST_EXPO", "Q_M_THST_EXPO"]),
    ]),
  }),
  failsafe: Object.freeze({
    template: "failsafe",
    bindings: Object.freeze([
      binding("receiver-action", "input.procedure[name='group1']", ["FS_THR_ENABLE", "THR_FAILSAFE", "FS_SHORT_ACTN"], {
        kind: "failsafe-action",
      }),
      binding("receiver-threshold", "input[name='failsafe_throttle']", ["FS_THR_VALUE", "THR_FS_VALUE"]),
      binding("fence-radius", "#failsafe_min_distance", ["FENCE_RADIUS"]),
      binding("fence-action", "#failsafe_min_distance_procedure", ["FENCE_ACTION"]),
    ]),
  }),
  gps_navigation: Object.freeze({
    template: "gps",
    bindings: Object.freeze([
      binding("gps-type", "#gps_protocol", ["GPS1_TYPE", "GPS_TYPE"]),
      binding("gps-rate", "#gps_ublox_nav_hz", ["GPS_RATE_MS"], {
        presentation: gpsRatePresentation,
      }),
    ]),
  }),
  advanced_tuning: Object.freeze({
    template: "advanced_tuning",
    bindings: Object.freeze([
      binding("pilot-climb", "#navAutoClimbRate", ["PILOT_SPEED_UP", "PILOT_VELZ_MAX"]),
      binding("pilot-climb-manual", "#navManualClimbRate", ["PILOT_SPEED_UP", "PILOT_VELZ_MAX"]),
      binding("max-bank-angle", "#max-bank-angle", ["ANGLE_MAX", "Q_ANGLE_MAX"], {
        presentation: centidegreePresentation,
      }),
      binding("hover-throttle", "#hover-throttle", ["MOT_THST_HOVER", "Q_M_THST_HOVER"], {
        presentation: Object.freeze({
          units: "µs",
          toDisplay: (value) => 1000 + (Number(value) * 1000),
          toNative: (value) => (Number(value) - 1000) / 1000,
        }),
      }),
      binding("rtl-altitude", "#rthAltitude", ["RTL_ALT", "Q_RTL_ALT"]),
      binding("waypoint-radius", "#waypointRadius", ["WPNAV_RADIUS", "WP_RADIUS"]),
      binding("land-speed-high", "#landMaxAltVspd", ["LAND_SPEED_HIGH", "Q_LAND_SPEED_HIGH"]),
      binding("land-speed", "#landMinAltVspd", ["LAND_SPEED", "Q_LAND_SPEED"]),
      binding("fixed-wing-cruise", "#cruiseSpeed", ["AIRSPEED_CRUISE", "TRIM_ARSPD_CM", "CRUISE_SPEED"]),
      binding("fixed-wing-loiter", "#loiterRadius", ["WP_LOITER_RAD", "LOIT_RADIUS"]),
    ]),
  }),
  magnetometer: Object.freeze({
    template: "magnetometer",
    bindings: Object.freeze([
      binding("board-orientation", "#magalign", ["AHRS_ORIENTATION"]),
      binding("compass-orientation", "#element_to_show", ["COMPASS_ORIENT"]),
    ]),
  }),
  osd: Object.freeze({
    template: "osd",
    bindings: Object.freeze([
      binding("osd-units", "#unit_mode", ["OSD_UNITS"]),
      binding("rssi-warning", "#osd_rssi_alarm", ["OSD_W_RSSI"]),
    ]),
  }),
  logging: Object.freeze({
    template: "onboard_logging",
    bindings: Object.freeze([
      binding("log-backend", "select[name='blackbox_device']", ["LOG_BACKEND_TYPE"]),
    ]),
  }),
  calibration: Object.freeze({
    template: "calibration",
    bindings: Object.freeze([
      binding("flow-scale", "input[name='OpflowScale']", ["FLOW_FXSCALER"]),
    ]),
  }),
});

const PAGE_SCHEMAS = Object.freeze(Object.fromEntries(
  Object.entries(ARDUPILOT_FLIGHT_COMMANDER_PARITY).map(([key, definition]) => [
    key,
    Object.freeze({
      template: definition.template,
      bindings: DIRECT_PAGE_SCHEMAS[key]?.bindings ?? Object.freeze([]),
      groups: definition.groups,
      workflowCovers: definition.workflowCovers,
    }),
  ]),
));

export const ARDUPILOT_INAV_PAGE_SCHEMAS = PAGE_SCHEMAS;

function parameterValues(parameters) {
  if (parameters instanceof Map) return [...parameters.values()];
  return Array.from(parameters ?? []);
}

export function resolveInavUiBinding(parameters, definition) {
  const byId = new Map(parameterValues(parameters).map((parameter) => [
    String(parameter.id ?? "").trim().toUpperCase(),
    parameter,
  ]));
  for (const candidate of definition?.candidates ?? []) {
    const parameter = byId.get(String(candidate).toUpperCase());
    if (parameter) return parameter;
  }
  return null;
}

export function toInavUiValue(definition, nativeValue) {
  return definition?.presentation?.toDisplay
    ? definition.presentation.toDisplay(nativeValue)
    : Number(nativeValue);
}

export function fromInavUiValue(definition, displayValue) {
  return definition?.presentation?.toNative
    ? definition.presentation.toNative(displayValue)
    : Number(displayValue);
}

export function canonicalTemplateNames() {
  return Object.freeze([...new Set(
    Object.values(PAGE_SCHEMAS).map((schema) => schema.template),
  )].sort());
}
