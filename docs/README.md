# Flight Commander documentation and support

This is the maintained manual for Flight Commander Configurator, Flight
Commander Firmware integration, Ground Control, mission planning, and RTK
operation. In-application help links point to these pages so the instructions
match the installed Flight Commander interface and its safety gates.

## Operator manual

| Area | Guide | Use it for |
| --- | --- | --- |
| First use | [Getting started](GETTING_STARTED.md) | Installation, application options, first connection, backup, and initial bench setup |
| Links | [Connection modes](CONNECTIONS.md) | MSP, MAVLink, LTM, USB radios, baud rates, and transport limitations |
| Firmware | [Firmware flashing](FIRMWARE_FLASHING.md) | Online, local, and offline firmware sources; target checks; DFU recovery |
| Aircraft setup | [Configuration reference](CONFIGURATION_REFERENCE.md) | Every connected-aircraft configuration tab and save/reboot behavior |
| Navigation | [GPS and RTK](GPS_AND_RTK.md) | UART F9 RTK rovers, DroneCAN GPS, primary receivers, corrections, and alignment |
| Live operation | [Ground Control](GROUND_CONTROL.md) | Map, HUD, telemetry, commands, units, messages, and guided RTK workflows |
| Missions | [Flight Planner](FLIGHT_PLANNER.md) | Waypoints, surveys, terrain, transfer, validation, and same-session resume |
| Command line | [CLI command reference](CLI.md) | CLI safety, commands, backup/restore, profiles, ports, and passthrough |
| Variables | [Settings reference](SETTINGS_REFERENCE.md) | Exact setting names exposed by Configurator pages and target-specific lookup |
| Control response | [Tuning](TUNING.md) | Profiles, PID/rate/filter workflow, Rate Dynamics, AutoTune, and adjustments |
| Video display | [OSD](OSD.md) | Layouts, elements, alarms, custom messages, fonts, and character map |
| Diagnostics/code | [Logging and programming](LOGGING_AND_PROGRAMMING.md) | Onboard/tethered logs, logic, programming, and JavaScript |
| Simulation | [Software in the loop](SITL.md) | RealFlight/X-Plane setup, profiles, channel mapping, serial receivers, and limits |
| Recovery | [Troubleshooting](TROUBLESHOOTING.md) | Connection, flashing, GPS/RTK, calibration, command, and display problems |

## Flight Commander feature guides

- [USB RTK base and NTRIP workflows](RTK_BASE_NTRIP.md)
- [Heading fusion, compass sources, calibration, and moving-baseline yaw](HEADING_FUSION.md)
- [Configurator and firmware versioning](FLIGHT_COMMANDER_VERSIONING.md)
- [Source reconstruction and upstream provenance](RECONSTRUCTION.md)
- [Release notes](../CHANGELOG.md)
- [Verified Windows, Configurator source, firmware HEX, and firmware source downloads](https://github.com/srt3262/Flight-Commander/releases)

## Documentation boundaries

The connected firmware is authoritative for the commands, settings, ranges,
and capabilities available on a particular hardware target. Flight Commander
queries that metadata at runtime and hides or disables unsupported controls.
The manual explains the complete Configurator workflow and how to query the
controller for target-specific details; it never assumes that every optional
feature exists on every board.

Flight Commander retains GPL-licensed INAV compatibility code and explicitly
labels Official INAV compatibility mode, but Flight Commander product help and
support belong here. Upstream links are retained only where provenance or a
third-party dependency is the subject.

## Get support

Use the [Flight Commander issue tracker](https://github.com/srt3262/Flight-Commander/issues)
for defects, setup problems, documentation gaps, and focused feature requests.
Include:

1. Flight Commander Configurator version and operating system.
2. Flight-controller target and exact firmware family/version.
3. Connection type, protocol, baud rate, and peripheral model.
4. Steps that reproduce the problem and the result you expected.
5. Configurator logs, screenshots, CLI `diff all`, or Blackbox evidence when
   relevant. Remove passwords, NTRIP credentials, private caster addresses,
   and other secrets first.

## Contribute

Source and documentation improvements are welcome. Follow the
[repository contribution workflow](../README.md#contributing), preserve the
Flight Commander/Official INAV compatibility boundary, and add regression
coverage for runtime or packaging changes.
