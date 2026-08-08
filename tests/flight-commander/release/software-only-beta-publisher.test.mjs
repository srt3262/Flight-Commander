import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");

test("4.1.3 is Configurator-only and retains verified Firmware 4.0.8", () => {
  assert.equal(packageJson.version, "4.1.3");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, false);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.0.8");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.0.8");
});

test("official publisher keeps Configurator and retained firmware versions distinct", () => {
  assert.match(publisher, /firmwareChangedInRelease/);
  assert.match(publisher, /FIRMWARE_IMAGE_VERSION/);
  assert.match(publisher, /FC-Firmware-v\$firmwareVersion-MICOAIR743\.hex/);
  assert.match(publisher, /FC-Firmware-Source-v\$firmwareVersion\.zip/);
  assert.match(publisher, /Publish verified release/);
  assert.doesNotMatch(publisher, /--prerelease/);
});
