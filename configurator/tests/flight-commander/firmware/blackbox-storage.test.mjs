import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = resolve(configuratorRoot, '..');
const source = (relative) => readFileSync(resolve(sourceRoot, relative), 'utf8');

const cube = source('src/main/target/CUBEORANGEPLUS/target.h');
const mico = source('src/main/target/MICOAIR743/target.h');
const msp = source('src/main/fc/fc_msp.c');
const sdcard = source('src/main/drivers/sdcard/sdcard.c');

for (const [target, header] of [['CUBEORANGEPLUS', cube], ['MICOAIR743', mico]]) {
  test(`${target} uses its real SDMMC microSD interface as default Blackbox storage`, () => {
    assert.match(header, /#define USE_SDCARD\b/);
    assert.match(header, /#define USE_SDCARD_SDIO\b/);
    assert.match(header, /#define SDCARD_SDIO_DEVICE\s+SDIODEV_1/);
    assert.match(header, /#define SDCARD_SDIO_4BIT\b/);
    assert.match(header, /#define ENABLE_BLACKBOX_LOGGING_ON_SDCARD_BY_DEFAULT\b/);
    assert.doesNotMatch(header, /#define USE_FLASHFS\b/);
  });
}

test('empty SDMMC slots without a detect switch are reported as unavailable, not fatal', () => {
  assert.match(sdcard, /bool sdcard_hasInsertionDetect\(void\)/);
  assert.match(sdcard, /return sdcard\.cardDetectPin != NULL;/);
  assert.match(
    msp,
    /state = sdcard_hasInsertionDetect\(\) \? MSP_SDCARD_STATE_FATAL : MSP_SDCARD_STATE_NOT_PRESENT;/,
  );
});

test('firmware reports compiled dataflash support independently of chip readiness', () => {
  assert.match(
    msp,
    /MSP_FLASHFS_BIT_SUPPORTED \| \(flashIsReady\(\) \? MSP_FLASHFS_BIT_READY : 0\)/,
  );
});
