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

export const FLIGHT_COMMANDER_FIRMWARE_TARGETS = Object.freeze([
  Object.freeze({
    id: "MICOAIR743",
    name: "MICOAIR743 (Aero Selfie H743)",
    aliases: Object.freeze(["MICROAIR743"]),
  }),
  Object.freeze({
    id: "CUBEORANGEPLUS",
    name: "CubePilot Cube Orange+",
    aliases: Object.freeze(["CUBEORANGE+"]),
  }),
]);

const FLIGHT_COMMANDER_MARKER = Object.freeze([0x46, 0x43, 0x46, 0x57]);

export function normalizeFirmwareTarget(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/-/g, "_")
    .toUpperCase();
  const target = FLIGHT_COMMANDER_FIRMWARE_TARGETS.find(
    ({ id, aliases }) =>
      id === normalized || aliases.includes(normalized),
  );
  return target?.id ?? normalized;
}

function knownFirmwareTarget(value) {
  const normalized = normalizeFirmwareTarget(value);
  return FLIGHT_COMMANDER_FIRMWARE_TARGETS.find(({ id }) => id === normalized) ?? null;
}

export function parseFlightCommanderFirmwareFilename(filename) {
  const match = /^Flight-Commander-Firmware-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(MICOAIR743|MICROAIR743|CUBEORANGEPLUS|CUBEORANGE\+)(-BENCH-ONLY)?\.hex$/i.exec(
    String(filename ?? "").trim(),
  );
  if (!match) return null;
  const targetId = normalizeFirmwareTarget(match[2]);
  const knownTarget = knownFirmwareTarget(targetId);
  if (!knownTarget) return null;
  return Object.freeze({
    family: "flight-commander",
    version: match[1],
    target_id: targetId,
    target: knownTarget.name,
    format: "hex",
    benchOnly: Boolean(match[3]),
  });
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
  for (const target of FLIGHT_COMMANDER_FIRMWARE_TARGETS) {
    for (const token of [target.id, ...target.aliases]) {
      if (parsedHexContainsBytes(parsedHex, asciiBytes(token))) {
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
