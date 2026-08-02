"use strict";

import { vehicleFamily } from "../mavlink/ardupilotModes.js";

const TRANSLATION_TYPES = Object.freeze([
  "direct",
  "composite",
  "equivalent",
  "workflow",
]);

function intents(value) {
  return Object.freeze(String(value).trim().split(/\s+/).filter(Boolean));
}

function presentation(options = {}) {
  return Object.freeze({ ...options });
}

export const PERCENT_PRESENTATION = presentation({
  units: "%",
  toDisplay: (value) => Number(value) * 100,
  toNative: (value) => Number(value) / 100,
});

export const CENTIDEGREE_PRESENTATION = presentation({
  units: "°",
  toDisplay: (value) => Number(value) / 100,
  toNative: (value) => Number(value) * 100,
});

export const GPS_RATE_PRESENTATION = presentation({
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

function nativeControl(key, label, description, candidates, options = {}) {
  return Object.freeze({
    key,
    label,
    description,
    candidates: Object.freeze([...candidates]),
    ...options,
  });
}

function group(key, title, translation, covers, description, controls = [], options = {}) {
  if (!TRANSLATION_TYPES.includes(translation)) {
    throw new Error(`Invalid Flight Commander parity translation type: ${translation}`);
  }
  return Object.freeze({
    key,
    title,
    translation,
    covers: Object.freeze([...covers]),
    description,
    controls: Object.freeze([...controls]),
    ...options,
  });
}

function page(template, groups, options = {}) {
  return Object.freeze({
    template,
    groups: Object.freeze([...groups]),
    workflowCovers: Object.freeze([...(options.workflowCovers ?? [])]),
  });
}

const CONFIGURATION_INTENTS = Object.freeze({
  sensors: intents(`
    acc_hardware mag_hardware baro_hardware pitot_hardware rangefinder_hardware
    opflow_hardware i2c_speed
  `),
  batteryMonitor: intents(`
    vbat_meter_type bat_voltage_src voltagescale batteryvoltage current_meter_type
    current_meter_scale currentoffset batterycurrent bat_cells vbat_cell_detect_voltage
  `),
  batteryThresholds: intents(`
    mincellvoltage maxcellvoltage warningcellvoltage battery_capacity_unit
    battery_capacity battery_capacity_warning battery_capacity_critical
  `),
  powerLimits: intents(`
    limit_cont_current limit_burst_current limit_burst_current_time
    limit_burst_current_falldown_time limit_cont_power limit_burst_power
    limit_burst_power_time limit_burst_power_falldown_time
  `),
  vtx: intents(`vtx_band vtx_channel vtx_power vtx_low_power_disarm`),
  gimbal: intents(`gimbal_sensitivity gimbal_pan_channel gimbal_tilt_channel gimbal_roll_channel`),
  headTracker: intents(`headtracker_type headtracker_pan_ratio headtracker_tilt_ratio headtracker_roll_ratio`),
});

const OUTPUT_INTENTS = Object.freeze({
  motor: intents(`
    feature-28 motor_pwm_protocol servo_pwm_rate motorstop_on_low throttle_idle
    throttle_scale motor_poles feature-12 3ddeadbandlow 3ddeadbandhigh 3dneutral
  `),
  test: intents(`motorsEnableTestMode`),
  assignments: intents(`servo_output_assignments motor_output_order servo_limits servo_reversal`),
});

const RECEIVER_INTENTS = Object.freeze({
  source: intents(`
    rssi_channel rssi_source receiver_type serialrx_provider serialrx_inverted
    serialrx_halfduplex
  `),
  mapping: intents(`rcmap rcmap_helper`),
  telemetry: intents(`frsky_pitch_roll smartport_fuel_unit`),
  response: intents(`rc_filter_smoothing_factor mid expo deadband yaw_deadband`),
});

const FAILSAFE_INTENTS = Object.freeze({
  receiver: intents(`failsafe_delay drop land failsafe_throttle failsafe_off_delay rth nothing`),
  nearHome: intents(`failsafe_use_minimum_distance failsafe_min_distance failsafe_min_distance_procedure`),
});

const PID_INTENTS = Object.freeze({
  autotune: intents(`
    ez_tune_enabled ez_tune_filter_hz ez_tune_axis_ratio ez_tune_response
    ez_tune_damping ez_tune_stability ez_tune_aggressiveness ez_tune_rate
    ez_tune_expo ez_tune_snappiness
  `),
  gains: intents(`p i d ff value-input value-slider`),
  rates: intents(`
    rate_roll_rate rate_pitch_rate rate_yaw_rate rate_rollpitch_expo rate_yaw_expo
    rate_manual_roll rate_manual_pitch rate_manual_yaw manual_rollpitch_expo
    manual_yaw_expo heading_hold_rate_limit max_angle_inclination_rll
    max_angle_inclination_pit rate_dynamics_center_sensitivity
    rate_dynamics_end_sensitivity rate_dynamics_center_correction
    rate_dynamics_end_correction rate_dynamics_center_weight rate_dynamics_end_weight
  `),
  filters: intents(`
    gyro_main_lpf_hz gyro_dyn_lpf_min_hz gyro_dyn_lpf_max_hz
    gyro_dyn_lpf_curve_expo dynamic_gyro_notch_mode dynamic_gyro_notch_min_hz
    dynamic_gyro_notch_q setpoint_kalman_q dterm_lpf_hz rpm_gyro_filter_enabled
    rpm_gyro_min_hz mc_iterm_relax_cutoff
  `),
  mechanics: intents(`
    antigravity_gain antigravity_accelerator antigravity_cutoff_lpf_hz
    d_boost_min d_boost_max d_boost_max_at_acceleration d_boost_gyro_delta_lpf_hz
    tpa_rate tpa_breakpoint fw_tpa_time_constant fw_level_pitch_trim
    fw_yaw_iterm_freeze_bank_angle
  `),
});

const ADVANCED_INTENTS = Object.freeze({
  launch: intents(`
    nav_fw_launch_idle_thr nav_fw_launch_idle_motor_delay
    nav_fw_launch_wiggle_to_wake_idle nav_fw_launch_max_angle
    nav_fw_launch_motor_delay nav_fw_launch_min_time nav_fw_launch_spinup_time
    nav_fw_launch_thr nav_fw_launch_climb_angle nav_fw_launch_timeout
    nav_fw_launch_max_altitude nav_fw_launch_end_time
  `),
  fixedWingLanding: intents(`
    nav_fw_land_approach_length nav_fw_land_final_approach_pitch2throttle_mod
    nav_fw_land_glide_alt nav_fw_land_flare_alt nav_fw_land_glide_pitch
    nav_fw_land_flare_pitch nav_fw_land_max_tailwind
  `),
  fixedWingNavigation: intents(`
    idle_power cruise_power nav_fw_cruise_speed rth_energy_margin nav_fw_min_thr
    nav_fw_max_thr nav_fw_cruise_thr nav_fw_allow_manual_thr_increase
    fw_min_throttle_down_pitch nav_fw_pitch2thr nav_fw_pitch2thr_smoothing
    nav_fw_pitch2thr_threshold nav_fw_bank_angle nav_fw_manual_climb_rate
    nav_fw_climb_angle nav_fw_dive_angle nav_cruise_yaw_rate nav_fw_loiter_radius
    fw_loiter_direction nav_fw_control_smoothness nav_fw_soaring_motor_stop
    nav_fw_soaring_pitch_deadband nav_fw_alt_control_response
  `),
  multirotorNavigation: intents(`
    nav_user_control_mode nav_auto_speed nav_max_auto_speed nav_manual_speed
    nav_mc_auto_climb_rate nav_mc_manual_climb_rate nav_mc_bank_angle
    nav_mc_althold_throttle nav_mc_hover_thr nav_mc_wp_slowdown
    nav_mc_braking_speed_threshold nav_mc_braking_disengage_speed
    nav_mc_braking_timeout nav_mc_braking_boost_factor nav_mc_braking_boost_timeout
    nav_mc_braking_boost_speed_threshold nav_mc_braking_boost_disengage_speed
    nav_mc_braking_bank_angle
  `),
  returnHome: intents(`
    nav_rth_alt_mode nav_rth_altitude nav_rth_home_altitude nav_rth_climb_first
    nav_rth_climb_first_stage_mode nav_rth_climb_first_stage_altitude
    nav_rth_use_linear_descent nav_rth_linear_descent_start_distance
    nav_rth_climb_ignore_emerg nav_rth_alt_control_override nav_rth_trackback_mode
    nav_rth_trackback_distance safehome_usage_mode safehome_max_distance
    nav_rth_tail_first nav_rth_allow_landing nav_min_rth_distance
    nav_rth_abort_threshold failsafe_mission_delay inav_allow_dead_reckoning
  `),
  geofence: intents(`
    geozone_detection_distance geozone_avoid_altitude_range
    geozone_safe_altitude_distance geozone_safehome_as_inclusive
    geozone_safehome_zone_action geozone_mr_stop_distance
    geozone_no_way_home_action
  `),
  waypoint: intents(`
    nav_max_altitude nav_overrides_motor_stop nav_wp_radius nav_wp_max_safe_distance
    nav_wp_load_on_boot nav_wp_enforce_altitude nav_fw_wp_tracking_accuracy
    nav_fw_wp_tracking_max_angle nav_fw_wp_turn_smoothing
  `),
  landing: intents(`
    nav_land_maxalt_vspd nav_land_slowdown_maxalt nav_land_slowdown_minalt
    nav_land_minalt_vspd nav_emerg_landing_speed
  `),
});

const GPS_INTENTS = Object.freeze({
  receiver: intents(`
    feature-7 gps_port gps_baud gps_protocol gps_ubx_sbas mag_declination
    gps_preset_mode gps_ublox_nav_hz gps_ublox_use_galileo
    gps_ublox_use_beidou gps_ublox_use_glonass
  `),
  time: intents(`tz_offset tz_automatic_dst`),
});

const OSD_INTENTS = Object.freeze({
  identity: intents(`pilot_name osd_use_pilot_logo name`),
  display: intents(`
    osd_units osd_crosshairs_style osd_left_sidebar_scroll osd_right_sidebar_scroll
    osd_crsf_lq_format osd_sidebar_scroll_arrows osd_home_position_arm_screen
    osd_main_voltage_decimals osd_decimals_altitude osd_decimals_distance
    osd_mah_precision osd_coordinate_digits osd_plus_code_digits
    osd_plus_code_short osd_esc_rpm_precision
  `),
  alarms: intents(`
    osd_rssi_alarm osd_link_quality_alarm osd_rssi_dbm_alarm osd_snr_alarm
    osd_alt_alarm osd_neg_alt_alarm osd_dist_alarm osd_airspeed_alarm_min
    osd_airspeed_alarm_max osd_current_alarm osd_time_alarm osd_imu_temp_alarm_min
    osd_imu_temp_alarm_max osd_baro_temp_alarm_min osd_baro_temp_alarm_max
    osd_esc_temp_alarm_min osd_esc_temp_alarm_max osd_gforce_alarm
    osd_gforce_axis_alarm_min osd_gforce_axis_alarm_max osd_adsb_distance_alert
    osd_adsb_distance_warning
  `),
  digital: intents(`
    dji_esc_temp_source dji_rssi_source osd_speed_source dji_message_speed_source
    dji_use_name_for_messages dji_use_adjustments dji_cn_alternating_duration
  `),
  switches: intents(`
    osd_switch_indicators_align_left osd_switch_indicator_zero_name
    osd_switch_indicator_zero_channel osd_switch_indicator_one_name
    osd_switch_indicator_one_channel osd_switch_indicator_two_name
    osd_switch_indicator_two_channel osd_switch_indicator_three_name
    osd_switch_indicator_three_channel
  `),
  camera: intents(`
    osd_pan_servo_index osd_pan_servo_range_decadegrees
    osd_pan_servo_indicator_show_degrees osd_pan_servo_offcentre_warning
    osd_horizon_offset osd_hud_wp_disp osd_hud_radar_disp
    osd_hud_radar_range_min osd_hud_radar_range_max osd_camera_fov_h
    osd_camera_fov_v osd_camera_uptilt
  `),
});

const PARITY = Object.freeze({
  setup: page("setup", [
    group(
      "live-status",
      "Live vehicle setup",
      "workflow",
      [],
      "Flight Commander's Setup instruments are populated from MAVLink attitude, power, receiver, GPS, sensor-health, and arming data.",
      [],
    ),
  ], { workflowCovers: intents("attitude power receiver gps sensor_health arming_status") }),

  calibration: page("calibration", [
    group(
      "accelerometer",
      "Accelerometer calibration",
      "workflow",
      intents("accelerometer_offsets accelerometer_gains six_side_calibration level_calibration"),
      "The same Flight Commander calibration workflow sends ArduPilot preflight calibration commands and reports progress from controller status messages.",
    ),
    group(
      "compass-calibration",
      "Compass calibration",
      "workflow",
      intents("magnetometer_offsets magnetometer_gains compass_calibration"),
      "Starts and monitors ArduPilot's onboard compass calibration instead of calculating INAV offsets in the configurator.",
    ),
    group(
      "optical-flow",
      "Optical-flow scale",
      "direct",
      intents("OpflowScale"),
      "Writes the primary optical-flow focal-length scaler reported by the controller.",
      [nativeControl("flow-scale", "Optical-flow scale", "Correct optical-flow scale error.", ["FLOW_FXSCALER"])],
    ),
  ]),

  magnetometer: page("magnetometer", [
    group(
      "board-alignment",
      "Flight-controller alignment",
      "equivalent",
      intents("boardAlignRoll boardAlignPitch boardAlignYaw"),
      "ArduPilot uses a discrete board-orientation setting; select the installed rotation instead of entering three independent INAV angles.",
      [nativeControl("board-orientation", "Board orientation", "Rotation of the flight controller relative to the airframe.", ["AHRS_ORIENTATION"])],
    ),
    group(
      "compass-alignment",
      "Compass alignment",
      "composite",
      intents("magalign element_to_show alignRoll alignPitch alignYaw"),
      "Choose the primary compass orientation and whether it is mounted externally. ArduPilot applies the equivalent three-axis transform internally.",
      [
        nativeControl("compass-orientation", "Compass orientation", "Rotation of the primary compass.", ["COMPASS_ORIENT"]),
        nativeControl("compass-external", "External compass", "Mark the primary compass as externally mounted.", ["COMPASS_EXTERN"]),
        nativeControl("compass-use", "Use compass", "Use the primary compass for heading estimation.", ["COMPASS_USE"]),
      ],
    ),
    group(
      "declination",
      "Magnetic declination",
      "direct",
      intents("tz_offset"),
      "ArduPilot normally learns declination from GPS; this control exposes the native declination override where the firmware reports it.",
      [nativeControl("declination", "Magnetic declination", "Manual magnetic declination override.", ["COMPASS_DEC"])],
    ),
  ]),

  configuration: page("configuration", [
    group(
      "sensors",
      "Sensors",
      "equivalent",
      CONFIGURATION_INTENTS.sensors,
      "ArduPilot auto-detects inertial sensors and exposes explicit enable/type controls for optional compass, airspeed, rangefinder, and optical-flow hardware.",
      [
        nativeControl("compass", "Use compass", "Enable the primary compass.", ["COMPASS_USE"]),
        nativeControl("barometer", "Primary barometer", "Select the preferred barometer instance.", ["BARO_PRIMARY"]),
        nativeControl("airspeed", "Airspeed sensor type", "Select the pitot/airspeed driver.", ["ARSPD_TYPE"]),
        nativeControl("rangefinder", "Rangefinder type", "Select the first rangefinder driver.", ["RNGFND1_TYPE", "RNGFND_TYPE"]),
        nativeControl("optical-flow", "Optical-flow type", "Select the optical-flow driver.", ["FLOW_TYPE"]),
      ],
    ),
    group(
      "battery-monitor",
      "Battery voltage and current",
      "composite",
      CONFIGURATION_INTENTS.batteryMonitor,
      "The INAV voltage/current fields are routed through ArduPilot's battery monitor, pin assignment, voltage multiplier, amp-per-volt, and offset parameters.",
      [
        nativeControl("monitor", "Battery monitor type", "Select the installed voltage/current monitor.", ["BATT_MONITOR", "BATT1_MONITOR"]),
        nativeControl("voltage-pin", "Voltage source / pin", "Select the analog voltage input when applicable.", ["BATT_VOLT_PIN", "BATT1_VOLT_PIN"]),
        nativeControl("voltage-multiplier", "Voltage scale", "Calibrate reported pack voltage.", ["BATT_VOLT_MULT", "BATT1_VOLT_MULT"]),
        nativeControl("current-pin", "Current source / pin", "Select the analog current input when applicable.", ["BATT_CURR_PIN", "BATT1_CURR_PIN"]),
        nativeControl("current-scale", "Current scale", "Calibrate amps per volt.", ["BATT_AMP_PERVLT", "BATT1_AMP_PERVLT"]),
        nativeControl("current-offset", "Current offset", "Zero the current sensor.", ["BATT_AMP_OFFSET", "BATT1_AMP_OFFSET"]),
        nativeControl("cell-count", "Battery cell count", "Set or confirm the pack cell count when supported.", ["BATT_CELLS", "BATT1_CELLS"]),
      ],
    ),
    group(
      "battery-thresholds",
      "Battery capacity and warnings",
      "equivalent",
      CONFIGURATION_INTENTS.batteryThresholds,
      "ArduPilot evaluates pack-level voltage and remaining mAh. These controls replace INAV's per-cell thresholds with the equivalent pack warning and failsafe thresholds.",
      [
        nativeControl("capacity", "Battery capacity", "Usable pack capacity in mAh.", ["BATT_CAPACITY", "BATT1_CAPACITY"]),
        nativeControl("arm-voltage", "Minimum arming voltage", "Prevent arming below this pack voltage.", ["BATT_ARM_VOLT", "BATT1_ARM_VOLT"]),
        nativeControl("low-voltage", "Low pack voltage", "Low battery threshold.", ["BATT_LOW_VOLT", "BATT1_LOW_VOLT"]),
        nativeControl("critical-voltage", "Critical pack voltage", "Critical battery threshold.", ["BATT_CRT_VOLT", "BATT1_CRT_VOLT"]),
        nativeControl("low-capacity", "Low remaining capacity", "Low remaining-mAh threshold.", ["BATT_LOW_MAH", "BATT1_LOW_MAH"]),
        nativeControl("critical-capacity", "Critical remaining capacity", "Critical remaining-mAh threshold.", ["BATT_CRT_MAH", "BATT1_CRT_MAH"]),
      ],
    ),
    group(
      "power-limits",
      "Current and power limiting",
      "equivalent",
      CONFIGURATION_INTENTS.powerLimits,
      "ArduPilot uses a sustained current limit with a time constant on multirotors and a maximum battery power limit on fixed-wing vehicles instead of separate INAV continuous/burst timers.",
      [
        nativeControl("current-limit", "Motor current limit", "Maximum battery current used for motor limiting.", ["MOT_BAT_CURR_MAX", "Q_M_BAT_CURR_MAX"]),
        nativeControl("current-time", "Current-limit response time", "Time constant for current limiting.", ["MOT_BAT_CURR_TC", "Q_M_BAT_CURR_TC"]),
        nativeControl("power-limit", "Maximum battery power", "Maximum battery power used by fixed-wing throttle limiting.", ["BATT_WATT_MAX", "BATT1_WATT_MAX"]),
      ],
    ),
    group(
      "vtx",
      "Video transmitter",
      "direct",
      CONFIGURATION_INTENTS.vtx,
      "The Flight Commander VTX controls write ArduPilot's band, channel, power, and disarmed-power options.",
      [
        nativeControl("vtx-band", "VTX band", "Video transmitter band.", ["VTX_BAND"]),
        nativeControl("vtx-channel", "VTX channel", "Video transmitter channel.", ["VTX_CHANNEL"]),
        nativeControl("vtx-power", "VTX power", "Video transmitter power level.", ["VTX_POWER"]),
        nativeControl("vtx-options", "VTX disarmed behavior", "Low-power and pit-mode options while disarmed.", ["VTX_OPTIONS"]),
      ],
    ),
    group(
      "gimbal",
      "Gimbal",
      "composite",
      CONFIGURATION_INTENTS.gimbal,
      "ArduPilot's mount manager owns gimbal input channels and slew rate. Flight Commander writes the equivalent mount parameters.",
      [
        nativeControl("mount-type", "Gimbal / mount type", "Select the mount backend.", ["MNT1_TYPE", "MNT_TYPE"]),
        nativeControl("mount-rate", "Gimbal sensitivity / slew rate", "Maximum RC-controlled mount slew rate.", ["MNT1_RC_RATE", "MNT_RC_RATE"]),
        nativeControl("mount-pan", "Pan input channel", "RC input used for pan control.", ["MNT1_RC_IN_PAN", "MNT_RC_IN_PAN"]),
        nativeControl("mount-tilt", "Tilt input channel", "RC input used for tilt control.", ["MNT1_RC_IN_TILT", "MNT_RC_IN_TILT"]),
        nativeControl("mount-roll", "Roll input channel", "RC input used for roll control.", ["MNT1_RC_IN_ROLL", "MNT_RC_IN_ROLL"]),
      ],
    ),
    group(
      "head-tracker",
      "Head tracker",
      "equivalent",
      CONFIGURATION_INTENTS.headTracker,
      "ArduPilot routes head-tracker commands through the mount manager. Select the mount type, input mode, and angular limits instead of separate axis ratios.",
      [
        nativeControl("mount-default-mode", "Mount input mode", "Default mount control mode.", ["MNT1_DEFLT_MODE", "MNT_DEFLT_MODE"]),
        nativeControl("pan-min", "Pan minimum", "Minimum gimbal pan angle.", ["MNT1_ANGMIN_PAN", "MNT_ANGMIN_PAN"]),
        nativeControl("pan-max", "Pan maximum", "Maximum gimbal pan angle.", ["MNT1_ANGMAX_PAN", "MNT_ANGMAX_PAN"]),
        nativeControl("tilt-min", "Tilt minimum", "Minimum gimbal tilt angle.", ["MNT1_ANGMIN_TIL", "MNT_ANGMIN_TIL"]),
        nativeControl("tilt-max", "Tilt maximum", "Maximum gimbal tilt angle.", ["MNT1_ANGMAX_TIL", "MNT_ANGMAX_TIL"]),
      ],
    ),
  ]),

  ports: page("ports", [
    group(
      "serial-ports",
      "Serial ports",
      "workflow",
      [],
      "Each Flight Commander port row is generated from the connected vehicle's SERIALx_PROTOCOL, SERIALx_BAUD, and SERIALx_OPTIONS parameters.",
    ),
  ], { workflowCovers: intents("serial_protocol serial_baud serial_options receiver_telemetry_sensor_peripheral_assignment") }),

  mixer: page("mixer", [
    group(
      "airframe",
      "Platform and mixer preset",
      "composite",
      intents("platform-type mixer-preset mixer_control_profile_linking"),
      "Flight Commander's platform and preset selectors write ArduPilot's frame class/type and use the active ArduPilot parameter set as the linked mixer profile.",
      [
        nativeControl("frame-class", "Platform type", "Airframe class.", ["FRAME_CLASS", "Q_FRAME_CLASS"]),
        nativeControl("frame-type", "Mixer preset", "Motor geometry within the selected class.", ["FRAME_TYPE", "Q_FRAME_TYPE"]),
      ],
    ),
    group(
      "motor-direction",
      "Motor direction",
      "equivalent",
      intents("motor_direction_inverted"),
      "ArduPilot reverses individual bidirectional DShot/BLHeli outputs with a mask rather than globally reversing the mixer.",
      [nativeControl("reverse-mask", "Reversed motor output mask", "Bitmask of motor outputs whose ESC direction is reversed.", ["SERVO_BLH_RVMASK"])],
    ),
    group(
      "output-mix",
      "Output mix",
      "workflow",
      intents("motor_mixer servo_mixer motor_order output_function_summary"),
      "The diagram and output table are derived from FRAME_CLASS, FRAME_TYPE, and SERVOx_FUNCTION so they reflect ArduPilot's actual motor order.",
    ),
  ]),

  outputs: page("outputs", [
    group(
      "motor-output",
      "Motor protocol and idle",
      "composite",
      OUTPUT_INTENTS.motor,
      "Flight Commander's motor controls write ArduPilot's PWM protocol, armed/minimum spin, thrust linearization, bidirectional-motor, and BLHeli telemetry parameters.",
      [
        nativeControl("motor-protocol", "ESC / motor protocol", "Select PWM, OneShot, brushed, or DShot output.", ["MOT_PWM_TYPE", "Q_M_PWM_TYPE"]),
        nativeControl("servo-rate", "Servo update rate", "Update rate for conventional servo outputs.", ["SERVO_RATE"]),
        nativeControl("spin-armed", "Armed idle", "Motor output while armed at zero throttle.", ["MOT_SPIN_ARM", "Q_M_SPIN_ARM"], { presentation: PERCENT_PRESENTATION }),
        nativeControl("spin-min", "Minimum running output", "Lowest motor output while running.", ["MOT_SPIN_MIN", "Q_M_SPIN_MIN"], { presentation: PERCENT_PRESENTATION }),
        nativeControl("thrust-expo", "Throttle / thrust linearization", "Compensate motor thrust nonlinearity.", ["MOT_THST_EXPO", "Q_M_THST_EXPO"]),
        nativeControl("motor-poles", "Motor pole count", "Pole count used for ESC RPM telemetry.", ["SERVO_BLH_POLES"]),
        nativeControl("reversible", "Bidirectional motor mode", "Enable ArduPilot's reversible-thrust motor behavior.", ["MOT_3D_ENABLE", "Q_M_3D_ENABLE"]),
        nativeControl("deadzone", "Reversible-thrust deadzone", "Neutral deadzone for reversible motor output.", ["MOT_3D_DEADZONE", "Q_M_3D_DEADZONE"]),
      ],
    ),
    group(
      "assignments",
      "Output assignment and limits",
      "workflow",
      OUTPUT_INTENTS.assignments,
      "The Flight Commander output table is generated from every reported SERVOx_FUNCTION/MIN/MAX/TRIM/REVERSED parameter.",
    ),
    group(
      "motor-test",
      "Motor and servo test",
      "workflow",
      OUTPUT_INTENTS.test,
      "The safety-gated test controls send MAV_CMD_DO_MOTOR_TEST or servo commands only while disarmed and after explicit confirmation.",
    ),
  ]),

  receiver: page("receiver", [
    group(
      "receiver-source",
      "Receiver and RSSI source",
      "composite",
      RECEIVER_INTENTS.source,
      "Receiver selection is translated to ArduPilot RC protocol and serial-port options; RSSI source/channel map directly where reported.",
      [
        nativeControl("rc-protocols", "Receiver protocols", "Enabled RC input protocol mask.", ["RC_PROTOCOLS"]),
        nativeControl("rc-options", "Receiver options", "Inversion, half-duplex, and protocol behavior options.", ["RC_OPTIONS"]),
        nativeControl("rssi-type", "RSSI source", "Source used for receiver signal strength.", ["RSSI_TYPE"]),
        nativeControl("rssi-channel", "RSSI channel", "RC channel carrying analog PWM RSSI.", ["RSSI_CHANNEL"]),
      ],
    ),
    group(
      "channel-map",
      "Channel map and calibration",
      "composite",
      RECEIVER_INTENTS.mapping,
      "The AETR helper writes RCMAP_ROLL, RCMAP_PITCH, RCMAP_THROTTLE, and RCMAP_YAW and the live bars use MAVLink RC_CHANNELS.",
      [
        nativeControl("map-roll", "Roll channel", "Input channel used for roll.", ["RCMAP_ROLL"]),
        nativeControl("map-pitch", "Pitch channel", "Input channel used for pitch.", ["RCMAP_PITCH"]),
        nativeControl("map-throttle", "Throttle channel", "Input channel used for throttle.", ["RCMAP_THROTTLE"]),
        nativeControl("map-yaw", "Yaw channel", "Input channel used for yaw.", ["RCMAP_YAW"]),
      ],
    ),
    group(
      "receiver-telemetry",
      "Receiver telemetry",
      "equivalent",
      RECEIVER_INTENTS.telemetry,
      "ArduPilot's serial telemetry protocol and SERIALx_OPTIONS determine FrSky/SmartPort framing and telemetry content instead of separate pitch/roll and fuel-unit switches.",
      [nativeControl("serial-options", "Receiver telemetry options", "Electrical and protocol options for the receiver telemetry serial port.", ["SERIAL1_OPTIONS", "SERIAL2_OPTIONS", "SERIAL3_OPTIONS"])],
    ),
    group(
      "stick-response",
      "Stick response",
      "composite",
      RECEIVER_INTENTS.response,
      "INAV smoothing, midpoint, expo, and deadband are represented by ArduPilot input time constant, yaw expo, RC trims, and per-channel deadzones.",
      [
        nativeControl("input-time", "Input smoothing / response", "Time constant applied to pilot attitude input.", ["ATC_INPUT_TC"]),
        nativeControl("yaw-expo", "Yaw expo", "Yaw stick exponential response.", ["PILOT_Y_EXPO"]),
        nativeControl("roll-trim", "Roll midpoint", "Roll channel trim / midpoint.", ["RC1_TRIM"]),
        nativeControl("pitch-trim", "Pitch midpoint", "Pitch channel trim / midpoint.", ["RC2_TRIM"]),
        nativeControl("throttle-trim", "Throttle midpoint", "Throttle channel trim / midpoint.", ["RC3_TRIM"]),
        nativeControl("yaw-trim", "Yaw midpoint", "Yaw channel trim / midpoint.", ["RC4_TRIM"]),
        nativeControl("roll-deadzone", "Roll deadband", "Roll input deadzone.", ["RC1_DZ"]),
        nativeControl("pitch-deadzone", "Pitch deadband", "Pitch input deadzone.", ["RC2_DZ"]),
        nativeControl("yaw-deadzone", "Yaw deadband", "Yaw input deadzone.", ["RC4_DZ"]),
      ],
    ),
  ]),

  modes: page("auxiliary", [
    group(
      "flight-modes",
      "Modes",
      "workflow",
      [],
      "Flight mode positions and auxiliary switch functions are generated from FLTMODE/MODE parameters and RCx_OPTION assignments.",
    ),
  ], { workflowCovers: intents("flight_mode_slots mode_channel auxiliary_switch_ranges rc_options live_switch_state") }),

  failsafe: page("failsafe", [
    group(
      "receiver-failsafe",
      "Receiver failsafe",
      "composite",
      FAILSAFE_INTENTS.receiver,
      "Flight Commander's delay, threshold, and action choices write the ArduPilot receiver-failsafe timeout/threshold/action parameters for the connected vehicle family.",
      [
        nativeControl("timeout", "Receiver-loss delay", "Time without valid receiver input before failsafe.", ["FS_THR_TIMEOUT", "RC_FS_TIMEOUT"]),
        nativeControl("threshold", "Receiver-loss threshold", "Throttle PWM threshold used for receiver failsafe detection.", ["FS_THR_VALUE", "THR_FS_VALUE"]),
        nativeControl("action", "Receiver-loss action", "Action performed after receiver loss.", ["FS_THR_ENABLE", "THR_FAILSAFE", "FS_SHORT_ACTN"]),
        nativeControl("long-action", "Extended failsafe action", "Action after an extended receiver failsafe.", ["FS_LONG_ACTN"]),
        nativeControl("options", "Failsafe options", "Continue/land/disarm behavior in special flight states.", ["FS_OPTIONS"]),
      ],
    ),
    group(
      "near-home",
      "Near-home return behavior",
      "equivalent",
      FAILSAFE_INTENTS.nearHome,
      "ArduPilot shapes a return with RTL altitude, final altitude, and cone slope rather than selecting a separate INAV minimum-distance procedure.",
      [
        nativeControl("rtl-altitude", "Return altitude", "Target return-to-home altitude.", ["RTL_ALT", "Q_RTL_ALT"]),
        nativeControl("rtl-final", "Final altitude above home", "Altitude above home before landing or loitering.", ["RTL_ALT_FINAL", "Q_RTL_ALT_FINAL"]),
        nativeControl("rtl-cone", "Near-home altitude cone", "Reduces climb height as return starts closer to home.", ["RTL_CONE_SLOPE"]),
      ],
    ),
  ]),

  pid_tuning: page("pid_tuning", [
    group(
      "autotune",
      "Easy Tune / AutoTune",
      "equivalent",
      PID_INTENTS.autotune,
      "ArduPilot performs in-flight AutoTune. Flight Commander's Easy Tune concepts set the axes, aggressiveness, gain limits, and input shaping used by that controller-managed process.",
      [
        nativeControl("axes", "Axes to tune", "Select roll, pitch, and/or yaw AutoTune axes.", ["AUTOTUNE_AXES"]),
        nativeControl("aggressiveness", "Tune aggressiveness", "Desired response aggressiveness.", ["AUTOTUNE_AGGR"]),
        nativeControl("minimum-d", "Minimum D gain", "Minimum D gain accepted by AutoTune.", ["AUTOTUNE_MIN_D"]),
        nativeControl("maximum-gain", "Maximum gain", "Upper gain limit for AutoTune.", ["AUTOTUNE_MAX_GN"]),
        nativeControl("input-time", "Stick response", "Pilot input shaping after tuning.", ["ATC_INPUT_TC"]),
      ],
    ),
    group(
      "rate-gains",
      "Rate PID and feed-forward",
      "direct",
      PID_INTENTS.gains,
      "Roll, pitch, and yaw P/I/D/FF sliders write the corresponding ATC_RAT_* gains reported by ArduPilot.",
    ),
    group(
      "rates",
      "Rates, expo, and dynamics",
      "composite",
      PID_INTENTS.rates,
      "Flight Commander's rate and dynamics controls map to ArduPilot maximum axis rates, acceleration limits, input time constant, yaw expo, and stabilized angle limit.",
      [
        nativeControl("roll-rate", "Maximum roll rate", "Maximum commanded roll rate.", ["ATC_RATE_R_MAX", "ACRO_RP_RATE"]),
        nativeControl("pitch-rate", "Maximum pitch rate", "Maximum commanded pitch rate.", ["ATC_RATE_P_MAX", "ACRO_RP_RATE"]),
        nativeControl("yaw-rate", "Maximum yaw rate", "Maximum commanded yaw rate.", ["ATC_RATE_Y_MAX", "ACRO_Y_RATE"]),
        nativeControl("roll-accel", "Roll acceleration", "Maximum roll angular acceleration.", ["ATC_ACCEL_R_MAX"]),
        nativeControl("pitch-accel", "Pitch acceleration", "Maximum pitch angular acceleration.", ["ATC_ACCEL_P_MAX"]),
        nativeControl("yaw-accel", "Yaw acceleration", "Maximum yaw angular acceleration.", ["ATC_ACCEL_Y_MAX"]),
        nativeControl("input-time", "Roll/pitch input smoothing", "Pilot input time constant.", ["ATC_INPUT_TC"]),
        nativeControl("yaw-expo", "Yaw expo", "Yaw stick exponential response.", ["PILOT_Y_EXPO"]),
        nativeControl("angle", "Maximum stabilized angle", "Maximum roll/pitch lean angle.", ["ANGLE_MAX", "Q_ANGLE_MAX"], { presentation: CENTIDEGREE_PRESENTATION }),
      ],
    ),
    group(
      "filters",
      "Gyro, D-term, and RPM filtering",
      "composite",
      PID_INTENTS.filters,
      "INAV's dynamic/RPM/D-term filters are represented by ArduPilot gyro filtering, harmonic-notch tracking, bandwidth, attenuation, and per-axis target/derivative filters.",
      [
        nativeControl("gyro-filter", "Gyro low-pass filter", "Primary gyro filter cutoff.", ["INS_GYRO_FILTER"]),
        nativeControl("notch-mode", "Harmonic-notch tracking mode", "How the notch tracks throttle, RPM, ESC telemetry, or FFT data.", ["INS_HNTCH_MODE"]),
        nativeControl("notch-frequency", "Harmonic-notch base frequency", "Base notch frequency.", ["INS_HNTCH_FREQ"]),
        nativeControl("notch-bandwidth", "Harmonic-notch bandwidth", "Notch bandwidth.", ["INS_HNTCH_BW"]),
        nativeControl("notch-attenuation", "Harmonic-notch attenuation", "Notch attenuation.", ["INS_HNTCH_ATT"]),
        nativeControl("roll-d-filter", "Roll D-term filter", "Roll derivative-path low-pass filter.", ["ATC_RAT_RLL_FLTD"]),
        nativeControl("pitch-d-filter", "Pitch D-term filter", "Pitch derivative-path low-pass filter.", ["ATC_RAT_PIT_FLTD"]),
        nativeControl("yaw-d-filter", "Yaw D-term filter", "Yaw derivative-path low-pass filter.", ["ATC_RAT_YAW_FLTD"]),
      ],
    ),
    group(
      "mechanics",
      "Throttle coupling and fixed-wing mechanics",
      "equivalent",
      PID_INTENTS.mechanics,
      "ArduPilot replaces INAV anti-gravity, D-boost, and TPA with throttle-mix scheduling, thrust linearization, controller feed-forward, and fixed-wing pitch/yaw servo parameters.",
      [
        nativeControl("throttle-mix-min", "Minimum throttle mix", "Attitude-control priority at low throttle.", ["ATC_THR_MIX_MIN"]),
        nativeControl("throttle-mix-max", "Maximum throttle mix", "Attitude-control priority at high throttle.", ["ATC_THR_MIX_MAX"]),
        nativeControl("thrust-expo", "Thrust linearization", "Motor thrust curve compensation.", ["MOT_THST_EXPO", "Q_M_THST_EXPO"]),
        nativeControl("pitch-time", "Fixed-wing pitch response", "Pitch servo controller time constant.", ["PTCH2SRV_TCONST"]),
        nativeControl("pitch-trim", "Fixed-wing level pitch trim", "Level-flight pitch trim.", ["PTCH_TRIM_DEG"]),
        nativeControl("yaw-imax", "Fixed-wing yaw integrator limit", "Yaw integrator authority limit.", ["YAW2SRV_IMAX"]),
      ],
    ),
  ]),

  advanced_tuning: page("advanced_tuning", [
    group(
      "launch",
      "Fixed-wing launch",
      "equivalent",
      ADVANCED_INTENTS.launch,
      "ArduPilot detects launch acceleration, delays motor start, controls throttle slew, and transitions at the configured speed/altitude instead of using INAV's launch timer sequence.",
      [
        nativeControl("minimum-acceleration", "Launch detection acceleration", "Acceleration required to detect launch.", ["TKOFF_THR_MINACC"]),
        nativeControl("motor-delay", "Launch motor delay", "Delay before applying launch throttle.", ["TKOFF_THR_DELAY"]),
        nativeControl("rotate-speed", "Launch rotation speed", "Airspeed at which pitch-up begins.", ["TKOFF_ROTATE_SPD"]),
        nativeControl("throttle-slew", "Launch throttle slew", "Throttle ramp rate during launch.", ["TKOFF_THR_SLEW"]),
        nativeControl("minimum-altitude", "Minimum takeoff altitude", "Altitude that completes vertical takeoff handling.", ["Q_NAVALT_MIN"]),
        nativeControl("spool-time", "Motor spool time", "Time to reach full spool state.", ["MOT_SPOOL_TIME", "Q_M_SPOOL_TIME"]),
      ], { families: Object.freeze(["plane"]) }),
    group(
      "fixed-wing-landing",
      "Fixed-wing landing",
      "equivalent",
      ADVANCED_INTENTS.fixedWingLanding,
      "ArduPilot computes approach slope, flare timing, and wind compensation from its LAND parameters rather than separate INAV glide/flare pitch fields.",
      [
        nativeControl("approach-altitude", "Approach slope recalculation", "Automatic landing slope recalculation behavior.", ["LAND_SLOPE_RCALC"]),
        nativeControl("flare-altitude", "Flare altitude", "Altitude at which flare begins.", ["LAND_FLARE_ALT"]),
        nativeControl("flare-time", "Flare time", "Time before touchdown at which flare begins.", ["LAND_FLARE_SEC"]),
        nativeControl("pre-flare-altitude", "Pre-flare altitude", "Altitude at which pre-flare begins.", ["LAND_PF_ALT"]),
        nativeControl("wind-compensation", "Landing wind compensation", "Cross/tail-wind compensation during landing.", ["LAND_WIND_COMP"]),
      ], { families: Object.freeze(["plane"]) }),
    group(
      "fixed-wing-navigation",
      "Fixed-wing power and navigation",
      "composite",
      ADVANCED_INTENTS.fixedWingNavigation,
      "Cruise power, pitch-to-throttle, bank, loiter, altitude response, and soaring are translated to ArduPilot throttle, airspeed, TECS, L1, loiter, and soaring parameters.",
      [
        nativeControl("throttle-min", "Minimum cruise throttle", "Minimum automatic throttle.", ["THR_MIN"]),
        nativeControl("throttle-max", "Maximum cruise throttle", "Maximum automatic throttle.", ["THR_MAX"]),
        nativeControl("throttle-cruise", "Cruise throttle", "Nominal cruise throttle.", ["TRIM_THROTTLE", "THR_CRUISE"]),
        nativeControl("airspeed-cruise", "Cruise airspeed", "Nominal target airspeed.", ["AIRSPEED_CRUISE", "TRIM_ARSPD_CM"]),
        nativeControl("bank-angle", "Maximum bank angle", "Fixed-wing roll limit.", ["LIM_ROLL_CD"], { presentation: CENTIDEGREE_PRESENTATION }),
        nativeControl("climb-rate", "Maximum climb rate", "TECS climb-rate limit.", ["TECS_CLMB_MAX"]),
        nativeControl("sink-rate", "Maximum descent rate", "TECS sink-rate limit.", ["TECS_SINK_MAX"]),
        nativeControl("pitch-to-throttle", "Pitch/throttle energy balance", "TECS speed-versus-height weighting.", ["TECS_SPDWEIGHT"]),
        nativeControl("loiter-radius", "Loiter radius", "Default fixed-wing loiter radius.", ["WP_LOITER_RAD", "LOIT_RADIUS"]),
        nativeControl("navigation-period", "Navigation smoothness", "L1 navigation period.", ["NAVL1_PERIOD"]),
        nativeControl("soaring", "Soaring mode", "Enable and configure motor-stop soaring behavior.", ["SOAR_ENABLE"]),
      ], { families: Object.freeze(["plane"]) }),
    group(
      "multirotor-navigation",
      "Multirotor navigation",
      "composite",
      ADVANCED_INTENTS.multirotorNavigation,
      "Flight Commander's multirotor speed, climb, bank, hover, slowdown, and braking controls write ArduPilot WPNAV, PILOT, ANGLE, MOT, and LOIT parameters.",
      [
        nativeControl("auto-speed", "Automatic navigation speed", "Normal waypoint speed.", ["WPNAV_SPEED"]),
        nativeControl("auto-climb", "Automatic climb speed", "Automatic navigation climb speed.", ["WPNAV_SPEED_UP"]),
        nativeControl("auto-descent", "Automatic descent speed", "Automatic navigation descent speed.", ["WPNAV_SPEED_DN"]),
        nativeControl("manual-climb", "Pilot climb speed", "Pilot-commanded climb limit.", ["PILOT_SPEED_UP", "PILOT_VELZ_MAX"]),
        nativeControl("manual-descent", "Pilot descent speed", "Pilot-commanded descent limit.", ["PILOT_SPEED_DN"]),
        nativeControl("bank-angle", "Maximum navigation bank", "Maximum lean angle.", ["ANGLE_MAX"], { presentation: CENTIDEGREE_PRESENTATION }),
        nativeControl("hover-throttle", "Learned hover throttle", "Hover-throttle estimate used by altitude control.", ["MOT_THST_HOVER"]),
        nativeControl("wp-acceleration", "Waypoint acceleration", "Horizontal waypoint acceleration.", ["WPNAV_ACCEL"]),
        nativeControl("loiter-speed", "Loiter maximum speed", "Maximum position-hold speed.", ["LOIT_SPEED"]),
        nativeControl("brake-accel", "Braking acceleration", "Position-hold braking acceleration.", ["LOIT_BRK_ACCEL"]),
        nativeControl("brake-jerk", "Braking smoothness", "Position-hold braking jerk.", ["LOIT_BRK_JERK"]),
        nativeControl("brake-delay", "Braking delay", "Delay before position-hold braking.", ["LOIT_BRK_DELAY"]),
      ], { families: Object.freeze(["copter"]) }),
    group(
      "return-home",
      "Return to home",
      "equivalent",
      ADVANCED_INTENTS.returnHome,
      "ArduPilot's RTL altitude type, cone slope, final altitude, speed, loiter, terrain, and failsafe options provide the equivalent return behavior; dead reckoning is handled automatically by EKF failsafe logic.",
      [
        nativeControl("altitude-type", "RTL altitude reference", "Relative, terrain, or fixed return altitude behavior.", ["RTL_ALT_TYPE"]),
        nativeControl("altitude", "RTL altitude", "Target return altitude.", ["RTL_ALT", "Q_RTL_ALT"]),
        nativeControl("final-altitude", "RTL final altitude", "Altitude above home before landing/loiter.", ["RTL_ALT_FINAL", "Q_RTL_ALT_FINAL"]),
        nativeControl("cone", "Near-home altitude cone", "Scale return climb height with distance from home.", ["RTL_CONE_SLOPE"]),
        nativeControl("speed", "RTL speed", "Horizontal return speed.", ["RTL_SPEED", "WPNAV_SPEED"]),
        nativeControl("loiter", "RTL loiter time", "Time to loiter above home.", ["RTL_LOIT_TIME"]),
        nativeControl("terrain", "RTL terrain following", "Use terrain data during return.", ["RTL_ALT_TYPE", "TERRAIN_FOLLOW"]),
        nativeControl("options", "RTL / failsafe options", "Landing, continuation, and emergency options.", ["FS_OPTIONS", "RTL_OPTIONS"]),
        nativeControl("ekf-action", "Estimator failsafe action", "Action when navigation estimates become unreliable.", ["FS_EKF_ACTION", "FS_EKF_THRESH"]),
      ],
    ),
    group(
      "geofence",
      "Geozone / geofence and avoidance",
      "equivalent",
      ADVANCED_INTENTS.geofence,
      "INAV geozone behavior is represented by ArduPilot's circular/altitude/polygon Fence and Object Avoidance margins/actions. Polygon boundaries are edited in Flight Planner.",
      [
        nativeControl("enable", "Enable geofence", "Enable configured fence checks.", ["FENCE_ENABLE"]),
        nativeControl("types", "Fence boundary types", "Altitude, circle, and polygon boundary mask.", ["FENCE_TYPE"]),
        nativeControl("action", "Fence breach action", "Action taken on a fence breach.", ["FENCE_ACTION"]),
        nativeControl("radius", "Maximum distance from home", "Circular fence radius.", ["FENCE_RADIUS"]),
        nativeControl("altitude", "Maximum altitude", "Altitude fence ceiling.", ["FENCE_ALT_MAX"]),
        nativeControl("margin", "Fence safety margin", "Distance maintained inside the fence.", ["FENCE_MARGIN"]),
        nativeControl("avoidance", "Object avoidance", "Enable avoidance around fence and obstacle boundaries.", ["AVOID_ENABLE"]),
        nativeControl("avoidance-type", "Avoidance planner", "Select the object-avoidance planner.", ["OA_TYPE"]),
        nativeControl("avoidance-margin", "Avoidance margin", "Clearance maintained around obstacles.", ["OA_MARGIN_MAX"]),
      ],
    ),
    group(
      "waypoints",
      "Waypoint navigation",
      "equivalent",
      ADVANCED_INTENTS.waypoint,
      "Waypoint acceptance, maximum mission distance, restart behavior, terrain following, and fixed-wing turn tracking map to ArduPilot waypoint, mission, and L1 navigation parameters.",
      [
        nativeControl("radius", "Waypoint acceptance radius", "Distance at which a waypoint is accepted.", ["WPNAV_RADIUS", "WP_RADIUS"]),
        nativeControl("maximum-radius", "Maximum waypoint radius", "Maximum permitted waypoint distance/radius.", ["WP_MAX_RADIUS"]),
        nativeControl("restart", "Mission restart behavior", "Restart or resume a mission after mode changes.", ["MIS_RESTART"]),
        nativeControl("terrain", "Waypoint terrain following", "Use rangefinder/terrain for waypoint altitude.", ["WPNAV_RFND_USE", "TERRAIN_FOLLOW"]),
        nativeControl("l1-period", "Fixed-wing turn smoothness", "L1 navigation response period.", ["NAVL1_PERIOD"]),
        nativeControl("l1-damping", "Fixed-wing tracking damping", "L1 navigation damping ratio.", ["NAVL1_DAMPING"]),
      ],
    ),
    group(
      "landing",
      "Automatic and emergency landing",
      "composite",
      ADVANCED_INTENTS.landing,
      "High-altitude descent, slowdown altitude, final descent, and emergency response map to ArduPilot's LAND speed/altitude and failsafe action parameters.",
      [
        nativeControl("high-speed", "High-altitude descent speed", "Descent speed above the slowdown altitude.", ["LAND_SPEED_HIGH", "Q_LAND_SPEED_HIGH"]),
        nativeControl("slowdown-altitude", "Landing slowdown altitude", "Altitude at which final descent speed begins.", ["LAND_ALT_LOW", "Q_LAND_ALTCHG"]),
        nativeControl("final-speed", "Final landing speed", "Final vertical landing speed.", ["LAND_SPEED", "Q_LAND_SPEED"]),
        nativeControl("emergency-action", "Emergency landing action", "Failsafe action used when normal navigation cannot continue.", ["FS_THR_ENABLE", "FS_EKF_ACTION"]),
      ],
    ),
  ]),

  adjustments: page("adjustments", [
    group(
      "tuning-channel",
      "In-flight parameter adjustment",
      "equivalent",
      intents("adjustment_ranges adjustment_function adjustment_channel adjustment_min adjustment_max adjustment_steps"),
      "ArduPilot uses one tuning input plus RC auxiliary functions instead of INAV adjustment-range slots. Flight Commander exposes the tuning parameter, input channel, and limits in the same tab.",
      [
        nativeControl("tune-function", "Tunable function", "Parameter group controlled by the tuning input.", ["TUNE"]),
        nativeControl("tune-channel", "Tuning channel", "RC channel or knob used for live tuning.", ["TUNE_CHAN"]),
        nativeControl("tune-min", "Adjustment minimum", "Value at the low end of the tuning input.", ["TUNE_MIN"]),
        nativeControl("tune-max", "Adjustment maximum", "Value at the high end of the tuning input.", ["TUNE_MAX"]),
      ],
    ),
    group(
      "auxiliary-functions",
      "Switch-triggered adjustments",
      "workflow",
      intents("adjustment_switch_functions adjustment_activation_ranges"),
      "Switch-triggered actions are assigned through RCx_OPTION rows using the connected firmware's official auxiliary-function list.",
    ),
  ]),

  gps_navigation: page("gps", [
    group(
      "gps-receiver",
      "GPS receiver",
      "composite",
      GPS_INTENTS.receiver,
      "Port selection is handled on Ports; this tab writes ArduPilot's GPS driver, automatic configuration, update rate, GNSS constellation mask, SBAS, and compass-declination behavior.",
      [
        nativeControl("type", "GPS protocol / type", "Primary GPS driver.", ["GPS1_TYPE", "GPS_TYPE"]),
        nativeControl("auto-config", "Automatic GPS configuration", "Let ArduPilot configure receiver baud/messages.", ["GPS_AUTO_CONFIG"]),
        nativeControl("rate", "GPS update rate", "Primary receiver update rate.", ["GPS_RATE_MS"], { presentation: GPS_RATE_PRESENTATION }),
        nativeControl("constellations", "GNSS constellations", "Enabled constellation mask.", ["GPS_GNSS_MODE"]),
        nativeControl("sbas", "SBAS mode", "Satellite-based augmentation behavior.", ["GPS_SBAS_MODE"]),
        nativeControl("declination", "Magnetic declination", "Manual declination override; automatic with GPS by default.", ["COMPASS_DEC"]),
      ],
    ),
    group(
      "time",
      "GPS time",
      "equivalent",
      GPS_INTENTS.time,
      "ArduPilot stores GPS time in UTC. Flight Commander applies the computer's timezone and daylight-saving rules for display, so no flight-controller timezone offset is required.",
      [],
    ),
  ]),

  sensors: page("sensors", [
    group(
      "live-sensors",
      "Live sensor plots",
      "workflow",
      [],
      "The existing Flight Commander plot controls request and display the equivalent MAVLink attitude, IMU, pressure, range, airspeed, temperature, and debug streams.",
    ),
  ], { workflowCovers: intents("gyro accel mag baro sonar airspeed temperature debug refresh_rate plot_scale") }),

  osd: page("osd", [
    group(
      "identity",
      "Pilot and vehicle identity",
      "equivalent",
      OSD_INTENTS.identity,
      "ArduPilot identifies the aircraft through MAVLink system identity and OSD message/text options rather than INAV pilot-logo storage.",
      [
        nativeControl("system-id", "Vehicle system ID", "MAVLink identity for this aircraft.", ["SYSID_THISMAV"]),
        nativeControl("message-time", "OSD message duration", "How long status messages remain visible.", ["OSD_MSG_TIME"]),
      ],
    ),
    group(
      "display",
      "Display format and layout",
      "equivalent",
      OSD_INTENTS.display,
      "Units, crosshair/sidebar behavior, precision, coordinates, and arm-screen content are represented by ArduPilot OSD global options and per-element enable/position parameters.",
      [
        nativeControl("type", "OSD hardware type", "Analog or DisplayPort/MSP OSD backend.", ["OSD_TYPE"]),
        nativeControl("units", "OSD units", "Display unit system.", ["OSD_UNITS"]),
        nativeControl("options", "Display options", "Global OSD behavior and formatting flags.", ["OSD_OPTIONS"]),
        nativeControl("screen", "Enable primary screen", "Enable OSD screen 1.", ["OSD1_ENABLE"]),
      ],
    ),
    group(
      "alarms",
      "OSD alarms",
      "composite",
      OSD_INTENTS.alarms,
      "Flight Commander alarm fields write the equivalent ArduPilot OSD warning thresholds reported by the connected firmware.",
      [
        nativeControl("rssi", "Low RSSI warning", "Receiver signal warning threshold.", ["OSD_W_RSSI"]),
        nativeControl("link-quality", "Low link-quality warning", "Receiver link-quality warning threshold.", ["OSD_W_LQ"]),
        nativeControl("battery", "Low battery warning", "OSD battery-voltage warning threshold.", ["OSD_W_BAT_VOLT"]),
        nativeControl("satellites", "Low satellite warning", "Minimum satellite count warning.", ["OSD_W_NSAT"]),
        nativeControl("altitude", "Altitude warning", "Maximum altitude warning threshold.", ["OSD_W_ALT"]),
        nativeControl("distance", "Distance warning", "Maximum home-distance warning threshold.", ["OSD_W_DIST"]),
        nativeControl("current", "Current warning", "Maximum current warning threshold.", ["OSD_W_CURRENT"]),
        nativeControl("airspeed", "Airspeed warning", "Airspeed warning threshold.", ["OSD_W_ASPD"]),
      ],
    ),
    group(
      "digital-osd",
      "Digital OSD / DisplayPort",
      "equivalent",
      OSD_INTENTS.digital,
      "DJI/DisplayPort source and message behavior are controlled by ArduPilot's OSD backend, MSP options, serial protocol, and display options.",
      [
        nativeControl("msp-options", "MSP / DisplayPort options", "Digital OSD transport options.", ["MSP_OPTIONS"]),
        nativeControl("display-options", "Digital display options", "Global display behavior flags.", ["OSD_OPTIONS"]),
      ],
    ),
    group(
      "switch-indicators",
      "Switch indicators",
      "equivalent",
      OSD_INTENTS.switches,
      "ArduPilot displays flight mode, auxiliary-function, and named parameter elements instead of four fixed INAV switch-indicator slots. Enable and position those elements in the layout below.",
      [nativeControl("parameter-show", "Parameter display selection", "Parameter shown by the OSD parameter element.", ["OSD_PARAM_SHOW"])],
    ),
    group(
      "camera-hud",
      "Camera, pan servo, and HUD",
      "composite",
      OSD_INTENTS.camera,
      "Pan-servo range is routed through the mount/output system; horizon, waypoint, radar, and camera overlays are enabled and positioned using the reported OSD1 elements.",
      [
        nativeControl("mount-type", "Pan/tilt mount type", "Mount backend used by camera control.", ["MNT1_TYPE", "MNT_TYPE"]),
        nativeControl("pan-min", "Pan minimum angle", "Minimum pan angle.", ["MNT1_ANGMIN_PAN", "MNT_ANGMIN_PAN"]),
        nativeControl("pan-max", "Pan maximum angle", "Maximum pan angle.", ["MNT1_ANGMAX_PAN", "MNT_ANGMAX_PAN"]),
        nativeControl("horizon-enable", "Artificial horizon", "Enable the primary-screen horizon element.", ["OSD1_HORIZON_EN"]),
        nativeControl("waypoint-enable", "Waypoint display", "Enable waypoint information.", ["OSD1_WPNO_EN", "OSD1_XTRACK_EN"]),
        nativeControl("radar-enable", "Traffic / ADS-B display", "Enable traffic information where supported.", ["OSD1_ADSB_EN"]),
      ],
    ),
  ], { workflowCovers: intents("osd_element_enable osd_element_position osd_font_preview") }),

  led_strip: page("led_strip", [
    group(
      "notifications",
      "Notification LEDs",
      "equivalent",
      intents("Warnings Indicator ThrottleHue LarsonScanner blink landingBlink strobe led_layout led_colors mode_colors"),
      "ArduPilot drives compatible IOMCU, NeoPixel, Toshiba, and DroneCAN notification LEDs from a notification-event mask, brightness, and theme instead of an INAV pixel grid.",
      [
        nativeControl("types", "LED notification events", "Events and states shown by notification LEDs.", ["NTF_LED_TYPES"]),
        nativeControl("brightness", "LED brightness", "Brightness of compatible notification LEDs.", ["NTF_LED_BRIGHT"]),
        nativeControl("override", "LED override theme", "User-selected notification LED color/theme where supported.", ["NTF_OREO_THEME", "NTF_LED_OVERRIDE"]),
      ],
    ),
    group(
      "buzzer",
      "Buzzer notifications",
      "equivalent",
      intents("warning_audio status_audio landing_audio"),
      "The same notification events can be announced through ArduPilot's buzzer event mask.",
      [nativeControl("buzzer-types", "Buzzer events", "Events announced by the buzzer.", ["NTF_BUZZ_TYPES"])],
    ),
  ]),

  logging: page("onboard_logging", [
    group(
      "backend",
      "Onboard logging",
      "composite",
      intents("BLACKBOX blackbox_device blackbox_rate"),
      "INAV Blackbox device/rate selection maps to ArduPilot's file/MAVLink backend, logged message groups, rate limit, and disarmed logging behavior.",
      [
        nativeControl("backend", "Logging destination", "File, MAVLink, or supported backend mask.", ["LOG_BACKEND_TYPE"]),
        nativeControl("messages", "Logged message groups", "Sensor/control/navigation message bitmask.", ["LOG_BITMASK"]),
        nativeControl("rate", "Maximum log rate", "Maximum file logging rate.", ["LOG_FILE_RATEMAX"]),
        nativeControl("disarmed", "Log while disarmed", "Record logs before arming.", ["LOG_DISARMED"]),
      ],
    ),
    group(
      "log-files",
      "Log storage and download",
      "workflow",
      intents("dataflash_status erase_logs save_logs download_logs"),
      "Flight Commander lists, erases, and downloads ArduPilot DataFlash logs through the MAVLink log-transfer protocol.",
    ),
  ]),

  tethered_logging: page("logging", [
    group(
      "telemetry-log",
      "Tethered telemetry logging",
      "workflow",
      intents("MSP_RAW_IMU MSP_ATTITUDE MSP_ALTITUDE MSP_RAW_GPS MSP_ANALOG MSP_RC MSP_MOTOR MSP_DEBUG speed"),
      "The same Flight Commander checkboxes select equivalent MAVLink telemetry groups and the interval control sets the capture rate for a local timestamped log file.",
    ),
  ]),

  programming: page("programming", [
    group(
      "scripting",
      "Logic conditions and programmable controllers",
      "equivalent",
      intents("logic_conditions global_variables programmable_pid activators operands outputs"),
      "ArduPilot implements programmable conditions, state, and custom controllers with sandboxed Lua scripts. Flight Commander exposes the scripting runtime and user-variable parameters here; script editing uses the adjacent Programming Editor tab.",
      [
        nativeControl("enable", "Enable scripting", "Enable ArduPilot's onboard Lua scripting runtime.", ["SCR_ENABLE"]),
        nativeControl("heap", "Scripting memory", "Heap memory reserved for onboard scripts.", ["SCR_HEAP_SIZE"]),
        nativeControl("debug", "Scripting debug options", "Runtime debugging and checksum behavior.", ["SCR_DEBUG_OPTS"]),
        nativeControl("directory-mask", "Script directory options", "Disable selected script search paths where supported.", ["SCR_DIR_DISABLE"]),
        nativeControl("user1", "Script variable 1", "Persistent user value available to Lua scripts.", ["SCR_USER1"]),
        nativeControl("user2", "Script variable 2", "Persistent user value available to Lua scripts.", ["SCR_USER2"]),
        nativeControl("user3", "Script variable 3", "Persistent user value available to Lua scripts.", ["SCR_USER3"]),
        nativeControl("user4", "Script variable 4", "Persistent user value available to Lua scripts.", ["SCR_USER4"]),
      ],
    ),
  ]),

  javascript_programming: page("javascript_programming", [
    group(
      "script-editor",
      "Flight Commander programming editor",
      "equivalent",
      intents("editor examples validate load save clear api_reference flight_state rc_channels overrides global_variables"),
      "The Flight Commander editor targets ArduPilot Lua on this side. Familiar flight-state, RC, parameter, servo, relay, and notification examples replace the INAV logic-condition transpiler, and scripts can be saved locally or transferred to the controller's scripts directory.",
    ),
  ]),

  cli: page("cli", [
    group(
      "parameter-console",
      "ArduPilot command console",
      "equivalent",
      intents("commands help get set save diff clear copy load_file save_file reboot status"),
      "ArduPilot has no INAV-style firmware CLI. The same console surface provides safe get/set/diff/save/reboot/status commands backed by the downloaded ArduPilot parameter model and verified parameter writes.",
    ),
  ]),

  search: page("search", [
    group(
      "parameter-search",
      "Search settings",
      "workflow",
      intents("keyword results edit save native_parameter_link"),
      "Search covers every translated Flight Commander concept plus the connected controller's complete native parameter metadata. Results remain editable and verified through the same ArduPilot write service.",
    ),
  ]),
});

export const ARDUPILOT_FLIGHT_COMMANDER_PARITY = PARITY;

export function parityVehicleFamily(vehicleType) {
  return vehicleFamily(vehicleType);
}

export function groupsForVehicle(pageKey, vehicleType) {
  const family = parityVehicleFamily(vehicleType);
  return Object.freeze((PARITY[pageKey]?.groups ?? []).filter((definition) => (
    !definition.families?.length || definition.families.includes(family)
  )));
}

export function coveredIntentKeys(pageKey) {
  const definition = PARITY[pageKey];
  if (!definition) return Object.freeze([]);
  return Object.freeze([...new Set([
    ...definition.workflowCovers,
    ...definition.groups.flatMap((item) => item.covers),
  ])].sort());
}

export function resolveParityControl(parameters, definition) {
  const values = parameters instanceof Map
    ? [...parameters.values()]
    : Array.from(parameters ?? []);
  const byId = new Map(values.map((parameter) => [
    String(parameter?.id ?? "").toUpperCase(),
    parameter,
  ]));
  for (const candidate of definition?.candidates ?? []) {
    const parameter = byId.get(String(candidate).toUpperCase());
    if (parameter) return parameter;
  }
  return null;
}

export function parityContractSummary() {
  return Object.freeze(Object.fromEntries(
    Object.entries(PARITY).map(([key, definition]) => [key, Object.freeze({
      template: definition.template,
      groups: definition.groups.length,
      intents: coveredIntentKeys(key).length,
    })]),
  ));
}
