# Changelog

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
