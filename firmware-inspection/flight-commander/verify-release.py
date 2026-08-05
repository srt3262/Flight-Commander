#!/usr/bin/env python3

"""Verify the Flight Commander 3.0.7 MICOAIR743 source and HEX contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


VERSION = "3.0.7"
TARGET = "MICOAIR743"
UPSTREAM_RELEASE = "9.1.0"
UPSTREAM_COMMIT = "e519b69b02e27c8bdc03b4a0889f1baaae211a54"
EXPECTED_IDENTITY = b"FCFW" + bytes((1, 3, 0, 7, 9, 1, 0, 0xFF, 0x1F, 0, 0))


def fail(message: str) -> None:
    raise ValueError(message)


def require_text(path: Path, patterns: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    for pattern in patterns:
        if not re.search(pattern, text, re.MULTILINE):
            fail(f"{path}: required source contract is missing: {pattern}")


def reject_text(path: Path, patterns: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    for pattern in patterns:
        if re.search(pattern, text, re.MULTILINE):
            fail(f"{path}: forbidden source contract is present: {pattern}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize_heading_centidegrees(value: int) -> int:
    return value % 36000


def verify_heading_math() -> None:
    """Exercise the exact source-heading correction over yaw and declination.

    The earth-frame field angle produced with an estimated yaw is
    true_yaw - declination - estimated_yaw.  INAV's corrected magnetic north
    angle is -declination.  Their measured-to-reference cross/dot angle is
    therefore estimated_yaw - true_yaw and must be subtracted.
    """
    cases = (
        (0, 0, 0),
        (90, 0, 0),
        (90, 25, 0),
        (90, 25, 37),
        (275, 12, -14),
        (359, 181, 8),
        (1, 340, -21),
    )
    for true_yaw, estimated_yaw, declination in cases:
        field_angle = math.radians(true_yaw - declination - estimated_yaw)
        reference_angle = math.radians(-declination)
        cross = math.cos(field_angle) * math.sin(reference_angle) - math.sin(field_angle) * math.cos(reference_angle)
        dot = math.cos(field_angle) * math.cos(reference_angle) + math.sin(field_angle) * math.sin(reference_angle)
        estimated_minus_measured = round(math.degrees(math.atan2(cross, dot)) * 100)
        result = normalize_heading_centidegrees(estimated_yaw * 100 - estimated_minus_measured)
        expected = true_yaw * 100 % 36000
        if abs(((result - expected + 18000) % 36000) - 18000) > 1:
            fail(
                "source-heading correction failed fixed-vector case: "
                f"true={true_yaw}, estimate={estimated_yaw}, declination={declination}, result={result / 100:.2f}"
            )

    # INAV's positive yaw maps body X/front into (cos(yaw), -sin(yaw)) in
    # earth-frame XY.  Moving-baseline heading must construct the identical
    # vector and must remain usable while a multirotor is level.
    for heading, expected in (
        (0, (1.0, 0.0)),
        (90, (0.0, -1.0)),
        (180, (-1.0, 0.0)),
        (270, (0.0, 1.0)),
    ):
        radians = math.radians(heading)
        reference = (math.cos(radians), -math.sin(radians))
        if any(abs(actual - wanted) > 1e-6 for actual, wanted in zip(reference, expected)):
            fail(
                "moving-baseline earth-frame vector failed cardinal case: "
                f"heading={heading}, vector={reference}"
            )


def verify_upstream_baseline(root: Path) -> None:
    baseline_path = root / "flight-commander/INAV-9.1.0-BASELINE.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    upstream = baseline.get("upstream", {})
    if upstream.get("release") != UPSTREAM_RELEASE:
        fail("protected baseline release is not INAV 9.1.0")
    if upstream.get("commit") != UPSTREAM_COMMIT:
        fail("protected baseline commit does not match official INAV 9.1.0")

    protected = baseline.get("protected_files", {})
    if len(protected) != 57:
        fail(f"protected baseline contains {len(protected)} files instead of 57")

    extensions = baseline.get("intentional_extensions", {})
    allowed_extensions = {
        "src/main/flight/imu.c",
        "src/main/common/maths.c",
        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/sensors/compass.c",
        "src/main/target/MICOAIR743/target.h",
    }
    if set(extensions) != allowed_extensions:
        fail("intentional Flight Commander source extensions do not match the reviewed release set")

    for relative, expected_upstream in protected.items():
        path = root / relative
        if not path.is_file():
            fail(f"protected INAV baseline file is missing: {relative}")
        actual = sha256(path)
        extension = extensions.get(relative)
        if extension is None:
            if actual != expected_upstream:
                fail(f"protected INAV baseline file changed without declaration: {relative}")
            continue
        if extension.get("upstream_sha256") != expected_upstream:
            fail(f"declared upstream hash does not match protected baseline: {relative}")
        if actual != extension.get("patched_sha256"):
            fail(f"declared Flight Commander extension changed: {relative}")

    for relative, extension in extensions.items():
        upstream_hash = extension.get("upstream_sha256", "")
        patched_hash = extension.get("patched_sha256", "")
        purpose = extension.get("purpose", "")
        if not re.fullmatch(r"[0-9a-f]{64}", upstream_hash):
            fail(f"extension has an invalid upstream hash: {relative}")
        if not re.fullmatch(r"[0-9a-f]{64}", patched_hash):
            fail(f"extension has an invalid patched hash: {relative}")
        if not isinstance(purpose, str) or not purpose.strip():
            fail(f"extension has no documented purpose: {relative}")
        path = root / relative
        if not path.is_file() or sha256(path) != patched_hash:
            fail(f"extension file does not match its reviewed hash: {relative}")

def parse_intel_hex(path: Path) -> tuple[dict[int, int], int]:
    memory: dict[int, int] = {}
    upper_address = 0
    record_count = 0
    saw_eof = False
    for line_number, raw_line in enumerate(path.read_text(encoding="ascii").splitlines(), 1):
        line = raw_line.strip()
        if not line.startswith(":"):
            fail(f"{path}:{line_number}: invalid Intel HEX record")
        try:
            record = bytes.fromhex(line[1:])
        except ValueError as error:
            fail(f"{path}:{line_number}: non-hexadecimal record: {error}")
        if len(record) < 5 or record[0] + 5 != len(record):
            fail(f"{path}:{line_number}: invalid byte count")
        if sum(record) & 0xFF:
            fail(f"{path}:{line_number}: checksum mismatch")
        count = record[0]
        address = (record[1] << 8) | record[2]
        record_type = record[3]
        data = record[4 : 4 + count]
        record_count += 1
        if record_type == 0x00:
            absolute = upper_address + address
            for offset, value in enumerate(data):
                location = absolute + offset
                if location in memory and memory[location] != value:
                    fail(f"{path}:{line_number}: conflicting data at 0x{location:08X}")
                memory[location] = value
        elif record_type == 0x01:
            if count != 0:
                fail(f"{path}:{line_number}: malformed EOF record")
            saw_eof = True
        elif record_type == 0x02:
            if count != 2:
                fail(f"{path}:{line_number}: malformed segment-address record")
            upper_address = int.from_bytes(data, "big") << 4
        elif record_type == 0x04:
            if count != 2:
                fail(f"{path}:{line_number}: malformed linear-address record")
            upper_address = int.from_bytes(data, "big") << 16
        elif record_type not in (0x03, 0x05):
            fail(f"{path}:{line_number}: unsupported record type {record_type}")
    if not saw_eof:
        fail(f"{path}: missing EOF record")
    return memory, record_count


def contains_contiguous(memory: dict[int, int], expected: bytes) -> bool:
    first = expected[0]
    for address, value in memory.items():
        if value == first and all(
            memory.get(address + offset) == byte
            for offset, byte in enumerate(expected)
        ):
            return True
    return False


def verify_source(root: Path) -> None:
    verify_heading_math()
    verify_upstream_baseline(root)
    require_text(
        root / "CMakeLists.txt",
        [r"set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 3\.0\.7\)", r"FLIGHT_COMMANDER_SOURCE_REVISION"],
    )
    require_text(
        root / "src/main/build/flight_commander.h",
        [
            r"FLIGHT_COMMANDER_VERSION_MAJOR 3",
            r"FLIGHT_COMMANDER_VERSION_MINOR 0",
            r"FLIGHT_COMMANDER_VERSION_PATCH 7",
            r"FLIGHT_COMMANDER_CAPABILITIES \(\(uint32_t\)0x1FFFU\)",
        ],
    )
    require_text(
        root / "cmake/flight-commander-micoair743.cmake",
        [
            r"target_sources\(MICOAIR743\.elf",
            r"flight_commander/external_compass\.c",
            r"USE_AUTOTUNE_MULTIROTOR",
            r"USE_FLIGHT_COMMANDER_HEADING_FUSION",
            r"USE_FLIGHT_COMMANDER_MOVING_BASELINE",
        ],
    )
    reject_text(
        root / "src/main/sensors/gyro.c",
        [r"flightCommanderHeading"],
    )
    require_text(
        root / "src/main/flight/imu.c",
        [
            r"flightCommanderHeadingSetMagneticNorth\(&vCorrectedMagNorth\)",
            r"imuCalculateFlightCommanderMagError",
            r"imuCalculateFlightCommanderAbsoluteError",
            r"forwardBody = \{ \.v = \{ 1\.0F, 0\.0F, 0\.0F \} \}",
            r"Vehicle heading is always body X/front",
            r"flightCommanderHeadingGetOnboardMagWeight",
            r"Source quality already contains INAV's field-magnitude nearness",
            r"flightCommanderHeadingGetAbsoluteReference",
        ],
    )
    reject_text(
        root / "src/main/flight/imu.c",
        [r"imuCalculateFlightCommanderAbsoluteError[\s\S]{0,900}forwardBody\.z = 1\.0F"],
    )
    require_text(
        root / "src/main/flight_commander/external_compass.c",
        [
            r"BUSDEV_REGISTER_I2C_TAG\(fc_ext_hmc5883, DEVHW_HMC5883, BUS_I2C1",
            r"flightCommanderExternalCompassUpdate",
            r"externalMag\.magSensorToUse = FLIGHT_COMMANDER_EXTERNAL_MAG_TAG",
        ],
    )
    require_text(
        root / "src/main/flight_commander/heading_fusion.c",
        [
            r"updateExternalCompassSample",
            r"flightCommanderHeadingCalibrationUpdate",
            r"FLIGHT_COMMANDER_MAG_CALIBRATION_MIN_SAMPLES 48U",
            r"zero\[axis\] = \(context->maximum\.v\[axis\] \+ context->minimum\.v\[axis\]\) \* 0\.5F",
            r"The official INAV compass task owns the onboard calibration result",
            r"The onboard sensor remains entirely on INAV's normal calibration",
            r"config->sources\[2\] = \(flightCommanderHeadingSourceConfig_t\)\{ false, 3, 50, 0 \}",
            r"config->sources\[3\] = \(flightCommanderHeadingSourceConfig_t\)\{ false, 4, 25, 0 \}",
            r"magneticFieldQuality",
            r"FLIGHT_COMMANDER_MAG_MIN_FIELD_QUALITY 25U",
            r"magneticFieldToTrueHeading",
            r"fieldEarth\.x \* correctedMagneticNorthEarth\.y",
            r"DECIDEGREES_TO_CENTIDEGREES\(attitude\.values\.yaw\)",
            r"attitude\.values\.yaw\) -\s*estimatedMinusMeasuredCentidegrees",
            r"headingEarth->x = cos_approx\(headingRadians\)",
            r"headingEarth->y = -sin_approx\(headingRadians\)",
            r"flightCommanderHeadingGetMagSource",
            r"flightCommanderHeadingReceiveDronecanHeading",
            r"flightCommanderHeadingReceiveDronecanRelPosHeading",
            r"flightCommanderHeadingReceiveUartRelPosHeading",
        ],
    )
    reject_text(
        root / "src/main/flight_commander/heading_fusion.c",
        [
            r"flightCommanderHeadingApplyGyroCorrection",
            r"sensorCalibrationSolveForOffset",
            r"onboardCalibrationCandidateZero",
            r"onboardCalibrationCandidateGain",
            r"onboardCalibrationCoverageValid",
            r"onboardCalibrationCommitPending",
            r"commitOnboardCalibrationResult",
            r"onboardCalibrationPreviousZero",
            r"compassConfig\(\)->mag_declination",
        ],
    )
    require_text(
        root / "src/main/io/gps_ublox.c",
        [r"MSG_RELPOSNED", r"UBLOX_CFG_MSGOUT_NAV_RELPOSNED_UART1"],
    )
    require_text(
        root / "src/main/common/maths.c",
        [r"if \(!isfinite\(result\[i\]\)\)"],
    )
    require_text(
        root / "src/main/drivers/compass/compass_ist8310.c",
        [
            r"IST8310_STATUS1_DRDY",
            r"IST8310_ODR_SINGLE",
            r"mag->magADCRaw\[X\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS",
            r"mag->magADCRaw\[Y\] = -nativeX \* IST8310_LSB_TO_MILLIGAUSS",
            r"mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS",
        ],
    )
    require_text(
        root / "src/main/sensors/compass.c",
        [
            r"sensorCalibrationSolveForOffset\(&calState, candidateZeroFloat\)",
            r"candidateGain",
            r"const int32_t gain = config->magGain\[axis\]",
        ],
    )
    require_text(
        root / "src/main/target/MICOAIR743/target.h",
        [
            r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
            r"FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",
        ],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--hex", required=True, type=Path, dest="hex_path")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    root = args.source_root.resolve()
    hex_path = args.hex_path.resolve()
    verify_source(root)
    digest = sha256(hex_path)
    memory, record_count = parse_intel_hex(hex_path)
    if not contains_contiguous(memory, EXPECTED_IDENTITY):
        fail("HEX does not contain the exact FCFW 3.0.7 / INAV 9.1.0 / 0x1FFF identity payload")
    if not contains_contiguous(memory, TARGET.encode("ascii")):
        fail(f"HEX does not contain the {TARGET} target identity")

    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        expected = {
            "schema": 1,
            "product": "Flight Commander Firmware",
            "version": VERSION,
            "target": TARGET,
            "inav_release": UPSTREAM_RELEASE,
            "inav_commit": UPSTREAM_COMMIT,
        }
        for key, value in expected.items():
            if manifest.get(key) != value:
                fail(f"manifest {key!r} is {manifest.get(key)!r}, expected {value!r}")
        artifact = manifest.get("artifact", {})
        if artifact.get("filename") != hex_path.name:
            fail("manifest artifact filename does not match the HEX")
        if artifact.get("sha256") != digest:
            fail("manifest SHA-256 does not match the HEX")
        if artifact.get("bytes") != hex_path.stat().st_size:
            fail("manifest byte count does not match the HEX")

    print(
        f"Verified {hex_path.name}: {hex_path.stat().st_size} bytes, "
        f"{record_count} Intel HEX records, SHA-256 {digest}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"verification failed: {error}", file=sys.stderr)
        sys.exit(1)
