import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(resolve(root, "../.github/workflows/release.yml"), "utf8");
const h7Publisher = readFileSync(
  resolve(root, "../.github/workflows/publish-h7-targets.yml"),
  "utf8",
);

test("4.3.1 coordinates the Configurator and both Firmware targets", () => {
  assert.equal(packageJson.version, "4.3.1");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.3.1");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.3.1");
});

test("official publisher creates a verified non-prerelease 4.3.1 bundle", () => {
  assert.match(publisher, /Publish verified release/);
  assert.match(publisher, /Build verified Firmware 4\.3\.1/);
  assert.match(publisher, /flight-commander\/package-release\.py/);
  assert.match(publisher, /gh release create/);
  assert.doesNotMatch(publisher, /gh release delete/);
  assert.match(publisher, /exactly the five canonical files/);
  assert.match(publisher, /exactly the three public assets/);
  assert.doesNotMatch(publisher, /--prerelease/);
});

test("H7 expansion publisher is additive and protects existing 4.3.1 assets", () => {
  assert.match(h7Publisher, /package-h7-targets\.py/);
  assert.match(h7Publisher, /Build 48 additive target assets/);
  assert.match(h7Publisher, /MICOAIR743\.hex" not in actual_files/);
  assert.match(h7Publisher, /CUBEORANGEPLUS\.hex" not in actual_files/);
  assert.match(
    h7Publisher,
    /1fcb891cd7bcee51e86c6dcf0afcc58bc9228584cc3105406e33d00d9ebb7921/,
  );
  assert.match(
    h7Publisher,
    /8370b421637226e61d5f50345a21c6e0888943903962377b4a629c5c51ef029f/,
  );
  assert.match(h7Publisher, /protected_existing_artifacts/);
  assert.match(h7Publisher, /assert len\(live\) == 51/);
  assert.doesNotMatch(h7Publisher, /--clobber/);
});
