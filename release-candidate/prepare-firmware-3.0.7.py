#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding='utf-8')


def write(relative: str, text: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')


def replace_once(relative: str, pattern: str, replacement: str, *, flags: int = 0) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{relative}: expected one match for {pattern!r}, received {count}')
    write(relative, updated)


# Release identity only. The accepted 3.0.6 compass acquisition, calibration,
# and MICOAIR743 transform remain byte-for-byte unchanged.
replace_once('CMakeLists.txt', r'set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 3\.0\.6\)', 'set(FLIGHT_COMMANDER_FIRMWARE_VERSION 3.0.7)')
replace_once('src/main/build/flight_commander.h', r'#define FLIGHT_COMMANDER_VERSION_PATCH\s+6', '#define FLIGHT_COMMANDER_VERSION_PATCH 7')
replace_once('flight-commander/build-micoair743.sh', r'Flight-Commander-Firmware-3\.0\.6-MICOAIR743\.hex', 'Flight-Commander-Firmware-3.0.7-MICOAIR743.hex')

compass_verifier = read('flight-commander/verify-compass-release.py')
compass_verifier = compass_verifier.replace('Flight Commander 3.0.6 compass frame build', 'Flight Commander 3.0.7 compass release build')
compass_verifier = compass_verifier.replace('bytes((1, 3, 0, 6, 9, 1, 0, 0xFF, 0x1F, 0, 0))', 'bytes((1, 3, 0, 7, 9, 1, 0, 0xFF, 0x1F, 0, 0))')
compass_verifier = compass_verifier.replace('Flight Commander 3.0.6 identity', 'Flight Commander 3.0.7 identity')
if '3.0.6' in compass_verifier:
    raise SystemExit('verify-compass-release.py still contains 3.0.6')
write('flight-commander/verify-compass-release.py', compass_verifier)

# Keep the official INAV baseline hashes while declaring each reviewed Flight
# Commander modification with its own exact patched hash and purpose.
baseline_path = ROOT / 'flight-commander/INAV-9.1.0-BASELINE.json'
baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
protected = baseline['protected_files']
extensions = {
    'src/main/flight/imu.c': {
        'upstream_sha256': '5108381a10dbe05a68ecf9a013fbd9168f47790755fe7ded2c48668d7c95d6a4',
        'patched_sha256': sha256(ROOT / 'src/main/flight/imu.c'),
        'purpose': "Inject independently weighted external-compass and moving-baseline references at INAV's Mahony AHRS yaw-correction stage without modifying gyro measurements.",
    },
    'src/main/common/maths.c': {
        'upstream_sha256': 'd2720ce794b2b6b7a67ef0b9e03ffa1583bb45db7da02918d5466f0b30ea62e5',
        'patched_sha256': sha256(ROOT / 'src/main/common/maths.c'),
        'purpose': 'Reject every non-finite calibration solver result instead of accepting NaN or infinity.',
    },
    'src/main/drivers/compass/compass_ist8310.c': {
        'upstream_sha256': protected['src/main/drivers/compass/compass_ist8310.c'],
        'patched_sha256': sha256(ROOT / 'src/main/drivers/compass/compass_ist8310.c'),
        'purpose': 'Use fresh IST8310 single-shot data-ready sampling and the bench-validated MICOAIR743 transform X=-nativeY, Y=-nativeX, Z=nativeZ.',
    },
    'src/main/sensors/compass.c': {
        'upstream_sha256': protected['src/main/sensors/compass.c'],
        'patched_sha256': sha256(ROOT / 'src/main/sensors/compass.c'),
        'purpose': 'Commit compass calibration only after the solver succeeds and guard calibrated correction against invalid gain divisors.',
    },
    'src/main/target/MICOAIR743/target.h': {
        'upstream_sha256': protected['src/main/target/MICOAIR743/target.h'],
        'patched_sha256': sha256(ROOT / 'src/main/target/MICOAIR743/target.h'),
        'purpose': 'Bind the onboard IST8310 to the target-specific transform while keeping user-facing onboard compass alignment at CW 0 degrees.',
    },
}
baseline['intentional_extensions'] = extensions
baseline_path.write_text(json.dumps(baseline, indent=2) + '\n', encoding='utf-8')

verifier_path = ROOT / 'flight-commander/verify-release.py'
verifier = verifier_path.read_text(encoding='utf-8')
verifier = verifier.replace('Verify the Flight Commander 3.0.3 MICOAIR743 source and HEX contract.', 'Verify the Flight Commander 3.0.7 MICOAIR743 source and HEX contract.')
verifier = verifier.replace('VERSION = "3.0.3"', 'VERSION = "3.0.7"')
verifier = verifier.replace('bytes((1, 3, 0, 3, 9, 1, 0, 0xFF, 0x1F, 0, 0))', 'bytes((1, 3, 0, 7, 9, 1, 0, 0xFF, 0x1F, 0, 0))')

start = verifier.index('def verify_upstream_baseline(root: Path) -> None:\n')
end = verifier.index('\ndef parse_intel_hex', start)
new_baseline_function = '''def verify_upstream_baseline(root: Path) -> None:\n    baseline_path = root / "flight-commander/INAV-9.1.0-BASELINE.json"\n    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))\n    upstream = baseline.get("upstream", {})\n    if upstream.get("release") != UPSTREAM_RELEASE:\n        fail("protected baseline release is not INAV 9.1.0")\n    if upstream.get("commit") != UPSTREAM_COMMIT:\n        fail("protected baseline commit does not match official INAV 9.1.0")\n\n    protected = baseline.get("protected_files", {})\n    if len(protected) != 57:\n        fail(f"protected baseline contains {len(protected)} files instead of 57")\n\n    extensions = baseline.get("intentional_extensions", {})\n    allowed_extensions = {\n        "src/main/flight/imu.c",\n        "src/main/common/maths.c",\n        "src/main/drivers/compass/compass_ist8310.c",\n        "src/main/sensors/compass.c",\n        "src/main/target/MICOAIR743/target.h",\n    }\n    if set(extensions) != allowed_extensions:\n        fail("intentional Flight Commander source extensions do not match the reviewed release set")\n\n    for relative, expected_upstream in protected.items():\n        path = root / relative\n        if not path.is_file():\n            fail(f"protected INAV baseline file is missing: {relative}")\n        actual = sha256(path)\n        extension = extensions.get(relative)\n        if extension is None:\n            if actual != expected_upstream:\n                fail(f"protected INAV baseline file changed without declaration: {relative}")\n            continue\n        if extension.get("upstream_sha256") != expected_upstream:\n            fail(f"declared upstream hash does not match protected baseline: {relative}")\n        if actual != extension.get("patched_sha256"):\n            fail(f"declared Flight Commander extension changed: {relative}")\n\n    for relative, extension in extensions.items():\n        upstream_hash = extension.get("upstream_sha256", "")\n        patched_hash = extension.get("patched_sha256", "")\n        purpose = extension.get("purpose", "")\n        if not re.fullmatch(r"[0-9a-f]{64}", upstream_hash):\n            fail(f"extension has an invalid upstream hash: {relative}")\n        if not re.fullmatch(r"[0-9a-f]{64}", patched_hash):\n            fail(f"extension has an invalid patched hash: {relative}")\n        if not isinstance(purpose, str) or not purpose.strip():\n            fail(f"extension has no documented purpose: {relative}")\n        path = root / relative\n        if not path.is_file() or sha256(path) != patched_hash:\n            fail(f"extension file does not match its reviewed hash: {relative}")\n\n'''
verifier = verifier[:start] + new_baseline_function + verifier[end + 1:]
verifier = verifier.replace(r'set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 3\.0\.3\)', r'set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 3\.0\.7\)')
verifier = verifier.replace(r'FLIGHT_COMMANDER_VERSION_PATCH 3', r'FLIGHT_COMMANDER_VERSION_PATCH 7')
verifier = verifier.replace('exact FCFW 3.0.3 / INAV 9.1.0 / 0x1FFF identity payload', 'exact FCFW 3.0.7 / INAV 9.1.0 / 0x1FFF identity payload')

needle = '''    require_text(\n        root / "src/main/io/gps_ublox.c",\n        [r"MSG_RELPOSNED", r"UBLOX_CFG_MSGOUT_NAV_RELPOSNED_UART1"],\n    )\n'''
extra = needle + '''    require_text(\n        root / "src/main/common/maths.c",\n        [r"if \\(!isfinite\\(result\\[i\\]\\)\\)"],\n    )\n    require_text(\n        root / "src/main/drivers/compass/compass_ist8310.c",\n        [\n            r"IST8310_STATUS1_DRDY",\n            r"IST8310_ODR_SINGLE",\n            r"mag->magADCRaw\\[X\\] = -nativeY \\* IST8310_LSB_TO_MILLIGAUSS",\n            r"mag->magADCRaw\\[Y\\] = -nativeX \\* IST8310_LSB_TO_MILLIGAUSS",\n            r"mag->magADCRaw\\[Z\\] =  nativeZ \\* IST8310_LSB_TO_MILLIGAUSS",\n        ],\n    )\n    require_text(\n        root / "src/main/sensors/compass.c",\n        [\n            r"sensorCalibrationSolveForOffset\\(&calState, candidateZeroFloat\\)",\n            r"candidateGain",\n            r"const int32_t gain = config->magGain\\[axis\\]",\n        ],\n    )\n    require_text(\n        root / "src/main/target/MICOAIR743/target.h",\n        [\n            r"FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310",\n            r"FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG",\n        ],\n    )\n'''
if needle not in verifier:
    raise SystemExit('verify-release.py insertion point was not found')
verifier = verifier.replace(needle, extra, 1)
if '3.0.3' in verifier:
    raise SystemExit('verify-release.py still contains a 3.0.3 release identity')
verifier_path.write_text(verifier, encoding='utf-8')

old_readme = ROOT / 'COMPASS-3.0.6-README.md'
if old_readme.exists():
    old_readme.unlink()
write('COMPASS-3.0.7-README.md', '''# Flight Commander Firmware 3.0.7 — Official MICOAIR743 Compass Baseline\n\nPhysical propeller-off testing confirmed this onboard IST8310 mapping against\nthe flight-controller heading, level yaw, pitch, and roll:\n\n    X = -native Y\n    Y = -native X\n    Z =  native Z\n\nThe onboard compass user alignment remains CW 0 degrees. This transform is\ntarget-specific and must not be applied to external UART/I2C or DroneCAN\ncompasses. Future MICOAIR743 development must preserve this contract.\n''')

manifest = ROOT / 'RELEASE-MANIFEST.json'
if manifest.exists():
    manifest.unlink()

assert 'set(FLIGHT_COMMANDER_FIRMWARE_VERSION 3.0.7)' in read('CMakeLists.txt')
assert '#define FLIGHT_COMMANDER_VERSION_PATCH 7' in read('src/main/build/flight_commander.h')
assert 'Flight-Commander-Firmware-3.0.7-MICOAIR743.hex' in read('flight-commander/build-micoair743.sh')
driver = read('src/main/drivers/compass/compass_ist8310.c')
for token in (
    'mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;',
    'mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;',
    'mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;',
):
    assert token in driver
assert 'bytes((1, 3, 0, 7, 9, 1, 0, 0xFF, 0x1F, 0, 0))' in read('flight-commander/verify-release.py')
assert 'bytes((1, 3, 0, 7, 9, 1, 0, 0xFF, 0x1F, 0, 0))' in read('flight-commander/verify-compass-release.py')

print('Prepared Flight Commander Firmware 3.0.7 source with canonical MICOAIR743 compass mapping.')
