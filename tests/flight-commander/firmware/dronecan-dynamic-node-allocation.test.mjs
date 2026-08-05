import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

test('the 4.0.0 firmware source includes a non-redundant DroneCAN allocator', () => {
  const source = read('scripts/flight_commander_dronecan_allocator_4_0_0.py');

  assert.match(source, /UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID/);
  assert.match(source, /DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH 16U/);
  assert.match(source, /transfer->source_node_id != 0/);
  assert.match(source, /CAN_NODE/);
  assert.match(source, /createAllocation\(pendingUniqueID, pendingPreferredNodeID\)/);
  assert.match(source, /USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR/);
});

test('coordinated build applies allocation before source identity and compilation', () => {
  const workflow = read('.github/workflows/build-flight-commander-firmware-4.0.0.yml');
  const allocator = workflow.indexOf('flight_commander_dronecan_allocator_4_0_0.py --root');
  const manifestRefresh = workflow.indexOf('refresh-flight-commander-firmware-manifest-4.0.0.py --root');
  const compiler = workflow.indexOf('build-micoair743.sh');

  assert.ok(allocator >= 0, 'allocator integration step is missing');
  assert.ok(manifestRefresh > allocator, 'source identity must be refreshed after allocator integration');
  assert.ok(compiler > manifestRefresh, 'firmware must compile only after the final source identity is known');
});

test('pull-request validation rebuilds the exact published firmware source archive', () => {
  const workflow = read('.github/workflows/pr-validate-flight-commander-4.0.0.yml');

  assert.match(workflow, /bash scripts\/rebuild-firmware-source-archive\.sh/);
  assert.match(workflow, /yarn test/);
});
