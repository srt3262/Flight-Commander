import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = mkdtempSync(join(tmpdir(), 'flight-commander-4.0.1-compass-'));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const baselineArchive = process.env.FLIGHT_COMMANDER_400_SOURCE_ARCHIVE || join(
  projectRoot,
  'release/firmware/Flight-Commander-Firmware-Source-v4.0.0.zip',
);
const result = spawnSync(
  python,
  [
    join(projectRoot, 'scripts/prepare-flight-commander-firmware-4.0.1.py'),
    '--archive',
    baselineArchive,
    '--output',
    output,
  ],
  { cwd: projectRoot, encoding: 'utf8' },
);

assert.equal(
  result.status,
  0,
  `4.0.1 source preparation failed:\n${result.stdout}\n${result.stderr}`,
);

const driver = readFileSync(
  join(
    output,
    'Flight-Commander-Firmware-Source-v4.0.1',
    'src/main/drivers/compass/compass_ist8310.c',
  ),
  'utf8',
);
const guarded = driver
  .split('#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)', 2)[1]
  .split('#endif', 1)[0];

after(() => rmSync(output, { recursive: true, force: true }));

test('4.0.1 restores the accepted MICOAIR743 onboard IST8310 signed permutation', () => {
  assert.match(guarded, /if \(mag->magSensorToUse == 0\)/);
  assert.match(guarded, /mag->magADCRaw\[X\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Y\] = -nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(guarded, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
});

test('4.0.1 no longer gates the onboard transform on mutable bus identity fields', () => {
  assert.doesNotMatch(guarded, /busType ==|i2cBus ==|address ==/);
});

test('external tagged IST8310 devices retain the generic conversion path', () => {
  const generic = driver.split('#endif', 2)[1];
  assert.match(generic, /mag->magADCRaw\[X\] =  nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\[Y\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(generic, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
});
