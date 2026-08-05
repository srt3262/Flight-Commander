#!/usr/bin/env python3
"""Apply the coordinated Flight Commander 4.0.2 beta source metadata.

The firmware bytes and retained-source identities used here are produced by the
reviewed 4.0.2 compass-persistence builder.  This script is intentionally
idempotent so the beta publication workflow can be re-run without creating
source drift.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.0.2"
FIRMWARE_SHA256 = "b1b29617fe364643cd46fd3182fdcb03867b497856f91d6b542e2d9d5ecd3b0a"
FIRMWARE_SOURCE_SHA256 = "58d28e2dcb5088842436a8ddce896eee02b44ab0d7c1dba4e5b9f99d7a599a9e"
FIRMWARE_SOURCE_REVISION = "b475dd8b0f6ee479b0c12cded167ff981bcd96e1"
FIRMWARE_SOURCE_TREE = "2b8eb93e461e05bd2648acf1305c96e917899ca4"
BETA_WORKFLOW = ".github/workflows/publish-flight-commander-4.0.2-beta.yml"


def read_text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write_text(relative: str, value: str) -> None:
    (ROOT / relative).write_text(value, encoding="utf-8", newline="\n")


def replace_once_or_already(
    relative: str,
    old: str,
    new: str,
    *,
    expected_old_count: int = 1,
) -> None:
    text = read_text(relative)
    old_count = text.count(old)
    if old_count == 0:
        if new not in text:
            raise RuntimeError(
                f"{relative}: neither the expected old text nor replacement exists: {old!r}"
            )
        return
    if old_count != expected_old_count:
        raise RuntimeError(
            f"{relative}: expected {expected_old_count} occurrences of {old!r}, found {old_count}"
        )
    write_text(relative, text.replace(old, new))


def update_package_manifest() -> None:
    path = ROOT / "package.json"
    package = json.loads(path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    flight_commander = package["flightCommander"]
    flight_commander.update(
        {
            "firmwareReleaseVersion": VERSION,
            "firmwareReleaseSha256": FIRMWARE_SHA256,
            "firmwareChangedInRelease": True,
            "firmwareSourceAvailable": True,
            "firmwareSourceVersion": VERSION,
            "firmwareSourceArchive": (
                f"release/firmware/Flight-Commander-Firmware-Source-v{VERSION}.zip"
            ),
            "firmwareSourceSha256": FIRMWARE_SOURCE_SHA256,
            "firmwareSourceRevision": FIRMWARE_SOURCE_REVISION,
            "firmwareSourceTree": FIRMWARE_SOURCE_TREE,
        }
    )
    path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8", newline="\n")


def update_chrome_manifest() -> None:
    path = ROOT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")


def update_landing_page() -> None:
    relative = "tabs/landing.html"
    text = read_text(relative)
    text = text.replace(
        "<h2>Flight Commander 4.0.1</h2>",
        "<h2>Flight Commander 4.0.2</h2>",
    )
    text = text.replace(
        "Flight Commander 4.0.1 ships coordinated Configurator and firmware",
        "Flight Commander 4.0.2 Beta ships coordinated Configurator and firmware",
    )
    anchor = (
        "Physical testing established the canonical onboard mapping as\n"
        "            X=-nativeY, Y=-nativeX, Z=nativeZ with user alignment CW 0 degrees."
    )
    addition = (
        anchor
        + "\n            Firmware 4.0.2 enforces that target-owned alignment at every boot,\n"
        "            rejects calibration data stamped for a different transform revision,\n"
        "            and prevents restored legacy settings from silently reintroducing the\n"
        "            wrong board orientation. The Configurator now validates locally stored\n"
        "            Flight Commander firmware by Intel HEX content, embedded FCFW identity,\n"
        "            and target compatibility instead of requiring a particular filename."
    )
    if addition not in text:
        if anchor not in text:
            raise RuntimeError(f"{relative}: compass release-note anchor is missing")
        text = text.replace(anchor, addition, 1)
    if "Flight Commander 4.0.1" in text:
        raise RuntimeError(f"{relative}: stale 4.0.1 release text remains")
    write_text(relative, text)


def update_ntrip_identity() -> None:
    replace_once_or_already(
        "js/main/ntripClient.js",
        "User-Agent: NTRIP FlightCommander/4.0.1",
        "User-Agent: NTRIP FlightCommander/4.0.2",
    )


def update_packaging_contract() -> None:
    relative = "tests/flight-commander/packaging/package-contract.test.mjs"
    replacements = (
        (
            '  resolve(projectRoot, ".github/workflows/release-4.0.1-orchestrator.yml"),',
            f'  resolve(projectRoot, "{BETA_WORKFLOW}"),',
        ),
        (
            '  assert.equal(packageManifest.flightCommander.firmwareReleaseVersion, "4.0.1");',
            '  assert.equal(packageManifest.flightCommander.firmwareReleaseVersion, "4.0.2");',
        ),
        (
            '  assert.equal(packageManifest.flightCommander.firmwareSourceVersion, "4.0.1");',
            '  assert.equal(packageManifest.flightCommander.firmwareSourceVersion, "4.0.2");',
        ),
        (
            '    "release/firmware/Flight-Commander-Firmware-Source-v4.0.1.zip",',
            '    "release/firmware/Flight-Commander-Firmware-Source-v4.0.2.zip",',
        ),
        (
            '  assert.equal(packageManifest.version, "4.0.1");',
            '  assert.equal(packageManifest.version, "4.0.2");',
        ),
    )
    for old, new in replacements:
        replace_once_or_already(relative, old, new)

    old_block = """test(\"guarded push publication is tied to the current release version\", () => {
  assert.match(releaseOrchestrator, /Publish Flight Commander 4\\.0\\.1 release/);
  assert.match(releaseOrchestrator, /gh workflow run release\\.yml/);
});"""
    new_block = """test(\"guarded beta publication is tied to the current release version\", () => {
  assert.match(releaseOrchestrator, /Publish Flight Commander 4\\.0\\.2 beta prerelease/);
  assert.match(releaseOrchestrator, /gh release create/);
  assert.match(releaseOrchestrator, /--prerelease/);
});"""
    replace_once_or_already(relative, old_block, new_block)


def verify_result() -> None:
    package = json.loads(read_text("package.json"))
    manifest = json.loads(read_text("manifest.json"))
    assert package["version"] == VERSION
    assert manifest["version"] == VERSION
    assert package["flightCommander"]["firmwareReleaseSha256"] == FIRMWARE_SHA256
    assert package["flightCommander"]["firmwareSourceSha256"] == FIRMWARE_SOURCE_SHA256
    assert package["flightCommander"]["firmwareSourceRevision"] == FIRMWARE_SOURCE_REVISION
    assert package["flightCommander"]["firmwareSourceTree"] == FIRMWARE_SOURCE_TREE
    assert "NTRIP FlightCommander/4.0.2" in read_text("js/main/ntripClient.js")
    assert "Flight Commander 4.0.2 Beta ships" in read_text("tabs/landing.html")
    contract = read_text("tests/flight-commander/packaging/package-contract.test.mjs")
    assert BETA_WORKFLOW in contract
    assert "firmwareReleaseVersion, \"4.0.1\"" not in contract


def main() -> None:
    update_package_manifest()
    update_chrome_manifest()
    update_landing_page()
    update_ntrip_identity()
    update_packaging_contract()
    verify_result()
    print("Flight Commander 4.0.2 beta integration source: READY")


if __name__ == "__main__":
    main()
