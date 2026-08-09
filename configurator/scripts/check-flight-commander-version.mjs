import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const OFFICIAL_FIRMWARE_TARGETS = Object.freeze(['MICOAIR743', 'CUBEORANGEPLUS']);

export function validateFlightCommanderVersions(packageJson) {
  const versionMatch = SEMVER_PATTERN.exec(packageJson.version ?? '');
  if (!versionMatch) {
    throw new Error(`Flight Commander package version is not semantic: ${packageJson.version}`);
  }

  const configuratorMajor = Number(versionMatch[1]);
  const firmwareMajor = Number(packageJson.flightCommander?.firmwareMajor);
  const firmwareReleaseVersion = packageJson.flightCommander?.firmwareReleaseVersion;
  const firmwareReleaseSha256 = packageJson.flightCommander?.firmwareReleaseSha256;
  const firmwareReleaseArtifacts = packageJson.flightCommander?.firmwareReleaseArtifacts;
  const firmwareChangedInRelease = packageJson.flightCommander?.firmwareChangedInRelease;
  const firmwareSourceAvailable = packageJson.flightCommander?.firmwareSourceAvailable;
  const firmwareSourceVersion = packageJson.flightCommander?.firmwareSourceVersion;
  const firmwareSourceArchive = packageJson.flightCommander?.firmwareSourceArchive;
  const firmwareSourceSha256 = packageJson.flightCommander?.firmwareSourceSha256;
  const firmwareSourceRevision = packageJson.flightCommander?.firmwareSourceRevision;
  const firmwareSourceTree = packageJson.flightCommander?.firmwareSourceTree;
  const firmwareVersionMatch = SEMVER_PATTERN.exec(firmwareReleaseVersion ?? '');

  if (!Number.isInteger(firmwareMajor) || firmwareMajor < 1) {
    throw new Error('package.json must declare flightCommander.firmwareMajor.');
  }
  if (configuratorMajor !== firmwareMajor) {
    throw new Error(
      `Flight Commander major-version mismatch: Configurator ${configuratorMajor}, Firmware ${firmwareMajor}.`,
    );
  }
  if (!firmwareVersionMatch || Number(firmwareVersionMatch[1]) !== firmwareMajor) {
    throw new Error(
      'package.json must declare a semantic firmwareReleaseVersion in the active firmware major.',
    );
  }
  if (!/^[0-9a-f]{64}$/.test(firmwareReleaseSha256 ?? '')) {
    throw new Error(
      'package.json must declare the exact lowercase SHA-256 of the published firmware HEX.',
    );
  }
  if (
    !firmwareReleaseArtifacts ||
    typeof firmwareReleaseArtifacts !== 'object' ||
    JSON.stringify(Object.keys(firmwareReleaseArtifacts)) !== JSON.stringify(OFFICIAL_FIRMWARE_TARGETS)
  ) {
    throw new Error(
      `package.json must declare firmwareReleaseArtifacts for exactly ${OFFICIAL_FIRMWARE_TARGETS.join(' and ')}.`,
    );
  }
  for (const target of OFFICIAL_FIRMWARE_TARGETS) {
    const artifact = firmwareReleaseArtifacts[target];
    const expectedFilename =
      `Flight-Commander-Firmware-${firmwareReleaseVersion}-${target}.hex`;
    if (artifact?.filename !== expectedFilename || !/^[0-9a-f]{64}$/.test(artifact?.sha256 ?? '')) {
      throw new Error(`package.json has an invalid published firmware artifact for ${target}.`);
    }
  }
  if (firmwareReleaseSha256 !== firmwareReleaseArtifacts.MICOAIR743.sha256) {
    throw new Error('The legacy firmwareReleaseSha256 must identify the MICOAIR743 artifact.');
  }
  if (typeof firmwareChangedInRelease !== 'boolean') {
    throw new Error(
      'package.json must declare flightCommander.firmwareChangedInRelease as a boolean.',
    );
  }
  if (firmwareChangedInRelease && firmwareReleaseVersion !== packageJson.version) {
    throw new Error(
      `Firmware-changing release ${packageJson.version} must publish a newly built firmware image with the same version; received ${firmwareReleaseVersion}.`,
    );
  }
  if (typeof firmwareSourceAvailable !== 'boolean') {
    throw new Error(
      'package.json must declare flightCommander.firmwareSourceAvailable as a boolean.',
    );
  }
  if (!firmwareSourceAvailable) {
    throw new Error('Every Flight Commander release must publish its exact firmware source.');
  }
  if (firmwareSourceVersion !== firmwareReleaseVersion) {
    throw new Error(
      'The published firmware source version must exactly match the published firmware HEX version.',
    );
  }
  const canonicalSourceArchive =
    `FC-Firmware-Source-v${firmwareReleaseVersion}.zip`;
  if (firmwareSourceArchive !== canonicalSourceArchive) {
    throw new Error(
      `Firmware source must use the canonical release-only path ${canonicalSourceArchive}.`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(firmwareSourceSha256 ?? '')) {
    throw new Error(
      'package.json must declare the exact lowercase SHA-256 of the firmware source ZIP.',
    );
  }
  if (!/^[0-9a-f]{40}$/.test(firmwareSourceRevision ?? '')) {
    throw new Error('Firmware source must declare its exact 40-character source revision.');
  }
  if (!/^[0-9a-f]{40}$/.test(firmwareSourceTree ?? '')) {
    throw new Error('Firmware source must declare its exact 40-character source tree.');
  }

  return {
    configuratorMajor,
    firmwareMajor,
    firmwareReleaseVersion,
    firmwareReleaseSha256,
    firmwareReleaseArtifacts,
    firmwareChangedInRelease,
    firmwareSourceAvailable,
    firmwareSourceVersion,
    firmwareSourceArchive,
    firmwareSourceSha256,
    firmwareSourceRevision,
    firmwareSourceTree,
  };
}

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const release = validateFlightCommanderVersions(packageJson);

for (const forbiddenDirectory of ['../resources/firmware/', '../resources/firmware-source/']) {
  if (await exists(new URL(forbiddenDirectory, import.meta.url))) {
    throw new Error(
      `${forbiddenDirectory} is forbidden: firmware must never be bundled with the Configurator.`,
    );
  }
}

const releaseDirectory = new URL('../release/firmware/', import.meta.url);
if (await exists(releaseDirectory)) {
  const expectedFirmwareFilenames = OFFICIAL_FIRMWARE_TARGETS.map(
    (target) => `Flight-Commander-Firmware-${release.firmwareReleaseVersion}-${target}.hex`,
  );
  const releaseFiles = (await readdir(releaseDirectory)).sort();
  const expectedFiles = [...expectedFirmwareFilenames].sort();
  if (JSON.stringify(releaseFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `release/firmware must contain exactly ${expectedFiles.join(' and ')}.`,
    );
  }

  const sourceUrl = new URL(`../${release.firmwareSourceArchive}`, import.meta.url);
  const firmwareUrls = expectedFirmwareFilenames.map(
    (filename) => new URL(`../release/firmware/${filename}`, import.meta.url),
  );
  for (const url of [...firmwareUrls, sourceUrl]) {
    const fileStat = await stat(url);
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new Error(`Release-only firmware artifact is missing or empty: ${url.pathname}`);
    }
  }
  const actualSourceSha256 = createHash('sha256')
    .update(await readFile(sourceUrl))
    .digest('hex');
  for (const [index, target] of OFFICIAL_FIRMWARE_TARGETS.entries()) {
    const actualFirmwareSha256 = createHash('sha256')
      .update(await readFile(firmwareUrls[index]))
      .digest('hex');
    if (actualFirmwareSha256 !== release.firmwareReleaseArtifacts[target].sha256) {
      throw new Error(`Published ${target} firmware HEX SHA-256 does not match package.json.`);
    }
  }
  if (actualSourceSha256 !== release.firmwareSourceSha256) {
    throw new Error('Published firmware source ZIP SHA-256 does not match package.json.');
  }
}

if (packageJson.name !== 'flight-commander' || packageJson.productName !== 'Flight Commander') {
  throw new Error('Release packages must use the Flight Commander product identity.');
}

console.log(
  `Flight Commander version contract OK: Configurator ${packageJson.version}, ` +
  `published firmware ${release.firmwareReleaseVersion}, firmware major ${release.firmwareMajor}, ` +
  'firmware excluded from the Configurator and retained only as GitHub release assets.',
);
