import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(resolve(root, "../.github/workflows/release.yml"), "utf8");

test("4.1.9 coordinates Configurator and Firmware versions", () => {
  assert.equal(packageJson.version, "4.1.9");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.1.9");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.1.9");
});

test("official publisher creates a verified non-prerelease 4.1.9 bundle", () => {
  assert.match(publisher, /Publish verified release/);
  assert.match(publisher, /gh release create/);
  assert.doesNotMatch(publisher, /gh release delete/);
  assert.match(publisher, /exactly the five canonical files/);
  assert.match(publisher, /exactly the three public assets/);
  assert.doesNotMatch(publisher, /--prerelease/);
});
