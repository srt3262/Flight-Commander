# Heading fusion and moving-baseline yaw

Flight Commander Firmware 2.0.6 can keep four heading sources live at the
same time. The Configurator exposes them only when the connected controller
advertises `HEADING_FUSION`; moving-baseline controls additionally require
`MOVING_BASELINE_YAW`.

| Source | Data path | Calibration and validity |
| --- | --- | --- |
| Onboard compass | MICOAIR743 IST8310 on I²C2 | Uses the normal compass alignment, declination, and calibration |
| UART GPS-module compass | The GPS position stream uses UART; the module's separate SDA/SCL wires use the MICOAIR743 external I²C1 connector | Select hardware and mounting alignment in GPS, then run compass calibration |
| DroneCAN GPS-module compass | Selected CAN node publishing `uavcan.equipment.ahrs.MagneticFieldStrength2` | Flight Commander stores a hard-iron offset and per-axis gain for the selected node, then applies mounting rotation, freshness, magnitude, and yaw-offset guards |
| Moving-baseline GNSS yaw | u-blox `UBX-NAV-RELPOSNED` on UART or `ardupilot.gnss.RelPosHeading` from the selected DroneCAN GPS node | Requires valid relative heading, acceptable accuracy and antenna separation, and RTK Fixed when that option is enabled |

A combined GPS/compass CAN module can be assigned to both the GPS and compass
roles. UART and DroneCAN navigation receivers remain peers: selecting one as
the navigation primary does not stop the other receiver, its compass, its RTK
state, or its correction stream.

## Priority and weight

Every enabled source with non-zero weight has a unique priority from 1 through
4. Priority 1 is the current authority and disagreement anchor. If it becomes
unavailable, the next healthy priority takes over automatically.

All healthy sources that agree with the authority within the configured guard
contribute to the correction. Weight 100 contributes twice as much as weight
50 at equal measured quality. A weight of zero disables contribution and is
not a substitute for configuring two active sources with the same priority.

Flight Commander excludes a source when any applicable guard fails:

- a local compass has not completed calibration or stops producing data;
- a CAN sample is stale, non-finite, outside a plausible Earth-field
  magnitude, or comes from an unselected node;
- a relative-heading message is stale or invalid;
- reported baseline length falls outside the expected separation plus/minus
  tolerance;
- heading accuracy exceeds the configured maximum;
- **Require RTK Fixed** is enabled and the UART carrier solution or selected
  DroneCAN GPS fix is not RTK Fixed; or
- its heading disagrees with the current authority by more than the configured
  maximum.

The GPS tab reports each source as active, healthy standby, rejected, or
unavailable/stale. It also reports the authority, fused heading, relative
heading, baseline distance, accuracy, provider, node, and fixed state.

## Compass calibration

After selecting compass hardware, CAN nodes, and mounting alignment, save and
reboot before calibration. With the aircraft disarmed, use **Calibrate enabled
compasses** in GPS (or the normal Compass Calibration action), then rotate the
complete aircraft slowly through all orientations for the full 30-second run.

### MICOAIR743 onboard IST8310 orientation

The onboard IST8310 is mounted at an unflipped 90-degree yaw rotation relative
to the MICOAIR743 flight-controller axes. A neutral/default magnetometer
alignment can select an inherited flipped transform; calibration cannot repair
that fixed axis error because calibration estimates offsets and per-axis gain,
not sensor mounting rotation.

Flight Commander 2.0.6 sets the board-correct orientation in firmware and the
Configurator also detects the board and physical onboard compass before a
calibration run. If the stored rotation is not **CW90 (unflipped)**, Calibration
blocks the run and offers **Apply orientation, reset calibration, and reboot**.
Use that once, reconnect, and then perform the normal compass calibration. The
orientation and calibration are stored in the controller and do not need to be
repeated at each startup. Recalibrate after changing the airframe installation,
power wiring, nearby magnetic hardware, compass module, or firmware defaults.

The release has one MICOAIR743 firmware target and one fixed onboard-compass
profile. GPS-module compasses remain independent peripherals whose mounting
rotation and calibration follow their actual installation.

One calibration command samples every enabled physical compass concurrently,
but each result is independent:

- the onboard IST8310 retains its own offset and gain;
- the external-I²C compass carried by a UART GPS module retains a separate
  offset and gain; and
- the selected DroneCAN compass receives its own hard-iron offset and
  per-axis gain in Gauss units. That result is bound to the transmitting CAN
  node ID, so automatic failover or reassignment to another module requires a
  new calibration.

An enabled magnetic source is excluded from fusion and blocks the calibrated
state until its calibration is valid. The GPS table distinguishes calibrating,
calibration-required, and calibration-failed states. A failed CAN run leaves
its gains invalid instead of silently reusing the previous module's values.
Moving-baseline yaw is not a magnetometer, so it uses antenna geometry,
alignment, accuracy, and carrier-fix validation instead of compass calibration.

## Moving-baseline setup

Moving-baseline yaw is not calculated from two ordinary latitude/longitude
positions. The GNSS pair must be configured to solve carrier-phase relative
position and emit a heading message.

For a UART u-blox pair, the moving-base receiver sends its correction stream
directly to the heading rover according to the module vendor's wiring and
configuration. The rover connected to the flight-controller GPS UART must
emit `UBX-NAV-RELPOSNED`. The flight controller therefore needs one UART data
connection for the paired solution; it does not infer yaw by subtracting two
independent UART fixes.

For DroneCAN, the selected GPS node must publish
`ardupilot.gnss.RelPosHeading`. Automatic provider selection uses the valid
UART or DroneCAN solution with the better reported heading accuracy.

1. Mount compatible antennas rigidly and measure phase-center separation,
   not merely enclosure spacing. The accepted configured range starts at
   0.30 m; a longer rigid baseline normally improves heading accuracy.
2. Configure the GNSS pair for moving-base operation and verify relative
   heading in the vendor tool before relying on Flight Commander.
3. In Ports, configure UART GPS and/or the DroneCAN GPS node. Assign a CAN
   compass node separately if the module publishes one.
4. In GPS, enable moving-baseline yaw, choose automatic/UART/DroneCAN input,
   enter expected separation and tolerance, set an accuracy limit, and leave
   **Require RTK Fixed** enabled for initial testing.
5. Choose unique priorities and weights. Use the yaw offset to describe the
   measured antenna vector relative to aircraft forward.
6. Save and reboot. With propellers removed, rotate the aircraft through known
   headings and deliberately interrupt each source to verify failover and live
   rejection state before controlled flight testing.

RTCM supplied by the USB base or native NTRIP client remains independent of
heading-source choice. Corrections continue to every enabled UART and
DroneCAN rover even when another receiver or a compass is the current heading
authority.
