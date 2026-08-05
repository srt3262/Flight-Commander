#!/usr/bin/env python3
"""Prepare Flight Commander Firmware 4.0.3 with independent compass layers.

The MICOAIR743 onboard IST8310 has two deliberately separate rotations:

1. A fixed chip-to-board transform in compass_ist8310.c.  This translates the
   physical sensor axes into the flight-controller/IMU body frame and is never
   writable from MSP, CLI, or the Alignment tab.
2. A persisted user alignment in compassConfig.  It defaults to CW0_DEG for
   this target, remains editable, and is applied after the driver transform.

4.0.2 accidentally merged those layers by rewriting mag_align and all custom
angles on every boot.  4.0.3 removes that runtime override, resolves only the
ALIGN_DEFAULT sentinel to the target default, and advances the calibration
contract so one fresh calibration is required after the migration.
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

VERSION = "4.0.3"
SOURCE_DATE_EPOCH = 1785970800


def replace_once(path: Path, old: str, new: str, label: str | None = None) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{label or path}: expected one replacement target, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        records.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}\n")
    return records


def source_identities(root: Path) -> tuple[str, str]:
    canonical = "".join(source_records(root)).encode()
    return (
        hashlib.sha1(canonical).hexdigest(),
        hashlib.sha1(b"flight-commander-source-tree-v1\n" + canonical).hexdigest(),
    )


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
    root = output / f"Flight-Commander-Firmware-Source-v{VERSION}"
    roots[0].rename(root)
    return root


def patch_alignment_layers(root: Path) -> None:
    target_header = root / "src/main/target/MICOAIR743/target.h"
    replace_once(
        target_header,
        """#define FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310
#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG
#define FLIGHT_COMMANDER_MAG_FIXED_ALIGN CW0_DEG
#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 1U
""",
        """#define FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310
// Default for the persisted user-adjustable alignment layer.  The driver's
// physical IST8310 chip-to-board transform is separate and always runs first.
#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG
#define FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 2U
""",
        "MICOAIR743 compass layer contract",
    )

    target_config = root / "src/main/target/MICOAIR743/config.c"
    replace_once(
        target_config,
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
        """#include "fc/config.h"
#include "sensors/gyro.h"


void targetConfiguration(void)
""",
        "remove MICOAIR743 boot-time compass rewrite",
    )

    compass_source = root / "src/main/sensors/compass.c"
    replace_once(
        compass_source,
        """PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 7);

PG_RESET_TEMPLATE(compassConfig_t, compassConfig,
    .mag_align = SETTING_ALIGN_MAG_DEFAULT,
""",
        """PG_REGISTER_WITH_RESET_TEMPLATE(compassConfig_t, compassConfig, PG_COMPASS_CONFIG, 8);

#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
#define COMPASS_RESET_ALIGN FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
#else
#define COMPASS_RESET_ALIGN SETTING_ALIGN_MAG_DEFAULT
#endif

PG_RESET_TEMPLATE(compassConfig_t, compassConfig,
    .mag_align = COMPASS_RESET_ALIGN,
""",
        "persisted compass alignment default",
    )

    generic_config = root / "src/main/fc/config.c"
    replace_once(
        generic_config,
        """#ifdef USE_MAG
    if (compassConfig()->mag_align == ALIGN_DEFAULT) {
        compassConfigMutable()->mag_align = CW270_DEG_FLIP;
    }
#endif
""",
        """#ifdef USE_MAG
    if (compassConfig()->mag_align == ALIGN_DEFAULT) {
#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN
        // Resolve only the unconfigured sentinel.  Any explicit onboard
        // alignment or custom roll/pitch/yaw value remains user-owned.
        compassConfigMutable()->mag_align = FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN;
#else
        compassConfigMutable()->mag_align = CW270_DEG_FLIP;
#endif
    }
#endif
""",
        "target-aware compass default migration",
    )


def patch_version_and_verifiers(root: Path) -> None:
    header = root / "src/main/build/flight_commander.h"
    replace_once(
        header,
        "#define FLIGHT_COMMANDER_VERSION_PATCH 2",
        "#define FLIGHT_COMMANDER_VERSION_PATCH 3",
        "firmware patch version",
    )

    cmake = root / "CMakeLists.txt"
    replace_once(
        cmake,
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.2)",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.3)",
        "CMake firmware version",
    )

    build = root / "flight-commander/build-micoair743.sh"
    replace_once(
        build,
        "Flight-Commander-Firmware-4.0.2-MICOAIR743.hex",
        "Flight-Commander-Firmware-4.0.3-MICOAIR743.hex",
        "firmware build output name",
    )

    verify = root / "flight-commander/verify-release.py"
    verify_text = verify.read_text(encoding="utf-8").replace("4.0.2", "4.0.3")
    verify_text = verify_text.replace(r"4\.0\.2", r"4\.0\.3")
    verify_text = verify_text.replace(
        "bytes((1, 4, 0, 2,",
        "bytes((1, 4, 0, 3,",
    )
    verify_text = verify_text.replace(
        "FLIGHT_COMMANDER_VERSION_PATCH 2",
        "FLIGHT_COMMANDER_VERSION_PATCH 3",
    )
    verify.write_text(verify_text, encoding="utf-8")

    replace_once(
        verify,
        """        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/sensors/compass.c",
        "src/main/sensors/compass.h",
        "src/main/target/MICOAIR743/config.c",
        "src/main/target/MICOAIR743/target.h",
""",
        """        "src/main/drivers/compass/compass_ist8310.c",
        "src/main/fc/config.c",
        "src/main/sensors/compass.c",
        "src/main/sensors/compass.h",
        "src/main/target/MICOAIR743/target.h",
""",
        "reviewed source extension set",
    )

    replace_once(
        verify,
        """            r"PG_COMPASS_CONFIG, 7",
            r"magCalibrationRevision",
            r"magCalibrationSignature",
            r"compassCalibrationSignature",
""",
        """            r"PG_COMPASS_CONFIG, 8",
            r"magCalibrationRevision",
            r"magCalibrationSignature",
            r"compassCalibrationSignature",
            r"\.mag_align = COMPASS_RESET_ALIGN",
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
            r"FLIGHT_COMMANDER_MAG_FIXED_ALIGN CW0_DEG",
            r"FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 1U",
        ],
    )
    require_text(
        root / "src/main/target/MICOAIR743/config.c",
        [
            r"void validateAndFixTargetConfig\(void\)",
            r"mag_align = FLIGHT_COMMANDER_MAG_FIXED_ALIGN",
            r"rollDeciDegrees = 0",
            r"pitchDeciDegrees = 0",
            r"yawDeciDegrees = 0",
        ],
    )
""",
        """    require_text(
        root / "src/main/target/MICOAIR743/target.h",
        [
            r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",
            r"FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",
            r"FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 2U",
        ],
    )
    require_text(
        root / "src/main/fc/config.c",
        [
            r"#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN",
            r"mag_align = FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN",
        ],
    )
""",
        "MICOAIR743 user-alignment verifier",
    )

    compass_verify = root / "flight-commander/verify-compass-release.py"
    compass_verify_text = compass_verify.read_text(encoding="utf-8")
    compass_verify_text = compass_verify_text.replace("4.0.2", "4.0.3")
    compass_verify_text = compass_verify_text.replace(
        "bytes((1, 4, 0, 2,",
        "bytes((1, 4, 0, 3,",
    )
    compass_verify.write_text(compass_verify_text, encoding="utf-8")


def update_reviewed_baseline(root: Path) -> None:
    baseline_path = root / "flight-commander/INAV-9.1.0-BASELINE.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    protected = baseline["protected_files"]
    extensions = baseline["intentional_extensions"]

    restored = "src/main/target/MICOAIR743/config.c"
    extensions.pop(restored, None)
    if sha256(root / restored) != protected[restored]:
        raise RuntimeError(
            "MICOAIR743 config.c was not restored to the protected upstream bytes"
        )

    declarations = {
        "src/main/fc/config.c": (
            "Resolve ALIGN_DEFAULT to the target-specific compass default while "
            "preserving every explicit saved alignment and custom angle."
        ),
        "src/main/sensors/compass.c": (
            "Commit compass calibration only after the solver succeeds, guard "
            "calibrated correction against invalid gain divisors, require a "
            "hidden revision/signature before saved correction is applied, and "
            "store the MICOAIR743 CW0 user-alignment default in the reset template."
        ),
        "src/main/sensors/compass.h": (
            "Persist hidden compass calibration contract revision and signature "
            "metadata that incompatible restored settings cannot recreate."
        ),
        "src/main/target/MICOAIR743/target.h": (
            "Bind the primary IST8310 to the fixed driver transform, declare CW0 "
            "only as the editable user-alignment default, and advance the "
            "calibration contract to revision 2."
        ),
    }

    for relative, purpose in declarations.items():
        path = root / relative
        existing = extensions.get(relative, {})
        upstream = existing.get("upstream_sha256") or protected.get(relative)
        if not upstream:
            raise RuntimeError(f"Protected upstream hash unavailable for {relative}")
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

    manifest["artifact"] = {
        "filename": f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex",
        "sha256": sha256(firmware) if firmware else "0" * 64,
        "bytes": firmware.stat().st_size if firmware else 0,
    }
    manifest["compass_coordinate_contract"] = {
        "driver_transform": {
            "scope": "physical onboard IST8310 chip-to-MICOAIR743 body frame",
            "mapping": {
                "x": "-native_y",
                "y": "-native_x",
                "z": "native_z",
            },
            "mutable": False,
        },
        "user_alignment": {
            "scope": "saved installation/alignment layer applied after driver transform",
            "default": "CW0_DEG",
            "editable": True,
            "saved_changes_preserved_at_boot": True,
        },
        "root_cause": (
            "4.0.2 target validation rewrote mag_align and all three custom "
            "alignment angles on every startup"
        ),
        "permanent_fix": (
            "CW0 is a reset/migration default only; no target boot hook writes "
            "the saved user alignment"
        ),
    }
    manifest["calibration_persistence"] = {
        "parameter_group_version": 8,
        "calibration_contract_revision": 2,
        "signature": "FNV-1a over sensor, alignment, offsets, and gains",
        "migration": (
            "one new successful calibration is required after installing 4.0.3"
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
        "src/main/drivers/compass/compass_ist8310.c": (
            "mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
            "mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;",
            "mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;",
        ),
        "src/main/target/MICOAIR743/target.h": (
            "FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",
            "FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 2U",
        ),
        "src/main/fc/config.c": (
            "#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN",
            "mag_align = FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN",
        ),
        "src/main/sensors/compass.h": (
            "magCalibrationRevision",
            "magCalibrationSignature",
        ),
        "src/main/sensors/compass.c": (
            "PG_COMPASS_CONFIG, 8",
            "#define COMPASS_RESET_ALIGN FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN",
            ".mag_align = COMPASS_RESET_ALIGN",
            "compassCalibrationSignature",
        ),
    }
    for relative, tokens in required.items():
        text = (root / relative).read_text(encoding="utf-8")
        for token in tokens:
            if token not in text:
                raise RuntimeError(f"{relative}: required contract missing: {token}")

    target_header = (
        root / "src/main/target/MICOAIR743/target.h"
    ).read_text(encoding="utf-8")
    target_config = (
        root / "src/main/target/MICOAIR743/config.c"
    ).read_text(encoding="utf-8")
    for forbidden in (
        "FLIGHT_COMMANDER_MAG_FIXED_ALIGN",
        "compassConfigMutable()->mag_align",
        "compassConfigMutable()->rollDeciDegrees",
        "compassConfigMutable()->pitchDeciDegrees",
        "compassConfigMutable()->yawDeciDegrees",
    ):
        haystack = target_header if "FIXED_ALIGN" in forbidden else target_config
        if forbidden in haystack:
            raise RuntimeError(
                f"boot-time user-alignment override remains: {forbidden}"
            )


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
    patch_alignment_layers(root)
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
                "finalize mode requires --finalize-root, --firmware, and --source-zip"
            )
        finalize(args.finalize_root, args.firmware, args.source_zip)
        print(args.source_zip)
        return

    parser.error("select prepare mode or finalize mode")


if __name__ == "__main__":
    main()
