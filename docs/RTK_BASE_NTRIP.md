# USB RTK base and NTRIP

Flight Commander's **Ground Control** tab contains RTK correction setup below
the map, HUD, and telemetry. Its USB-base connection is independent from the
flight-controller setup or telemetry link. The desktop
application, not the flight controller, connects to an NTRIP caster. Only
validated RTCM3 correction messages cross the aircraft link.

The USB base, survey-in, caster lookup, NTRIP refinement, fixed-base
finalization, and live RTCM monitoring all work while the aircraft is powered
off. Connecting an aircraft is the final handoff, not a prerequisite for base
setup.

## Correction modes

| Mode | RTCM source | RTCM destination | Internet required |
| --- | --- | --- | --- |
| Survey-in USB Base → Aircraft | A USB-connected u-blox F9 in survey-in or fixed-base mode | Flight Commander Firmware, then every enabled UART and DroneCAN rover | No |
| Direct NTRIP → Aircraft | The selected caster mountpoint | Flight Commander Firmware, then every enabled UART and DroneCAN rover | Yes |
| NTRIP-refined USB Base → Aircraft | The caster temporarily positions the USB F9; the finalized F9 then generates local corrections | USB F9 during setup, then every aircraft rover | During setup only |

Only one source is active for aircraft forwarding at a time. A USB base and an
NTRIP stream may remain connected for setup and diagnosis, but the **Active
correction source** selector determines which stream can reach the aircraft.

## Native free-caster connection

Flight Commander contains its own NTRIP client; RTKLIB, SNIP, u-center, and
other bridge applications are not required. The built-in **RTK2go public
caster (free)** preset configures `rtk2go.com:2101`, loads the live caster
sourcetable, filters it to no-fee RTCM3 streams, and sorts streams by distance
from the USB receiver when coordinates are available. RTK2go asks rover users
to enter a valid email address as the username and leave the password blank.

The preset does not imply universal coverage. A useful live mountpoint must be
available near the base, and the selected stream must be compatible with the
receiver and intended datum. **Custom / regional NTRIP caster** remains
available for free state, national, university, community, or private
services. Flight Commander reads each caster's sourcetable rather than
shipping a stale mountpoint list.

## Direct NTRIP corrections

1. Open **Ground Control**, scroll to **RTK correction setup**, and choose
   **Direct NTRIP → Aircraft**. A local USB receiver is not required.
2. Connect Flight Commander Firmware over MAVLink telemetry or wired MSP.
3. Enter the caster host, port, mountpoint, and credentials. Enter only the
   host name or IP address—do not include `http://` or `https://`.
4. Enable TLS when the caster supports it. Certificate validation remains on.
5. Select **Aircraft rovers (direct NTRIP)** as the RTCM destination.
6. For a VRS/NEAR mountpoint, select **Aircraft position** as the periodic GGA
   source. A valid aircraft GPS position is required before connecting. For a
   fixed physical mountpoint that does not request GGA, select **None**.
7. Connect NTRIP and select **NTRIP caster** as the active source.

The client accepts NTRIP v2 HTTP responses and common NTRIP v1 `ICY 200`
streams, supports normal and HTTP chunked bodies, and checks every RTCM3 frame
with CRC-24Q. Each valid frame is fragmented according to MAVLink
`GPS_RTCM_DATA` rules. On a wired MSP setup link, the same fragment format is
carried by Flight Commander's private MSPv2 correction endpoint.

## Local USB base

1. Attach the RTK receiver directly to the GCS computer over USB and select its
   separate serial device in **Ground Control → RTK correction setup**. Choose
   **Survey-in USB Base → Aircraft**. The flight controller and base
   receiver cannot share the same COM port.
2. Select the u-blox F9 profile and configure either:
   - **Survey-in**, with a minimum observation time and accuracy limit; or
   - **Fixed surveyed position**, using latitude, longitude, WGS84 ellipsoid
     height, and an honest surveyed-position accuracy.
3. Wait for survey-in to become valid, or verify the fixed antenna reference
   point, before using the correction stream.
4. Select **Local USB base** as the active correction source and enable
   forwarding.

The F9 configuration enables RTCM 1005 plus selected MSM7 observation messages
on USB. GLONASS also enables message 1230. Base mode explicitly disables RTCM
input on that USB interface, preventing the receiver from consuming caster
corrections while it is transmitting local-base corrections.

## Drone-off survey and NTRIP-refined local base

This workflow gives a portable F9 a corrected absolute position before it
becomes a local base. It is not a substitute for a surveyed monument when
repeatable geodetic coordinates are required.

1. Leave the aircraft powered off. Connect the USB F9 to the GCS, select its
   dedicated COM port, choose **Survey-in**, and apply the base configuration.
2. Wait until survey-in is complete and valid. Flight Commander retains the
   surveyed position as the restoration point if refinement is cancelled.
3. Select the RTK2go free preset or a custom free service, enter any required
   username, and choose **Load streams**. Select a nearby compatible RTCM3
   mountpoint. When the stream requires NMEA, Flight Commander uses the
   surveyed USB receiver position for GGA.
4. Choose **Start NTRIP refinement**. Flight Commander first opens
   and validates the caster while the receiver is still a valid local base.
   Only after the stream is accepted does it temporarily disable F9 time mode
   and local RTCM output, enable RTCM input, and operate the F9 as a rover.
5. Keep the antenna motionless while Flight Commander collects at least ten
   consecutive RTK Fixed position samples. Losing RTK Fixed restarts this
   stability window instead of averaging float or standalone fixes.
6. Choose **Finalize refined fixed base**. Flight Commander averages the
   stable samples, disconnects NTRIP, writes the averaged coordinates and a
   conservative accuracy into F9 fixed-base mode, disables USB RTCM input, and
   resumes local RTCM output.
7. Confirm **Local USB base** is active and watch live RTCM message counts. The
   aircraft can remain powered off for all preceding steps and for any desired
   base-stability observation period.
8. Power the aircraft and connect Flight Commander Firmware over MAVLink (or
   wired MSP for bench setup). The next fresh local-base RTCM frame is sent to
   the aircraft and fanned out to every enabled UART and DroneCAN rover.

Corrections observed while the aircraft is absent are counted as standby
frames but are never buffered for later replay. Old corrections would already
be stale when the link appears, so only live frames generated after the route
becomes available are transmitted.

Flight Commander refuses caster-to-USB correction routing unless that USB F9
was explicitly prepared for NTRIP positioning during the current connection.
Reconnecting the USB receiver clears that authorization so a different device
cannot inherit the previous receiver's state.

After finalization, internet access and NTRIP are no longer required for that
session's local-base correction stream. The fixed USB base generates its own
RTCM observations for the aircraft rover.

## Security and operational boundaries

- NTRIP passwords are held only in memory and are never written to application
  settings or release logs. Host, port, mountpoint, username, and non-secret
  options may be saved.
- Without TLS, Basic-auth credentials and correction data are unencrypted.
- TLS uses normal certificate and host-name verification; there is no
  insecure-certificate bypass.
- unsupported firmware cannot use Flight Commander's GCS RTK-base bridge. The
  connected firmware must identify as Flight Commander Firmware and advertise
  the `GCS_RTK_BASE` capability.
- The MICOAIR743 firmware fans a completed RTCM message out to every enabled
  u-blox UART GPS and DroneCAN GPS. Selecting the navigation primary does not
  disable corrections or RTK status on the other receiver.
- A 720-byte maximum and bounded queues prevent an RTCM source from consuming
  unbounded GCS or flight-controller memory. Oversized, corrupt, stale, or
  incomplete data is dropped and counted.

Perform first validation with propellers removed. Confirm caster mountpoint,
datum, antenna coordinates, baud rate, CAN termination, correction age, and
independent RTK state on every rover before controlled flight testing.
