#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_RTK)

#include <string.h>

#include "common/maths.h"
#include "common/time.h"
#include "drivers/time.h"
#include "drivers/dronecan/dronecan.h"
#include "flight_commander/rtcm.h"
#include "io/gps.h"

#define RTCM3_PREAMBLE 0xD3U
#define RTCM3_HEADER_SIZE 3U
#define RTCM3_CRC_SIZE 3U
#define RTCM3_MAX_PAYLOAD_SIZE 1023U
#define RTCM3_MAX_MESSAGE_SIZE (RTCM3_HEADER_SIZE + RTCM3_MAX_PAYLOAD_SIZE + RTCM3_CRC_SIZE)

#define RTCM_FRAGMENT_SIZE 180U
#define RTCM_FRAGMENT_COUNT 4U
#define RTCM_REASSEMBLY_SIZE (RTCM_FRAGMENT_SIZE * RTCM_FRAGMENT_COUNT)
#define RTCM_REASSEMBLY_TIMEOUT_MS 500U

typedef struct rtcmReassembly_s {
    uint8_t sequence;
    uint8_t receivedMask;
    uint8_t lastFragment;
    bool hasLastFragment;
    uint16_t length;
    timeMs_t lastFragmentMs;
    uint8_t data[RTCM_REASSEMBLY_SIZE];
} rtcmReassembly_t;

static flightCommanderRtcmStatus_t rtcmStatus;
static rtcmReassembly_t reassembly;

static uint32_t crc24q(const uint8_t *data, uint16_t length)
{
    uint32_t crc = 0;
    while (length--) {
        crc ^= (uint32_t)*data++ << 16;
        for (unsigned bit = 0; bit < 8; bit++) {
            crc <<= 1;
            if (crc & 0x1000000U) {
                crc ^= 0x1864CFBU;
            }
        }
    }
    return crc & 0xFFFFFFU;
}

static void resetReassembly(uint8_t sequence)
{
    memset(&reassembly, 0, sizeof(reassembly));
    reassembly.sequence = sequence;
}

static bool deliverRtcmMessage(const uint8_t *data, uint16_t length)
{
    bool delivered = gpsQueueRtcmData(data, length);
#if defined(USE_DRONECAN)
    delivered = dronecanBroadcastRtcm(data, length) || delivered;
#endif
    if (delivered) {
        rtcmStatus.injectedBytes += length;
    } else {
        rtcmStatus.queueDrops++;
    }
    return delivered;
}

static bool parseAndDeliver(const uint8_t *data, uint16_t length)
{
    uint16_t offset = 0;
    bool foundMessage = false;

    while (offset < length) {
        if ((uint16_t)(length - offset) < (uint16_t)RTCM3_HEADER_SIZE || data[offset] != RTCM3_PREAMBLE) {
            rtcmStatus.invalidPackets++;
            return false;
        }

        const uint16_t payloadLength = ((uint16_t)(data[offset + 1] & 0x03U) << 8) | data[offset + 2];
        const uint16_t messageLength = RTCM3_HEADER_SIZE + payloadLength + RTCM3_CRC_SIZE;
        if (payloadLength > RTCM3_MAX_PAYLOAD_SIZE || messageLength > length - offset) {
            rtcmStatus.invalidPackets++;
            return false;
        }

        const uint32_t expectedCrc = ((uint32_t)data[offset + messageLength - 3] << 16) |
            ((uint32_t)data[offset + messageLength - 2] << 8) |
            data[offset + messageLength - 1];
        if (crc24q(&data[offset], messageLength - RTCM3_CRC_SIZE) != expectedCrc) {
            rtcmStatus.invalidPackets++;
            return false;
        }

        deliverRtcmMessage(&data[offset], messageLength);
        rtcmStatus.completedMessages++;
        foundMessage = true;
        offset += messageLength;
    }

    return foundMessage;
}

void flightCommanderRtcmInit(void)
{
    memset(&rtcmStatus, 0, sizeof(rtcmStatus));
    resetReassembly(0);
}

void flightCommanderRtcmUpdate(void)
{
    if (reassembly.receivedMask && millis() - reassembly.lastFragmentMs > RTCM_REASSEMBLY_TIMEOUT_MS) {
        rtcmStatus.incompleteMessages++;
        resetReassembly(reassembly.sequence);
    }
}

void flightCommanderRtcmReceiveFragment(
    flightCommanderRtcmTransport_e transport,
    uint8_t flags,
    uint8_t length,
    const uint8_t *data)
{
    rtcmStatus.transport = transport;
    rtcmStatus.receivedPackets++;

    if (!data || length > RTCM_FRAGMENT_SIZE) {
        rtcmStatus.invalidPackets++;
        return;
    }

    if (!(flags & 0x01U)) {
        parseAndDeliver(data, length);
        return;
    }

    const uint8_t fragment = (flags >> 1) & 0x03U;
    const uint8_t sequence = flags >> 3;
    if (reassembly.receivedMask && sequence != reassembly.sequence) {
        rtcmStatus.incompleteMessages++;
        resetReassembly(sequence);
    } else if (!reassembly.receivedMask) {
        resetReassembly(sequence);
    }

    const uint16_t offset = fragment * RTCM_FRAGMENT_SIZE;
    memcpy(&reassembly.data[offset], data, length);
    reassembly.receivedMask |= 1U << fragment;
    reassembly.lastFragmentMs = millis();
    const uint16_t fragmentEnd = offset + length;
    if (fragmentEnd > reassembly.length) {
        reassembly.length = fragmentEnd;
    }

    if (length < RTCM_FRAGMENT_SIZE || fragment == RTCM_FRAGMENT_COUNT - 1) {
        reassembly.lastFragment = fragment;
        reassembly.hasLastFragment = true;
    }

    if (reassembly.hasLastFragment) {
        const uint8_t requiredMask = (1U << (reassembly.lastFragment + 1U)) - 1U;
        if ((reassembly.receivedMask & requiredMask) == requiredMask) {
            parseAndDeliver(reassembly.data, reassembly.length);
            resetReassembly(sequence);
        }
    }
}

const flightCommanderRtcmStatus_t *flightCommanderRtcmGetStatus(void)
{
    return &rtcmStatus;
}

#endif
