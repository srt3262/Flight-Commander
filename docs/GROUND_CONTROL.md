# Ground Control

Ground Control combines live aircraft state, map, attitude HUD, mission status,
vehicle commands, and guided RTK correction setup. It remains available with no
aircraft connected so a mission or USB RTK base can be prepared first.

## Link and vehicle header

The header identifies the active transport and detected firmware family.

- **Flight Commander MSP wired** is the bench setup link. It supplies live
  telemetry, but airborne command buttons require a validated MAVLink link.
- **MAVLink · detecting Flight Commander Firmware** means a valid vehicle
  heartbeat has arrived while signed identity or a unique wired profile match is
  being resolved. Operational paths remain locked.
- **MAVLink · Flight Commander** supplies live telemetry, mission transport, and
  capability-gated commands after signed FCFW verification or a unique legacy
  Firmware 4.0.8 profile match.
- **MAVLink · unsupported firmware** means neither identity path was valid.
  Mission transfer, commands, configuration, and RTK forwarding are blocked;
  any visible telemetry is diagnostic only.
- **Offline RTK setup** means the aircraft is disconnected but the lower RTK
  workspace can still operate an independent USB base.

The link, armed state, selected flight mode, and command explanation are always
visible. Unsupported firmware never enters a reduced-functionality operating
mode; command and mission paths stay blocked.

## Map and HUD

The live map and HUD stay side by side. **Make HUD major** / **Make map major**
changes their column widths and ordering; neither pane floats over or obscures
the other.

- Map style selects the available satellite/street layer combination.
- **Center vehicle** follows a valid aircraft position. A no-fix `(0,0)` value
  is rejected instead of moving the map to Null Island.
- The map displays the loaded mission, current vehicle point, and active leg
  when the transport provides them.
- The HUD displays attitude, heading, speed, relative-altitude tape, navigation
  state, GPS state, battery, and link status.

## Telemetry tiles

The compact grid sits immediately below both live views.

| Tile | Meaning |
| --- | --- |
| Mode | Confirmed/current firmware flight mode |
| Relative altitude | Height relative to the established home/reference altitude |
| Altitude (MSL) | GPS/MAVLink altitude above mean sea level |
| Ground speed | Horizontal speed over the ground |
| Heading | Current heading in degrees |
| Climb | Vertical speed; positive is climbing |
| GPS | Fix class and visible satellite count |
| Battery | Reported voltage and remaining percentage |
| Roll / Pitch | Aircraft attitude angles |
| Latitude / Longitude | Current geographic position |
| Mission state | No mission, ready, active, paused, or complete |
| Mission progress | Current item and total when known |
| Next waypoint | Distance to the active/estimated next mission point |

MSL and relative altitude are deliberately adjacent. They answer different
questions and can legitimately differ by the home elevation. Unavailable data
shows `--`; Flight Commander does not substitute airspeed or relative altitude
for a missing MSL value.

## Metric and imperial units

Ground Control follows Flight Commander's global unit setting. The local switch
updates that same preference, including RTK and HUD values.

- Metric altitude/distance uses meters and speed uses meters per second.
- Imperial altitude/distance uses feet, horizontal speed uses miles per hour,
  and climb uses feet per second.
- Protocol messages, command inputs, and persisted configuration remain in
  canonical SI units; conversion occurs only at the display/editor boundary.

## Vehicle commands

The command deck includes:

- **Start Mission** — begins the stored mission from its initial valid state.
- **Resume Mission** — resumes a same-session interruption checkpoint after the
  route and aircraft identity are revalidated.
- **Abort Mission** — confirms before leaving AUTO for a supported hold/loiter
  mode, with return-home fallback only when hold is unavailable.
- **Launch / Takeoff** — uses the entered altitude after converting it to the
  protocol's canonical units.
- **Return Home (RTH / RTL)** — requests the configured return mode.
- **Land** — appears even when disabled; the connected firmware must advertise
  a safe, confirmable landing command path.

Flight Commander does not infer permission from a visible button. A command can
require a live MAVLink heartbeat, Flight Commander firmware identity, matching
capability, known system/component ID, exactly one intended aircraft, a cached
MSP command profile, valid AUX mappings, and a confirmable resulting state.

Never use Ground Control commands as the first test of arm, launch, mission,
return, or land behavior. Verify equivalent RC/AUX behavior on the bench and
keep a pilot-controlled abort path.

## Mission status and messages

The active mission route is loaded from the current transport. For a supported
Flight Commander MAVLink stream, Flight Commander can estimate progress from
aircraft position when an explicit mission-current item is unavailable. An
estimated item is labeled and is never silently treated as firmware-confirmed.

Autopilot messages preserve time and source context. Read warnings before
sending another action; repeated commands can hide the first causal message.

## Guided RTK setup

Scroll below messages to choose one of three workflows:

1. Direct NTRIP corrections to the aircraft.
2. Survey-in USB base corrections to the aircraft.
3. NTRIP-refined USB base, then local fixed-base corrections.

Each path reveals only relevant controls and displays the next safe action. The
USB base port is independent from the aircraft port and can survey while the
aircraft is off. See [USB RTK base and NTRIP](RTK_BASE_NTRIP.md).

## Preflight Ground Control check

- Confirm the intended aircraft identity and link type.
- Confirm map position, heading, both altitudes, battery, and GPS state.
- Confirm the expected mission and route before Start/Resume.
- Read every disabled reason and active arming flag.
- Verify the RC pilot can override or abort the selected action.
- Test link loss and telemetry recovery on the bench.
