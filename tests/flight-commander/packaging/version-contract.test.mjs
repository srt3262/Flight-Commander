import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateFlightCommanderVersions,
} from '../../../scripts/check-flight-commander-version.mjs';

function manifest(overrides = {}) {
  const { flightCommander = {}, ...rootOverrides } = overrides;
  return {
    version: '2.0.5',
    flightCommander: {
      firmwareMajor: 2,
      bundledFirmwareVersion: '2.0.1',
      bundledFirmwareSha256: 'd49316e3d7d2a0a8cda70e02e916cab63458a5cd1013a91e20545c5dbbc21aab',
      firmwareChangedInRelease: false,
      bundledFirmwareSourceAvailable: false,
      bundledFirmwareSourceVersion: null,
      bundledFirmwareSourceArchive: null,
      bundledFirmwareSourceSha256: null,
      bundledFirmwareSourceRevision: null,
      bundledFirmwareSourceTree: null,
      ...flightCommander,
    },
    ...rootOverrides,
  };
}

test('software-only releases may reuse truthful firmware within the same major', () => {
  const result = validateFlightCommanderVersions(manifest());
  assert.equal(result.bundledFirmwareVersion, '2.0.1');
  assert.equal(result.firmwareChangedInRelease, false);
});

test('firmware-changing releases require an exact rebuilt firmware version', () => {
  assert.equal(
    validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.6',
        bundledFirmwareSha256: 'a'.repeat(64),
        firmwareChangedInRelease: true,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.6',
        bundledFirmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.6.zip',
        bundledFirmwareSourceSha256: 'b'.repeat(64),
        bundledFirmwareSourceRevision: 'c'.repeat(40),
        bundledFirmwareSourceTree: 'd'.repeat(40),
      },
      version: '2.0.6',
    })).bundledFirmwareVersion,
    '2.0.6',
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        bundledFirmwareSha256: 'a'.repeat(64),
        firmwareChangedInRelease: true,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.1',
        bundledFirmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.1.zip',
        bundledFirmwareSourceSha256: 'b'.repeat(64),
        bundledFirmwareSourceRevision: 'c'.repeat(40),
        bundledFirmwareSourceTree: 'd'.repeat(40),
      },
      version: '2.0.6',
    })),
    /exact same version/,
  );
});

test('2.0.5 is the only release permitted without retained firmware source', () => {
  assert.equal(validateFlightCommanderVersions(manifest()).legacyMissingSourceException, true);
  assert.throws(
    () => validateFlightCommanderVersions(manifest({ version: '2.0.6' })),
    /Every release after the one-time Configurator 2\.0\.5 legacy exception/,
  );
});

test('source-backed software-only releases retain source matching the reused HEX', () => {
  const result = validateFlightCommanderVersions(manifest({
    version: '2.0.6',
    flightCommander: {
      firmwareMajor: 2,
      bundledFirmwareVersion: '2.0.6',
      bundledFirmwareSha256: 'a'.repeat(64),
      firmwareChangedInRelease: false,
      bundledFirmwareSourceAvailable: true,
      bundledFirmwareSourceVersion: '2.0.6',
      bundledFirmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.6.zip',
      bundledFirmwareSourceSha256: 'b'.repeat(64),
      bundledFirmwareSourceRevision: 'c'.repeat(40),
      bundledFirmwareSourceTree: 'd'.repeat(40),
    },
  }));
  assert.equal(result.bundledFirmwareSourceVersion, '2.0.6');
  assert.equal(
    result.bundledFirmwareSourceArchive,
    'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.6.zip',
  );
});

test('firmware source identity must match its HEX and use a safe repository path', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        bundledFirmwareSha256: 'a'.repeat(64),
        firmwareChangedInRelease: false,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.0',
        bundledFirmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.1.zip',
        bundledFirmwareSourceSha256: 'b'.repeat(64),
        bundledFirmwareSourceRevision: 'c'.repeat(40),
        bundledFirmwareSourceTree: 'd'.repeat(40),
      },
    })),
    /source version must exactly match/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        bundledFirmwareSha256: 'a'.repeat(64),
        firmwareChangedInRelease: false,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.1',
        bundledFirmwareSourceArchive: '../lost-source.zip',
        bundledFirmwareSourceSha256: 'b'.repeat(64),
        bundledFirmwareSourceRevision: 'c'.repeat(40),
        bundledFirmwareSourceTree: 'd'.repeat(40),
      },
    })),
    /canonical safe repository-relative/,
  );
});

test('firmware and source checksum declarations are mandatory', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        bundledFirmwareSha256: undefined,
        firmwareChangedInRelease: false,
        bundledFirmwareSourceAvailable: false,
        bundledFirmwareSourceVersion: null,
        bundledFirmwareSourceArchive: null,
        bundledFirmwareSourceSha256: null,
        bundledFirmwareSourceRevision: null,
        bundledFirmwareSourceTree: null,
      },
    })),
    /SHA-256 of the bundled firmware HEX/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      version: '2.0.6',
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.6',
        bundledFirmwareSha256: 'a'.repeat(64),
        firmwareChangedInRelease: true,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.6',
        bundledFirmwareSourceArchive: 'resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.6.zip',
        bundledFirmwareSourceRevision: 'c'.repeat(40),
        bundledFirmwareSourceTree: 'd'.repeat(40),
      },
    })),
    /SHA-256 of its source ZIP/,
  );
});

test('all release types reject a Configurator/firmware major mismatch', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '1.9.9',
        firmwareChangedInRelease: false,
      },
    })),
    /active firmware major/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      version: '3.0.0',
    })),
    /major-version mismatch/,
  );
});

test('every release must explicitly declare whether firmware changed', () => {
  const candidate = manifest();
  delete candidate.flightCommander.firmwareChangedInRelease;
  assert.throws(
    () => validateFlightCommanderVersions(candidate),
    /firmwareChangedInRelease as a boolean/,
  );
});

test('every release must explicitly declare whether firmware source is retained', () => {
  const candidate = manifest();
  delete candidate.flightCommander.bundledFirmwareSourceAvailable;
  assert.throws(
    () => validateFlightCommanderVersions(candidate),
    /bundledFirmwareSourceAvailable as a boolean/,
  );
});
