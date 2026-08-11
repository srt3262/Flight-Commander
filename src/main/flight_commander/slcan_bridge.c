/*
 * Flight Commander standards-compatible LAWICEL/SLCAN bridge.
 *
 * The bridge deliberately owns only the MSP port that requested it.  The
 * active CAN peripheral remains at the configured DroneCAN bitrate; SLCAN
 * bitrate commands are acknowledged only when they match that live bitrate.
 * Bridge mode is volatile and exits only after a flight-controller reboot.
 */

#include "platform.h"

#if defined(USE_FLIGHT_COMMANDER_SLCAN_BRIDGE)

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "common/time.h"
#include "common/utils.h"
#include "drivers/dronecan/dronecan.h"
#include "drivers/serial.h"
#include "drivers/time.h"
#include "fc/runtime_config.h"
#include "flight_commander/slcan_bridge.h"

#define SLCAN_COMMAND_BUFFER_SIZE 32U
#define SLCAN_HOST_TX_QUEUE_SIZE 32U
#define SLCAN_BUS_RX_QUEUE_SIZE 64U
#define SLCAN_MAX_LINE_SIZE 32U

#define SLCAN_STATUS_RX_QUEUE_FULL (1U << 0)
#define SLCAN_STATUS_TX_QUEUE_FULL (1U << 1)
#define SLCAN_STATUS_BUS_ERROR     (1U << 7)

typedef struct {
    CanardCANFrame frames[SLCAN_HOST_TX_QUEUE_SIZE];
    uint8_t head;
    uint8_t tail;
    uint8_t count;
} slcanHostTxQueue_t;

typedef struct {
    CanardCANFrame frames[SLCAN_BUS_RX_QUEUE_SIZE];
    uint8_t head;
    uint8_t tail;
    uint8_t count;
} slcanBusRxQueue_t;

static struct serialPort_s *bridgePort;
static bool bridgeActive;
static bool channelOpen;
static bool bitrateConfigured;
static bool timestampEnabled;
static uint32_t activeBitrateKbps;
static uint8_t statusFlags;
static char commandBuffer[SLCAN_COMMAND_BUFFER_SIZE];
static uint8_t commandLength;
static slcanHostTxQueue_t hostTxQueue;
static slcanBusRxQueue_t busRxQueue;

static uint8_t nextIndex(uint8_t index, uint8_t size)
{
    index++;
    return index == size ? 0 : index;
}

static int8_t hexValue(char value)
{
    if (value >= '0' && value <= '9') {
        return value - '0';
    }
    if (value >= 'A' && value <= 'F') {
        return value - 'A' + 10;
    }
    if (value >= 'a' && value <= 'f') {
        return value - 'a' + 10;
    }
    return -1;
}

static char hexDigit(uint8_t value)
{
    static const char digits[] = "0123456789ABCDEF";
    return digits[value & 0x0FU];
}

static bool parseHex(const char *text, uint8_t length, uint32_t *result)
{
    uint32_t value = 0;
    for (uint8_t index = 0; index < length; index++) {
        const int8_t digit = hexValue(text[index]);
        if (digit < 0) {
            return false;
        }
        value = (value << 4) | (uint8_t)digit;
    }
    *result = value;
    return true;
}

static void writeAck(void)
{
    static const uint8_t ack = '\r';
    serialWriteBuf(bridgePort, &ack, sizeof(ack));
}

static void writeNack(void)
{
    static const uint8_t nack = 0x07;
    serialWriteBuf(bridgePort, &nack, sizeof(nack));
}

static void writeText(const char *text, uint8_t length)
{
    serialWriteBuf(bridgePort, (const uint8_t *)text, length);
}

static uint32_t bitrateForSpeedCode(char speedCode)
{
    static const uint32_t bitratesKbps[] = {
        10U, 20U, 50U, 100U, 125U, 250U, 500U, 800U, 1000U,
    };
    if (speedCode < '0' || speedCode > '8') {
        return 0;
    }
    return bitratesKbps[speedCode - '0'];
}

static bool enqueueHostFrame(const CanardCANFrame *frame)
{
    if (hostTxQueue.count >= SLCAN_HOST_TX_QUEUE_SIZE) {
        statusFlags |= SLCAN_STATUS_TX_QUEUE_FULL;
        return false;
    }
    hostTxQueue.frames[hostTxQueue.head] = *frame;
    hostTxQueue.head = nextIndex(hostTxQueue.head, SLCAN_HOST_TX_QUEUE_SIZE);
    hostTxQueue.count++;
    return true;
}

static bool parseFrameCommand(char type)
{
    const bool extended = type == 'T' || type == 'R';
    const bool remote = type == 'r' || type == 'R';
    const uint8_t identifierLength = extended ? 8U : 3U;
    const uint8_t minimumLength = 1U + identifierLength + 1U;
    if (!channelOpen || commandLength < minimumLength) {
        return false;
    }

    uint32_t identifier;
    uint32_t dlc;
    if (!parseHex(&commandBuffer[1], identifierLength, &identifier) ||
        !parseHex(&commandBuffer[1U + identifierLength], 1, &dlc) || dlc > 8U) {
        return false;
    }
    if ((!extended && identifier > CANARD_CAN_STD_ID_MASK) ||
        (extended && identifier > CANARD_CAN_EXT_ID_MASK)) {
        return false;
    }

    const uint8_t expectedLength = minimumLength + (remote ? 0U : (uint8_t)(dlc * 2U));
    if (commandLength != expectedLength) {
        return false;
    }

    CanardCANFrame frame = {
        .id = identifier | (extended ? CANARD_CAN_FRAME_EFF : 0U) |
            (remote ? CANARD_CAN_FRAME_RTR : 0U),
        .data_len = (uint8_t)dlc,
        .iface_id = 0,
    };
    for (uint8_t index = 0; index < frame.data_len && !remote; index++) {
        uint32_t byte;
        if (!parseHex(&commandBuffer[minimumLength + index * 2U], 2, &byte)) {
            return false;
        }
        frame.data[index] = (uint8_t)byte;
    }
    return enqueueHostFrame(&frame);
}

static void closeChannel(void)
{
    channelOpen = false;
    memset(&hostTxQueue, 0, sizeof(hostTxQueue));
    memset(&busRxQueue, 0, sizeof(busRxQueue));
}

static void processCommand(void)
{
    if (commandLength == 0) {
        writeAck();
        return;
    }

    bool accepted = false;
    switch (commandBuffer[0]) {
    case 'C':
        if (commandLength == 1U && channelOpen) {
            closeChannel();
            accepted = true;
        }
        break;
    case 'S':
        if (commandLength == 2U && !channelOpen &&
            bitrateForSpeedCode(commandBuffer[1]) == activeBitrateKbps) {
            bitrateConfigured = true;
            accepted = true;
        }
        break;
    case 'O':
        if (commandLength == 1U && !channelOpen && bitrateConfigured) {
            channelOpen = true;
            accepted = true;
        }
        break;
    case 'Z':
        if (commandLength == 2U && !channelOpen &&
            (commandBuffer[1] == '0' || commandBuffer[1] == '1')) {
            timestampEnabled = commandBuffer[1] == '1';
            accepted = true;
        }
        break;
    case 'F':
        if (commandLength == 1U && channelOpen) {
            char response[] = { 'F', hexDigit(statusFlags >> 4), hexDigit(statusFlags), '\r' };
            statusFlags = 0;
            writeText(response, sizeof(response));
            return;
        }
        break;
    case 'V':
        if (commandLength == 1U) {
            static const char response[] = "V4200\r";
            writeText(response, sizeof(response) - 1U);
            return;
        }
        break;
    case 'v':
        if (commandLength == 1U) {
            static const char response[] = "v0100\r";
            writeText(response, sizeof(response) - 1U);
            return;
        }
        break;
    case 'N':
        if (commandLength == 1U) {
            static const char response[] = "NFC42\r";
            writeText(response, sizeof(response) - 1U);
            return;
        }
        break;
    case 't':
    case 'T':
    case 'r':
    case 'R':
        accepted = parseFrameCommand(commandBuffer[0]);
        break;
    default:
        break;
    }

    if (accepted) {
        writeAck();
    } else {
        writeNack();
    }
}

static uint8_t encodeFrameLine(const CanardCANFrame *frame, char *line)
{
    const bool extended = (frame->id & CANARD_CAN_FRAME_EFF) != 0;
    const bool remote = (frame->id & CANARD_CAN_FRAME_RTR) != 0;
    const uint8_t identifierLength = extended ? 8U : 3U;
    const uint32_t identifier = frame->id & (extended ? CANARD_CAN_EXT_ID_MASK : CANARD_CAN_STD_ID_MASK);
    uint8_t offset = 0;
    line[offset++] = remote ? (extended ? 'R' : 'r') : (extended ? 'T' : 't');
    for (int8_t shift = (int8_t)((identifierLength - 1U) * 4U); shift >= 0; shift -= 4) {
        line[offset++] = hexDigit(identifier >> shift);
    }
    line[offset++] = hexDigit(frame->data_len);
    if (!remote) {
        for (uint8_t index = 0; index < frame->data_len; index++) {
            line[offset++] = hexDigit(frame->data[index] >> 4);
            line[offset++] = hexDigit(frame->data[index]);
        }
    }
    if (timestampEnabled) {
        const uint16_t timestamp = (uint16_t)(millis() % 60000U);
        line[offset++] = hexDigit(timestamp >> 12);
        line[offset++] = hexDigit(timestamp >> 8);
        line[offset++] = hexDigit(timestamp >> 4);
        line[offset++] = hexDigit(timestamp);
    }
    line[offset++] = '\r';
    return offset;
}

slcanBridgeEntryResult_e slcanBridgeCheckEntry(void)
{
    if (bridgeActive) {
        return SLCAN_BRIDGE_ENTRY_ALREADY_ACTIVE;
    }
    if (ARMING_FLAG(ARMED)) {
        return SLCAN_BRIDGE_ENTRY_ARMED;
    }
    if (dronecanGetState() != STATE_DRONECAN_NORMAL) {
        return SLCAN_BRIDGE_ENTRY_DRONECAN_OFFLINE;
    }
    const uint32_t bitrate = dronecanGetBitrateKbps();
    if (bitrate != 125U && bitrate != 250U && bitrate != 500U && bitrate != 1000U) {
        return SLCAN_BRIDGE_ENTRY_INVALID_BITRATE;
    }
    return SLCAN_BRIDGE_ENTRY_ACCEPTED;
}

bool slcanBridgeEnter(struct serialPort_s *port)
{
    if (!port) {
        return false;
    }
    if (slcanBridgeCheckEntry() != SLCAN_BRIDGE_ENTRY_ACCEPTED) {
        return false;
    }

    bridgePort = port;
    activeBitrateKbps = dronecanGetBitrateKbps();
    bridgeActive = true;
    channelOpen = false;
    bitrateConfigured = false;
    timestampEnabled = false;
    statusFlags = 0;
    commandLength = 0;
    memset(&hostTxQueue, 0, sizeof(hostTxQueue));
    memset(&busRxQueue, 0, sizeof(busRxQueue));
    ENABLE_ARMING_FLAG(ARMING_DISABLED_DRONECAN_BRIDGE);
    return true;
}

bool slcanBridgeIsActive(void)
{
    return bridgeActive;
}

bool slcanBridgeOwnsPort(const struct serialPort_s *port)
{
    return bridgeActive && port && port == bridgePort;
}

void slcanBridgeProcessSerial(struct serialPort_s *port)
{
    if (!slcanBridgeOwnsPort(port)) {
        return;
    }
    if (!serialIsConnected(port)) {
        // Discard any partial MSP bytes left by Configurator before the next
        // SLCAN client opens the same USB CDC port.
        commandLength = 0;
        return;
    }

    while (serialRxBytesWaiting(port)) {
        const uint8_t value = serialRead(port);
        if (value == '\n') {
            continue;
        }
        if (value == '\r') {
            processCommand();
            commandLength = 0;
            continue;
        }
        if (commandLength >= SLCAN_COMMAND_BUFFER_SIZE - 1U) {
            commandLength = 0;
            writeNack();
            continue;
        }
        commandBuffer[commandLength++] = (char)value;
    }

    if (!channelOpen) {
        return;
    }
    while (busRxQueue.count) {
        char line[SLCAN_MAX_LINE_SIZE];
        const uint8_t length = encodeFrameLine(&busRxQueue.frames[busRxQueue.tail], line);
        if (serialTxBytesFree(port) < length) {
            break;
        }
        serialWriteBuf(port, (const uint8_t *)line, length);
        busRxQueue.tail = nextIndex(busRxQueue.tail, SLCAN_BUS_RX_QUEUE_SIZE);
        busRxQueue.count--;
    }
}

bool slcanBridgePeekTxFrame(CanardCANFrame *frame)
{
    if (!bridgeActive || !channelOpen || !frame || !hostTxQueue.count) {
        return false;
    }
    *frame = hostTxQueue.frames[hostTxQueue.tail];
    return true;
}

void slcanBridgePopTxFrame(bool transmitted)
{
    if (!hostTxQueue.count) {
        return;
    }
    hostTxQueue.tail = nextIndex(hostTxQueue.tail, SLCAN_HOST_TX_QUEUE_SIZE);
    hostTxQueue.count--;
    if (!transmitted) {
        statusFlags |= SLCAN_STATUS_BUS_ERROR;
    }
}

void slcanBridgeCaptureRxFrame(const CanardCANFrame *frame)
{
    if (!bridgeActive || !channelOpen || !frame) {
        return;
    }
    if (busRxQueue.count >= SLCAN_BUS_RX_QUEUE_SIZE) {
        statusFlags |= SLCAN_STATUS_RX_QUEUE_FULL;
        return;
    }
    busRxQueue.frames[busRxQueue.head] = *frame;
    busRxQueue.head = nextIndex(busRxQueue.head, SLCAN_BUS_RX_QUEUE_SIZE);
    busRxQueue.count++;
}

void slcanBridgeSetBusOff(bool busOff)
{
    if (busOff) {
        statusFlags |= SLCAN_STATUS_BUS_ERROR;
    }
}

#endif
