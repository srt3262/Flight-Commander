import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dirname, join, resolve } from 'node:path';

import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const firmwareVersion = packageManifest.flightCommander.firmwareSourceVersion;
const sourceRoot = resolve(projectRoot, '..');
const source = (relative) => readFileSync(join(sourceRoot, ...relative.split('/')), 'utf8');
const targetHeader = source('src/main/target/MICOAIR743/target.h');
const acceleration = source('src/main/sensors/acceleration.c');
const gyro = source('src/main/sensors/gyro.c');
const orientation = source('src/main/flight_commander/compass_orientation.c');

test('MICOAIR743 retains its fixed BMI088 rotation instead of reflecting one axis', () => {
  assert.match(targetHeader, /#define IMU_BMI088_ALIGN\s+CW270_DEG/);
  assert.doesNotMatch(targetHeader, /IMU_BMI088_ALIGN\s+CW270_DEG_FLIP/);
});

test('accelerometer attitude path has no 4.0.6 side buffer or mirrored write', () => {
  assert.doesNotMatch(acceleration, /accBoardFrameG/);
  assert.match(
    acceleration,
    /applySensorAlignment\(accADC, accADC, acc\.dev\.accAlign\);\s*applyBoardAlignment\(accADC\);/,
  );
  assert.match(acceleration, /arm_sub_f32\(acc\.dev\.ADCRaw, fAccZero, zeroed, XYZ_AXIS_COUNT\)/);
  assert.match(acceleration, /applySensorAlignment\(calibrated, calibrated, acc\.dev\.accAlign\)/);
  assert.match(acceleration, /arm_scale_f32\(calibrated, 1\.0F \/ acc\.dev\.acc_1G, result/);
});

test('gyro attitude path has no 4.0.6 side buffer or mirrored write', () => {
  assert.doesNotMatch(gyro, /gyroBoardFrameDps/);
  assert.match(
    gyro,
    /applySensorAlignment\(gyroADCtmp, gyroADCtmp, gyroDev->gyroAlign\);\s*applyBoardAlignment\(gyroADCtmp\);\s*\/\/ Convert to deg\/s and store in unified data\s*arm_scale_f32\(gyroADCtmp, gyroDev->scale, gyroADCf, 3\);/,
  );
  assert.match(gyro, /arm_sub_f32\(gyroDev\[0\]\.gyroADCRaw, gyroDev\[0\]\.gyroZero, calibrated/);
  assert.match(gyro, /applySensorAlignment\(calibrated, calibrated, gyroDev\[0\]\.gyroAlign\)/);
  assert.match(gyro, /arm_scale_f32\(calibrated, gyroDev\[0\]\.scale, result/);
});

test('compass learning still consumes the on-demand pre-board IMU vectors', () => {
  assert.match(orientation, /accGetBoardFrame\(normalizedAcc\)/);
  assert.match(orientation, /gyroGetBoardFrame\(gyroVector\)/);
});
