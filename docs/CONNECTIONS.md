# Connection modes

Flight Commander has two supported aircraft links: wired MSP for persistent
setup and MAVLink for live Ground Control. Both require Flight Commander
Firmware. Selecting a protocol never converts or authorizes foreign firmware.

## Connection mode summary

| Link | Primary purpose | Configuration | Missions | Ground Control commands |
| --- | --- | --- | --- | --- |
| Flight Commander Firmware over MSP | Bench setup over USB/UART | Full persistent configuration | Native persistent mission read/write | Wired telemetry only; airborne commands require MAVLink |
| Flight Commander Firmware over MAVLink | Live aircraft/radio link | Not a replacement for MSP setup | Active mission transfer and Flight Commander extensions | Telemetry plus commands after link/profile checks |

LTM is telemetry-only because it cannot carry mission transfer or Ground
Control command traffic. Use MAVLink for those operations.

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

The connection may expose inherited low-level MSP variant fields and an
optional versioned `FCFW` payload. Those values are reported as diagnostics;
they do not gate setup tabs or Flight Commander features.

Recommended sequence:

1. Connect by direct USB with propellers removed.
2. Verify the expected target, sensors, configuration, and optional firmware
   version metadata.
3. Change one coherent configuration group.
4. Save/reboot if requested.
5. Reconnect and verify readback.

## MAVLink live link

MAVLink supplies live telemetry, mission transport, and Ground Control
commands. A valid vehicle heartbeat establishes the transport and vehicle IDs.
Optional `AUTOPILOT_VERSION` metadata may report the firmware version, but a
missing or older payload does not disable the link. Aircraft-specific AUX/mode
commands still require one unambiguous profile captured during wired MSP setup.

For an ExpressLRS transmitter module exposed as a Windows COM port, select
**Ground Control / MAVLink**. Flight Commander defaults that protocol to
`460800` baud and keeps DTR low on Windows. Change the rate only when the radio
has been configured differently.

Exactly one intended aircraft must be present on a command-capable link. A
heartbeat alone does not bypass link, arming, mission, or aircraft-profile
safety checks.

## USB RTK base connection

The USB RTK base port inside Ground Control is independent from the aircraft
port in the header. A base can survey while the aircraft is powered off. Never
select the same local serial device for both roles. Correction forwarding
requires an active Flight Commander MSP or MAVLink aircraft transport.

See [USB RTK base and NTRIP](RTK_BASE_NTRIP.md).

## Connection diagnostics

The bottom status bar reports packet errors, I2C errors, cycle time, CPU load,
MSP version/load/round-trip, hardware round-trip, and arming flags. The serial
log distinguishes an open transport, decoded MAVLink frames, vehicle
heartbeats, optional version metadata, and heartbeat loss/recovery.

When troubleshooting, record the selected port, protocol, baud rate, exact
message text, controller target, firmware version, and whether the failure
occurred before or after the first valid vehicle heartbeat.
