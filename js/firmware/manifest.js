import { parseApjPackage } from "./apj.js";
import { FirmwareManifestError, FirmwarePackageError } from "./errors.js";

const VEHICLE_CLASS_ALIASES = new Map([
  ["copter", "copter"],
  ["arducopter", "copter"],
  ["multirotor", "copter"],
  ["helicopter", "copter"],
  ["plane", "plane"],
  ["arduplane", "plane"],
  ["fixedwing", "plane"],
  ["fixed-wing", "plane"],
  ["rover", "rover"],
  ["ardurover", "rover"],
  ["sub", "sub"],
  ["ardusub", "sub"],
  ["tracker", "tracker"],
  ["antennatracker", "tracker"],
  ["antenna-tracker", "tracker"],
  ["blimp", "blimp"],
]);

export const ARDUPILOT_VEHICLE_CLASSES = Object.freeze({
  copter: Object.freeze({
    key: "copter",
    manifestName: "Copter",
    directory: "Copter",
  }),
  plane: Object.freeze({
    key: "plane",
    manifestName: "Plane",
    directory: "Plane",
  }),
  rover: Object.freeze({
    key: "rover",
    manifestName: "Rover",
    directory: "Rover",
  }),
  sub: Object.freeze({ key: "sub", manifestName: "Sub", directory: "Sub" }),
  tracker: Object.freeze({
    key: "tracker",
    manifestName: "AntennaTracker",
    directory: "AntennaTracker",
  }),
  blimp: Object.freeze({
    key: "blimp",
    manifestName: "Blimp",
    directory: "Blimp",
  }),
});

export const ARDUPILOT_RELEASE_CHANNELS = Object.freeze([
  "stable",
  "beta",
  "latest",
]);
export const DEFAULT_ARDUPILOT_FIRMWARE_BASE_URL =
  "https://firmware.ardupilot.org/";

export function normalizeVehicleClass(value) {
  if (typeof value !== "string") {
    throw new FirmwareManifestError("Vehicle class must be a string");
  }

  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
  const normalized = VEHICLE_CLASS_ALIASES.get(key);
  if (!normalized) {
    throw new FirmwareManifestError(
      `Unsupported ArduPilot vehicle class: ${value}`,
    );
  }
  return normalized;
}

export function normalizeReleaseChannel(value) {
  if (typeof value !== "string") {
    throw new FirmwareManifestError("Release channel must be a string");
  }

  const key = value.trim().toLowerCase();
  const normalized =
    {
      official: "stable",
      release: "stable",
      dev: "latest",
      development: "latest",
      master: "latest",
    }[key] ?? key;
  if (!ARDUPILOT_RELEASE_CHANNELS.includes(normalized)) {
    throw new FirmwareManifestError(
      `Unsupported ArduPilot release channel: ${value}`,
    );
  }
  return normalized;
}

function inferChannelFromVersionType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized.includes("OFFICIAL")) {
    return "stable";
  }
  if (normalized.includes("BETA")) {
    return "beta";
  }
  if (
    normalized.includes("DEV") ||
    normalized.includes("ALPHA") ||
    normalized.includes("RC")
  ) {
    return "latest";
  }
  return null;
}

function inferChannelFromUrl(url) {
  const components = url.pathname.toLowerCase().split("/").filter(Boolean);
  return (
    ARDUPILOT_RELEASE_CHANNELS.find((channel) =>
      components.includes(channel),
    ) ?? null
  );
}

function inferPackageFormat(value, url) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (normalized === "apj" || normalized === "px4") {
    return normalized;
  }
  const path = url.pathname.toLowerCase();
  if (path.endsWith(".apj")) {
    return "apj";
  }
  if (path.endsWith(".px4")) {
    return "px4";
  }
  return null;
}

function parseVersionComponent(value, field) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new FirmwareManifestError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalBoardId(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 0xffffffff) {
    throw new FirmwareManifestError(
      "board_id must be a non-zero 32-bit unsigned integer",
    );
  }
  return parsed;
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new FirmwareManifestError(`Firmware entry ${index} is not an object`);
  }
  if (typeof entry.url !== "string") {
    throw new FirmwareManifestError(`Firmware entry ${index} has no URL`);
  }

  let url;
  try {
    url = new URL(entry.url);
  } catch (error) {
    throw new FirmwareManifestError(
      `Firmware entry ${index} has an invalid URL`,
      { cause: error },
    );
  }
  if (url.protocol !== "https:") {
    throw new FirmwareManifestError(
      `Firmware entry ${index} does not use HTTPS`,
    );
  }

  const platform = String(entry.platform ?? "").trim();
  if (!platform) {
    throw new FirmwareManifestError(`Firmware entry ${index} has no platform`);
  }

  const vehicleClass = normalizeVehicleClass(
    entry.vehicletype ?? entry.vehicle ?? "",
  );
  const urlChannel = inferChannelFromUrl(url);
  const versionChannel = inferChannelFromVersionType(
    entry["mav-firmware-version-type"],
  );
  const releaseChannelConflict = Boolean(
    urlChannel && versionChannel && urlChannel !== versionChannel,
  );
  const releaseChannel = urlChannel ?? versionChannel;
  if (!releaseChannel) {
    throw new FirmwareManifestError(
      `Firmware entry ${index} has no recognizable release channel`,
    );
  }

  const version = String(
    entry["mav-firmware-version"] ?? entry.version ?? "",
  ).trim();
  if (!version) {
    throw new FirmwareManifestError(`Firmware entry ${index} has no version`);
  }

  const packageFormat = inferPackageFormat(entry.format, url);
  const manifestFormat =
    String(entry.format ?? "")
      .trim()
      .toLowerCase() || null;
  const latest = entry.latest;
  const isLatest = latest === true || latest === 1 || latest === "1";

  return Object.freeze({
    index,
    vehicleClass,
    vehicleType: String(entry.vehicletype ?? ""),
    mavType: typeof entry["mav-type"] === "string" ? entry["mav-type"] : null,
    mavAutopilot:
      typeof entry["mav-autopilot"] === "string"
        ? entry["mav-autopilot"]
        : null,
    platform,
    releaseChannel,
    releaseChannelConflict,
    version,
    versionMajor: parseVersionComponent(
      entry["mav-firmware-version-major"],
      "mav-firmware-version-major",
    ),
    versionMinor: parseVersionComponent(
      entry["mav-firmware-version-minor"],
      "mav-firmware-version-minor",
    ),
    versionPatch: parseVersionComponent(
      entry["mav-firmware-version-patch"],
      "mav-firmware-version-patch",
    ),
    versionType:
      typeof entry["mav-firmware-version-type"] === "string"
        ? entry["mav-firmware-version-type"]
        : null,
    gitSha: typeof entry["git-sha"] === "string" ? entry["git-sha"] : null,
    boardId: parseOptionalBoardId(entry.board_id ?? entry["board-id"]),
    manifestFormat,
    packageFormat,
    flashableByPx4Bootloader:
      packageFormat === "apj" || packageFormat === "px4",
    url: url.href,
    isLatest,
    metadata: Object.freeze({ ...entry }),
  });
}

function compareVersionsDescending(first, second) {
  const firstComponents = [
    first.versionMajor,
    first.versionMinor,
    first.versionPatch,
  ];
  const secondComponents = [
    second.versionMajor,
    second.versionMinor,
    second.versionPatch,
  ];
  for (let index = 0; index < firstComponents.length; index += 1) {
    const difference =
      (secondComponents[index] ?? -1) - (firstComponents[index] ?? -1);
    if (difference !== 0) {
      return difference;
    }
  }
  if (first.isLatest !== second.isLatest) {
    return first.isLatest ? -1 : 1;
  }
  return second.version.localeCompare(first.version, undefined, {
    numeric: true,
  });
}

export function parseArduPilotManifest(input) {
  let manifest;
  try {
    manifest = typeof input === "string" ? JSON.parse(input) : input;
  } catch (error) {
    throw new FirmwareManifestError(
      `ArduPilot manifest JSON is malformed: ${error.message}`,
      {
        cause: error,
      },
    );
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new FirmwareManifestError(
      "ArduPilot manifest root must be an object",
    );
  }

  const formatVersion = String(manifest["format-version"] ?? "").trim();
  if (!/^1(?:\.|$)/.test(formatVersion)) {
    throw new FirmwareManifestError(
      `Unsupported manifest format version: ${formatVersion}`,
    );
  }
  if (!Array.isArray(manifest.firmware)) {
    throw new FirmwareManifestError(
      "ArduPilot manifest firmware field must be an array",
    );
  }

  const entries = [];
  const rejectedEntries = [];
  manifest.firmware.forEach((entry, index) => {
    try {
      entries.push(normalizeEntry(entry, index));
    } catch (error) {
      rejectedEntries.push(Object.freeze({ index, reason: error.message }));
    }
  });

  if (entries.length === 0) {
    throw new FirmwareManifestError(
      "ArduPilot manifest contains no usable firmware entries",
      {
        details: { rejectedEntries },
      },
    );
  }

  return Object.freeze({
    formatVersion,
    entries: Object.freeze(entries),
    rejectedEntries: Object.freeze(rejectedEntries),
  });
}

export function listArduPilotFirmware(manifest, options = {}) {
  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new FirmwareManifestError("A parsed ArduPilot manifest is required");
  }

  const vehicleClass = options.vehicleClass
    ? normalizeVehicleClass(options.vehicleClass)
    : null;
  const releaseChannel = options.releaseChannel
    ? normalizeReleaseChannel(options.releaseChannel)
    : null;
  const platform = options.platform
    ? String(options.platform).trim().toLowerCase()
    : null;
  const flashableOnly = options.flashableOnly !== false;

  return manifest.entries
    .filter((entry) => !vehicleClass || entry.vehicleClass === vehicleClass)
    .filter(
      (entry) => !releaseChannel || entry.releaseChannel === releaseChannel,
    )
    .filter((entry) => !platform || entry.platform.toLowerCase() === platform)
    .filter((entry) => !flashableOnly || entry.flashableByPx4Bootloader)
    .sort(compareVersionsDescending);
}

function normalizedBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new FirmwareManifestError(
      `Invalid ArduPilot firmware base URL: ${value}`,
      { cause: error },
    );
  }
  if (url.protocol !== "https:") {
    throw new FirmwareManifestError(
      "ArduPilot firmware provider requires an HTTPS base URL",
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

export function buildArduPilotFirmwareDirectoryUrl({
  vehicleClass,
  releaseChannel,
  platform = null,
  baseUrl = DEFAULT_ARDUPILOT_FIRMWARE_BASE_URL,
}) {
  const vehicle =
    ARDUPILOT_VEHICLE_CLASSES[normalizeVehicleClass(vehicleClass)];
  const channel = normalizeReleaseChannel(releaseChannel);
  const root = normalizedBaseUrl(baseUrl);
  const path = [vehicle.directory, channel];
  if (platform != null && String(platform).trim()) {
    path.push(encodeURIComponent(String(platform).trim()));
  }
  return new URL(`${path.join("/")}/`, root).href;
}

async function responseBytes(response) {
  if (typeof response.arrayBuffer === "function") {
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new FirmwarePackageError(
    "Firmware download response does not provide arrayBuffer()",
  );
}

export class ArduPilotFirmwareProvider {
  constructor(options = {}) {
    this.baseUrl = normalizedBaseUrl(
      options.baseUrl ?? DEFAULT_ARDUPILOT_FIRMWARE_BASE_URL,
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== "function") {
      throw new FirmwareManifestError("A fetch implementation is required");
    }
    this.allowedOrigins = new Set(
      options.allowedOrigins ?? [this.baseUrl.origin],
    );
  }

  get manifestUrl() {
    return new URL("manifest.json", this.baseUrl).href;
  }

  directoryUrl(options) {
    return buildArduPilotFirmwareDirectoryUrl({
      ...options,
      baseUrl: this.baseUrl.href,
    });
  }

  async loadManifest({ signal } = {}) {
    const response = await this.fetchImpl(this.manifestUrl, { signal });
    if (!response?.ok) {
      throw new FirmwareManifestError(
        `ArduPilot manifest download failed with HTTP ${response?.status ?? "unknown"}`,
      );
    }
    return parseArduPilotManifest(await response.text());
  }

  async listFirmware(options = {}) {
    const manifest =
      options.manifest ?? (await this.loadManifest({ signal: options.signal }));
    return listArduPilotFirmware(manifest, options);
  }

  async downloadPackage(entry, { signal, parse = true } = {}) {
    if (
      !entry?.flashableByPx4Bootloader ||
      !["apj", "px4"].includes(entry.packageFormat)
    ) {
      throw new FirmwarePackageError(
        "Selected manifest entry is not an APJ/PX4 package",
      );
    }

    const url = new URL(entry.url);
    if (url.protocol !== "https:" || !this.allowedOrigins.has(url.origin)) {
      throw new FirmwarePackageError(
        `Firmware URL origin is not allowed: ${url.origin}`,
      );
    }

    const response = await this.fetchImpl(url.href, { signal });
    if (!response?.ok) {
      throw new FirmwarePackageError(
        `Firmware download failed with HTTP ${response?.status ?? "unknown"}`,
      );
    }

    const packageBytes = await responseBytes(response);
    return parse
      ? parseApjPackage(packageBytes, { sourceFormat: entry.packageFormat })
      : packageBytes;
  }
}
