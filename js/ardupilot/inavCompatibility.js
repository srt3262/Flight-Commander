"use strict";

function control(key, label, description, candidates, options = {}) {
  return Object.freeze({
    key,
    label,
    description,
    candidates: Object.freeze([...candidates]),
    ...options,
  });
}

function section(id, label, description, controls) {
  return Object.freeze({
    id,
    label,
    description,
    controls: Object.freeze(controls),
  });
}

const degreesPresentation = Object.freeze({
  units: "°",
  min: 10,
  max: 80,
  increment: 1,
  toDisplay: (value) => Number(value) / 100,
  toNative: (value) => Number(value) * 100,
});

const gpsRatePresentation = Object.freeze({
  units: "Hz",
  min: 1,
  max: 20,
  increment: 1,
  toDisplay: (value) => {
    const milliseconds = Number(value);
    return milliseconds > 0 ? 1000 / milliseconds : 0;
  },
  toNative: (value) => {
    const hertz = Number(value);
    return hertz > 0 ? 1000 / hertz : 0;
  },
});

const DEFINITIONS = Object.freeze({
  configuration: Object.freeze([
    section(
      "airframe",
      "Airframe",
      "Choose the vehicle frame just as you would select a mixer in INAV. Flight Commander writes the matching ArduPilot frame parameters.",
      [
        control("frame-class", "Airframe class", "Select the broad airframe type, such as quad, hexa, octa, or plane-compatible vertical-lift frame.", ["FRAME_CLASS", "Q_FRAME_CLASS"]),
        control("frame-layout", "Airframe layout", "Select the motor geometry within the chosen airframe class, such as X, plus, V, or H.", ["FRAME_TYPE", "Q_FRAME_TYPE"]),
        control("board-orientation", "Flight-controller alignment", "Tell ArduPilot how the controller is rotated relative to the aircraft nose and level plane.", ["AHRS_ORIENTATION"]),
      ],
    ),
    section(
      "handling",
      "Basic handling",
      "Common stick and attitude limits presented as familiar flight-behavior controls.",
      [
        control("angle-limit", "Maximum lean angle", "Limit the roll and pitch angle commanded in stabilized flight modes.", ["ANGLE_MAX", "Q_ANGLE_MAX"], { presentation: degreesPresentation }),
        control("throttle-deadband", "Throttle center deadband", "Set the neutral area around mid throttle used by altitude-hold style modes.", ["THR_DZ"]),
        control("climb-speed", "Pilot climb speed", "Limit the upward speed commanded by the throttle stick in altitude-controlled modes.", ["PILOT_SPEED_UP", "PILOT_VELZ_MAX"]),
        control("descent-speed", "Pilot descent speed", "Limit the downward speed commanded by the throttle stick in altitude-controlled modes.", ["PILOT_SPEED_DN"]),
        control("vertical-accel", "Vertical acceleration", "Control how quickly altitude-controlled modes ramp between climb and descent speeds.", ["PILOT_ACCEL_Z"]),
      ],
    ),
    section(
      "arming",
      "Arming & identity",
      "Routine arming safeguards and vehicle identity. Keep the arming checks enabled unless a documented diagnostic procedure requires otherwise.",
      [
        control("arming-checks", "Arming checks", "Choose which pre-arm safety checks must pass before motors or outputs can arm.", ["ARMING_CHECK"]),
        control("rudder-arming", "Arm/disarm with yaw stick", "Choose whether the yaw stick may arm, disarm, do both, or neither.", ["ARMING_RUDDER"]),
        control("disarm-delay", "Automatic disarm delay", "Set how long the vehicle waits before automatically disarming after landing.", ["DISARM_DELAY"]),
        control("arming-options", "Additional arming behavior", "Select optional arming and disarming behaviors exposed by the installed firmware.", ["ARMING_OPTIONS"]),
        control("system-id", "MAVLink vehicle ID", "Set the MAVLink system number used to identify this aircraft to ground stations and companion computers.", ["SYSID_THISMAV", "MAV_SYSID"]),
      ],
    ),
  ]),
  outputs: Object.freeze([
    section(
      "motor-protocol",
      "Motor protocol & idle",
      "Configure the equivalent of INAV's motor protocol and idle controls using ArduPilot's motor-output parameters.",
      [
        control("motor-protocol", "ESC / motor protocol", "Select the PWM, OneShot, brushed, or DShot output protocol supported by this vehicle and controller.", ["MOT_PWM_TYPE", "Q_M_PWM_TYPE"]),
        control("pwm-min", "Minimum motor pulse", "Set the minimum PWM pulse sent to motor outputs when the selected protocol uses pulse widths.", ["MOT_PWM_MIN", "Q_M_PWM_MIN"]),
        control("pwm-max", "Maximum motor pulse", "Set the maximum PWM pulse sent to motor outputs when the selected protocol uses pulse widths.", ["MOT_PWM_MAX", "Q_M_PWM_MAX"]),
        control("spin-armed", "Armed idle output", "Set the motor output used while armed at zero throttle.", ["MOT_SPIN_ARM", "Q_M_SPIN_ARM"]),
        control("spin-min", "Minimum running output", "Set the lowest output used once motors are commanded to run.", ["MOT_SPIN_MIN", "Q_M_SPIN_MIN"]),
        control("thrust-expo", "Thrust linearization", "Compensate for the nonlinear relationship between motor command and produced thrust.", ["MOT_THST_EXPO", "Q_M_THST_EXPO"]),
        control("servo-rate", "Servo refresh rate", "Set the default update rate for conventional servo outputs.", ["SERVO_RATE"]),
      ],
    ),
    section(
      "output-assignment",
      "Output assignment",
      "Assign a function to each physical output. These rows map directly to ArduPilot SERVO output functions.",
      [
        control("servo-functions", "Output {channel} function", "Choose which motor, control surface, camera, relay, or accessory function is sent to this output.", [], {
          candidatePattern: /^SERVO(\d+)_FUNCTION$/,
          labelMatchGroup: 1,
        }),
      ],
    ),
    section(
      "output-safety",
      "Output safety",
      "Control which outputs remain inhibited by the board safety switch and how output voltage compensation behaves.",
      [
        control("safety-mask", "Safety-switch output mask", "Choose which outputs may operate while the hardware safety switch is active.", ["BRD_SAFETY_MASK"]),
        control("battery-min", "Motor compensation minimum voltage", "Set the low battery voltage used by motor thrust compensation.", ["MOT_BAT_VOLT_MIN", "Q_M_BAT_VOLT_MIN"]),
        control("battery-max", "Motor compensation maximum voltage", "Set the full battery voltage used by motor thrust compensation.", ["MOT_BAT_VOLT_MAX", "Q_M_BAT_VOLT_MAX"]),
      ],
    ),
  ]),
  failsafe: Object.freeze([
    section(
      "radio-failsafe",
      "Receiver failsafe",
      "Configure signal-loss detection and the action ArduPilot takes, matching INAV's receiver failsafe workflow.",
      [
        control("radio-action", "Receiver-loss action", "Choose what the vehicle does when the receiver signal is lost or throttle falls below the failsafe threshold.", ["FS_THR_ENABLE", "THR_FAILSAFE", "FS_SHORT_ACTN"]),
        control("radio-threshold", "Receiver-loss threshold", "Set the throttle PWM value below which a receiver loss is recognized when threshold detection is used.", ["FS_THR_VALUE", "THR_FS_VALUE"]),
        control("long-action", "Extended signal-loss action", "Choose the action used after a longer radio failsafe on firmware that separates short and long events.", ["FS_LONG_ACTN"]),
        control("gcs-action", "Ground-station link-loss action", "Choose whether and how loss of the MAVLink ground-station heartbeat triggers a failsafe.", ["FS_GCS_ENABLE", "GCS_FS_ENABLE"]),
      ],
    ),
    section(
      "battery-failsafe",
      "Battery failsafe",
      "Set warning thresholds and actions for low and critical battery states.",
      [
        control("low-voltage", "Low battery voltage", "Set the pack voltage that triggers the low-battery condition after the configured delay.", ["BATT_LOW_VOLT", "BATT1_LOW_VOLT"]),
        control("critical-voltage", "Critical battery voltage", "Set the pack voltage that triggers the critical-battery condition.", ["BATT_CRT_VOLT", "BATT1_CRT_VOLT"]),
        control("low-capacity", "Low remaining capacity", "Set the estimated remaining capacity that triggers the low-battery condition.", ["BATT_LOW_MAH", "BATT1_LOW_MAH"]),
        control("critical-capacity", "Critical remaining capacity", "Set the estimated remaining capacity that triggers the critical-battery condition.", ["BATT_CRT_MAH", "BATT1_CRT_MAH"]),
        control("low-action", "Low battery action", "Choose what the aircraft does when the low-battery condition is sustained.", ["BATT_FS_LOW_ACT", "BATT1_FS_LOW_ACT"]),
        control("critical-action", "Critical battery action", "Choose the stronger response used for a critical battery condition.", ["BATT_FS_CRT_ACT", "BATT1_FS_CRT_ACT"]),
      ],
    ),
    section(
      "return-land",
      "Return & landing",
      "Define the return altitude and final landing behavior used by failsafe actions.",
      [
        control("rtl-altitude", "Return-to-home altitude", "Set the target return altitude, subject to the installed firmware's climb and terrain rules.", ["RTL_ALT", "Q_RTL_ALT"]),
        control("rtl-speed", "Return speed", "Set the horizontal speed used during return-to-home where the vehicle firmware supports it.", ["RTL_SPEED", "WPNAV_SPEED"]),
        control("rtl-final-altitude", "Return final altitude", "Set the altitude at which the vehicle stops or begins its final landing phase above home.", ["RTL_ALT_FINAL"]),
        control("land-speed", "Landing speed", "Set the final vertical descent speed during automatic landing.", ["LAND_SPEED", "Q_LAND_SPEED"]),
      ],
    ),
    section(
      "geofence",
      "Geofence",
      "Create a last-resort boundary and define how the vehicle responds when it is crossed.",
      [
        control("fence-enable", "Enable geofence", "Enable the configured altitude, radius, polygon, or combined geofence types.", ["FENCE_ENABLE"]),
        control("fence-type", "Geofence boundaries", "Choose which boundary types are enforced by the geofence system.", ["FENCE_TYPE"]),
        control("fence-action", "Geofence breach action", "Choose the action taken when the vehicle crosses an enabled fence.", ["FENCE_ACTION"]),
        control("fence-altitude", "Maximum fence altitude", "Set the maximum allowed altitude for the altitude fence.", ["FENCE_ALT_MAX"]),
        control("fence-radius", "Maximum fence radius", "Set the maximum horizontal distance from home for the circular fence.", ["FENCE_RADIUS"]),
      ],
    ),
  ]),
  sensors: Object.freeze([
    section(
      "imu",
      "Gyroscope & accelerometer",
      "Choose sensor bandwidth and calibration behavior using the same concepts exposed by INAV's sensor and filter pages.",
      [
        control("gyro-filter", "Gyroscope low-pass filter", "Set the primary gyro low-pass cutoff. Lower values reject more vibration but add delay.", ["INS_GYRO_FILTER"]),
        control("accel-filter", "Accelerometer low-pass filter", "Set the accelerometer low-pass cutoff used by the attitude and navigation estimators.", ["INS_ACCEL_FILTER"]),
        control("gyro-calibration", "Gyroscope calibration", "Choose when ArduPilot performs gyro calibration during startup.", ["INS_GYR_CAL"]),
      ],
    ),
    section(
      "compass-baro",
      "Compass & barometer",
      "Enable, orient, and prioritize the heading and pressure sensors needed by the vehicle.",
      [
        control("compass-use", "Use compass", "Enable or disable the primary compass for heading estimation.", ["COMPASS_USE"]),
        control("compass-orientation", "Compass alignment", "Tell ArduPilot how the primary compass is rotated relative to the vehicle.", ["COMPASS_ORIENT"]),
        control("compass-external", "External compass", "Mark whether the primary compass is external to the flight controller.", ["COMPASS_EXTERN"]),
        control("primary-baro", "Primary barometer", "Select the preferred barometer instance when multiple pressure sensors are available.", ["BARO_PRIMARY"]),
      ],
    ),
    section(
      "external-sensors",
      "External sensors",
      "Enable optional airspeed, range, optical-flow, and proximity devices only when they are installed and oriented correctly.",
      [
        control("airspeed-use", "Use airspeed sensor", "Choose whether airspeed measurements participate in flight control and estimation.", ["ARSPD_USE"]),
        control("airspeed-type", "Airspeed sensor type", "Select the installed airspeed sensor or driver.", ["ARSPD_TYPE"]),
        control("rangefinder-type", "Rangefinder type", "Select the driver for the first downward, forward, or terrain range sensor.", ["RNGFND1_TYPE", "RNGFND_TYPE"]),
        control("optical-flow-type", "Optical-flow type", "Select the installed optical-flow sensor used for position estimation.", ["FLOW_TYPE"]),
        control("proximity-type", "Proximity sensor type", "Select the installed proximity sensor used for obstacle awareness.", ["PRX1_TYPE", "PRX_TYPE"]),
      ],
    ),
  ]),
  gps_navigation: Object.freeze([
    section(
      "gps",
      "GPS receiver",
      "Configure the primary navigation receiver in the same place you would configure GPS in INAV.",
      [
        control("gps-type", "GPS receiver type", "Select the driver for the primary GPS receiver, or allow supported automatic detection.", ["GPS1_TYPE", "GPS_TYPE"]),
        control("gps-auto-config", "Automatic GPS configuration", "Allow ArduPilot to configure the receiver's baud rate, messages, and navigation settings.", ["GPS_AUTO_CONFIG"]),
        control("gps-rate", "GPS update rate", "Set how often navigation fixes are requested from the primary receiver.", ["GPS_RATE_MS"], { presentation: gpsRatePresentation }),
        control("gnss-constellations", "GNSS constellations", "Choose which satellite constellations the primary receiver should use when supported.", ["GPS_GNSS_MODE"]),
        control("auto-switch", "Multiple-GPS switching", "Choose how ArduPilot selects or blends multiple GPS receivers.", ["GPS_AUTO_SWITCH"]),
      ],
    ),
    section(
      "navigation",
      "Waypoint navigation",
      "Set the familiar speed, acceleration, radius, and loiter behavior used by automated missions.",
      [
        control("nav-speed", "Navigation speed", "Set the normal horizontal target speed for waypoint flight or cruise navigation.", ["WPNAV_SPEED", "WP_SPEED", "CRUISE_SPEED"]),
        control("nav-climb", "Navigation climb speed", "Set the maximum upward speed during automatic navigation.", ["WPNAV_SPEED_UP", "TECS_CLMB_MAX"]),
        control("nav-descent", "Navigation descent speed", "Set the maximum downward speed during automatic navigation.", ["WPNAV_SPEED_DN", "TECS_SINK_MAX"]),
        control("nav-accel", "Navigation acceleration", "Set how quickly automatic navigation changes horizontal speed.", ["WPNAV_ACCEL", "ATC_ACCEL_MAX"]),
        control("waypoint-radius", "Waypoint acceptance radius", "Set how close the vehicle should pass to a waypoint before advancing to the next mission item.", ["WPNAV_RADIUS", "WP_RADIUS"]),
        control("loiter-radius", "Loiter radius", "Set the default circle radius for loiter commands on vehicles that circle rather than hold a point.", ["WP_LOITER_RAD", "LOIT_RADIUS"]),
      ],
    ),
    section(
      "return-terrain",
      "Return & terrain",
      "Configure return-to-home and terrain following without exposing estimator internals unnecessarily.",
      [
        control("rtl-altitude", "Return-to-home altitude", "Set the target altitude used during return-to-home.", ["RTL_ALT", "Q_RTL_ALT"]),
        control("rtl-speed", "Return speed", "Set the horizontal return-to-home speed where supported.", ["RTL_SPEED"]),
        control("rtl-loiter", "Return loiter time", "Set how long the vehicle waits above home before continuing its return or landing sequence.", ["RTL_LOIT_TIME"]),
        control("terrain-follow", "Terrain following", "Choose whether compatible navigation modes use terrain height data.", ["WPNAV_RFND_USE", "TERRAIN_FOLLOW"]),
        control("terrain-enable", "Terrain data", "Enable terrain database use for altitude planning and navigation.", ["TERRAIN_ENABLE"]),
      ],
    ),
  ]),
  power: Object.freeze([
    section(
      "battery-monitor",
      "Battery monitor",
      "Select and calibrate the power sensor, matching INAV's voltage and current sensor setup.",
      [
        control("monitor-type", "Battery monitor type", "Select the analog, digital, ESC-telemetry, fuel-level, or smart-battery monitor in use.", ["BATT_MONITOR", "BATT1_MONITOR"]),
        control("capacity", "Battery capacity", "Enter the usable battery capacity used to estimate consumed and remaining energy.", ["BATT_CAPACITY", "BATT1_CAPACITY"]),
        control("voltage-scale", "Voltage scale", "Calibrate reported voltage against a trusted meter.", ["BATT_VOLT_MULT", "BATT1_VOLT_MULT"]),
        control("current-scale", "Current scale", "Calibrate reported current against a trusted meter or known load.", ["BATT_AMP_PERVLT", "BATT1_AMP_PERVLT"]),
        control("current-offset", "Current offset", "Remove the current-sensor reading present when actual current is zero.", ["BATT_AMP_OFFSET", "BATT1_AMP_OFFSET"]),
      ],
    ),
    section(
      "battery-thresholds",
      "Battery warnings",
      "Set the warning points shown to the pilot. Failsafe actions are configured on Safety & Failsafe.",
      [
        control("arm-voltage", "Minimum arming voltage", "Prevent arming when battery voltage is below this level.", ["BATT_ARM_VOLT", "BATT1_ARM_VOLT"]),
        control("low-voltage", "Low battery voltage", "Set the low-battery warning voltage.", ["BATT_LOW_VOLT", "BATT1_LOW_VOLT"]),
        control("critical-voltage", "Critical battery voltage", "Set the critical-battery warning voltage.", ["BATT_CRT_VOLT", "BATT1_CRT_VOLT"]),
        control("low-capacity", "Low remaining capacity", "Set the estimated remaining-capacity threshold for a low battery.", ["BATT_LOW_MAH", "BATT1_LOW_MAH"]),
        control("critical-capacity", "Critical remaining capacity", "Set the estimated remaining-capacity threshold for a critical battery.", ["BATT_CRT_MAH", "BATT1_CRT_MAH"]),
      ],
    ),
  ]),
  osd: Object.freeze([
    section(
      "osd-general",
      "OSD setup",
      "Enable the display and select global behavior before arranging individual elements in ArduPilot extras.",
      [
        control("osd-type", "OSD hardware type", "Select the analog or display-port OSD backend supported by the controller.", ["OSD_TYPE"]),
        control("screen-enable", "Enable primary screen", "Enable the first OSD screen.", ["OSD1_ENABLE"]),
        control("osd-units", "OSD units", "Choose the units shown on the flight display independently of Flight Commander's setup display.", ["OSD_UNITS"]),
        control("osd-options", "OSD behavior", "Select global OSD display and switching options.", ["OSD_OPTIONS"]),
      ],
    ),
    section(
      "warnings",
      "Warnings & notifications",
      "Keep critical receiver, battery, and navigation warnings visible and audible.",
      [
        control("rssi-warning", "Low signal warning", "Set the receiver-signal level that triggers an OSD warning.", ["OSD_W_RSSI"]),
        control("battery-warning", "Low voltage warning", "Set the voltage that triggers an OSD battery warning.", ["OSD_W_BAT_VOLT"]),
        control("satellite-warning", "Low satellite warning", "Set the satellite-count threshold that triggers an OSD GPS warning.", ["OSD_W_NSAT"]),
        control("led-types", "Notification LEDs", "Choose which notification events are shown through compatible LEDs.", ["NTF_LED_TYPES"]),
        control("buzzer-types", "Buzzer notifications", "Choose which notification events are announced by the buzzer.", ["NTF_BUZZ_TYPES"]),
      ],
    ),
  ]),
  logging: Object.freeze([
    section(
      "logging-general",
      "Blackbox-style logging",
      "Configure ArduPilot onboard logs using the same intent as INAV's Blackbox page.",
      [
        control("backend", "Logging destination", "Choose the onboard file, MAVLink telemetry, or other logging backends supported by the controller.", ["LOG_BACKEND_TYPE"]),
        control("log-while-disarmed", "Log while disarmed", "Choose whether a log is recorded before the vehicle is armed.", ["LOG_DISARMED"]),
        control("log-content", "Logged message groups", "Choose which sensor, control, navigation, and diagnostic message groups are recorded.", ["LOG_BITMASK"]),
        control("file-buffer", "Onboard log buffer", "Set the memory buffer reserved for writing onboard log files.", ["LOG_FILE_BUFSIZE"]),
        control("telemetry-buffer", "Telemetry log buffer", "Set the memory buffer reserved for streaming logs over MAVLink.", ["LOG_MAV_BUFSIZE"]),
      ],
    ),
  ]),
});

export const ARDUPILOT_INAV_COMPATIBILITY = DEFINITIONS;

function parameterValues(parameters) {
  if (parameters instanceof Map) return [...parameters.values()];
  return Array.from(parameters ?? []);
}

function resolvedLabel(definition, match) {
  if (!definition.candidatePattern) return definition.label;
  const group = match.match(definition.candidatePattern)?.[definition.labelMatchGroup ?? 1];
  return definition.label.replace("{channel}", group ?? "?");
}

function matchesForControl(definition, parametersById, allParameters) {
  for (const candidate of definition.candidates) {
    const parameter = parametersById.get(String(candidate).toUpperCase());
    if (parameter) return [parameter];
  }
  if (definition.candidatePattern) {
    return allParameters.filter((parameter) => definition.candidatePattern.test(parameter.id));
  }
  return [];
}

export function discoverInavCompatibleControls(
  parameters,
  featureId,
  metadata = new Map(),
) {
  const allParameters = parameterValues(parameters)
    .map((parameter) => ({
      ...parameter,
      id: String(parameter.id ?? "").trim().toUpperCase(),
    }))
    .filter((parameter) => parameter.id)
    .sort((left, right) => left.id.localeCompare(
      right.id,
      undefined,
      { numeric: true },
    ));
  const parametersById = new Map(allParameters.map((parameter) => [parameter.id, parameter]));
  const matchedParameterIds = new Set();
  const sections = [];

  for (const definition of DEFINITIONS[featureId] ?? []) {
    const controls = [];
    for (const compatibility of definition.controls) {
      for (const parameter of matchesForControl(compatibility, parametersById, allParameters)) {
        if (matchedParameterIds.has(parameter.id)) continue;
        matchedParameterIds.add(parameter.id);
        controls.push(Object.freeze({
          ...compatibility,
          key: compatibility.candidatePattern
            ? `${compatibility.key}-${parameter.id.toLowerCase()}`
            : compatibility.key,
          label: resolvedLabel(compatibility, parameter.id),
          parameter,
          nativeId: parameter.id,
          metadata: metadata.get(parameter.id) ?? null,
        }));
      }
    }
    if (controls.length) {
      sections.push(Object.freeze({
        id: definition.id,
        label: definition.label,
        description: definition.description,
        controls: Object.freeze(controls),
      }));
    }
  }

  return Object.freeze({
    featureId,
    sections: Object.freeze(sections),
    matchedParameterIds,
    unmatchedParameters: Object.freeze(
      allParameters.filter((parameter) => !matchedParameterIds.has(parameter.id)),
    ),
    mappedControlCount: sections.reduce(
      (total, mappedSection) => total + mappedSection.controls.length,
      0,
    ),
  });
}

export function inavCompatibleDisplayMetadata(compatibility, metadata = {}) {
  if (!compatibility?.presentation) return { ...metadata };
  return {
    ...metadata,
    units: compatibility.presentation.units ?? metadata.units,
    min: compatibility.presentation.min ?? metadata.min,
    max: compatibility.presentation.max ?? metadata.max,
    increment: compatibility.presentation.increment ?? metadata.increment,
  };
}

export function toInavCompatibleDisplayValue(compatibility, value) {
  return compatibility?.presentation?.toDisplay
    ? compatibility.presentation.toDisplay(value)
    : Number(value);
}

export function fromInavCompatibleDisplayValue(compatibility, value) {
  return compatibility?.presentation?.toNative
    ? compatibility.presentation.toNative(value)
    : Number(value);
}
