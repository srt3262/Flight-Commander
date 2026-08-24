#!/usr/bin/env python3
"""Build, verify, and package every official Flight Commander firmware target."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "RELEASE-MANIFEST.json"
TARGET_MANIFEST_PATH = ROOT / "flight-commander" / "official-targets.txt"
VERSION = "4.3.2"
EXPECTED_TARGET_COUNT = 50

FIRMWARE_SOURCE_ENTRIES = (
    ".dir-locals.el",
    ".dockerignore",
    ".gitattributes",
    ".gitignore",
    ".travis.sh",
    ".travis.yml",
    ".vimrc",
    "AGENT.md",
    "AUTHORS",
    "CMakeLists.txt",
    "Dockerfile",
    "JLinkSettings.ini",
    "LICENSE",
    "README.md",
    "Vagrantfile",
    "build.sh",
    "build_docs.sh",
    "cmake",
    "dev",
    "fake_travis_build.sh",
    "flight-commander",
    "lib",
    "src",
)


def run(*args: str | Path, cwd: Path | None = None) -> None:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_files() -> list[Path]:
    files: list[Path] = []
    for relative in FIRMWARE_SOURCE_ENTRIES:
        path = ROOT / relative
        if not path.exists():
            raise RuntimeError(f"Firmware source entry is missing: {relative}")
        if path.is_file():
            files.append(path)
        else:
            files.extend(
                candidate
                for candidate in path.rglob("*")
                if candidate.is_file()
                and "__pycache__" not in candidate.parts
                and candidate.suffix != ".pyc"
            )
    files.append(MANIFEST_PATH)
    return sorted(set(files), key=lambda path: path.relative_to(ROOT).as_posix())


def source_records() -> list[str]:
    records: list[str] = []
    for path in source_files():
        if path == MANIFEST_PATH:
            continue
        relative = path.relative_to(ROOT).as_posix()
        records.append(f"{sha256(path)}  {relative}\n")
    return records


def source_identities() -> tuple[str, str]:
    canonical = "".join(source_records()).encode()
    revision = hashlib.sha1(canonical).hexdigest()
    tree = hashlib.sha1(b"flight-commander-source-tree-v1\n" + canonical).hexdigest()
    return revision, tree


def read_target_records() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for line_number, raw_line in enumerate(
        TARGET_MANIFEST_PATH.read_text(encoding="utf-8").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 3:
            raise RuntimeError(f"Malformed target manifest line {line_number}")
        target, mcu, dronecan = fields
        if not re.fullmatch(r"[A-Za-z0-9_]+", target):
            raise RuntimeError(f"Invalid official target name: {target}")
        if target in seen:
            raise RuntimeError(f"Duplicate official target: {target}")
        if mcu not in {"STM32H743XI", "STM32H757XI"}:
            raise RuntimeError(f"Unsupported MCU for {target}: {mcu}")
        if dronecan not in {"NONE", "TARGET"} and not re.fullmatch(
            r"P[A-K][0-9]{1,2},P[A-K][0-9]{1,2}", dronecan
        ):
            raise RuntimeError(f"Invalid DroneCAN mapping for {target}: {dronecan}")
        seen.add(target)
        records.append({"target": target, "mcu": mcu, "dronecan": dronecan})
    if len(records) != EXPECTED_TARGET_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_TARGET_COUNT} official targets, found {len(records)}"
        )
    return records


def capability_mask(manifest: dict[str, object], dronecan: str) -> str:
    masks = manifest.get("capability_masks")
    if not isinstance(masks, dict):
        raise RuntimeError("Firmware manifest capability masks are missing")
    key = "dronecan" if dronecan != "NONE" else "base"
    value = str(masks.get(key, ""))
    if not re.fullmatch(r"0x[0-9a-f]{8}", value):
        raise RuntimeError(f"Firmware manifest {key} capability mask is invalid")
    return value


def read_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def write_manifest(manifest: dict[str, object]) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def validate_manifest(
    manifest: dict[str, object],
    target_records: list[dict[str, str]],
    revision: str,
    tree: str,
) -> tuple[str, int]:
    version = str(manifest.get("version", ""))
    if not version or version != VERSION:
        raise RuntimeError(f"Expected Firmware {VERSION}, received {version or 'missing'}")
    if manifest.get("product") != "Flight Commander Firmware":
        raise RuntimeError("Firmware manifest product identity is invalid")
    targets = [record["target"] for record in target_records]
    if manifest.get("schema") != 3 or manifest.get("targets") != targets:
        raise RuntimeError("Firmware manifest targets are invalid")
    expected_matrix = {
        record["target"]: {
            "mcu": record["mcu"],
            "dronecan": record["dronecan"] != "NONE",
            "capability_mask": capability_mask(manifest, record["dronecan"]),
        }
        for record in target_records
    }
    if manifest.get("target_matrix") != expected_matrix:
        raise RuntimeError("Firmware manifest target matrix is invalid")
    if manifest.get("source_revision") != revision:
        raise RuntimeError("Firmware source revision does not match the tracked firmware tree")
    if manifest.get("source_tree") != tree:
        raise RuntimeError("Firmware source tree identity does not match the tracked firmware tree")
    source_date_epoch = manifest.get("source_date_epoch")
    if not isinstance(source_date_epoch, int) or source_date_epoch <= 0:
        raise RuntimeError("Firmware source date epoch is invalid")
    if source_date_epoch > int(time.time()):
        raise RuntimeError("Firmware source date epoch is in the future")
    return version, source_date_epoch


def deterministic_zip(output: Path, version: str, source_date_epoch: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.gmtime(source_date_epoch)[:6]
    prefix = Path(f"Flight-Commander-Firmware-Source-v{version}")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in source_files():
            relative = prefix / path.relative_to(ROOT)
            info = zipfile.ZipInfo(relative.as_posix(), stamp)
            info.create_system = 3
            executable = bool(path.stat().st_mode & stat.S_IXUSR)
            info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(output) as archive:
        corrupt = archive.testzip()
        if corrupt is not None:
            raise RuntimeError(f"Firmware source archive is corrupt at {corrupt}")


def build(output: Path, build_dir: Path, refresh_manifest: bool) -> dict[str, object]:
    if output.exists():
        raise RuntimeError(f"Output directory already exists: {output}")
    target_records = read_target_records()
    targets = [record["target"] for record in target_records]
    revision, tree = source_identities()
    manifest = read_manifest()
    if refresh_manifest:
        manifest["schema"] = 3
        manifest["version"] = VERSION
        manifest["targets"] = targets
        manifest["target_matrix"] = {
            record["target"]: {
                "mcu": record["mcu"],
                "dronecan": record["dronecan"] != "NONE",
                "capability_mask": capability_mask(manifest, record["dronecan"]),
            }
            for record in target_records
        }
        manifest["source_revision"] = revision
        manifest["source_tree"] = tree
        manifest["artifacts"] = {
            record["target"]: {
                "filename": f"Flight-Commander-Firmware-{VERSION}-{record['target']}.hex",
                "sha256": "0" * 64,
                "bytes": 0,
            }
            for record in target_records
        }
        write_manifest(manifest)

    version, source_date_epoch = validate_manifest(
        manifest, target_records, revision, tree
    )
    if build_dir.exists():
        raise RuntimeError(f"Build directory already exists: {build_dir}")
    build_dir.parent.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["FLIGHT_COMMANDER_SOURCE_REVISION"] = revision
    environment["SOURCE_DATE_EPOCH"] = str(source_date_epoch)
    print(f"+ bash flight-commander/build-targets.sh {build_dir}", flush=True)
    subprocess.run(
        ["bash", str(ROOT / "flight-commander/build-targets.sh"), str(build_dir)],
        cwd=ROOT,
        env=environment,
        check=True,
    )

    built_hexes: dict[str, Path] = {}
    artifact_records: dict[str, dict[str, object]] = {}
    for record in target_records:
        target = record["target"]
        firmware_name = f"Flight-Commander-Firmware-{version}-{target}.hex"
        built_hex = build_dir / firmware_name
        if not built_hex.is_file() or built_hex.stat().st_size <= 1024 * 1024:
            raise RuntimeError(f"Firmware build did not produce the expected {target} HEX")
        built_hexes[target] = built_hex
        artifact_records[target] = {
            "filename": firmware_name,
            "sha256": sha256(built_hex),
            "bytes": built_hex.stat().st_size,
        }

    if refresh_manifest:
        manifest = read_manifest()
        manifest["artifacts"] = artifact_records
        write_manifest(manifest)
    else:
        if manifest.get("artifacts") != artifact_records:
            raise RuntimeError("Rebuilt firmware artifacts do not match RELEASE-MANIFEST.json")

    run(
        "python3",
        ROOT / "flight-commander/verify-release.py",
        "--source-root",
        ROOT,
        "--hex",
        *built_hexes.values(),
        "--manifest",
        MANIFEST_PATH,
        cwd=ROOT,
    )

    output.mkdir(parents=True)
    source_output = output / f"FC-Firmware-Source-v{version}.zip"
    for target, built_hex in built_hexes.items():
        shutil.copy2(built_hex, output / str(artifact_records[target]["filename"]))
    deterministic_zip(source_output, version, source_date_epoch)

    metadata: dict[str, object] = {
        "version": version,
        "targets": targets,
        "targetMatrix": manifest["target_matrix"],
        "sourceDateEpoch": source_date_epoch,
        "firmware": {
            target: {
                "name": record["filename"],
                "sha256": record["sha256"],
                "bytes": record["bytes"],
                **manifest["target_matrix"][target],
            }
            for target, record in artifact_records.items()
        },
        "source": {
            "name": source_output.name,
            "sha256": sha256(source_output),
            "bytes": source_output.stat().st_size,
            "revision": revision,
            "tree": tree,
        },
    }
    (output / "firmware-release-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, indent=2))
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--refresh-manifest", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    build_dir = (
        args.build_dir
        or Path(tempfile.mkdtemp(prefix="flight-commander-build-")) / "build"
    ).resolve()
    build(output, build_dir, args.refresh_manifest)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"release packaging failed: {error}", file=sys.stderr)
        raise SystemExit(1)
