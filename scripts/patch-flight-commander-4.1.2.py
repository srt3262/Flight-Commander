#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path.cwd()
changed: list[str] = []


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    previous = path.read_text(encoding="utf-8")
    if previous == content:
        return
    path.write_text(content, encoding="utf-8", newline="\n")
    changed.append(relative)


def replace(relative: str, old: str, new: str, *, required: bool = True) -> None:
    content = read(relative)
    if old not in content:
        if required and new not in content:
            raise RuntimeError(f"{relative}: missing replacement source {old[:120]!r}")
        return
    write(relative, content.replace(old, new))


def replace_once_regex(relative: str, pattern: str, replacement: str) -> None:
    content = read(relative)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        if replacement not in content:
            raise RuntimeError(f"{relative}: expected one match for {pattern[:120]!r}, got {count}")
        return
    write(relative, updated)


def replace_message(relative: str, key: str, message: str) -> None:
    content = read(relative)
    pattern = re.compile(
        rf'("{re.escape(key)}"\s*:\s*\{{\s*"message"\s*:\s*)"(?:\\.|[^"\\])*"',
        re.MULTILINE | re.DOTALL,
    )
    replacement = rf'\1{json.dumps(message, ensure_ascii=False)}'
    updated, count = pattern.subn(replacement, content, count=1)
    if count == 0:
        return
    write(relative, updated)


# Connection recovery remains the inherited MSP implementation, but every
# operator-facing contract now names Flight Commander Firmware.
replace(
    "tests/flight-commander/connection/connection-lifecycle-contract.test.mjs",
    r"/INAV did not respond after three post-reboot[\s\S]*?serial port has been closed/",
    r"/Flight Commander Firmware did not respond after three post-reboot[\s\S]*?serial port has been closed/",
)
replace(
    "tests/flight-commander/connection/connection-lifecycle-contract.test.mjs",
    'test("INAV save-and-reboot reconnect is bounded and performs a full close/reopen retry"',
    'test("Flight Commander save-and-reboot reconnect is bounded and performs a full close/reopen retry"',
)
replace(
    "tests/flight-commander/connection/serial-backend-native-close.test.mjs",
    'test("an unresponsive INAV reboot performs bounded full serial reopen attempts"',
    'test("an unresponsive Flight Commander reboot performs bounded full serial reopen attempts"',
)
replace(
    "tests/flight-commander/connection/serial-backend-native-close.test.mjs",
    'message.includes("INAV did not respond after three post-reboot")',
    'message.includes("Flight Commander Firmware did not respond after three post-reboot")',
)

# Unsupported identity schema is still recognizably Flight Commander, but its
# capability contract is rejected. Only a missing identity is foreign firmware.
replace(
    "tests/flight-commander/firmware/flight-commander-identity.test.mjs",
    '    assert.equal(identity.capabilities, 0);\n    assert.equal(identity.displayName, "Unsupported firmware");\n    assert.match(identity.probeError, /schema 2/);',
    '    assert.equal(identity.capabilities, 0);\n    assert.equal(identity.displayName, "Flight Commander Firmware");\n    assert.match(identity.probeError, /schema 2/);',
)

# Command-router tests assert the unified Flight Commander-only rejection.
replace(
    "tests/flight-commander/mavlink/command-router.test.mjs",
    'test("blocks every command for a parameter-capable non-INAV vehicle"',
    'test("blocks every command for a vehicle without Flight Commander identity"',
)
replace(
    "tests/flight-commander/mavlink/command-router.test.mjs",
    'assert.match(capabilities.reason, /ArduPilot support has been removed/);',
    'assert.match(capabilities.reason, /not running supported Flight Commander Firmware/);',
)
replace(
    "tests/flight-commander/mavlink/command-router.test.mjs",
    'assert.throws(() => router.setMode("NAV WP"), /not running supported Flight Commander Firmware/);',
    'assert.throws(() => router.setMode("NAV WP"), /require supported Flight Commander Firmware/);',
)
replace(
    "tests/flight-commander/mavlink/command-router.test.mjs",
    'assert.throws(() => router.setArmed(true), /not running supported Flight Commander Firmware/);',
    'assert.throws(() => router.setArmed(true), /require supported Flight Commander Firmware/);',
)

# A generic heartbeat validates only the MAVLink transport. It remains locked
# in identity probing until AUTOPILOT_VERSION supplies the FCFW signature.
replace(
    "tests/flight-commander/mavlink/session.test.mjs",
    '    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_INAV);\n    assert.equal(session.state.systemId, 1);',
    '    assert.equal(session.state.firmwareFamily, "unknown");\n    assert.equal(session.state.firmwareFamilySource, "probing");\n    assert.equal(session.state.systemId, 1);',
)
replace(
    "tests/flight-commander/mavlink/session.test.mjs",
    'test("settles with MAVLink v1, decodes chunked INAV, then uses the observed v2 protocol"',
    'test("settles with MAVLink v1, decodes a chunked vehicle heartbeat, then uses the observed v2 protocol"',
)

# Packaging tests now enforce one hidden fixed backend rather than two choices.
package_test = "tests/flight-commander/packaging/package-contract.test.mjs"
replace(
    package_test,
    '  assert.match(packageVerifier, /INAV is not responding after reboot/);\n  assert.match(packageVerifier, /INAV did not respond after three post-reboot/);',
    '  assert.match(packageVerifier, /Flight Commander Firmware is not responding after reboot/);\n  assert.match(packageVerifier, /Flight Commander Firmware did not respond after three post-reboot/);',
)
replace_once_regex(
    package_test,
    r'''  assert\.deepEqual\(\n    \[\.\.\.firmwareFlasherHtml\.matchAll\(/<option value="\(\[\^"\]\+\)">\(\?:Flight Commander Firmware\|Official INAV Firmware\)<\\/option>/g\)\]\n      \.map\(\(match\) => match\[1\]\),\n    \["flight-commander", "inav"\],\n  \);\n  assert\.match\(firmwareFlasherHtml, /value="flight-commander">Flight Commander Firmware/\);\n  assert\.match\(firmwareFlasherHtml, /value="inav">Official INAV Firmware/\);''',
    '''  assert.match(
    firmwareFlasherHtml,
    /id="firmware_backend" type="hidden" value="flight-commander"/,
  );
  assert.match(firmwareFlasherHtml, /Flight Commander Firmware only/);
  assert.doesNotMatch(firmwareFlasherHtml, /value="inav"|Official INAV Firmware/);''',
)
replace(
    package_test,
    '  assert.match(flasherWarning, /Flash only firmware built for the detected controller target/);',
    '  assert.match(flasherWarning, /Flash only Flight Commander Firmware built for the detected controller target/);',
)

# Remove residual compatibility wording from the active serial surface.
replace(
    "js/serial_backend.js",
    "MSP and LTM detection remain active.",
    "MSP detection remains active.",
    required=False,
)
replace(
    "js/serial_backend.js",
    "This vehicle is not running supported Flight Commander Firmware. ' +\n                    'ArduPilot support has been removed; configuration, missions, and commands are disabled.",
    "This vehicle did not provide a supported Flight Commander FCFW identity; configuration, missions, and commands are disabled.",
    required=False,
)

# Restore compact original locale formatting in the workflow before this script
# runs, then replace only the active firmware-selection/recovery strings.
locale_messages = {
    "firmwareVariantNotSupported": (
        "This controller firmware is not supported. Flash Flight Commander Firmware "
        "before using this application."
    ),
    "firmwareFlasherOnlineSelectBoardDescription": (
        "Select the exact Flight Commander hardware target or use automatic target "
        "discovery from a controller already running Flight Commander Firmware."
    ),
    "firmwareFlasherOnlineSelectFirmwareVersionDescription": (
        "Select a published Flight Commander Firmware version for this board. The "
        "firmware and Configurator major versions must match."
    ),
    "firmwareFlasherWarningText": (
        "Flash only Flight Commander Firmware built for the detected controller target. "
        "The selected HEX must contain the FCFW identity and match this exact board.<br />"
        "Do <span style=\"color: red\">not</span> <strong>disconnect</strong> the board or "
        "<strong>turn off</strong> your computer while flashing.<br /><br /><strong>Before "
        "flashing:</strong> make a backup because some upgrades or downgrades erase "
        "configuration.<br /><strong>Recovery:</strong> enter STM32 DFU/BOOT mode and "
        "follow the <a href=\"https://github.com/srt3262/Flight-Commander/blob/main/docs/"
        "FIRMWARE_FLASHING.md\" target=\"_blank\">Flight Commander USB flashing guide</a>."
    ),
    "firmwareFlasherRecoveryText": (
        "If communication is lost, power off, enter STM32 DFU/BOOT mode, select the exact "
        "controller target, enable full-chip erase when required, and flash a valid Flight "
        "Commander FCFW image. Follow the <a href=\"https://github.com/srt3262/Flight-"
        "Commander/blob/main/docs/FIRMWARE_FLASHING.md\" target=\"_blank\">Flight "
        "Commander USB flashing guide</a>."
    ),
    "targetPrefetchFailOld": "Cannot prefetch target: unsupported Flight Commander identity",
    "targetPrefetchFailNonINAV": (
        "Cannot prefetch target: Flight Commander Firmware identity was not verified"
    ),
}
for locale_path in sorted((ROOT / "locale").glob("*/messages.json")):
    relative = str(locale_path.relative_to(ROOT))
    for key, message in locale_messages.items():
        replace_message(relative, key, message)

print(f"Applied focused Flight Commander 4.1.2 corrections to {len(changed)} files.")
for relative in changed:
    print(relative)
