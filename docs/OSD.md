# On-screen display (OSD)

The OSD page configures the video display system, layouts, elements, alarms,
custom messages, and fonts supported by the connected firmware and hardware.

## Hardware and video system

Confirm whether the aircraft uses analog MAX7456-compatible OSD, MSP
DisplayPort, DJI/HD display, or another supported path. Options unavailable to
the detected hardware remain hidden or disabled.

Set the correct video system and canvas dimensions before placing elements.
Changing the canvas later can move or hide existing items.

## Layouts and element placement

1. Select the intended layout/profile.
2. Enable only the elements needed for the flight task.
3. Drag each item into a safe visible region of the preview.
4. Check overlapping items, long localized text, warnings, and horizon/sidebar
   behavior.
5. Save and verify on the actual display hardware.

Preview placement is a model of firmware coordinates; camera/display cropping
must be checked on the real video link.

## Units and formatting

OSD units are firmware-owned and can also drive Configurator display units when
the global unit option is set to OSD. Check altitude, speed, distance,
temperature, coordinate precision, and voltage/current formatting after every
unit-family change.

## Alarms

Configure alarms for the sensors actually installed and reliable:

- battery voltage, capacity, current, and time;
- altitude and distance;
- airspeed, RSSI/link quality/SNR;
- temperature and G-force;
- GPS/navigation conditions and other supported sources.

An alarm threshold does not create the sensor. Avoid thresholds that stay
permanently active or cannot be reached before the real safety limit.

## Custom elements and messages

Custom elements combine text, icons, logic conditions, global variables, and
firmware values. Build them incrementally:

1. Reserve a position in the selected layout.
2. Enter text short enough for the display width.
3. Insert only supported character/icon codes.
4. Configure the enabling condition separately and test both true/false states.
5. Verify fallback output when a referenced value is unavailable.

Use the repository's
[OSD character map](../resources/osd/INAV%20Character%20Map.md) for the bundled
font glyph indices. The inherited filename describes the compatible character
set; the active help link remains inside the Flight Commander repository.

## Fonts

Font upload writes the OSD character memory. Use a font matching the selected
display system and character-map expectations. Do not remove power during
upload. Reopen the OSD page and inspect common digits, signs, units, direction
arrows, and alarm glyphs on real hardware afterward.

## DJI/HD and switch indicators

Digital-display options can choose RSSI/temperature sources, message formatting,
and switch-indicator names/channels. Verify receiver channel mapping first and
keep names short enough for the display protocol.

## Preflight OSD check

- Home direction/distance agree with the real takeoff location.
- Relative and MSL altitude semantics are understood.
- GPS fix/satellites and battery values agree with Ground Control.
- Critical alarms can be triggered on the bench.
- Mode/arming/failsafe messages are visible.
- No required item is clipped or covered in every used layout.
