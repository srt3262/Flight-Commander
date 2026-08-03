import { readFile, readdir, stat } from 'node:fs/promises';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export function validateFlightCommanderVersions(packageJson) {
  const versionMatch = SEMVER_PATTERN.exec(packageJson.version ?? '');
  if (!versionMatch) {
    throw new Error(
      `Flight Commander package version is not semantic: ${packageJson.version}`,
    );
  }

  const configuratorMajor = Number(versionMatch[1]);
  const firmwareMajor = Number(packageJson.flightCommander?.firmwareMajor);
  const bundledFirmwareVersion =
    packageJson.flightCommander?.bundledFirmwareVersion;
  const firmwareChangedInRelease =
    packageJson.flightCommander?.firmwareChangedInRelease;
  const bundledFirmwareSourceAvailable =
    packageJson.flightCommander?.bundledFirmwareSourceAvailable;
  const bundledFirmwareSourceVersion =
    packageJson.flightCommander?.bundledFirmwareSourceVersion;
  const bundledFirmwareSourceDirectory =
    packageJson.flightCommander?.bundledFirmwareSourceDirectory;
  const bundledFirmwareMatch = SEMVER_PATTERN.exec(
    bundledFirmwareVersion ?? '',
  );

  if (!Number.isInteger(firmwareMajor) || firmwareMajor < 1) {
    throw new Error(
      'package.json must declare flightCommander.firmwareMajor.',
    );
  }

  if (configuratorMajor !== firmwareMajor) {
    throw new Error(
      `Flight Commander major-version mismatch: Configurator ${configuratorMajor}, Firmware ${firmwareMajor}. ` +
      'A major transition must release both products together at X.0.0.',
    );
  }

  if (!bundledFirmwareMatch || Number(bundledFirmwareMatch[1]) !== firmwareMajor) {
    throw new Error(
      'package.json must declare a semantic bundledFirmwareVersion in the active firmware major.',
    );
  }

  if (typeof firmwareChangedInRelease !== 'boolean') {
    throw new Error(
      'package.json must declare flightCommander.firmwareChangedInRelease as a boolean.',
    );
  }

  if (firmwareChangedInRelease && bundledFirmwareVersion !== packageJson.version) {
    throw new Error(
      `Firmware-changing release ${packageJson.version} must bundle a newly built ` +
      `firmware image with the exact same version; received ${bundledFirmwareVersion}.`,
    );
  }

  if (typeof bundledFirmwareSourceAvailable !== 'boolean') {
    throw new Error(
      'package.json must declare flightCommander.bundledFirmwareSourceAvailable as a boolean.',
    );
  }

  const legacyMissingSourceException =
    packageJson.version === '2.0.5'
    && bundledFirmwareVersion === '2.0.1'
    && firmwareChangedInRelease === false
    && bundledFirmwareSourceAvailable === false;
  if (!bundledFirmwareSourceAvailable && !legacyMissingSourceException) {
    throw new Error(
      'Every release after the one-time Configurator 2.0.5 legacy exception must publish the exact source for its bundled firmware.',
    );
  }

  if (bundledFirmwareSourceAvailable) {
    if (bundledFirmwareSourceVersion !== bundledFirmwareVersion) {
      throw new Error(
        'The bundled firmware source version must exactly match the bundled firmware HEX version.',
      );
    }
    if (
      typeof bundledFirmwareSourceDirectory !== 'string'
      || !/^[A-Za-z0-9._/-]+$/.test(bundledFirmwareSourceDirectory)
      || bundledFirmwareSourceDirectory.startsWith('/')
      || bundledFirmwareSourceDirectory.split('/').includes('..')
    ) {
      throw new Error(
        'A source-backed firmware release must declare a safe repository-relative bundledFirmwareSourceDirectory.',
      );
    }
  } else if (
    bundledFirmwareSourceVersion !== null
    || bundledFirmwareSourceDirectory !== null
  ) {
    throw new Error(
      'Unavailable firmware source must use null source version and directory declarations.',
    );
  }

  return {
    configuratorMajor,
    firmwareMajor,
    bundledFirmwareVersion,
    firmwareChangedInRelease,
    bundledFirmwareSourceAvailable,
    bundledFirmwareSourceVersion,
    bundledFirmwareSourceDirectory,
    legacyMissingSourceException,
  };
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const {
  firmwareMajor,
  bundledFirmwareVersion,
  firmwareChangedInRelease,
  bundledFirmwareSourceAvailable,
  bundledFirmwareSourceVersion,
  bundledFirmwareSourceDirectory,
  legacyMissingSourceException,
} = validateFlightCommanderVersions(packageJson);

if (bundledFirmwareSourceAvailable) {
  const sourceDirectory = new URL(
    `../${bundledFirmwareSourceDirectory.replace(/\/?$/, '/')}`,
    import.meta.url,
  );
  const sourceStat = await stat(sourceDirectory);
  if (!sourceStat.isDirectory() || (await readdir(sourceDirectory)).length === 0) {
    throw new Error(
      `Bundled firmware source directory is missing or empty: ${bundledFirmwareSourceDirectory}`,
    );
  }
}

const expectedFirmwareFilename =
  `Flight-Commander-Firmware-${bundledFirmwareVersion}-MICOAIR743-BENCH-ONLY.hex`;
const bundledFirmwareFiles = (await readdir(
  new URL('../resources/firmware/', import.meta.url),
)).filter((name) => name.toLowerCase().endsWith('.hex'));
if (
  bundledFirmwareFiles.length !== 1 ||
  bundledFirmwareFiles[0] !== expectedFirmwareFilename
) {
  throw new Error(
    `Expected exactly the declared bundled firmware image ${expectedFirmwareFilename}.`,
  );
}

if (packageJson.name !== 'flight-commander' || packageJson.productName !== 'Flight Commander') {
  throw new Error('Release packages must use the Flight Commander product identity.');
}

console.log(
  `Flight Commander version contract OK: Configurator ${packageJson.version}, ` +
  `bundled firmware ${bundledFirmwareVersion}, firmware major ${firmwareMajor}, ` +
  `${firmwareChangedInRelease ? 'coordinated firmware rebuild' : 'software-only release'}, ` +
  `${bundledFirmwareSourceAvailable
    ? `firmware source ${bundledFirmwareSourceVersion} retained`
    : legacyMissingSourceException
      ? 'one-time legacy firmware-source exception'
      : 'firmware source unavailable'}.`,
);
