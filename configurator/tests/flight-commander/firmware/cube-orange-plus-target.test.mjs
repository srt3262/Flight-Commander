import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = resolve(configuratorRoot, '..');
const source = (relative) => readFileSync(resolve(sourceRoot, relative), 'utf8');

const rootBuild = source('CMakeLists.txt');
const targetBuild = source('src/main/target/CUBEORANGEPLUS/CMakeLists.txt');
const targetHeader = source('src/main/target/CUBEORANGEPLUS/target.h');
const targetHardware = source('src/main/target/CUBEORANGEPLUS/target.c');
const targetStartup = source('src/main/target/CUBEORANGEPLUS/startup.c');
const startup = source('src/main/startup/startup_stm32h757xx.s');
const h7SystemStartup = source('src/main/target/system_stm32h7xx.c');
const usbCdcInterface = source('src/main/vcp_hal/usbd_cdc_interface.c');
const usbDescriptor = source('src/main/vcp_hal/usbd_desc.c');
const linker = source('src/main/target/link/stm32_flash_h757xi.ld');
const flasher = source('configurator/tabs/firmware_flasher.js');
const serialBootloader = source('configurator/js/protocols/stm32.js');
const releaseManifest = JSON.parse(source('RELEASE-MANIFEST.json'));

test('Cube Orange+ uses the H757 direct-SMPS application contract', () => {
  assert.match(targetBuild, /target_stm32h757xi/);
  assert.match(targetBuild, /HSE_MHZ 24/);
  assert.match(targetBuild, /USE_H7_DIRECT_SMPS_SUPPLY/);
  assert.match(targetBuild, /USE_CUBEORANGEPLUS_ARDUPILOT_STARTUP/);
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

test('Cube Orange+ converts both isolated IMUs into the Flight Commander body frame', () => {
  assert.match(
    targetHardware,
    /cube_imu0_icm42688[^\n]+PC15[^\n]+CW270_DEG_FLIP/,
  );
  assert.match(
    targetHardware,
    /cube_imu0_icm45686[^\n]+PC15[^\n]+CW270_DEG_FLIP/,
  );
  assert.match(
    targetHardware,
    /cube_imu1_icm42688[^\n]+PC13[^\n]+CW270_DEG\)/,
  );
  assert.match(
    targetHardware,
    /cube_imu1_icm45686[^\n]+PC13[^\n]+CW270_DEG\)/,
  );
  assert.match(
    targetHardware,
    /ArduPilot-to-Flight\s+\* Commander sensor-driver convention adds a 180-degree roll/,
  );
});

test('Cube Orange+ normalizes the ChibiOS bootloader PSP handoff before C startup', () => {
  const resetHandler = startup.slice(startup.indexOf('Reset_Handler:'));
  const setMsp = resetHandler.indexOf('msr   msp, r0');
  const setPsp = resetHandler.indexOf('msr   psp, r0');
  const selectMsp = resetHandler.indexOf('msr   control, r0');
  const instructionSyncBarrier = resetHandler.indexOf('isb');
  const boardEarlyInit = resetHandler.indexOf('bl cubeOrangePlusEarlyInit');

  assert.match(resetHandler, /ldr\s+r0, =_estack/);
  assert.ok(setMsp >= 0 && setMsp < setPsp);
  assert.ok(setPsp < selectMsp);
  assert.ok(selectMsp < instructionSyncBarrier);
  assert.ok(instructionSyncBarrier < boardEarlyInit);
  assert.doesNotMatch(resetHandler, /IWDG1_KR_ADDRESS|IwdgUpdateWait/);
});

test('Cube Orange+ retains the bootloader interrupt lock through HAL/NVIC startup', () => {
  const resetHandler = startup.slice(startup.indexOf('Reset_Handler:'));
  const lockInterrupts = resetHandler.indexOf('cpsid i');
  const boardEarlyInit = resetHandler.indexOf('bl cubeOrangePlusEarlyInit');
  const systemInit = resetHandler.indexOf('bl  SystemInit');
  const cubeSystemInit = h7SystemStartup.slice(
    h7SystemStartup.indexOf('#ifdef USE_CUBEORANGEPLUS_ARDUPILOT_STARTUP'),
    h7SystemStartup.indexOf('#else', h7SystemStartup.indexOf('#ifdef USE_CUBEORANGEPLUS_ARDUPILOT_STARTUP')),
  );
  const halInit = cubeSystemInit.indexOf('HAL_Init();');
  const clearPending = cubeSystemInit.lastIndexOf(
    'SCB->ICSR = SCB_ICSR_PENDSTCLR_Msk | SCB_ICSR_PENDSVCLR_Msk;',
  );
  const clearBasePriority = cubeSystemInit.indexOf('__set_BASEPRI(0U);');
  const clearFaultMask = cubeSystemInit.indexOf('__set_FAULTMASK(0U);');
  const unlockInterrupts = cubeSystemInit.indexOf('__enable_irq();');

  assert.ok(lockInterrupts >= 0 && lockInterrupts < boardEarlyInit);
  assert.ok(boardEarlyInit < systemInit);
  assert.doesNotMatch(resetHandler.slice(lockInterrupts, systemInit), /\bcpsie i\b/);
  assert.ok(halInit >= 0 && halInit < clearPending);
  assert.ok(clearPending < clearBasePriority);
  assert.ok(clearBasePriority < clearFaultMask);
  assert.ok(clearFaultMask < unlockInterrupts);
});

test('Cube Orange+ reproduces the pinned ArduPilot power and clock handoff before C runtime', () => {
  const earlyInitCall = startup.indexOf('bl cubeOrangePlusEarlyInit');
  const dataCopy = startup.indexOf('CopyDataInit:');

  assert.match(targetStartup, /ArduPilot 4\.7\.0 CubeOrangePlus hwdef\.dat/);
  assert.match(targetStartup, /1511f27194f1dcc3728270883047bdf022b3fd53/);
  assert.match(targetHeader, /#define USE_VENDOR_BOOTLOADER_CLOCK_HANDOFF\b/);
  assert.ok(earlyInitCall >= 0 && earlyInitCall < dataCopy);
  assert.match(targetStartup, /PWR->CR1 = 0xF000C000U/);
  assert.match(targetStartup, /RCC->PLLCKSELR = 0x00602032U/);
  assert.match(targetStartup, /RCC->PLL1DIVR = 0x01090263U/);
  assert.match(targetStartup, /RCC->PLL2DIVR = 0x02050431U/);
  assert.match(targetStartup, /RCC->PLL3DIVR = 0x08050E47U/);
  assert.match(targetStartup, /RCC->PLLCFGR = 0x01BF0BDDU/);
  assert.match(targetStartup, /RCC->D2CCIP2R = 0x00E01009U/);
  assert.match(targetStartup, /RCC->D3CCIPR = 0x10010100U/);
});

test('Cube Orange+ reset stack stays in the first D2 SRAM bank', () => {
  assert.match(linker, /D2_STACK \(rwx\)\s*: ORIGIN = 0x30000000, LENGTH = 8K/);
  assert.match(linker, /D2_RAM \(rwx\)\s*: ORIGIN = 0x30002000, LENGTH = 248K/);
  assert.match(linker, /REGION_ALIAS\("STACKRAM", D2_STACK\)/);
});

test('Cube Orange+ does not assume the serial-only stock bootloader starts IWDG1', () => {
  assert.doesNotMatch(targetHeader, /USE_VENDOR_BOOTLOADER_WATCHDOG/);
  assert.doesNotMatch(targetHardware, /IWDG1|vendorBootloaderWatchdog/);
});

test('H7 USB enables the CDC polling timer clock before configuring TIM7', () => {
  const timerConfig = usbCdcInterface.slice(
    usbCdcInterface.lastIndexOf('static void TIM_Config(void)'),
    usbCdcInterface.lastIndexOf('static void Error_Handler(void)'),
  );
  const clockEnable = timerConfig.indexOf('TIMx_CLK_ENABLE();');
  const timerInit = timerConfig.indexOf('HAL_TIM_Base_Init(&TimHandle)');

  assert.match(targetHeader, /#define USE_USB_CDC_TIMER_CLOCK_PREINIT\b/);
  assert.ok(clockEnable >= 0 && clockEnable < timerInit);
  assert.match(timerConfig, /#ifdef USE_USB_CDC_TIMER_CLOCK_PREINIT/);
  assert.match(timerConfig, /#ifndef USE_USB_CDC_TIMER_CLOCK_PREINIT/);
});

test('Cube Orange+ advertises a distinct Flight Commander USB identity', () => {
  assert.match(targetHeader, /USBD_PRODUCT_STRING\s+"Flight Commander CubeOrange\+"/);
  assert.match(usbDescriptor, /USBD_MANUFACTURER_STRING\s+"Flight Commander"/);
  assert.match(usbDescriptor, /#ifdef USBD_PRODUCT_STRING/);
  assert.match(usbDescriptor, /USBD_PRODUCT_FS_STRING\s+USBD_PRODUCT_STRING/);
});

test('bench builds can override the embedded Flight Commander patch version', () => {
  assert.match(rootBuild, /if\(NOT DEFINED FLIGHT_COMMANDER_FIRMWARE_VERSION\)/);
  assert.match(rootBuild, /set\(FLIGHT_COMMANDER_FIRMWARE_VERSION 4\.3\.0\)/);
  assert.match(rootBuild, /FLIGHT_COMMANDER_VERSION_PATCH=\$\{FLIGHT_COMMANDER_VERSION_PATCH\}/);
});

test('4.3.0 release manifest independently identifies both official targets', () => {
  assert.equal(releaseManifest.schema, 2);
  assert.equal(releaseManifest.version, '4.3.0');
  assert.deepEqual(releaseManifest.targets, ['MICOAIR743', 'CUBEORANGEPLUS']);
  assert.deepEqual(Object.keys(releaseManifest.artifacts), releaseManifest.targets);
});
