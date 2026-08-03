import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateFlightCommanderVersions,
} from '../../../scripts/check-flight-commander-version.mjs';

function manifest(overrides = {}) {
  return {
    version: '2.0.5',
    flightCommander: {
      firmwareMajor: 2,
      bundledFirmwareVersion: '2.0.1',
      firmwareChangedInRelease: false,
      bundledFirmwareSourceAvailable: false,
      bundledFirmwareSourceVersion: null,
      bundledFirmwareSourceDirectory: null,
      ...(overrides.flightCommander ?? {}),
    },
    ...overrides,
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
        bundledFirmwareVersion: '2.0.5',
        firmwareChangedInRelease: true,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.5',
        bundledFirmwareSourceDirectory: 'firmware-src',
      },
    })).bundledFirmwareVersion,
    '2.0.5',
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        firmwareChangedInRelease: true,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.1',
        bundledFirmwareSourceDirectory: 'firmware-src',
      },
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
      bundledFirmwareVersion: '2.0.5',
      firmwareChangedInRelease: false,
      bundledFirmwareSourceAvailable: true,
      bundledFirmwareSourceVersion: '2.0.5',
      bundledFirmwareSourceDirectory: 'firmware-src',
    },
  }));
  assert.equal(result.bundledFirmwareSourceVersion, '2.0.5');
  assert.equal(result.bundledFirmwareSourceDirectory, 'firmware-src');
});

test('firmware source identity must match its HEX and use a safe repository path', () => {
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        firmwareChangedInRelease: false,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.0',
        bundledFirmwareSourceDirectory: 'firmware-src',
      },
    })),
    /source version must exactly match/,
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        firmwareChangedInRelease: false,
        bundledFirmwareSourceAvailable: true,
        bundledFirmwareSourceVersion: '2.0.1',
        bundledFirmwareSourceDirectory: '../lost-source',
      },
    })),
    /safe repository-relative/,
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
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
      },
    })),
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
