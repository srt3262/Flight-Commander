import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateFlightCommanderVersions,
} from '../../../scripts/check-flight-commander-version.mjs';
import {
  FLIGHT_COMMANDER_FIRMWARE_TARGETS,
} from '../../../js/flightCommander/firmwareCatalog.js';

const officialTargets = FLIGHT_COMMANDER_FIRMWARE_TARGETS.map(({ id }) => id);

function firmwareArtifacts(version = '3.0.7') {
  return Object.fromEntries(officialTargets.map((target) => [
    target,
    {
      filename: `Flight-Commander-Firmware-${version}-${target}.hex`,
      sha256: target === 'MICOAIR743'
        ? 'a'.repeat(64)
        : target === 'CUBEORANGEPLUS'
          ? 'e'.repeat(64)
          : 'f'.repeat(64),
    },
  ]));
}

function manifest(overrides = {}) {
  const { flightCommander = {}, ...rootOverrides } = overrides;
  return {
    version: '3.0.7',
    flightCommander: {
      firmwareMajor: 3,
      firmwareReleaseVersion: '3.0.7',
      firmwareReleaseSha256: 'a'.repeat(64),
      firmwareReleaseArtifacts: firmwareArtifacts(),
      firmwareChangedInRelease: true,
      firmwareSourceAvailable: true,
      firmwareSourceVersion: '3.0.7',
      firmwareSourceArchive: 'FC-Firmware-Source-v3.0.7.zip',
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
  assert.equal(result.firmwareReleaseVersion, '3.0.7');
  assert.equal(result.firmwareReleaseSha256, 'a'.repeat(64));
  assert.equal(result.firmwareReleaseArtifacts.CUBEORANGEPLUS.sha256, 'e'.repeat(64));
  assert.equal(
    result.firmwareSourceArchive,
    'FC-Firmware-Source-v3.0.7.zip',
  );
});

test('firmware-changing releases require the exact Configurator version', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      version: '3.0.8',
    })),
    /same version/,
  );
});

test('software-only releases may reuse a published firmware within the same major', () => {
  const result = validateFlightCommanderVersions(manifest({
    version: '3.0.8',
    flightCommander: { firmwareChangedInRelease: false },
  }));
  assert.equal(result.firmwareReleaseVersion, '3.0.7');
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
      flightCommander: { firmwareSourceVersion: '3.0.8' },
    })),
    /source version must exactly match/,
  );
});

test('firmware source must use the release-only path and exact identities', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v3.0.7.zip',
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

test('every official target has a canonical independently hashed artifact', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: { firmwareReleaseArtifacts: undefined },
    })),
    /all 50 canonical official targets/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareReleaseArtifacts: {
          ...firmwareArtifacts(),
          MICOAIR743: {
            filename: 'renamed.hex',
            sha256: 'a'.repeat(64),
          },
        },
      },
    })),
    /invalid published firmware artifact for MICOAIR743/,
  );
});

test('all release types reject a Configurator/firmware major mismatch', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        firmwareReleaseVersion: '2.9.0',
        firmwareSourceVersion: '2.9.0',
        firmwareSourceArchive: 'FC-Firmware-Source-v2.9.0.zip',
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
