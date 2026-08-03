# Logging and programming

Logs provide evidence for setup, tuning, navigation, and failures. Programming
and logic tools can change flight behavior and require the same review as any
other control configuration.

## Onboard logging

Onboard Logging configures Blackbox capture to supported SD card or flash.

1. Confirm the device is detected and has space.
2. Choose logging rate and fields suitable for the investigation.
3. Enable logging and save/reboot.
4. Perform a short bench/flight sample.
5. Stop/disarm cleanly, download the file, and verify it parses before relying
   on it for a longer test.

Higher logging rates increase storage and CPU/I/O load. A present SD card is
not necessarily fast enough; inspect dropped frames and status.

## Tethered logging

Tethered Logging records selected live values through the active Configurator
link. It is useful on the bench but can miss high-rate events and should not be
treated as a replacement for onboard Blackbox evidence.

Keep the computer awake, avoid other serial users, and save the capture with
firmware/target/configuration context.

## Programming

Programming configures firmware logic conditions, global variables, logic PID
controllers, and actions. Each condition should have:

- a documented input and unit;
- bounded thresholds/hysteresis;
- an explicit inactive state;
- a tested interaction with arming, modes, failsafe, and manual override;
- no circular dependency on its own output.

Use the visual/editor validation and inspect generated firmware operations
before saving.

## JavaScript Programming

The JavaScript editor transpiles the supported Flight Commander scripting
surface into compatible firmware logic-condition operations; arbitrary
JavaScript does not run on the flight controller.

- Use only the documented API exposed by autocomplete/diagnostics.
- Treat examples as starting points, not aircraft-ready safety logic.
- Review the generated operations and resource count.
- Test every branch using known inputs and confirm the decompiled/readback form.
- Keep the source file beside the configuration backup.

Unsupported APIs, out-of-range RC channels, unavailable operations, or excess
logic resources must produce errors rather than silently disappearing.

## CLI diagnostics

Useful read-only CLI evidence includes `status`, `tasks`, `resource`, `sd_info`,
`flash_info`, `version`, and `diff all`. See [CLI](CLI.md).

## Evidence package for support

When reporting a defect, include the Configurator log, exact timestamp,
firmware identity/target, `diff all`, relevant Blackbox/tethered log, mission
file, and steps to reproduce. Remove secrets and private location information
that are not necessary for diagnosis.
