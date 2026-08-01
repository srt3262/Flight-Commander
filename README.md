# Flight Commander

[![CI](https://github.com/srt3262/Flight-Commander/actions/workflows/ci.yml/badge.svg)](https://github.com/srt3262/Flight-Commander/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

Flight Commander is a desktop flight-controller configurator, mission planner,
and ground control station for INAV and ArduPilot aircraft. It combines the
complete INAV Configurator workflow with a MAVLink Ground Control view,
ArduPilot parameters, controller-aware mission handling, terrain-assisted
planning, and controller-aware firmware workflows.

> **Source provenance:** version 1.3.6 is a reconstructed source release. It was
> rebuilt from INAV Configurator 9.1.1 and a verified Flight Commander 1.3.5
> production runtime; it is not represented as the unavailable exact historical
> 1.3.5 source tree. See [Reconstruction and provenance](docs/RECONSTRUCTION.md).

## Highlights

- Full inherited INAV configuration over the wired MSP setup link.
- Ground Control with satellite mapping, a live attitude HUD, telemetry,
  autopilot messages, mission progress, and map-primary/HUD-primary layouts.
- One Flight Planner for INAV and ArduPilot, including survey grids, mission
  read/write, cruise-speed and completion policies, terrain following, and
  guarded same-session mission resume.
- Built-in online ASTER terrain through OpenTopoData with no API key, plus
  optional Google Elevation and local GIS sources.
- ArduPilot parameter download, search, editing, comparison, and verified write.
- INAV-style ArduPilot navigation with live Status, Ports, Receiver, Modes,
  PID Tuning, Configuration, Motors & Outputs, Safety & Failsafe, Sensors,
  GPS & Navigation, Power, OSD, Logging, Mission, and All Parameters pages.
  Guided controls translate familiar INAV concepts to parameters discovered
  on the connected vehicle and show official explanations, exact native names,
  limits, choices, and restart needs. ArduPilot Extras and All Parameters retain
  every firmware-specific setting without a safe one-to-one mapping.
- Guarded Save and Save & Reboot on ArduPilot configuration pages. Parameter
  readback must confirm before a normal reboot is sent, and both operations are
  refused while the vehicle is armed.
- One application-wide high-contrast dark theme, plus synchronized metric or
  imperial displays in Ground Control and ArduPilot setup. Controller writes
  and JSON backups remain in the flight controller's native parameter units.
- INAV 10, 12, 15, and 17-inch multirotor presets with prop-size-tuned EZ Tune
  baselines and explicit generated P/I/D/FF values.
- Controller-aware autotune and operational controls.
- INAV firmware flashing, first-time ArduPilot installation through STM32 DFU,
  board-ID-checked APJ updates through the PX4FMU serial bootloader, and a
  guarded STM32 ROM-DFU/full-erase handoff when returning from ArduPilot to INAV.

Flight Commander deliberately fails closed when a mission or command cannot be
represented by the connected controller. It does not silently discard
controller-specific mission items.

## Controller and transport boundaries

The connection type matters. A capability shown for one transport should not be
assumed to exist on another.

| Controller and link        | Configuration                                                                  | Missions and planning                                                                                                                                  | Live Ground Control                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INAV over MSP**          | Full INAV configuration and persistent settings                                | Native INAV mission and planning-data read/write, including INAV-specific mission items, safe homes, fixed-wing approaches, and geozones               | Wired telemetry is available; airborne commands require a MAVLink link                                                                                                            |
| **INAV over MAVLink**      | Not a replacement for the wired MSP setup link                                 | Only the stock INAV MAVLink mission subset is accepted losslessly; unsupported commands, including ArduPilot camera command 206, are rejected          | Telemetry and explicitly configured AUX-backed commands; command use requires a matching profile captured over MSP and confirmation that exactly one INAV aircraft is on the link |
| **INAV over LTM**          | None                                                                           | None                                                                                                                                                   | Read-only telemetry                                                                                                                                                               |
| **ArduPilot over MAVLink** | ArduPilot parameter read/write; mission policy remains owned by Flight Planner | Native MAVLink mission transfer, speed command 178, ArduPilot distance-camera command 206, completion actions, and exact resume checks where supported | Telemetry and vehicle-aware arm, mode, mission, RTL, land, takeoff, and autotune actions                                                                                          |

INAV exact behavior remains firmware-specific. Its interruption checkpoint is
position-estimated and its persistent `nav_wp_mission_restart` policy is managed
over MSP. ArduPilot resume uses mission identity and boot-session checks and
requires a compatible `MIS_RESTART` setting. In both cases, resume is intended
for the same powered flight controller; power loss invalidates the checkpoint.

Firmware flashing is a separate bootloader operation, not an airborne MAVLink
Ground Control command. An existing ArduPilot installation is updated with an
APJ package only after its PX4 bootloader board ID is checked. A controller
running INAV has no PX4 bootloader identity, so its first ArduPilot installation
uses the official, same-release `*_with_bl.hex` through STM32 DFU with a full
erase and read-back verification. Flight Commander can pre-match an exact INAV
MSP target name; raw STM32 DFU cannot report a board model and therefore
requires manual hardware-target confirmation. Always verify the detected
identity, selected target, and firmware before writing.

### USB MAVLink radios

For an external ExpressLRS transmitter module exposed as a Windows COM port,
select **Ground Control / MAVLink**. Flight Commander defaults that protocol to
the ExpressLRS USB MAVLink rate of **460800 baud**, forces DTR low on Windows,
and starts transmitting the GCS heartbeat as soon as the serial transport
opens. These behaviors follow the
[ExpressLRS MAVLink guidance](https://www.expresslrs.org/software/mavlink/).
**Auto protocol (selected baud)** detects the protocol at the baud shown in the
toolbar; it does not scan serial rates, so it should not be used as a substitute
for the explicit ExpressLRS selection.

ExpressLRS does not support a GCS USB connection through a handset's internal
ELRS module. Internal modules must use TX Backpack Wi-Fi/UDP; connect the USB
cable directly to the external TX module when using the serial method.

Ground Control opens immediately after the COM port is ready and reports that
it is waiting for a vehicle heartbeat. This means the serial transport is open,
not that the aircraft link has been validated. Telemetry, mission reads, and
vehicle commands stay disabled until a non-GCS autopilot heartbeat is received.

## Install

The validated publication target for the reconstructed release is **Windows
x64**. Download a ZIP from
[GitHub Releases](https://github.com/srt3262/Flight-Commander/releases), extract
it into a new folder, and run `flight-commander.exe`.

Unless a release is explicitly marked as code-signed, Windows SmartScreen may
show an unknown-publisher warning. Publishing a binary on GitHub does not itself
establish Windows publisher trust.

## Build from source

Prerequisites:

- Node.js 22
- Yarn Classic 1.22.22 (pinned through Corepack)
- The native build tools required by Electron Forge for your platform

```bash
corepack enable
yarn install --frozen-lockfile
yarn test
yarn start
```

Create and verify the Windows x64 package on Windows:

```bash
yarn package:windows
yarn verify:windows
```

`yarn test` runs both the inherited INAV regression suite and the reconstructed
Flight Commander Node test suites. Pull requests and pushes to `main` run the
same test command in CI; a separate Windows job packages and verifies the x64
application.

## Operational safety

Flight Commander is not flight-certified software. Before operating an
aircraft:

1. Test configuration, mission transfer, failsafes, and command routing on the
   bench with propellers removed.
2. Confirm the displayed controller family, vehicle type, active mode, mission,
   home position, and firmware target.
3. Validate new behavior in simulation or a controlled test area before relying
   on it in flight.
4. Keep an independent and tested recovery path.

The software is provided without warranty under the GNU General Public License.
Large-prop presets are safe starting points, not a substitute for reviewing
motor, propeller, frame, filter, and Blackbox behavior on the actual aircraft.

## Contributing

Open an issue for a reproducible defect or a narrowly scoped feature request.
For pull requests:

1. Branch from `main`.
2. Keep controller and transport boundaries explicit.
3. Add tests for protocol, mission, parameter, telemetry, or firmware changes.
4. Run `yarn test`; for release-affecting work, also package and verify Windows
   x64.

Do not weaken a compatibility check merely to make an upload succeed. If a
controller cannot represent an operation losslessly, preserve the warning or
add an explicit controller-specific path.

## License and attribution

Flight Commander is licensed under the
[GNU General Public License version 3](LICENSE).

This project is derived from
[INAV Configurator](https://github.com/iNavFlight/inav-configurator), including
its INAV configuration experience and upstream GPL-licensed work. The 1.3.6
reconstruction starts from INAV Configurator 9.1.1 commit
[`4c343e38aba4ef655afd88e8339ef21d0c3c53ac`](https://github.com/iNavFlight/inav-configurator/commit/4c343e38aba4ef655afd88e8339ef21d0c3c53ac).
Upstream copyright and license notices are retained.

Flight Commander is an independent project and is not an official release of
the INAV or ArduPilot projects.
