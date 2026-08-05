#!/usr/bin/env python3
"""Finalize source and test contracts for the coordinated 4.0.0 build.

The retained firmware source is expanded by the companion preparation script.
This finalizer keeps the source generator idempotent across iterative validation
runs and applies the versioned Configurator test expectations.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Coordinated source and package contracts validated together.


def replace(path: str, old: str, new: str, *, required: bool = True) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old in text:
        target.write_text(text.replace(old, new), encoding="utf-8")
        return
    if new in text:
        return
    if required:
        raise RuntimeError(f"{path}: expected text was not found: {old!r}")


def replace_once_or_present(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if text.count(old) != 1:
        raise RuntimeError(f"Unable to apply {label}; expected one source pattern, found {text.count(old)}")
    return text.replace(old, new, 1)


def patch_firmware_builder() -> None:
    path = ROOT / "scripts/prepare-flight-commander-firmware-4.0.0.py"
    text = path.read_text(encoding="utf-8")

    text = replace_once_or_present(
        text,
        '''    if "bool dronecanSendServiceRequest(" not in value:
        value = value.replace("\\n#endif\\n", append + "\\n#endif\\n")
        path.write_text(value, encoding="utf-8")
''',
        '''    if "bool dronecanSendServiceRequest(" not in value:
        marker = "\\n#endif\\n"
        insertion = value.rfind(marker)
        if insertion < 0:
            raise RuntimeError("dronecan.c has no final preprocessor terminator")
        value = value[:insertion] + append + value[insertion:]
        path.write_text(value, encoding="utf-8")
''',
        "final DroneCAN source insertion",
    )

    text = replace_once_or_present(
        text,
        '''#include "drivers/dronecan/libcanard/canard.h"

#define DRONECAN_PAIR_STATUS_SCHEMA 1
''',
        '''#include "drivers/dronecan/libcanard/canard.h"

struct ardupilot_gnss_RelPosHeading;

#define DRONECAN_PAIR_STATUS_SCHEMA 1
''',
        "RelPosHeading forward declaration",
    )

    text = text.replace(
        "MSP2_FLIGHT_COMMANDER_DRONECAN_NODES         0x2F12",
        "MSP2_FLIGHT_COMMANDER_DRONECAN_NODES 0x2F12",
    )

    old_handler = '''    case MSP2_FLIGHT_COMMANDER_SET_DRONECAN_CONFIG:
        if (dataSize != 6) {
            return MSP_RESULT_ERROR;
        }
        dronecanConfigMutable()->nodeID = sbufReadU8(src);
        dronecanConfigMutable()->bitRateKbps = sbufReadU8(src);
        dronecanConfigMutable()->gpsNodeID = sbufReadU8(src);
        dronecanConfigMutable()->batteryNodeID = sbufReadU8(src);
        dronecanConfigMutable()->primaryGpsSource = sbufReadU8(src);
        dronecanConfigMutable()->magNodeID = sbufReadU8(src);
        return MSP_RESULT_ACK;
'''
    retained_handler = '''    case MSP2_FLIGHT_COMMANDER_SET_DRONECAN_CONFIG: {
        if (ARMING_FLAG(ARMED) || dataSize != 6) {
            return MSP_RESULT_ERROR;
        }
        dronecanConfig_t value;
        value.nodeID = sbufReadU8(src);
        value.bitRateKbps = sbufReadU8(src);
        value.gpsNodeID = sbufReadU8(src);
        value.batteryNodeID = sbufReadU8(src);
        value.primaryGpsSource = sbufReadU8(src);
        value.magNodeID = sbufReadU8(src);
        const bool nodeValid = value.nodeID >= 1 && value.nodeID <= 127;
        const bool gpsValid = value.gpsNodeID <= 127 || value.gpsNodeID == DRONECAN_NODE_ID_DISABLED;
        const bool batteryValid = value.batteryNodeID <= 127 || value.batteryNodeID == DRONECAN_NODE_ID_DISABLED;
        const bool magValid = value.magNodeID <= 127 || value.magNodeID == DRONECAN_NODE_ID_DISABLED;
        if (!nodeValid || value.bitRateKbps >= DRONECAN_BITRATE_COUNT || !gpsValid || !batteryValid ||
            !magValid || value.primaryGpsSource >= GPS_PRIMARY_SOURCE_COUNT ||
            (value.primaryGpsSource == GPS_PRIMARY_SOURCE_DRONECAN && value.gpsNodeID == DRONECAN_NODE_ID_DISABLED)) {
            return MSP_RESULT_ERROR;
        }
        *dronecanConfigMutable() = value;
        break;
    }
'''
    if old_handler in text:
        text = text.replace(old_handler, retained_handler, 1)
    elif retained_handler not in text:
        raise RuntimeError("Unable to preserve the guarded DroneCAN configuration handler")

    old_sources = r'''target_sources(MICOAIR743.elf PRIVATE
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_pair.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.GetNodeInfo_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_res.c
)
'''
    conditional_sources = r'''set(FLIGHT_COMMANDER_PAIR_SOURCES
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_pair.c
)
set(FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.GetNodeInfo_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_res.c
)
foreach(FLIGHT_COMMANDER_PAIR_DSDL_SOURCE IN LISTS FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES)
    if(EXISTS "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
        list(APPEND FLIGHT_COMMANDER_PAIR_SOURCES "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
    endif()
endforeach()
target_sources(MICOAIR743.elf PRIVATE ${FLIGHT_COMMANDER_PAIR_SOURCES})
'''
    if old_sources in text:
        text = text.replace(old_sources, conditional_sources, 1)
    elif conditional_sources not in text:
        raise RuntimeError("Unable to make DroneCAN service source selection conditional")

    text = replace_once_or_present(
        text,
        '''def patch_heading(root: Path) -> None:
    path = root / "src/main/flight_commander/heading_fusion.c"
''',
        '''def patch_heading(root: Path) -> None:
    path = root / "src/main/flight_commander/heading_fusion.c"
    replace_once(path,
        '#include "io/gps.h"\\n',
        '#include "io/gps.h"\\n#include "io/gps_dronecan.h"\\n')
''',
        "multi-node DroneCAN heading include",
    )

    if "#define CANARD_DSDLC_INTERNAL" not in text:
        text = replace_once_or_present(
            text,
            '''#include <string.h>

#include "common/maths.h"''',
            '''#include <string.h>

#define CANARD_DSDLC_INTERNAL

#include "common/maths.h"''',
            "internal DSDL codec enable",
        )

    text = text.replace(
        "    struct uavcan_protocol_GetNodeInfoRequest request = { 0 };",
        "    struct uavcan_protocol_GetNodeInfoRequest request;",
    )
    text = text.replace(
        '''    struct uavcan_protocol_GetNodeInfoRequest request;
    uint8_t buffer[1] = { 0 };
    const uint16_t length = uavcan_protocol_GetNodeInfoRequest_encode(&request, buffer);
''',
        '''    const uint8_t buffer[1] = { 0 };
    const uint16_t length = 0;
''',
    )

    saturating_helper = '''static uint16_t saturatingU16(uint32_t value)
{
    return value > 65535U ? 65535U : (uint16_t)value;
}
'''
    if saturating_helper not in text:
        text = replace_once_or_present(
            text,
            '''static uint8_t restartTransferID;

static void setError(uint8_t error)
''',
            '''static uint8_t restartTransferID;

''' + saturating_helper + '''
static void setError(uint8_t error)
''',
            "u16 age saturation helper",
        )

    codec_functions = '''static uint16_t encodeGetSetRequest(struct uavcan_protocol_param_GetSetRequest *message, uint8_t *buffer)
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
'''
    if "static uint16_t encodeGetSetRequest(" not in text:
        anchor = saturating_helper + "\nstatic void setError(uint8_t error)\n"
        replacement = saturating_helper + "\n" + codec_functions + "\nstatic void setError(uint8_t error)\n"
        text = replace_once_or_present(text, anchor, replacement, "local DroneCAN service codecs")

    text = text.replace("MIN(gpsStatus.ageMs, UINT16_MAX)", "saturatingU16(gpsStatus.ageMs)")
    text = text.replace(
        "lastRelPosMs ? MIN(millis() - lastRelPosMs, UINT16_MAX) : UINT16_MAX",
        "lastRelPosMs ? saturatingU16(millis() - lastRelPosMs) : UINT16_MAX",
    )

    replacements = {
        "uavcan_protocol_param_GetSetRequest_encode(&request, buffer)": "encodeGetSetRequest(&request, buffer)",
        "uavcan_protocol_param_ExecuteOpcodeRequest_encode(&request, buffer)": "encodeExecuteOpcodeRequest(&request, buffer)",
        "uavcan_protocol_RestartNodeRequest_encode(&request, buffer)": "encodeRestartNodeRequest(&request, buffer)",
        "uavcan_protocol_param_GetSetResponse_decode(transfer, &response)": "decodeGetSetResponse(transfer, &response)",
        "uavcan_protocol_param_ExecuteOpcodeResponse_decode(transfer, &response)": "decodeExecuteOpcodeResponse(transfer, &response)",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    path.write_text(text, encoding="utf-8")


def patch_tests() -> None:
    replace(
        "tests/flight-commander/firmware/heading-fusion.test.mjs",
        "const enabledCan = { gpsNodeId: 42, magNodeId: 73 };",
        "const enabledCan = { gpsNodeId: 42, movingRoverNodeId: 42, magNodeId: 73 };",
    )
    replace(
        "tests/flight-commander/firmware/heading-fusion.test.mjs",
        "/DroneCAN GNSS node/",
        "/moving-rover node/",
    )

    package_test = ROOT / "tests/flight-commander/packaging/package-contract.test.mjs"
    text = package_test.read_text(encoding="utf-8")
    text = text.replace(
        ".github/workflows/release-3.0.7-orchestrator.yml",
        ".github/workflows/release-4.0.0-orchestrator.yml",
    )
    text = text.replace('"3.0.7"', '"4.0.0"')
    text = text.replace("3\\.0\\.7", "4\\.0\\.0")
    package_test.write_text(text, encoding="utf-8")


def patch_runtime_versions() -> None:
    replace("tabs/landing.html", "Flight Commander 3.0.7", "Flight Commander 4.0.0", required=False)
    replace(
        "js/main/ntripClient.js",
        "NTRIP FlightCommander/3.0.7",
        "NTRIP FlightCommander/4.0.0",
        required=False,
    )


def main() -> None:
    patch_firmware_builder()
    patch_tests()
    patch_runtime_versions()
    print("Flight Commander 4.0.0 coordinated contracts finalized.")


if __name__ == "__main__":
    main()
