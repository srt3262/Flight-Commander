#!/usr/bin/env python3
"""Build and retain the Flight Commander 4.0.7 MICOAIR743 IMU hotfix."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path

VERSION = "4.0.7"
BASE_VERSION = "4.0.6"
SOURCE_DATE_EPOCH = 1786068000
BASE_SOURCE_SHA256 = "fc305751a9bddb7879c7cc2e1cdd13aaf88d1ccc8684b43aca3ae9f49283f813"
PATCH_SHA256 = "1f0c23edf543190ba7124c330d628874298006dade1e28057ecc95a9d5520529"
TARGET = "MICOAIR743"


def run(*args: str | Path, cwd: Path | None = None) -> None:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}\n")
    return records


def source_identities(root: Path) -> tuple[str, str]:
    records = "".join(source_records(root)).encode()
    revision = hashlib.sha1(records).hexdigest()
    tree = hashlib.sha1(b"flight-commander-source-tree-v1\n" + records).hexdigest()
    return revision, tree


def deterministic_zip(root: Path, output: Path) -> None:
    stamp = time.gmtime(SOURCE_DATE_EPOCH)[:6]
    output.parent.mkdir(parents=True, exist_ok=True)
    archive_root = root.name
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = Path(archive_root) / path.relative_to(root)
            info = zipfile.ZipInfo(relative.as_posix(), stamp)
            info.create_system = 3
            mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), zipfile.ZIP_DEFLATED, compresslevel=9)


def prepare_source(workspace: Path, work: Path) -> Path:
    archive = workspace / f"release/firmware/Flight-Commander-Firmware-Source-v{BASE_VERSION}.zip"
    patch = workspace / f"release/firmware-patches/{VERSION}.patch"
    if sha256(archive) != BASE_SOURCE_SHA256:
        raise RuntimeError("Retained 4.0.6 firmware source archive does not match the published baseline")
    if sha256(patch) != PATCH_SHA256:
        raise RuntimeError("The reviewed 4.0.7 firmware patch checksum changed")

    source_parent = work / "source"
    if source_parent.exists():
        shutil.rmtree(source_parent)
    source_parent.mkdir(parents=True)
    expected_root = f"Flight-Commander-Firmware-Source-v{BASE_VERSION}"
    with zipfile.ZipFile(archive) as zipped:
        if zipped.testzip() is not None:
            raise RuntimeError("The 4.0.6 source archive is corrupt")
        names = zipped.namelist()
        if not names or any(not name.startswith(expected_root + "/") for name in names):
            raise RuntimeError(f"Source archive must contain only {expected_root}/")
        zipped.extractall(source_parent)

    root = source_parent / expected_root
    final_root = source_parent / f"Flight-Commander-Firmware-Source-v{VERSION}"
    root.rename(final_root)
    run("git", "-C", final_root, "apply", "--whitespace=error-all", patch)

    revision, tree = source_identities(final_root)
    manifest_path = final_root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({
        "schema": 1,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "target": TARGET,
        "source_revision": revision,
        "source_tree": tree,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "capabilities": "0x00007fff",
        "capability_mask": "0x00007fff",
        "artifact": {
            "filename": f"Flight-Commander-Firmware-{VERSION}-{TARGET}.hex",
            "sha256": "0" * 64,
            "bytes": 0,
        },
    })
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"source_revision": revision, "source_tree": tree}, indent=2))
    return final_root


def build(workspace: Path, work: Path, update_repository: bool, prepare_only: bool) -> dict[str, object]:
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    root = prepare_source(workspace, work)
    if prepare_only:
        return {"source_root": str(root)}

    build_dir = work / "build"
    run("bash", root / "flight-commander/build-micoair743.sh", build_dir)
    built_hex = build_dir / f"Flight-Commander-Firmware-{VERSION}-{TARGET}.hex"
    if not built_hex.is_file() or built_hex.stat().st_size <= 1024 * 1024:
        raise RuntimeError("Firmware build did not produce the expected MICOAIR743 HEX")

    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifact"] = {
        "filename": built_hex.name,
        "sha256": sha256(built_hex),
        "bytes": built_hex.stat().st_size,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    run(
        sys.executable,
        root / "flight-commander/verify-release.py",
        "--source-root", root,
        "--hex", built_hex,
        "--manifest", manifest_path,
    )

    output = work / "output"
    output.mkdir()
    firmware_output = output / built_hex.name
    source_output = output / f"Flight-Commander-Firmware-Source-v{VERSION}.zip"
    shutil.copy2(built_hex, firmware_output)
    deterministic_zip(root, source_output)
    with zipfile.ZipFile(source_output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Generated 4.0.7 firmware source archive failed integrity testing")

    metadata: dict[str, object] = {
        "version": VERSION,
        "target": TARGET,
        "firmware": {
            "name": firmware_output.name,
            "sha256": sha256(firmware_output),
            "bytes": firmware_output.stat().st_size,
        },
        "source": {
            "name": source_output.name,
            "sha256": sha256(source_output),
            "bytes": source_output.stat().st_size,
            "revision": manifest["source_revision"],
            "tree": manifest["source_tree"],
            "date_epoch": manifest["source_date_epoch"],
        },
    }
    (output / "build-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    if update_repository:
        firmware_dir = workspace / "release/firmware"
        for old in (
            firmware_dir / f"Flight-Commander-Firmware-{BASE_VERSION}-{TARGET}.hex",
            firmware_dir / f"Flight-Commander-Firmware-Source-v{BASE_VERSION}.zip",
        ):
            old.unlink(missing_ok=True)
        shutil.copy2(firmware_output, firmware_dir / firmware_output.name)
        shutil.copy2(source_output, firmware_dir / source_output.name)

        package_path = workspace / "package.json"
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package["version"] = VERSION
        package["flightCommander"].update({
            "firmwareMajor": 4,
            "firmwareReleaseVersion": VERSION,
            "firmwareReleaseSha256": metadata["firmware"]["sha256"],
            "firmwareChangedInRelease": True,
            "firmwareSourceAvailable": True,
            "firmwareSourceVersion": VERSION,
            "firmwareSourceArchive": f"release/firmware/{source_output.name}",
            "firmwareSourceSha256": metadata["source"]["sha256"],
            "firmwareSourceRevision": metadata["source"]["revision"],
            "firmwareSourceTree": metadata["source"]["tree"],
            "reconstructionRelease": False,
        })
        package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

        app_manifest_path = workspace / "manifest.json"
        app_manifest = json.loads(app_manifest_path.read_text(encoding="utf-8"))
        app_manifest["version"] = VERSION
        app_manifest_path.write_text(json.dumps(app_manifest, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(metadata, indent=2))
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--update-repository", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    build(args.workspace.resolve(), args.work.resolve(), args.update_repository, args.prepare_only)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
