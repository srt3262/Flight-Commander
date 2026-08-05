/*
 * Flight Commander Firmware additions are licensed under GNU GPL v3.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#include "build/flight_commander.h"
#include "build/version.h"

#include "common/streambuf.h"

#include "msp/msp_flight_commander.h"

void mspFlightCommanderWriteInfo(sbuf_t *dst)
{
    // Keep the complete negotiated identity contiguous in the image.  The
    // release verifier can then prove that the downloadable HEX carries the
    // same version and capability contract as its corresponding source.
    static const uint8_t payload[FLIGHT_COMMANDER_INFO_PAYLOAD_SIZE] = {
        'F', 'C', 'F', 'W',
        FLIGHT_COMMANDER_INFO_SCHEMA_VERSION,
        FLIGHT_COMMANDER_VERSION_MAJOR,
        FLIGHT_COMMANDER_VERSION_MINOR,
        FLIGHT_COMMANDER_VERSION_PATCH,
        FC_VERSION_MAJOR,
        FC_VERSION_MINOR,
        FC_VERSION_PATCH_LEVEL,
        FLIGHT_COMMANDER_CAPABILITIES & 0xFFU,
        (FLIGHT_COMMANDER_CAPABILITIES >> 8) & 0xFFU,
        (FLIGHT_COMMANDER_CAPABILITIES >> 16) & 0xFFU,
        (FLIGHT_COMMANDER_CAPABILITIES >> 24) & 0xFFU,
    };

    sbufWriteData(dst, payload, sizeof(payload));
}
