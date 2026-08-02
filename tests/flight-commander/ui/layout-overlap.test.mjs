import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("dark-only header has no theme control that can overlap Connect", () => {
  const index = source("index.html");
  const css = source("src/css/theme.css");
  assert.doesNotMatch(index, /id="applicationTheme"/);
  assert.doesNotMatch(index, /fc-theme-switch/);
  assert.doesNotMatch(css, /\.fc-theme-switch/);
  assert.match(source("src/css/main.css"), /\.connect_controls\s*\{[^}]*position:\s*relative;/s);
});
