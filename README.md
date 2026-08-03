# Flight Commander

[![CI](https://github.com/srt3262/Flight-Commander/actions/workflows/ci.yml/badge.svg)](https://github.com/srt3262/Flight-Commander/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

Flight Commander is a desktop flight-controller configurator, mission planner,
firmware flasher, and ground control station centered on Flight Commander
Firmware. It is a maintained, independently versioned fork—not an INAV skin.
It retains an explicit official-INAV compatibility mode while Flight Commander
owns the product identity, release contract, capability protocol, and new
feature development.

> **Source provenance:** the repository history includes a reconstructed 1.3.6
> source baseline built from INAV Configurator 9.1.1 and a verified Flight
> Commander 1.3.5 runtime. Version 2 begins the coordinated Flight Commander
> Firmware and Configurator release train. See
> [Reconstruction and provenance](docs/RECONSTRUCTION.md).

## Highlights

- A coordinated major-version contract: Configurator and firmware minors may
  differ, but a major transition releases both products together at `X.0.0`.

- Full inherited INAV configuration over the wired MSP setup link.
- Ground Control with satellite mapping, a live attitude HUD, telemetry,
  autopilot messages, mission progress, and map-primary/HUD-primary layouts.
- One Flight Planner for INAV-compatible firmware, including survey grids,
  mission read/write, cruise-speed and completion policies, terrain following,
  and guarded same-session mission resume.
- Built-in online ASTER terrain through OpenTopoData with no API key, plus
  optional Google Elevation and local GIS sources.
- Versioned Flight Commander Firmware identity over MSPv2. Fork-only features
  remain disabled unless the connected firmware advertises the corresponding
  capability bit.
- Concurrent UART u-blox and DroneCAN GPS/RTK configuration. Both receivers
  remain active, each reports independent RTK state, either can be selected as
  navigation primary, and RTCM corrections are sent to every enabled path.
- Weighted heading fusion across the onboard compass, an external-I²C
  compass on a UART GPS module, a selected DroneCAN compass, and validated
  dual-GNSS moving-baseline yaw. Priority controls authority and failover;
  weight controls contribution among healthy sources. One disarmed calibration
  run solves each physical compass independently and binds CAN calibration to
  the emitting node ID. See
  [Heading fusion and moving-baseline yaw](docs/HEADING_FUSION.md).
- An independent USB RTK Base workspace for u-blox F9 survey-in/fixed-base
  setup, RTCM3 monitoring, and correction forwarding. Its built-in NTRIP v2
  client supports direct caster-to-aircraft corrections or a guarded
  NTRIP-assisted RTK Fixed position capture before the receiver is switched
  into local fixed-base mode.
  See [USB RTK base and NTRIP](docs/RTK_BASE_NTRIP.md).
- DroneCAN node discovery and typed configuration for GNSS/RTK, compass,
  relative-heading, and battery services, with explicit
  disabled/automatic/fixed-node choices and CAN bitrate controls in Ports.
- Capability-gated terrain-following mission upload and distance-based MAVLink
  camera triggering for Flight Commander Firmware. Official INAV remains
  navigation-only for those fork extensions.
- One application-wide high-contrast dark theme, with synchronized metric or
  imperial Ground Control displays.
- INAV 10, 12, 15, and 17-inch multirotor presets with prop-size-tuned EZ Tune
  baselines and explicit generated P/I/D/FF values.
- INAV and Flight Commander Firmware flashing through the same proven
  STM32/DFU path. The app automatically detects the target, validates the
  selected firmware family, and prevents cross-family or target-mismatched HEX
  images from being written.

ArduPilot firmware is unsupported. A parameter-capable non-INAV MAVLink vehicle
is identified as unsupported, and its configuration, mission, and command
paths remain disabled. Flight Commander also fails closed whenever an INAV
mission or command cannot be represented losslessly.

## Controller and transport boundaries

The connection type matters. A capability shown for one transport should not be
assumed to exist on another.

| Controller and link | Configuration | Missions and planning | Live Ground Control |
| --- | --- | --- | --- |
| **Flight Commander Firmware over MSP** | Full persistent configuration, including UART GPS, DroneCAN nodes, primary-GPS selection, and advertised capability status | Native mission and planning-data read/write, including safe homes, approaches, geozones, terrain profiles, and supported photo actions | Wired telemetry is available; airborne commands require a MAVLink link |
| **Flight Commander Firmware over MAVLink** | Not a replacement for the wired MSP setup link | The lossless navigation subset plus advertised Flight Commander terrain and photo extensions | Telemetry and native Ground Control commands; command use requires the advertised capability, a matching profile captured over MSP, and confirmation that exactly one aircraft is on the link |
| **Official INAV over MSP** | Full compatible configuration and persistent settings | Native INAV-compatible mission and planning-data read/write | Wired telemetry is available; Flight Commander-only controls remain disabled |
| **Official INAV over MAVLink** | Not a replacement for the wired MSP setup link | Lossless navigation-only mission subset; Flight Commander terrain/photo extensions are rejected | Telemetry only in Flight Commander; Ground Control commands are disabled |
| **LTM** | None | None | Read-only telemetry |
| **Other firmware over MAVLink** | Unsupported | Disabled | Telemetry may identify the vehicle, but configuration, missions, and commands remain blocked |

INAV-compatible interruption checkpoints are position-estimated, and the
persistent `nav_wp_mission_restart` policy is managed over MSP. Resume is
intended for the same powered flight controller; power loss invalidates the
checkpoint.

Firmware flashing is a separate bootloader operation, not an airborne MAVLink
Ground Control command. Official INAV and Flight Commander Firmware use the
same target discovery and STM32/DFU machinery. Flight Commander Firmware HEX
files must use a recognized release filename, contain the compiled `FCFW`
identity marker, and match the selected target. Official INAV mode rejects an
image containing that marker. Raw STM32 DFU cannot report a board model and
therefore still requires manual hardware-target confirmation. Always verify
the detected identity, selected family, target, and firmware before writing.

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

## Documentation and support

Flight Commander's maintained documentation starts in the
[Documentation & Support hub](docs/README.md). It links the operating guides,
release downloads, issue tracker, and contribution workflow owned by this
project. INAV references are retained only where an inherited compatibility
feature specifically requires upstream INAV behavior.

## Install

The validated publication target for the reconstructed release is **Windows
x64**. Every source-backed Configurator release publishes four explicit downloads on
[GitHub Releases](https://github.com/srt3262/Flight-Commander/releases):

- `Flight-Commander-Configurator-Windows-x64-vX.Y.Z.zip` is the portable
  Windows application. Extract it into a new folder and run
  `flight-commander.exe`.
- `Flight-Commander-Configurator-Source-vX.Y.Z.zip` is the matching source from
  the exact commit used to build and verify that Windows archive.
- `Flight-Commander-Firmware-X.Y.Z-MICOAIR743.hex` is the directly flashable
  firmware image under its truthful embedded firmware version. A
  Configurator-only release may therefore publish a lower firmware version
  without wrapping or relabeling the binary.
- `Flight-Commander-Firmware-Source-vX.Y.Z.zip` is the exact corresponding
  firmware source. Its manifest pins the source revision/tree, deterministic
  build epoch, compiler, HEX size, and hashes needed to reproduce the image.

Every published Configurator update advances its software version. If the
update changes firmware, the firmware is rebuilt and its complete version must
match the Configurator release. A strictly software-only update may reuse the
verified firmware binary under its existing version, but Configurator and
firmware always remain in the same major release series. When a firmware
release requires Configurator changes, both Configurator downloads are
mandatory companion assets for the coordinated release.

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

Flight Commander is an independent project and is not an official INAV release.
