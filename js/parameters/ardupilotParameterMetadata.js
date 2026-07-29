const DEFAULT_CACHE_TTL_MS = 720 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const OFFICIAL_PARAMETER_ROOT = "https://autotest.ardupilot.org/Parameters";
const VERSIONED_PARAMETER_ROOT =
  "https://raw.githubusercontent.com/ArduPilot/ParameterRepository/main";

export const VEHICLE_PROFILES = Object.freeze({
  copter: Object.freeze({
    id: "copter",
    label: "ArduCopter",
    repositoryPrefix: "Copter",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/ArduCopter/apm.pdef.json`,
  }),
  plane: Object.freeze({
    id: "plane",
    label: "ArduPlane",
    repositoryPrefix: "Plane",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/ArduPlane/apm.pdef.json`,
  }),
  rover: Object.freeze({
    id: "rover",
    label: "Rover",
    repositoryPrefix: "Rover",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/Rover/apm.pdef.json`,
  }),
  sub: Object.freeze({
    id: "sub",
    label: "ArduSub",
    repositoryPrefix: "Sub",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/ArduSub/apm.pdef.json`,
  }),
  tracker: Object.freeze({
    id: "tracker",
    label: "AntennaTracker",
    repositoryPrefix: "Tracker",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/AntennaTracker/apm.pdef.json`,
  }),
  blimp: Object.freeze({
    id: "blimp",
    label: "Blimp",
    repositoryPrefix: "Blimp",
    endpoint: `${OFFICIAL_PARAMETER_ROOT}/Blimp/apm.pdef.json`,
  }),
});

const METADATA_FIELDS = new Set([
  "Bitmask",
  "Description",
  "DisplayName",
  "Increment",
  "Range",
  "ReadOnly",
  "RebootRequired",
  "UnitText",
  "Units",
  "User",
  "Values",
  "Volatile",
  "bitmask",
  "category",
  "description",
  "displayName",
  "group",
  "increment",
  "longDesc",
  "max",
  "min",
  "name",
  "readOnly",
  "rebootRequired",
  "shortDesc",
  "units",
  "user",
  "values",
  "volatile",
]);

export function vehicleProfileForMavType(value) {
  const mavType = Number(value);
  if ([1, 19, 20, 21].includes(mavType)) {
    return VEHICLE_PROFILES.plane;
  }
  if ([10, 11].includes(mavType)) {
    return VEHICLE_PROFILES.rover;
  }
  if (mavType === 12) {
    return VEHICLE_PROFILES.sub;
  }
  if (mavType === 5) {
    return VEHICLE_PROFILES.tracker;
  }
  if (mavType === 7) {
    return VEHICLE_PROFILES.blimp;
  }
  return VEHICLE_PROFILES.copter;
}

function firmwareSeries(version) {
  const major = Number(version?.major);
  const minor = Number(version?.minor);
  if (
    !Number.isInteger(major) ||
    major < 0 ||
    !Number.isInteger(minor) ||
    minor < 0
  ) {
    return null;
  }
  return `${major}.${minor}`;
}

function metadataEndpoints(profile, version) {
  const series = firmwareSeries(version);
  return [
    ...(series
      ? [
          {
            url: `${VERSIONED_PARAMETER_ROOT}/${profile.repositoryPrefix}-${series}/apm.pdef.json`,
            versionMatched: true,
          },
        ]
      : []),
    { url: profile.endpoint, versionMatched: false },
  ];
}

function numericOrNull(value) {
  if (value === "" || value == null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function truthyMetadataValue(value) {
  if (typeof value === "string") {
    return ["1", "true", "yes"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function normalizeChoices(value) {
  if (!value) {
    return [];
  }
  const entries = Array.isArray(value)
    ? value.map((entry) => [
        entry.value ?? entry.index,
        entry.description ?? entry.label ?? entry.name,
      ])
    : Object.entries(value);

  return entries
    .map(([choiceValue, label]) => {
      const numericValue = numericOrNull(choiceValue);
      return numericValue == null || label == null
        ? null
        : { value: numericValue, label: String(label) };
    })
    .filter(Boolean)
    .sort((first, second) => first.value - second.value);
}

function normalizeMetadataRecord(id, record = {}) {
  const range = record.Range ?? {};
  const displayName =
    record.DisplayName ?? record.displayName ?? record.shortDesc ?? id;
  const description =
    record.Description ?? record.description ?? record.longDesc ?? "";
  const units = record.Units ?? record.units ?? record.UnitText ?? "";

  return {
    id,
    displayName: String(displayName || id),
    description: String(description || ""),
    units: String(units || ""),
    min: numericOrNull(range.low ?? record.min),
    max: numericOrNull(range.high ?? record.max),
    increment: numericOrNull(record.Increment ?? record.increment),
    values: normalizeChoices(record.Values ?? record.values),
    bitmask: normalizeChoices(record.Bitmask ?? record.bitmask),
    user: String(record.User ?? record.user ?? "")
      .trim()
      .toLowerCase(),
    category: String(record.Category ?? record.category ?? "").trim(),
    group: String(record.Group ?? record.group ?? "").trim(),
    readOnly: truthyMetadataValue(record.ReadOnly ?? record.readOnly),
    rebootRequired: truthyMetadataValue(
      record.RebootRequired ?? record.rebootRequired,
    ),
    volatile: truthyMetadataValue(record.Volatile ?? record.volatile),
  };
}

function looksLikeMetadataRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => METADATA_FIELDS.has(key))
  );
}

function looksLikeParameterId(value) {
  return /^[A-Z][A-Z0-9_]{0,31}$/.test(String(value));
}

export function normalizeArduPilotMetadata(input) {
  const metadata = new Map();
  const add = (candidateId, record) => {
    const id = String(candidateId ?? record?.name ?? "")
      .trim()
      .toUpperCase();
    if (looksLikeParameterId(id)) {
      metadata.set(id, normalizeMetadataRecord(id, record));
    }
  };

  if (Array.isArray(input?.parameters)) {
    for (const record of input.parameters) {
      add(record?.name, record);
    }
    return metadata;
  }

  const visit = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    for (const [key, record] of Object.entries(value)) {
      if (looksLikeParameterId(key) && looksLikeMetadataRecord(record)) {
        add(key, record);
      } else if (record && typeof record === "object") {
        visit(record);
      }
    }
  };
  visit(input);
  return metadata;
}

function serializeMetadata(metadata) {
  return [...metadata.values()];
}

function deserializeMetadata(entries) {
  const metadata = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.id) {
      metadata.set(entry.id, {
        ...entry,
        values: Array.isArray(entry.values) ? entry.values : [],
        bitmask: Array.isArray(entry.bitmask) ? entry.bitmask : [],
      });
    }
  }
  return metadata;
}

function electronStoreCache() {
  return {
    get(key) {
      return globalThis.window?.electronAPI?.storeGet?.(key, null) ?? null;
    },
    set(key, value) {
      globalThis.window?.electronAPI?.storeSet?.(key, value);
    },
  };
}

export class ArduPilotParameterMetadataProvider {
  constructor(options = {}) {
    this.fetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.cache = options.cache ?? electronStoreCache();
    this.now = options.now ?? (() => Date.now());
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  cacheKey(profile, series) {
    return (
      `flightCommander.ardupilotParameterMetadata.v${CACHE_SCHEMA_VERSION}.` +
      `${profile.id}.${series ?? "latest"}`
    );
  }

  readCache(profile, series) {
    try {
      const entry = this.cache?.get?.(this.cacheKey(profile, series));
      if (
        !entry ||
        entry.schemaVersion !== CACHE_SCHEMA_VERSION ||
        entry.profileId !== profile.id ||
        !Array.isArray(entry.entries)
      ) {
        return null;
      }
      return { ...entry, metadata: deserializeMetadata(entry.entries) };
    } catch {
      return null;
    }
  }

  writeCache(profile, series, metadata, fetchedAt, endpoint, versionMatched) {
    try {
      this.cache?.set?.(this.cacheKey(profile, series), {
        schemaVersion: CACHE_SCHEMA_VERSION,
        profileId: profile.id,
        firmwareSeries: series,
        endpoint,
        versionMatched,
        fetchedAt,
        entries: serializeMetadata(metadata),
      });
    } catch {
      // Metadata remains usable even if persistence is unavailable.
    }
  }

  async load(mavType, options = {}) {
    const profile = vehicleProfileForMavType(mavType);
    const series = firmwareSeries(options.firmwareVersion);
    const cached = this.readCache(profile, series);
    const cacheAge = cached
      ? this.now() - Number(cached.fetchedAt ?? 0)
      : Infinity;

    if (!options.forceRefresh && cached && cacheAge <= this.cacheTtlMs) {
      return {
        profile,
        metadata: cached.metadata,
        source: "cache",
        fetchedAt: cached.fetchedAt,
        stale: false,
        firmwareSeries: series,
        endpoint: cached.endpoint,
        versionMatched: Boolean(cached.versionMatched),
      };
    }

    try {
      if (typeof this.fetch !== "function") {
        throw new Error("Network metadata retrieval is unavailable.");
      }

      let lastError = null;
      for (const endpoint of metadataEndpoints(
        profile,
        options.firmwareVersion,
      )) {
        try {
          const response = await this.fetch(endpoint.url, {
            cache: "no-cache",
            headers: { Accept: "application/json" },
          });
          if (!response?.ok) {
            throw new Error(`HTTP ${response?.status ?? "unknown"}`);
          }
          const metadata = normalizeArduPilotMetadata(await response.json());
          if (!metadata.size) {
            throw new Error(
              "the response did not contain any parameter definitions",
            );
          }

          const fetchedAt = this.now();
          this.writeCache(
            profile,
            series,
            metadata,
            fetchedAt,
            endpoint.url,
            endpoint.versionMatched,
          );
          return {
            profile,
            metadata,
            source: "official",
            fetchedAt,
            stale: false,
            firmwareSeries: series,
            endpoint: endpoint.url,
            versionMatched: endpoint.versionMatched,
          };
        } catch (error) {
          lastError = new Error(`${endpoint.url}: ${error.message}`);
        }
      }
      throw lastError ?? new Error("Official metadata retrieval failed.");
    } catch (error) {
      if (cached?.metadata?.size) {
        return {
          profile,
          metadata: cached.metadata,
          source: "cache",
          fetchedAt: cached.fetchedAt,
          stale: true,
          firmwareSeries: series,
          endpoint: cached.endpoint,
          versionMatched: Boolean(cached.versionMatched),
          warning: `Official metadata could not be refreshed; using the cached copy. ${error.message}`,
        };
      }

      return {
        profile,
        metadata: new Map(),
        source: "inferred",
        fetchedAt: null,
        stale: false,
        firmwareSeries: series,
        endpoint: null,
        versionMatched: false,
        warning:
          "Official metadata is unavailable. Parameter names and live controller values " +
          `remain editable. ${error.message}`,
      };
    }
  }
}

export {
  CACHE_SCHEMA_VERSION,
  DEFAULT_CACHE_TTL_MS,
  OFFICIAL_PARAMETER_ROOT,
  VERSIONED_PARAMETER_ROOT,
};

export default ArduPilotParameterMetadataProvider;
