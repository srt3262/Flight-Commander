            release's target, compass, calibration, bus, and IMU behavior.
            Flight Commander adds its complete feature set around that
            baseline, including weighted heading fusion and UART/DroneCAN
            moving-baseline RTK yaw. The GPS and Alignment workflows retain
            per-source diagnostics and editable installation offsets without
            forcing a board-specific compass orientation.'''
new_landing = '''            Flight Commander 3.0.7 ships coordinated Configurator and firmware
            builds with matching downloadable source. Its MICOAIR743 firmware
            is built from the official INAV 9.1.0 target while retaining
            reviewed Flight Commander extensions for fresh IST8310 sampling,
            validated compass calibration, and the MICOAIR743 board transform.
            Physical testing established the canonical onboard mapping as
            X=-nativeY, Y=-nativeX, Z=nativeZ with user alignment CW 0 degrees.
            Flight Commander adds weighted heading fusion and UART/DroneCAN
            moving-baseline RTK yaw. The GPS and Alignment workflows retain
            per-source diagnostics and editable installation offsets; the fixed
            onboard chip-to-board transform remains target-owned and cannot be
            accidentally applied to external compass modules.'''
if old_landing not in landing:
    raise SystemExit('tabs/landing.html: old release description not found')
write('tabs/landing.html', landing.replace(old_landing, new_landing, 1))

orientation = read('js/flightCommander/compassOrientation.js')
orientation = re.sub(
    r'// Kept as a compatibility shim for extensions that imported the former\n// board-specific guard\. Flight Commander 3\.0\.7 defers magnetometer alignment\n// entirely to the active INAV target and the user\'s normal alignment settings\.',
    '// Kept as a compatibility shim for extensions that imported the former UI\n// guard. Firmware 3.0.7 owns the fixed MICOAIR743 onboard IST8310 transform;\n// the Configurator adds no second rotation and leaves user alignment at CW 0°.',
    orientation,
    count=1,
)
write('js/flightCommander/compassOrientation.js', orientation)

# Firmware catalog floor: superseded firmware must never be selectable even if
# a stale API/cache response still exposes an old asset.
catalog_helper = '''\nexport const FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION = "3.0.7";\n\nfunction semverCore(version) {\n  const match = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-|$)/.exec(String(version ?? ""));\n  return match ? match.slice(1).map(Number) : null;\n}\n\nexport function isSupportedFlightCommanderFirmwareVersion(version) {\n  const candidate = semverCore(version);\n  const minimum = semverCore(FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION);\n  if (!candidate || !minimum) return false;\n  for (let index = 0; index < 3; index += 1) {\n    if (candidate[index] > minimum[index]) return true;\n    if (candidate[index] < minimum[index]) return false;\n  }\n  return true;\n}\n'''
insert_after(
    'js/flightCommander/firmwareCatalog.js',
    'export const FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL =\n  "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20";\n',
    catalog_helper,
)
replace(
    'js/flightCommander/firmwareCatalog.js',
    '      const parsed = parseFlightCommanderFirmwareFilename(asset?.name);\n      const digest = String(asset?.digest ?? "");',
    '      const parsed = parseFlightCommanderFirmwareFilename(asset?.name);\n      if (!parsed || !isSupportedFlightCommanderFirmwareVersion(parsed.version)) continue;\n      const digest = String(asset?.digest ?? "");',
)
replace(
    'js/flightCommander/firmwareCatalog.js',
    '        !parsed\n        || !asset?.browser_download_url',
    '        !asset?.browser_download_url',
)

# Tests for the catalog floor and coordinated 3.0.7 metadata.
catalog_test = read('tests/flight-commander/firmware/flight-commander-catalog.test.mjs')
catalog_test = catalog_test.replace(
    '  FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,\n',
    '  FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,\n  FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION,\n',
    1,
).replace(
    '  flightCommanderReleaseDescriptors,\n',
    '  flightCommanderReleaseDescriptors,\n  isSupportedFlightCommanderFirmwareVersion,\n',
    1,
)
anchor = '''    assert.equal(\n      FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,\n      "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20",\n    );\n'''
addition = '''    assert.equal(FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION, "3.0.7");\n    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.6"), false);\n    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.7"), true);\n    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.1.0"), true);\n'''
if anchor not in catalog_test:
    raise SystemExit('catalog test URL assertion anchor not found')
catalog_test = catalog_test.replace(anchor, anchor + addition, 1)
catalog_test = catalog_test.replace('0.1.0', '3.0.7').replace('0.2.0', '3.0.8')
catalog_test = catalog_test.replace('const filename = "Flight-Commander-Firmware-3.0.0-MICOAIR743.hex";', 'const filename = "Flight-Commander-Firmware-3.0.7-MICOAIR743.hex";')
old_assets = '''        assets: [\n          {\n            name: filename,'''
new_assets = '''        assets: [\n          {\n            name: "Flight-Commander-Firmware-3.0.6-MICOAIR743.hex",\n            browser_download_url: "https://example.invalid/superseded.hex",\n            digest: `sha256:${"b".repeat(64)}`,\n            size: 1200,\n          },\n          {\n            name: filename,'''
if old_assets not in catalog_test:
    raise SystemExit('catalog test managed firmware assets anchor not found')
catalog_test = catalog_test.replace(old_assets, new_assets, 1)
catalog_test = catalog_test.replace('assert.equal(online[0].version, "3.0.0");', 'assert.equal(online[0].version, "3.0.7");')
write('tests/flight-commander/firmware/flight-commander-catalog.test.mjs', catalog_test)
