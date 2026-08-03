# Flight Commander settings reference

This index covers every static firmware setting exposed by the installed
Flight Commander graphical pages. A connected controller remains authoritative:
target builds can omit settings, add target-specific settings, or report different
ranges and defaults.

## Find a setting by name

Use the Configurator **Search** page for graphical controls. In CLI, query the
connected firmware directly:

```text
get setting_name
get partial_name
get *
```

Read the value, range, and unit returned by that firmware before using `set`.
Raw CLI units can differ from the converted Metric/Imperial values shown in the
interface. Use `diff all` for a reviewable backup before changing values.

See the [CLI command reference](CLI.md) for command safety and restore steps, and
the [configuration reference](CONFIGURATION_REFERENCE.md) for page workflows.

## Graphical setting index (246)

<a id="acc_hardware"></a>
### `acc_hardware`

Configurator page: Configuration.

<a id="antigravity_accelerator"></a>
### `antigravity_accelerator`

Configurator page: PID Tuning.

<a id="antigravity_cutoff_lpf_hz"></a>
### `antigravity_cutoff_lpf_hz`

Configurator page: PID Tuning.

<a id="antigravity_gain"></a>
### `antigravity_gain`

Configurator page: PID Tuning.

<a id="baro_hardware"></a>
### `baro_hardware`

Configurator page: Configuration.

<a id="cruise_power"></a>
### `cruise_power`

Configurator page: Advanced Tuning.

<a id="current_meter_type"></a>
### `current_meter_type`

Configurator page: Configuration.

<a id="d_boost_gyro_delta_lpf_hz"></a>
### `d_boost_gyro_delta_lpf_hz`

Configurator page: PID Tuning.

<a id="d_boost_max"></a>
### `d_boost_max`

Configurator page: PID Tuning.

<a id="d_boost_max_at_acceleration"></a>
### `d_boost_max_at_acceleration`

Configurator page: PID Tuning.

<a id="d_boost_min"></a>
### `d_boost_min`

Configurator page: PID Tuning.

<a id="dji_cn_alternating_duration"></a>
### `dji_cn_alternating_duration`

Configurator page: OSD.

<a id="dji_esc_temp_source"></a>
### `dji_esc_temp_source`

Configurator page: OSD.

<a id="dji_message_speed_source"></a>
### `dji_message_speed_source`

Configurator page: OSD.

<a id="dji_rssi_source"></a>
### `dji_rssi_source`

Configurator page: OSD.

<a id="dji_use_adjustments"></a>
### `dji_use_adjustments`

Configurator page: OSD.

<a id="dji_use_name_for_messages"></a>
### `dji_use_name_for_messages`

Configurator page: OSD.

<a id="dterm_lpf_hz"></a>
### `dterm_lpf_hz`

Configurator page: PID Tuning.

<a id="dynamic_gyro_notch_min_hz"></a>
### `dynamic_gyro_notch_min_hz`

Configurator page: PID Tuning.

<a id="dynamic_gyro_notch_mode"></a>
### `dynamic_gyro_notch_mode`

Configurator page: PID Tuning.

<a id="dynamic_gyro_notch_q"></a>
### `dynamic_gyro_notch_q`

Configurator page: PID Tuning.

<a id="failsafe_delay"></a>
### `failsafe_delay`

Configurator page: Failsafe.

<a id="failsafe_min_distance"></a>
### `failsafe_min_distance`

Configurator page: Failsafe.

<a id="failsafe_min_distance_procedure"></a>
### `failsafe_min_distance_procedure`

Configurator page: Failsafe.

<a id="failsafe_mission_delay"></a>
### `failsafe_mission_delay`

Configurator page: Advanced Tuning.

<a id="failsafe_off_delay"></a>
### `failsafe_off_delay`

Configurator page: Failsafe.

<a id="failsafe_throttle"></a>
### `failsafe_throttle`

Configurator page: Failsafe.

<a id="frsky_pitch_roll"></a>
### `frsky_pitch_roll`

Configurator page: Receiver.

<a id="fw_level_pitch_trim"></a>
### `fw_level_pitch_trim`

Configurator page: PID Tuning.

<a id="fw_loiter_direction"></a>
### `fw_loiter_direction`

Configurator page: Advanced Tuning.

<a id="fw_min_throttle_down_pitch"></a>
### `fw_min_throttle_down_pitch`

Configurator page: Advanced Tuning.

<a id="fw_tpa_time_constant"></a>
### `fw_tpa_time_constant`

Configurator page: PID Tuning.

<a id="fw_yaw_iterm_freeze_bank_angle"></a>
### `fw_yaw_iterm_freeze_bank_angle`

Configurator page: PID Tuning.

<a id="geozone_avoid_altitude_range"></a>
### `geozone_avoid_altitude_range`

Configurator page: Advanced Tuning.

<a id="geozone_detection_distance"></a>
### `geozone_detection_distance`

Configurator page: Advanced Tuning.

<a id="geozone_mr_stop_distance"></a>
### `geozone_mr_stop_distance`

Configurator page: Advanced Tuning.

<a id="geozone_no_way_home_action"></a>
### `geozone_no_way_home_action`

Configurator page: Advanced Tuning.

<a id="geozone_safe_altitude_distance"></a>
### `geozone_safe_altitude_distance`

Configurator page: Advanced Tuning.

<a id="geozone_safehome_as_inclusive"></a>
### `geozone_safehome_as_inclusive`

Configurator page: Advanced Tuning.

<a id="geozone_safehome_zone_action"></a>
### `geozone_safehome_zone_action`

Configurator page: Advanced Tuning.

<a id="gimbal_pan_channel"></a>
### `gimbal_pan_channel`

Configurator page: Configuration.

<a id="gimbal_roll_channel"></a>
### `gimbal_roll_channel`

Configurator page: Configuration.

<a id="gimbal_sensitivity"></a>
### `gimbal_sensitivity`

Configurator page: Configuration.

<a id="gimbal_tilt_channel"></a>
### `gimbal_tilt_channel`

Configurator page: Configuration.

<a id="gps_ublox_nav_hz"></a>
### `gps_ublox_nav_hz`

Configurator page: GPS and RTK.

<a id="gps_ublox_use_beidou"></a>
### `gps_ublox_use_beidou`

Configurator page: GPS and RTK.

<a id="gps_ublox_use_galileo"></a>
### `gps_ublox_use_galileo`

Configurator page: GPS and RTK.

<a id="gps_ublox_use_glonass"></a>
### `gps_ublox_use_glonass`

Configurator page: GPS and RTK.

<a id="gyro_dyn_lpf_curve_expo"></a>
### `gyro_dyn_lpf_curve_expo`

Configurator page: PID Tuning.

<a id="gyro_dyn_lpf_max_hz"></a>
### `gyro_dyn_lpf_max_hz`

Configurator page: PID Tuning.

<a id="gyro_dyn_lpf_min_hz"></a>
### `gyro_dyn_lpf_min_hz`

Configurator page: PID Tuning.

<a id="gyro_main_lpf_hz"></a>
### `gyro_main_lpf_hz`

Configurator page: PID Tuning.

<a id="heading_hold_rate_limit"></a>
### `heading_hold_rate_limit`

Configurator page: PID Tuning.

<a id="headtracker_pan_ratio"></a>
### `headtracker_pan_ratio`

Configurator page: Configuration.

<a id="headtracker_roll_ratio"></a>
### `headtracker_roll_ratio`

Configurator page: Configuration.

<a id="headtracker_tilt_ratio"></a>
### `headtracker_tilt_ratio`

Configurator page: Configuration.

<a id="headtracker_type"></a>
### `headtracker_type`

Configurator page: Configuration.

<a id="i2c_speed"></a>
### `i2c_speed`

Configurator page: Configuration.

<a id="idle_power"></a>
### `idle_power`

Configurator page: Advanced Tuning.

<a id="inav_allow_dead_reckoning"></a>
### `inav_allow_dead_reckoning`

Configurator page: Advanced Tuning.

<a id="limit_burst_current"></a>
### `limit_burst_current`

Configurator page: Configuration.

<a id="limit_burst_current_falldown_time"></a>
### `limit_burst_current_falldown_time`

Configurator page: Configuration.

<a id="limit_burst_current_time"></a>
### `limit_burst_current_time`

Configurator page: Configuration.

<a id="limit_burst_power"></a>
### `limit_burst_power`

Configurator page: Configuration.

<a id="limit_burst_power_falldown_time"></a>
### `limit_burst_power_falldown_time`

Configurator page: Configuration.

<a id="limit_burst_power_time"></a>
### `limit_burst_power_time`

Configurator page: Configuration.

<a id="limit_cont_current"></a>
### `limit_cont_current`

Configurator page: Configuration.

<a id="limit_cont_power"></a>
### `limit_cont_power`

Configurator page: Configuration.

<a id="mag_hardware"></a>
### `mag_hardware`

Configurator page: Configuration.

<a id="max_angle_inclination_pit"></a>
### `max_angle_inclination_pit`

Configurator page: PID Tuning.

<a id="max_angle_inclination_rll"></a>
### `max_angle_inclination_rll`

Configurator page: PID Tuning.

<a id="mc_iterm_relax_cutoff"></a>
### `mc_iterm_relax_cutoff`

Configurator page: PID Tuning.

<a id="mixer_control_profile_linking"></a>
### `mixer_control_profile_linking`

Configurator page: Mixer.

<a id="motor_direction_inverted"></a>
### `motor_direction_inverted`

Configurator page: Mixer.

<a id="motor_poles"></a>
### `motor_poles`

Configurator page: Outputs.

<a id="motorstop_on_low"></a>
### `motorstop_on_low`

Configurator page: Outputs.

<a id="name"></a>
### `name`

Configurator page: OSD.

<a id="nav_auto_speed"></a>
### `nav_auto_speed`

Configurator page: Advanced Tuning.

<a id="nav_cruise_yaw_rate"></a>
### `nav_cruise_yaw_rate`

Configurator page: Advanced Tuning.

<a id="nav_emerg_landing_speed"></a>
### `nav_emerg_landing_speed`

Configurator page: Advanced Tuning.

<a id="nav_fw_allow_manual_thr_increase"></a>
### `nav_fw_allow_manual_thr_increase`

Configurator page: Advanced Tuning.

<a id="nav_fw_alt_control_response"></a>
### `nav_fw_alt_control_response`

Configurator page: Advanced Tuning.

<a id="nav_fw_bank_angle"></a>
### `nav_fw_bank_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_climb_angle"></a>
### `nav_fw_climb_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_control_smoothness"></a>
### `nav_fw_control_smoothness`

Configurator page: Advanced Tuning.

<a id="nav_fw_cruise_speed"></a>
### `nav_fw_cruise_speed`

Configurator page: Advanced Tuning.

<a id="nav_fw_cruise_thr"></a>
### `nav_fw_cruise_thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_dive_angle"></a>
### `nav_fw_dive_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_approach_length"></a>
### `nav_fw_land_approach_length`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_final_approach_pitch2throttle_mod"></a>
### `nav_fw_land_final_approach_pitch2throttle_mod`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_flare_alt"></a>
### `nav_fw_land_flare_alt`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_flare_pitch"></a>
### `nav_fw_land_flare_pitch`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_glide_alt"></a>
### `nav_fw_land_glide_alt`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_glide_pitch"></a>
### `nav_fw_land_glide_pitch`

Configurator page: Advanced Tuning.

<a id="nav_fw_land_max_tailwind"></a>
### `nav_fw_land_max_tailwind`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_climb_angle"></a>
### `nav_fw_launch_climb_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_end_time"></a>
### `nav_fw_launch_end_time`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_idle_motor_delay"></a>
### `nav_fw_launch_idle_motor_delay`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_idle_thr"></a>
### `nav_fw_launch_idle_thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_max_altitude"></a>
### `nav_fw_launch_max_altitude`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_max_angle"></a>
### `nav_fw_launch_max_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_min_time"></a>
### `nav_fw_launch_min_time`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_motor_delay"></a>
### `nav_fw_launch_motor_delay`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_spinup_time"></a>
### `nav_fw_launch_spinup_time`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_thr"></a>
### `nav_fw_launch_thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_timeout"></a>
### `nav_fw_launch_timeout`

Configurator page: Advanced Tuning.

<a id="nav_fw_launch_wiggle_to_wake_idle"></a>
### `nav_fw_launch_wiggle_to_wake_idle`

Configurator page: Advanced Tuning.

<a id="nav_fw_loiter_radius"></a>
### `nav_fw_loiter_radius`

Configurator page: Advanced Tuning.

<a id="nav_fw_manual_climb_rate"></a>
### `nav_fw_manual_climb_rate`

Configurator page: Advanced Tuning.

<a id="nav_fw_max_thr"></a>
### `nav_fw_max_thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_min_thr"></a>
### `nav_fw_min_thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_pitch2thr"></a>
### `nav_fw_pitch2thr`

Configurator page: Advanced Tuning.

<a id="nav_fw_pitch2thr_smoothing"></a>
### `nav_fw_pitch2thr_smoothing`

Configurator page: Advanced Tuning.

<a id="nav_fw_pitch2thr_threshold"></a>
### `nav_fw_pitch2thr_threshold`

Configurator page: Advanced Tuning.

<a id="nav_fw_soaring_motor_stop"></a>
### `nav_fw_soaring_motor_stop`

Configurator page: Advanced Tuning.

<a id="nav_fw_soaring_pitch_deadband"></a>
### `nav_fw_soaring_pitch_deadband`

Configurator page: Advanced Tuning.

<a id="nav_fw_wp_tracking_accuracy"></a>
### `nav_fw_wp_tracking_accuracy`

Configurator page: Advanced Tuning.

<a id="nav_fw_wp_tracking_max_angle"></a>
### `nav_fw_wp_tracking_max_angle`

Configurator page: Advanced Tuning.

<a id="nav_fw_wp_turn_smoothing"></a>
### `nav_fw_wp_turn_smoothing`

Configurator page: Advanced Tuning.

<a id="nav_land_maxalt_vspd"></a>
### `nav_land_maxalt_vspd`

Configurator page: Advanced Tuning.

<a id="nav_land_minalt_vspd"></a>
### `nav_land_minalt_vspd`

Configurator page: Advanced Tuning.

<a id="nav_land_slowdown_maxalt"></a>
### `nav_land_slowdown_maxalt`

Configurator page: Advanced Tuning.

<a id="nav_land_slowdown_minalt"></a>
### `nav_land_slowdown_minalt`

Configurator page: Advanced Tuning.

<a id="nav_manual_speed"></a>
### `nav_manual_speed`

Configurator page: Advanced Tuning.

<a id="nav_max_altitude"></a>
### `nav_max_altitude`

Configurator page: Advanced Tuning.

<a id="nav_max_auto_speed"></a>
### `nav_max_auto_speed`

Configurator page: Advanced Tuning.

<a id="nav_mc_althold_throttle"></a>
### `nav_mc_althold_throttle`

Configurator page: Advanced Tuning.

<a id="nav_mc_auto_climb_rate"></a>
### `nav_mc_auto_climb_rate`

Configurator page: Advanced Tuning.

<a id="nav_mc_bank_angle"></a>
### `nav_mc_bank_angle`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_bank_angle"></a>
### `nav_mc_braking_bank_angle`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_boost_disengage_speed"></a>
### `nav_mc_braking_boost_disengage_speed`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_boost_factor"></a>
### `nav_mc_braking_boost_factor`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_boost_speed_threshold"></a>
### `nav_mc_braking_boost_speed_threshold`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_boost_timeout"></a>
### `nav_mc_braking_boost_timeout`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_disengage_speed"></a>
### `nav_mc_braking_disengage_speed`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_speed_threshold"></a>
### `nav_mc_braking_speed_threshold`

Configurator page: Advanced Tuning.

<a id="nav_mc_braking_timeout"></a>
### `nav_mc_braking_timeout`

Configurator page: Advanced Tuning.

<a id="nav_mc_hover_thr"></a>
### `nav_mc_hover_thr`

Configurator page: Advanced Tuning.

<a id="nav_mc_manual_climb_rate"></a>
### `nav_mc_manual_climb_rate`

Configurator page: Advanced Tuning.

<a id="nav_mc_wp_slowdown"></a>
### `nav_mc_wp_slowdown`

Configurator page: Advanced Tuning.

<a id="nav_min_rth_distance"></a>
### `nav_min_rth_distance`

Configurator page: Advanced Tuning.

<a id="nav_overrides_motor_stop"></a>
### `nav_overrides_motor_stop`

Configurator page: Advanced Tuning.

<a id="nav_rth_abort_threshold"></a>
### `nav_rth_abort_threshold`

Configurator page: Advanced Tuning.

<a id="nav_rth_allow_landing"></a>
### `nav_rth_allow_landing`

Configurator page: Advanced Tuning.

<a id="nav_rth_alt_control_override"></a>
### `nav_rth_alt_control_override`

Configurator page: Advanced Tuning.

<a id="nav_rth_alt_mode"></a>
### `nav_rth_alt_mode`

Configurator page: Advanced Tuning.

<a id="nav_rth_altitude"></a>
### `nav_rth_altitude`

Configurator page: Advanced Tuning.

<a id="nav_rth_climb_first"></a>
### `nav_rth_climb_first`

Configurator page: Advanced Tuning.

<a id="nav_rth_climb_first_stage_altitude"></a>
### `nav_rth_climb_first_stage_altitude`

Configurator page: Advanced Tuning.

<a id="nav_rth_climb_first_stage_mode"></a>
### `nav_rth_climb_first_stage_mode`

Configurator page: Advanced Tuning.

<a id="nav_rth_climb_ignore_emerg"></a>
### `nav_rth_climb_ignore_emerg`

Configurator page: Advanced Tuning.

<a id="nav_rth_home_altitude"></a>
### `nav_rth_home_altitude`

Configurator page: Advanced Tuning.

<a id="nav_rth_linear_descent_start_distance"></a>
### `nav_rth_linear_descent_start_distance`

Configurator page: Advanced Tuning.

<a id="nav_rth_tail_first"></a>
### `nav_rth_tail_first`

Configurator page: Advanced Tuning.

<a id="nav_rth_trackback_distance"></a>
### `nav_rth_trackback_distance`

Configurator page: Advanced Tuning.

<a id="nav_rth_trackback_mode"></a>
### `nav_rth_trackback_mode`

Configurator page: Advanced Tuning.

<a id="nav_rth_use_linear_descent"></a>
### `nav_rth_use_linear_descent`

Configurator page: Advanced Tuning.

<a id="nav_user_control_mode"></a>
### `nav_user_control_mode`

Configurator page: Advanced Tuning.

<a id="nav_wp_enforce_altitude"></a>
### `nav_wp_enforce_altitude`

Configurator page: Advanced Tuning.

<a id="nav_wp_load_on_boot"></a>
### `nav_wp_load_on_boot`

Configurator page: Advanced Tuning.

<a id="nav_wp_max_safe_distance"></a>
### `nav_wp_max_safe_distance`

Configurator page: Advanced Tuning.

<a id="nav_wp_radius"></a>
### `nav_wp_radius`

Configurator page: Advanced Tuning.

<a id="opflow_hardware"></a>
### `opflow_hardware`

Configurator page: Configuration.

<a id="osd_adsb_distance_alert"></a>
### `osd_adsb_distance_alert`

Configurator page: OSD.

<a id="osd_adsb_distance_warning"></a>
### `osd_adsb_distance_warning`

Configurator page: OSD.

<a id="osd_airspeed_alarm_max"></a>
### `osd_airspeed_alarm_max`

Configurator page: OSD.

<a id="osd_airspeed_alarm_min"></a>
### `osd_airspeed_alarm_min`

Configurator page: OSD.

<a id="osd_alt_alarm"></a>
### `osd_alt_alarm`

Configurator page: OSD.

<a id="osd_baro_temp_alarm_max"></a>
### `osd_baro_temp_alarm_max`

Configurator page: OSD.

<a id="osd_baro_temp_alarm_min"></a>
### `osd_baro_temp_alarm_min`

Configurator page: OSD.

<a id="osd_camera_fov_h"></a>
### `osd_camera_fov_h`

Configurator page: OSD.

<a id="osd_camera_fov_v"></a>
### `osd_camera_fov_v`

Configurator page: OSD.

<a id="osd_camera_uptilt"></a>
### `osd_camera_uptilt`

Configurator page: OSD.

<a id="osd_coordinate_digits"></a>
### `osd_coordinate_digits`

Configurator page: OSD.

<a id="osd_crosshairs_style"></a>
### `osd_crosshairs_style`

Configurator page: OSD.

<a id="osd_crsf_lq_format"></a>
### `osd_crsf_lq_format`

Configurator page: OSD.

<a id="osd_current_alarm"></a>
### `osd_current_alarm`

Configurator page: OSD.

<a id="osd_decimals_altitude"></a>
### `osd_decimals_altitude`

Configurator page: OSD.

<a id="osd_decimals_distance"></a>
### `osd_decimals_distance`

Configurator page: OSD.

<a id="osd_dist_alarm"></a>
### `osd_dist_alarm`

Configurator page: OSD.

<a id="osd_esc_rpm_precision"></a>
### `osd_esc_rpm_precision`

Configurator page: OSD.

<a id="osd_esc_temp_alarm_max"></a>
### `osd_esc_temp_alarm_max`

Configurator page: OSD.

<a id="osd_esc_temp_alarm_min"></a>
### `osd_esc_temp_alarm_min`

Configurator page: OSD.

<a id="osd_gforce_alarm"></a>
### `osd_gforce_alarm`

Configurator page: OSD.

<a id="osd_gforce_axis_alarm_max"></a>
### `osd_gforce_axis_alarm_max`

Configurator page: OSD.

<a id="osd_gforce_axis_alarm_min"></a>
### `osd_gforce_axis_alarm_min`

Configurator page: OSD.

<a id="osd_home_position_arm_screen"></a>
### `osd_home_position_arm_screen`

Configurator page: OSD.

<a id="osd_horizon_offset"></a>
### `osd_horizon_offset`

Configurator page: OSD.

<a id="osd_hud_radar_disp"></a>
### `osd_hud_radar_disp`

Configurator page: OSD.

<a id="osd_hud_radar_range_max"></a>
### `osd_hud_radar_range_max`

Configurator page: OSD.

<a id="osd_hud_radar_range_min"></a>
### `osd_hud_radar_range_min`

Configurator page: OSD.

<a id="osd_hud_wp_disp"></a>
### `osd_hud_wp_disp`

Configurator page: OSD.

<a id="osd_imu_temp_alarm_max"></a>
### `osd_imu_temp_alarm_max`

Configurator page: OSD.

<a id="osd_imu_temp_alarm_min"></a>
### `osd_imu_temp_alarm_min`

Configurator page: OSD.

<a id="osd_left_sidebar_scroll"></a>
### `osd_left_sidebar_scroll`

Configurator page: OSD.

<a id="osd_link_quality_alarm"></a>
### `osd_link_quality_alarm`

Configurator page: OSD.

<a id="osd_mah_precision"></a>
### `osd_mah_precision`

Configurator page: OSD.

<a id="osd_main_voltage_decimals"></a>
### `osd_main_voltage_decimals`

Configurator page: OSD.

<a id="osd_neg_alt_alarm"></a>
### `osd_neg_alt_alarm`

Configurator page: OSD.

<a id="osd_pan_servo_index"></a>
### `osd_pan_servo_index`

Configurator page: OSD.

<a id="osd_pan_servo_indicator_show_degrees"></a>
### `osd_pan_servo_indicator_show_degrees`

Configurator page: OSD.

<a id="osd_pan_servo_offcentre_warning"></a>
### `osd_pan_servo_offcentre_warning`

Configurator page: OSD.

<a id="osd_pan_servo_range_decadegrees"></a>
### `osd_pan_servo_range_decadegrees`

Configurator page: OSD.

<a id="osd_plus_code_digits"></a>
### `osd_plus_code_digits`

Configurator page: OSD.

<a id="osd_plus_code_short"></a>
### `osd_plus_code_short`

Configurator page: OSD.

<a id="osd_right_sidebar_scroll"></a>
### `osd_right_sidebar_scroll`

Configurator page: OSD.

<a id="osd_rssi_alarm"></a>
### `osd_rssi_alarm`

Configurator page: OSD.

<a id="osd_rssi_dbm_alarm"></a>
### `osd_rssi_dbm_alarm`

Configurator page: OSD.

<a id="osd_sidebar_scroll_arrows"></a>
### `osd_sidebar_scroll_arrows`

Configurator page: OSD.

<a id="osd_snr_alarm"></a>
### `osd_snr_alarm`

Configurator page: OSD.

<a id="osd_speed_source"></a>
### `osd_speed_source`

Configurator page: OSD.

<a id="osd_switch_indicator_one_channel"></a>
### `osd_switch_indicator_one_channel`

Configurator page: OSD.

<a id="osd_switch_indicator_one_name"></a>
### `osd_switch_indicator_one_name`

Configurator page: OSD.

<a id="osd_switch_indicator_three_channel"></a>
### `osd_switch_indicator_three_channel`

Configurator page: OSD.

<a id="osd_switch_indicator_three_name"></a>
### `osd_switch_indicator_three_name`

Configurator page: OSD.

<a id="osd_switch_indicator_two_channel"></a>
### `osd_switch_indicator_two_channel`

Configurator page: OSD.

<a id="osd_switch_indicator_two_name"></a>
### `osd_switch_indicator_two_name`

Configurator page: OSD.

<a id="osd_switch_indicator_zero_channel"></a>
### `osd_switch_indicator_zero_channel`

Configurator page: OSD.

<a id="osd_switch_indicator_zero_name"></a>
### `osd_switch_indicator_zero_name`

Configurator page: OSD.

<a id="osd_switch_indicators_align_left"></a>
### `osd_switch_indicators_align_left`

Configurator page: OSD.

<a id="osd_time_alarm"></a>
### `osd_time_alarm`

Configurator page: OSD.

<a id="osd_use_pilot_logo"></a>
### `osd_use_pilot_logo`

Configurator page: OSD.

<a id="pilot_name"></a>
### `pilot_name`

Configurator page: OSD.

<a id="pitot_hardware"></a>
### `pitot_hardware`

Configurator page: Configuration.

<a id="rangefinder_hardware"></a>
### `rangefinder_hardware`

Configurator page: Configuration.

<a id="rc_filter_smoothing_factor"></a>
### `rc_filter_smoothing_factor`

Configurator page: Receiver.

<a id="receiver_type"></a>
### `receiver_type`

Configurator page: Receiver.

<a id="rpm_gyro_filter_enabled"></a>
### `rpm_gyro_filter_enabled`

Configurator page: PID Tuning.

<a id="rpm_gyro_min_hz"></a>
### `rpm_gyro_min_hz`

Configurator page: PID Tuning.

<a id="rssi_source"></a>
### `rssi_source`

Configurator page: Receiver.

<a id="rth_energy_margin"></a>
### `rth_energy_margin`

Configurator page: Advanced Tuning.

<a id="safehome_max_distance"></a>
### `safehome_max_distance`

Configurator page: Advanced Tuning.

<a id="safehome_usage_mode"></a>
### `safehome_usage_mode`

Configurator page: Advanced Tuning.

<a id="serialrx_halfduplex"></a>
### `serialrx_halfduplex`

Configurator page: Receiver.

<a id="serialrx_inverted"></a>
### `serialrx_inverted`

Configurator page: Receiver.

<a id="serialrx_provider"></a>
### `serialrx_provider`

Configurator page: Receiver.

<a id="setpoint_kalman_q"></a>
### `setpoint_kalman_q`

Configurator page: PID Tuning.

<a id="simip"></a>
### `simip`

Configurator page: sitl.

<a id="smartport_fuel_unit"></a>
### `smartport_fuel_unit`

Configurator page: Receiver.

<a id="throttle_idle"></a>
### `throttle_idle`

Configurator page: Outputs.

<a id="throttle_scale"></a>
### `throttle_scale`

Configurator page: Outputs.

<a id="tpa_breakpoint"></a>
### `tpa_breakpoint`

Configurator page: PID Tuning.

<a id="tpa_rate"></a>
### `tpa_rate`

Configurator page: PID Tuning.

<a id="tz_automatic_dst"></a>
### `tz_automatic_dst`

Configurator page: GPS and RTK.

<a id="tz_offset"></a>
### `tz_offset`

Configurator pages: Alignment Tool, GPS and RTK.

<a id="vbat_meter_type"></a>
### `vbat_meter_type`

Configurator page: Configuration.

## Settings not listed here

Flight Commander-only schemas such as heading-fusion source records are
capability-gated protocol structures rather than ordinary CLI setting names.
They are documented in the relevant feature guide. Conversely, a target may
publish CLI settings that have no graphical control. Use `get *` and `help` on
that connected firmware for the complete runtime schema.

Generated from `tabs/*.html` by
`scripts/generate-flight-commander-settings-docs.mjs`.
