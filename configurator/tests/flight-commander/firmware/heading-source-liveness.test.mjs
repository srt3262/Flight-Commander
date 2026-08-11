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
const taskSource = source('src/main/fc/fc_tasks.c');
const driver = source('src/main/drivers/compass/compass_ist8310.c');
const compass = source('src/main/sensors/compass.c');
const fusion = source('src/main/flight_commander/heading_fusion.c');
const dronecan = source('src/main/drivers/dronecan/dronecan.c');
const targetCmake = source('cmake/flight-commander-micoair743.cmake');
const imu = source('src/main/flight/imu.c');

test('heading fusion retains the reviewed time-based IST8310 recovery', () => {
  assert.match(taskSource, /rescheduleTask\(TASK_COMPASS, TASK_PERIOD_HZ\(40\)\)/);
  assert.match(driver, /#define IST8310_CONVERSION_TIMEOUT_MS 75U/);
  assert.match(driver, /#define IST8310_FULL_RESET_AFTER_TIMEOUTS 2U/);
  assert.match(driver, /ist8310ServiceRuntimeReset/);
  assert.doesNotMatch(driver, /IST8310_DATA_READY_RETRY_LIMIT/);
});

test('fresh magnetic samples keep heading availability even at displayed quality zero', () => {
  assert.match(compass, /uint16_t compassGetSampleAgeMs\(void\)/);
  assert.match(fusion, /sample->hasMeasurement \? now - sample->updatedAtMs : UINT32_MAX/);
  assert.match(fusion, /#define FLIGHT_COMMANDER_MAG_FUSION_QUALITY_FLOOR 1U/);
  assert.match(fusion, /effectiveSourceQuality/);
  assert.match(fusion, /!isfinite\(fieldBody->x\)/);
  assert.doesNotMatch(fusion, /quality >= FLIGHT_COMMANDER_MAG_MIN_FIELD_QUALITY/);
});

test('stationary startup uses a dedicated stable fused-heading seed', () => {
  assert.match(fusion, /#define FLIGHT_COMMANDER_STARTUP_STABLE_SAMPLE_COUNT 4U/);
  assert.match(fusion, /FLIGHT_COMMANDER_STARTUP_MAX_STEP_CENTIDEGREES 500U/);
  assert.match(fusion, /flightCommanderHeadingUpdate\(\);/);
  assert.match(imu, /static bool flightCommanderHeadingInitialized = false/);
  assert.match(imu, /!flightCommanderHeadingInitialized && !ARMING_FLAG\(ARMED\)/);
  assert.match(imu, /resetHeadingHoldTarget\(CENTIDEGREES_TO_DEGREES\(fusedHeadingCentidegrees\)\)/);
  assert.doesNotMatch(imu, /!gpsHeadingInitialized &&\s*flightCommanderHeadingGetFusedHeading/);
});

test('disabled sources use zero weight in reset, migration and MSP input paths', () => {
  assert.match(fusion, /\{ false, 2, 0, 0 \}/);
  assert.match(fusion, /\{ false, 3, 0, 0 \}/);
  assert.match(fusion, /\{ false, 4, 0, 0 \}/);
  assert.match(fusion, /if \(!config->sources\[index\]\.enabled\) \{\s*config->sources\[index\]\.weight = 0;/);
  assert.match(fusion, /if \(!value\.sources\[index\]\.enabled\) \{\s*value\.sources\[index\]\.weight = 0;/);
});

test('DroneCAN compass accepts AP_Periph legacy and sensor-ID magnetic field messages', () => {
  assert.match(
    dronecan,
    /case UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH_ID:\s*\*signature = UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH_SIGNATURE;/,
  );
  assert.match(
    dronecan,
    /case UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH_ID: handleLegacyMagneticField\(transfer\); break;/,
  );
  assert.match(
    dronecan,
    /case UAVCAN_EQUIPMENT_AHRS_MAGNETICFIELDSTRENGTH2_ID: handleMagneticField\(transfer\); break;/,
  );
  assert.match(
    dronecan,
    /dronecanMarkNodeCapability\(transfer->source_node_id, DRONECAN_NODE_CAPABILITY_MAG\);/,
  );
  assert.match(
    targetCmake,
    /uavcan\.equipment\.ahrs\.MagneticFieldStrength\.c/,
  );
  assert.match(
    targetCmake,
    /uavcan\.equipment\.ahrs\.MagneticFieldStrength2\.c/,
  );
});
