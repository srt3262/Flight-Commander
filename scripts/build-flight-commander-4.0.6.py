#!/usr/bin/env python3
"""Build the coordinated Flight Commander 4.0.6 beta release."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path

VERSION = "4.0.6"
SOURCE_DATE_EPOCH = 1786032000


def run(*args: str | Path, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def deterministic_zip(root: Path, output: Path, archive_root: str) -> None:
    stamp = time.gmtime(SOURCE_DATE_EPOCH)[:6]
    output.parent.mkdir(parents=True, exist_ok=True)
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


def build_firmware(workspace: Path, temp: Path) -> None:
    output = temp / "flight-commander-firmware-4.0.6"
    root = output / "Flight-Commander-Firmware-Source-v4.0.6"
    metadata_path = temp / "firmware-4.0.6-metadata.json"
    run(
        sys.executable,
        workspace / "scripts/prepare-flight-commander-firmware-4.0.6.py",
        "--archive", workspace / "release/firmware/Flight-Commander-Firmware-Source-v4.0.5.zip",
        "--patch", workspace / "release/firmware-patches/4.0.6.patch",
        "--output", output,
        "--metadata", temp / "firmware-4.0.6-prepare.json",
    )
    build = temp / "build-flight-commander-4.0.6"
    run("bash", root / "flight-commander/build-micoair743.sh", build)
    built_hex = build / "Flight-Commander-Firmware-4.0.6-MICOAIR743.hex"
    release_hex = temp / "FC-Firmware-v4.0.6-MICOAIR743.hex"
    shutil.copy2(built_hex, release_hex)

    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifact"]["sha256"] = digest(release_hex)
    manifest["artifact"]["bytes"] = release_hex.stat().st_size
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    source_zip = temp / "FC-Firmware-Source-v4.0.6.zip"
    deterministic_zip(root, source_zip, root.name)
    run(
        sys.executable,
        root / "flight-commander/verify-release.py",
        "--source-root", root,
        "--hex", release_hex,
    )
    metadata = {
        "version": VERSION,
        "firmware_name": release_hex.name,
        "firmware_sha256": digest(release_hex),
        "firmware_bytes": release_hex.stat().st_size,
        "source_name": source_zip.name,
        "source_sha256": digest(source_zip),
        "source_bytes": source_zip.stat().st_size,
        "source_revision": manifest["source_revision"],
        "source_tree": manifest["source_tree"],
        "source_date_epoch": manifest["source_date_epoch"],
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


def update_package(workspace: Path, firmware_dir: Path) -> dict:
    metadata = json.loads((firmware_dir / "firmware-4.0.6-metadata.json").read_text(encoding="utf-8"))
    firmware_release = workspace / "release/firmware/Flight-Commander-Firmware-4.0.6-MICOAIR743.hex"
    firmware_source = workspace / "release/firmware/Flight-Commander-Firmware-Source-v4.0.6.zip"
    firmware_release.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(firmware_dir / "FC-Firmware-v4.0.6-MICOAIR743.hex", firmware_release)
    shutil.copy2(firmware_dir / "FC-Firmware-Source-v4.0.6.zip", firmware_source)

    package_path = workspace / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    package["flightCommander"].update({
        "firmwareMajor": 4,
        "firmwareReleaseVersion": VERSION,
        "firmwareReleaseSha256": metadata["firmware_sha256"],
        "firmwareChangedInRelease": True,
        "firmwareSourceAvailable": True,
        "firmwareSourceVersion": VERSION,
        "firmwareSourceArchive": "release/firmware/Flight-Commander-Firmware-Source-v4.0.6.zip",
        "firmwareSourceSha256": metadata["source_sha256"],
        "firmwareSourceRevision": metadata["source_revision"],
        "firmwareSourceTree": metadata["source_tree"],
        "reconstructionRelease": False,
    })
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    manifest_path = workspace / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return metadata


def zip_windows(app: Path, output: Path) -> None:
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(app.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(app).as_posix())


def zip_configurator_source(workspace: Path, output: Path) -> None:
    excluded_roots = {".git", ".flight-commander", "node_modules", "out", "release-candidate"}
    stamp = time.gmtime(SOURCE_DATE_EPOCH)[:6]
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(workspace.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(workspace)
            if relative.parts[0] in excluded_roots:
                continue
            archived = Path("FC-Configurator-Source-v4.0.6") / relative
            info = zipfile.ZipInfo(archived.as_posix(), stamp)
            info.create_system = 3
            mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), zipfile.ZIP_DEFLATED, compresslevel=9)


def build_release(workspace: Path, firmware_dir: Path, output: Path) -> None:
    run("git", "apply", "--whitespace=error-all", workspace / "release/configurator-patches/4.0.6.patch", cwd=workspace)
    metadata = update_package(workspace, firmware_dir)
    yarn = shutil.which("yarn") or shutil.which("yarn.cmd")
    if not yarn:
        raise RuntimeError("Yarn is unavailable")
    run(yarn, "install", "--frozen-lockfile", "--non-interactive", cwd=workspace)
    run(yarn, "test", cwd=workspace)
    run(yarn, "package:windows", cwd=workspace)
    run(yarn, "verify:windows", cwd=workspace)

    candidates = sorted((workspace / "out").glob("*win32-x64"))
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one Windows package directory, found {candidates}")
    output.mkdir(parents=True, exist_ok=True)
    windows_zip = output / "FC-Windows-v4.0.6.zip"
    config_zip = output / "FC-Configurator-Source-v4.0.6.zip"
    firmware_hex = output / "FC-Firmware-v4.0.6-MICOAIR743.hex"
    firmware_source = output / "FC-Firmware-Source-v4.0.6.zip"
    zip_windows(candidates[0], windows_zip)
    zip_configurator_source(workspace, config_zip)
    shutil.copy2(firmware_dir / firmware_hex.name, firmware_hex)
    shutil.copy2(firmware_dir / firmware_source.name, firmware_source)

    components = [windows_zip, config_zip, firmware_hex, firmware_source]
    bundle = output / "Flight-Commander-v4.0.6.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(components, key=lambda item: item.name):
            archive.write(path, path.name)
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
    expected = sorted(path.name for path in components)
    if len(names) != 4 or sorted(names) != expected:
        raise RuntimeError(f"Complete bundle contract failed: {names}")
    lines = []
    for path in [*components, bundle]:
        line = f"{digest(path)}  {path.name}"
        lines.append(line)
        print(f"{line}  {path.stat().st_size} bytes")
    (output / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if digest(firmware_hex) != metadata["firmware_sha256"]:
        raise RuntimeError("Firmware HEX changed during release packaging")
    if digest(firmware_source) != metadata["source_sha256"]:
        raise RuntimeError("Firmware source ZIP changed during release packaging")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    firmware = sub.add_parser("firmware")
    firmware.add_argument("--workspace", type=Path, default=Path.cwd())
    firmware.add_argument("--temp", type=Path, required=True)
    release = sub.add_parser("release")
    release.add_argument("--workspace", type=Path, default=Path.cwd())
    release.add_argument("--firmware-dir", type=Path, required=True)
    release.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    if args.command == "firmware":
        build_firmware(workspace, args.temp.resolve())
    else:
        build_release(workspace, args.firmware_dir.resolve(), args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
