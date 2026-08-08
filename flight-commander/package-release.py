#!/usr/bin/env python3
"""Build, verify, and package the Flight Commander MICOAIR743 firmware."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "RELEASE-MANIFEST.json"
TARGET = "MICOAIR743"

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


def read_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def write_manifest(manifest: dict[str, object]) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def validate_manifest(manifest: dict[str, object], revision: str, tree: str) -> tuple[str, int]:
    version = str(manifest.get("version", ""))
    if not version or version != "4.1.4":
        raise RuntimeError(f"Expected Firmware 4.1.4, received {version or 'missing'}")
    if manifest.get("product") != "Flight Commander Firmware":
        raise RuntimeError("Firmware manifest product identity is invalid")
    if manifest.get("target") != TARGET:
        raise RuntimeError("Firmware manifest target is invalid")
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
    revision, tree = source_identities()
    manifest = read_manifest()
    if refresh_manifest:
        manifest["source_revision"] = revision
        manifest["source_tree"] = tree
        manifest["artifact"] = {
            "filename": f"Flight-Commander-Firmware-4.1.4-{TARGET}.hex",
            "sha256": "0" * 64,
            "bytes": 0,
        }
        write_manifest(manifest)

    version, source_date_epoch = validate_manifest(manifest, revision, tree)
    if build_dir.exists():
        raise RuntimeError(f"Build directory already exists: {build_dir}")
    build_dir.parent.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["FLIGHT_COMMANDER_SOURCE_REVISION"] = revision
    environment["SOURCE_DATE_EPOCH"] = str(source_date_epoch)
    print(f"+ bash flight-commander/build-micoair743.sh {build_dir}", flush=True)
    subprocess.run(
        ["bash", str(ROOT / "flight-commander/build-micoair743.sh"), str(build_dir)],
        cwd=ROOT,
        env=environment,
        check=True,
    )

    firmware_name = f"Flight-Commander-Firmware-{version}-{TARGET}.hex"
    built_hex = build_dir / firmware_name
    if not built_hex.is_file() or built_hex.stat().st_size <= 1024 * 1024:
        raise RuntimeError("Firmware build did not produce the expected MICOAIR743 HEX")
    firmware_hash = sha256(built_hex)
    firmware_bytes = built_hex.stat().st_size

    if refresh_manifest:
        manifest = read_manifest()
        manifest["artifact"] = {
            "filename": firmware_name,
            "sha256": firmware_hash,
            "bytes": firmware_bytes,
        }
        write_manifest(manifest)
    else:
        artifact = manifest.get("artifact")
        if not isinstance(artifact, dict):
            raise RuntimeError("Firmware artifact manifest is missing")
        expected_artifact = {
            "filename": firmware_name,
            "sha256": firmware_hash,
            "bytes": firmware_bytes,
        }
        if artifact != expected_artifact:
            raise RuntimeError("Rebuilt firmware does not match RELEASE-MANIFEST.json")

    run(
        "python3",
        ROOT / "flight-commander/verify-release.py",
        "--source-root",
        ROOT,
        "--hex",
        built_hex,
        "--manifest",
        MANIFEST_PATH,
        cwd=ROOT,
    )

    output.mkdir(parents=True, exist_ok=True)
    firmware_output = output / firmware_name
    source_output = output / f"FC-Firmware-Source-v{version}.zip"
    shutil.copy2(built_hex, firmware_output)
    deterministic_zip(source_output, version, source_date_epoch)

    metadata: dict[str, object] = {
        "version": version,
        "target": TARGET,
        "sourceDateEpoch": source_date_epoch,
        "firmware": {
            "name": firmware_output.name,
            "sha256": firmware_hash,
            "bytes": firmware_bytes,
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
    build_dir = (args.build_dir or Path(tempfile.mkdtemp(prefix="flight-commander-build-")).resolve())
    build(output, build_dir, args.refresh_manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
