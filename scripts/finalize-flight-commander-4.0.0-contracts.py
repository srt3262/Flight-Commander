#!/usr/bin/env python3
"""Finalize source and test contracts for the coordinated 4.0.0 build."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, *, required: bool = True) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old in text:
        target.write_text(text.replace(old, new), encoding="utf-8")
        return
    if new in text:
        return
    if required:
        raise RuntimeError(f"{path}: expected text was not found: {old!r}")


def patch_firmware_builder() -> None:
    path = ROOT / "scripts/prepare-flight-commander-firmware-4.0.0.py"
    text = path.read_text(encoding="utf-8")
    old = '''    if "bool dronecanSendServiceRequest(" not in value:
        value = value.replace("\\n#endif\\n", append + "\\n#endif\\n")
        path.write_text(value, encoding="utf-8")
'''
    new = '''    if "bool dronecanSendServiceRequest(" not in value:
        marker = "\\n#endif\\n"
        insertion = value.rfind(marker)
        if insertion < 0:
            raise RuntimeError("dronecan.c has no final preprocessor terminator")
        value = value[:insertion] + append + value[insertion:]
        path.write_text(value, encoding="utf-8")
'''
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("Unable to patch final dronecan.c insertion logic")

    old = '''#include "drivers/dronecan/libcanard/canard.h"

#define DRONECAN_PAIR_STATUS_SCHEMA 1
'''
    new = '''#include "drivers/dronecan/libcanard/canard.h"

struct ardupilot_gnss_RelPosHeading;

#define DRONECAN_PAIR_STATUS_SCHEMA 1
'''
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("Unable to add RelPosHeading forward declaration")
    path.write_text(text, encoding="utf-8")


def patch_tests() -> None:
    replace(
        "tests/flight-commander/firmware/heading-fusion.test.mjs",
        "const enabledCan = { gpsNodeId: 42, magNodeId: 73 };",
        "const enabledCan = { gpsNodeId: 42, movingRoverNodeId: 42, magNodeId: 73 };",
    )
    replace(
        "tests/flight-commander/firmware/heading-fusion.test.mjs",
        "/DroneCAN GNSS node/",
        "/moving-rover node/",
    )

    package_test = ROOT / "tests/flight-commander/packaging/package-contract.test.mjs"
    text = package_test.read_text(encoding="utf-8")
    text = text.replace(
        '.github/workflows/release-3.0.7-orchestrator.yml',
        '.github/workflows/release-4.0.0-orchestrator.yml',
    )
    text = text.replace('"3.0.7"', '"4.0.0"')
    text = text.replace('3\\.0\\.7', '4\\.0\\.0')
    package_test.write_text(text, encoding="utf-8")


def patch_runtime_versions() -> None:
    replace("tabs/landing.html", "Flight Commander 3.0.7", "Flight Commander 4.0.0", required=False)
    replace(
        "js/main/ntripClient.js",
        "NTRIP FlightCommander/3.0.7",
        "NTRIP FlightCommander/4.0.0",
        required=False,
    )


def main() -> None:
    patch_firmware_builder()
    patch_tests()
    patch_runtime_versions()
    print("Flight Commander 4.0.0 coordinated contracts finalized.")


if __name__ == "__main__":
    main()
