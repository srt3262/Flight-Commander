import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(
  new URL('../../../scripts/prepare-flight-commander-firmware-4.0.1.py', import.meta.url),
  'utf8',
);

test('4.0.1 restores the accepted MICOAIR743 onboard IST8310 signed permutation', () => {
  assert.match(script, /if \(mag->magSensorToUse == 0\)/);
  assert.match(script, /mag->magADCRaw\[X\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(script, /mag->magADCRaw\[Y\] = -nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(script, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
});

test('4.0.1 no longer gates the onboard transform on mutable bus identity fields', () => {
  const guarded = script
    .split('#if defined(FLIGHT_COMMANDER_MICOAIR743_ONBOARD_IST8310)', 2)[1]
    .split('#endif', 1)[0];
  assert.doesNotMatch(guarded, /busType ==|i2cBus ==|address ==/);
});

test('external tagged IST8310 devices retain the generic conversion path', () => {
  assert.match(script, /mag->magADCRaw\[X\] =  nativeX \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(script, /mag->magADCRaw\[Y\] = -nativeY \* IST8310_LSB_TO_MILLIGAUSS;/);
  assert.match(script, /mag->magADCRaw\[Z\] =  nativeZ \* IST8310_LSB_TO_MILLIGAUSS;/);
});
