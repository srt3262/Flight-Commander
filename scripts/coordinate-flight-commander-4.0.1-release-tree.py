#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

VERSION = "4.0.1"


def replace_required(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Missing expected text in {path}: {old}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--root", default=Path.cwd(), type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    payload = args.payload.resolve()
    metadata = json.loads((payload / "firmware-metadata.json").read_text(encoding="utf-8"))
    if metadata["version"] != VERSION:
        raise SystemExit("Firmware payload is not version 4.0.1")

    hex_file = payload / "Flight-Commander-Firmware-4.0.1-MICOAIR743.hex"
    source_file = payload / "Flight-Commander-Firmware-Source-v4.0.1.zip"
    if hashlib.sha256(hex_file.read_bytes()).hexdigest() != metadata["firmware_sha256"]:
        raise SystemExit("Firmware payload hash mismatch")
    if hashlib.sha256(source_file.read_bytes()).hexdigest() != metadata["source_sha256"]:
        raise SystemExit("Firmware source payload hash mismatch")

    package_path = root / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    package["flightCommander"].update(
        {
            "firmwareMajor": 4,
            "firmwareReleaseVersion": VERSION,
            "firmwareReleaseSha256": metadata["firmware_sha256"],
            "firmwareChangedInRelease": True,
            "firmwareSourceAvailable": True,
            "firmwareSourceVersion": VERSION,
            "firmwareSourceArchive": "release/firmware/Flight-Commander-Firmware-Source-v4.0.1.zip",
            "firmwareSourceSha256": metadata["source_sha256"],
            "firmwareSourceRevision": metadata["source_revision"],
            "firmwareSourceTree": metadata["source_tree"],
        }
    )
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    replace_required(root / "js/main/ntripClient.js", "NTRIP FlightCommander/4.0.0", "NTRIP FlightCommander/4.0.1")
    replace_required(root / "tabs/landing.html", "Flight Commander 4.0.0", "Flight Commander 4.0.1")

    contract = root / "tests/flight-commander/packaging/package-contract.test.mjs"
    contract_text = contract.read_text(encoding="utf-8")
    replacements = {
        "release-4.0.0-orchestrator.yml": "release-4.0.1-orchestrator.yml",
        'assert.equal(packageManifest.flightCommander.firmwareReleaseVersion, "4.0.0");': 'assert.equal(packageManifest.flightCommander.firmwareReleaseVersion, "4.0.1");',
        'assert.equal(packageManifest.flightCommander.firmwareSourceVersion, "4.0.0");': 'assert.equal(packageManifest.flightCommander.firmwareSourceVersion, "4.0.1");',
        '"release/firmware/Flight-Commander-Firmware-Source-v4.0.0.zip",': '"release/firmware/Flight-Commander-Firmware-Source-v4.0.1.zip",',
        'assert.equal(packageManifest.version, "4.0.0");': 'assert.equal(packageManifest.version, "4.0.1");',
        "/Publish Flight Commander 4\\.0\\.0 release/": "/Publish Flight Commander 4\\.0\\.1 release/",
    }
    for old, new in replacements.items():
        if old not in contract_text:
            raise SystemExit(f"Missing package contract text: {old}")
        contract_text = contract_text.replace(old, new)
    contract.write_text(contract_text, encoding="utf-8")

    onboard = root / "tests/flight-commander/firmware/onboard-ist8310-transform-4.0.1.test.mjs"
    onboard.write_text(
        """import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = mkdtempSync(join(tmpdir(), 'flight-commander-4.0.1-compass-'));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const archive = join(projectRoot, 'release/firmware/Flight-Commander-Firmware-Source-v4.0.1.zip');
const result = spawnSync(python, ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, output], { encoding: 'utf8' });
assert.equal(result.status, 0, `4.0.1 source extraction failed:\n${result.stdout}\n${result.stderr}`);
const driver = readFileSync(join(output, 'Flight-Commander-Firmware-Source-v4.0.1', 'src/main/drivers/compass/compass_ist8310.c'), 'utf8');
const guarded = driver.split('#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)', 2)[1].split('#endif', 1)[0];
after(() => rmSync(output, { recursive: true, force: true }));

test('4.0.1 restores the accepted MICOAIR743 onboard IST8310 signed permutation', () => {
  assert.match(guarded, /if \\(mag->magSensorToUse == 0\\)/);
  assert.match(guarded, /mag->magADCRaw\\[X\\] = -nativeY \\* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\\[Y\\] = -nativeX \\* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\\[Z\\] =  nativeZ \\* IST8310_LSB_TO_MILLIGAUSS;/);
});

test('4.0.1 no longer gates the onboard transform on mutable bus identity fields', () => {
  assert.doesNotMatch(guarded, /busType ==|i2cBus ==|address ==/);
});

test('external tagged IST8310 devices retain the generic conversion path', () => {
  const generic = driver.split('#endif', 2)[1];
  assert.match(generic, /mag->magADCRaw\\[X\\] =  nativeX \\* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\\[Y\\] = -nativeY \\* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\\[Z\\] =  nativeZ \\* IST8310_LSB_TO_MILLIGAUSS;/);
});
""",
        encoding="utf-8",
    )

    build = root / ".github/workflows/build-flight-commander-4.0.1-compass-fix.yml"
    build_text = build.read_text(encoding="utf-8")
    baseline = """          $baselineArchive = Join-Path $env:RUNNER_TEMP 'Flight-Commander-Firmware-Source-v4.0.0.zip'\n          Copy-Item -LiteralPath (Join-Path $PWD 'release/firmware/Flight-Commander-Firmware-Source-v4.0.0.zip') -Destination $baselineArchive -Force\n          \"FLIGHT_COMMANDER_400_SOURCE_ARCHIVE=$baselineArchive\" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8\n\n"""
    if baseline not in build_text:
        raise SystemExit("Baseline handoff block missing from build workflow")
    build.write_text(build_text.replace(baseline, ""), encoding="utf-8")

    release_dir = root / "release/firmware"
    for item in release_dir.iterdir():
        if item.is_file():
            item.unlink()
    shutil.copy2(hex_file, release_dir / hex_file.name)
    shutil.copy2(source_file, release_dir / source_file.name)

    for obsolete in (
        root / ".github/workflows/package-flight-commander-4.0.1-compass-fix-rerun.yml",
        root / ".github/workflows/prepare-flight-commander-4.0.1-release-tree.yml",
        root / ".github/workflows/coordinate-flight-commander-4.0.1-pr.yml",
    ):
        if obsolete.exists():
            obsolete.unlink()


if __name__ == "__main__":
    main()
