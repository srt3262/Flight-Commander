import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const firmwareVersion = packageManifest.flightCommander.firmwareSourceVersion;
const firmwareSourceArchive = packageManifest.flightCommander.firmwareSourceArchive;
const output = mkdtempSync(join(tmpdir(), `flight-commander-${firmwareVersion}-compass-orientation-`));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const archive = join(projectRoot, ...firmwareSourceArchive.split('/'));
const result = spawnSync(
  python,
  ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, output],
  { encoding: 'utf8' },
);
assert.equal(result.status, 0, `${firmwareVersion} source extraction failed:\n${result.stdout}\n${result.stderr}`);

const sourceRoot = join(output, `Flight-Commander-Firmware-Source-v${firmwareVersion}`);
const source = (relative) => readFileSync(join(sourceRoot, ...relative.split('/')), 'utf8');
const driver = source('src/main/drivers/compass/compass_ist8310.c');
const targetHeader = source('src/main/target/MICOAIR743/target.h');
const compass = source('src/main/sensors/compass.c');
const orientation = source('src/main/flight_commander/compass_orientation.c');
const orientationHeader = source('src/main/flight_commander/compass_orientation.h');
const protocol = source('src/main/msp/msp_protocol_v2_flight_commander.h');
const msp = source('src/main/fc/fc_msp.c');
const parameterGroups = source('src/main/config/parameter_group_ids.h');
const acceleration = source('src/main/sensors/acceleration.c');
const gyro = source('src/main/sensors/gyro.c');

const onboardSource = 'FLIGHT_COMMANDER_COMPASS_ORIENTATION_SOURCE_ONBOARD';

after(() => rmSync(output, { recursive: true, force: true }));

test(`${firmwareVersion} exposes canonical IST8310 axes without a target-specific fixed transform`, () => {
  assert.match(driver, /mag->magADCRaw\[X\] =\s+nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(driver, /mag->magADCRaw\[Y\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(driver, /mag->magADCRaw\[Z\] =\s+nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.doesNotMatch(driver, /-nativeX|-nativeY \* IST8310_LSB_TO_MILLIGAUSS;[\s\S]*-nativeX/);
  assert.doesNotMatch(driver, /FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310/);
});

test('firmware owns a versioned persistent learned-transform parameter group', () => {
  assert.match(parameterGroups, /PG_FLIGHT_COMMANDER_COMPASS_ORIENTATION\s+1047/);
  assert.match(orientation, /PG_REGISTER_WITH_RESET_FN\(flightCommanderCompassOrientationConfig_t/);
  assert.match(orientationHeader, /uint32_t calibrationGeneration/);
  assert.match(orientationHeader, /uint32_t sensorFingerprint/);
  assert.match(orientation, /saveConfigAndNotify\(\)/);
  assert.match(orientation, /ORIENTATION_ONBOARD_SENSOR_FINGERPRINT 0x0E8310C1U/);
});

test('solver evaluates all proper signed-axis mappings and rejects weak solutions', () => {
  const maps = orientation.match(/static const int8_t properAxisMaps\[24\]/);
  assert.ok(maps, '24-candidate proper signed-axis table is missing');
  assert.match(orientation, /ORIENTATION_MIN_FACE_SAMPLES 24U/);
  assert.match(orientation, /ORIENTATION_REQUIRED_FACE_ROTATION_DEGREES 270\.0F/);
  assert.match(orientation, /ORIENTATION_MAX_RESIDUAL_DEGREES 6\.0F/);
  assert.match(orientation, /ORIENTATION_MIN_SCORE_SEPARATION_DEGREES 8\.0F/);
  assert.match(orientation, /FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_AMBIGUOUS/);
  assert.match(orientation, /FLIGHT_COMMANDER_COMPASS_ORIENTATION_FAILURE_MAGNETIC_RANGE/);
});

test('learning uses calibrated board-frame acceleration and gyro motion before user board alignment', () => {
  assert.match(acceleration, /void accGetBoardFrame\(float result\[XYZ_AXIS_COUNT\]\)/);
  assert.match(gyro, /void gyroGetBoardFrame\(float result\[XYZ_AXIS_COUNT\]\)/);
  assert.match(orientation, /accGetBoardFrame\(normalizedAcc\)/);
  assert.match(orientation, /gyroGetBoardFrame\(gyroVector\)/);
  assert.match(orientation, /fabsf\(axialRate\) < lateralRate \* 1\.5F/);
});

test('learned transform precedes field calibration and remains independent from CW0 manual alignment', () => {
  const observe = compass.search(new RegExp(
    `flightCommanderCompassOrientationObserve\\(\\s*currentTimeUs,\\s*${onboardSource},\\s*mag\\.magADC\\);`,
  ));
  const apply = compass.search(new RegExp(
    `flightCommanderCompassOrientationApply\\(\\s*${onboardSource},\\s*mag\\.magADC\\);`,
  ));
  const userAlignment = compass.indexOf('applySensorAlignment(mag.magADC, mag.magADC, mag.dev.magAlign.onBoard);');
  assert.ok(observe >= 0, 'canonical source-specific sample observation is missing');
  assert.ok(apply > observe, 'learned transform must follow canonical observation');
  assert.ok(userAlignment > apply, 'manual installation alignment must follow the learned transform');
  assert.match(targetHeader, /FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG/);
  assert.match(targetHeader, /FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 3U/);
  assert.match(compass, new RegExp(
    `flightCommanderCompassOrientationGeneration\\(\\s*${onboardSource}\\s*\\)`,
  ));
  assert.match(compass, new RegExp(
    `STATE\\(CALIBRATE_MAG\\) && !flightCommanderCompassOrientationIsValid\\(\\s*${onboardSource}\\s*\\)`,
  ));
});

test('changing one source orientation invalidates only that source field calibration', () => {
  assert.match(orientation, /compass->magZero\.raw\[axis\] = 0/);
  assert.match(orientation, /compass->magGain\[axis\] = 1024/);
  assert.match(orientation, /compass->magCalibrationSignature = 0/);
  assert.match(orientation, /DISABLE_STATE\(COMPASS_CALIBRATED\)/);
  assert.match(compass, new RegExp(
    `return flightCommanderCompassOrientationIsValid\\(\\s*${onboardSource}\\s*\\) && STATE\\(COMPASS_CALIBRATED\\)`,
  ));
});

test('MSPv2 exposes independent status and command endpoints', () => {
  assert.match(protocol, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_STATUS\s+0x2F23/);
  assert.match(protocol, /MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND\s+0x2F24/);
  assert.match(msp, /flightCommanderCompassOrientationWriteStatus/);
  assert.match(msp, /flightCommanderCompassOrientationReadCommand/);
});
