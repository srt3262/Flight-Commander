#!/usr/bin/env python3
"""Integrate the coordinated Flight Commander 4.0.3 beta artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.0.3"
BETA_WORKFLOW = ".github/workflows/publish-flight-commander-beta.yml"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write_text(relative: str, value: str) -> None:
    (ROOT / relative).write_text(value, encoding="utf-8", newline="\n")


def replace_once(relative: str, old: str, new: str) -> None:
    text = read_text(relative)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one occurrence of {old!r}, found {count}"
        )
    write_text(relative, text.replace(old, new, 1))


def source_manifest(source_zip: Path) -> dict:
    expected_suffix = (
        f"Flight-Commander-Firmware-Source-v{VERSION}/RELEASE-MANIFEST.json"
    )
    with zipfile.ZipFile(source_zip) as archive:
        matches = [
            name for name in archive.namelist()
            if name.endswith(expected_suffix)
        ]
        if len(matches) != 1:
            raise RuntimeError(
                f"{source_zip}: expected one {expected_suffix}, found {len(matches)}"
            )
        return json.loads(archive.read(matches[0]).decode("utf-8"))


def update_package(firmware: Path, source_zip: Path, source: dict) -> None:
    path = ROOT / "package.json"
    package = json.loads(path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    flight_commander = package["flightCommander"]
    flight_commander.update(
        {
            "firmwareReleaseVersion": VERSION,
            "firmwareReleaseSha256": sha256(firmware),
            "firmwareChangedInRelease": True,
            "firmwareSourceAvailable": True,
            "firmwareSourceVersion": VERSION,
            "firmwareSourceArchive": (
                f"release/firmware/Flight-Commander-Firmware-Source-v{VERSION}.zip"
            ),
            "firmwareSourceSha256": sha256(source_zip),
            "firmwareSourceRevision": source["source_revision"],
            "firmwareSourceTree": source["source_tree"],
        }
    )
    path.write_text(
        json.dumps(package, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def update_chrome_manifest() -> None:
    path = ROOT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def update_landing_page() -> None:
    replace_once(
        "tabs/landing.html",
        "<h2>Flight Commander 4.0.2</h2>",
        "<h2>Flight Commander 4.0.3</h2>",
    )
    replace_once(
        "tabs/landing.html",
        "Flight Commander 4.0.2 Beta ships coordinated Configurator and firmware",
        "Flight Commander 4.0.3 Beta ships coordinated Configurator and firmware",
    )
    replace_once(
        "tabs/landing.html",
        """            Firmware 4.0.2 enforces that target-owned alignment at every boot,
            rejects calibration data stamped for a different transform revision,
            and prevents restored legacy settings from silently reintroducing the
            wrong board orientation. The Configurator now validates locally stored
            Flight Commander firmware by Intel HEX content, embedded FCFW identity,
            and target compatibility instead of requiring a particular filename.
""",
        """            Firmware 4.0.3 permanently separates the fixed onboard
            chip-to-board transform from the saved user alignment. The Alignment
            tab now starts at CW 0 degrees after reset or migration, preserves any
            manually selected onboard alignment or custom angles across reboot,
            and never changes the driver's physical sensor transform. Changing the
            saved alignment deliberately invalidates the previous calibration
            signature, so calibration is performed in the same coordinate system
            that will be used for heading. Local Flight Commander firmware remains
            validated by Intel HEX content, embedded FCFW identity, and target
            compatibility instead of requiring a particular filename.
""",
    )


def update_versioned_text() -> None:
    replace_once(
        "js/main/ntripClient.js",
        "User-Agent: NTRIP FlightCommander/4.0.2",
        "User-Agent: NTRIP FlightCommander/4.0.3",
    )

    relative = "tests/flight-commander/packaging/package-contract.test.mjs"
    text = read_text(relative)
    for old, new in (
        (
            'firmwareReleaseVersion, "4.0.2"',
            'firmwareReleaseVersion, "4.0.3"',
        ),
        (
            'firmwareSourceVersion, "4.0.2"',
            'firmwareSourceVersion, "4.0.3"',
        ),
        (
            '"release/firmware/Flight-Commander-Firmware-Source-v4.0.2.zip"',
            '"release/firmware/Flight-Commander-Firmware-Source-v4.0.3.zip"',
        ),
        (
            'packageManifest.version, "4.0.2"',
            'packageManifest.version, "4.0.3"',
        ),
    ):
        count = text.count(old)
        if count != 1:
            raise RuntimeError(
                f"{relative}: expected one occurrence of {old!r}, found {count}"
            )
        text = text.replace(old, new, 1)
    write_text(relative, text)


def write_release_notes() -> None:
    notes = f"""# Flight Commander {VERSION} Beta

This coordinated beta contains Flight Commander Configurator {VERSION} and
MICOAIR743 firmware {VERSION} for propeller-off bench validation.

## Compass coordinate-system repair

- Keeps the fixed onboard IST8310 driver transform:
  `X = -nativeY`, `Y = -nativeX`, `Z = nativeZ`.
- Restores the Alignment tab as an independent, saved user-adjustment layer.
- Stores `CW0_DEG` as the MICOAIR743 reset and migration default.
- Preserves explicitly selected onboard alignment and custom roll, pitch and yaw
  angles across reboot.
- Removes the 4.0.2 target hook that rewrote `mag_align` and zeroed all custom
  alignment angles on every startup.
- Resolves only the unconfigured `ALIGN_DEFAULT` sentinel to the target's CW0
  default; no explicit user setting is replaced.
- Advances the compass parameter group to version 8 and calibration contract to
  revision 2, requiring one fresh calibration after installation.
- Binds saved calibration to the selected alignment, so changing alignment
  invalidates the old calibration rather than mixing coordinate systems.

The hard-coded driver transform is a physical board property. Alignment-tab
changes are applied later and cannot modify, replace, or bypass that transform.

## Local firmware loading

- Locally stored Flight Commander HEX files continue to be accepted by content
  and embedded firmware identity rather than requiring a release-style filename.
- Online downloads remain protected by release metadata, byte count, SHA-256,
  and target checks.

## Included components

The complete `Flight-Commander-v{VERSION}.zip` contains exactly four
coordinated files:

1. `FC-Windows-v{VERSION}.zip`
2. `FC-Configurator-Source-v{VERSION}.zip`
3. `FC-Firmware-v{VERSION}-MICOAIR743.hex`
4. `FC-Firmware-Source-v{VERSION}.zip`

This is a beta release. Perform the initial firmware flashing, alignment and
compass calibration checks with propellers removed.
"""
    path = ROOT / f"release/notes/v{VERSION}-beta.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(notes, encoding="utf-8", newline="\n")


def verify(firmware: Path, source_zip: Path, source: dict) -> None:
    package = json.loads(read_text("package.json"))
    manifest = json.loads(read_text("manifest.json"))
    assert package["version"] == VERSION
    assert manifest["version"] == VERSION
    assert package["flightCommander"]["firmwareReleaseSha256"] == sha256(firmware)
    assert package["flightCommander"]["firmwareSourceSha256"] == sha256(source_zip)
    assert package["flightCommander"]["firmwareSourceRevision"] == source["source_revision"]
    assert package["flightCommander"]["firmwareSourceTree"] == source["source_tree"]
    assert source["version"] == VERSION
    assert source["artifact"]["sha256"] == sha256(firmware)
    assert source["artifact"]["bytes"] == firmware.stat().st_size
    assert "Flight Commander 4.0.3 Beta ships" in read_text("tabs/landing.html")
    assert "NTRIP FlightCommander/4.0.3" in read_text("js/main/ntripClient.js")
    assert BETA_WORKFLOW in read_text(
        "tests/flight-commander/packaging/package-contract.test.mjs"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--firmware", required=True, type=Path)
    parser.add_argument("--source-zip", required=True, type=Path)
    args = parser.parse_args()

    firmware = args.firmware.resolve()
    source_zip = args.source_zip.resolve()
    expected_firmware = f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex"
    expected_source = f"Flight-Commander-Firmware-Source-v{VERSION}.zip"
    if firmware.name != expected_firmware or not firmware.is_file():
        raise RuntimeError(f"Expected built firmware {expected_firmware}")
    if source_zip.name != expected_source or not source_zip.is_file():
        raise RuntimeError(f"Expected source archive {expected_source}")

    source = source_manifest(source_zip)
    update_package(firmware, source_zip, source)
    update_chrome_manifest()
    update_landing_page()
    update_versioned_text()
    write_release_notes()
    verify(firmware, source_zip, source)
    print(f"Flight Commander {VERSION} coordinated beta metadata: READY")


if __name__ == "__main__":
    main()
