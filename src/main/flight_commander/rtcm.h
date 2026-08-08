#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    FLIGHT_COMMANDER_RTCM_TRANSPORT_NONE = 0,
    FLIGHT_COMMANDER_RTCM_TRANSPORT_MAVLINK = 1,
    FLIGHT_COMMANDER_RTCM_TRANSPORT_MSP = 2,
} flightCommanderRtcmTransport_e;

typedef struct flightCommanderRtcmStatus_s {
    uint8_t transport;
    uint32_t receivedPackets;
    uint32_t completedMessages;
    uint32_t injectedBytes;
    uint32_t invalidPackets;
    uint32_t incompleteMessages;
    uint32_t queueDrops;
} flightCommanderRtcmStatus_t;

void flightCommanderRtcmInit(void);
void flightCommanderRtcmUpdate(void);
void flightCommanderRtcmReceiveFragment(
    flightCommanderRtcmTransport_e transport,
    uint8_t flags,
    uint8_t length,
    const uint8_t *data);
const flightCommanderRtcmStatus_t *flightCommanderRtcmGetStatus(void);
