import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateFlightCommanderVersions,
} from '../../../scripts/check-flight-commander-version.mjs';

function manifest(overrides = {}) {
  return {
    version: '2.0.3',
    flightCommander: {
      firmwareMajor: 2,
      bundledFirmwareVersion: '2.0.1',
      firmwareChangedInRelease: false,
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
        bundledFirmwareVersion: '2.0.3',
        firmwareChangedInRelease: true,
      },
    })).bundledFirmwareVersion,
    '2.0.3',
  );
  assert.throws(
    () => validateFlightCommanderVersions(manifest({
      flightCommander: {
        firmwareMajor: 2,
        bundledFirmwareVersion: '2.0.1',
        firmwareChangedInRelease: true,
      },
    })),
    /exact same version/,
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
