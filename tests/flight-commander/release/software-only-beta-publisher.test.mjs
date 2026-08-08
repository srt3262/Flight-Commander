import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(
  resolve(root, ".github/workflows/publish-flight-commander-beta.yml"),
  "utf8",
);

test("4.1.2 is declared as a Configurator-only release reusing verified 4.0.8 firmware", () => {
  assert.equal(packageJson.version, "4.1.2");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, false);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.0.8");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.0.8");
});

test("beta publisher keeps Configurator and firmware versions distinct", () => {
  assert.match(publisher, /firmware_version:\s+\$\{\{ steps\.metadata\.outputs\.firmware_version \}\}/);
  assert.match(publisher, /FIRMWARE_VERSION: \$\{\{ needs\.validate-release\.outputs\.firmware_version \}\}/);
  assert.match(publisher, /FC-Firmware-v\$env:FIRMWARE_VERSION-MICOAIR743\.hex/);
  assert.match(publisher, /FC-Firmware-Source-v\$env:FIRMWARE_VERSION\.zip/);
  assert.doesNotMatch(publisher, /assert fc\['firmwareChangedInRelease'\] is True/);
});

