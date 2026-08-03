# Getting started

This guide takes a new installation from download to a safe, backed-up bench
configuration. Keep propellers removed throughout setup and testing.

## Install Flight Commander

1. Open [Flight Commander Releases](https://github.com/srt3262/Flight-Commander/releases).
2. Download the current `Flight-Commander-Configurator-Windows-x64-vX.Y.Z.zip`.
3. Extract the entire archive to a normal writable folder. Do not run the
   executable from inside the ZIP.
4. Start Flight Commander. Unsigned development releases can trigger Windows
   SmartScreen; verify that the archive came from the repository release before
   choosing to run it.
5. Leave the separately published firmware HEX untouched until you have read
   [Firmware flashing](FIRMWARE_FLASHING.md).

The portable package keeps its runtime files beside the executable. Moving only
the EXE out of the extracted folder will break native serial support.

## Safety before connection

- Remove every propeller or mechanically disconnect propulsion.
- Secure the airframe so calibration and motor tests cannot move it into people
  or equipment.
- Use USB power only until a page explicitly requires the main battery.
- Confirm the board target printed on the hardware and the detected target in
  Flight Commander.
- Back up a working configuration before changing firmware, ports, mixer,
  receiver, outputs, modes, failsafe, navigation, or tuning.
- Treat the first armed test after any configuration change as a new aircraft.

## First connection checklist

1. Connect the flight controller directly by USB.
2. Select its COM port in the top bar.
3. Leave protocol on **Auto protocol** for a normal wired setup connection.
4. Use the firmware's configured MSP baud rate; `115200` is the common wired
   default. A USB virtual COM port may ignore the displayed rate, but selecting
   the configured value avoids ambiguity on UART adapters.
5. Select **Connect** and wait for the firmware family, version, and hardware
   target to appear below the Flight Commander logo.
6. Open **Firmware Features**. Flight Commander-only pages must remain gated
   unless the connected firmware advertises the corresponding capability.
7. Open **Setup**, confirm that the model orientation follows the real airframe,
   and inspect sensor and arming warnings.
8. Use the **Firmware Flasher** backup controls or CLI `diff all` to preserve the
   current configuration before making broad changes.

If auto protocol cannot identify the controller, use
[Connection modes](CONNECTIONS.md) to choose MSP, MAVLink, or LTM deliberately.

## Recommended initial setup order

1. **Firmware Features** — verify identity and supported Flight Commander
   extensions.
2. **Calibration** — calibrate accelerometer and every detected enabled
   physical compass.
3. **Alignment Tool** — define flight-controller and sensor mounting rotations.
4. **Ports** — assign each UART exactly once and set its function/baud rate.
5. **Mixer** and **Outputs** — verify airframe type, motor order, direction, and
   output protocol with propellers removed.
6. **Receiver** and **Modes** — check channel order/endpoints, arm/prearm, flight
   modes, and command AUX mappings.
7. **Failsafe** — configure and bench-test loss of RC and navigation sources.
8. **GPS** — configure UART or DroneCAN receivers, primary navigation source,
   RTK correction paths, and heading sources.
9. **Tuning** — start from a suitable preset and change one controlled group at
   a time.
10. **OSD**, logging, and mission planning — configure operational awareness and
    evidence before flight.

The full tab-by-tab explanation is in
[Configuration reference](CONFIGURATION_REFERENCE.md).

## Application options

Use the gear button in the upper-right corner for Configurator-wide behavior.

- **Units** controls metric, imperial, or OSD-derived display conversion. Ground
  Control, RTK, and Flight Planner preserve canonical SI values internally and
  convert only the displayed/editor values.
- **Map provider** selects the map source used by Ground Control and Flight
  Planner. Optional provider credentials remain local to the application.
- **Profile highlighting** marks controls whose values belong to control,
  battery, or mixer profiles.
- **CLI autocomplete** enables the advanced command completion interface.
- **3D acceleration** can be disabled if hardware-accelerated previews fail to
  render; restart the application afterward.

## Save, reboot, and verify

Most connected-aircraft pages stage values in the UI and write them only when
you press **Save**, **Save and Reboot**, or the page-specific equivalent. A
successful reboot is not proof that the values are correct.

After each important change:

1. Reconnect and reopen the page.
2. Confirm the value read back from firmware.
3. Check arming flags and sensor status.
4. Export a new backup when the configuration reaches a known-good milestone.
5. Bench-test the affected function before reinstalling propellers.

## Next guides

- [Connection modes](CONNECTIONS.md)
- [Firmware flashing](FIRMWARE_FLASHING.md)
- [Configuration reference](CONFIGURATION_REFERENCE.md)
- [Troubleshooting](TROUBLESHOOTING.md)
