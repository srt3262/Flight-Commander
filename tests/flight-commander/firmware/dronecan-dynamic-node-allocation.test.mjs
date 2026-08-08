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

test('published firmware source verification precedes compilation', () => {
  const rebuild = read('scripts/rebuild-firmware-source-archive.sh');
  const verifier = rebuild.indexOf('flight-commander/verify-release.py');
  const compiler = rebuild.indexOf('flight-commander/build-micoair743.sh');

  assert.ok(verifier >= 0, 'published source verification step is missing');
  assert.ok(compiler > verifier, 'firmware must compile only after the published source is verified');
});

test('permanent pull-request CI rebuilds the exact published firmware source archive', () => {
  const workflow = read('.github/workflows/ci.yml');

  assert.match(workflow, /name: Rebuild firmware from published source ZIP/);
  assert.match(workflow, /bash scripts\/rebuild-firmware-source-archive\.sh/);
  assert.match(workflow, /run: yarn test/);
});
