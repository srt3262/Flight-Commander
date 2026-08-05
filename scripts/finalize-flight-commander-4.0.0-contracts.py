#!/usr/bin/env python3
"""Finalize source and test contracts for the coordinated 4.0.0 build."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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


def patch_firmware_builder() -> None:
    path = ROOT / "scripts/prepare-flight-commander-firmware-4.0.0.py"
    text = path.read_text(encoding="utf-8")
    old = '''    if "bool dronecanSendServiceRequest(" not in value:
        value = value.replace("\\n#endif\\n", append + "\\n#endif\\n")
        path.write_text(value, encoding="utf-8")
'''
    new = '''    if "bool dronecanSendServiceRequest(" not in value:
        marker = "\\n#endif\\n"
        insertion = value.rfind(marker)
        if insertion < 0:
            raise RuntimeError("dronecan.c has no final preprocessor terminator")
        value = value[:insertion] + append + value[insertion:]
        path.write_text(value, encoding="utf-8")
'''
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("Unable to patch final dronecan.c insertion logic")

    old = '''#include "drivers/dronecan/libcanard/canard.h"

#define DRONECAN_PAIR_STATUS_SCHEMA 1
'''
    new = '''#include "drivers/dronecan/libcanard/canard.h"

struct ardupilot_gnss_RelPosHeading;

#define DRONECAN_PAIR_STATUS_SCHEMA 1
'''
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("Unable to add RelPosHeading forward declaration")

    # The retained 3.0.7 protocol header uses compact macro spacing.
    text = text.replace(
        "MSP2_FLIGHT_COMMANDER_DRONECAN_NODES         0x2F12",
        "MSP2_FLIGHT_COMMANDER_DRONECAN_NODES 0x2F12",
    )

    # Match the guarded, validated 3.0.7 SET_DRONECAN_CONFIG handler exactly.
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
        raise RuntimeError("Unable to patch the retained DroneCAN config handler pattern")

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

    # heading_fusion.c needs the 4.0 multi-node DroneCAN status type and accessor.
    old_heading_patch = '''def patch_heading(root: Path) -> None:
    path = root / "src/main/flight_commander/heading_fusion.c"
'''
    new_heading_patch = '''def patch_heading(root: Path) -> None:
    path = root / "src/main/flight_commander/heading_fusion.c"
    replace_once(path,
        '#include "io/gps.h"\\n',
        '#include "io/gps.h"\\n#include "io/gps_dronecan.h"\\n')
'''
    if old_heading_patch in text:
        text = text.replace(old_heading_patch, new_heading_patch, 1)
    elif new_heading_patch not in text:
        raise RuntimeError("Unable to add the multi-node DroneCAN GPS include")

    # Generated GetNodeInfo request structures are empty; declaring one is valid,
    # but an aggregate initializer is rejected with warnings-as-errors.
    text = text.replace(
        "    struct uavcan_protocol_GetNodeInfoRequest request = { 0 };",
        "    struct uavcan_protocol_GetNodeInfoRequest request;",
    )

    # Keep 32-bit millisecond ages explicit before narrowing them to the MSP u16 wire format.
    old_helper_anchor = '''static uint8_t restartTransferID;

static void setError(uint8_t error)
'''
    new_helper_anchor = '''static uint8_t restartTransferID;

static uint16_t saturatingU16(uint32_t value)
{
    return value > 65535U ? 65535U : (uint16_t)value;
}

static void setError(uint8_t error)
'''
    if old_helper_anchor in text:
        text = text.replace(old_helper_anchor, new_helper_anchor, 1)
    elif new_helper_anchor not in text:
        raise RuntimeError("Unable to add pair-status age saturation helper")
    text = text.replace("MIN(gpsStatus.ageMs, UINT16_MAX)", "saturatingU16(gpsStatus.ageMs)")
    text = text.replace(
        "lastRelPosMs ? MIN(millis() - lastRelPosMs, UINT16_MAX) : UINT16_MAX",
        "lastRelPosMs ? saturatingU16(millis() - lastRelPosMs) : UINT16_MAX",
    )

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
        '.github/workflows/release-3.0.7-orchestrator.yml',
        '.github/workflows/release-4.0.0-orchestrator.yml',
    )
    text = text.replace('"3.0.7"', '"4.0.0"')
    text = text.replace('3\\.0\\.7', '4\\.0\\.0')
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
