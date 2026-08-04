from pathlib import Path
import re

root = Path('.')

def replace_regex(path, pattern, replacement, *, count=1):
    p = root / path
    text = p.read_text()
    updated, n = re.subn(pattern, replacement, text, count=count, flags=re.MULTILINE)
    if n != count:
        raise SystemExit(f'{path}: expected {count} replacements for {pattern!r}, got {n}')
    p.write_text(updated)

replace_regex('CMakeLists.txt', r'set\(FLIGHT_COMMANDER_FIRMWARE_VERSION [^)]+\)', 'set(FLIGHT_COMMANDER_FIRMWARE_VERSION 3.0.6)')
replace_regex('src/main/build/flight_commander.h', r'#define FLIGHT_COMMANDER_VERSION_PATCH\s+\d+', '#define FLIGHT_COMMANDER_VERSION_PATCH 6')

build_path = root / 'flight-commander/build-micoair743.sh'
build = build_path.read_text()
build, n = re.subn(r'Flight-Commander-Firmware-3\.0\.\d+-MICOAIR743\.hex', 'Flight-Commander-Firmware-3.0.6-MICOAIR743.hex', build)
if n < 1:
    raise SystemExit('build script firmware name was not updated')
build_path.write_text(build)

verify_path = root / 'flight-commander/verify-compass-release.py'
verify = verify_path.read_text()
verify = re.sub(r'Flight Commander 3\.0\.\d+ compass[^\"]*build', 'Flight Commander 3.0.6 compass frame build', verify)
verify, n1 = re.subn(r'bytes\(\(1, 3, 0, \d+, 9, 1, 0, 0xFF, 0x1F, 0, 0\)\)', 'bytes((1, 3, 0, 6, 9, 1, 0, 0xFF, 0x1F, 0, 0))', verify)
verify, n2 = re.subn(r'Flight Commander 3\.0\.\d+ identity', 'Flight Commander 3.0.6 identity', verify)
if n1 != 1 or n2 < 1:
    raise SystemExit(f'verifier identity update failed: tuple={n1}, messages={n2}')
verify_path.write_text(verify)

driver_path = root / 'src/main/drivers/compass/compass_ist8310.c'
driver = driver_path.read_text()
start = driver.index('    if (isMicoAirOnboard) {')
end = driver.index('        return;', start)
block = driver[start:end]
block, nx = re.subn(r'mag->magADCRaw\[X\]\s*=.*?;', 'mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;', block, count=1)
block, ny = re.subn(r'mag->magADCRaw\[Y\]\s*=.*?;', 'mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;', block, count=1)
block, nz = re.subn(r'mag->magADCRaw\[Z\]\s*=.*?;', 'mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;', block, count=1)
if (nx, ny, nz) != (1, 1, 1):
    raise SystemExit(f'onboard mapping replacement failed: {(nx, ny, nz)}')
comment_start = block.find('        //')
assign_start = block.find('        mag->magADCRaw[X]')
if comment_start >= 0 and assign_start > comment_start:
    block = block[:comment_start] + '''        // MICOAIR743 onboard IST8310 converted into INAV's BMI088 body frame.
        // Native registers are left-handed; the correct signed permutation is
        // X=-nativeY, Y=-nativeX, Z=nativeZ. User alignment remains CW 0.
''' + block[assign_start:]
driver = driver[:start] + block + driver[end:]
driver_path.write_text(driver)

target_path = root / 'src/main/target/MICOAIR743/target.h'
target = target_path.read_text()
target = re.sub(
    r'// Onboard IST8310 at 0x0E\.[\s\S]*?(?=#define MAG_I2C_BUS\s+BUS_I2C2)',
    '// Onboard IST8310 at 0x0E. Driver mapping: X=-nativeY, Y=-nativeX, Z=nativeZ.\n// Keep onboard compass alignment at CW 0 degrees.\n',
    target,
    count=1,
)
target_path.write_text(target)

(root / 'COMPASS-3.0.6-README.md').write_text('''# Flight Commander Firmware 3.0.6 — MICOAIR743 Compass Frame Correction

3.0.5 is rejected. It changed only Z and left an invalid coordinate mapping.

3.0.6 preserves the 3.0.4 acquisition and calibration corrections and maps the
onboard IST8310 into INAV's body frame as:

    X = -native Y
    Y = -native X
    Z =  native Z

Keep onboard compass alignment at CW 0 degrees. Propeller-off bench test only.
''')

cmake = (root / 'CMakeLists.txt').read_text()
version = (root / 'src/main/build/flight_commander.h').read_text()
build = build_path.read_text()
verify = verify_path.read_text()
driver = driver_path.read_text()
compass = (root / 'src/main/sensors/compass.c').read_text()
maths = (root / 'src/main/common/maths.c').read_text()
assert 'set(FLIGHT_COMMANDER_FIRMWARE_VERSION 3.0.6)' in cmake
assert '#define FLIGHT_COMMANDER_VERSION_PATCH 6' in version
assert 'Flight-Commander-Firmware-3.0.6-MICOAIR743.hex' in build
assert 'bytes((1, 3, 0, 6, 9, 1, 0, 0xFF, 0x1F, 0, 0))' in verify
assert 'IST8310_STATUS1_DRDY' in driver
assert 'mag->magADCRaw[X] = -nativeY * IST8310_LSB_TO_MILLIGAUSS;' in driver
assert 'mag->magADCRaw[Y] = -nativeX * IST8310_LSB_TO_MILLIGAUSS;' in driver
assert 'mag->magADCRaw[Z] =  nativeZ * IST8310_LSB_TO_MILLIGAUSS;' in driver
assert 'sensorCalibrationSolveForOffset(&calState, candidateZeroFloat)' in compass
assert 'if (!isfinite(result[i]))' in maths
print('3.0.6 source normalization and static contracts: PASS')
