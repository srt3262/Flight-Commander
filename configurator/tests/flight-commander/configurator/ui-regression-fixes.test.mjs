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
