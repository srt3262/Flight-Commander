#!/usr/bin/env python3
"""Assemble the coordinated Flight Commander 4.0.8 beta release inputs."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path

VERSION = "4.0.8"
BASE_VERSION = "4.0.7"
TARGET = "MICOAIR743"
SOURCE_DATE_EPOCH = 1786104000


def run(*args: str | Path, cwd: Path | None = None, capture: bool = False) -> str:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout if capture else ""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json" or ".git" in path.parts:
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}\n")
    return records


def source_identities(root: Path) -> tuple[str, str]:
    canonical = "".join(source_records(root)).encode()
    revision = hashlib.sha1(canonical).hexdigest()
    tree = hashlib.sha1(b"flight-commander-source-tree-v1\n" + canonical).hexdigest()
    return revision, tree


def deterministic_zip(root: Path, output: Path) -> None:
    stamp = time.gmtime(SOURCE_DATE_EPOCH)[:6]
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or ".git" in path.parts:
                continue
            relative = Path(root.name) / path.relative_to(root)
            info = zipfile.ZipInfo(relative.as_posix(), stamp)
            info.create_system = 3
            mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), zipfile.ZIP_DEFLATED, compresslevel=9)


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def overlay_reviewed_firmware(workspace: Path, source_root: Path) -> None:
    overlay = workspace / "dev/firmware-4.0.7-source"
    if not overlay.is_dir():
        raise RuntimeError("The reviewed 4.0.8 firmware overlay is missing")
    for source in sorted(overlay.rglob("*")):
        if not source.is_file():
            continue
        destination = source_root / source.relative_to(overlay)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    cmake = source_root / "CMakeLists.txt"
    replace_once(
        cmake,
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.7)",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.8)",
        "firmware CMake identity",
    )


def preliminary_manifest(source_root: Path) -> tuple[str, str]:
    revision, tree = source_identities(source_root)
    manifest_path = source_root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({
        "schema": 1,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "target": TARGET,
        "source_revision": revision,
        "source_tree": tree,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "capabilities": "0x0000ffff",
        "capability_mask": "0x0000ffff",
        "artifact": {
            "filename": f"Flight-Commander-Firmware-{VERSION}-{TARGET}.hex",
            "sha256": "0" * 64,
            "bytes": 0,
        },
    })
    manifest["bench_acceptance"] = {
        "workflow": "select one enabled compass, complete its six-side learned orientation, then calibrate only that source's field offsets and gains",
        "source_isolation": "onboard, external I2C/UART GPS-module and DroneCAN GPS-module compasses retain independent transforms and field calibrations",
        "fusion_gate": "a magnetic source remains unavailable to heading fusion until both its own learned transform and field calibration are valid",
        "propeller_requirement": "propellers removed for all calibration and bench verification",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return revision, tree


def generate_patch(source_root: Path, patch_path: Path) -> str:
    patch = run(
        "git", "diff", "--binary", "--full-index", "HEAD", "--", ".",
        cwd=source_root,
        capture=True,
    )
    if not patch.strip():
        raise RuntimeError("The 4.0.8 firmware patch is empty")
    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_text(patch, encoding="utf-8")
    return sha256(patch_path)


def generate_reproducible_builder(
    workspace: Path,
    base_source_sha: str,
    patch_sha: str,
) -> None:
    template = (workspace / "scripts/build-flight-commander-4.0.7-firmware.py").read_text(encoding="utf-8")
    replacements = {
        '"""Build and retain the Flight Commander 4.0.7 MICOAIR743 IMU hotfix."""':
            '"""Build and retain the Flight Commander 4.0.8 source-selective compass beta."""',
        'VERSION = "4.0.7"': 'VERSION = "4.0.8"',
        'BASE_VERSION = "4.0.6"': 'BASE_VERSION = "4.0.7"',
        'SOURCE_DATE_EPOCH = 1786068000': f'SOURCE_DATE_EPOCH = {SOURCE_DATE_EPOCH}',
        'BASE_SOURCE_SHA256 = "fc305751a9bddb7879c7cc2e1cdd13aaf88d1ccc8684b43aca3ae9f49283f813"':
            f'BASE_SOURCE_SHA256 = "{base_source_sha}"',
        'PATCH_SHA256 = "1f0c23edf543190ba7124c330d628874298006dade1e28057ecc95a9d5520529"':
            f'PATCH_SHA256 = "{patch_sha}"',
        '"capabilities": "0x00007fff",': '"capabilities": "0x0000ffff",\n        "capability_mask": "0x0000ffff",',
        'Generated 4.0.7 firmware source archive failed integrity testing':
            'Generated 4.0.8 firmware source archive failed integrity testing',
    }
    for old, new in replacements.items():
        if old not in template:
            raise RuntimeError(f"Builder template marker missing: {old}")
        template = template.replace(old, new, 1)
    output = workspace / "scripts/build-flight-commander-4.0.8-firmware.py"
    output.write_text(template, encoding="utf-8")
    output.chmod(0o755)


def remove_airspeed_overlay(workspace: Path) -> None:
    hud = workspace / "tabs/flight_hud-v1.3.5.js"
    text = hud.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\n    if \(!compact && Number\.isFinite\(state\.airSpeed\)\) \{.*?\n    \}\n",
        re.S,
    )
    text, count = pattern.subn("\n", text, count=1)
    if count != 1:
        raise RuntimeError("Ground Control airspeed overlay block was not found")
    hud.write_text(text, encoding="utf-8")

    test_path = workspace / "tests/flight-commander/gcs/ground-control-hud.test.mjs"
    replace_once(
        test_path,
        '  assert.ok(labels.some((value) => value.startsWith("AS 26.8 mph")));\n',
        '  assert.equal(labels.some((value) => value.startsWith("AS ")), false);\n',
        "ground-speed-only HUD regression",
    )


def update_catalog_test(workspace: Path) -> None:
    path = workspace / "tests/flight-commander/firmware/flight-commander-catalog.test.mjs"
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        '    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.7"), true);\n',
        '    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.7"), true);\n'
        '    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.8"), true);\n',
        1,
    )
    old = '''  test("uses standalone GitHub HEX assets for the current release and verified recovery baseline", () => {
    const filename = "Flight-Commander-Firmware-4.0.7-MICOAIR743.hex";
    const online = flightCommanderReleaseDescriptors([
      {
        draft: false,
        prerelease: false,
        tag_name: "v4.0.7",
'''
    new = '''  test("uses standalone GitHub HEX assets for the current release and verified recovery baseline", () => {
    const filename = "Flight-Commander-Firmware-4.0.8-MICOAIR743.hex";
    const online = flightCommanderReleaseDescriptors([
      {
        draft: false,
        prerelease: true,
        tag_name: "v4.0.8-beta",
'''
    if old not in text:
        raise RuntimeError("Current catalog-release fixture was not found")
    text = text.replace(old, new, 1)
    text = text.replace(
        '    assert.deepEqual(online.map(({ version }) => version), ["4.0.7", "3.0.7"]);',
        '    assert.deepEqual(online.map(({ version }) => version), ["4.0.8", "3.0.7"]);',
        1,
    )
    text = text.replace(
        'test("keeps 3.0.7 and 4.0.7 while removing every verified-bad intervening release", () => {',
        'test("keeps 3.0.7, 4.0.7 and 4.0.8 while removing every verified-bad intervening release", () => {',
        1,
    )
    text = text.replace(
        '    releaseFor("4.0.7", "b"),\n  ]);\n  assert.deepEqual(descriptors.map(({ version }) => version), ["4.0.7", "3.0.7"]);',
        '    releaseFor("4.0.7", "b"),\n'
        '    releaseFor("4.0.8", "c"),\n'
        '  ]);\n'
        '  assert.deepEqual(descriptors.map(({ version }) => version), ["4.0.8", "4.0.7", "3.0.7"]);',
        1,
    )
    path.write_text(text, encoding="utf-8")


def update_release_text(workspace: Path, metadata: dict[str, object]) -> None:
    firmware = metadata["firmware"]
    source = metadata["source"]
    notes = f'''# Flight Commander 4.0.8 Beta

Flight Commander 4.0.8 coordinates the Configurator and MICOAIR743 firmware around independently selectable compass calibration.

## Individual magnetic-source workflow

The Calibration tab now contains one **Compass to calibrate** dropdown populated only from enabled, detected magnetic sources. The selected source controls both stages below it:

1. **Six-side orientation/alignment learning** identifies the selected compass axis order and signs relative to the calibrated flight-controller frame.
2. **Offset/gain calibration** collects field samples and writes calibration values only for that same selected compass.

The onboard IST8310, external I2C/UART GPS-module compass and selected DroneCAN GPS-module compass each retain their own persistent transform, generation, offsets, gains and applicable manual roll/pitch/yaw alignment. Starting, clearing or repeating one source never overwrites another source.

Firmware advertises the new individual-calibration capability explicitly. The 4.0.8 Configurator fails closed on older firmware instead of presenting external-source isolation that the firmware cannot enforce.

## Fusion safety

A magnetic source cannot enter weighted heading fusion or report field calibration complete until its own six-side transform and its own field calibration are both valid. DroneCAN calibration remains bound to the selected CAN node.

## Ground Control HUD

The artificial-horizon speed tape now shows ground speed only. The separate airspeed overlay has been removed so the HUD does not present two competing speed indications.

## Retained 4.0.7 baseline

The 4.0.7 IMU handedness correction, correct left/right six-face labels, verified MICOAIR743 BMI088 `CW270_DEG` target alignment, stationary heading behavior, RTK support and moving-baseline yaw remain intact.

## Automated validation inputs

- Firmware: `{firmware['name']}`
- Firmware SHA-256: `{firmware['sha256']}`
- Firmware size: `{firmware['bytes']}` bytes
- Firmware source: `{source['name']}`
- Firmware source SHA-256: `{source['sha256']}`
- Firmware source revision: `{source['revision']}`
- Firmware source tree: `{source['tree']}`
- Compiler: Arm GNU Toolchain 13.2.1

## Propeller-off beta acceptance

Before any armed or flight test, remove the propellers and verify each enabled compass separately:

- Select the source in the Calibration dropdown.
- Complete all six orientation positions and confirm a persistent transform is stored for that source.
- Run its offset/gain calibration and confirm only that source changes.
- Switch among all enabled sources and confirm previously stored transforms and gains remain intact.
- Reboot and confirm every completed source remains calibrated and heading fusion accepts only fully calibrated sources.
- Confirm the Ground Control HUD shows `GS` and no separate `AS` overlay.

After this beta passes the required hardware testing, the same validated 4.0.8 commit and artifact set can be promoted to the official 4.0.8 release without rebuilding different binaries.

## Deliverables

The complete `Flight-Commander-v4.0.8.zip` contains exactly four files:

1. `FC-Windows-v4.0.8.zip`
2. `FC-Configurator-Source-v4.0.8.zip`
3. `FC-Firmware-v4.0.8-MICOAIR743.hex`
4. `FC-Firmware-Source-v4.0.8.zip`
'''
    notes_path = workspace / "release/notes/v4.0.8-beta.md"
    notes_path.parent.mkdir(parents=True, exist_ok=True)
    notes_path.write_text(notes, encoding="utf-8")

    changelog = workspace / "CHANGELOG.md"
    text = changelog.read_text(encoding="utf-8")
    section = '''## 4.0.8

- Add one compass-source dropdown populated only by enabled, detected onboard, external I2C/UART GPS-module and DroneCAN magnetic sources.
- Generalize persistent six-side axis/sign learning so every magnetic source owns an independent transform and calibration generation.
- Start, clear and repeat orientation learning for only the selected compass without changing another source.
- Calibrate offsets and gains for only the selected compass through a new source-selective MSPv2 command and explicit firmware capability.
- Keep per-source manual roll, pitch and yaw alignment independent and apply it after the learned transform and field correction.
- Block a magnetic source from heading fusion until both its own transform and field calibration are valid.
- Remove the separate airspeed overlay from Ground Control so the HUD uses ground speed only.
- Publish as a coordinated Configurator and MICOAIR743 firmware beta for propeller-off acceptance before official 4.0.8 promotion.

'''
    marker = "# Flight Commander 4.0.0\n\n"
    if marker not in text:
        raise RuntimeError("Changelog release marker is missing")
    changelog.write_text(text.replace(marker, marker + section, 1), encoding="utf-8")

    landing = workspace / "tabs/landing.html"
    landing_text = landing.read_text(encoding="utf-8")
    pattern = re.compile(
        r'<h2>Flight Commander 4\.0\.7</h2>.*?(?=<h2 style="margin-top: 1em">Open-source foundations</h2>)',
        re.S,
    )
    replacement = '''<h2>Flight Commander 4.0.8</h2>
          <p>
            Flight Commander 4.0.8 Beta lets you select each enabled and detected
            compass individually, learn its six-side orientation and alignment,
            then calibrate only that source's offsets and gains.
          </p>
          <p>
            Onboard, external I2C/UART GPS-module and DroneCAN compasses retain
            independent persistent transforms, manual alignment and field
            calibration. A source cannot enter heading fusion until its own two
            calibration stages are valid.
          </p>
          <p>
            Ground Control now uses ground speed as the only HUD speed indication.
            The verified 4.0.7 IMU handedness and compass baseline remain intact.
          </p>
          <p>
            This build is a beta for propeller-off hardware acceptance. Successful
            testing will promote the same validated 4.0.8 artifacts to the official
            release without rebuilding different binaries.
          </p>
          '''
    landing_text, count = pattern.subn(replacement, landing_text, count=1)
    if count != 1:
        raise RuntimeError("Landing-page 4.0.7 section was not found")
    landing.write_text(landing_text, encoding="utf-8")


def update_repository_metadata(workspace: Path, metadata: dict[str, object]) -> None:
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
        "firmwareSourceArchive": f"release/firmware/{metadata['source']['name']}",
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

    ntrip = workspace / "js/main/ntripClient.js"
    ntrip.write_text(ntrip.read_text(encoding="utf-8").replace("4.0.7", VERSION), encoding="utf-8")

    package_contract = workspace / "tests/flight-commander/packaging/package-contract.test.mjs"
    package_contract.write_text(
        package_contract.read_text(encoding="utf-8").replace("4.0.7", VERSION),
        encoding="utf-8",
    )
    export_test = workspace / "tests/flight-commander/firmware/export-calibration-source.test.mjs"
    export_test.write_text(
        export_test.read_text(encoding="utf-8").replace("4.0.7", VERSION),
        encoding="utf-8",
    )


def assemble(workspace: Path, work: Path) -> dict[str, object]:
    package = json.loads((workspace / "package.json").read_text(encoding="utf-8"))
    base_source_sha = package["flightCommander"]["firmwareSourceSha256"]
    base_archive = workspace / f"release/firmware/Flight-Commander-Firmware-Source-v{BASE_VERSION}.zip"
    if sha256(base_archive) != base_source_sha:
        raise RuntimeError("The retained 4.0.7 source archive does not match package.json")

    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    extracted = work / "extracted"
    with zipfile.ZipFile(base_archive) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("The retained 4.0.7 source archive is corrupt")
        archive.extractall(extracted)
    base_root = extracted / f"Flight-Commander-Firmware-Source-v{BASE_VERSION}"
    source_root = work / f"Flight-Commander-Firmware-Source-v{VERSION}"
    shutil.copytree(base_root, source_root)

    run("git", "init", cwd=source_root)
    run("git", "config", "user.name", "Flight Commander Release Builder", cwd=source_root)
    run("git", "config", "user.email", "release-builder@flight-commander.invalid", cwd=source_root)
    run("git", "add", "-A", cwd=source_root)
    run("git", "commit", "-m", f"Flight Commander {BASE_VERSION} retained source", cwd=source_root)

    overlay_reviewed_firmware(workspace, source_root)
    revision, tree = preliminary_manifest(source_root)
    patch_path = workspace / f"release/firmware-patches/{VERSION}.patch"
    patch_sha = generate_patch(source_root, patch_path)
    shutil.rmtree(source_root / ".git", ignore_errors=True)

    build_dir = work / "build"
    run("bash", source_root / "flight-commander/build-micoair743.sh", build_dir)
    built_hex = build_dir / f"Flight-Commander-Firmware-{VERSION}-{TARGET}.hex"
    if not built_hex.is_file() or built_hex.stat().st_size <= 1024 * 1024:
        raise RuntimeError("The expected 4.0.8 MICOAIR743 HEX was not produced")

    manifest_path = source_root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifact"] = {
        "filename": built_hex.name,
        "sha256": sha256(built_hex),
        "bytes": built_hex.stat().st_size,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    run(
        sys.executable,
        source_root / "flight-commander/verify-release.py",
        "--source-root", source_root,
        "--hex", built_hex,
        "--manifest", manifest_path,
    )

    firmware_dir = workspace / "release/firmware"
    firmware_output = firmware_dir / built_hex.name
    source_output = firmware_dir / f"Flight-Commander-Firmware-Source-v{VERSION}.zip"
    shutil.copy2(built_hex, firmware_output)
    deterministic_zip(source_root, source_output)
    with zipfile.ZipFile(source_output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("The generated 4.0.8 source archive is corrupt")

    metadata: dict[str, object] = {
        "version": VERSION,
        "target": TARGET,
        "patch": {"name": patch_path.name, "sha256": patch_sha},
        "firmware": {
            "name": firmware_output.name,
            "sha256": sha256(firmware_output),
            "bytes": firmware_output.stat().st_size,
        },
        "source": {
            "name": source_output.name,
            "sha256": sha256(source_output),
            "bytes": source_output.stat().st_size,
            "revision": revision,
            "tree": tree,
            "date_epoch": SOURCE_DATE_EPOCH,
        },
    }
    generate_reproducible_builder(workspace, base_source_sha, patch_sha)
    remove_airspeed_overlay(workspace)
    update_repository_metadata(workspace, metadata)
    update_catalog_test(workspace)
    update_release_text(workspace, metadata)
    (workspace / "release/firmware/build-metadata-4.0.8.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, indent=2))
    return metadata


def main() -> int:
    workspace = Path.cwd().resolve()
    work = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("/tmp/flight-commander-4.0.8-build")
    assemble(workspace, work)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
