# Flight Commander 4.0.0

## 4.0.8

- Add one compass-source dropdown populated only by enabled, detected onboard, external I2C/UART GPS-module and DroneCAN magnetic sources.
- Generalize persistent six-side axis/sign learning so every magnetic source owns an independent transform and calibration generation.
- Start, clear and repeat orientation learning for only the selected compass without changing another source.
- Calibrate offsets and gains for only the selected compass through a new source-selective MSPv2 command and explicit firmware capability.
- Keep per-source manual roll, pitch and yaw alignment independent and apply it after the learned transform and field correction.
- Block a magnetic source from heading fusion until both its own transform and field calibration are valid.
- Remove the separate airspeed overlay from Ground Control so the HUD uses ground speed only.
- Publish the exact bench-accepted coordinated Configurator and MICOAIR743 firmware artifacts as the official 4.0.8 release.

## 4.0.7

- Restore the verified 4.0.5 accelerometer and gyro high-rate attitude paths after the 4.0.6 mirrored-roll regression.
- Remove the additional 4.0.6 board-frame buffers and all writes to them from the live IMU update loops.
- Derive compass-orientation accelerometer and gyro vectors on demand from the latest calibrated raw samples before user board alignment.
- Preserve the MICOAIR743 BMI088 `CW270_DEG` target alignment and avoid any HUD-only roll sign workaround.
- Retain learned IST8310 orientation, manual CW0 compass alignment, field calibration, stationary heading fusion and moving-baseline RTK support.
- Retire 4.0.6 from the managed online flasher while preserving the verified 3.0.7 recovery baseline.

## 4.0.6

- Replace the MICOAIR743 onboard IST8310 fixed transform with a persistent learned sensor-to-board signed-axis transform.
- Require the existing six-position accelerometer calibration before compass-orientation learning can begin.
- Add a guided six-face workflow that validates the upward face with calibrated acceleration, measures rotation direction with gyro data and scores all 24 proper signed-axis mappings against synchronized magnetic vectors.
- Reject incomplete, magnetically distorted, ambiguous or excessive-residual data instead of guessing an orientation.
- Store the learned mapping, confidence, residual, sensor fingerprint and calibration generation in a dedicated versioned firmware parameter group.
- Keep the learned transform independent from manual compass alignment and board alignment.
- Invalidate prior compass offset/gain calibration whenever the learned transform changes, then require the conventional compass field calibration as the second stage.
- Add MSP status and command endpoints plus Configurator progress, diagnostics, clear and relearn controls.
- Keep the verified 3.0.7 recovery baseline selectable while requiring 4.0.6 or later for the current managed firmware path.

## 4.0.5

- Keep fresh finite magnetic headings available at displayed quality 0 with a
  one-percent authority floor while preserving the field-quality warning.
- Initialize disarmed startup yaw after four stable fresh samples using a
  dedicated state independent of INAV's legacy GPS-heading initialization.
- Reset, migrate and save disabled heading-source weights as 0.
- Keep the physically verified 3.0.7 recovery baseline selectable alongside 4.0.5 and later, while removing failed 3.0.6-and-earlier, 3.0.8, and 4.0.0-through-4.0.4 firmware from the managed flasher.


- Adds one-stage setup for two Holybro/AP_Periph DroneCAN F9P modules used as an aircraft moving-baseline pair.
- Stores independent navigation, moving-base, moving-rover, compass, and battery node bindings.
- Configures and verifies AP_Periph `CAN_NODE`, `GPS_TYPE`, `GPS_AUTO_CONFIG`, optional `CAN_TERMINATE`, parameter save, and node restart while disarmed.
- Accepts relative heading only from the bound rover and reports per-node fix, role, service, timeout, baseline, and heading diagnostics.
- Preserves Flight Commander 3.0.7's accepted MICOAIR743 onboard IST8310 transform as the magnetic fallback baseline.

# Flight Commander 3.0.7

- Publishes the first officially accepted MICOAIR743 onboard IST8310 compass baseline.
- Preserves the physically validated transform `X=-nativeY`, `Y=-nativeX`, `Z=nativeZ` with onboard user alignment `CW 0°`.
- Retires every earlier standalone Flight Commander firmware asset because those versions used an incorrect compass transform.
- Filters the online firmware dropdown so versions older than 3.0.7 cannot be selected, even from stale GitHub API responses.
- Coordinates Configurator, firmware HEX, Configurator source, and firmware source at version 3.0.7.

# Changelog

## 3.0.3

- Restored the normal INAV-style 3D aircraft/module alignment preview for every
  onboard, UART, DroneCAN, and moving-baseline target, with a prominent front
  arrow and compact target-specific guidance instead of oversized schematics.
- Reworded the Flight Commander / official INAV flasher warning around exact
  detected-controller target compatibility, corrected overflowing GPS and
  alignment text, and assigned unique default heading priorities 1 through 4
  with descending weights of 100, 75, 50, and 25.
- Removed Flight Commander's second onboard-compass calibration rejection layer
  so the official INAV solver owns and saves onboard calibration results. The
  protected INAV 9.1.0 MICOAIR743 target and IST8310 handedness correction remain
  unchanged; selecting explicit 0-degree alignment remains distinct from Default.
- Published coordinated Configurator, Windows, MICOAIR743 firmware, and exact
  reproducible firmware-source artifacts at version 3.0.3.

## 3.0.2

- Replaced the failed 3.0.1 firmware artifact set with a coordinated 3.0.2
  build produced directly from the retained firmware source ZIP.
- Corrected the firmware release manifest, source identity, byte count, and
  SHA-256 chain so the CI and release workflows rebuild and compare the exact
  published MICOAIR743 HEX before packaging or publication.
- Retained the 3.0.1 compass baseline, heading correction, independent source
  alignments, diagnostics, compact GPS priority controls, and standalone
  online-flasher firmware behavior without reintroducing bundled firmware.

## 3.0.1

- Corrected the magnetic heading correction sign so estimated-minus-measured
  error is removed from yaw rather than added to it.
- Corrected moving-baseline yaw to use the aircraft body-X/front axis and the
  INAV Earth-frame heading vector instead of body Z and a vector reversed by
  180 degrees.
- Made onboard, external-I2C, selected DroneCAN, and moving-baseline alignment
  drafts independent through edit, save, and reload, while retaining the full
  live diagnostic display on the Alignment tab.
- Replaced ambiguous alignment models with readable source-specific
  schematics, axes, connector/antenna references, and active-source identity.
- Reworked GPS source priority and weight settings into one compact four-row
  group below the map, using the available tab width without horizontal
  scrolling or duplicate alignment controls.
- Removed firmware from the Windows Configurator and Configurator source ZIP.
  The flasher now exposes only **Load Firmware Locally**, **Load Online
  Firmware**, and **Flash**, with the standalone HEX downloaded from GitHub.
- Added calibration plausibility gates that reject degenerate sample coverage,
  unsafe offsets, non-finite results, and unbalanced gains before a magnetic
  source can enter heading fusion.

## 3.0.0

- Rebuilt Flight Commander Firmware 3.0.0 from the official INAV 9.1.0
  MICOAIR743 target, with a protected upstream target, compass, bus,
  calibration, and IMU baseline.
- Enabled the complete Flight Commander capability set, including weighted
  heading fusion, UART and DroneCAN moving-baseline yaw, RTK correction paths,
  DroneCAN GPS and battery support, mission extensions, photo triggers,
  terrain waypoints, mission resume, native GCS commands, and multirotor
  autotune.
- Added u-blox `UBX-NAV-RELPOSNED` parsing and output-rate configuration for
  UART moving-baseline rovers, carrier-fix/accuracy/baseline guards, and
  best-accuracy automatic selection between UART and DroneCAN relative heading.
- Retained the Alignment tab's live source diagnostics and normal editable
  INAV alignment controls while removing the former board-specific compass
  orientation override.
- Standardized releases as one complete ZIP containing the Windows x64
  Configurator, Configurator source, MICOAIR743 firmware HEX, and matching
  firmware source ZIP.
- Separated **Download Online Firmware**, **Use Bundled Firmware**, and
  **Select Local Firmware File** into independent source actions. Selecting a
  bundled version no longer renames or replaces the online-download action,
  and an online failure no longer silently substitutes bundled firmware.
- Added byte-count and SHA-256 verification for online Flight Commander HEX
  assets and retained a standalone GitHub HEX service asset so the online
  flasher works while the complete four-component ZIP remains the normal
  release download.

## 2.0.6

- Rebuilt Flight Commander Firmware and Configurator together at version 2.0.6.
- Reduced the firmware release to one supported hardware target: `MICOAIR743`.
  It uses the board's onboard IST8310 on I2C2 with the correct unflipped
  `CW90_DEG` mounting orientation as both its target default and its upgrade
  fallback. There is no separate `MICOAIR743_EXTMAG` build or release asset.
- Retained UART and DroneCAN GPS/RTK receivers, GPS-module compass inputs, and
  moving-baseline yaw as configurable peripherals; none is represented as an
  alternate flight-controller firmware target.
- Added the first source-backed firmware release. The exact firmware source
  ZIP, source revision/tree, official Arm GNU 13.2.Rel1 compiler identity,
  firmware HEX size, and both SHA-256 digests are release-gated.
- Publishes exactly four downloads: Windows x64 Configurator, Configurator
  source, Firmware 2.0.6 HEX, and the complete matching Firmware 2.0.6 source
  ZIP. A clean extraction of that ZIP rebuilds the published HEX byte-for-byte.

## 2.0.5

- Added an explicit **u-blox F9P / F9-series (RTK Rover)** preset to the UART
  GPS workflow. It selects UBLOX, 115200 baud, the four major constellations,
  and an 8 Hz navigation rate, then points the operator to the applicable
  Ground Control correction workflow.
- Added independently selectable Alignment Tool targets for the compass on a
  UART RTK module, the selected DroneCAN RTK-module compass, and dual-RTK
  moving-baseline yaw. Generic 3D previews clearly distinguish compass
  mounting rotation from GNSS antenna position.
- Added a MICOAIR743 onboard IST8310 orientation guard. Calibration detects the
  physical onboard compass, blocks learning coefficients under the incorrect
  axes, applies and persists **CW90 (unflipped)**, clears stale calibration,
  reboots, and then permits the normal calibration. The guard applies only to
  the physical onboard sensor on the MICOAIR743 board.
- Replaced Ground Control's Air Speed tile with **Altitude (MSL)** and placed it
  directly beside Relative Altitude, with Metric/Imperial conversion across
  MAVLink, MSP, and LTM telemetry paths.
- Replaced CLI, settings, page, tuning, OSD, and translated support links with
  Flight Commander-owned GitHub documentation. Added a first-party operator
  manual, comprehensive CLI command guide, and generated reference for all 246
  graphical firmware settings.
- Reworded the complete SITL operator surface and translated SITL help as
  Flight Commander while retaining explicit upstream provenance only in the
  source/reconstruction documentation and Official INAV compatibility mode.
- Retains the explicit firmware actions introduced in 2.0.4: **Select Local
  Firmware File**, **Download Online Firmware**, **Flash Selected Firmware**,
  and the separately identified offline fallback.
- This is a software-only Configurator 2.0.5 release. The verified MICOAIR743
  firmware remains truthfully versioned 2.0.1. The Configurator persists the
  board-specific compass rotation through the existing firmware setting; the
  compiled Flight Commander firmware source required for a new default binary
  is not present in the repository, so the old HEX is neither patched nor
  relabeled.
- Added a fail-closed firmware-source retention policy. Configurator 2.0.5 is
  the sole legacy exception because the existing Firmware 2.0.1 source is
  already unavailable. Every later release must publish the Windows package,
  Configurator source, firmware HEX, and exact matching firmware source; a
  firmware-changing release cannot pass without source from the tested commit.

## 2.0.4

- Corrected Flight Commander firmware catalog merging so a published online
  firmware asset takes precedence over the same-version packaged fallback.
  Version 2.0.3 incorrectly discarded the online descriptor and therefore
  presented the included image as the primary choice.
- Replaced the ambiguous firmware-source buttons with three explicit actions:
  `Select Local Firmware File`, `Download Online Firmware`, and
  `Flash Selected Firmware`.
- Clearly identifies online releases and offline fallbacks in the firmware
  version selector. If an online firmware download fails, the Configurator can
  automatically load the verified packaged copy for the same target/version.
- This is a software-only Configurator 2.0.4 release. The verified MICOAIR743
  firmware remains truthfully versioned 2.0.1 and is still published as the
  third separate release download.

## 2.0.3

- Corrected the sidebar Documentation & Support destination and every
  page-level Documentation button to open Flight Commander's own GitHub
  documentation hub instead of the INAV wiki.
- Added a Flight Commander documentation index with direct routes to current
  operating guides, releases, issue support, and contribution guidance.
- Added source and packaged-application regression gates that require the
  Flight Commander documentation URL and reject the retired top-level INAV
  wiki destination.
- Applied the selected metric/imperial preference to every Ground Control and
  embedded RTK value, including takeoff altitude, editable base coordinates,
  survey accuracy, receiver/refinement status, and mountpoint distance. Values
  remain canonical SI internally for protocol and persistence safety.
- Added a complete, always-visible vehicle command deck for Start Mission,
  Resume Mission, Abort Mission, Launch/Takeoff, Return Home, and Land. Each
  command remains disabled with a specific explanation until the connected
  Flight Commander Firmware and cached AUX configuration can perform it
  safely; mission abort confirms before exiting AUTO to POSHOLD or RTH.
- Repaired Flight Commander Firmware target detection by accepting the `FCFW`
  variant returned by the board, waiting for both bundled and online catalogs,
  querying releases from the Flight Commander repository, and automatically
  selecting the newest compatible MICOAIR743 image.
- Publishes three separate downloads: the Windows x64 Configurator, matching
  source, and the directly flashable unchanged Flight Commander Firmware 2.0.1
  MICOAIR743 bench-only HEX under its truthful embedded version. This is a
  software-only Configurator 2.0.3 release; no firmware binary was changed or
  relabeled.
- Added a release-policy gate: firmware-changing updates must rebuild firmware
  at the exact Configurator version, while software-only updates may reuse a
  verified firmware binary only within the same major version series.

## 2.0.2

- Merged RTK setup into Ground Control below the live map, HUD, telemetry, and
  mission status so aircraft operation and correction setup now share one
  workspace. Ground Control remains available with the aircraft disconnected
  so a USB base can be surveyed before the aircraft is powered.
- Replaced the overlapping draggable minor view with persistent side-by-side
  map and HUD panes. Either pane can be made the major view without obscuring
  the other, and the compact telemetry grid fits immediately beneath both.
- Added guided RTK workflows for direct NTRIP-to-aircraft corrections, a local
  survey-in base, and a survey-in base whose position is refined with NTRIP.
  Each workflow presents only the relevant stages, recommends safe defaults,
  and continuously identifies the next action.
- Rebuilt compass calibration around the sensors that Flight Commander
  Firmware actually reports. Calibration now creates a control and coefficient
  readout for every connected enabled onboard, external/UART GPS-module, and
  DroneCAN compass, then reloads both legacy and extended calibration data when
  the shared rotation run finishes.
- Removed compass calibration from GPS setup and added regression and packaged
  application checks for the new Ground Control, RTK, and calibration layouts.
- Ships a separately downloadable v2.0.2 firmware package containing the
  unchanged, compatible Flight Commander Firmware 2.0.1 MICOAIR743 bench-only
  image under its truthful embedded version. This release changes the
  Configurator only.

## 2.0.1

- Added a dedicated RTK Base workspace with an independent USB serial link,
  u-blox F9 survey-in and fixed-position setup, live receiver/survey status,
  RTCM3 validation, and capability-gated correction forwarding to every
  enabled UART and DroneCAN aircraft receiver.
- Added a native NTRIP client with NTRIP v2 and common v1/ICY stream support,
  live sourcetable discovery, a no-fee RTCM3 filter, an RTK2go public-caster
  preset, authenticated mountpoints, optional certificate-verified TLS, and
  VRS GGA reporting. Caster passwords remain memory-only.
- Added a drone-off base workflow which surveys the USB F9 first, verifies the
  caster before changing receiver mode, averages a consecutive RTK Fixed
  sample window, returns the F9 to fixed local-base mode, and forwards only
  fresh RTCM after the aircraft later connects over MAVLink or wired MSP.
- Bundled the matching MICOAIR743 firmware with the Configurator so automatic
  target detection always produces a selectable Flight Commander image even
  when no online release catalog is reachable.
- Enabled Blackbox-to-SD logging by default and advertised implemented
  multirotor AutoTune, mission streaming, and mission resume capabilities.
- Added aligned, configurable DroneCAN GPS controls and independent UART/CAN
  RTK status while preserving selectable primary-receiver roles.
- Added a capability-gated heading manager for the onboard compass, an
  external-I²C compass carried by a UART GPS module, a selected DroneCAN
  compass, and dual-GNSS moving-baseline yaw. Enabled sources use a unique
  priority order for authority/failover and independent weights for fusion;
  stale, uncalibrated, inaccurate, geometrically invalid, or disagreeing
  inputs are excluded automatically.
- Added DroneCAN compass and relative-heading discovery, fixed/automatic node
  assignment in Ports and GPS, u-blox `NAV-RELPOSNED` and DroneCAN
  `RelPosHeading` status, RTK-Fixed and baseline-length guards, per-source
  installation offsets, and live fused-heading diagnostics.
- Extended compass calibration to every enabled physical heading sensor in a
  single disarmed rotation run. Onboard and external-I²C GPS-module compasses
  retain independent coefficients; DroneCAN hard-iron offsets and per-axis
  gains are persisted against the emitting node ID. Live status exposes
  calibrating, required, failed, and calibrated states, and uncalibrated
  sources are excluded from fusion.
- Made Flight Planner inputs and summaries honor metric/imperial preferences
  while retaining SI mission storage, and constrained the map to the visible
  application viewport instead of stretching with the settings sidebar.
- Removed remaining INAV product labeling from Flight Commander connection
  identity while retaining explicit Official INAV compatibility labeling.

## 2.0.0

- Removed ArduPilot flashing, configuration, parameter, mission, command, and
  AutoTune support. Non-INAV MAVLink vehicles are identified as unsupported and
  cannot reach configuration, mission-transfer, or operational command routes.
- Replaced the INAV/ArduPilot firmware selector with **Flight Commander
  Firmware** and **Official INAV Firmware**. Both use automatic INAV target
  discovery and the existing guarded STM32/DFU flashing path.
- Added the versioned MSPv2 `FCFW` identity query (`0x2F00`), compatible-INAV
  version reporting, and a capability bitmap. Standard INAV falls back safely
  after a single optional probe and retains all compatible configurator and
  Ground Control behavior.
- Added a Firmware Capabilities page. Flight Commander Firmware-only features
  stay disabled unless the connected firmware explicitly advertises the exact
  capability; stock INAV therefore cannot expose incompatible fork features.
- Added the initial `MICOAIR743` / `MICROAIR743` alias-aware firmware catalog
  and pre-flash family, embedded-identity, and hardware-target validation.

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
