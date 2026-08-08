/*
 * Flight Commander 4.0 DroneCAN moving-baseline pair manager.
 *
 * The paired AP_Periph modules exchange carrier data directly on DroneCAN. The
 * flight controller configures their persistent roles and consumes only the
 * bound rover's RelPosHeading solution.
 */

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER)

#include <ctype.h>
#include <math.h>
#include <string.h>

#define CANARD_DSDLC_INTERNAL

#include "common/maths.h"
#include "drivers/dronecan/dronecan.h"
#include "drivers/dronecan/dronecan_pair.h"
#include "drivers/time.h"
#include "io/gps_dronecan.h"

#include <dronecan_msgs.h>

#define PAIR_REQUEST_TIMEOUT_MS 1500U
#define PAIR_MAX_RETRIES 2U
#define PAIR_RECONNECT_DELAY_MS 3000U
#define PAIR_RECONNECT_TIMEOUT_MS 12000U
#define AP_PERIPH_MOVING_BASE_GPS_TYPE 17
#define AP_PERIPH_MOVING_ROVER_GPS_TYPE 18
#define AP_PERIPH_GPS_AUTO_CONFIG 1

typedef enum {
    STEP_NONE = 0,
    STEP_INFO_BASE,
    STEP_INFO_ROVER,
    STEP_SET_BASE_NODE,
    STEP_SET_BASE_TYPE,
    STEP_SET_BASE_AUTOCONFIG,
    STEP_SET_BASE_TERMINATION,
    STEP_SAVE_BASE,
    STEP_SET_ROVER_NODE,
    STEP_SET_ROVER_TYPE,
    STEP_SET_ROVER_AUTOCONFIG,
    STEP_SET_ROVER_TERMINATION,
    STEP_SAVE_ROVER,
    STEP_RESTART_BASE,
    STEP_RESTART_ROVER,
    STEP_WAIT_RECONNECT,
    STEP_VERIFY_BASE_TYPE,
    STEP_VERIFY_BASE_AUTOCONFIG,
    STEP_VERIFY_BASE_TERMINATION,
    STEP_VERIFY_ROVER_TYPE,
    STEP_VERIFY_ROVER_AUTOCONFIG,
    STEP_VERIFY_ROVER_TERMINATION,
    STEP_COMPLETE,
} pairStep_e;

typedef enum {
    REQUEST_NONE = 0,
    REQUEST_NODE_INFO,
    REQUEST_PARAMETER,
    REQUEST_SAVE,
} pairRequestKind_e;

typedef enum {
    PARAM_NONE = 0,
    PARAM_CAN_NODE,
    PARAM_GPS_TYPE,
    PARAM_GPS_AUTO_CONFIG,
    PARAM_CAN_TERMINATE,
} pairParameter_e;

typedef struct pairPendingRequest_s {
    pairRequestKind_e kind;
    pairParameter_e parameter;
    uint8_t nodeID;
    bool write;
    int64_t expectedValue;
    uint32_t deadlineMs;
} pairPendingRequest_t;

static dronecanPairStatus_t status;
static pairPendingRequest_t pending;
static pairStep_e step;
static uint8_t command;
static uint8_t retries;
static uint32_t reconnectStartedMs;
static uint32_t lastRelPosMs;
static uint8_t nodeInfoTransferID;
static uint8_t parameterTransferID;
static uint8_t executeOpcodeTransferID;
static uint8_t restartTransferID;

static uint16_t saturatingU16(uint32_t value)
{
    return value > 65535U ? 65535U : (uint16_t)value;
}

static uint16_t encodeGetSetRequest(struct uavcan_protocol_param_GetSetRequest *message, uint8_t *buffer)
{
    uint32_t bitOffset = 0;
    memset(buffer, 0, UAVCAN_PROTOCOL_PARAM_GETSET_REQUEST_MAX_SIZE);
    _uavcan_protocol_param_GetSetRequest_encode(buffer, &bitOffset, message, true);
    return (bitOffset + 7U) / 8U;
}

static bool decodeGetSetResponse(const CanardRxTransfer *transfer,
    struct uavcan_protocol_param_GetSetResponse *message)
{
    uint32_t bitOffset = 0;
    if (_uavcan_protocol_param_GetSetResponse_decode(transfer, &bitOffset, message, true)) {
        return true;
    }
    return ((bitOffset + 7U) / 8U) != transfer->payload_len;
}

static uint16_t encodeExecuteOpcodeRequest(
    struct uavcan_protocol_param_ExecuteOpcodeRequest *message, uint8_t *buffer)
{
    uint32_t bitOffset = 0;
    memset(buffer, 0, UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_REQUEST_MAX_SIZE);
    _uavcan_protocol_param_ExecuteOpcodeRequest_encode(buffer, &bitOffset, message, true);
    return (bitOffset + 7U) / 8U;
}

static bool decodeExecuteOpcodeResponse(const CanardRxTransfer *transfer,
    struct uavcan_protocol_param_ExecuteOpcodeResponse *message)
{
    uint32_t bitOffset = 0;
    if (_uavcan_protocol_param_ExecuteOpcodeResponse_decode(transfer, &bitOffset, message, true)) {
        return true;
    }
    return ((bitOffset + 7U) / 8U) != transfer->payload_len;
}

static uint16_t encodeRestartNodeRequest(struct uavcan_protocol_RestartNodeRequest *message,
    uint8_t *buffer)
{
    uint32_t bitOffset = 0;
    memset(buffer, 0, UAVCAN_PROTOCOL_RESTARTNODE_REQUEST_MAX_SIZE);
    _uavcan_protocol_RestartNodeRequest_encode(buffer, &bitOffset, message, true);
    return (bitOffset + 7U) / 8U;
}

static void setError(uint8_t error)
{
    status.state = DRONECAN_PAIR_STATE_ERROR;
    status.errorCode = error;
    status.progress = 0;
    status.activeNodeID = 0;
    pending.kind = REQUEST_NONE;
    step = STEP_NONE;
}

static bool nodeOnline(uint8_t nodeID)
{
    return dronecanGetNodeById(nodeID) != NULL;
}

static void copyName(char destination[32], const uint8_t *source, uint8_t length)
{
    memset(destination, 0, 32);
    memcpy(destination, source, MIN((unsigned)length, 31U));
}

static bool containsIgnoreCase(const char *text, const char *needle)
{
    if (!text || !needle || !*needle) {
        return false;
    }
    for (; *text; text++) {
        const char *left = text;
        const char *right = needle;
        while (*left && *right && tolower((unsigned char)*left) == tolower((unsigned char)*right)) {
            left++;
            right++;
        }
        if (!*right) {
            return true;
        }
    }
    return false;
}

static bool compatibleIdentity(const char *name)
{
    return containsIgnoreCase(name, "holybro") || containsIgnoreCase(name, "ardupilot") ||
        containsIgnoreCase(name, "ap_periph") || containsIgnoreCase(name, "apperiph");
}

static const char *parameterName(pairParameter_e parameter)
{
    switch (parameter) {
    case PARAM_CAN_NODE: return "CAN_NODE";
    case PARAM_GPS_TYPE: return "GPS_TYPE";
    case PARAM_GPS_AUTO_CONFIG: return "GPS_AUTO_CONFIG";
    case PARAM_CAN_TERMINATE: return "CAN_TERMINATE";
    default: return "";
    }
}

static bool sendNodeInfo(uint8_t nodeID)
{
    const uint8_t buffer[1] = { 0 };
    const uint16_t length = 0;
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE,
        UAVCAN_PROTOCOL_GETNODEINFO_ID, &nodeInfoTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_NODE_INFO,
        .nodeID = nodeID,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendParameter(uint8_t nodeID, pairParameter_e parameter, bool write, int64_t value)
{
    struct uavcan_protocol_param_GetSetRequest request;
    memset(&request, 0, sizeof(request));
    const char *name = parameterName(parameter);
    request.index = 0;
    request.name.len = MIN(strlen(name), sizeof(request.name.data));
    memcpy(request.name.data, name, request.name.len);
    request.value.union_tag = write ? UAVCAN_PROTOCOL_PARAM_VALUE_INTEGER_VALUE : UAVCAN_PROTOCOL_PARAM_VALUE_EMPTY;
    if (write) {
        request.value.integer_value = value;
    }
    uint8_t buffer[UAVCAN_PROTOCOL_PARAM_GETSET_REQUEST_MAX_SIZE];
    const uint16_t length = encodeGetSetRequest(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_PARAM_GETSET_SIGNATURE,
        UAVCAN_PROTOCOL_PARAM_GETSET_ID, &parameterTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_PARAMETER,
        .parameter = parameter,
        .nodeID = nodeID,
        .write = write,
        .expectedValue = value,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendSave(uint8_t nodeID)
{
    struct uavcan_protocol_param_ExecuteOpcodeRequest request = {
        .opcode = UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_REQUEST_OPCODE_SAVE,
        .argument = 0,
    };
    uint8_t buffer[UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_REQUEST_MAX_SIZE];
    const uint16_t length = encodeExecuteOpcodeRequest(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_SIGNATURE,
        UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID, &executeOpcodeTransferID, buffer, length)) {
        return false;
    }
    pending = (pairPendingRequest_t) {
        .kind = REQUEST_SAVE,
        .nodeID = nodeID,
        .deadlineMs = millis() + PAIR_REQUEST_TIMEOUT_MS,
    };
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static bool sendRestart(uint8_t nodeID)
{
    struct uavcan_protocol_RestartNodeRequest request = {
        .magic_number = UAVCAN_PROTOCOL_RESTARTNODE_REQUEST_MAGIC_NUMBER,
    };
    uint8_t buffer[UAVCAN_PROTOCOL_RESTARTNODE_REQUEST_MAX_SIZE];
    const uint16_t length = encodeRestartNodeRequest(&request, buffer);
    if (!dronecanSendServiceRequest(nodeID, UAVCAN_PROTOCOL_RESTARTNODE_SIGNATURE,
        UAVCAN_PROTOCOL_RESTARTNODE_ID, &restartTransferID, buffer, length)) {
        return false;
    }
    status.serviceRequestCount++;
    status.activeNodeID = nodeID;
    return true;
}

static int64_t terminationValue(uint8_t selection)
{
    return selection == DRONECAN_TERMINATION_ENABLED ? 1 : 0;
}

static void setBroadState(void)
{
    switch (step) {
    case STEP_INFO_BASE: status.state = DRONECAN_PAIR_STATE_DISCOVER_BASE; status.progress = 3; break;
    case STEP_INFO_ROVER: status.state = DRONECAN_PAIR_STATE_DISCOVER_ROVER; status.progress = 7; break;
    case STEP_SET_BASE_NODE:
    case STEP_SET_BASE_TYPE:
    case STEP_SET_BASE_AUTOCONFIG:
    case STEP_SET_BASE_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_CONFIGURE_BASE; status.progress = 10 + step * 2; break;
    case STEP_SAVE_BASE: status.state = DRONECAN_PAIR_STATE_SAVE_BASE; status.progress = 35; break;
    case STEP_SET_ROVER_NODE:
    case STEP_SET_ROVER_TYPE:
    case STEP_SET_ROVER_AUTOCONFIG:
    case STEP_SET_ROVER_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_CONFIGURE_ROVER; status.progress = 38 + (step - STEP_SET_ROVER_NODE) * 5; break;
    case STEP_SAVE_ROVER: status.state = DRONECAN_PAIR_STATE_SAVE_ROVER; status.progress = 60; break;
    case STEP_RESTART_BASE: status.state = DRONECAN_PAIR_STATE_RESTART_BASE; status.progress = 64; break;
    case STEP_RESTART_ROVER: status.state = DRONECAN_PAIR_STATE_RESTART_ROVER; status.progress = 68; break;
    case STEP_WAIT_RECONNECT: status.state = DRONECAN_PAIR_STATE_WAIT_RECONNECT; status.progress = 72; break;
    case STEP_VERIFY_BASE_TYPE:
    case STEP_VERIFY_BASE_AUTOCONFIG:
    case STEP_VERIFY_BASE_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_VERIFY_BASE; status.progress = 76 + (step - STEP_VERIFY_BASE_TYPE) * 4; break;
    case STEP_VERIFY_ROVER_TYPE:
    case STEP_VERIFY_ROVER_AUTOCONFIG:
    case STEP_VERIFY_ROVER_TERMINATION:
        status.state = DRONECAN_PAIR_STATE_VERIFY_ROVER; status.progress = 88 + (step - STEP_VERIFY_ROVER_TYPE) * 4; break;
    case STEP_COMPLETE:
        status.state = DRONECAN_PAIR_STATE_COMPLETE; status.progress = 100; break;
    default: break;
    }
}

static void advanceStep(void)
{
    retries = 0;
    pending.kind = REQUEST_NONE;
    switch (step) {
    case STEP_INFO_BASE: step = STEP_INFO_ROVER; break;
    case STEP_INFO_ROVER:
        step = command == DRONECAN_PAIR_COMMAND_CONFIGURE ? STEP_SET_BASE_NODE : STEP_VERIFY_BASE_TYPE;
        break;
    case STEP_SET_BASE_NODE: step = STEP_SET_BASE_TYPE; break;
    case STEP_SET_BASE_TYPE: step = STEP_SET_BASE_AUTOCONFIG; break;
    case STEP_SET_BASE_AUTOCONFIG: step = STEP_SET_BASE_TERMINATION; break;
    case STEP_SET_BASE_TERMINATION: step = STEP_SAVE_BASE; break;
    case STEP_SAVE_BASE: step = STEP_SET_ROVER_NODE; break;
    case STEP_SET_ROVER_NODE: step = STEP_SET_ROVER_TYPE; break;
    case STEP_SET_ROVER_TYPE: step = STEP_SET_ROVER_AUTOCONFIG; break;
    case STEP_SET_ROVER_AUTOCONFIG: step = STEP_SET_ROVER_TERMINATION; break;
    case STEP_SET_ROVER_TERMINATION: step = STEP_SAVE_ROVER; break;
    case STEP_SAVE_ROVER: step = STEP_RESTART_BASE; break;
    case STEP_RESTART_BASE: step = STEP_RESTART_ROVER; break;
    case STEP_RESTART_ROVER:
        reconnectStartedMs = millis();
        step = STEP_WAIT_RECONNECT;
        break;
    case STEP_VERIFY_BASE_TYPE: step = STEP_VERIFY_BASE_AUTOCONFIG; break;
    case STEP_VERIFY_BASE_AUTOCONFIG: step = STEP_VERIFY_BASE_TERMINATION; break;
    case STEP_VERIFY_BASE_TERMINATION: step = STEP_VERIFY_ROVER_TYPE; break;
    case STEP_VERIFY_ROVER_TYPE: step = STEP_VERIFY_ROVER_AUTOCONFIG; break;
    case STEP_VERIFY_ROVER_AUTOCONFIG: step = STEP_VERIFY_ROVER_TERMINATION; break;
    case STEP_VERIFY_ROVER_TERMINATION: step = STEP_COMPLETE; break;
    default: break;
    }
    setBroadState();
}

static bool sendCurrentStep(void)
{
    const dronecanConfig_t *config = dronecanConfig();
    switch (step) {
    case STEP_INFO_BASE: return sendNodeInfo(config->movingBaseNodeID);
    case STEP_INFO_ROVER: return sendNodeInfo(config->movingRoverNodeID);
    case STEP_SET_BASE_NODE: return sendParameter(config->movingBaseNodeID, PARAM_CAN_NODE, true, config->movingBaseNodeID);
    case STEP_SET_BASE_TYPE: return sendParameter(config->movingBaseNodeID, PARAM_GPS_TYPE, true, AP_PERIPH_MOVING_BASE_GPS_TYPE);
    case STEP_SET_BASE_AUTOCONFIG: return sendParameter(config->movingBaseNodeID, PARAM_GPS_AUTO_CONFIG, true, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_SET_BASE_TERMINATION:
        if (config->baseTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingBaseNodeID, PARAM_CAN_TERMINATE, true, terminationValue(config->baseTermination));
    case STEP_SAVE_BASE: return sendSave(config->movingBaseNodeID);
    case STEP_SET_ROVER_NODE: return sendParameter(config->movingRoverNodeID, PARAM_CAN_NODE, true, config->movingRoverNodeID);
    case STEP_SET_ROVER_TYPE: return sendParameter(config->movingRoverNodeID, PARAM_GPS_TYPE, true, AP_PERIPH_MOVING_ROVER_GPS_TYPE);
    case STEP_SET_ROVER_AUTOCONFIG: return sendParameter(config->movingRoverNodeID, PARAM_GPS_AUTO_CONFIG, true, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_SET_ROVER_TERMINATION:
        if (config->roverTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingRoverNodeID, PARAM_CAN_TERMINATE, true, terminationValue(config->roverTermination));
    case STEP_SAVE_ROVER: return sendSave(config->movingRoverNodeID);
    case STEP_RESTART_BASE:
        if (!sendRestart(config->movingBaseNodeID)) return false;
        advanceStep();
        return true;
    case STEP_RESTART_ROVER:
        if (!sendRestart(config->movingRoverNodeID)) return false;
        advanceStep();
        return true;
    case STEP_VERIFY_BASE_TYPE: return sendParameter(config->movingBaseNodeID, PARAM_GPS_TYPE, false, AP_PERIPH_MOVING_BASE_GPS_TYPE);
    case STEP_VERIFY_BASE_AUTOCONFIG: return sendParameter(config->movingBaseNodeID, PARAM_GPS_AUTO_CONFIG, false, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_VERIFY_BASE_TERMINATION:
        if (config->baseTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingBaseNodeID, PARAM_CAN_TERMINATE, false, terminationValue(config->baseTermination));
    case STEP_VERIFY_ROVER_TYPE: return sendParameter(config->movingRoverNodeID, PARAM_GPS_TYPE, false, AP_PERIPH_MOVING_ROVER_GPS_TYPE);
    case STEP_VERIFY_ROVER_AUTOCONFIG: return sendParameter(config->movingRoverNodeID, PARAM_GPS_AUTO_CONFIG, false, AP_PERIPH_GPS_AUTO_CONFIG);
    case STEP_VERIFY_ROVER_TERMINATION:
        if (config->roverTermination == DRONECAN_TERMINATION_UNCHANGED) { advanceStep(); return true; }
        return sendParameter(config->movingRoverNodeID, PARAM_CAN_TERMINATE, false, terminationValue(config->roverTermination));
    case STEP_COMPLETE:
        status.baseRoleVerified = status.baseGpsType == AP_PERIPH_MOVING_BASE_GPS_TYPE;
        status.roverRoleVerified = status.roverGpsType == AP_PERIPH_MOVING_ROVER_GPS_TYPE;
        status.configured = status.baseRoleVerified && status.roverRoleVerified;
        status.state = DRONECAN_PAIR_STATE_COMPLETE;
        status.progress = 100;
        status.activeNodeID = 0;
        step = STEP_NONE;
        return true;
    default: return true;
    }
}

void dronecanPairInit(void)
{
    memset(&status, 0, sizeof(status));
    status.state = DRONECAN_PAIR_STATE_IDLE;
    status.baseNodeID = DRONECAN_NODE_ID_DISABLED;
    status.roverNodeID = DRONECAN_NODE_ID_DISABLED;
    status.baseGpsType = -1;
    status.roverGpsType = -1;
    status.baseAutoConfig = -1;
    status.roverAutoConfig = -1;
    status.baseTermination = -1;
    status.roverTermination = -1;
    status.baseAgeMs = UINT16_MAX;
    status.roverAgeMs = UINT16_MAX;
    status.relativeAgeMs = UINT16_MAX;
    status.relativeAccuracyCentidegrees = UINT16_MAX;
    pending.kind = REQUEST_NONE;
    step = STEP_NONE;
}

bool dronecanPairStartCommand(uint8_t requestedCommand)
{
    if (requestedCommand == DRONECAN_PAIR_COMMAND_ABORT) {
        pending.kind = REQUEST_NONE;
        step = STEP_NONE;
        status.state = DRONECAN_PAIR_STATE_ABORTED;
        status.activeNodeID = 0;
        return true;
    }
    if (requestedCommand != DRONECAN_PAIR_COMMAND_CONFIGURE && requestedCommand != DRONECAN_PAIR_COMMAND_VERIFY) {
        setError(DRONECAN_PAIR_ERROR_COMMAND);
        return false;
    }
    const dronecanConfig_t *config = dronecanConfig();
    if (config->movingBaseNodeID == DRONECAN_NODE_ID_DISABLED ||
        config->movingRoverNodeID == DRONECAN_NODE_ID_DISABLED) {
        setError(DRONECAN_PAIR_ERROR_BINDING_INCOMPLETE);
        return false;
    }
    if (config->movingBaseNodeID == config->movingRoverNodeID) {
        setError(DRONECAN_PAIR_ERROR_DUPLICATE_NODE);
        return false;
    }
    if (!nodeOnline(config->movingBaseNodeID)) {
        setError(DRONECAN_PAIR_ERROR_BASE_OFFLINE);
        return false;
    }
    if (!nodeOnline(config->movingRoverNodeID)) {
        setError(DRONECAN_PAIR_ERROR_ROVER_OFFLINE);
        return false;
    }

    const uint32_t requestCount = status.serviceRequestCount;
    const uint32_t responseCount = status.serviceResponseCount;
    const uint32_t timeoutCount = status.serviceTimeoutCount;
    const uint32_t headingCount = status.relativeHeadingCount;
    memset(&status, 0, sizeof(status));
    status.serviceRequestCount = requestCount;
    status.serviceResponseCount = responseCount;
    status.serviceTimeoutCount = timeoutCount;
    status.relativeHeadingCount = headingCount;
    status.baseNodeID = config->movingBaseNodeID;
    status.roverNodeID = config->movingRoverNodeID;
    status.baseGpsType = status.roverGpsType = -1;
    status.baseAutoConfig = status.roverAutoConfig = -1;
    status.baseTermination = status.roverTermination = -1;
    status.baseAgeMs = status.roverAgeMs = UINT16_MAX;
    status.relativeAgeMs = status.relativeAccuracyCentidegrees = UINT16_MAX;
    command = requestedCommand;
    step = STEP_INFO_BASE;
    retries = 0;
    pending.kind = REQUEST_NONE;
    setBroadState();
    return true;
}

void dronecanPairUpdate(void)
{
    if (step == STEP_NONE) {
        return;
    }
    const uint32_t now = millis();
    if (pending.kind != REQUEST_NONE) {
        if ((int32_t)(now - pending.deadlineMs) >= 0) {
            status.serviceTimeoutCount++;
            pending.kind = REQUEST_NONE;
            if (retries++ >= PAIR_MAX_RETRIES) {
                setError(DRONECAN_PAIR_ERROR_TIMEOUT);
            }
        }
        return;
    }
    if (step == STEP_WAIT_RECONNECT) {
        const dronecanConfig_t *config = dronecanConfig();
        status.baseOnline = nodeOnline(config->movingBaseNodeID);
        status.roverOnline = nodeOnline(config->movingRoverNodeID);
        const uint32_t elapsed = now - reconnectStartedMs;
        if (elapsed >= PAIR_RECONNECT_DELAY_MS && status.baseOnline && status.roverOnline) {
            step = STEP_VERIFY_BASE_TYPE;
            setBroadState();
        } else if (elapsed > PAIR_RECONNECT_TIMEOUT_MS) {
            setError(!status.baseOnline ? DRONECAN_PAIR_ERROR_BASE_OFFLINE : DRONECAN_PAIR_ERROR_ROVER_OFFLINE);
        }
        return;
    }
    if (!sendCurrentStep()) {
        setError(DRONECAN_PAIR_ERROR_TRANSMIT);
    }
}

bool dronecanPairShouldAcceptResponse(uint16_t dataTypeID, uint64_t *signature)
{
    switch (dataTypeID) {
    case UAVCAN_PROTOCOL_GETNODEINFO_ID: *signature = UAVCAN_PROTOCOL_GETNODEINFO_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_PARAM_GETSET_ID: *signature = UAVCAN_PROTOCOL_PARAM_GETSET_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID: *signature = UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_RESPONSE_SIGNATURE; return true;
    case UAVCAN_PROTOCOL_RESTARTNODE_ID: *signature = UAVCAN_PROTOCOL_RESTARTNODE_RESPONSE_SIGNATURE; return true;
    default: return false;
    }
}

static void storeParameterValue(pairParameter_e parameter, uint8_t nodeID, int64_t value)
{
    const bool base = nodeID == dronecanConfig()->movingBaseNodeID;
    switch (parameter) {
    case PARAM_GPS_TYPE: if (base) status.baseGpsType = value; else status.roverGpsType = value; break;
    case PARAM_GPS_AUTO_CONFIG: if (base) status.baseAutoConfig = value; else status.roverAutoConfig = value; break;
    case PARAM_CAN_TERMINATE: if (base) status.baseTermination = value; else status.roverTermination = value; break;
    default: break;
    }
}

bool dronecanPairHandleResponse(const CanardRxTransfer *transfer)
{
    if (pending.kind == REQUEST_NONE || transfer->source_node_id != pending.nodeID) {
        return false;
    }
    status.serviceResponseCount++;

    if (pending.kind == REQUEST_NODE_INFO && transfer->data_type_id == UAVCAN_PROTOCOL_GETNODEINFO_ID) {
        struct uavcan_protocol_GetNodeInfoResponse response;
        if (uavcan_protocol_GetNodeInfoResponse_decode(transfer, &response)) {
            setError(DRONECAN_PAIR_ERROR_IDENTITY);
            return true;
        }
        const bool base = transfer->source_node_id == dronecanConfig()->movingBaseNodeID;
        char *name = base ? status.baseName : status.roverName;
        copyName(name, response.name.data, response.name.len);
        const bool compatible = compatibleIdentity(name);
        if (base) {
            status.baseSoftwareMajor = response.software_version.major;
            status.baseSoftwareMinor = response.software_version.minor;
            status.baseIdentityValid = compatible;
        } else {
            status.roverSoftwareMajor = response.software_version.major;
            status.roverSoftwareMinor = response.software_version.minor;
            status.roverIdentityValid = compatible;
        }
        if ((dronecanConfig()->pairFlags & DRONECAN_PAIR_REQUIRE_AP_PERIPH_IDENTITY) && !compatible) {
            setError(DRONECAN_PAIR_ERROR_IDENTITY);
            return true;
        }
        advanceStep();
        return true;
    }

    if (pending.kind == REQUEST_PARAMETER && transfer->data_type_id == UAVCAN_PROTOCOL_PARAM_GETSET_ID) {
        struct uavcan_protocol_param_GetSetResponse response;
        if (decodeGetSetResponse(transfer, &response) || response.name.len == 0 ||
            response.value.union_tag != UAVCAN_PROTOCOL_PARAM_VALUE_INTEGER_VALUE) {
            setError(DRONECAN_PAIR_ERROR_PARAMETER_MISSING);
            return true;
        }
        const int64_t value = response.value.integer_value;
        storeParameterValue(pending.parameter, pending.nodeID, value);
        if (pending.write && value != pending.expectedValue) {
            setError(DRONECAN_PAIR_ERROR_PARAMETER_REJECTED);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_GPS_TYPE && value != pending.expectedValue) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_GPS_AUTO_CONFIG && value < 1) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        if (!pending.write && pending.parameter == PARAM_CAN_TERMINATE && value != pending.expectedValue) {
            setError(pending.nodeID == dronecanConfig()->movingBaseNodeID
                ? DRONECAN_PAIR_ERROR_BASE_VERIFY : DRONECAN_PAIR_ERROR_ROVER_VERIFY);
            return true;
        }
        advanceStep();
        return true;
    }

    if (pending.kind == REQUEST_SAVE && transfer->data_type_id == UAVCAN_PROTOCOL_PARAM_EXECUTEOPCODE_ID) {
        struct uavcan_protocol_param_ExecuteOpcodeResponse response;
        if (decodeExecuteOpcodeResponse(transfer, &response) || !response.ok) {
            setError(DRONECAN_PAIR_ERROR_SAVE);
            return true;
        }
        advanceStep();
        return true;
    }

    return false;
}

void dronecanPairRecordRelPosHeading(uint8_t sourceNodeID,
    const struct ardupilot_gnss_RelPosHeading *message)
{
    if (!message || sourceNodeID != dronecanConfig()->movingRoverNodeID) {
        return;
    }
    status.relativeHeadingCentidegrees = constrain(lrintf(message->reported_heading_deg * 100.0F), 0, 35999);
    status.relativeAccuracyCentidegrees = message->reported_heading_acc_available
        ? constrain(lrintf(fabsf(message->reported_heading_acc_deg) * 100.0F), 0, UINT16_MAX)
        : UINT16_MAX;
    status.relativeDistanceCm = isfinite(message->relative_distance_m)
        ? constrain(lrintf(message->relative_distance_m * 100.0F), 0, UINT16_MAX) : 0;
    lastRelPosMs = millis();
    status.relativeHeadingCount++;
}

const dronecanPairStatus_t *dronecanPairGetStatus(void)
{
    const dronecanConfig_t *config = dronecanConfig();
    status.baseNodeID = config->movingBaseNodeID;
    status.roverNodeID = config->movingRoverNodeID;
    status.baseOnline = nodeOnline(config->movingBaseNodeID);
    status.roverOnline = nodeOnline(config->movingRoverNodeID);

    gpsDronecanNodeStatus_t gpsStatus;
    if (gpsDronecanGetNodeStatus(config->movingBaseNodeID, &gpsStatus)) {
        status.baseFixType = gpsStatus.fixType;
        status.baseSatellites = gpsStatus.satellites;
        status.baseAgeMs = saturatingU16(gpsStatus.ageMs);
    } else {
        status.baseFixType = 0;
        status.baseSatellites = 0;
        status.baseAgeMs = UINT16_MAX;
    }
    if (gpsDronecanGetNodeStatus(config->movingRoverNodeID, &gpsStatus)) {
        status.roverFixType = gpsStatus.fixType;
        status.roverSatellites = gpsStatus.satellites;
        status.roverAgeMs = saturatingU16(gpsStatus.ageMs);
    } else {
        status.roverFixType = 0;
        status.roverSatellites = 0;
        status.roverAgeMs = UINT16_MAX;
    }
    status.relativeAgeMs = lastRelPosMs ? saturatingU16(millis() - lastRelPosMs) : UINT16_MAX;
    status.relativeHeadingFresh = status.relativeAgeMs <= 1000U;
    status.baseRoleVerified = status.baseGpsType == AP_PERIPH_MOVING_BASE_GPS_TYPE;
    status.roverRoleVerified = status.roverGpsType == AP_PERIPH_MOVING_ROVER_GPS_TYPE;
    status.configured = status.baseRoleVerified && status.roverRoleVerified;
    return &status;
}

#endif
