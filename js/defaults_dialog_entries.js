'use strict';

import { INAV_LARGE_MULTIROTOR_PRESETS } from './presets/inavMultirotorPresets.js';

var defaultsDialogData = [
    {
        "title": 'Mini Quad with 3" propellers',
        "description": 'INAV 9.1 prop-size baseline · 90 Hz filters · compact 3-inch Quad X',
        "propInches": 3,
        "presetFamily": "flight-commander-multirotor",
        "id": 6,
        "notRecommended": false,
        "reboot": true,
        "mixerToApply": 3,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 3
            },
            {
                key: "motor_pwm_protocol",
                value: "DSHOT300"
            },
            /*
            Ez Tune setup
            */
            {
                key: "ez_enabled",
                value: "ON"
            },
            {
                key: "ez_filter_hz",
                value: 90
            },
            {
                key: "ez_axis_ratio",
                value: 116
            },
            {
                key: "ez_response",
                value: 71
            },
            {
                key: "ez_damping",
                value: 103
            },
            {
                key: "ez_stability",
                value: 105
            },
            {
                key: "ez_aggressiveness",
                value: 100
            },
            {
                key: "ez_rate",
                value: 134
            },
            {
                key: "ez_expo",
                value: 118
            },
            {
                key: "ez_snappiness",
                value: 0
            },
            /*
            Mechanics
            */
            {
                key: "airmode_type",
                value: "THROTTLE_THRESHOLD"
            },
            {
                key: "airmode_throttle_threshold",
                value: 1150
            },
            {
                key: "mc_iterm_relax",
                value: "RP"
            },
            {
                key: "d_boost_min",
                value: 1.0,
                optional: true
            },
            {
                key: "d_boost_max",
                value: 1.0,
                optional: true
            },
            {
                key: "antigravity_gain",
                value: 2,
                optional: true
            },
            {
                key: "antigravity_accelerator",
                value: 5,
                optional: true
            },
            /*
                * TPA
                */
            {
                key: "tpa_rate",
                value: 20
            },
            {
                key: "tpa_breakpoint",
                value: 1200
            },
            {
                key: "platform_type",
                value: "MULTIROTOR"
            },
            {
                key: "applied_defaults",
                value: 6
            },
            {
                key: "failsafe_procedure",
                value: "DROP"
            }
        ]
    },
    {
        "title": 'Mini Quad with 5" propellers',
        "description": 'INAV 9.1 prop-size baseline · 110 Hz filters · responsive 5-inch Quad X',
        "propInches": 5,
        "presetFamily": "flight-commander-multirotor",
        "id": 2,
        "notRecommended": false,
        "reboot": true,
        "mixerToApply": 3,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 3
            },
            {
                key: "motor_pwm_protocol",
                value: "DSHOT300"
            },
            /*
            Ez Tune setup
            */
            {
                key: "ez_enabled",
                value: "ON"
            },
            {
                key: "ez_filter_hz",
                value: 110
            },
            {
                key: "ez_axis_ratio",
                value: 110
            },
            {
                key: "ez_response",
                value: 92
            },
            {
                key: "ez_damping",
                value: 108
            },
            {
                key: "ez_stability",
                value: 110
            },
            {
                key: "ez_aggressiveness",
                value: 80
            },
            {
                key: "ez_rate",
                value: 134
            },
            {
                key: "ez_expo",
                value: 118
            },
            {
                key: "ez_snappiness",
                value: 0
            },
            /*
            Mechanics
            */
            {
                key: "airmode_type",
                value: "THROTTLE_THRESHOLD"
            },
            {
                key: "airmode_throttle_threshold",
                value: 1150
            },
            {
                key: "mc_iterm_relax",
                value: "RP"
            },
            {
                key: "d_boost_min",
                value: 1.0,
                optional: true
            },
            {
                key: "d_boost_max",
                value: 1.0,
                optional: true
            },
            {
                key: "antigravity_gain",
                value: 2,
                optional: true
            },
            {
                key: "antigravity_accelerator",
                value: 5,
                optional: true
            },
            /*
             * TPA
             */
            {
                key: "tpa_rate",
                value: 20
            },
            {
                key: "tpa_breakpoint",
                value: 1200
            },
            {
                key: "platform_type",
                value: "MULTIROTOR"
            },
            {
                key: "applied_defaults",
                value: 2
            },
            {
                key: "failsafe_procedure",
                value: "DROP"
            }
        ]
    },
    {
        "title": 'Mini Quad with 7" propellers',
        "description": 'INAV 9.1 prop-size baseline · 90 Hz filters · long-range 7-inch Quad X',
        "propInches": 7,
        "presetFamily": "flight-commander-multirotor",
        "id": 5,
        "notRecommended": false,
        "reboot": true,
        "mixerToApply": 3,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 3
            },
            {
                key: "motor_pwm_protocol",
                value: "DSHOT300"
            },
            /*
            Ez Tune setup
            */
            {
                key: "ez_enabled",
                value: "ON"
            },
            {
                key: "ez_filter_hz",
                value: 90
            },
            {
                key: "ez_axis_ratio",
                value: 110
            },
            {
                key: "ez_response",
                value: 101
            },
            {
                key: "ez_damping",
                value: 115
            },
            {
                key: "ez_stability",
                value: 100
            },
            {
                key: "ez_aggressiveness",
                value: 100
            },
            {
                key: "ez_rate",
                value: 134
            },
            {
                key: "ez_expo",
                value: 118
            },
            {
                key: "ez_snappiness",
                value: 20
            },
            /*
            Mechanics
            */
            {
                key: "airmode_type",
                value: "THROTTLE_THRESHOLD"
            },
            {
                key: "airmode_throttle_threshold",
                value: 1150
            },
            {
                key: "mc_iterm_relax",
                value: "RPY"
            },
            {
                key: "d_boost_min",
                value: 0.8,
                optional: true
            },
            {
                key: "d_boost_max",
                value: 1.2,
                optional: true
            },
            {
                key: "antigravity_gain",
                value: 2,
                optional: true
            },
            {
                key: "antigravity_accelerator",
                value: 5,
                optional: true
            },
            /*
             * TPA
             */
            {
                key: "tpa_rate",
                value: 20
            },
            {
                key: "tpa_breakpoint",
                value: 1200
            },
            {
                key: "platform_type",
                value: "MULTIROTOR"
            },
            {
                key: "applied_defaults",
                value: 5
            },
            {
                key: "failsafe_procedure",
                value: "DROP"
            }
        ]
    },
    ...INAV_LARGE_MULTIROTOR_PRESETS,
    {
        "title": 'Airplane with a Tail',
        "description": 'Conservative INAV 9.1 conventional-tail starting point with moderate bank, launch, and navigation response',
        "presetFamily": "flight-commander-fixed-wing",
        "notRecommended": false,
        "id": 3,
        "reboot": true,
        "mixerToApply": 14,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 14
            },
            {
                key: "platform_type",
                value: "AIRPLANE"
            },
            {
                key: "applied_defaults",
                value: 3
            },
            {
                key: "looptime",
                value: 1000
            },
            {
                key: "gyro_main_lpf_hz",
                value: 25
            },
            {
                key: "dterm_lpf_hz",
                value: 10
            },
            {
                key: "d_boost_min",
                value: 1,
                optional: true
            },
            {
                key: "d_boost_max",
                value: 1,
                optional: true
            },
            {
                key: "dynamic_gyro_notch_enabled",
                value: "ON",
                optional: true
            },
            {
                key: "dynamic_gyro_notch_q",
                value: 250,
                optional: true
            },
            {
                key: "dynamic_gyro_notch_min_hz",
                value: 30,
                optional: true
            },
            {
                key: "motor_pwm_protocol",
                value: "STANDARD"
            },
            {
                key: "ahrs_inertia_comp_method",
                value: "ADAPTIVE"
            },
            {
                key: "throttle_idle",
                value: 5.0
            },
            {
                key: "rc_yaw_expo",
                value: 30
            },
            {
                key: "rc_expo",
                value: 30
            },
            {
                key: "roll_rate",
                value: 18
            },
            {
                key: "pitch_rate",
                value: 9
            },
            {
                key: "yaw_rate",
                value: 3
            },
            {
                key: "nav_fw_pos_xy_p",
                value: 55
            },
            {
                key: "fw_turn_assist_pitch_gain",
                value: 0.4
            },
            {
                key: "max_angle_inclination_rll",
                value: 450
            },
            {
                key: "nav_fw_bank_angle",
                value: 35
            },
            {
                key: "fw_p_pitch",
                value: 15
            },
            {
                key: "fw_i_pitch",
                value: 5
            },
            {
                key: "fw_d_pitch",
                value: 5
            },
            {
                key: "fw_ff_pitch",
                value: 80
            },
            {
                key: "fw_p_roll",
                value: 15
            },
            {
                key: "fw_i_roll",
                value: 3
            },
            {
                key: "fw_d_roll",
                value: 7
            },
            {
                key: "fw_ff_roll",
                value: 50
            },
            {
                key: "fw_p_yaw",
                value: 50
            },
            {
                key: "fw_i_yaw",
                value: 0
            },
            {
                key: "fw_d_yaw",
                value: 20
            },
            {
                key: "fw_ff_yaw",
                value: 255
            },
            {
                key: "nav_fw_pos_z_p",
                value: 22
            },
            {
                key: "nav_fw_pos_z_i",
                value: 6
            },
            {
                key: "nav_fw_pos_z_d",
                value: 2
            },
            {
                key: "nav_fw_pos_z_ff",
                value: 25
            },
            {
                key: "nav_fw_alt_control_response",
                value: 45
            },
            {
                key: "airmode_type",
                value: "STICK_CENTER_ONCE"
            },
            {
                key: "small_angle",
                value: 180
            },
            {
                key: "nav_fw_control_smoothness",
                value: 2
            },
            {
                key: "nav_rth_allow_landing",
                value: "FS_ONLY"
            },
            {
                key: "nav_rth_altitude",
                value: 5000
            },
            {
                key: "nav_wp_radius",
                value: 800
            },
            {
                key: "nav_wp_max_safe_distance",
                value: 500
            },
            {
                key: "nav_fw_launch_max_angle",
                value: 45
            },
            {
                key: "nav_fw_launch_motor_delay",
                value: 100
            },
            {
                key: "nav_fw_launch_max_altitude",
                value: 5000
            },
            /*
             * TPA
             */
            {
                key: "tpa_rate",
                value: 80
            },
        ],
    },
    {
        "title": 'Airplane without a Tail (Wing, Delta, etc)',
        "description": 'Conservative INAV 9.1 flying-wing/delta starting point with the correct elevon mixer and wider launch-angle allowance',
        "presetFamily": "flight-commander-fixed-wing",
        "notRecommended": false,
        "id": 4,
        "reboot": true,
        "mixerToApply": 8,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 8
            },
            {
                key: "platform_type",
                value: "AIRPLANE"
            },
            {
                key: "applied_defaults",
                value: 4
            },
            {
                key: "looptime",
                value: 1000
            },
            {
                key: "gyro_main_lpf_hz",
                value: 25
            },
            {
                key: "dterm_lpf_hz",
                value: 10
            },
            {
                key: "d_boost_min",
                value: 1,
                optional: true
            },
            {
                key: "d_boost_max",
                value: 1,
                optional: true
            },
            {
                key: "dynamic_gyro_notch_enabled",
                value: "ON",
                optional: true
            },
            {
                key: "dynamic_gyro_notch_q",
                value: 250,
                optional: true
            },
            {
                key: "dynamic_gyro_notch_min_hz",
                value: 30,
                optional: true
            },
            {
                key: "motor_pwm_protocol",
                value: "STANDARD"
            },
            {
                key: "ahrs_inertia_comp_method",
                value: "ADAPTIVE"
            },
            {
                key: "throttle_idle",
                value: 5.0
            },
            {
                key: "rc_yaw_expo",
                value: 30
            },
            {
                key: "rc_expo",
                value: 30
            },
            {
                key: "roll_rate",
                value: 18
            },
            {
                key: "pitch_rate",
                value: 9
            },
            {
                key: "yaw_rate",
                value: 3
            },
            {
                key: "nav_fw_pos_xy_p",
                value: 75
            },
            {
                key: "fw_turn_assist_pitch_gain",
                value: 0.3
            },
            {
                key: "max_angle_inclination_rll",
                value: 550
            },
            {
                key: "nav_fw_bank_angle",
                value: 45
            },
            {
                key: "fw_p_pitch",
                value: 15
            },
            {
                key: "fw_i_pitch",
                value: 5
            },
            {
                key: "fw_d_pitch",
                value: 5
            },
            {
                key: "fw_ff_pitch",
                value: 70
            },
            {
                key: "fw_p_roll",
                value: 15
            },
            {
                key: "fw_i_roll",
                value: 3
            },
            {
                key: "fw_d_roll",
                value: 7
            },
            {
                key: "fw_ff_roll",
                value: 50
            },
            {
                key: "fw_p_yaw",
                value: 20
            },
            {
                key: "fw_i_yaw",
                value: 0
            },
            {
                key: "fw_d_yaw",
                value: 0
            },
            {
                key: "fw_ff_yaw",
                value: 100
            },
            {
                key: "nav_fw_pos_z_p",
                value: 25
            },
            {
                key: "nav_fw_pos_z_i",
                value: 6
            },
            {
                key: "nav_fw_pos_z_d",
                value: 5
            },
            {
                key: "nav_fw_pos_z_ff",
                value: 25
            },
            {
                key: "nav_fw_alt_control_response",
                value: 45
            },
            {
                key: "airmode_type",
                value: "STICK_CENTER_ONCE"
            },
            {
                key: "small_angle",
                value: 180
            },
            {
                key: "nav_fw_control_smoothness",
                value: 2
            },
            {
                key: "nav_rth_allow_landing",
                value: "FS_ONLY"
            },
            {
                key: "nav_rth_altitude",
                value: 5000
            },
            {
                key: "nav_wp_radius",
                value: 1000
            },
            {
                key: "nav_wp_max_safe_distance",
                value: 500
            },
            {
                key: "nav_fw_launch_max_angle",
                value: 75
            },
            {
                key: "nav_fw_launch_motor_delay",
                value: 100
            },
            {
                key: "nav_fw_launch_max_altitude",
                value: 5000
            },
            /*
             * TPA
             */
            {
                key: "tpa_rate",
                value: 80
            },
        ],
    },
    {
        "title": 'Rover',
        "description": 'INAV 9.1 ground-rover starting point with the Rover steering mixer and low-speed heading response',
        "presetFamily": "flight-commander-surface-vehicle",
        "id": 1,
        "notRecommended": false,
        "reboot": true,
        "mixerToApply": 31,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 31
            },
            {
                key: "looptime",
                value: 1000
            },
            {
                key: "gyro_main_lpf_hz",
                value: 10
            },
            {
                key: "motor_pwm_protocol",
                value: "STANDARD"
            },
            {
                key: "applied_defaults",
                value: 1
            },
            {
                key: "failsafe_procedure",
                value: "DROP"
            },
            {
                key: "platform_type",
                value: "ROVER"
            },
            {
                key: "nav_wp_max_safe_distance",
                value: 500
            },
            {
                key: "nav_fw_loiter_radius",
                value: 100
            },
            {
                key: "nav_fw_yaw_deadband",
                value: 5
            },
            {
                key: "nav_fw_pos_hdg_p",
                value: 60
            },
            {
                key: "nav_fw_pos_hdg_i",
                value: 2
            },
            {
                key: "nav_fw_pos_hdg_d",
                value: 0
            }
        ]
    },
    {
        "title": 'Boat',
        "description": 'INAV 9.1 surface-boat starting point with the Boat platform and rudder steering mixer',
        "presetFamily": "flight-commander-surface-vehicle",
        "id": 7,
        "notRecommended": false,
        "reboot": true,
        "mixerToApply": 32,
        "wizardPages": ['receiver', 'gps'],
        "settings": [
            {
                key: "model_preview_type",
                value: 32
            },
            {
                key: "looptime",
                value: 1000
            },
            {
                key: "gyro_main_lpf_hz",
                value: 10
            },
            {
                key: "motor_pwm_protocol",
                value: "STANDARD"
            },
            {
                key: "applied_defaults",
                value: 1
            },
            {
                key: "failsafe_procedure",
                value: "DROP"
            },
            {
                key: "platform_type",
                value: "BOAT"
            },
            {
                key: "nav_wp_max_safe_distance",
                value: 500
            },
            {
                key: "nav_fw_loiter_radius",
                value: 100
            },
            {
                key: "nav_fw_yaw_deadband",
                value: 5
            },
            {
                key: "nav_fw_pos_hdg_p",
                value: 60
            },
            {
                key: "nav_fw_pos_hdg_i",
                value: 2
            },
            {
                key: "nav_fw_pos_hdg_d",
                value: 0
            }
        ]
    },
    {
        "title": 'Keep current settings (Not recommended)',
        "description": 'Keep every current value and save only the first-run acknowledgement',
        "id": 0,
        "preserveCurrentSettings": true,
        "notRecommended": true,
        "reboot": false,
        "settings": [
            {
                key: "applied_defaults",
                value: 1
            }
        ]
    }
];

export default defaultsDialogData;
