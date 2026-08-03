# Connection modes

Flight Commander uses different links for persistent setup, live Ground
Control, and read-only telemetry. Choosing a protocol does not change what the
aircraft firmware actually supports.

## Connection mode summary

| Link | Primary purpose | Configuration | Missions | Ground Control commands |
| --- | --- | --- | --- | --- |
| Flight Commander Firmware over MSP | Bench setup over USB/UART | Full supported configuration | Native persistent mission transfer | Wired telemetry; airborne command availability still depends on a validated MAVLink command path |
| Official INAV over MSP | Compatibility setup | INAV-compatible configuration | Native INAV mission transfer | Flight Commander-only controls remain gated |
| Flight Commander Firmware over MAVLink | Live aircraft link | Not a replacement for MSP setup | Validated mission transfer and advertised extensions | Telemetry plus capability-gated commands |
| Official INAV over MAVLink | Live compatibility telemetry | No persistent setup | Lossless navigation subset only | Flight Commander native commands are disabled |
| LTM | Lightweight telemetry | None | None | Read-only telemetry |
| Unsupported MAVLink firmware | Identification only | Disabled | Disabled | Commands disabled |

## Top-bar controls

- **Port** selects the local serial device. Disconnect other configurators and
  terminal programs before opening it.
- **Baud** must match the configured UART or radio rate. Direct USB virtual COM
  connections can be tolerant, but radios and USB-to-UART adapters are not.
- **Protocol** can auto-detect or explicitly select the intended transport.
- **Wireless mode** adjusts serial behavior for links that cannot tolerate the
  same reconnect sequence as direct USB. Do not enable it merely because the
  aircraft has a radio receiver.
- **Connect/Disconnect** owns the selected port. Ground Control and Flight
  Planner remain available offline for planning and RTK base preparation.

## MSP setup link

Use MSP when changing firmware-owned configuration. This includes Ports,
Mixer, Outputs, Receiver, Modes, Failsafe, GPS, sensors, tuning, OSD, logging,
programming, and CLI.

The normal sequence is:

1. Connect by direct USB with propellers removed.
2. Verify firmware identity and target.
3. Change one coherent configuration group.
4. Save/reboot if requested.
5. Reconnect and verify readback.

Do not use an airborne telemetry link as a substitute for the bench setup path.

## MAVLink live link

MAVLink supplies live telemetry, mission transport, and supported Ground
Control commands. Flight Commander validates the detected firmware family,
system identity, cached MSP configuration profile, and advertised command
capabilities before enabling operational buttons.

For an ExpressLRS transmitter module exposed as a Windows COM port, select
MAVLink and use the radio's configured rate. Flight Commander's initial USB
MAVLink default is `460800` baud and it keeps DTR low on Windows to avoid
unintended radio reset behavior. Change the rate only when the radio has been
configured differently.

Exactly one intended aircraft must be present on a command-capable MAVLink
link. A telemetry heartbeat alone is not permission to arm, launch, change
mode, or start a mission.

## LTM telemetry

LTM is treated as telemetry only. It can populate Ground Control but cannot
write configuration, transfer a mission, or send Flight Commander commands.

## USB RTK base connection

The USB RTK base port inside Ground Control is independent from the aircraft
port in the header. This allows a base receiver to survey while the aircraft is
powered off. Never select the same local serial device for both roles.

See [USB RTK base and NTRIP](RTK_BASE_NTRIP.md).

## Connection diagnostics

The bottom status bar reports packet errors, I2C errors, cycle time, CPU load,
MSP version/load/round-trip, hardware round-trip, and arming flags. A connection
that opens but accumulates errors is not healthy.

If a link fails:

1. Disconnect every other application using the port.
2. Confirm the Windows COM number after unplug/replug.
3. Match the baud rate and explicit protocol.
4. Try a known data-capable USB cable and direct computer port.
5. Remove telemetry radios and hubs from the path for the first test.
6. Re-enter the bootloader only for a confirmed firmware/boot problem, not for
   a normal serial mismatch.

See [Troubleshooting](TROUBLESHOOTING.md) for recovery paths.
