/*
 * Flight Commander Firmware additions are licensed under GNU GPL v3.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#pragma once

// Flight Commander vendor-specific MSPv2 messages use the 0x2F00 range.
#define MSP2_FLIGHT_COMMANDER_INFO 0x2F00
#define MSP2_FLIGHT_COMMANDER_RTK_STATUS 0x2F01
#define MSP2_FLIGHT_COMMANDER_DUAL_GPS_STATUS 0x2F02
#define MSP2_FLIGHT_COMMANDER_RTCM_DATA 0x2F03

#define MSP2_FLIGHT_COMMANDER_DRONECAN_CONFIG 0x2F10
#define MSP2_FLIGHT_COMMANDER_SET_DRONECAN_CONFIG 0x2F11
#define MSP2_FLIGHT_COMMANDER_DRONECAN_NODES 0x2F12

#define MSP2_FLIGHT_COMMANDER_HEADING_CONFIG 0x2F20
#define MSP2_FLIGHT_COMMANDER_SET_HEADING_CONFIG 0x2F21
#define MSP2_FLIGHT_COMMANDER_HEADING_STATUS 0x2F22
