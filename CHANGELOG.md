# Changelog

## 1.9.2

- Limited first-run airframe and prop-size presets to Control Profile 1. The
  transaction now selects Profile 1 before its first setting write, never
  selects or modifies Profiles 2 and 3, and leaves Profile 1 selected after a
  successful save.
- Corrected INAV 9.1 profile ownership for all EZ Tune fields and the
  fixed-wing altitude feed-forward/response fields used by Flight Commander
  presets. These settings can no longer be written to whichever control
  profile happened to be active when the controller connected.
- Added regression coverage for a controller initially connected on another
  profile, exact Profile 1 command ordering, untouched alternate profiles, and
  the no-profile-selection **Keep current settings** path.
- Fixed INAV save-and-reboot recovery opening the serial port before the
  controller was ready and remaining on **Connecting**. Flight Commander now
  performs a bounded full close/reopen retry on the same port, protocol, and
  baud, succeeds automatically once MSP responds, and returns to a clean
  disconnected state with a useful error after three failed attempts.

## 1.9.1

- Repaired INAV 9.1 first-run presets. Removed settings retired by the
  firmware, corrected canonical setting names, split Rover and Boat into their
  proper platform/mixer combinations, and added compatibility preflight so an
  unavailable or out-of-range required value stops before any controller
  write. The 3, 5, 7, 10, 12, 15, and 17-inch Quad X presets now carry
  complete prop-size EZ Tune starting profiles with progressively conservative
  large-prop filtering and response.
- Made **Keep current settings** a true preservation path: it writes only the
  first-run acknowledgement, saves it, and never selects or rewrites control
  or battery profiles.
- Restored visible M1-M4 labels in Mixer and Outputs even when a previous
  failed preset left the live motor-rule collection empty. Quad X and Quad
  Plus labels use INAV's mixer order, stay fixed when direction changes, and
  pair with verified Props-in/Props-out SVGs whose CW/CCW assignments invert
  exactly with `motor_direction_inverted`.
- Fixed every mirrored ArduPilot tab remaining on `Waiting for data ...` after
  selecting it. The OpenLayers map renderer no longer shadows JavaScript's
  native `Map`, so staged parameters, controller lookup tables, sensor
  histories, and tab initialization use the correct state container.
- Added initialization recovery that releases the shared tab-switch lock and
  displays the page error if a renderer fails, preventing one tab defect from
  making the rest of Flight Commander appear frozen.
- Added source regression gates for the distinct OpenLayers map class and
  native state maps, plus source and packaged-renderer checks for tab
  initialization recovery.

## 1.9.0

- Replaced the separate ArduPilot settings experience with Flight Commander's
  own INAV tab layouts, navigation, labels, controls, helpers, and workflows.
  The parity catalog accounts for all 450 front-end functions across 23 tab
  families and requires each one to use a direct mapping, coordinated
  multi-parameter translation, active ArduPilot-equivalent behavior, or
  MAVLink-backed workflow.
- Kept original Flight Commander rows visible when ArduPilot organizes the
  same function differently. Equivalent controls now explain their native
  semantics in place, and the complete All Parameters page remains available
  as an advanced fallback rather than a destination for missing translations.
- Added MAVLink-backed calibration, raw sensor and servo-output streaming,
  motor layout/testing, onboard and tethered log handling, Lua script transfer
  over MAVLink FTP, a parameter console, and translated Search.
- Fixed Flight Planner opening at Null Island before a GPS fix. Invalid or
  no-fix `(0,0)` telemetry is rejected, a valid home position is preferred when
  available, and the map otherwise retains its safe overview.
- Added exhaustive source and packaged-renderer gates for mirrored navigation,
  canonical layouts, translation coverage, active workflows, map-position
  selection, MAVLink FTP/log services, and the native parameter fallback.

## 1.8.1

- Replaced inherited pale inline battery/control-profile field colors with
  dark, high-contrast profile classes. Motors IDLE power, Throttle scale, and
  all other dynamically discovered profile settings now preserve visible text,
  borders, disabled states, and focus treatment throughout the app.
- Restored motor numbers 1-4 to the Quad X and Quad Plus diagrams in both Mixer
  and Outputs. Both tabs now use the same image-bound percentage layout, which
  is independent of SVG cache/load timing and remains aligned at each preview
  size.
- Added source and packaged-renderer regression gates for the profile colors,
  motor-label component, both tab integrations, and exact motor positions.

## 1.8.0

- Removed the light/dark selector and made Flight Commander dark-only. The
  final theme layer now loads after both inherited INAV and newer
  Flight Commander styles, with explicit contrast coverage for every active
  configuration family, disabled fields, alternating rows, PID surfaces,
  dialogs, and ArduPilot pages.
- Rebuilt first-connection INAV preset application as a bounded, sequential
  transaction. Every controller operation now settles on retry exhaustion or
  timeout, failures close the blocking progress modal and offer recovery, and
  success requires an EEPROM save plus `applied_defaults` read-back.
- Added INAV-style guided mappings to ArduPilot Configuration, Motors &
  Outputs, Safety & Failsafe, Sensors, GPS & Navigation, Power, OSD, and
  Logging. Controls resolve only against parameters actually reported by the
  connected vehicle, show their exact native parameter and official details,
  and preserve ArduPilot Extras and All Parameters fallbacks.
- Expanded ArduPilot PID Tuning with familiar Main PID Gains and Filters &
  Mechanics views plus synchronized numeric/slider editing for firmware
  parameters that publish safe limits.
- Added the reverse ArduPilot-to-INAV migration handoff: PX4 board identity can
  select the exact INAV target, but Flight Commander requires STM32 ROM DFU and
  full-chip erase instead of sending INAV CLI commands to ArduPilot.

## 1.7.1

- Fixed the ArduPilot Save, Save & Reboot, and refresh footer covering
  configuration fields. All six dedicated editor layouts now reserve a stable
  footer below an independently scrollable settings pane, so every parameter
  remains reachable at full-screen and minimum supported window sizes.
- Hid empty action-status rows and kept active save/reboot status messages in
  normal page flow instead of layering them over configuration content.
- Moved the connection control into a separate header lane below the global
  light/dark theme switch, preventing the theme control from obscuring Connect
  or Disconnect.
- Added source and packaged-renderer layout contracts for the reserved
  ArduPilot footer and separated header controls.

## 1.7.0

- Added a complete INAV-style ArduPilot navigation tree with dedicated Status,
  Ports, Receiver, Modes, PID Tuning, Configuration, Motors & Outputs, Safety
  & Failsafe, Sensors & Calibration, GPS & Navigation, Power & Battery, OSD &
  Notifications, Logging, Mission, and All Parameters pages.
- Added a live preflight Status page showing attitude, arming and flight mode,
  SYS_STATUS sensor health, receiver channels, RSSI, GPS, battery, controller
  load, communication health, uptime, and recent pre-arm/autopilot messages.
- Mirrored familiar INAV interactions where ArduPilot supports them: UART
  function/protocol selection, live receiver endpoint capture, moved-switch RC
  channel detection, fixed six-position mode visualization, auxiliary function
  assignment, and an axis/control-loop P/I/D/feed-forward tuning matrix.
- Made every feature page discover only parameters reported by the connected
  vehicle. Standard and Advanced views show official explanations, exact
  parameter IDs, choices, bitmasks, limits, units, and reboot requirements;
  All Parameters remains the complete firmware-specific fallback.
- Added guarded Save and Save & Reboot actions throughout ArduPilot
  configuration. Confirmed writes are tracked individually, armed vehicles are
  refused, and only a normal autopilot reboot (MAV_CMD 246, param1 1) is sent
  after every requested write succeeds.
- Added a persistent whole-application light/dark theme and synchronized
  metric/imperial ArduPilot display units. Controller values and JSON backups
  remain in native units.
- Added conservative INAV 9.1 EZ Tune presets for 10, 12, 15, and 17-inch
  multirotors, with progressively lower response/bandwidth for larger props and
  explicit generated roll P/I/D/feed-forward values.

## 1.5.1

- Added first-time ArduPilot installation from a running INAV controller or
  STM32 ROM DFU. Flight Commander now downloads the official, version-matched
  `*_with_bl.hex`, performs a full-chip erase, writes the ArduPilot bootloader
  and application, and requires byte-for-byte read-back verification.
- Added raw MSP identification in the ArduPilot flasher. Exact INAV target names
  are matched against official ArduPilot platforms before first installation;
  the Aero Selfie/MicoAir H743 hardware mapping resolves to `MicoAir743`.
- Kept PX4 bootloader board IDs authoritative for subsequent APJ updates and
  blocked local APJ packages from the first-install path because they do not
  contain an ArduPilot bootloader. Catalog filtering now also separates
  standard Copter and Helicopter artifacts that share a platform and board ID.
- Made the legacy serial and USB STM32 drivers report verified success or
  failure explicitly. Post-flash configuration restore is no longer entered
  after a failed controller open, erase, program, or verification step.

## 1.5.0

- Added a persistent Metric/Imperial switch to Ground Control. The telemetry
  cards, live HUD tapes, airspeed and vertical-speed readouts, next-waypoint
  distance, labels, increments, and accessible HUD announcement now change
  together between meters and m/s or feet, mph, and ft/s.
- Kept all received telemetry, mission calculations, map geometry, and vehicle
  commands in their canonical SI units; the new preference converts values
  only at the display boundary.
- Replaced the fixed map/HUD inset with a movable minor-view window spanning
  the Ground Control workspace. It supports pointer dragging, arrow-key
  positioning, normalized position persistence across window sizes, and an
  always-reachable reset control.
- Preserved the existing map/HUD primary-view switch by moving the live
  OpenLayers map and HUD canvas between stable primary and floating slots,
  retaining map state, telemetry, and input behavior through every swap.
- Changed the simulated HUD ground from brown to a muted forest-green
  gradient. Both stops preserve enhanced contrast against the white
  instruments and yellow aircraft marker and remain distinct from the sky.
- Added conversion, accessibility, drag, clamping, persistence, reset,
  reparenting, responsive-layout, HUD-contrast, and packaged-renderer
  verification.

## 1.4.2

- Fixed `MAVLink transport startup failed: Illegal invocation` after the
  Ground Control page opened. Chromium's Window timers are receiver-sensitive;
  the MAVLink session had stored them unbound and later invoked them with the
  session object as `this`, aborting attachment before discovery could begin.
- Bound every stored MAVLink timeout and interval default to the renderer host,
  including session discovery, mission transfers, parameter loading, INAV
  command overrides, and queued Ground Control activation.
- Made MAVLink initialization atomic so a failed IPC or watchdog setup removes
  its listener, clears partial state, and permits a clean retry.
- Added browser-receiver regressions across startup, missions, parameters,
  command streaming, and activation retries, closing the environment gap that
  allowed the v1.4.1 source and packaging gates to pass.

## 1.4.1

- Stopped transient Windows COM enumeration omissions from generating a
  synthetic Disconnect click while the native serial handle is still live.
- Preserved native serial close/error phase, message, and platform details
  across Electron IPC and renderer cleanup. Unexpected USB loss is no longer
  reported as a successful operator close, and an already-dead handle is not
  closed a second time.
- Added one bounded retry when an explicit MAVLink connection ends during its
  first five seconds before any vehicle heartbeat, allowing an ExpressLRS
  transmitter module that briefly re-enumerates to settle without creating a
  reconnect loop. Changing a connection selector cancels the pending retry.
- Queued rapid Connect requests until Windows confirms the previous COM handle
  is released, and prevented a delayed Disconnect click from an ended session
  from being reinterpreted as a new connection attempt.
- Kept healthy serial/MAVLink transport attached when Ground Control startup or
  post-heartbeat rendering fails, with an explicit degraded UI status instead
  of automatic transport teardown.
- Made serial-port polling single-instance and added executable regressions for
  COM omission, structured native errors, duplicate terminal events,
  intentional disconnects, and recovery limits.

## 1.4.0

- Fixed the post-COM-open lifecycle that could leave explicit MAVLink on the
  Welcome page with the connection button permanently showing `Connecting`.
  Ground Control and its no-heartbeat recovery now exist before MAVLink session
  attachment can invoke renderer subscribers.
- Isolated failing MAVLink subscribers and made attachment rollback atomic, so
  optional UI state cannot leave a half-attached reader or heartbeat timer.
- Matched Mission Planner's transmitter-module startup more closely with a
  one-second USB settle and MAVLink v1 discovery heartbeats until the vehicle's
  own protocol is known.
- Added operator-visible milestones for the first discovery write, received
  serial bytes, decoded MAVLink frame, and vehicle heartbeat.
- Captured protocol selection per connection attempt, rejected stale successful
  and failed COM-open completions, queued Ground Control activation across tab
  transitions, and surfaced dynamic-load failures instead of wedging the UI.

## 1.3.9

- Fixed ExpressLRS USB MAVLink startup on Windows so the native COM open begins
  with DTR low instead of briefly asserting DTR and resetting the TX module.
- Kept RTS low during post-open control-line verification; the pinned serial
  library otherwise asserted RTS while lowering DTR.
- Added regression and packaged-application checks for the complete
  DTR/RTS-low open sequence used by RadioMaster Nomad and other ESP32-based
  ExpressLRS transmitters.

## 1.3.8

- Restored the complete Flight Commander welcome-page lockup by adding a
  light-surface wordmark variant with visible aircraft, compass, and `FLIGHT`
  details.
- Increased welcome-tagline contrast so the complete banner remains readable
  over the light map background.
- Fixed USB MAVLink radio startup on Windows by defaulting the explicit Ground
  Control protocol to 460800 baud, forcing DTR low, and transmitting the GCS
  heartbeat as soon as the serial transport opens.
- Ground Control now opens immediately in a clear waiting-for-heartbeat state;
  telemetry, mission reads, and vehicle commands remain disabled until a valid
  autopilot heartbeat arrives.
- Preserved serial bytes received during the COM-open handoff, separated baud
  preferences by protocol, and replaced misleading MSP-only transport status
  messages.
- Scoped serial IPC, MAVLink decoding, command waits, mission operations, and
  firmware serial traffic to one connection generation so delayed events from
  a disconnected radio cannot affect its replacement.
- Added bounded serial open, control-line, and cleanup failures; a stalled
  Windows driver now returns a specific error instead of leaving the interface
  on Connecting indefinitely.
- Added source and packaged-renderer checks for the welcome-specific artwork
  and text contrast, plus regression coverage for the MAVLink USB lifecycle.

## 1.3.7

- Restored the Flight Commander wordmark in the application header, landing
  page, CLI, and PID-tuning surfaces.
- Restored the compass/aircraft application icon used by versions 1.3.2 through
  1.3.5.
- Applied the Flight Commander icon to Windows, macOS, Linux, installer,
  window, dialog, and manifest identity paths.
- Added release checks for active branding CSS, runtime icon data, and embedded
  Windows executable icon resources.

## 1.3.6

- Established the reconstructed, editable Flight Commander source baseline
  from INAV Configurator 9.1.1 and the verified 1.3.5 runtime.
