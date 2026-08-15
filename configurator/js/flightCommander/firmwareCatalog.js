"use strict";

export const FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL =
  "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20";

export const FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION = "4.0.7";
export const FLIGHT_COMMANDER_KNOWN_GOOD_FIRMWARE_VERSIONS = Object.freeze([
  "3.0.7",
]);

function semverCore(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(String(version ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

export function isSupportedFlightCommanderFirmwareVersion(version) {
  const candidate = semverCore(version);
  const minimum = semverCore(FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION);
  if (!candidate || !minimum) return false;

  const candidateCore = candidate.join(".");
  if (FLIGHT_COMMANDER_KNOWN_GOOD_FIRMWARE_VERSIONS.includes(candidateCore)) {
    return true;
  }

  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] > minimum[index]) return true;
    if (candidate[index] < minimum[index]) return false;
  }
  return true;
}

function firmwareTarget(id, name = id, aliases = []) {
  return Object.freeze({ id, name, aliases: Object.freeze(aliases) });
}

export const FLIGHT_COMMANDER_FIRMWARE_TARGETS = Object.freeze([
  firmwareTarget("AEDROXH7"),
  firmwareTarget("AETH743Basic"),
  firmwareTarget("AOCODARCH7DUAL"),
  firmwareTarget("AXISFLYINGH743PRO"),
  firmwareTarget("BLADE_PRO_H7"),
  firmwareTarget("BLUEBERRYH743"),
  firmwareTarget("BLUEBERRYH743HD"),
  firmwareTarget("BRAHMA_H7"),
  firmwareTarget("BROTHERHOBBYH743"),
  firmwareTarget("CORVON743V1"),
  firmwareTarget("DAKEFPVH743"),
  firmwareTarget("DAKEFPVH743PRO"),
  firmwareTarget("DAKEFPVH743_SLIM"),
  firmwareTarget("FLYWOOH743PRO"),
  firmwareTarget("FOXEERH743"),
  firmwareTarget("GEPRC_TAKER_H743"),
  firmwareTarget("HAKRCH743"),
  firmwareTarget("IFLIGHT_2RAW_H743"),
  firmwareTarget("IFLIGHT_BLITZ_H7_PRO"),
  firmwareTarget("IFLIGHT_BLITZ_H7_WING"),
  firmwareTarget("JHEMCUH743HD"),
  firmwareTarget("KAKUTEH7"),
  firmwareTarget("KAKUTEH7MINI"),
  firmwareTarget("KAKUTEH7V2"),
  firmwareTarget("KAKUTEH7WING"),
  firmwareTarget("MAMBAH743"),
  firmwareTarget("MAMBAH743_2022B"),
  firmwareTarget("MAMBAH743_2022B_GYRO2"),
  firmwareTarget("MATEKH743"),
  firmwareTarget("MATEKH743HD"),
  firmwareTarget("MICOAIR743", "MICOAIR743 (Aero Selfie H743)", ["MICROAIR743"]),
  firmwareTarget("MICOAIR743AIO"),
  firmwareTarget("MICOAIR743V2"),
  firmwareTarget("MICOAIR743V2_EXTMAG"),
  firmwareTarget("MICOAIR743_EXTMAG"),
  firmwareTarget("NEUTRONRCH7BT"),
  firmwareTarget("ORBITH743"),
  firmwareTarget("SDMODELH7V1"),
  firmwareTarget("SDMODELH7V2"),
  firmwareTarget("SEQUREH7"),
  firmwareTarget("SEQUREH7V2"),
  firmwareTarget("SIMPLIFLYH7"),
  firmwareTarget("SKYSTARSH743HD"),
  firmwareTarget("SPEDIXH743"),
  firmwareTarget("TBS_LUCID_H7"),
  firmwareTarget("TBS_LUCID_H7_OEM"),
  firmwareTarget("TBS_LUCID_H7_V3"),
  firmwareTarget("TBS_LUCID_H7_WING"),
  firmwareTarget("TBS_LUCID_H7_WING_MINI"),
  firmwareTarget("CUBEORANGEPLUS", "CubePilot Cube Orange+", ["CUBEORANGE+"]),
]);

const FLIGHT_COMMANDER_MARKER = Object.freeze([0x46, 0x43, 0x46, 0x57]);

export function normalizeFirmwareTarget(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/-/g, "_")
    .toUpperCase();
  const target = FLIGHT_COMMANDER_FIRMWARE_TARGETS.find(
    ({ id, aliases }) =>
      id.toUpperCase() === normalized ||
      aliases.some((alias) => alias.toUpperCase() === normalized),
  );
  return target?.id ?? normalized;
}

function knownFirmwareTarget(value) {
  const normalized = normalizeFirmwareTarget(value);
  return FLIGHT_COMMANDER_FIRMWARE_TARGETS.find(({ id }) => id === normalized) ?? null;
}

export function parseFlightCommanderFirmwareFilename(filename) {
  const match = /^Flight-Commander-Firmware-(.+)\.hex$/i.exec(
    String(filename ?? "").trim(),
  );
  if (!match) return null;
  let stem = match[1];
  const benchOnly = /-BENCH-ONLY$/i.test(stem);
  if (benchOnly) stem = stem.slice(0, -"-BENCH-ONLY".length);

  const candidates = FLIGHT_COMMANDER_FIRMWARE_TARGETS.flatMap((target) =>
    [target.id, ...target.aliases].map((token) => ({ target, token })),
  ).sort((left, right) => right.token.length - left.token.length);
  for (const { target, token } of candidates) {
    const suffix = `-${token}`;
    if (!stem.toUpperCase().endsWith(suffix.toUpperCase())) continue;
    const version = stem.slice(0, -suffix.length);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) continue;
    return Object.freeze({
      family: "flight-commander",
      version,
      target_id: target.id,
      target: target.name,
      format: "hex",
      benchOnly,
    });
  }
  return null;
}

function publishedReleaseChannel(release) {
  if (!release || release.draft) return null;
  if (release.prerelease !== true) return "official";
  const label = `${release.tag_name ?? ""} ${release.name ?? ""}`.toLowerCase();
  return /(^|[._\-\s])beta(?:[._\-\s]|\d|$)/.test(label)
    ? "beta"
    : null;
}

function releaseCoreVersion(release) {
  const value = `${release?.tag_name ?? ""} ${release?.name ?? ""}`;
  const match = /(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[-+\s]|$)/i.exec(value);
  return match?.[1] ?? null;
}

function releasePreference(record) {
  const channel = record.descriptor.status === "official" ? 2 : 1;
  const canonical = record.canonicalRelease ? 1 : 0;
  const published = Number.isFinite(record.publishedMs) ? record.publishedMs : 0;
  return [channel, canonical, published];
}

function isPreferredRelease(candidate, current) {
  const candidatePreference = releasePreference(candidate);
  const currentPreference = releasePreference(current);
  for (let index = 0; index < candidatePreference.length; index += 1) {
    if (candidatePreference[index] > currentPreference[index]) return true;
    if (candidatePreference[index] < currentPreference[index]) return false;
  }
  return false;
}

export function flightCommanderReleaseDescriptors(releases = []) {
  const selected = new Map();
  for (const release of Array.isArray(releases) ? releases : []) {
    const channel = publishedReleaseChannel(release);
    if (!channel) continue;
    const releaseVersion = releaseCoreVersion(release);
    for (const asset of Array.isArray(release?.assets) ? release.assets : []) {
      const parsed = parseFlightCommanderFirmwareFilename(asset?.name);
      if (
        !parsed ||
        parsed.benchOnly ||
        !isSupportedFlightCommanderFirmwareVersion(parsed.version)
      ) continue;
      const digest = String(asset?.digest ?? "");
      const bytes = asset?.size;
      if (
        !asset?.browser_download_url ||
        !/^sha256:[0-9a-f]{64}$/i.test(digest) ||
        !Number.isSafeInteger(bytes) ||
        bytes <= 0
      ) continue;
      const publishedAt = release.published_at ?? release.created_at ?? null;
      const descriptor = Object.freeze({
        releaseUrl: release.html_url ?? "",
        name: release.name || release.tag_name || `Flight Commander Firmware ${parsed.version}`,
        version: parsed.version,
        tag: release.tag_name ?? parsed.version,
        url: asset.browser_download_url,
        file: asset.name,
        target_id: parsed.target_id,
        target: parsed.target,
        date: publishedAt ? new Date(publishedAt).toISOString() : "",
        notes: release.body ?? "",
        status: channel,
        benchOnly: false,
        digest,
        bytes,
      });
      const record = {
        descriptor,
        canonicalRelease: releaseVersion === parsed.version,
        publishedMs: publishedAt ? Date.parse(publishedAt) : 0,
      };
      const key = `${parsed.target_id}:${parsed.version}`;
      const current = selected.get(key);
      if (!current || isPreferredRelease(record, current)) {
        selected.set(key, record);
      }
    }
  }
  return [...selected.values()]
    .map(({ descriptor }) => descriptor)
    .sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    );
}

function firmwareBytes(payload) {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new TypeError("Online firmware payload is not binary or text data.");
}

export async function verifyFlightCommanderOnlinePayload(
  payload,
  descriptor,
  cryptoImplementation = globalThis.crypto,
) {
  const bytes = firmwareBytes(payload);
  if (!Number.isSafeInteger(descriptor?.bytes) || descriptor.bytes <= 0) {
    throw new Error("Online firmware has no verified release byte count.");
  }
  if (bytes.byteLength !== descriptor.bytes) {
    throw new Error(
      `Online firmware size mismatch: expected ${descriptor.bytes} bytes, received ${bytes.byteLength}.`,
    );
  }

  const digestMatch = /^sha256:([0-9a-f]{64})$/i.exec(
    String(descriptor?.digest ?? ""),
  );
  if (!digestMatch) {
    throw new Error("Online firmware has no valid GitHub SHA-256 digest.");
  }
  if (!cryptoImplementation?.subtle?.digest) {
    throw new Error("SHA-256 verification is unavailable in this Configurator session.");
  }
  const digestBytes = new Uint8Array(
    await cryptoImplementation.subtle.digest("SHA-256", bytes),
  );
  const actualDigest = [...digestBytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actualDigest !== digestMatch[1].toLowerCase()) {
    throw new Error("Online firmware SHA-256 verification failed.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function catalogByTarget(descriptors = []) {
  const catalog = Object.fromEntries(
    FLIGHT_COMMANDER_FIRMWARE_TARGETS.map(({ id }) => [id, []]),
  );
  for (const descriptor of descriptors) {
    const target = normalizeFirmwareTarget(descriptor?.target_id);
    if (catalog[target]) catalog[target].push(descriptor);
  }
  return catalog;
}

function parsedHexContainsBytes(parsedHex, expectedBytes) {
  if (!expectedBytes?.length) return false;
  for (const block of parsedHex?.data ?? []) {
    const bytes = block?.data ?? [];
    for (
      let index = 0;
      index <= bytes.length - expectedBytes.length;
      index += 1
    ) {
      if (
        expectedBytes.every(
          (expected, offset) => bytes[index + offset] === expected,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function asciiBytes(value) {
  return Array.from(String(value), (character) => character.charCodeAt(0));
}

export function parsedHexContainsFlightCommanderIdentity(parsedHex) {
  return parsedHexContainsBytes(parsedHex, FLIGHT_COMMANDER_MARKER);
}

export function inferFlightCommanderFirmwareTarget(parsedHex) {
  const targets = [...FLIGHT_COMMANDER_FIRMWARE_TARGETS]
    .sort((left, right) => right.id.length - left.id.length);
  for (const target of targets) {
    for (const token of [target.id, ...target.aliases]) {
      if (parsedHexContainsBytes(parsedHex, asciiBytes(`${token}\0`))) {
        return target.id;
      }
    }
  }
  return null;
}

export function localFlightCommanderFirmwareDescriptor(
  parsedHex,
  { filename = "", selectedTarget = "" } = {},
) {
  const parsedFilename = parseFlightCommanderFirmwareFilename(filename);
  const embeddedTarget = knownFirmwareTarget(
    inferFlightCommanderFirmwareTarget(parsedHex),
  );
  const selected = knownFirmwareTarget(selectedTarget);
  const filenameTarget = knownFirmwareTarget(parsedFilename?.target_id);
  const target = embeddedTarget || selected || filenameTarget;
  if (!target) return null;

  return Object.freeze({
    family: "flight-commander",
    version: parsedFilename?.version ?? null,
    target_id: target.id,
    target: target.name,
    format: "hex",
    benchOnly: parsedFilename?.benchOnly ?? false,
    local: true,
    file: String(filename ?? ""),
    targetEvidence: embeddedTarget
      ? "firmware-content"
      : selected
        ? "selected-target"
        : "filename-hint",
  });
}
