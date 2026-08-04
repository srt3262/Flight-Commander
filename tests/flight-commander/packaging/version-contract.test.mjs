import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateFlightCommanderVersions,
} from '../../../scripts/check-flight-commander-version.mjs';

function manifest(overrides = {}) {
  const { flightCommander = {}, ...rootOverrides } = overrides;
  return {
    version: '3.0.3',
    flightCommander: {
      firmwareMajor: 3,
      firmwareReleaseVersion: '3.0.3',
      firmwareReleaseSha256: 'a'.repeat(64),
      firmwareChangedInRelease: true,
      firmwareSourceAvailable: true,
      firmwareSourceVersion: '3.0.3',
      firmwareSourceArchive: 'release/firmware/Flight-Commander-Firmware-Source-v3.0.3.zip',
      firmwareSourceSha256: 'b'.repeat(64),
      firmwareSourceRevision: 'c'.repeat(40),
      firmwareSourceTree: 'd'.repeat(40),
      ...flightCommander,
    },
    ...rootOverrides,
  };
}

test('coordinated releases identify the standalone published firmware asset', () => {
  const result = validateFlightCommanderVersions(manifest());
  assert.equal(result.firmwareReleaseVersion, '3.0.3');
  assert.equal(result.firmwareReleaseSha256, 'a'.repeat(64));
  assert.equal(
    result.firmwareSourceArchive,
    'release/firmware/Flight-Commander-Firmware-Source-v3.0.3.zip',
  );
});

test('firmware-changing releases require the exact Configurator version', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      version: '3.0.4',
    })),
    /same version/,
  );
});

test('software-only releases may reuse a published firmware within the same major', () => {
  const result = validateFlightCommanderVersions(manifest({
    version: '3.0.4',
    flightCommander: { firmwareChangedInRelease: false },
  }));
  assert.equal(result.firmwareReleaseVersion, '3.0.3');
  assert.equal(result.firmwareChangedInRelease, false);
});

test('firmware source is mandatory and must match the published HEX version', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareSourceAvailable: false },
    })),
    /must publish its exact firmware source/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareSourceVersion: '3.0.4' },
    })),
    /source version must exactly match/,
  );
});

test('firmware source must use the release-only path and exact identities', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v3.0.3.zip',
      },
    })),
    /canonical release-only path/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareSourceRevision: 'short' },
    })),
    /40-character source revision/,
  );
});

test('published firmware and source checksums are mandatory', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareReleaseSha256: undefined },
    })),
    /published firmware HEX/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareSourceSha256: undefined },
    })),
    /firmware source ZIP/,
  );
});

test('all release types reject a Configurator/firmware major mismatch', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        firmwareReleaseVersion: '2.9.0',
        firmwareSourceVersion: '2.9.0',
        firmwareSourceArchive: 'release/firmware/Flight-Commander-Firmware-Source-v2.9.0.zip',
      },
    })),
    /major-version mismatch/,
  );
});

test('release declarations are explicit booleans', () => {
  const changed = manifest();
  delete changed.flightCommander.firmwareChangedInRelease;
  assert.throws(
    () => validateFlightCommanderVersions(changed),
    /firmwareChangedInRelease as a boolean/,
  );
  const source = manifest();
  delete source.flightCommander.firmwareSourceAvailable;
  assert.throws(
    () => validateFlightCommanderVersions(source),
    /firmwareSourceAvailable as a boolean/,
  );
});
