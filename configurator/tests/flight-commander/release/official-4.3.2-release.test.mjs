import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryRoot = resolve(root, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(
  resolve(repositoryRoot, ".github/workflows/release.yml"),
  "utf8",
);
const ci = readFileSync(
  resolve(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const officialTargets = readFileSync(
  resolve(repositoryRoot, "flight-commander/official-targets.txt"),
  "utf8",
)
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("|", 1)[0]);

test("4.3.2 coordinates the Configurator and all 50 Firmware targets", () => {
  assert.equal(officialTargets.length, 50);
  assert.equal(packageJson.version, "4.3.2");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.3.2");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.3.2");
  assert.deepEqual(
    Object.keys(packageJson.flightCommander.firmwareReleaseArtifacts),
    officialTargets,
  );
});

test("official publisher stages and verifies a non-prerelease 4.3.2 bundle", () => {
  assert.match(publisher, /Publish verified release/);
  assert.match(publisher, /Build verified Firmware 4\.3\.2 for all 50 targets/);
  assert.match(publisher, /flight-commander\/package-release\.py/);
  assert.match(publisher, /gh release create/);
  assert.match(publisher, /--draft/);
  assert.match(publisher, /releases\?per_page=100/);
  assert.match(publisher, /releases\/\$release_id/);
  assert.match(publisher, /--method PATCH/);
  assert.match(publisher, /-F draft=false/);
  assert.doesNotMatch(publisher, /releases\/tags\/\$RELEASE_TAG/);
  assert.doesNotMatch(publisher, /gh release delete/);
  assert.doesNotMatch(publisher, /--clobber/);
  assert.doesNotMatch(publisher, /--prerelease/);
  assert.match(publisher, /len\(expected\) == 53/);
  assert.match(publisher, /len\(expected\) == len\(live\) == 51/);
});

test("CI and publication use one canonical all-target packager", () => {
  assert.match(ci, /Build and verify all 50 H7 firmware targets/);
  assert.match(ci, /flight-commander\/package-release\.py/);
  assert.doesNotMatch(ci, /package-h7-targets\.py/);
  assert.equal(
    existsSync(resolve(repositoryRoot, "flight-commander/package-h7-targets.py")),
    false,
  );
  assert.equal(
    existsSync(resolve(repositoryRoot, ".github/workflows/publish-h7-targets.yml")),
    false,
  );
});
