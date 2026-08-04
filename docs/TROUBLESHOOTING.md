# Troubleshooting

Start with propellers removed, a direct USB connection, a known data cable, and
a saved backup. Change one variable at a time.

## Flight controller does not connect

1. Close every other serial/configurator program.
2. Unplug/replug and select the COM port that appears.
3. Use Auto protocol for direct USB, then explicitly try MSP at the configured
   baud when detection fails.
4. Remove radios, hubs, and USB extensions.
5. Inspect Windows Device Manager for driver/device errors.
6. Try the bootloader only if application firmware is actually unavailable.

## Reboot reconnect stalls

Wait for the board to finish initializing and for Windows to recreate the COM
port. Flight Commander performs bounded close/reopen recovery. If it stops in a
clean disconnected state, select the reappeared port and connect again. A board
that repeatedly changes COM identity may have a cable, driver, power, or
boot-loop problem.

## Firmware target cannot be fetched

- Verify the family is **Flight Commander Firmware** when the connected board
  reports `FCFW`.
- Wait for online and bundled catalogs to finish loading before auto-target.
- Confirm the detected target/alias exists in the selected release.
- Use **Download Online Firmware** for GitHub, **Use Bundled Firmware** for the
  installed verified image, or **Select Local Firmware File** for a disk HEX.
- Never select a different target merely to populate the version list.

See [Firmware flashing](FIRMWARE_FLASHING.md).

## GPS or RTK module is missing

- UART F9/F9P: assign the UART's **GPS** function in Ports, set `115200` unless
  deliberately configured otherwise, then explicitly choose
  **u-blox F9P / F9-series (RTK Rover)** in GPS.
- DroneCAN: confirm bus bitrate, power, termination, node discovery, and the
  firmware's DroneCAN GPS/RTK capabilities.
- A module/compass will appear in Alignment only when the corresponding Flight
  Commander capability and heading configuration are available.

See [GPS and RTK](GPS_AND_RTK.md).

## RTK never reaches Fixed

Check 3D fix, common constellations, antenna view, correction age, RTCM message
types, base distance, base position, and stream counters. A connection to an
NTRIP caster is not proof that the mountpoint suits the rover. Test loss and
recovery deliberately.

## Compass calibration values do not change

- Confirm the correct physical compass card/source/node is enabled.
- Keep the aircraft disarmed and follow the full orientation sequence.
- Remove magnetic/current interference.
- Wait for completion, then let Flight Commander reload both legacy and
  Flight Commander heading schemas.
- Reopen Calibration and inspect per-axis coefficients/status.
- Set mounting rotation in Alignment Tool; calibration and alignment are
  separate.

## MICOAIR743 heading is roughly 90 degrees wrong or drifts after calibration

Open Alignment and record the active INAV target alignment plus the live axis
diagnostics. Flight Commander 3.0.1 does not force a MICOAIR743 compass
rotation; it preserves the official INAV 9.1.0 target behavior and the normal
editable alignment settings. Verify the board is installed as represented,
apply only the measured installation correction, save and reboot, then complete
one normal calibration away from steel, wiring current, speakers, magnets,
vehicles, and reinforced concrete. Do not mask a fixed axis error with magnetic
declination.

## Ground Control command is visible but disabled

Hover/read the disabled reason. Common causes are MSP instead of MAVLink, no
heartbeat, Official INAV compatibility mode, missing firmware capability,
multiple systems on the link, no cached MSP command profile, missing AUX
mapping, or an unconfirmable target mode. Do not bypass a disabled state with a
raw command.

## Units are inconsistent

Set units in Application Options, reopen Ground Control, and verify the local
switch agrees. Relative altitude and MSL altitude use the same distance unit;
they can show different numbers because their reference datums differ. Mission
and RTK protocol data remain SI internally.

## SITL shows no simulator motion

Confirm SITL is started, simulator input is enabled, IP/port match, the
simulator plugin/output is active, and channel mapping is non-empty. For local
software use `127.0.0.1`. Disable the serial receiver bridge until base simulator
data works. See [SITL](SITL.md).

## Documentation link is wrong or missing

Flight Commander 2.0.5 and newer route tab help, CLI help, settings help, OSD,
tuning, and SITL documentation to this repository. Report the exact tab,
control, displayed URL, and Configurator version if any active product-help link
still opens another project's manual.

## Report an issue

Open a [Flight Commander issue](https://github.com/srt3262/Flight-Commander/issues)
with Configurator version, OS, target, firmware family/version, link/protocol/
baud, peripheral model, reproducible steps, expected/actual result, and safe
logs/screenshots. Remove credentials and unnecessary private coordinates.
