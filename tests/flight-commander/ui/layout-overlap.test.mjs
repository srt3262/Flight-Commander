import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("ArduPilot Save and reboot pages reserve a non-overlaying footer", () => {
  for (const path of [
    "tabs/ardupilot_setup.html",
    "tabs/ardupilot_ports.html",
    "tabs/ardupilot_receiver.html",
    "tabs/ardupilot_modes.html",
    "tabs/ardupilot_feature.html",
    "tabs/ardupilot_pid_tuning.html",
  ]) {
    const html = source(path);
    assert.match(html, /class="[^"]*fc-ap-editor-page[^"]*"/);
    assert.match(html, /class="content_toolbar fc-ap-toolbar"/);
    assert.match(html, /Save &amp; reboot/);
  }

  const css = source("src/css/ardupilot_setup.css");
  assert.match(css, /\.fc-ap-editor-page\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /\.fc-ap-editor-page\s*>\s*\.content_wrapper\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.fc-ap-editor-page\s*>\s*\.fc-ap-toolbar\s*\{[^}]*position:\s*static;/s);
});

test("theme and connection controls occupy separate header lanes", () => {
  const css = source("src/css/theme.css");
  assert.match(css, /\.fc-theme-switch\s*\{[^}]*top:\s*4px;/s);
  assert.match(css, /\.headerbar\s+\.connect_controls\s*\{[^}]*top:\s*34px;/s);
});
