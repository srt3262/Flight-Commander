#!/usr/bin/env python3
"""Verify the Flight Commander 4.0.8 MICOAIR743 source and HEX contract."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

VERSION = "4.0.8"
TARGET = "MICOAIR743"
UPSTREAM_RELEASE = "9.1.0"
UPSTREAM_COMMIT = "e519b69b02e27c8bdc03b4a0889f1baaae211a54"
CAPABILITIES = "0x0000ffff"


def fail(message: str) -> None:
    raise ValueError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_identities(root: Path) -> tuple[str, str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json" or ".git" in path.parts:
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
            fail(f"{path}: required 4.0.8 source contract is missing: {pattern}")


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
        r"set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 4\.0\.8\)",
        r"FLIGHT_COMMANDER_SOURCE_REVISION",
    ])
    require_text(root / "src/main/build/flight_commander.h", [
        r"FLIGHT_COMMANDER_VERSION_MAJOR 4",
        r"FLIGHT_COMMANDER_VERSION_MINOR 0",
        r"FLIGHT_COMMANDER_VERSION_PATCH 8",
        r"FLIGHT_COMMANDER_CAPABILITY_INDIVIDUAL_COMPASS_CALIBRATION = \(1U << 15\)",
        r"FLIGHT_COMMANDER_CAPABILITIES \(\(uint32_t\)0xFFFFU\)",
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
        r"MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS 0x2F23",
        r"MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND 0x2F24",
        r"MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND 0x2F25",
    ])
    require_text(root / "src/main/fc/fc_msp.c", [
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS:",
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:",
        r"case MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND:",
        r"flightCommanderHeadingReadCompassCalibrationCommand\(src\)",
    ])
    require_text(root / "src/main/target/MICOAIR743/target.h", [
        r"IMU_BMI088_ALIGN CW270_DEG",
        r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
    ])


def verify_manifest(root: Path, hex_path: Path, manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {
        "schema": 1,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "target": TARGET,
        "inav_release": UPSTREAM_RELEASE,
        "inav_commit": UPSTREAM_COMMIT,
        "capabilities": CAPABILITIES,
        "capability_mask": CAPABILITIES,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            fail(f"manifest {key!r} is {manifest.get(key)!r}, expected {value!r}")
    revision, tree = source_identities(root)
    if manifest.get("source_revision") != revision or manifest.get("source_tree") != tree:
        fail("manifest source identities do not identify the supplied source")
    artifact = manifest.get("artifact", {})
    if artifact.get("filename") != hex_path.name:
        fail("manifest artifact filename does not match the HEX")
    if artifact.get("sha256") != sha256(hex_path):
        fail("manifest SHA-256 does not match the HEX")
    if artifact.get("bytes") != hex_path.stat().st_size:
        fail("manifest byte count does not match the HEX")
    requirement = str(manifest.get("bench_acceptance", {}).get("propeller_requirement", "")).lower()
    if "propellers removed" not in requirement:
        fail("manifest does not preserve the propeller-off acceptance requirement")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--hex", required=True, type=Path, dest="hex_path")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    root = args.source_root.resolve()
    hex_path = args.hex_path.resolve()
    verify_source(root)
    subprocess.run(
        [sys.executable, str(root / "flight-commander/verify-compass-release.py"), str(hex_path)],
        check=True,
    )
    verify_manifest(root, hex_path, args.manifest.resolve())
    print(f"Verified {hex_path.name}: {hex_path.stat().st_size} bytes, SHA-256 {sha256(hex_path)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f"verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
