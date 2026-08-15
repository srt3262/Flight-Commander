#!/usr/bin/env python3
"""Build and package the additive Flight Commander 4.3.1 H7 target assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.3.1"
RELEASE_TAG = f"v{VERSION}"
TARGET_MANIFEST = ROOT / "flight-commander" / "official-targets.txt"
LEGACY_RELEASE_MANIFEST = ROOT / "RELEASE-MANIFEST.json"
LEGACY_TARGETS = ("MICOAIR743", "CUBEORANGEPLUS")
MINIMUM_HEX_BYTES = 1024 * 1024


def run(
    *args: str | Path,
    cwd: Path = ROOT,
    environment: dict[str, str] | None = None,
) -> None:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=environment, check=True)


def output(*args: str | Path, cwd: Path = ROOT) -> str:
    return subprocess.check_output(
        [str(value) for value in args], cwd=cwd, text=True
    ).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_targets() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for line_number, raw_line in enumerate(
        TARGET_MANIFEST.read_text(encoding="utf-8").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 3:
            raise RuntimeError(f"Malformed target manifest line {line_number}")
        target, mcu, dronecan = fields
        if target in seen:
            raise RuntimeError(f"Duplicate official target: {target}")
        if mcu not in {"STM32H743XI", "STM32H757XI"}:
            raise RuntimeError(f"Unsupported MCU for {target}: {mcu}")
        if dronecan != "NONE" and dronecan != "TARGET" and not re.fullmatch(
            r"P[A-K][0-9]{1,2},P[A-K][0-9]{1,2}", dronecan
        ):
            raise RuntimeError(f"Invalid DroneCAN mapping for {target}: {dronecan}")
        seen.add(target)
        records.append({"target": target, "mcu": mcu, "dronecan": dronecan})
    if len(records) != 50:
        raise RuntimeError(f"Expected 50 official targets, found {len(records)}")
    if not set(LEGACY_TARGETS).issubset(seen):
        raise RuntimeError("The protected legacy targets are missing")
    return records


def read_legacy_manifest() -> dict[str, object]:
    manifest = json.loads(LEGACY_RELEASE_MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("version") != VERSION:
        raise RuntimeError("The protected release manifest is not Flight Commander 4.3.1")
    if manifest.get("targets") != list(LEGACY_TARGETS):
        raise RuntimeError("The protected release target order changed")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise RuntimeError("The protected release artifact records are missing")
    for target in LEGACY_TARGETS:
        record = artifacts.get(target)
        expected_name = f"Flight-Commander-Firmware-{VERSION}-{target}.hex"
        if not isinstance(record, dict) or record.get("filename") != expected_name:
            raise RuntimeError(f"The protected {target} artifact record changed")
        if not re.fullmatch(r"[0-9a-f]{64}", str(record.get("sha256", ""))):
            raise RuntimeError(f"The protected {target} SHA-256 is invalid")
    return manifest


def require_toolchain() -> None:
    for command in ("cmake", "ninja", "arm-none-eabi-gcc", "python3"):
        if shutil.which(command) is None:
            raise RuntimeError(f"Required build command is unavailable: {command}")
    compiler = output("arm-none-eabi-gcc", "-dumpfullversion", "-dumpversion")
    if compiler != "13.2.1":
        raise RuntimeError(f"Arm GNU Toolchain 13.2.1 is required; found {compiler}")


def require_revision(value: str | None) -> str:
    revision = value or output("git", "rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RuntimeError("A full 40-character source Git revision is required")
    return revision


def require_source_date_epoch(value: int | None, revision: str) -> int:
    epoch = value
    if epoch is None:
        epoch = int(output("git", "show", "-s", "--format=%ct", revision))
    if epoch <= 0:
        raise RuntimeError("A positive source date epoch is required")
    return epoch


def configure_and_build(
    build_dir: Path,
    targets: list[str],
    revision: str,
    source_date_epoch: int,
) -> None:
    if build_dir.exists():
        raise RuntimeError(f"Build directory already exists: {build_dir}")
    build_dir.parent.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["SOURCE_DATE_EPOCH"] = str(source_date_epoch)
    configure = [
        "cmake",
        "-S",
        ROOT,
        "-B",
        build_dir,
        "-G",
        "Ninja",
        "-DCMAKE_BUILD_TYPE=Release",
        "-DWARNINGS_AS_ERRORS=ON",
        f"-DFLIGHT_COMMANDER_SOURCE_REVISION={revision}",
    ]
    ruby = environment.get("RUBY_EXECUTABLE")
    if ruby:
        configure.append(f"-DRUBY_EXECUTABLE={ruby}")
    run(*configure, environment=environment)
    run(
        "cmake",
        "--build",
        build_dir,
        "--parallel",
        "--target",
        *targets,
        environment=environment,
    )


def verify_hex(path: Path) -> None:
    if not path.is_file() or path.stat().st_size <= MINIMUM_HEX_BYTES:
        raise RuntimeError(f"Expected release HEX is missing or undersized: {path}")
    run(sys.executable, ROOT / "flight-commander" / "verify-compass-release.py", path)


def verify_legacy_targets(
    build_dir: Path,
    legacy_manifest: dict[str, object],
    reuse_existing_builds: bool,
) -> dict[str, dict[str, object]]:
    source_revision = str(legacy_manifest["source_revision"])
    source_date_epoch = int(legacy_manifest["source_date_epoch"])
    if not reuse_existing_builds:
        configure_and_build(
            build_dir,
            list(LEGACY_TARGETS),
            source_revision,
            source_date_epoch,
        )
    verified: dict[str, dict[str, object]] = {}
    for target in LEGACY_TARGETS:
        path = build_dir / f"Flight-Commander-Firmware-{VERSION}-{target}.hex"
        verify_hex(path)
        expected = dict(legacy_manifest["artifacts"][target])
        actual_digest = sha256(path)
        if (
            actual_digest != expected["sha256"]
            or path.stat().st_size != expected["bytes"]
        ):
            raise RuntimeError(
                f"{target} regression failed: the expansion changed the published image"
            )
        print(f"Protected {target} unchanged: SHA-256 {actual_digest}")
        verified[target] = expected
    return verified


def package(
    output_dir: Path,
    build_dir: Path,
    regression_build_dir: Path,
    revision: str,
    source_date_epoch: int,
    reuse_existing_builds: bool,
) -> dict[str, object]:
    records = read_targets()
    legacy_manifest = read_legacy_manifest()
    additive_records = [
        record for record in records if record["target"] not in LEGACY_TARGETS
    ]
    if len(additive_records) != 48:
        raise RuntimeError(
            f"Expected 48 additive release targets, found {len(additive_records)}"
        )
    additive_targets = [record["target"] for record in additive_records]

    if output_dir.exists():
        raise RuntimeError(f"Output directory already exists: {output_dir}")
    if not reuse_existing_builds:
        configure_and_build(
            build_dir,
            additive_targets,
            revision,
            source_date_epoch,
        )
    protected_artifacts = verify_legacy_targets(
        regression_build_dir, legacy_manifest, reuse_existing_builds
    )

    output_dir.mkdir(parents=True)
    artifact_records: dict[str, dict[str, object]] = {}
    checksum_lines: list[str] = []
    for target_record in additive_records:
        target = target_record["target"]
        filename = f"Flight-Commander-Firmware-{VERSION}-{target}.hex"
        built_hex = build_dir / filename
        verify_hex(built_hex)
        packaged_hex = output_dir / filename
        shutil.copy2(built_hex, packaged_hex)
        digest = sha256(packaged_hex)
        artifact_records[target] = {
            "filename": filename,
            "sha256": digest,
            "bytes": packaged_hex.stat().st_size,
            "mcu": target_record["mcu"],
            "dronecan": target_record["dronecan"] != "NONE",
            "capability_mask": (
                "0x0000decf"
                if target_record["dronecan"] == "NONE"
                else "0x0001ffff"
            ),
        }
        checksum_lines.append(f"{digest}  {filename}\n")

    forbidden = {
        f"Flight-Commander-Firmware-{VERSION}-{target}.hex"
        for target in LEGACY_TARGETS
    }
    packaged_names = {path.name for path in output_dir.iterdir()}
    if forbidden & packaged_names:
        raise RuntimeError("The additive package contains a protected legacy asset")

    metadata: dict[str, object] = {
        "schema": 1,
        "product": "Flight Commander Firmware H7 target expansion",
        "version": VERSION,
        "release_tag": RELEASE_TAG,
        "source_revision": revision,
        "source_date_epoch": source_date_epoch,
        "targets": additive_targets,
        "excluded_existing_targets": list(LEGACY_TARGETS),
        "protected_existing_artifacts": protected_artifacts,
        "artifacts": artifact_records,
    }
    (output_dir / "h7-target-release-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "SHA256SUMS-H7-TARGETS.txt").write_text(
        "".join(checksum_lines), encoding="ascii"
    )
    print(json.dumps(metadata, indent=2))
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--regression-build-dir", type=Path)
    parser.add_argument("--source-revision")
    parser.add_argument("--source-date-epoch", type=int)
    parser.add_argument("--reuse-existing-builds", action="store_true")
    args = parser.parse_args()

    require_toolchain()
    revision = require_revision(args.source_revision)
    source_date_epoch = require_source_date_epoch(args.source_date_epoch, revision)
    if not args.reuse_existing_builds:
        status = output("git", "status", "--porcelain", "--untracked-files=all")
        if status:
            raise RuntimeError("Refusing an official target build from a dirty worktree")

    build_dir = (
        args.build_dir
        or Path(tempfile.mkdtemp(prefix="flight-commander-h7-parent-")) / "build"
    ).resolve()
    regression_build_dir = (
        args.regression_build_dir
        or Path(tempfile.mkdtemp(prefix="flight-commander-mico-parent-")) / "build"
    ).resolve()
    package(
        args.output.resolve(),
        build_dir,
        regression_build_dir,
        revision,
        source_date_epoch,
        args.reuse_existing_builds,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"H7 target packaging failed: {error}", file=sys.stderr)
        raise SystemExit(1)
