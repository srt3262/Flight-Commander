import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");
const theme = source("src/css/theme.css");

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function variable(name) {
  return theme.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
}

test("dark stylesheet is loaded after every legacy and Flight Commander surface", () => {
  const entry = source("js/configurator_main.js");
  assert.ok(entry.indexOf("src/css/styles.css") < entry.indexOf("src/css/flight-commander.css"));
  assert.ok(entry.indexOf("src/css/flight-commander.css") < entry.indexOf("src/css/theme.css"));
  assert.doesNotMatch(source("src/css/styles.css"), /@import ['"]theme\.css/);
});

test("dark palette maintains readable body, secondary, disabled, warning, and action text", () => {
  const text = variable("--fc-theme-text");
  const muted = variable("--fc-theme-muted");
  const disabledText = variable("--fc-theme-disabled-text");
  const content = variable("--fc-theme-content");
  const surface = variable("--fc-theme-surface");
  const disabled = variable("--fc-theme-disabled");
  const warning = variable("--fc-theme-warning");
  const warningText = variable("--fc-theme-warning-text");
  const action = variable("--fc-theme-accent-strong");

  assert.ok(contrast(text, content) >= 7);
  assert.ok(contrast(muted, surface) >= 4.5);
  assert.ok(contrast(disabledText, disabled) >= 4.5);
  assert.ok(contrast(warningText, warning) >= 4.5);
  assert.ok(contrast("#ffffff", action) >= 4.5);
});

test("contrast scrub explicitly covers every active configuration family", () => {
  const expectedSurfaces = [
    /\.defaults-dialog__content/,
    /\.logic__content/,
    /\.tab-landing \.content_top/,
    /#interactive_block/,
    /\.tab-calibration \.tile/,
    /\.tab-configuration \.mixerPreview/,
    /\.tab-ports table tbody tr:nth-child\(even\)/,
    /\.mixer-table tr:nth-child\(even\)/,
    /\.tab-motors \.m-block/,
    /\.tab-receiver \.tunings table td/,
    /\.tab-modes \.boxes \.switches/,
    /\.tab-failsafe \.radioarea/,
    /\.tab-pid_tuning \.pid-sliders-axis/,
    /\.tab-adjustments \.adjustments/,
    /\.tab-gps \.GPS_info \.head/,
    /\.tab-magnetometer \.magnetometer_info \.head/,
    /\.tab-sensors \.plot_control/,
    /\.tab-osd \.display-field\.mouseover/,
    /\.tab-led-strip \.mainGrid/,
    /\.tab-onboard_logging \.dataflash-contents/,
    /\.version-warning-overlay__content/,
    /\.map-table tr:nth-child\(even\) td/,
    /\.fc-toolbar/,
    /\.fc-map-attribution/,
    /\.fc-message-log/,
    /\.fc-parameter-group/,
    /\.fc-parameter-identity strong/,
    /\.fc-stats div/,
    /\.fc-planning-card/,
    /\.fc-ap-panel/,
    /\.fc-ap-pid-related-settings/,
  ];
  for (const selector of expectedSurfaces) assert.match(theme, selector);
});

test("disabled fields, zebra rows, PID panels, and preset modal cannot fall back to light", () => {
  assert.match(theme, /input:disabled[\s\S]*?background-color:\s*var\(--fc-theme-disabled\)\s*!important/);
  assert.match(theme, /\.tab-ports table tbody tr:nth-child\(even\)[\s\S]*?background-color:\s*var\(--fc-theme-row-even\)\s*!important/);
  assert.match(theme, /\.tab-pid_tuning \.pid-sliders-axis\[style\][\s\S]*?background-color:\s*#1d403b\s*!important/);
  assert.match(theme, /\.jBox-container[\s\S]*?background-color:\s*var\(--fc-theme-surface\)/);
});
