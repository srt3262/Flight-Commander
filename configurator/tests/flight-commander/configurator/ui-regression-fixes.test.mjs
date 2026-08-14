import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const configurationSource = readFileSync(resolve(projectRoot, 'tabs/configuration.js'), 'utf8');
const stylesSource = readFileSync(resolve(projectRoot, 'src/css/styles.css'), 'utf8');
const regressionCssPath = resolve(projectRoot, 'src/css/ui-regressions.css');
const regressionCss = readFileSync(regressionCssPath, 'utf8');
const gpsCss = readFileSync(resolve(projectRoot, 'src/css/tabs/gps.css'), 'utf8');
const firmwareFeaturesHtml = readFileSync(resolve(projectRoot, 'tabs/firmware_info.html'), 'utf8');
const onboardLoggingHtml = readFileSync(resolve(projectRoot, 'tabs/onboard_logging.html'), 'utf8');
const onboardLoggingSource = readFileSync(resolve(projectRoot, 'tabs/onboard_logging.js'), 'utf8');

test('compass warning waits for populated selector settings and then refreshes', () => {
  assert.match(configurationSource, /let compassSettingsPopulated = false;/);
  assert.match(
    configurationSource,
    /if \(!compassSettingsPopulated\) \{\s*\$info\.text\('Reading configured compass sources…'\);\s*return;/s,
  );
  assert.match(
    configurationSource,
    /settingsPromise\.then\(function\(\) \{\s*compassSettingsPopulated = true;\s*renderCompassSourceSelectionInfo\(\);/s,
  );
});

test('failsafe illustrations have higher-specificity dark-theme overrides', () => {
  assert.equal(existsSync(regressionCssPath), true);
  assert.match(stylesSource, /@import '\.\/ui-regressions\.css';/);
  for (const procedure of [1, 2, 4]) {
    assert.equal(
      regressionCss.includes(`.tab-failsafe .radioarea.pro${procedure}`),
      true,
      `missing failsafe procedure ${procedure} selector`,
    );
    assert.equal(
      regressionCss.includes(`cf_failsafe_procedure${procedure}.svg`),
      true,
      `missing failsafe procedure ${procedure} image`,
    );
  }
  assert.match(regressionCss, /background-image:[\s\S]*!important;/);
});

test('Flight Planner captions keep unit spans inline and controls below', () => {
  assert.match(
    regressionCss,
    /\.tab-flight-planner \.fc-form-grid label\s*\{[^}]*display:\s*block;/s,
  );
  assert.match(
    regressionCss,
    /planner-distance-unit,[\s\S]*planner-speed-unit\s*\{[^}]*display:\s*inline;/s,
  );
  assert.match(
    regressionCss,
    /label > input,[\s\S]*label > select\s*\{[^}]*margin-top:\s*4px;/s,
  );
});

test('learned compass orientation uses the same dynamic support state as every feature tile', () => {
  const tileStart = firmwareFeaturesHtml.indexOf('data-fc-feature="compassOrientationLearning"');
  const tileEnd = firmwareFeaturesHtml.indexOf('</article>', tileStart);
  const tile = firmwareFeaturesHtml.slice(tileStart, tileEnd);

  assert.notEqual(tileStart, -1);
  assert.match(tile, /fc-firmware-feature__state/);
  assert.match(tile, /fc-firmware-feature__reason/);
  assert.doesNotMatch(tile, /Checking|fc-firmware-feature__status/);
});

test('GPS timezone conversion wrapper stays in its grid column without an overlapping format suffix', () => {
  assert.match(
    gpsCss,
    /\.gps-setting-row > \.unit_wrapper\s*\{[^}]*grid-column:\s*1;[^}]*width:\s*100%;/s,
  );
  assert.match(
    gpsCss,
    /\.gps-setting-row > \.unit_wrapper\[data-unit="hh:mm"\]::after\s*\{[^}]*display:\s*none;/s,
  );
});

test('Blackbox UI exposes all device classes without claiming unavailable dataflash', () => {
  assert.match(onboardLoggingSource, /On-board dataflash chip \(not fitted\)/);
  assert.match(onboardLoggingSource, /\.prop\('disabled', !FC\.DATAFLASH\.ready\)/);
  assert.match(onboardLoggingSource, /On-board microSD card slot/);
  assert.match(onboardLoggingSource, /No usable microSD card detected/);
  assert.doesNotMatch(onboardLoggingSource, /Fatal error<br>Reboot to retry/);
  assert.match(onboardLoggingHtml, /cube-orange-plus-sdcard-location/);
  assert.match(onboardLoggingSource, /normalizedTarget === 'CUBEORANGEPLUS'/);
});
