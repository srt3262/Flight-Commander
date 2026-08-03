# Flight Commander command-line interface

The CLI is a direct firmware configuration console. It can change values that
the graphical pages protect with validation and workflow context. Remove
propellers, back up first, and enter only commands understood by the connected
firmware.

The CLI help icon opens this command guide. The **CLI Documentation** toolbar
button opens the [settings reference](SETTINGS_REFERENCE.md).

## Open and leave the CLI

1. Connect to the flight controller over an MSP-capable USB/UART link.
2. Open **CLI**. Flight Commander enters the firmware console and builds
   autocomplete from the connected target.
3. Type `help` to obtain the authoritative command list for that build.
4. Use `save` to persist changes and reboot.
5. Use `exit` to leave without saving the current unsaved CLI changes.

While CLI owns the port, normal configuration polling and flight functions are
not available. Logical-switch behavior can also be suspended by compatible
firmware while the CLI is active.

## Toolbar actions

- **Save settings** sends `save` and expects a reboot.
- **Exit** sends `exit` without committing staged CLI changes.
- **Diff all** clears the console and requests a complete changed-settings
  backup across profiles.
- **Clear** clears only the displayed console history.
- **Copy**, **Load from file**, and **Save to file** manage text on the computer;
  loading a file does not make its commands safe for this firmware.
- **MSC** requests USB mass-storage mode on supported hardware.

## Command syntax

Commands are case-sensitive only where the connected firmware says so. Use one
command per line.

```text
get nav_rth_altitude
set nav_rth_altitude = 5000
diff all
save
```

`set` accepts the unit and range reported by firmware, which may be a raw
integer rather than the converted unit displayed by Configurator. Query the
setting first and read its allowed range.

## Command reference

The exact list is compiled per firmware target. `help` on the connected
controller is authoritative. The following commands are supported by the
Flight Commander-compatible CLI when their backing hardware/feature is built.

| Command | Purpose |
| --- | --- |
| `help` | Show commands and target-specific usage |
| `version` | Show firmware build, target, and version identity |
| `status` | Show sensors, load, arming state, and initialization errors |
| `tasks` | Show scheduler timing and task load |
| `memory` | Show memory usage |
| `bootlog` | Show firmware initialization log when compiled |
| `get [name|pattern|*]` | Query one setting or search the runtime setting list |
| `set name = value` | Stage a setting value |
| `save` | Persist configuration and reboot |
| `exit` | Leave CLI without saving staged changes |
| `defaults` | Reset configuration; normally reboots and is destructive |
| `dump [section]` | Print complete configuration commands |
| `diff [section|all]` | Print values that differ from defaults |
| `batch start` / `batch end` | Group a pasted command sequence and report errors |
| `control_profile n` | Select a control profile for subsequent profile-owned operations |
| `battery_profile n` | Select a battery profile |
| `feature` | List, enable, or disable compiled/runtime features |
| `beeper` | Inspect or change buzzer/beeper conditions |
| `map` | Inspect or set RC channel order |
| `rxrange` | Inspect or set receiver channel ranges |
| `aux` | Inspect or configure mode activation ranges |
| `adjrange` | Inspect or configure in-flight adjustment ranges |
| `serial` | Inspect or configure serial-port function masks and baud rates |
| `serialpassthrough` | Bridge a selected serial port for peripheral setup |
| `gpspassthrough` | Bridge the configured GPS port |
| `resource` | Show pin/resource ownership |
| `timer_output_mode` | Inspect or override automatic motor/servo timer allocation |
| `mmix` | Inspect or configure custom motor mixer rules |
| `smix` | Inspect or configure custom servo mixer rules |
| `motor` | Inspect or set motor values where the build permits it |
| `servo` | Inspect or configure servo behavior |
| `logic` | Inspect or configure logic conditions |
| `gvar` | Inspect or configure global variables |
| `pid` | Inspect configurable logic PID controllers |
| `wp` | Inspect or configure native mission waypoints |
| `safehome` | Inspect or configure safe-home locations |
| `led` | Configure addressable LED entries |
| `color` | Configure LED/OSD colors where supported |
| `mode_color` | Configure mode/special LED colors |
| `osd_layout` | Inspect or configure OSD item placement by layout |
| `blackbox` | Inspect or configure Blackbox fields |
| `sd_info` | Show SD-card state and capacity |
| `flash_info` | Show onboard flash-chip state |
| `flash_erase` | Erase onboard data flash; destructive |
| `flash_read` / `flash_write` | Low-level data-flash access where compiled |
| `temp_sensor` | Inspect or configure supported temperature sensors |
| `bind_rx` | Start binding for supported serial receiver families |
| `bind_msp_rx` | Start binding for supported MSP receiver paths |
| `play_sound` | Play a supported buzzer sound by index |
| `msc` | Reboot/enter supported USB mass-storage access |
| `dfu` | Reboot into supported firmware-update mode |
| `assert` | Development/diagnostic assertion command when compiled |

Commands omitted by `help` are unavailable on that firmware build. Do not
assume a command exists because it appears in a different version's manual.

## Find a setting by name

```text
get gps
get nav_rth_altitude
get *
```

`get <text>` searches names. `get *` can be very long. Flight Commander's
graphical **Search** tab indexes settings represented by the installed UI; the
CLI query indexes the controller's actual runtime schema.

See [Settings reference](SETTINGS_REFERENCE.md).

## Backup

For a compact, reviewable backup:

```text
diff all
```

Save the complete output to a dated text file. If separate control/battery
profiles are used, verify the output includes each profile section and profile
selection commands. Also use Configurator's structured backup before flashing.

`dump all` is useful for diagnostics but includes defaults and is more likely to
carry obsolete values across a firmware change.

## Restore safely

1. Flash/connect the intended firmware and load its current defaults.
2. Save a fresh `diff all` for comparison.
3. Review the old backup for renamed, removed, range-changed, or profile-owned
   settings.
4. Paste a small coherent section, preferably inside `batch start` / `batch end`.
5. Resolve every reported error.
6. Run `diff all` again and compare.
7. Use `save`, reconnect, and verify relevant Configurator pages.

Never paste a full configuration from another target. Never use a blind restore
to suppress an arming or sensor error.

## Serial command caution

`serial` uses numeric port identifiers, function masks, and multiple baud-rate
fields. Those encodings can change as features evolve. Run `serial` and
`help serial` on the connected build, preserve an MSP recovery path, and prefer
the **Ports** page for normal setup.

## Passthrough caution

GPS/serial passthrough temporarily gives a computer application direct access
to a peripheral. Close other serial users, select the exact port and baud, keep
the aircraft disarmed, and reboot afterward. A passthrough session can make the
Configurator appear disconnected until it is exited.
