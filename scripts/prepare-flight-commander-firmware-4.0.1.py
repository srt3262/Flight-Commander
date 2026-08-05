#!/usr/bin/env python3
"""Create Flight Commander Firmware 4.0.1 from the retained 4.0.0 source.

4.0.1 is a narrowly scoped compass-regression repair. It keeps every 4.0.0
feature while restoring the physically accepted MICOAIR743 onboard IST8310
mapping from 3.0.7. External tagged IST8310 devices retain the generic driver
mapping.
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

VERSION = "4.0.1"
SOURCE_DATE_EPOCH = 1785898500


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        records.append(
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  "
            f"{path.relative_to(root).as_posix()}\n"
        )
    return records


def source_identities(root: Path) -> tuple[str, str]:
    records = source_records(root)
    revision = hashlib.sha1("".join(records).encode()).hexdigest()
    tree = hashlib.sha1(
        ("flight-commander-source-tree-v1\n" + "".join(records)).encode()
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
        raise RuntimeError(f"Expected one source root in {archive}; found {len(roots)}")
    original = roots[0]
    root = output / f"Flight-Commander-Firmware-Source-v{VERSION}"
    original.rename(root)
    return root


def patch_compass(root: Path) -> None:
    path = root / "src/main/drivers/compass/compass_ist8310.c"
    old = '''#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)
    const bool isMicoAirOnboard =
        mag->magSensorToUse == 0 &&
        mag->busDev->busType == BUSTYPE_I2C &&
        mag->busDev->busdev.i2c.i2cBus == BUS_I2C2 &&
        mag->busDev->busdev.i2c.address == 0x0E;

    if (isMicoAirOnboard) {
        // MICOAIR743 onboard IST8310 converted into INAV's BMI088 body frame.
        // Native registers are left-handed; the correct signed permutation is
        // X=-nativeY, Y=-nativeX, Z=nativeZ. User alignment remains CW 0.
        mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;
        mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;
        mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;
        return;
    }
#endif
'''
    new = '''#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)
    // The primary MICOAIR743 compass is always tag 0. Do not gate its fixed
    // chip-to-body transform on mutable runtime bus fields: that allowed the
    // 4.0.0 build to fall through to the generic IST8310 mapping. Flight
    // Commander external compasses use an explicit nonzero descriptor tag and
    // therefore continue to use the generic mapping below.
    if (mag->magSensorToUse == 0) {
        // Physically accepted 3.0.7 MICOAIR743 onboard transform.
        // X=-nativeY, Y=-nativeX, Z=nativeZ. User alignment remains CW 0.
        mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;
        mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;
        mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;
        return;
    }
#endif
'''
    replace_once(path, old, new)

    patched = path.read_text(encoding="utf-8")
    required = (
        "if (mag->magSensorToUse == 0)",
        "mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[X] =  nativeX * IST8310_LSB_TO_MILLIGAUSS;",
        "mag->magADCRaw[Y] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;",
    )
    for token in required:
        if token not in patched:
            raise RuntimeError(f"Compass regression contract missing: {token}")
    guarded = patched.split("#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)", 1)[1].split("#endif", 1)[0]
    for forbidden in ("busType ==", "i2cBus ==", "address =="):
        if forbidden in guarded:
            raise RuntimeError(f"Fragile onboard compass runtime gate remains: {forbidden}")


def patch_version(root: Path) -> None:
    header = root / "src/main/build/flight_commander.h"
    replace_once(
        header,
        "#define FLIGHT_COMMANDER_VERSION_PATCH 0",
        "#define FLIGHT_COMMANDER_VERSION_PATCH 1",
    )

    build = root / "flight-commander/build-micoair743.sh"
    replace_once(
        build,
        "Flight-Commander-Firmware-4.0.0-MICOAIR743.hex",
        "Flight-Commander-Firmware-4.0.1-MICOAIR743.hex",
    )

    verify = root / "flight-commander/verify-release.py"
    verify_text = verify.read_text(encoding="utf-8").replace("4.0.0", "4.0.1")
    verify_text = verify_text.replace(r"4\.0\.0", r"4\.0\.1")
    verify_text = verify_text.replace("bytes((1, 4, 0, 0,", "bytes((1, 4, 0, 1,")
    verify_text = verify_text.replace("FLIGHT_COMMANDER_VERSION_PATCH 0", "FLIGHT_COMMANDER_VERSION_PATCH 1")
    verify.write_text(verify_text, encoding="utf-8")

    compass_verify = root / "flight-commander/verify-compass-release.py"
    compass_verify_text = compass_verify.read_text(encoding="utf-8").replace("4.0.0", "4.0.1")
    compass_verify_text = compass_verify_text.replace("bytes((1, 4, 0, 0,", "bytes((1, 4, 0, 1,")
    compass_verify.write_text(compass_verify_text, encoding="utf-8")


def update_manifest(root: Path) -> None:
    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest["source_date_epoch"] = SOURCE_DATE_EPOCH
    manifest["artifact"] = {
        "filename": f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex",
        "sha256": "0" * 64,
        "bytes": 0,
    }
    manifest["bench_acceptance"] = {
        "mapping": {"x": "-native_y", "y": "-native_x", "z": "native_z"},
        "user_alignment": "CW0_DEG",
        "result": "4.0.1-restores-accepted-3.0.7-transform",
        "regression": "4.0.0 runtime bus identity gate removed",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    revision, tree = source_identities(root)
    manifest["source_revision"] = revision
    manifest["source_tree"] = tree
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def create_source_zip(root: Path, destination: Path) -> None:
    manifest = json.loads((root / "RELEASE-MANIFEST.json").read_text(encoding="utf-8"))
    stamp = time.gmtime(manifest["source_date_epoch"])[:6]
    destination.parent.mkdir(parents=True, exist_ok=True)
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-zip", type=Path)
    args = parser.parse_args()

    root = extract_archive(args.archive, args.output)
    patch_compass(root)
    patch_version(root)
    update_manifest(root)
    if args.source_zip:
        create_source_zip(root, args.source_zip)
    print(root)


if __name__ == "__main__":
    main()
