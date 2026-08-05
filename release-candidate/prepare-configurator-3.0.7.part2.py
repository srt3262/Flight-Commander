    'firmwareSourceRevision': SOURCE_REVISION,
    'firmwareSourceTree': SOURCE_TREE,
})
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

manifest_path = path('manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['version'] = VERSION
manifest_path.write_text(json.dumps(manifest, indent=4) + '\n', encoding='utf-8')

# Versioned user-visible surfaces.
for relative in (
    'tabs/landing.html',
    'docs/HEADING_FUSION.md',
    'docs/TROUBLESHOOTING.md',
    'js/flightCommander/compassOrientation.js',
    'js/main/ntripClient.js',
):
    replace_all(relative, '3.0.3', VERSION)

# Canonical MICOAIR743 compass documentation.
heading = read('docs/HEADING_FUSION.md')
old_heading = '''Flight Commander 3.0.7 retains the official INAV 9.1.0 MICOAIR743 target,
compass drivers, default alignment behavior, calibration path, and IMU code
without a Flight Commander orientation override. The Alignment tab continues
to show the active target alignment and diagnostics, and operators may edit the
normal INAV alignment settings when installation-specific testing requires it.
Recalibrate after changing alignment, the airframe installation, power wiring,
nearby magnetic hardware, compass module, or firmware defaults.'''
new_heading = '''Flight Commander 3.0.7 establishes the first physically accepted onboard
IST8310 baseline for MICOAIR743. The fixed chip-to-INAV-body transform is:

```text
X = -native Y
Y = -native X
Z =  native Z
```

The transform is implemented only in the MICOAIR743 onboard IST8310 target path.
The user-facing onboard alignment remains `CW 0°`, meaning no additional
rotation relative to the flight controller. Do not copy this transform to an
external I²C, UART-module, or DroneCAN compass; those devices keep their own
installation alignment. The Alignment tab shows current samples, source and
fused heading, quality, calibration, and the saved user alignment. Recalibrate
after changing firmware, alignment, airframe installation, power wiring, nearby
magnetic hardware, or the physical compass module.'''
if old_heading not in heading:
    raise SystemExit('docs/HEADING_FUSION.md: old compass orientation section not found')
write('docs/HEADING_FUSION.md', heading.replace(old_heading, new_heading, 1))

troubleshooting = read('docs/TROUBLESHOOTING.md')
old_trouble = '''Open Alignment and record the active INAV target alignment plus the live axis
diagnostics. Flight Commander 3.0.7 does not force a MICOAIR743 compass
rotation; it preserves the official INAV 9.1.0 target behavior and the normal
editable alignment settings. Verify the board is installed as represented,
apply only the measured installation correction, save and reboot, then complete
one normal calibration away from steel, wiring current, speakers, magnets,
vehicles, and reinforced concrete. Do not mask a fixed axis error with magnetic
declination.'''
new_trouble = '''Open Alignment and confirm that the onboard source is current, active in fused
heading, and configured at `CW 0°`. Flight Commander 3.0.7 applies the accepted
MICOAIR743 onboard transform `X=-nativeY`, `Y=-nativeX`, `Z=nativeZ` inside the
firmware target. Do not add another 90-degree or flipped user rotation and do
not apply the onboard transform to an external compass. Save and reboot, then
complete one normal three-axis calibration away from steel, wiring current,
speakers, magnets, vehicles, and reinforced concrete. Do not mask a fixed axis
error with magnetic declination.'''
if old_trouble not in troubleshooting:
    raise SystemExit('docs/TROUBLESHOOTING.md: old heading troubleshooting section not found')
write('docs/TROUBLESHOOTING.md', troubleshooting.replace(old_trouble, new_trouble, 1))

landing = read('tabs/landing.html')
old_landing = '''            Flight Commander 3.0.7 ships coordinated Configurator and firmware
            builds with matching downloadable source. Its MICOAIR743 firmware
            is built from the official INAV 9.1.0 target and preserves that
