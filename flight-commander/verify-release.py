#!/usr/bin/env python3
"""Verify the Flight Commander 4.3.2 source and all official target images."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

VERSION = "4.3.2"
EXPECTED_TARGET_COUNT = 50
UPSTREAM_RELEASE = "9.1.0"
UPSTREAM_COMMIT = "e519b69b02e27c8bdc03b4a0889f1baaae211a54"


def fail(message: str) -> None:
    raise ValueError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_target_records(root: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen: set[str] = set()
    manifest_path = root / "flight-commander/official-targets.txt"
    for line_number, raw_line in enumerate(
        manifest_path.read_text(encoding="utf-8").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 3:
            fail(f"target manifest line {line_number} is malformed")
        target, mcu, dronecan = fields
        if not re.fullmatch(r"[A-Za-z0-9_]+", target):
            fail(f"target manifest has invalid target name {target}")
        if target in seen:
            fail(f"target manifest contains duplicate target {target}")
        if mcu not in {"STM32H743XI", "STM32H757XI"}:
            fail(f"target manifest uses unsupported MCU {mcu} for {target}")
        if dronecan not in {"NONE", "TARGET"} and not re.fullmatch(
            r"P[A-K][0-9]{1,2},P[A-K][0-9]{1,2}", dronecan
        ):
            fail(f"target manifest has invalid DroneCAN mapping for {target}")
        seen.add(target)
        records.append({"target": target, "mcu": mcu, "dronecan": dronecan})
    if len(records) != EXPECTED_TARGET_COUNT:
        fail(
            f"target manifest contains {len(records)} targets; "
            f"expected {EXPECTED_TARGET_COUNT}"
        )
    return records


def source_identities(root: Path) -> tuple[str, str]:
    entries = (
        ".dir-locals.el", ".dockerignore", ".gitattributes", ".gitignore",
        ".travis.sh", ".travis.yml", ".vimrc", "AGENT.md", "AUTHORS",
        "CMakeLists.txt", "Dockerfile", "JLinkSettings.ini", "LICENSE",
        "README.md", "Vagrantfile", "build.sh", "build_docs.sh", "cmake",
        "dev", "fake_travis_build.sh", "flight-commander", "lib", "src",
    )
    files: list[Path] = []
    for relative in entries:
        path = root / relative
        files.extend(
            [path]
            if path.is_file()
            else [
                item for item in path.rglob("*")
                if item.is_file() and "__pycache__" not in item.parts and item.suffix != ".pyc"
            ]
        )
    records: list[str] = []
    for path in sorted(set(files), key=lambda item: item.relative_to(root).as_posix()):
        if path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{sha256(path)}  {relative}\n")
    canonical = "".join(records).encode()
    return (
        hashlib.sha1(canonical).hexdigest(),
        hashlib.sha1(b"flight-commander-source-tree-v1\n" + canonical).hexdigest(),
    )


def require_text(path: Path, patterns: list[str]) -> None:
    if not path.is_file():
        fail(f"required source file is missing: {path}")
    text = path.read_text(encoding="utf-8")
    for pattern in patterns:
        if not re.search(pattern, text, re.MULTILINE | re.DOTALL):
            fail(f"{path}: required {VERSION} source contract is missing: {pattern}")


def verify_upstream_baseline(root: Path) -> None:
    baseline = json.loads(
        (root / "flight-commander/INAV-9.1.0-BASELINE.json").read_text(encoding="utf-8")
    )
    upstream = baseline.get("upstream", {})
    if upstream.get("release") != UPSTREAM_RELEASE or upstream.get("commit") != UPSTREAM_COMMIT:
        fail("protected upstream baseline is not official INAV 9.1.0")
    protected = baseline.get("protected_files")
    extensions = baseline.get("intentional_extensions")
    if not isinstance(protected, dict) or len(protected) < 50:
        fail("protected INAV baseline is incomplete")
    if not isinstance(extensions, dict) or not extensions:
        fail("intentional Flight Commander extensions are not declared")
    required_extensions = {
        "src/main/flight/imu.c",
        "src/main/common/maths.c",
        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/sensors/compass.c",
        "src/main/target/MICOAIR743/target.h",
    }
    if not required_extensions.issubset(extensions):
        fail("the reviewed upstream extension set is incomplete")
    for relative, expected_upstream in protected.items():
        path = root / relative
        if not path.is_file():
            fail(f"protected INAV file is missing: {relative}")
        declaration = extensions.get(relative)
        if declaration is None:
            if sha256(path) != expected_upstream:
                fail(f"protected INAV file changed without declaration: {relative}")
            continue
        if not isinstance(declaration, dict):
            fail(f"extension declaration is invalid: {relative}")
        if declaration.get("upstream_sha256") != expected_upstream:
            fail(f"extension upstream hash is invalid: {relative}")
        if not re.fullmatch(r"[0-9a-f]{64}", str(declaration.get("patched_sha256", ""))):
            fail(f"extension retained-release hash is invalid: {relative}")
        if not str(declaration.get("purpose", "")).strip():
            fail(f"extension has no documented purpose: {relative}")


def verify_source(root: Path) -> None:
    verify_upstream_baseline(root)
    require_text(root / "CMakeLists.txt", [
        r"set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 4\.3\.2\)",
        r"FLIGHT_COMMANDER_SOURCE_REVISION",
    ])
    require_text(root / "src/main/build/flight_commander.h", [
        r"FLIGHT_COMMANDER_VERSION_MAJOR 4",
        r"FLIGHT_COMMANDER_VERSION_MINOR 3",
        r"FLIGHT_COMMANDER_VERSION_PATCH 2",
        r"FLIGHT_COMMANDER_CAPABILITY_INDIVIDUAL_COMPASS_CALIBRATION = \(1U << 15\)",
        r"FLIGHT_COMMANDER_CAPABILITY_SLCAN_DRONECAN_BRIDGE = \(1U << 16\)",
        r"FLIGHT_COMMANDER_BASE_CAPABILITIES",
        r"FLIGHT_COMMANDER_DRONECAN_CAPABILITIES",
        r"FLIGHT_COMMANDER_CAPABILITIES",
    ])
    require_text(root / "src/main/CMakeLists.txt", [
        r"drivers/dshot\.c",
        r"drivers/dshot\.h",
    ])
    require_text(root / "src/main/config/parameter_group_ids.h", [
        r"PG_FLIGHT_COMMANDER_DSHOT_CONFIG\s+1048",
        r"PG_INAV_END\s+PG_FLIGHT_COMMANDER_DSHOT_CONFIG",
    ])
    require_text(root / "src/main/drivers/dshot.h", [
        r"DSHOT_TELEMETRY_TIMEOUT_US",
        r"typedef struct dshotConfig_s.*useDshotTelemetry.*useDshotEdt",
        r"PG_DECLARE\(dshotConfig_t, dshotConfig\)",
        r"isDshotTelemetryMotorActive",
    ])
    require_text(root / "src/main/drivers/dshot.c", [
        r"PG_REGISTER_WITH_RESET_TEMPLATE\(dshotConfig_t, dshotConfig, "
        r"PG_FLIGHT_COMMANDER_DSHOT_CONFIG, 0\)",
        r"PG_RESET_TEMPLATE\(dshotConfig_t, dshotConfig,.*"
        r"\.useDshotTelemetry = 0,.*\.useDshotEdt = 0",
        r"useDshotTelemetry = feature\(FEATURE_PWM_OUTPUT_ENABLE\).*"
        r"dshotConfig\(\)->useDshotTelemetry.*PWM_TYPE_DSHOT150",
        r"isDshotTelemetryMotorActive.*lastValidTelemetryUs",
    ])
    require_text(root / "src/main/drivers/pwm_output.c", [
        r"DSHOT_DMA_BUFFER_ALIGNED_BYTES",
        r"SCB_CleanDCache_by_Addr",
        r"SCB_InvalidateDCache_by_Addr",
        r"if \(useDshotTelemetry\).*csum = ~csum",
        r"pwmSetMotorDMACircular\(bool circular\).*"
        r"if \(!isMotorProtocolDshot\(\)\).*return;.*"
        r"if \(useDshotTelemetry\).*return;.*"
        r"int motorCount = getMotorCount\(\)",
        r"pwmMotorPreconfigure\(void\).*"
        r"useDshotTelemetry = feature\(FEATURE_PWM_OUTPUT_ENABLE\).*"
        r"dshotConfig\(\)->useDshotTelemetry.*isDSHOT",
        r"defined\(STM32H7\) && defined\(USE_DSHOT_DMAR\).*"
        r"useDshotTelemetry && timerHardware->tim == TIM4 && "
        r"timerHardware->channelIndex == 3.*"
        r"Motor output has no dedicated DMA channel for DShot",
        r"Bidirectional DShot requires a non-complementary timer channel",
        r"Motor output has no dedicated DMA channel for DShot",
    ])
    require_text(root / "src/main/fc/settings.yaml", [
        r"name: PG_FLIGHT_COMMANDER_DSHOT_CONFIG.*condition: USE_DSHOT",
        r"name: dshot_bidir_enabled.*field: useDshotTelemetry",
        r"name: dshot_edt_enabled.*field: useDshotEdt",
    ])
    require_text(root / "flight-commander/build-targets.sh", [
        r"SETTING_DSHOT_BIDIR_ENABLED",
        r"SETTING_DSHOT_EDT_ENABLED",
        r"settings_generated\.h",
    ])
    require_text(root / "src/main/target/common_post.h", [
        r"defined\(USE_ESC_SENSOR\) \|\| defined\(USE_DSHOT\).*"
        r"#define USE_RPM_FILTER",
    ])
    require_text(root / "src/main/flight_commander/slcan_bridge.h", [
        r"FLIGHT_COMMANDER_SLCAN_BRIDGE_SCHEMA 1U",
        r"SLCAN_BRIDGE_ENTRY_ARMED",
        r"SLCAN_BRIDGE_ENTRY_DRONECAN_OFFLINE",
        r"slcanBridgeEnter",
        r"slcanBridgeCaptureRxFrame",
    ])
    require_text(root / "src/main/flight_commander/slcan_bridge.c", [
        r"SLCAN_HOST_TX_QUEUE_SIZE 32U",
        r"SLCAN_BUS_RX_QUEUE_SIZE 64U",
        r"case 'C':",
        r"case 'S':",
        r"case 'O':",
        r"case 'Z':",
        r"case 'F':",
        r"case 'T':",
        r"dronecanGetState\(\) != STATE_DRONECAN_NORMAL",
        r"ENABLE_ARMING_FLAG\(ARMING_DISABLED_DRONECAN_BRIDGE\)",
    ])
    require_text(root / "cmake/flight-commander-micoair743.cmake", [
        r"flight_commander/slcan_bridge\.c",
        r"USE_FLIGHT_COMMANDER_SLCAN_BRIDGE",
        r"configure_flight_commander_target\(MICOAIR743 PB8 PB9\)",
        r"configure_flight_commander_target\(CUBEORANGEPLUS PD0 PD1\)",
    ])
    require_text(root / "src/main/flight_commander/compass_orientation.h", [
        r"FLIGHT_COMMANDER_COMPASS_ORIENTATION_CONFIG_SCHEMA 2U",
        r"FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_COUNT 3U",
        r"SOURCE_ONBOARD = 0",
        r"SOURCE_EXTERNAL_I2C = 1",
        r"SOURCE_DRONECAN = 2",
        r"COMMAND_SELECT = 5",
        r"calibrationGeneration",
    ])
    require_text(root / "src/main/flight_commander/compass_orientation.c", [
        r"properAxisMaps\[24\]",
        r"sourceFingerprint\(uint8_t source\)",
        r"flightCommanderCompassOrientationInvalidateFieldCalibration\(source\)",
        r"command == FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND_SELECT",
        r"source != session\.source",
        r"saveConfigAndNotify\(\)",
    ])
    require_text(root / "src/main/flight_commander/heading_fusion.c", [
        r"activeFieldCalibrationSource = FLIGHT_COMMANDER_HEADING_SOURCE_NONE",
        r"headingSourceOrientationIsValid\(unsigned index\)",
        r"headingSourceOrientationIsValid\(index\) && externalMagIsCalibrated",
        r"headingSourceOrientationIsValid\(index\) && dronecanMagIsCalibrated",
        r"flightCommanderCompassOrientationIsValid\(source\)",
        r"orientedCalibrationSample\(uint8_t source",
        r"dronecanRawNodeID == context->nodeID",
        r"dronecanMagCalibrationNodeID = context->nodeID",
    ])
    require_text(root / "src/main/sensors/compass.c", [
        r"flightCommanderCompassOrientationObserve\(",
        r"flightCommanderCompassOrientationApply\(",
        r"flightCommanderHeadingOnboardCalibrationStarted\(\)",
        r"flightCommanderHeadingOnboardCalibrationFinished\(true\)",
    ])
    require_text(root / "src/main/msp/msp_protocol_v2_flight_commander.h", [
        r"MSP2_FLIGHT_COMMANDER_SLCAN_BRIDGE\s+0x2F15",
        r"MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS 0x2F23",
        r"MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND 0x2F24",
        r"MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND 0x2F25",
    ])
    require_text(root / "src/main/fc/fc_msp.c", [
        r"MSP2_FLIGHT_COMMANDER_SLCAN_BRIDGE",
        r"\*mspPostProcessFn = mspFcEnterSlcanBridge",
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS:",
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:",
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND:",
        r"flightCommanderHeadingReadCompassCalibrationCommand\(src\)",
        r"case MSP_ALTITUDE:.*getTelemetryRelativeAltitude\(\)",
        r"sdcard_hasInsertionDetect\(\) \? MSP_SDCARD_STATE_FATAL : MSP_SDCARD_STATE_NOT_PRESENT",
        r"MSP_FLASHFS_BIT_SUPPORTED \| \(flashIsReady\(\) \? MSP_FLASHFS_BIT_READY : 0\)",
    ])
    require_text(root / "src/main/fc/fc_core.c", [
        r"ENABLE_ARMING_FLAG\(ARMED\);\s*resetTelemetryRelativeAltitude\(\);",
    ])
    require_text(root / "src/main/navigation/navigation.c", [
        r"resetTelemetryRelativeAltitude\(void\).*telemetryRelativeAltitudeArmOffset = "
        r"getEstimatedActualPosition\(Z\).*telemetryRelativeAltitudeArmOffsetValid = true",
        r"getTelemetryRelativeAltitude\(void\).*if \(ARMING_FLAG\(ARMED\)\).*"
        r"getEstimatedActualPosition\(Z\) - telemetryRelativeAltitudeArmOffset.*"
        r"telemetryRelativeAltitudeArmOffsetValid = false.*baroIsCalibrationComplete\(\).*"
        r"return baroGetLatestAltitude\(\)",
    ])
    require_text(root / "src/main/telemetry/mavlink.c", [
        r"relative_alt.*getTelemetryRelativeAltitude\(\) \* 10",
        r"mavAltitude = getTelemetryRelativeAltitude\(\) / 100\.0f",
    ])
    require_text(root / "src/main/drivers/sdcard/sdcard.c", [
        r"sdcard_hasInsertionDetect\(void\).*return sdcard\.cardDetectPin != NULL",
    ])
    require_text(root / "src/main/fc/runtime_config.c", [
        r"ARMING_DISABLED_DRONECAN_BRIDGE",
        r"flightCommanderPrimaryModeForTelemetry\(void\)",
        r"isRcModeActiveFromInput\(BOXNAVRTH\)",
        r"isRcModeActiveFromInput\(BOXNAVWP\)",
        r"isRcModeActiveFromInput\(BOXPLANWPMISSION\)",
        r"isRcModeActiveFromInput\(BOXNAVPOSHOLD\)",
        r"angleRequested && altitudeHoldRequested",
        r"return FLM_ACRO;",
    ])
    require_text(root / "src/main/msp/msp_serial.c", [
        r"slcanBridgeOwnsPort",
        r"slcanBridgeProcessSerial",
        r"waitForSerialPortToFinishTransmitting",
    ])
    require_text(root / "src/main/drivers/dronecan/dronecan.c", [
        r"slcanBridgeIsActive",
        r"canardSTM32Transmit\(&bridgeFrame\)",
        r"slcanBridgeCaptureRxFrame",
    ])
    require_text(root / "src/main/fc/fc_msp_box.c", [
        r"PRIMARY_MODE_ACTIVE_OR_SELECTED\(ANGLE_MODE, BOXANGLE\)",
        r"PRIMARY_MODE_ACTIVE_OR_SELECTED\(NAV_ALTHOLD_MODE, BOXNAVALTHOLD\)",
        r"PRIMARY_MODE_ACTIVE_OR_SELECTED\(NAV_POSHOLD_MODE, BOXNAVPOSHOLD\)",
        r"PRIMARY_MODE_ACTIVE_OR_SELECTED\(NAV_RTH_MODE, BOXNAVRTH\)",
        r"PRIMARY_MODE_ACTIVE_OR_SELECTED\(NAV_WP_MODE, BOXNAVWP\)",
    ])
    require_text(root / "src/main/target/MICOAIR743/target.h", [
        r"IMU_BMI088_ALIGN\s+CW270_DEG",
        r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
        r"USE_SDCARD.*USE_SDCARD_SDIO.*SDCARD_SDIO_DEVICE\s+SDIODEV_1.*"
        r"ENABLE_BLACKBOX_LOGGING_ON_SDCARD_BY_DEFAULT",
    ])
    require_text(root / "src/main/target/CUBEORANGEPLUS/CMakeLists.txt", [
        r"target_stm32h757xi",
        r"HSE_MHZ 24",
        r"HEX_START_ADDRESS 0x08020000",
        r"USE_H7_DIRECT_SMPS_SUPPLY",
        r"USE_CUBEORANGEPLUS_ARDUPILOT_STARTUP",
        r"VECT_TAB_OFFSET=0x00020000",
    ])
    require_text(root / "src/main/target/CUBEORANGEPLUS/target.h", [
        r'TARGET_BOARD_IDENTIFIER "COPL"',
        r'USBD_PRODUCT_STRING\s+"Flight Commander CubeOrange\+"',
        r"USE_VENDOR_BOOTLOADER_CLOCK_HANDOFF",
        r"USE_USB_CDC_TIMER_CLOCK_PREINIT",
        r"USE_TARGET_IMU_HARDWARE_DESCRIPTORS",
        r"MAX_PWM_OUTPUT_PORTS 6",
        r"USART6 is reserved for the onboard IOMCU",
        r"MAG_I2C_BUS\s+BUS_I2C1",
        r"USE_SDCARD.*USE_SDCARD_SDIO.*SDCARD_SDIO_DEVICE\s+SDIODEV_1.*"
        r"ENABLE_BLACKBOX_LOGGING_ON_SDCARD_BY_DEFAULT",
    ])
    require_text(root / "src/main/target/CUBEORANGEPLUS/target.c", [
        r"cube_imu0_icm42688.*PC15.*CW270_DEG_FLIP",
        r"cube_imu0_icm45686.*PC15.*CW270_DEG_FLIP",
        r"cube_imu1_icm42688.*PC13.*CW270_DEG\)",
        r"cube_imu1_icm45686.*PC13.*CW270_DEG\)",
        r"ArduPilot-to-Flight\s+\* Commander sensor-driver convention adds a 180-degree roll",
        r"PA8",
        r"PE3",
        r"PB4",
    ])
    cube_target = (root / "src/main/target/CUBEORANGEPLUS/target.c").read_text(encoding="utf-8")
    if len(re.findall(r"TIM_USE_OUTPUT_AUTO", cube_target)) != 6:
        fail("Cube Orange+ must expose exactly its six direct FMU AUX outputs")
    if re.search(r"\bUSE_UART6\b", (root / "src/main/target/CUBEORANGEPLUS/target.h").read_text(encoding="utf-8")):
        fail("Cube Orange+ must not expose its IOMCU USART6 as a general serial port")
    require_text(root / "src/main/target/CUBEORANGEPLUS/startup.c", [
        r"ArduPilot 4\.7\.0 CubeOrangePlus hwdef\.dat",
        r"1511f27194f1dcc3728270883047bdf022b3fd53",
        r"PWR->CR1 = 0xF000C000U",
        r"RCC->PLLCKSELR = 0x00602032U",
        r"RCC->PLL1DIVR = 0x01090263U",
        r"RCC->PLL2DIVR = 0x02050431U",
        r"RCC->PLL3DIVR = 0x08050E47U",
        r"RCC->PLLCFGR = 0x01BF0BDDU",
        r"RCC->D2CCIP2R = 0x00E01009U",
        r"RCC->D3CCIPR = 0x10010100U",
    ])
    require_text(root / "src/main/startup/startup_stm32h757xx.s", [
        r"Reset_Handler:.*cpsid i.*ldr\s+r0, =_estack.*msr\s+msp, r0.*msr\s+psp, r0",
        r"msr\s+control, r0.*isb.*bl cubeOrangePlusEarlyInit.*CopyDataInit:",
        r"LoopMarkHeapStack:.*bl persistentObjectInit.*bl\s+SystemInit",
    ])
    require_text(root / "src/main/target/link/stm32_flash_h757xi.ld", [
        r"FLASH \(rx\)\s*: ORIGIN = 0x08020000, LENGTH = 128K",
        r"FLASH1 \(rx\)\s*: ORIGIN = 0x08040000, LENGTH = 1664K",
        r"FLASH_CONFIG \(r\)\s*: ORIGIN = 0x081E0000, LENGTH = 128K",
        r"D2_STACK \(rwx\)\s*: ORIGIN = 0x30000000, LENGTH = 8K",
        r"D2_RAM \(rwx\)\s*: ORIGIN = 0x30002000, LENGTH = 248K",
        r'REGION_ALIAS\("STACKRAM", D2_STACK\)',
    ])
    require_text(root / "src/main/target/system_stm32h7xx.c", [
        r"USE_H7_DIRECT_SMPS_SUPPLY",
        r"PWR_DIRECT_SMPS_SUPPLY",
        r"USE_CUBEORANGEPLUS_ARDUPILOT_STARTUP.*HAL_Init\(\);.*"
        r"SCB->ICSR = SCB_ICSR_PENDSTCLR_Msk \| SCB_ICSR_PENDSVCLR_Msk;.*"
        r"__set_BASEPRI\(0U\);.*__set_FAULTMASK\(0U\);.*__enable_irq\(\);.*#else",
    ])
    require_text(root / "src/main/vcp_hal/usbd_cdc_interface.c", [
        r"USE_USB_CDC_TIMER_CLOCK_PREINIT.*TIMx_CLK_ENABLE\(\);.*HAL_TIM_Base_Init",
        r"#ifndef USE_USB_CDC_TIMER_CLOCK_PREINIT.*TIMx_CLK_ENABLE\(\);",
    ])
    require_text(root / "src/main/vcp_hal/usbd_desc.c", [
        r'USBD_MANUFACTURER_STRING\s+"Flight Commander"',
        r"#ifdef USBD_PRODUCT_STRING",
        r"USBD_PRODUCT_FS_STRING\s+USBD_PRODUCT_STRING",
    ])


def verify_manifest(root: Path, hex_paths: list[Path], manifest_path: Path) -> None:
    target_records = read_target_records(root)
    targets = [record["target"] for record in target_records]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {
        "schema": 3,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "targets": targets,
        "inav_release": UPSTREAM_RELEASE,
        "inav_commit": UPSTREAM_COMMIT,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            fail(f"manifest {key!r} is {manifest.get(key)!r}, expected {value!r}")
    revision, tree = source_identities(root)
    if manifest.get("source_revision") != revision or manifest.get("source_tree") != tree:
        fail("manifest source identities do not identify the supplied source")
    masks = manifest.get("capability_masks")
    if not isinstance(masks, dict) or any(
        not re.fullmatch(r"0x[0-9a-f]{8}", str(masks.get(key, "")))
        for key in ("base", "dronecan")
    ):
        fail("manifest capability masks are invalid")
    if int(masks["base"], 16) & ~int(masks["dronecan"], 16):
        fail("manifest DroneCAN mask does not include every base capability")
    expected_matrix = {
        record["target"]: {
            "mcu": record["mcu"],
            "dronecan": record["dronecan"] != "NONE",
            "capability_mask": masks[
                "dronecan" if record["dronecan"] != "NONE" else "base"
            ],
        }
        for record in target_records
    }
    if manifest.get("target_matrix") != expected_matrix:
        fail("manifest target matrix does not match the canonical target inventory")
    if len(hex_paths) != len(targets):
        fail(f"expected {len(targets)} official HEX images, received {len(hex_paths)}")
    by_name = {path.name: path for path in hex_paths}
    if len(by_name) != len(hex_paths):
        fail("duplicate official HEX filenames were supplied")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or list(artifacts) != targets:
        fail("manifest artifact targets are missing or out of canonical order")
    for record in target_records:
        target = record["target"]
        artifact = artifacts.get(target)
        if not isinstance(artifact, dict):
            fail(f"manifest artifact is missing for {target}")
        expected_name = f"Flight-Commander-Firmware-{VERSION}-{target}.hex"
        hex_path = by_name.get(expected_name)
        if hex_path is None or artifact.get("filename") != expected_name:
            fail(f"manifest artifact filename does not match the {target} HEX")
        if artifact.get("sha256") != sha256(hex_path):
            fail(f"manifest SHA-256 does not match the {target} HEX")
        if artifact.get("bytes") != hex_path.stat().st_size:
            fail(f"manifest byte count does not match the {target} HEX")
    requirement = str(manifest.get("bench_acceptance", {}).get("propeller_requirement", "")).lower()
    if "propellers removed" not in requirement:
        fail("manifest does not preserve the propeller-off acceptance requirement")
    bridge = manifest.get("slcan_bridge", {})
    dronecan_targets = [
        record["target"] for record in target_records if record["dronecan"] != "NONE"
    ]
    if bridge.get("targets") != dronecan_targets or "reboot" not in str(bridge.get("exit", "")).lower():
        fail("manifest does not preserve the mapped-target reboot-only SLCAN bridge contract")
    dronecan_compass = manifest.get("dronecan_compass", {})
    if dronecan_compass.get("targets") != dronecan_targets:
        fail("manifest DroneCAN compass targets do not match the mapped target inventory")
    dshot = manifest.get("bidirectional_dshot", {})
    if dshot != {
        "targets": "all official targets",
        "protocols": ["DSHOT150", "DSHOT300", "DSHOT600"],
        "enable_setting": "dshot_bidir_enabled",
        "extended_telemetry_setting": "dshot_edt_enabled",
        "motor_poles_setting": "motor_poles",
        "default_enabled": False,
        "telemetry_timeout_us": 100000,
    }:
        fail("manifest bidirectional DShot contract is invalid")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--hex", required=True, nargs="+", type=Path, dest="hex_paths")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    root = args.source_root.resolve()
    hex_paths = [path.resolve() for path in args.hex_paths]
    verify_source(root)
    for hex_path in hex_paths:
        subprocess.run(
            [sys.executable, str(root / "flight-commander/verify-compass-release.py"), str(hex_path)],
            check=True,
        )
    verify_manifest(root, hex_paths, args.manifest.resolve())
    for hex_path in hex_paths:
        print(f"Verified {hex_path.name}: {hex_path.stat().st_size} bytes, SHA-256 {sha256(hex_path)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f"verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
