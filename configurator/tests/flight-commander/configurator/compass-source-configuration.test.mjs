import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXTERNAL_COMPASS_SELECTION_DISABLED,
  EXTERNAL_COMPASS_SELECTION_DRONECAN,
  applyCompassSourceSelections,
  createDefaultHeadingConfig,
  externalI2cCompassSelection,
  selectedExternalCompass,
  validateHeadingConfig,
} from '../../../js/flightCommander/headingFusion.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const configurationHtml = readFileSync(resolve(projectRoot, 'tabs/configuration.html'), 'utf8');
const configurationSource = readFileSync(resolve(projectRoot, 'tabs/configuration.js'), 'utf8');

test('Configuration exposes independent onboard and external compass dropdowns', () => {
  assert.match(configurationHtml, /id="sensor-mag"[^>]*data-setting="mag_hardware"/);
  assert.match(configurationHtml, /Onboard compass/);
  assert.match(configurationHtml, /id="external-compass-source"/);
  assert.match(configurationHtml, /value="disabled">Disabled \/ none/);
  assert.match(configurationHtml, /External compass/);
  assert.match(configurationSource, /EXTERNAL_MAG_HARDWARE/);
  assert.match(configurationSource, /applyCompassSourceSelections/);
  assert.match(configurationSource, /saveFlightCommanderHeadingConfig/);
});

test('onboard and external compass sources can both be disabled', () => {
  const config = createDefaultHeadingConfig();
  applyCompassSourceSelections(config, {
    onboardHardware: 0,
    externalSelection: EXTERNAL_COMPASS_SELECTION_DISABLED,
  });
  assert.equal(config.sources[0].enabled, false);
  assert.equal(config.sources[1].enabled, false);
  assert.equal(config.sources[2].enabled, false);
  assert.deepEqual(config.sources.slice(0, 3).map(({ weight }) => weight), [0, 0, 0]);
  assert.equal(config.externalMagHardware, 0);
  assert.doesNotThrow(() => validateHeadingConfig(config, { magNodeId: 255 }));
});

test('the external dropdown selects exactly one external compass transport', () => {
  const config = createDefaultHeadingConfig();
  applyCompassSourceSelections(config, {
    onboardHardware: 6,
    externalSelection: externalI2cCompassSelection(6),
  });
  assert.equal(config.sources[0].enabled, true);
  assert.equal(config.sources[1].enabled, true);
  assert.equal(config.sources[2].enabled, false);
  assert.equal(config.externalMagHardware, 6);
  assert.equal(selectedExternalCompass(config), 'i2c:6');

  applyCompassSourceSelections(config, {
    onboardHardware: 0,
    externalSelection: EXTERNAL_COMPASS_SELECTION_DRONECAN,
  });
  assert.equal(config.sources[0].enabled, false);
  assert.equal(config.sources[1].enabled, false);
  assert.equal(config.sources[2].enabled, true);
  assert.equal(config.externalMagHardware, 0);
  assert.equal(selectedExternalCompass(config), EXTERNAL_COMPASS_SELECTION_DRONECAN);
  assert.doesNotThrow(() => validateHeadingConfig(config, { magNodeId: 73 }));
});
