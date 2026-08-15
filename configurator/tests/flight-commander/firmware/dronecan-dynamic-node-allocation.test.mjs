import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryRoot = resolve(configuratorRoot, "..");
const source = (relative) => readFileSync(resolve(repositoryRoot, relative), "utf8");

test("current firmware source includes the non-redundant DroneCAN allocator", () => {
  const allocator = source("src/main/drivers/dronecan/dronecan_allocator.c");
  const transport = source("src/main/drivers/dronecan/dronecan.c");
  assert.match(allocator, /UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID/);
  assert.match(allocator, /DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH 16U/);
  assert.match(allocator, /pendingUniqueID/);
  assert.match(allocator, /pendingPreferredNodeID/);
  assert.match(allocator, /createAllocation\(pendingUniqueID, pendingPreferredNodeID\)/);
  assert.match(transport, /USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR/);
});

test("release packaging validates source identity before compilation", () => {
  const packager = source("flight-commander/package-release.py");
  const validator = packager.indexOf("validate_manifest(manifest, revision, tree)");
  const compiler = packager.indexOf("subprocess.run(", validator);
  assert.ok(validator >= 0, "source and manifest validation is missing");
  assert.ok(compiler > validator, "firmware must validate its source contract before compilation");
});

test("permanent CI builds firmware directly from the repository source tree", () => {
  const workflow = source(".github/workflows/ci.yml");
  const packager = source("flight-commander/package-h7-targets.py");
  assert.match(workflow, /Build and package firmware from the repository source tree/);
  assert.match(workflow, /python3 flight-commander\/package-h7-targets\.py/);
  assert.match(workflow, /legacy-regression-build/);
  assert.match(
    packager,
    /configure_and_build\(\s*build_dir,\s*list\(LEGACY_TARGETS\)/,
  );
  assert.match(packager, /for target in LEGACY_TARGETS/);
  assert.match(workflow, /working-directory: configurator/);
  assert.match(workflow, /run: yarn test/);
  assert.doesNotMatch(workflow, /source ZIP|rebuild-firmware-source-archive/);
});
