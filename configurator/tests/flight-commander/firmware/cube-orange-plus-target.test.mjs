import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = resolve(configuratorRoot, '..');
const source = (relative) => readFileSync(resolve(sourceRoot, relative), 'utf8');

const targetBuild = source('src/main/target/CUBEORANGEPLUS/CMakeLists.txt');
const targetHeader = source('src/main/target/CUBEORANGEPLUS/target.h');
const targetHardware = source('src/main/target/CUBEORANGEPLUS/target.c');
const linker = source('src/main/target/link/stm32_flash_h757xi.ld');
const flasher = source('configurator/tabs/firmware_flasher.js');
const serialBootloader = source('configurator/js/protocols/stm32.js');
const releaseManifest = JSON.parse(source('RELEASE-MANIFEST.json'));

test('Cube Orange+ uses the H757 direct-SMPS application contract', () => {
  assert.match(targetBuild, /target_stm32h757xi/);
  assert.match(targetBuild, /HSE_MHZ 24/);
  assert.match(targetBuild, /USE_H7_DIRECT_SMPS_SUPPLY/);
  assert.match(targetBuild, /VECT_TAB_OFFSET=0x00020000/);
  assert.match(targetBuild, /HEX_START_ADDRESS 0x08020000/);
});

test('Cube Orange+ preserves the vendor bootloader and final config sector', () => {
  assert.match(linker, /FLASH \(rx\)\s*: ORIGIN = 0x08020000, LENGTH = 128K/);
  assert.match(linker, /FLASH1 \(rx\)\s*: ORIGIN = 0x08040000, LENGTH = 1664K/);
  assert.match(linker, /FLASH_CONFIG \(r\)\s*: ORIGIN = 0x081E0000, LENGTH = 128K/);
  assert.match(flasher, /Full chip erase is forbidden for Cube Orange\+/);
  assert.match(flasher, /erase\.prop\('disabled', protectedBootloader\)/);
  assert.match(serialBootloader, /first_page = Math\.floor\(first_address \/ self\.page_size\)/);
  assert.match(serialBootloader, /for \(var i = first_page; i <= last_page; i\+\+\)/);
});

test('Cube Orange+ exposes only the six direct FMU AUX outputs', () => {
  const outputPins = [...targetHardware.matchAll(
    /DEF_TIM\([^,]+,[^,]+,\s*([A-Z]{2}\d+),\s*TIM_USE_OUTPUT_AUTO/g,
  )].map((match) => match[1]);
  assert.deepEqual(outputPins, ['PE14', 'PE13', 'PE11', 'PE9', 'PD13', 'PD14']);
  assert.match(targetHeader, /MAX_PWM_OUTPUT_PORTS 6/);
  assert.doesNotMatch(targetHeader, /#define USE_UART6\b/);
  assert.match(targetHeader, /USART6 is reserved for the onboard IOMCU/);
});

test('4.1.8 release manifest independently identifies both official targets', () => {
  assert.equal(releaseManifest.schema, 2);
  assert.equal(releaseManifest.version, '4.1.8');
  assert.deepEqual(releaseManifest.targets, ['MICOAIR743', 'CUBEORANGEPLUS']);
  assert.deepEqual(Object.keys(releaseManifest.artifacts), releaseManifest.targets);
});
