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
const driver = readFileSync(
  join(sourceRoot, 'src/main/drivers/compass/compass_ist8310.c'),
  'utf8',
);
const guarded = driver
  .split('#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)', 2)[1]
  .split('#endif', 1)[0];
after(() => rmSync(output, { recursive: true, force: true }));

test(`${firmwareVersion} preserves the accepted MICOAIR743 onboard IST8310 signed permutation`, () => {
  assert.match(guarded, /if \(mag->magSensorToUse == 0\)/);
  assert.match(guarded, /mag->magADCRaw\[X\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Y\] = -nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
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
