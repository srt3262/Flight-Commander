/*
 * Flight Commander Firmware additions are licensed under GNU GPL v3.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "drivers/dronecan/libcanard/canard.h"

struct serialPort_s;

#define FLIGHT_COMMANDER_SLCAN_BRIDGE_SCHEMA 1U

typedef enum {
    SLCAN_BRIDGE_ENTRY_ACCEPTED = 0,
    SLCAN_BRIDGE_ENTRY_ALREADY_ACTIVE = 1,
    SLCAN_BRIDGE_ENTRY_ARMED = 2,
    SLCAN_BRIDGE_ENTRY_DRONECAN_OFFLINE = 3,
    SLCAN_BRIDGE_ENTRY_INVALID_BITRATE = 4,
    SLCAN_BRIDGE_ENTRY_INVALID_PORT = 5,
} slcanBridgeEntryResult_e;

slcanBridgeEntryResult_e slcanBridgeCheckEntry(void);
bool slcanBridgeEnter(struct serialPort_s *port);
bool slcanBridgeIsActive(void);
bool slcanBridgeOwnsPort(const struct serialPort_s *port);
void slcanBridgeProcessSerial(struct serialPort_s *port);

bool slcanBridgePeekTxFrame(CanardCANFrame *frame);
void slcanBridgePopTxFrame(bool transmitted);
void slcanBridgeCaptureRxFrame(const CanardCANFrame *frame);
void slcanBridgeSetBusOff(bool busOff);
