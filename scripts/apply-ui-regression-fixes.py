#!/usr/bin/env python3
"""Apply the three Configurator-only UI regression fixes reported against 4.0.8."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} marker, found {count}")
    return text.replace(old, new, 1)


def patch_configuration() -> None:
    path = ROOT / "tabs/configuration.js"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        """        function dronecanCompassConfigured() {
""",
        """        let compassSettingsPopulated = false;

        function dronecanCompassConfigured() {
""",
        "compass settings readiness insertion",
    )

    text = replace_once(
        text,
        """            const onboardEnabled = Number($('#sensor-mag').val()) !== 0;
            const externalSelection = $('#external-compass-source').val();
""",
        """            if (!compassSettingsPopulated) {
                $info.text('Reading configured compass sources…');
                return;
            }
            const onboardEnabled = Number($('#sensor-mag').val()) !== 0;
            const externalSelection = $('#external-compass-source').val();
""",
        "pre-settings compass warning logic",
    )

    text = replace_once(
        text,
        """        // Wait for settings to load before triggering change event
        settingsPromise.then(function() {
            $i2cSpeed.trigger('change');
        }).catch(function(error) {
            console.error('Settings load failed, I2C speed change not triggered:', error);
        });
""",
        """        // Refresh dependent UI only after Settings has populated every selector.
        settingsPromise.then(function() {
            compassSettingsPopulated = true;
            renderCompassSourceSelectionInfo();
            $i2cSpeed.trigger('change');
        }).catch(function(error) {
            console.error('Settings load failed, delayed UI refreshes were not triggered:', error);
        });
""",
        "post-settings UI refresh",
    )

    path.write_text(text, encoding="utf-8")


def patch_styles() -> None:
    styles_path = ROOT / "src/css/styles.css"
    styles = styles_path.read_text(encoding="utf-8")
    import_line = "@import './ui-regressions.css';"
    if import_line in styles:
        raise RuntimeError("UI regression stylesheet import already exists")
    styles_path.write_text(styles.rstrip() + f"\n{import_line}\n", encoding="utf-8")

    override_path = ROOT / "src/css/ui-regressions.css"
    if override_path.exists():
        raise RuntimeError("UI regression stylesheet already exists")
    override_path.write_text(
        """/*
 * Narrow fixes for regressions discovered during Flight Commander 4.0.8 bench review.
 * These selectors intentionally outrank inherited dark-theme and form-grid rules.
 */

/* Restore INAV's Drop, Land, and RTH behavior illustrations in the dark theme. */
.tab-failsafe .radioarea {
    color: var(--fc-theme-text) !important;
    border: 1px solid var(--fc-theme-border) !important;
    background-color: var(--fc-theme-surface-alt) !important;
}

.tab-failsafe .radioarea.pro1,
.tab-failsafe .radioarea.pro2,
.tab-failsafe .radioarea.pro4 {
    background-repeat: no-repeat, no-repeat !important;
    background-position: center right 10px, center right !important;
    background-size: 200px auto, 220px 100% !important;
}

.tab-failsafe .radioarea.pro1 {
    background-image:
        url("./../../images/icons/cf_failsafe_procedure1.svg"),
        linear-gradient(#dce3e7, #dce3e7) !important;
}

.tab-failsafe .radioarea.pro2 {
    background-image:
        url("./../../images/icons/cf_failsafe_procedure2.svg"),
        linear-gradient(#dce3e7, #dce3e7) !important;
}

.tab-failsafe .radioarea.pro4 {
    background-image:
        url("./../../images/icons/cf_failsafe_procedure4.svg"),
        linear-gradient(#dce3e7, #dce3e7) !important;
}

.tab-failsafe .radioarea.pro5 {
    background-image: none !important;
}

/* Keep label captions and their unit spans inline, with the control below. */
.tab-flight-planner .fc-form-grid label {
    display: block;
    min-width: 0;
    line-height: 1.35;
}

.tab-flight-planner .fc-form-grid label > .planner-distance-unit,
.tab-flight-planner .fc-form-grid label > .planner-speed-unit {
    display: inline;
}

.tab-flight-planner .fc-form-grid label > input,
.tab-flight-planner .fc-form-grid label > select {
    display: block;
    margin-top: 4px;
}
""",
        encoding="utf-8",
    )


def add_regression_tests() -> None:
    path = ROOT / "tests/flight-commander/configurator/ui-regression-fixes.test.mjs"
    if path.exists():
        raise RuntimeError("UI regression test already exists")
    path.write_text(
        """import assert from 'node:assert/strict';
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
    assert.match(
      regressionCss,
      new RegExp(`\\.tab-failsafe \\.radioarea\\.pro${procedure}\\s*\\{[^}]*cf_failsafe_procedure${procedure}\\.svg`, 's'),
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
""",
        encoding="utf-8",
    )


def main() -> int:
    patch_configuration()
    patch_styles()
    add_regression_tests()
    print("Applied Configuration, failsafe, and Flight Planner UI regression fixes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
