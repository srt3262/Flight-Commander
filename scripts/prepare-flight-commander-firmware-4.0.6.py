#!/usr/bin/env python3
"""Prepare a draft Flight Commander 4.0.6 firmware source tree.

The input is the exact retained 4.0.5 firmware source ZIP. The generated source
removes the MICOAIR743 board-specific IST8310 signed permutation, installs the
learned compass-to-IMU solver, gates magnetic heading authority until a mapping
is verified, and appends orientation diagnostics to the existing heading-status
payload.

This script creates draft build inputs only. It does not publish a release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.0.6"
SOURCE_DATE_EPOCH = 1786021200
CONTRACT_REVISION = 1


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def insert_once(path: Path, anchor: str, insertion: str, label: str, *, before: bool = True) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(anchor)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    replacement = insertion + anchor if before else anchor + insertion
    path.write_text(text.replace(anchor, replacement, 1), encoding="utf-8", newline="\n")


def function_span(text: str, name: str) -> tuple[int, int]:
    match = re.search(rf"\b{name}\s*\([^;]*?\)\s*\{{", text, re.S)
    if not match:
        raise RuntimeError(f"Unable to locate function {name}")
    opening = text.find("{", match.start())
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(opening, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return match.start(), index + 1
    raise RuntimeError(f"Unterminated function {name}")


def prepend_function_body(path: Path, name: str, code: str) -> None:
    text = path.read_text(encoding="utf-8")
    start, end = function_span(text, name)
    body = text[start:end]
    opening = body.find("{") + 1
    body = body[:opening] + "\n" + code.rstrip() + "\n" + body[opening:]
    path.write_text(text[:start] + body + text[end:], encoding="utf-8", newline="\n")


def extract_archive(archive: Path, output: Path) -> Path:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source:
        if source.testzip() is not None:
            raise RuntimeError(f"Corrupt source archive: {archive}")
        source.extractall(output)
    roots = [path for path in output.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one source root, found {len(roots)}")
    destination = output / f"Flight-Commander-Firmware-Source-v{VERSION}"
    roots[0].rename(destination)
    return destination


def copy_solver(root: Path) -> None:
    destination = root / "src/main/flight"
    destination.mkdir(parents=True, exist_ok=True)
    for name in (
        "flight_commander_compass_orientation.c",
        "flight_commander_compass_orientation.h",
    ):
        shutil.copy2(ROOT / "firmware/auto-compass" / name, destination / name)


def patch_target_contract(root: Path) -> None:
    path = root / "src/main/target/MICOAIR743/target.h"
    text = path.read_text(encoding="utf-8")
    marker = "#define FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310\n"
    if marker not in text:
        raise RuntimeError("MICOAIR743 onboard IST8310 marker is missing")
    addition = (
        marker
        + "#define FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION\n"
        + f"#define FLIGHT_COMMANDER_MAG_AUTO_ORIENTATION_REVISION {CONTRACT_REVISION}U\n"
    )
    text = text.replace(marker, addition, 1)
    text = re.sub(
        r"#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION\s+\d+U",
        "#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 3U",
        text,
        count=1,
    )
    path.write_text(text, encoding="utf-8", newline="\n")


def patch_ist8310_driver(root: Path) -> None:
    path = root / "src/main/drivers/compass/compass_ist8310.c"
    text = path.read_text(encoding="utf-8")
    guarded = re.search(
        r"(#if defined\(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310\).*?#endif)",
        text,
        re.S,
    )
    if not guarded:
        raise RuntimeError("MICOAIR743 IST8310 conversion block is missing")
    block = guarded.group(1)
    expected = (
        "mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;",
    )
    if not all(token in block for token in expected):
        raise RuntimeError("Retained onboard IST8310 signed permutation changed unexpectedly")
    block = block.replace(
        expected[0],
        "mag->magADCRaw[X] =  nativeX * IST8310_LSB_TO_MILLIGAUSS;",
    ).replace(
        expected[1],
        "mag->magADCRaw[Y] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
    )
    # Z already matches the canonical sensor conversion.
    text = text[:guarded.start()] + block + text[guarded.end():]
    path.write_text(text, encoding="utf-8", newline="\n")


def patch_compass_config(root: Path) -> tuple[str, str, str, str]:
    header = root / "src/main/sensors/compass.h"
    text = header.read_text(encoding="utf-8")
    if "magAutoOrientationCandidate" not in text:
        anchor_match = re.search(
            r"^(\s*)(?:uint16_t|uint8_t)\s+magCalibrationRevision\s*;",
            text,
            re.M,
        )
        if not anchor_match:
            raise RuntimeError("Compass calibration revision field is missing")
        indent = anchor_match.group(1)
        fields = (
            f"{indent}uint8_t magAutoOrientationCandidate;\n"
            f"{indent}uint8_t magAutoOrientationValid;\n"
            f"{indent}uint8_t magAutoOrientationRevision;\n"
            f"{indent}uint8_t magAutoOrientationReserved;\n"
        )
        text = text[:anchor_match.start()] + fields + text[anchor_match.start():]
        header.write_text(text, encoding="utf-8", newline="\n")

    compass = root / "src/main/sensors/compass.c"
    text = compass.read_text(encoding="utf-8")
    text, count = re.subn(
        r"PG_REGISTER_WITH_RESET_TEMPLATE\(compassConfig_t, compassConfig, PG_COMPASS_CONFIG,\s*8\);",
        "PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 9);",
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Expected the retained compass parameter group version 8")

    reset_anchor = ".mag_align = COMPASS_RESET_ALIGN,\n"
    if reset_anchor not in text:
        raise RuntimeError("Compass reset alignment anchor is missing")
    reset_fields = (
        reset_anchor
        + "    .magAutoOrientationCandidate = FC_COMPASS_ORIENTATION_NONE,\n"
        + "    .magAutoOrientationValid = 0,\n"
        + f"    .magAutoOrientationRevision = {CONTRACT_REVISION},\n"
        + "    .magAutoOrientationReserved = 0,\n"
    )
    text = text.replace(reset_anchor, reset_fields, 1)
    compass.write_text(text, encoding="utf-8", newline="\n")

    combined = (root / "src/main/sensors/acceleration.c").read_text(encoding="utf-8")
    combined += (root / "src/main/sensors/acceleration.h").read_text(encoding="utf-8")
    zero = "accZero.raw[axis]" if "accZero.raw[axis]" in combined else "accZero[axis]"
    gain = "accGain.raw[axis]" if "accGain.raw[axis]" in combined else "accGain[axis]"

    compass_text = compass.read_text(encoding="utf-8")
    mag_zero = "magZero.raw[axis]" if "magZero.raw[axis]" in compass_text else "magZero[axis]"
    mag_gain = "magGain.raw[axis]" if "magGain.raw[axis]" in compass_text else "magGain[axis]"
    return zero, gain, mag_zero, mag_gain


def detect_gyro_ready(root: Path) -> str:
    corpus = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (
            root / "src/main/sensors/gyro.h",
            root / "src/main/sensors/gyro.c",
        )
    )
    for name in (
        "gyroIsCalibrationComplete",
        "isGyroCalibrationComplete",
        "gyroCalibrationComplete",
    ):
        if re.search(rf"\b{name}\s*\(", corpus):
            return f"{name}()"
    raise RuntimeError("No supported gyro calibration-complete function was found")


def patch_compass_runtime(
    root: Path,
    acc_zero: str,
    acc_gain: str,
    mag_zero: str,
    mag_gain: str,
) -> None:
    path = root / "src/main/sensors/compass.c"
    text = path.read_text(encoding="utf-8")

    include_anchor = '#include "sensors/compass.h"\n'
    includes = include_anchor + """
#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
#include "drivers/time.h"
#include "flight/flight_commander_compass_orientation.h"
#include "flight/imu.h"
#include "sensors/acceleration.h"
#include "sensors/gyro.h"
#endif
"""
    if "flight_commander_compass_orientation.h" not in text:
        if include_anchor not in text:
            raise RuntimeError("compass.c include anchor is missing")
        text = text.replace(include_anchor, includes, 1)

    start_index, _ = function_span(text, "compassStartCalibration")
    helper = f"""
#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
static bool fcCompassOrientationInitialized;
static uint32_t fcCompassOrientationStartedAtMs;

static bool fcCompassAccelerometerCalibrated(void)
{{
    const accelerometerConfig_t *config = accelerometerConfig();
    bool changedFromReset = false;
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {{
        if (config->{acc_zero} != 0 || config->{acc_gain} != 4096) {{
            changedFromReset = true;
        }}
    }}
    return changedFromReset;
}}

static void fcCompassOrientationEnsureInitialized(void)
{{
    if (fcCompassOrientationInitialized) {{
        return;
    }}
    const compassConfig_t *config = compassConfig();
    const bool valid =
        config->magAutoOrientationValid != 0
        && config->magAutoOrientationRevision == FLIGHT_COMMANDER_MAG_AUTO_ORIENTATION_REVISION
        && config->magAutoOrientationCandidate < FC_COMPASS_ORIENTATION_CANDIDATE_COUNT;
    fcCompassOrientationInit(config->magAutoOrientationCandidate, valid);
    fcCompassOrientationInitialized = true;
}}

static void fcCompassOrientationCommitSolution(const fcCompassOrientationSolution_t *solution)
{{
    if (!solution || !solution->accepted) {{
        return;
    }}
    compassConfig_t *config = compassConfigMutable();
    config->magAutoOrientationCandidate = solution->candidateIndex;
    config->magAutoOrientationValid = 1;
    config->magAutoOrientationRevision = FLIGHT_COMMANDER_MAG_AUTO_ORIENTATION_REVISION;
    config->magAutoOrientationReserved = 0;

    // Orientation is learned first. Reset the previous body-frame magnetic
    // correction so the next normal compass pass refines gains in the newly
    // verified coordinate frame.
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {{
        config->{mag_zero} = 0;
        config->{mag_gain} = 1024;
    }}
    config->magCalibrationRevision = 0;
    config->magCalibrationSignature = 0;
    fcCompassOrientationCommit(solution->candidateIndex);
}}

static void fcCompassOrientationUpdateFromCanonicalSample(const uint32_t nowMs)
{{
    fcCompassOrientationEnsureInitialized();
    if (fcCompassOrientationActive()) {{
        const float canonical[3] = {{
            mag.magADC[X],
            mag.magADC[Y],
            mag.magADC[Z],
        }};
        fcCompassOrientationAddSample(
            canonical,
            attitude.values.roll,
            attitude.values.pitch,
            attitude.values.yaw,
            nowMs
        );
        if (nowMs - fcCompassOrientationStartedAtMs >= 30000U) {{
            fcCompassOrientationSolution_t solution;
            if (fcCompassOrientationFinish(&solution)) {{
                fcCompassOrientationCommitSolution(&solution);
            }}
        }}
    }}

    if (fcCompassOrientationValid()) {{
        float body[3] = {{ mag.magADC[X], mag.magADC[Y], mag.magADC[Z] }};
        fcCompassOrientationApply(fcCompassOrientationCandidate(), body);
        mag.magADC[X] = body[X];
        mag.magADC[Y] = body[Y];
        mag.magADC[Z] = body[Z];
    }}
}}
#endif

"""
    if "fcCompassOrientationEnsureInitialized" not in text:
        text = text[:start_index] + helper + text[start_index:]

    path.write_text(text, encoding="utf-8", newline="\n")

    gyro_ready = detect_gyro_ready(root)
    prepend_function_body(
        path,
        "compassStartCalibration",
        f"""#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
    fcCompassOrientationEnsureInitialized();
    if (!fcCompassOrientationValid()) {{
        const uint32_t nowMs = millis();
        if (fcCompassOrientationStart(
            fcCompassAccelerometerCalibrated(),
            {gyro_ready},
            nowMs
        )) {{
            fcCompassOrientationStartedAtMs = nowMs;
        }}
        return;
    }}
#endif""",
    )

    text = path.read_text(encoding="utf-8")
    raw_anchor = "mag.magADC[axis] = mag.dev.magADCRaw[axis];"
    raw_index = text.find(raw_anchor)
    if raw_index < 0:
        raise RuntimeError("Raw compass copy anchor is missing")
    alignment_index = text.find(
        "applySensorAlignment(mag.magADC, mag.magADC, mag.dev.magAlign.onBoard);",
        raw_index,
    )
    if alignment_index < 0:
        raise RuntimeError("User compass alignment anchor is missing")
    if "fcCompassOrientationUpdateFromCanonicalSample" not in text[raw_index:alignment_index]:
        insertion = """
#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
    fcCompassOrientationUpdateFromCanonicalSample(millis());
#endif

    """
        text = text[:alignment_index] + insertion + text[alignment_index:]
        path.write_text(text, encoding="utf-8", newline="\n")

    text = path.read_text(encoding="utf-8")
    if "bool compassIsHealthy" in text:
        start, end = function_span(text, "compassIsHealthy")
        body = text[start:end]
        opening = body.find("{") + 1
        gate = """
#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
    fcCompassOrientationEnsureInitialized();
    if (!fcCompassOrientationValid()) {
        return false;
    }
#endif
"""
        if "fcCompassOrientationValid" not in body:
            body = body[:opening] + gate + body[opening:]
            text = text[:start] + body + text[end:]
            path.write_text(text, encoding="utf-8", newline="\n")


def patch_imu_mag_suppression(root: Path) -> None:
    path = root / "src/main/flight/imu.c"
    text = path.read_text(encoding="utf-8")
    include_anchor = '#include "flight/imu.h"\n'
    if "flight_commander_compass_orientation.h" not in text:
        if include_anchor not in text:
            raise RuntimeError("imu.c include anchor is missing")
        text = text.replace(
            include_anchor,
            include_anchor
            + '#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION\n'
            + '#include "flight/flight_commander_compass_orientation.h"\n'
            + '#endif\n',
            1,
        )

    pattern = re.compile(
        r"((?:const\s+)?bool\s+useMag\s*=\s*)([^;]*(?:SENSOR_MAG|compass)[^;]*)(;)",
        re.I,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError("Unable to find IMU magnetic-correction enable expression")
    expression = match.group(2)
    if "fcCompassOrientationActive" not in expression:
        replacement = (
            match.group(1)
            + "(" + expression.strip() + ")"
            + "\n#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION\n"
            + "        && !fcCompassOrientationActive()\n"
            + "#endif\n"
            + match.group(3)
        )
        text = text[:match.start()] + replacement + text[match.end():]
    path.write_text(text, encoding="utf-8", newline="\n")


def find_heading_status_source(root: Path) -> Path:
    matches = []
    for path in (root / "src/main").rglob("*.c"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "MSP2_FLIGHT_COMMANDER_HEADING_STATUS" in text and "sbufWriteU8" in text:
            matches.append(path)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one heading-status MSP source, found {matches}")
    return matches[0]


def patch_heading_status(root: Path) -> None:
    path = find_heading_status_source(root)
    text = path.read_text(encoding="utf-8")
    include_match = re.search(r"^#include .+compass.+$", text, re.M)
    if "flight_commander_compass_orientation.h" not in text:
        if not include_match:
            first_include = re.search(r"^#include .+$", text, re.M)
            if not first_include:
                raise RuntimeError("Heading MSP source has no include anchor")
            position = first_include.end()
        else:
            position = include_match.end()
        include = (
            "\n#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION\n"
            '#include "flight/flight_commander_compass_orientation.h"\n'
            "#endif"
        )
        text = text[:position] + include + text[position:]

    case = re.search(
        r"case\s+MSP2_FLIGHT_COMMANDER_HEADING_STATUS\s*:(.*?)(?=\n\s*case\s+|\n\s*default\s*:|\n\s*}\s*$)",
        text,
        re.S | re.M,
    )
    if not case:
        raise RuntimeError("Heading status MSP case is missing")
    block = case.group(1)
    if "FC_COMPASS_ORIENTATION_STATUS_TAIL_BYTES" not in block:
        destination_match = re.search(r"sbufWriteU8\s*\(\s*(\w+)\s*,", block)
        if not destination_match:
            raise RuntimeError("Unable to infer heading-status output buffer")
        destination = destination_match.group(1)
        break_index = block.rfind("break;")
        if break_index < 0:
            raise RuntimeError("Heading status MSP case has no break")
        tail = f"""
#ifdef FLIGHT_COMMANDER_AUTO_COMPASS_ORIENTATION
        const fcCompassOrientationStatus_t *orientation = fcCompassOrientationStatus();
        sbufWriteU8({destination}, orientation->state);
        sbufWriteU8({destination}, orientation->candidateIndex);
        sbufWriteU8({destination}, orientation->failure);
        sbufWriteU8({destination}, orientation->confidence);
        sbufWriteU8({destination}, orientation->facesMask);
        sbufWriteU16({destination}, orientation->samples);
        sbufWriteU16({destination}, orientation->residualCentidegrees);
        sbufWriteU16({destination}, orientation->marginCentidegrees);
#endif
        """
        block = block[:break_index] + tail + block[break_index:]
        text = text[:case.start(1)] + block + text[case.end(1):]
    path.write_text(text, encoding="utf-8", newline="\n")


def patch_version(root: Path) -> None:
    header = root / "src/main/build/flight_commander.h"
    text = header.read_text(encoding="utf-8")
    text, count = re.subn(
        r"#define FLIGHT_COMMANDER_VERSION_PATCH\s+5\b",
        "#define FLIGHT_COMMANDER_VERSION_PATCH 6",
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Firmware patch version 5 anchor is missing")
    header.write_text(text, encoding="utf-8", newline="\n")

    cmake = root / "CMakeLists.txt"
    replace_once(
        cmake,
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.5)",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.6)",
        "CMake firmware version",
    )

    build = root / "flight-commander/build-micoair743.sh"
    replace_once(
        build,
        "Flight-Commander-Firmware-4.0.5-MICOAIR743.hex",
        "Flight-Commander-Firmware-4.0.6-MICOAIR743.hex",
        "firmware output name",
    )

    for relative in (
        "flight-commander/verify-release.py",
        "flight-commander/verify-compass-release.py",
    ):
        path = root / relative
        if not path.exists():
            continue
        value = path.read_text(encoding="utf-8")
        value = value.replace("4.0.5", "4.0.6")
        value = value.replace(r"4\.0\.5", r"4\.0\.6")
        value = value.replace("FLIGHT_COMMANDER_VERSION_PATCH 5", "FLIGHT_COMMANDER_VERSION_PATCH 6")
        value = value.replace("PG_COMPASS_CONFIG, 8", "PG_COMPASS_CONFIG, 9")
        path.write_text(value, encoding="utf-8", newline="\n")


def verify_contract(root: Path) -> None:
    required = {
        "src/main/drivers/compass/compass_ist8310.c": (
            "mag->magADCRaw[X] =  nativeX * IST8310_LSB_TO_MILLIGAUSS;",
            "mag->magADCRaw[Y] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
        ),
        "src/main/flight/flight_commander_compass_orientation.c": (
            "FC_COMPASS_ORIENTATION_CANDIDATE_COUNT",
            "candidateResidual",
            "FC_COMPASS_ORIENTATION_MIN_MARGIN_DEGREES",
        ),
        "src/main/sensors/compass.c": (
            "PG_COMPASS_CONFIG, 9",
            "fcCompassOrientationUpdateFromCanonicalSample",
            "fcCompassOrientationCommitSolution",
        ),
        "src/main/sensors/compass.h": (
            "magAutoOrientationCandidate",
            "magAutoOrientationValid",
            "magAutoOrientationRevision",
        ),
        "src/main/flight/imu.c": (
            "!fcCompassOrientationActive()",
        ),
    }
    for relative, tokens in required.items():
        text = (root / relative).read_text(encoding="utf-8")
        for token in tokens:
            if token not in text:
                raise RuntimeError(f"{relative}: missing contract token {token}")

    driver = (root / "src/main/drivers/compass/compass_ist8310.c").read_text(encoding="utf-8")
    onboard = re.search(
        r"#if defined\(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310\)(.*?)#endif",
        driver,
        re.S,
    )
    if not onboard:
        raise RuntimeError("Onboard IST8310 block is missing after preparation")
    for forbidden in ("-nativeX", "-nativeY * IST8310_LSB_TO_MILLIGAUSS;\n        mag->magADCRaw[Y] = -nativeX"):
        if forbidden in onboard.group(1):
            raise RuntimeError(f"Legacy board transform remains: {forbidden}")


def source_records(root: Path) -> list[str]:
    records = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        records.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}\n")
    return records


def update_manifest(root: Path, firmware: Path | None = None) -> None:
    path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest["source_date_epoch"] = SOURCE_DATE_EPOCH
    manifest["artifact"] = {
        "filename": f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex",
        "sha256": sha256(firmware) if firmware else "0" * 64,
        "bytes": firmware.stat().st_size if firmware else 0,
    }
    manifest["compass_coordinate_contract"] = {
        "driver_frame": "IST8310 documented right-handed canonical frame",
        "board_transform": "learned from synchronized accelerometer/gyro attitude and magnetic vectors",
        "candidate_set": "24 proper signed-permutation rotations",
        "legacy_micoair743_signed_permutation_removed": True,
        "user_alignment_applied_after_learned_transform": True,
    }
    manifest["auto_compass_orientation"] = {
        "contract_revision": CONTRACT_REVISION,
        "minimum_samples": 160,
        "minimum_faces": 5,
        "minimum_cumulative_rotation_degrees": 540,
        "maximum_field_spread": 0.25,
        "maximum_residual_degrees": 12,
        "minimum_second_best_margin_degrees": 5,
        "magnetic_ahrs_correction_suppressed_while_learning": True,
        "rejected_result_preserves_previous_verified_mapping": True,
        "unverified_compass_blocked_from_heading_authority": True,
        "workflow": "first pass learns orientation; second normal pass refines magnetic gains",
    }
    canonical = "".join(source_records(root)).encode()
    manifest["source_revision"] = hashlib.sha1(canonical).hexdigest()
    manifest["source_tree"] = hashlib.sha1(
        b"flight-commander-source-tree-v1\n" + canonical
    ).hexdigest()
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")


def create_source_zip(root: Path, destination: Path) -> None:
    manifest = json.loads((root / "RELEASE-MANIFEST.json").read_text(encoding="utf-8"))
    stamp = time.gmtime(manifest["source_date_epoch"])[:6]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = Path(root.name) / path.relative_to(root)
            info = zipfile.ZipInfo(relative.as_posix(), stamp)
            info.create_system = 3
            mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def prepare(archive: Path, output: Path) -> Path:
    root = extract_archive(archive, output)
    copy_solver(root)
    patch_target_contract(root)
    patch_ist8310_driver(root)
    acc_zero, acc_gain, mag_zero, mag_gain = patch_compass_config(root)
    patch_compass_runtime(root, acc_zero, acc_gain, mag_zero, mag_gain)
    patch_imu_mag_suppression(root)
    patch_heading_status(root)
    patch_version(root)
    verify_contract(root)
    update_manifest(root)
    return root


def finalize(root: Path, firmware: Path, source_zip: Path) -> None:
    update_manifest(root, firmware)
    verify_contract(root)
    create_source_zip(root, source_zip)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--finalize-root", type=Path)
    parser.add_argument("--firmware", type=Path)
    parser.add_argument("--source-zip", type=Path)
    args = parser.parse_args()

    if args.archive or args.output:
        if not args.archive or not args.output:
            parser.error("prepare mode requires --archive and --output")
        print(prepare(args.archive, args.output))
        return
    if args.finalize_root or args.firmware or args.source_zip:
        if not args.finalize_root or not args.firmware or not args.source_zip:
            parser.error("finalize mode requires --finalize-root, --firmware and --source-zip")
        finalize(args.finalize_root, args.firmware, args.source_zip)
        print(args.source_zip)
        return
    parser.error("select prepare or finalize mode")


if __name__ == "__main__":
    main()
