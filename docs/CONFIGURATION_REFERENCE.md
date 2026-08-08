# Configuration reference

This page explains the connected-aircraft configuration tabs. Flight Commander
loads the setting schema from the controller, so unsupported controls can be
hidden or disabled and value ranges can differ by target or firmware build.

## How changes are stored

Controls are either live-read values, staged page values, or profile-owned
values. Use the page's **Save**, **Save and Reboot**, or equivalent action, then
reopen the page and verify readback. Navigating away is not a substitute for
saving. Profile-colored values belong to the selected control, mixer, or
battery profile.

Keep propellers removed for all configuration, calibration, mixer, output,
receiver, and mode testing.

## Setup

Setup is the initial health view. Use it to verify:

- firmware/target identity and the connected profile numbers;
- attitude response and board orientation;
- sensor presence and error counters;
- arming-disable reasons;
- configuration backup/restore where offered.

If the 3D model moves around the wrong axis, correct board/sensor alignment
before tuning or flight.

## Calibration

Calibration provides controls for each detected enabled physical sensor.

- Accelerometer calibration requires the airframe to be held still in the
  requested orientations.
- Compass calibration enumerates onboard, external/UART GPS-module, and
  DroneCAN compasses reported by Flight Commander Firmware.
- A calibration card shows the source, state, and coefficient readback. A
  completed animation alone is not success; verify updated coefficients and a
  calibrated status after the firmware response reloads.

Calibrate away from steel, current-carrying wires, speakers, magnets, vehicles,
and reinforced concrete. Moving-baseline GNSS yaw is not a magnetic compass and
does not use hard-iron compass calibration.

## Alignment Tool

Alignment defines how hardware axes relate to the aircraft. It does not repair
bad calibration data.

The target selector includes:

- legacy onboard/external magnetometer alignment;
- UART RTK GPS-module compass alignment when supported;
- DroneCAN RTK GPS-module compass alignment when supported;
- dual-RTK moving-baseline yaw offset when supported.

Select the actual target and enter its measured roll/pitch/yaw installation
rotation. Each target keeps an independent draft and saved field; changing one
preview does not rotate or overwrite another module. The F9, DroneCAN, and
moving-baseline graphics are connection-aware schematics, not automatic
identification of a specific commercial module. For a GNSS module without a
magnetometer, roll/pitch/yaw compass alignment is irrelevant; only a configured
moving-baseline yaw offset applies to GNSS heading. The GPS tab intentionally
has no duplicate orientation fields.

## Configuration

Configuration contains global aircraft behavior such as loop/sensor options,
battery and current sensing, arming, navigation prerequisites, beeper behavior,
and feature switches. Read disabled-state explanations before enabling a
feature: some controls require a compiled firmware feature or detected sensor.

Change one coherent group at a time and verify arming flags after reboot.

## Ports

Ports assigns functions to physical UARTs and the DroneCAN bus.

- Do not assign mutually exclusive functions to the same UART.
- Match the peripheral's baud rate at both ends.
- Keep at least one known MSP setup path.
- A UART RTK rover still uses the normal **GPS** serial function; RTK describes
  its correction capability, not a separate electrical protocol.
- DroneCAN GPS/RTK requires the advertised DroneCAN capabilities, a valid bus
  bitrate, correct termination, and node discovery/selection.

Save/reboot after port changes. If the setup link disappears, reconnect through
a different known MSP port or use a controlled recovery procedure.

## Mixer

Mixer defines the airframe type and the relationship between motor/servo
outputs and control axes. Select a matching preset, verify the diagram and
motor numbering, then inspect every generated rule. Custom mixers require an
independent mechanical review.

## Outputs

Outputs configures motor/servo protocols and provides guarded output testing.

1. Remove propellers.
2. Confirm motor numbering from the Mixer diagram.
3. Test one output at a time at the minimum effective level.
4. Verify rotation direction and reverse it using the supported ESC/motor
   workflow.
5. Confirm idle and endpoint behavior before installing propellers.

The header warning that PWM output is disabled is a real arming/actuation
state, not merely informational.

## Receiver

Receiver shows channel input, ordering, endpoints, center values, deadband, and
receiver protocol configuration. Verify that roll, pitch, yaw, and throttle
move in the correct direction and that every AUX switch has a stable range.
Do not proceed to mode setup with missing or ambiguous channels.

## Modes

Modes maps AUX channel ranges to arming, flight modes, mission actions, and
other firmware functions. Avoid overlapping ranges that can activate unsafe
combinations. Use a deliberate prearm/arm scheme and verify the active-mode
highlight while moving each physical switch.

Ground Control command buttons can depend on cached AUX mappings captured over
MSP. Configure and save those mappings before relying on MAVLink actions.

## Failsafe

Failsafe defines behavior after RC, navigation, or other required-source loss.
Choose behavior appropriate to the airframe and operating area, then bench-test
the exact loss sequence. Return-to-home requires a valid home, navigation fix,
and enough configured altitude/clearance; it is not automatically safer in
every environment.

## Tuning

PID Tuning, Advanced Tuning, and Adjustments are covered in the
[Tuning guide](TUNING.md). Preserve a known-good profile and make incremental
changes backed by logs.

## Firmware Features

Firmware Features displays the Flight Commander identity schema, protocol-baseline
version, target, capability bitmap, and one card per optional feature. These
cards are protocol gates. A disabled card means the Configurator will not infer
support from a version number or UI selection. Controllers without a supported
FCFW identity are rejected before configuration tabs unlock; there is no
stock-firmware compatibility mode.

## GPS and RTK

GPS configuration includes UART u-blox presets, the explicit F9 RTK rover
preset, DroneCAN GPS/RTK nodes, primary receiver selection, correction status,
and heading-source management. See [GPS and RTK](GPS_AND_RTK.md).

## Sensors

Sensors graphs raw and processed measurements. Use stationary traces to find
noise, bias, clipping, missing sensors, or wrong axes. Graph scaling can make a
small signal appear large; compare numeric range and units, not only shape.

## OSD

OSD configures display hardware, layouts, elements, alarms, fonts, and custom
messages. See the [OSD guide](OSD.md).

## LED Strip

LED Strip assigns positions, directions, functions, colors, and overlays to
addressable LEDs. Confirm the configured count and electrical power budget.
The flight controller signal output does not supply unlimited LED power.

## Logging and programming

Onboard Logging, Tethered Logging, Programming, and JavaScript Programming are
covered in [Logging and programming](LOGGING_AND_PROGRAMMING.md). Treat scripts
and logic conditions as flight-control configuration and test every branch.

## SITL

SITL connects Flight Commander to a supported simulator endpoint for software
testing. Simulation does not validate real sensor noise, wiring, power,
actuators, radio failsafe, GNSS environment, or airframe dynamics.

## Search

Search indexes the active Configurator's English UI labels and static setting
names and opens the relevant tab. For the controller's exact runtime setting
list, use CLI `get *`; see [Settings reference](SETTINGS_REFERENCE.md).
