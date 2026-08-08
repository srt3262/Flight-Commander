# Connection modes

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
vehicle IDs, but it does not prove the firmware family. A signed
`AUTOPILOT_VERSION` FCFW signature and capability bitmap are authoritative.
Legacy Flight Commander Firmware 4.0.8, which predates that MAVLink payload,
can instead be identified from exactly one controller-matched Flight Commander
profile captured during a prior wired MSP setup connection.

If neither identity path succeeds, or the cached system ID is missing or
ambiguous, the vehicle is marked unsupported and mission, command,
configuration, and RTK-forwarding paths stay blocked.

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
