#!/usr/bin/env python3
"""Prepare the Flight Commander Firmware 4.0.2 compass-persistence candidate.

4.0.2 fixes the MICOAIR743 onboard IST8310 contract at the target layer,
rather than relying on a mutable ALIGN_DEFAULT value that generic INAV startup
later rewrites to CW270_DEG_FLIP. It also binds saved calibration values to a
hidden transform revision and signature so incompatible EEPROM or CLI-restored
calibration cannot silently survive a transform change.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import time
import zipfile
from pathlib import Path

VERSION = "4.0.2"
SOURCE_DATE_EPOCH = 1785956400


def replace_once(path: Path, old: str, new: str, label: str | None = None) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        description = label or str(path)
        raise RuntimeError(
            f"{description}: expected one replacement target, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        records.append(
            f"{sha256(path)}  {path.relative_to(root).as_posix()}\n"
        )
    return records


def source_identities(root: Path) -> tuple[str, str]:
    records = source_records(root)
    canonical = "".join(records).encode()
    revision = hashlib.sha1(canonical).hexdigest()
    tree = hashlib.sha1(
        b"flight-commander-source-tree-v1\n" + canonical
    ).hexdigest()
    return revision, tree


def extract_archive(archive: Path, output: Path) -> Path:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source:
        source.extractall(output)
    roots = [path for path in output.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise RuntimeError(
            f"Expected one source root in {archive}; found {len(roots)}"
        )
    original = roots[0]
    root = output / f"Flight-Commander-Firmware-Source-v{VERSION}"
    original.rename(root)
    return root


def patch_target_contract(root: Path) -> None:
    target_header = root / "src/main/target/MICOAIR743/target.h"
    replace_once(
        target_header,
        """#define FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310
#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG
""",
        """#define FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310
#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG
#define FLIGHT_COMMANDER_MAG_FIXED_ALIGN CW0_DEG
#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 1U
""",
        "MICOAIR743 fixed compass contract",
    )

    target_config = root / "src/main/target/MICOAIR743/config.c"
    replace_once(
        target_config,
        """#include "fc/config.h"
#include "sensors/gyro.h"


void targetConfiguration(void)
""",
        """#include "fc/config.h"
#include "sensors/compass.h"
#include "sensors/gyro.h"


void validateAndFixTargetConfig(void)
{
#ifdef FLIGHT_COMMANDER_MAG_FIXED_ALIGN
    // The onboard IST8310 orientation is a physical board property, not a
    // user preference. Apply it before generic config validation can rewrite
    // ALIGN_DEFAULT to the external-compass CW270_DEG_FLIP fallback.
    compassConfigMutable()->mag_align = FLIGHT_COMMANDER_MAG_FIXED_ALIGN;
    compassConfigMutable()->rollDeciDegrees = 0;
    compassConfigMutable()->pitchDeciDegrees = 0;
    compassConfigMutable()->yawDeciDegrees = 0;
#endif
}


void targetConfiguration(void)
""",
        "MICOAIR743 target validator",
    )


def patch_calibration_identity(root: Path) -> None:
    header = root / "src/main/sensors/compass.h"
    replace_once(
        header,
        """    int16_t yawDeciDegrees;                 // Alignment for external mag on the yaw (Z) axis (0.1deg)
} compassConfig_t;
""",
        """    int16_t yawDeciDegrees;                 // Alignment for external mag on the yaw (Z) axis (0.1deg)
    uint32_t magCalibrationRevision;         // Hidden transform/calibration schema identity.
    uint32_t magCalibrationSignature;        // Hidden signature of the saved calibration contract.
} compassConfig_t;
""",
        "compass calibration identity fields",
    )

    source = root / "src/main/sensors/compass.c"
    replace_once(
        source,
        "PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 6);",
        "PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 7);",
        "compass parameter-group version",
    )

    replace_once(
        source,
        """#define COMPASS_CALIBRATION_MAX_GAIN_RATIO 2.5F
#define COMPASS_CALIBRATION_MAX_ZERO_RATIO 4.0F

static bool compassCalibrationValuesValid(const compassConfig_t *config)
{
""",
        """#define COMPASS_CALIBRATION_MAX_GAIN_RATIO 2.5F
#define COMPASS_CALIBRATION_MAX_ZERO_RATIO 4.0F
#define COMPASS_CALIBRATION_SIGNATURE_OFFSET 2166136261U
#define COMPASS_CALIBRATION_SIGNATURE_PRIME 16777619U
#define COMPASS_CALIBRATION_SIGNATURE_MAGIC 0x46434D47U

#ifndef FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION
#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 0U
#endif

static uint32_t compassCalibrationSignatureMix(uint32_t signature, uint32_t value)
{
    for (unsigned index = 0; index < sizeof(value); index++) {
        signature ^= value & 0xFFU;
        signature *= COMPASS_CALIBRATION_SIGNATURE_PRIME;
        value >>= 8;
    }
    return signature;
}

static uint32_t compassCalibrationSignature(const compassConfig_t *config)
{
    uint32_t signature = COMPASS_CALIBRATION_SIGNATURE_OFFSET;
    signature = compassCalibrationSignatureMix(
        signature,
        COMPASS_CALIBRATION_SIGNATURE_MAGIC
    );
    signature = compassCalibrationSignatureMix(
        signature,
        config->magCalibrationRevision
    );
    signature = compassCalibrationSignatureMix(signature, config->mag_hardware);
#ifdef USE_DUAL_MAG
    signature = compassCalibrationSignatureMix(signature, config->mag_to_use);
#endif
    signature = compassCalibrationSignatureMix(signature, config->mag_align);
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->rollDeciDegrees
    );
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->pitchDeciDegrees
    );
    signature = compassCalibrationSignatureMix(
        signature,
        (uint32_t)(uint16_t)config->yawDeciDegrees
    );
    for (unsigned axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        signature = compassCalibrationSignatureMix(
            signature,
            (uint32_t)(uint16_t)config->magZero.raw[axis]
        );
        signature = compassCalibrationSignatureMix(
            signature,
            (uint32_t)(uint16_t)config->magGain[axis]
        );
    }
    return signature;
}

static bool compassCalibrationValuesValid(const compassConfig_t *config)
{
    if (config->magCalibrationRevision !=
            FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION ||
        config->magCalibrationSignature == 0 ||
        config->magCalibrationSignature != compassCalibrationSignature(config)) {
        return false;
    }

""",
        "compass calibration signature helpers",
    )

    replace_once(
        source,
        """            if (valid) {
                for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                    compassConfigMutable()->magZero.raw[axis] = candidateZero[axis];
                    compassConfigMutable()->magGain[axis] = candidateGain[axis];
                }
                saveConfigAndNotify();
                beeper(BEEPER_ACTION_SUCCESS);
""",
        """            if (valid) {
                compassConfig_t *config = compassConfigMutable();
                for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
                    config->magZero.raw[axis] = candidateZero[axis];
                    config->magGain[axis] = candidateGain[axis];
                }
                config->magCalibrationRevision =
                    FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION;
                config->magCalibrationSignature =
                    compassCalibrationSignature(config);
                saveConfigAndNotify();
                beeper(BEEPER_ACTION_SUCCESS);
""",
        "successful compass calibration commit",
    )


def patch_version_and_verifiers(root: Path) -> None:
    header = root / "src/main/build/flight_commander.h"
    replace_once(
        header,
        "#define FLIGHT_COMMANDER_VERSION_PATCH 1",
        "#define FLIGHT_COMMANDER_VERSION_PATCH 2",
        "firmware patch version",
    )

    cmake = root / "CMakeLists.txt"
    replace_once(
        cmake,
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.1)",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.2)",
        "CMake firmware version",
    )

    build = root / "flight-commander/build-micoair743.sh"
    replace_once(
        build,
        "Flight-Commander-Firmware-4.0.1-MICOAIR743.hex",
        "Flight-Commander-Firmware-4.0.2-MICOAIR743.hex",
        "firmware build output name",
    )

    verify = root / "flight-commander/verify-release.py"
    verify_text = verify.read_text(encoding="utf-8").replace("4.0.1", "4.0.2")
    verify_text = verify_text.replace(r"4\.0\.1", r"4\.0\.2")
    verify_text = verify_text.replace(
        "bytes((1, 4, 0, 1,",
        "bytes((1, 4, 0, 2,",
    )
    verify_text = verify_text.replace(
        "FLIGHT_COMMANDER_VERSION_PATCH 1",
        "FLIGHT_COMMANDER_VERSION_PATCH 2",
    )
    verify.write_text(verify_text, encoding="utf-8")

    replace_once(
        verify,
        """        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/sensors/compass.c",
        "src/main/target/MICOAIR743/target.h",
""",
        """        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/sensors/compass.c",
        "src/main/sensors/compass.h",
        "src/main/target/MICOAIR743/config.c",
        "src/main/target/MICOAIR743/target.h",
""",
        "reviewed source extension set",
    )

    replace_once(
        verify,
        """            r"sensorCalibrationSolveForOffset\\(&calState, candidateZeroFloat\\)",
            r"candidateGain",
            r"const int32_t gain = config->magGain\\[axis\\]",
""",
        """            r"sensorCalibrationSolveForOffset\\(&calState, candidateZeroFloat\\)",
            r"candidateGain",
            r"const int32_t gain = config->magGain\\[axis\\]",
            r"PG_COMPASS_CONFIG, 7",
            r"magCalibrationRevision",
            r"magCalibrationSignature",
            r"compassCalibrationSignature",
""",
        "compass persistence verifier",
    )

    replace_once(
        verify,
        """    require_text(
        root / "src/main/target/MICOAIR743/target.h",
        [
            r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
            r"FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",
        ],
    )
""",
        """    require_text(
        root / "src/main/target/MICOAIR743/target.h",
        [
            r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
            r"FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",
            r"FLIGHT_COMMANDER_MAG_FIXED_ALIGN CW0_DEG",
            r"FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 1U",
        ],
    )
    require_text(
        root / "src/main/target/MICOAIR743/config.c",
        [
            r"void validateAndFixTargetConfig\\(void\\)",
            r"mag_align = FLIGHT_COMMANDER_MAG_FIXED_ALIGN",
            r"rollDeciDegrees = 0",
            r"pitchDeciDegrees = 0",
            r"yawDeciDegrees = 0",
        ],
    )
""",
        "MICOAIR743 target compass verifier",
    )

    compass_verify = root / "flight-commander/verify-compass-release.py"
    compass_verify_text = compass_verify.read_text(
        encoding="utf-8"
    ).replace("4.0.1", "4.0.2")
    compass_verify_text = compass_verify_text.replace(
        "bytes((1, 4, 0, 1,",
        "bytes((1, 4, 0, 2,",
    )
    compass_verify.write_text(compass_verify_text, encoding="utf-8")


def update_reviewed_baseline(root: Path) -> None:
    baseline_path = root / "flight-commander/INAV-9.1.0-BASELINE.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    protected = baseline["protected_files"]
    extensions = baseline["intentional_extensions"]

    declarations = {
        "src/main/sensors/compass.c": (
            "Commit compass calibration only after the solver succeeds, guard "
            "calibrated correction against invalid gain divisors, and require "
            "a hidden transform revision plus signature before saved offsets "
            "and gains may be applied."
        ),
        "src/main/sensors/compass.h": (
            "Persist hidden compass transform revision and calibration "
            "signature metadata that CLI backups cannot recreate."
        ),
        "src/main/target/MICOAIR743/config.c": (
            "Force the physical onboard IST8310 CW0 alignment and zero custom "
            "rotation at every boot before the generic CW270 flip fallback."
        ),
        "src/main/target/MICOAIR743/target.h": (
            "Bind the onboard IST8310 to the bench-validated signed transform, "
            "fixed CW0 alignment, and calibration transform revision 1."
        ),
    }

    for relative, purpose in declarations.items():
        path = root / relative
        existing = extensions.get(relative, {})
        upstream = existing.get("upstream_sha256") or protected.get(relative)
        if not upstream:
            raise RuntimeError(
                f"Protected upstream hash unavailable for {relative}"
            )
        extensions[relative] = {
            "upstream_sha256": upstream,
            "patched_sha256": sha256(path),
            "purpose": purpose,
        }

    baseline_path.write_text(
        json.dumps(baseline, indent=2) + "\n",
        encoding="utf-8",
    )


def update_manifest(root: Path, firmware: Path | None = None) -> None:
    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest["source_date_epoch"] = SOURCE_DATE_EPOCH

    if firmware is None:
        artifact_hash = "0" * 64
        artifact_bytes = 0
    else:
        artifact_hash = sha256(firmware)
        artifact_bytes = firmware.stat().st_size

    manifest["artifact"] = {
        "filename": f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex",
        "sha256": artifact_hash,
        "bytes": artifact_bytes,
    }
    manifest["bench_acceptance"] = {
        "mapping": {
            "x": "-native_y",
            "y": "-native_x",
            "z": "native_z",
        },
        "user_alignment": "CW0_DEG",
        "physical_acceptance": "retained from the successful MICOAIR743 bench test",
        "root_cause": (
            "generic startup rewrote ALIGN_DEFAULT to CW270_DEG_FLIP after "
            "target validation"
        ),
        "permanent_fix": (
            "target validator forces CW0 and zero custom rotation on every boot"
        ),
    }
    manifest["calibration_persistence"] = {
        "parameter_group_version": 7,
        "transform_revision": 1,
        "signature": "FNV-1a over sensor, alignment, offsets, and gains",
        "old_backup_behavior": (
            "old or incompatible calibration remains uncalibrated until a new "
            "successful calibration stamps the hidden revision and signature"
        ),
    }

    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    revision, tree = source_identities(root)
    manifest["source_revision"] = revision
    manifest["source_tree"] = tree
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )


def verify_prepared_contract(root: Path) -> None:
    required = {
        "src/main/target/MICOAIR743/target.h": (
            "FLIGHT_COMMANDER_MAG_FIXED_ALIGN CW0_DEG",
            "FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 1U",
        ),
        "src/main/target/MICOAIR743/config.c": (
            "void validateAndFixTargetConfig(void)",
            "mag_align = FLIGHT_COMMANDER_MAG_FIXED_ALIGN",
        ),
        "src/main/sensors/compass.h": (
            "magCalibrationRevision",
            "magCalibrationSignature",
        ),
        "src/main/sensors/compass.c": (
            "PG_COMPASS_CONFIG, 7",
            "compassCalibrationSignature",
            "config->magCalibrationSignature =",
        ),
    }
    for relative, tokens in required.items():
        text = (root / relative).read_text(encoding="utf-8")
        for token in tokens:
            if token not in text:
                raise RuntimeError(f"{relative}: required contract missing: {token}")

    generic = (root / "src/main/fc/config.c").read_text(encoding="utf-8")
    target = (root / "src/main/target/MICOAIR743/config.c").read_text(
        encoding="utf-8"
    )
    if generic.index("validateAndFixTargetConfig();") > generic.index(
        "compassConfigMutable()->mag_align = CW270_DEG_FLIP;"
    ):
        raise RuntimeError("Target validation no longer precedes generic mag fallback")
    if "FLIGHT_COMMANDER_MAG_FIXED_ALIGN" not in target:
        raise RuntimeError("Target validator does not defeat the generic fallback")


def create_source_zip(root: Path, destination: Path) -> None:
    manifest = json.loads(
        (root / "RELEASE-MANIFEST.json").read_text(encoding="utf-8")
    )
    stamp = time.gmtime(manifest["source_date_epoch"])[:6]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with zipfile.ZipFile(
        destination,
        "w",
        zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = Path(root.name) / path.relative_to(root)
            info = zipfile.ZipInfo(relative.as_posix(), stamp)
            info.create_system = 3
            mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(
                info,
                path.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def prepare(archive: Path, output: Path) -> Path:
    root = extract_archive(archive, output)
    patch_target_contract(root)
    patch_calibration_identity(root)
    patch_version_and_verifiers(root)
    update_reviewed_baseline(root)
    update_manifest(root)
    verify_prepared_contract(root)
    return root


def finalize(root: Path, firmware: Path, source_zip: Path) -> None:
    if not root.is_dir():
        raise RuntimeError(f"Prepared source root does not exist: {root}")
    if not firmware.is_file():
        raise RuntimeError(f"Built firmware does not exist: {firmware}")
    update_manifest(root, firmware)
    verify_prepared_contract(root)
    create_source_zip(root, source_zip)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--finalize-root", type=Path)
    parser.add_argument("--firmware", type=Path)
    parser.add_argument("--source-zip", type=Path)
    args = parser.parse_args()

    preparing = args.archive is not None or args.output is not None
    finalizing = (
        args.finalize_root is not None
        or args.firmware is not None
        or args.source_zip is not None
    )
    if preparing and finalizing:
        parser.error("prepare and finalize modes cannot be combined")

    if preparing:
        if args.archive is None or args.output is None:
            parser.error("prepare mode requires --archive and --output")
        print(prepare(args.archive, args.output))
        return

    if finalizing:
        if (
            args.finalize_root is None
            or args.firmware is None
            or args.source_zip is None
        ):
            parser.error(
                "finalize mode requires --finalize-root, --firmware, and "
                "--source-zip"
            )
        finalize(args.finalize_root, args.firmware, args.source_zip)
        print(args.source_zip)
        return

    parser.error("select prepare mode or finalize mode")


if __name__ == "__main__":
    main()
