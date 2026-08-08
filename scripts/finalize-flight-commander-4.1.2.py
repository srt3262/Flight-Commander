#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
CHANGED: list[str] = []


def file_path(relative: str) -> Path:
    return ROOT / relative


def read(relative: str) -> str:
    return file_path(relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = file_path(relative)
    previous = path.read_text(encoding="utf-8")
    if previous == content:
        return
    path.write_text(content, encoding="utf-8", newline="\n")
    CHANGED.append(relative)


def replace(relative: str, old: str, new: str, *, required: bool = True) -> None:
    content = read(relative)
    if old not in content:
        if required and new not in content:
            raise RuntimeError(f"{relative}: required source text was not found: {old[:140]!r}")
        return
    write(relative, content.replace(old, new))


def replace_regex(
    relative: str,
    pattern: str,
    replacement: str,
    *,
    count: int = 0,
    required: bool = True,
) -> None:
    content = read(relative)
    updated, matches = re.subn(
        pattern,
        replacement,
        content,
        count=count,
        flags=re.MULTILINE | re.DOTALL,
    )
    if matches == 0:
        if required and replacement not in content:
            raise RuntimeError(f"{relative}: required pattern was not found: {pattern[:140]!r}")
        return
    write(relative, updated)


# ---------------------------------------------------------------------------
# Project identity and maintained documentation
# ---------------------------------------------------------------------------
replace(
    "README.md",
    "It retains an explicit official-INAV compatibility mode while Flight Commander\n"
    "owns the product identity, release contract, capability protocol, and new\n"
    "feature development.",
    "Flight Commander Firmware is the only supported controller firmware. Inherited\n"
    "INAV source and protocol names remain only where Flight Commander Firmware still\n"
    "uses those formats; they do not provide a stock-firmware compatibility mode.",
)
replace(
    "README.md",
    "Ground Control opens immediately after the COM port is ready and reports that\n"
    "it is waiting for a vehicle heartbeat. This means the serial transport is open,\n"
    "not that the aircraft link has been validated. Telemetry, mission reads, and\n"
    "vehicle commands stay disabled until a non-GCS autopilot heartbeat is received.",
    "Ground Control opens immediately after the COM port is ready and reports that\n"
    "it is waiting for a vehicle heartbeat. This means the serial transport is open,\n"
    "not that the aircraft or firmware identity has been validated. Telemetry-driven\n"
    "operations, mission reads, and commands stay locked until the FCFW signature and\n"
    "required capability data are verified.",
)

replace(
    "CLAUDE.md",
    "Flight Commander is a cross-platform Electron application for configuring Flight Commander Firmware, planning missions, flashing supported firmware, and operating its Ground Control interface. The project is a maintained fork of INAV Configurator and retains an explicit official-unsupported-firmware state.",
    "Flight Commander is a cross-platform Electron application for configuring Flight Commander Firmware, planning missions, flashing supported firmware, and operating its Ground Control interface. The project is a maintained fork of INAV Configurator, but Flight Commander Firmware is the only supported controller firmware; upstream names remain only for source provenance and inherited protocol formats.",
)

replace(
    "docs/CONFIGURATION_REFERENCE.md",
    "Firmware Features displays the Flight Commander identity schema, compatibility\n"
    "version, target, capability bitmap, and one card per optional feature. These\n"
    "cards are protocol gates. A disabled card means the Configurator will not infer\n"
    "support from a version number or UI selection.\n\n"
    "unsupported firmware compatibility retains supported inherited configuration but does\n"
    "not advertise Flight Commander-only capabilities.",
    "Firmware Features displays the Flight Commander identity schema, protocol-baseline\n"
    "version, target, capability bitmap, and one card per optional feature. These\n"
    "cards are protocol gates. A disabled card means the Configurator will not infer\n"
    "support from a version number or UI selection. Controllers without a supported\n"
    "FCFW identity are rejected before configuration tabs unlock; there is no\n"
    "stock-firmware compatibility mode.",
)

write(
    "docs/CONNECTIONS.md",
    """# Connection modes

Flight Commander has two supported aircraft links: wired MSP for persistent
setup and MAVLink for live Ground Control. Both require Flight Commander
Firmware. Selecting a protocol never converts or authorizes foreign firmware.

## Connection mode summary

| Link | Primary purpose | Configuration | Missions | Ground Control commands |
| --- | --- | --- | --- | --- |
| Flight Commander Firmware over MSP | Bench setup over USB/UART | Full persistent configuration | Native persistent mission read/write | Wired telemetry only; airborne commands require MAVLink |
| Flight Commander Firmware over MAVLink | Live aircraft/radio link | Not a replacement for MSP setup | Active mission transfer and advertised extensions | Telemetry plus capability-gated commands |
| Foreign or unidentified firmware | Diagnosis/recovery only | Disabled, except CLI recovery after a rejected wired identity | Disabled | Disabled |

LTM is not offered as a Flight Commander aircraft connection because it cannot
carry the versioned `FCFW` identity or the capability contract required by the
Configurator.

## Top-bar controls

- **Port** selects the local serial device. Close other configurators and
  terminal programs before opening it.
- **Baud** must match the configured UART or radio rate.
- **Protocol** offers **Auto protocol (selected baud)**, **Flight Commander
  setup / MSP (wired)**, and **Ground Control / MAVLink**.
- **Wireless mode** adjusts serial behavior for links that cannot tolerate the
  same reconnect sequence as direct USB.
- **Connect/Disconnect** owns the selected aircraft port. Ground Control and
  Flight Planner remain available offline for planning and RTK-base setup.

## MSP setup link

Use MSP when changing firmware-owned configuration, including Ports, Mixer,
Outputs, Receiver, Modes, Failsafe, GPS, sensors, tuning, OSD, logging,
programming, and CLI.

The connection may initially expose inherited low-level MSP variant fields. The
Configurator does not treat those fields as permission to operate. It sends the
versioned Flight Commander identity query and unlocks setup tabs only after a
valid `FCFW` response with a supported schema is received.

A controller that does not provide that identity is restricted to the CLI
recovery surface so the operator can inspect or reflash it. It is not connected
in a reduced-functionality compatibility mode.

Recommended sequence:

1. Connect by direct USB with propellers removed.
2. Verify **Flight Commander Firmware**, firmware version, target, and
   advertised capabilities.
3. Change one coherent configuration group.
4. Save/reboot if requested.
5. Reconnect and verify readback.

## MAVLink live link

MAVLink supplies live telemetry, mission transport, and supported Ground
Control commands. A valid vehicle heartbeat establishes the transport and
vehicle IDs, but it does not prove the firmware family. Flight Commander keeps
the session in **detecting Flight Commander Firmware** until
`AUTOPILOT_VERSION` contains the `FCFW` signature and capability bitmap.

If the signature is missing or identification times out, the vehicle is marked
unsupported and mission, command, configuration, and RTK-forwarding paths stay
blocked.

For an ExpressLRS transmitter module exposed as a Windows COM port, select
**Ground Control / MAVLink**. Flight Commander defaults that protocol to
`460800` baud and keeps DTR low on Windows. Change the rate only when the radio
has been configured differently.

Exactly one intended aircraft must be present on a command-capable link. A
heartbeat alone is never permission to arm, launch, change mode, or start a
mission.

## USB RTK base connection

The USB RTK base port inside Ground Control is independent from the aircraft
port in the header. A base can survey while the aircraft is powered off. Never
select the same local serial device for both roles. Correction forwarding to an
aircraft requires verified Flight Commander Firmware and the advertised
`GCS_RTK_BASE` capability.

See [USB RTK base and NTRIP](RTK_BASE_NTRIP.md).

## Connection diagnostics

The bottom status bar reports packet errors, I2C errors, cycle time, CPU load,
MSP version/load/round-trip, hardware round-trip, and arming flags. The serial
log distinguishes an open transport, decoded MAVLink frames, validated vehicle
heartbeats, FCFW identification, and heartbeat loss/recovery.

When troubleshooting, record the selected port, protocol, baud rate, exact
message text, controller target, firmware version, and whether the failure
occurred before or after FCFW identification.
""",
)

write(
    "docs/FIRMWARE_FLASHING.md",
    """# Firmware flashing

Firmware flashing writes the flight controller. A wrong hardware target can
make the normal application firmware unbootable. Remove propellers, use stable
USB power, and preserve a backup before continuing.

## Flight Commander Firmware only

The Firmware Flasher has no firmware-family selector. It accepts only Flight
Commander Firmware images that:

- contain the compiled `FCFW` identity;
- identify a controller target supported by this Configurator;
- match the selected or detected target; and
- for online assets, match the published size and SHA-256 descriptor.

A local HEX without the FCFW identity is rejected rather than offered as a
reduced-functionality or cross-family option.

## Firmware sources

1. **Load Firmware [Online]** downloads the selected Flight Commander release
   asset and verifies its published size and SHA-256 before accepting it.
2. **Load Local Firmware** opens a `.hex` file from the computer and validates
   its FCFW identity and target metadata.
3. **Flash Firmware** writes only the image that has already passed validation.

A failed online download does not silently substitute another image. Reload the
correct online asset or deliberately choose a local Flight Commander HEX.

## Detect and verify the target

When application firmware responds, **Auto-select Target** reads the board
identity and then requires a valid versioned FCFW response. Inherited MSP
variant fields are transport details; by themselves they do not authorize the
controller or stock firmware.

Raw STM32 DFU exposes the processor bootloader but cannot reliably report the
complete board model. In DFU, manually select the exact hardware target and
verify it against the board documentation and the last known connected target.
Target aliases do not make different boards interchangeable.

## Choose a firmware version

The version list contains published Flight Commander Firmware assets available
for the selected target. A Configurator-only release may reuse an older verified
firmware image under that image's truthful embedded version. Configurator and
firmware must still remain in the same major release series. See
[Flight Commander versioning](FLIGHT_COMMANDER_VERSIONING.md).

## Erase and boot-sequence controls

- **Full chip erase** removes the existing configuration. Use it for clean
  recovery, major migrations, or when release instructions require it.
- **No reboot sequence** is for a controller already held in its hardware ROM
  bootloader by BOOT pins/button. It is not a general connection fix.
- **Manual baud rate** applies to serial bootloader paths that require it; it is
  not used for USB DFU.

## Safe flash procedure

1. Export a Configurator backup and save CLI `diff all`.
2. Disconnect batteries, peripherals, and radios that can back-power the board.
3. Connect the board directly with a reliable USB cable.
4. Auto-detect or manually confirm the exact target.
5. Select a published version or load a local Flight Commander HEX.
6. Confirm the displayed target, version, source, and FCFW validation result.
7. Enable full erase when required.
8. Press **Flash Firmware** once. Do not disconnect or power down while
   erase/write/verify is active.
9. Reconnect after reboot and verify Flight Commander Firmware identity,
   version, target, and capabilities before restoring configuration.
10. Restore selectively. Do not paste a complete old dump blindly across a
    major firmware change.

## Recovery when normal connection is lost

The STM32 ROM bootloader cannot be overwritten by normal firmware flashing.
For a board that no longer starts application firmware:

1. Disconnect power.
2. Hold the board's BOOT button or bridge the documented boot pads.
3. Connect USB while keeping BOOT asserted as required by the board.
4. Confirm the STM32 DFU device and driver in Windows.
5. Select the exact target manually, enable **No reboot sequence**, and use full
   chip erase when a clean recovery is required.
6. Load a valid target-matched Flight Commander FCFW image, flash, and verify.
7. Remove the BOOT condition and reconnect normally.

If the target is uncertain, stop. A successful DFU connection identifies the
processor bootloader, not the complete flight-controller design.
""",
)

replace(
    "docs/FLIGHT_PLANNER.md",
    "Flight Commander preserves the native INAV-compatible mission representation.",
    "Flight Commander preserves its native MSP mission representation.",
)
replace(
    "docs/FLIGHT_PLANNER.md",
    "Terrain-relative waypoint transfer is Flight Commander capability-gated.\n"
    "unsupported firmware compatibility receives only the lossless navigation subset.",
    "Terrain-relative waypoint transfer is Flight Commander capability-gated. Mission\n"
    "transfer is disabled for foreign or unidentified firmware; there is no\n"
    "navigation-only stock-firmware compatibility path.",
)
replace(
    "docs/FLIGHT_PLANNER.md",
    "- LTM cannot transfer missions.",
    "- Unsupported or identity-less transports cannot transfer missions.",
)

replace(
    "docs/GROUND_CONTROL.md",
    "- **MAVLink · Flight Commander** can supply live telemetry, mission transport,\n"
    "  and capability-gated commands.\n"
    "- **MAVLink · unsupported firmware** is compatibility telemetry/navigation; native\n"
    "  Flight Commander command controls remain disabled.\n"
    "- **LTM** is read-only telemetry.\n"
    "- **Offline RTK setup** means the aircraft is disconnected but the lower RTK\n"
    "  workspace can still operate an independent USB base.",
    "- **MAVLink · detecting Flight Commander Firmware** means a valid vehicle\n"
    "  heartbeat has arrived but the FCFW signature and capabilities are still being\n"
    "  verified. Operational paths remain locked.\n"
    "- **MAVLink · Flight Commander** supplies live telemetry, mission transport, and\n"
    "  capability-gated commands after identity verification.\n"
    "- **MAVLink · unsupported firmware** means the FCFW identity was missing or\n"
    "  invalid. Mission transfer, commands, configuration, and RTK forwarding are\n"
    "  blocked; any visible telemetry is diagnostic only.\n"
    "- **Offline RTK setup** means the aircraft is disconnected but the lower RTK\n"
    "  workspace can still operate an independent USB base.",
)
replace(
    "docs/GROUND_CONTROL.md",
    "The link, armed state, selected flight mode, and command explanation are always\n"
    "visible. Disabled commands remain present and state why they cannot be sent.",
    "The link, armed state, selected flight mode, and command explanation are always\n"
    "visible. Unsupported firmware never enters a reduced-functionality operating\n"
    "mode; command and mission paths stay blocked.",
)

replace(
    "docs/README.md",
    "| Links | [Connection modes](CONNECTIONS.md) | MSP, MAVLink, LTM, USB radios, baud rates, and transport limitations |",
    "| Links | [Connection modes](CONNECTIONS.md) | MSP, MAVLink, USB radios, FCFW identity checks, baud rates, and transport limitations |",
)
replace(
    "docs/README.md",
    "Flight Commander retains GPL-licensed INAV compatibility code and explicitly\n"
    "labels unsupported firmware compatibility mode, but Flight Commander product help and\n"
    "support belong here. Upstream links are retained only where provenance or a\n"
    "third-party dependency is the subject.",
    "Flight Commander Firmware is the only supported controller firmware. The\n"
    "repository retains GPL-licensed INAV-derived source and inherited protocol names\n"
    "where required for provenance and implementation, but it provides no stock-firmware\n"
    "compatibility mode. Flight Commander product help and support belong here.",
)
replace(
    "docs/README.md",
    "[repository contribution workflow](../README.md#contributing), preserve the\n"
    "Flight Commander/unsupported firmware compatibility boundary, and add regression\n"
    "coverage for runtime or packaging changes.",
    "[repository contribution workflow](../README.md#contributing), preserve the\n"
    "Flight Commander Firmware-only identity boundary, and add regression coverage for\n"
    "runtime or packaging changes.",
)

replace(
    "docs/RTK_BASE_NTRIP.md",
    "- unsupported firmware cannot use Flight Commander's GCS RTK-base bridge. The\n"
    "  connected firmware must identify as Flight Commander Firmware and advertise\n"
    "  the `GCS_RTK_BASE` capability.",
    "- A controller without a verified Flight Commander FCFW identity cannot use the\n"
    "  GCS RTK-base bridge. The connected firmware must also advertise the\n"
    "  `GCS_RTK_BASE` capability.",
)

replace(
    "docs/TROUBLESHOOTING.md",
    "heartbeat, unsupported firmware compatibility mode, missing firmware capability,\n"
    "multiple systems on the link, no cached MSP command profile, missing AUX",
    "heartbeat, FCFW identity still detecting or rejected, missing firmware capability,\n"
    "multiple systems on the link, no cached MSP command profile, missing AUX",
)

replace_regex(
    "docs/RECONSTRUCTION.md",
    r"## Compatibility boundaries preserved by the reconstruction\n.*?\n## Verification policy",
    """## Firmware and transport boundaries after reconstruction

The source keeps transport responsibilities explicit while enforcing one
supported controller firmware family:

- **Flight Commander Firmware over MSP** uses the inherited wired handshake and
  native persistent mission/settings formats. The versioned FCFW identity is
  mandatory before normal setup tabs unlock.
- **Flight Commander Firmware over MAVLink** supplies telemetry, active mission
  transfer, and capability-gated commands after the FCFW signature is verified.
- A generic heartbeat, an inherited MSP variant field, or parameter behavior is
  not accepted as firmware authorization.
- LTM is not exposed as a supported aircraft connection because it cannot carry
  the FCFW identity and capability contract.
- Other or unidentified firmware is classified as unsupported. Configuration,
  mission transfer, commands, and aircraft RTK forwarding remain blocked; wired
  CLI recovery may remain available for reflashing.
- The Firmware Flasher accepts only target-matched Flight Commander FCFW images.

Inherited INAV names remain in source identifiers, setting names, wire-format
code, licensing notices, and provenance where Flight Commander Firmware still
uses them. They are implementation history, not a stock-firmware product mode.

## Verification policy""",
    count=1,
)

# ---------------------------------------------------------------------------
# Active Configurator surfaces and the Windows package contract
# ---------------------------------------------------------------------------
replace(
    "js/flightCommander/alignmentTargets.js",
    "description: 'Active INAV target magnetometer alignment and diagnostics.',",
    "description: 'Active Flight Commander target magnetometer alignment and diagnostics.',",
)
replace(
    "js/flightCommander/alignmentTargets.js",
    "transport: 'INAV target compass path',",
    "transport: 'Flight Commander target compass path',",
)
replace(
    "js/flightCommander/alignmentTargets.js",
    "setting: 'INAV align_mag and align_mag_roll/pitch/yaw',",
    "setting: 'Inherited align_mag and align_mag_roll/pitch/yaw settings',",
)
replace(
    "tabs/magnetometer.html",
    'aria-label="INAV body axes"',
    'aria-label="Flight Commander body axes"',
)
replace(
    "tabs/magnetometer.html",
    '<dd id="alignmentSourceTransport">INAV target compass path</dd>',
    '<dd id="alignmentSourceTransport">Flight Commander target compass path</dd>',
)
replace(
    "tabs/magnetometer.html",
    '<dd id="alignmentSourceSetting">INAV align_mag and align_mag_roll/pitch/yaw</dd>',
    '<dd id="alignmentSourceSetting">Inherited align_mag and align_mag_roll/pitch/yaw settings</dd>',
)
replace(
    "tabs/magnetometer.js",
    "state = 'INAV onboard compass';",
    "state = 'Onboard compass';",
)
replace(
    "tabs/magnetometer.js",
    "detail = 'Live vector is the standard INAV onboard magnetometer sample. Zero and gain are the saved onboard calibration.';",
    "detail = 'Live vector is the standard onboard magnetometer sample. Zero and gain are the saved onboard calibration.';",
)
replace(
    "tabs/flight_planner.html",
    "This is INAV's persistent <code>nav_wp_mission_restart</code> firmware setting.\n"
    "                            Native RESUME continues from the last active waypoint when NAV WP is reselected,\n"
    "                            but only while the flight controller remains powered and the aircraft remains armed;\n"
    "                            disarming resets INAV's native active waypoint to the mission start. SWITCH permits",
    "This is Flight Commander's persistent <code>nav_wp_mission_restart</code> firmware setting.\n"
    "                            Native RESUME continues from the last active waypoint when NAV WP is reselected,\n"
    "                            but only while the flight controller remains powered and the aircraft remains armed;\n"
    "                            disarming resets the firmware's active waypoint to the mission start. SWITCH permits",
)

# Remove unreachable stock-family planner branches and make every transfer gate
# require Flight Commander Firmware explicitly.
replace_regex(
    "tabs/flight_planner.js",
    r"  if \(normalizedMode === SURVEY_CAMERA_MODES\.FLIGHT_COMMANDER\) \{\n    if \(target === 'inav'\) \{.*?\n    \}\n    if \(target === 'flight-commander'",
    "  if (normalizedMode === SURVEY_CAMERA_MODES.FLIGHT_COMMANDER) {\n    if (target === 'flight-commander'",
    count=1,
)
replace(
    "tabs/flight_planner.js",
    "  if (target === 'inav' || target === 'flight-commander') {\n"
    "    return {\n"
    "      mode: normalizedMode,\n"
    "      target,\n"
    "      includeCameraCommands: false,\n"
    "      incompatible: false,\n"
    "      notice: target === 'inav'\n"
    "        ? 'unsupported firmware is navigation-only in Flight Commander; photo spacing estimates images but no shutter command is sent.'\n"
    "        : 'The connected Flight Commander Firmware does not advertise photo triggers; photo spacing estimates images only.',\n"
    "    };\n"
    "  }",
    "  if (target === 'flight-commander') {\n"
    "    return {\n"
    "      mode: normalizedMode,\n"
    "      target,\n"
    "      includeCameraCommands: false,\n"
    "      incompatible: false,\n"
    "      notice: 'The connected Flight Commander Firmware does not advertise photo triggers; photo spacing estimates images only.',\n"
    "    };\n"
    "  }",
)
replace(
    "tabs/flight_planner.js",
    "  if (!['inav', 'flight-commander'].includes(state.firmwareFamily)) {\n"
    "    throw new Error(\n"
    "      state.firmwareFamily === 'unsupported'\n"
    "        ? 'ArduPilot mission transfer has been removed. Connect Flight Commander Firmware or unsupported firmware.'\n"
    "        : 'This MAVLink firmware is not supported for mission transfer.',\n"
    "    );\n"
    "  }\n"
    "  return state.firmwareFamily;",
    "  if (state.firmwareFamily !== 'flight-commander') {\n"
    "    throw new Error(\n"
    "      state.firmwareFamily === 'unknown'\n"
    "        ? 'Mission transfer is waiting for Flight Commander FCFW identification.'\n"
    "        : 'Mission transfer requires supported Flight Commander Firmware.',\n"
    "    );\n"
    "  }\n"
    "  return 'flight-commander';",
)
replace(
    "tabs/flight_planner.js",
    "`${missionToUpload.length} ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'unsupported firmware'} mission items written to active memory and verified.`",
    "`${missionToUpload.length} Flight Commander mission items written to active memory and verified.`",
)
replace(
    "tabs/flight_planner.js",
    "`Mission saved to ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'unsupported firmware'} EEPROM. Reading it back for verification…`",
    "'Mission saved to Flight Commander EEPROM. Reading it back for verification…'",
)
replace(
    "tabs/flight_planner.js",
    "`${result.uploaded} ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'unsupported firmware'} mission items written to EEPROM and verified.${suffix}`",
    "`${result.uploaded} Flight Commander mission items written to EEPROM and verified.${suffix}`",
)
replace(
    "tabs/flight_planner.js",
    "`Active ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'unsupported firmware'} RAM mission cleared and verified for this power cycle. `",
    "'Active Flight Commander RAM mission cleared and verified for this power cycle. '",
)

# Strengthen release-policy regression coverage for the active strings that
# previously caused the Windows package failure and the screenshot regression.
policy_test = "tests/flight-commander/firmware/flight-commander-only-policy.test.mjs"
replace(
    policy_test,
    "  const landing = text(\"tabs/landing.html\");",
    "  const landing = text(\"tabs/landing.html\");\n"
    "  const alignmentTargets = text(\"js/flightCommander/alignmentTargets.js\");\n"
    "  const plannerHtml = text(\"tabs/flight_planner.html\");\n"
    "  const docs = [\n"
    "    text(\"README.md\"),\n"
    "    text(\"docs/CONNECTIONS.md\"),\n"
    "    text(\"docs/FIRMWARE_FLASHING.md\"),\n"
    "    text(\"docs/GROUND_CONTROL.md\"),\n"
    "  ].join(\"\\n\");",
)
replace(
    policy_test,
    "  assert.match(landing, /Flight Commander Firmware the only/);\n});",
    "  assert.match(landing, /Flight Commander Firmware the only/);\n"
    "  assert.match(alignmentTargets, /Active Flight Commander target magnetometer alignment and diagnostics/);\n"
    "  assert.doesNotMatch(alignmentTargets, /Active INAV target|INAV target compass path/);\n"
    "  assert.doesNotMatch(plannerHtml, /INAV's persistent|resets INAV's native/);\n"
    "  assert.doesNotMatch(docs, /Official INAV|official-INAV compatibility|unsupported firmware compatibility|Live compatibility telemetry/);\n"
    "});",
)

# Active product surfaces may retain inherited code identifiers such as
# MSPV2_INAV_*, but must not retain stock-firmware product modes or warnings.
checks = {
    "README.md": ["official-INAV compatibility mode"],
    "CLAUDE.md": ["official-unsupported-firmware state"],
    "docs/CONFIGURATION_REFERENCE.md": ["unsupported firmware compatibility"],
    "docs/CONNECTIONS.md": ["Compatibility setup", "Live compatibility telemetry", "Official INAV"],
    "docs/FIRMWARE_FLASHING.md": ["Select firmware family", "unsupported firmware catalog", "Official INAV"],
    "docs/FLIGHT_PLANNER.md": ["unsupported firmware compatibility"],
    "docs/GROUND_CONTROL.md": ["compatibility telemetry/navigation", "**LTM** is read-only"],
    "docs/README.md": ["unsupported firmware compatibility mode"],
    "docs/RECONSTRUCTION.md": ["Stock INAV's limited", "INAV/LTM"],
    "js/flightCommander/alignmentTargets.js": ["Active INAV target", "INAV target compass path"],
    "tabs/flight_planner.js": ["Connect Flight Commander Firmware or unsupported firmware", "unsupported firmware is navigation-only"],
    "tabs/flight_planner.html": ["INAV's persistent", "resets INAV's native"],
}
for relative, banned_phrases in checks.items():
    content = read(relative)
    remaining = [phrase for phrase in banned_phrases if phrase in content]
    if remaining:
        raise RuntimeError(f"{relative}: retired support wording remains: {remaining}")

print(f"Finalized Flight Commander 4.1.2 cleanup across {len(CHANGED)} files.")
for relative in CHANGED:
    print(relative)
