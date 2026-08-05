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
assert.equal(typeof firmwareVersion, 'string');
assert.match(firmwareVersion, /^\d+\.\d+\.\d+$/);
assert.equal(typeof firmwareSourceArchive, 'string');
assert.match(
  firmwareSourceArchive,
  new RegExp(`^release/firmware/Flight-Commander-Firmware-Source-v${firmwareVersion.replaceAll('.', '\\.')}\\.zip$`),
);

const output = mkdtempSync(join(tmpdir(), `flight-commander-${firmwareVersion}-compass-`));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const archive = join(projectRoot, ...firmwareSourceArchive.split('/'));
const result = spawnSync(
  python,
  ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, output],
  { encoding: 'utf8' },
);
assert.equal(result.status, 0, `${firmwareVersion} source extraction failed:
${result.stdout}
${result.stderr}`);

const sourceRoot = join(output, `Flight-Commander-Firmware-Source-v${firmwareVersion}`);
const source = (relative) => readFileSync(join(sourceRoot, ...relative.split('/')), 'utf8');
const driver = source('src/main/drivers/compass/compass_ist8310.c');
const targetHeader = source('src/main/target/MICOAIR743/target.h');
const targetConfig = source('src/main/target/MICOAIR743/config.c');
const compassSource = source('src/main/sensors/compass.c');
const genericConfig = source('src/main/fc/config.c');
const guarded = driver
  .split('#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)', 2)[1]
  .split('#endif', 1)[0];

after(() => rmSync(output, { recursive: true, force: true }));

test(`${firmwareVersion} preserves the accepted MICOAIR743 onboard IST8310 signed permutation`, () => {
  assert.match(guarded, /if \(mag->magSensorToUse == 0\)/);
  assert.match(guarded, /mag->magADCRaw\[X\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Y\] = -nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.doesNotMatch(driver, /compassConfig|mag_align|rollDeciDegrees|pitchDeciDegrees|yawDeciDegrees/);
});

test(`${firmwareVersion} does not gate the onboard transform on mutable bus identity fields`, () => {
  assert.doesNotMatch(guarded, /busType ==|i2cBus ==|address ==/);
});

test('external tagged IST8310 devices retain the generic conversion path', () => {
  const generic = driver.split('#endif', 2)[1];
  assert.match(generic, /mag->magADCRaw\[X\] =  nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\[Y\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
});

test('CW0 is a persisted default and not a fixed runtime alignment', () => {
  assert.match(targetHeader, /#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG/);
  assert.doesNotMatch(targetHeader, /FLIGHT_COMMANDER_MAG_FIXED_ALIGN/);
  assert.match(compassSource, /PG_COMPASS_CONFIG, 8/);
  assert.match(
    compassSource,
    /#define COMPASS_RESET_ALIGN FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN/,
  );
  assert.match(compassSource, /\.mag_align = COMPASS_RESET_ALIGN/);
});

test('target startup never overwrites saved onboard alignment or custom angles', () => {
  assert.doesNotMatch(targetConfig, /#include "sensors\/compass\.h"/);
  assert.doesNotMatch(targetConfig, /compassConfigMutable/);
  assert.doesNotMatch(targetConfig, /mag_align|rollDeciDegrees|pitchDeciDegrees|yawDeciDegrees/);
  assert.doesNotMatch(targetConfig, /void validateAndFixTargetConfig\(void\)/);
});

test('only the unconfigured alignment sentinel resolves to the MICOAIR743 CW0 default', () => {
  const defaultMigration = genericConfig.match(
    /if \(compassConfig\(\)->mag_align == ALIGN_DEFAULT\) \{([\s\S]*?)\n    \}/,
  );
  assert.ok(defaultMigration, 'generic ALIGN_DEFAULT migration block is missing');
  assert.match(defaultMigration[1], /#ifdef FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN/);
  assert.match(
    defaultMigration[1],
    /compassConfigMutable\(\)->mag_align = FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN;/,
  );
  assert.doesNotMatch(
    defaultMigration[1],
    /rollDeciDegrees|pitchDeciDegrees|yawDeciDegrees/,
  );
});

test('saved calibration is bound to the selected user alignment', () => {
  assert.match(targetHeader, /FLIGHT_COMMANDER_MAG_CALIBRATION_REVISION 2U/);
  assert.match(compassSource, /config->magCalibrationRevision/);
  assert.match(compassSource, /config->mag_align/);
  assert.match(compassSource, /config->rollDeciDegrees/);
  assert.match(compassSource, /config->pitchDeciDegrees/);
  assert.match(compassSource, /config->yawDeciDegrees/);
  assert.match(
    compassSource,
    /config->magCalibrationSignature != compassCalibrationSignature\(config\)/,
  );
});

test('user alignment remains a later layer after raw driver conversion', () => {
  const rawCopy = compassSource.indexOf(
    'mag.magADC[axis] = mag.dev.magADCRaw[axis];',
  );
  const userAlignment = compassSource.indexOf(
    'applySensorAlignment(mag.magADC, mag.magADC, mag.dev.magAlign.onBoard);',
  );
  assert.ok(rawCopy >= 0, 'raw driver sample copy is missing');
  assert.ok(userAlignment > rawCopy, 'user alignment must run after driver conversion');
});
