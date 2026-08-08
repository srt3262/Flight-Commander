"use strict";

import {
  MAV_CMD_NAV_WAYPOINT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  normalizeCoordinate,
} from "./surveyGrid.js";
import {
  hasInavMissionMetadata,
  inavMetadataForInsertedItem,
  reindexInavMissionItems,
} from "./inavMissionCodec.js";

const EARTH_RADIUS_M = 6378137;
const MAV_FRAME_GLOBAL_INT = 5;
const MAV_CMD_DO_JUMP = 177;
const OPENTOPO_PUBLIC_MAX_LOCATIONS = 100;
const OPENTOPO_PUBLIC_MIN_INTERVAL_MS = 1100;

export const DEFAULT_ELEVATION_SOURCE = "opentopo";

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function normalizeElevationResults(results, expectedLength, providerName) {
  if (!Array.isArray(results) || results.length !== expectedLength) {
    throw new Error(
      `${providerName} returned ${results?.length ?? 0} elevations for ${expectedLength} locations.`,
    );
  }
  return results.map((result, index) => {
    if (result?.elevation == null) {
      throw new Error(
        `${providerName} did not return an elevation for location ${index + 1}.`,
      );
    }
    const elevation = Number(result.elevation);
    if (!Number.isFinite(elevation)) {
      throw new Error(
        `${providerName} did not return an elevation for location ${index + 1}.`,
      );
    }
    return elevation;
  });
}

function normalizeElevationCoordinates(locations, providerName) {
  if (!Array.isArray(locations)) {
    throw new Error(`${providerName} locations must be an array.`);
  }
  return locations.map((location, index) => {
    const coordinate = normalizeCoordinate(location);
    if (
      !Number.isFinite(coordinate.latitude) ||
      !Number.isFinite(coordinate.longitude) ||
      Math.abs(coordinate.latitude) > 90 ||
      Math.abs(coordinate.longitude) > 180
    ) {
      throw new Error(
        `${providerName} location ${index + 1} has an invalid latitude or longitude.`,
      );
    }
    return coordinate;
  });
}

function wait(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Elevation request cancelled."),
      );
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function retryAfterMilliseconds(response, now) {
  const header = response?.headers?.get?.("retry-after");
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now()) : 0;
}

export class OpenTopoDataElevationProvider {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.dataset = options.dataset ?? "aster30m";
    this.baseUrl = String(
      options.baseUrl ?? "https://api.opentopodata.org/v1",
    ).replace(/\/+$/, "");
    this.batchSize = options.batchSize ?? 100;
    this.minRequestIntervalMs =
      options.minRequestIntervalMs ?? OPENTOPO_PUBLIC_MIN_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? OPENTOPO_PUBLIC_MIN_INTERVAL_MS;
    this.cacheSize = options.cacheSize ?? 5000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.lastRequestStartedAt = null;
    this.cache = new Map();
    this.name = "Built-in online terrain";
    this.attribution = "Elevation: OpenTopoData ASTER GDEM (~30 m)";

    if (typeof this.fetch !== "function") {
      throw new Error(
        "OpenTopoData requires an available network fetch implementation.",
      );
    }
    if (!/^[a-z0-9_-]+$/i.test(this.dataset)) {
      throw new Error("OpenTopoData dataset name is invalid.");
    }
    if (
      !Number.isInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > OPENTOPO_PUBLIC_MAX_LOCATIONS
    ) {
      throw new Error(
        `OpenTopoData batch size must be between 1 and ${OPENTOPO_PUBLIC_MAX_LOCATIONS}.`,
      );
    }
    if (
      !Number.isFinite(this.minRequestIntervalMs) ||
      this.minRequestIntervalMs < 0
    ) {
      throw new Error(
        "OpenTopoData request interval must be a non-negative number.",
      );
    }
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error(
        "OpenTopoData request timeout must be a positive number.",
      );
    }
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new Error(
        "OpenTopoData maxRetries must be a non-negative integer.",
      );
    }
    if (!Number.isFinite(this.retryBaseDelayMs) || this.retryBaseDelayMs < 0) {
      throw new Error(
        "OpenTopoData retry delay must be a non-negative number.",
      );
    }
    if (!Number.isInteger(this.cacheSize) || this.cacheSize < 0) {
      throw new Error(
        "OpenTopoData cache size must be a non-negative integer.",
      );
    }
  }

  coordinateKey(coordinate) {
    return `${coordinate.latitude.toFixed(7)},${coordinate.longitude.toFixed(7)}`;
  }

  cacheElevation(key, elevation) {
    if (this.cacheSize === 0) return;
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, elevation);
    while (this.cache.size > this.cacheSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  async waitForRequestSlot(signal) {
    if (this.lastRequestStartedAt == null) return;
    const remaining =
      this.minRequestIntervalMs - (this.now() - this.lastRequestStartedAt);
    if (remaining > 0) await this.sleep(remaining, signal);
  }

  async fetchResponse(url, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Elevation request cancelled.");
    }
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    try {
      return await this.fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(
          `OpenTopoData request timed out after ${this.requestTimeoutMs} ms.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async requestBatch(coordinates, signal) {
    const locations = coordinates
      .map(
        ({ latitude, longitude }) =>
          `${latitude.toFixed(7)},${longitude.toFixed(7)}`,
      )
      .join("|");
    const url =
      `${this.baseUrl}/${encodeURIComponent(this.dataset)}` +
      `?locations=${encodeURIComponent(locations)}`;
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot(signal);
      this.lastRequestStartedAt = this.now();
      let response;
      let retryable = true;
      let retryAfter = 0;
      try {
        response = await this.fetchResponse(url, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = new Error(
          `OpenTopoData network request failed: ${error.message}`,
          { cause: error },
        );
      }

      if (response) {
        if (response.ok) {
          let payload;
          try {
            payload = await response.json();
          } catch (error) {
            lastError = new Error(
              `OpenTopoData returned invalid JSON: ${error.message}`,
              { cause: error },
            );
          }
          if (payload?.status === "OK") {
            return normalizeElevationResults(
              payload.results,
              coordinates.length,
              this.name,
            );
          }
          if (payload) {
            retryable = payload.status === "SERVER_ERROR";
            lastError = new Error(
              `OpenTopoData request failed: ${payload.error ?? payload.status ?? "unknown error"}.`,
            );
          }
        } else {
          retryable = response.status === 429 || response.status >= 500;
          retryAfter = retryAfterMilliseconds(response, this.now);
          lastError = new Error(
            `OpenTopoData request failed with HTTP ${response.status}.`,
          );
        }
      }

      if (!retryable || attempt === this.maxRetries) break;
      await this.sleep(
        Math.max(retryAfter, this.retryBaseDelayMs * 2 ** attempt),
        signal,
      );
    }

    throw new Error(
      `${lastError?.message ?? "OpenTopoData request failed."} ` +
        "The no-key public terrain service may be busy or unavailable; " +
        "try again later, choose Google Elevation, or load local GIS data.",
      { cause: lastError },
    );
  }

  async elevations(locations, options = {}) {
    const coordinates = normalizeElevationCoordinates(locations, this.name);
    if (!coordinates.length) return [];
    const keys = coordinates.map((coordinate) =>
      this.coordinateKey(coordinate),
    );
    const elevations = new Map();
    const missing = [];
    const seen = new Set();
    coordinates.forEach((coordinate, index) => {
      const key = keys[index];
      if (this.cache.has(key)) {
        elevations.set(key, this.cache.get(key));
      } else if (!seen.has(key)) {
        seen.add(key);
        missing.push(coordinate);
      }
    });

    const batches = chunks(missing, this.batchSize);
    let completed = keys.filter((key) => elevations.has(key)).length;
    options.onProgress?.({
      completedLocations: completed,
      totalLocations: coordinates.length,
      completedRequests: 0,
      totalRequests: batches.length,
    });
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const result = await this.requestBatch(batch, options.signal);
      batch.forEach((coordinate, resultIndex) => {
        const key = this.coordinateKey(coordinate);
        const elevation = result[resultIndex];
        elevations.set(key, elevation);
        this.cacheElevation(key, elevation);
      });
      completed = keys.filter((key) => elevations.has(key)).length;
      options.onProgress?.({
        completedLocations: completed,
        totalLocations: coordinates.length,
        completedRequests: index + 1,
        totalRequests: batches.length,
      });
    }
    return keys.map((key) => elevations.get(key));
  }
}

export class GoogleElevationProvider {
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new Error(
        "A Google Maps Platform API key is required for Google Elevation.",
      );
    }
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.apiKey = options.apiKey;
    this.baseUrl =
      options.baseUrl ?? "https://maps.googleapis.com/maps/api/elevation/json";
    this.batchSize = options.batchSize ?? 250;
    this.name = "Google Elevation";
    this.attribution = "Elevation data © Google";
    if (typeof this.fetch !== "function") {
      throw new Error(
        "Google Elevation requires an available network fetch implementation.",
      );
    }
  }

  async elevations(locations) {
    const coordinates = locations.map(normalizeCoordinate);
    const result = [];
    for (const batch of chunks(coordinates, this.batchSize)) {
      const locationsParameter = batch
        .map(({ latitude, longitude }) => `${latitude},${longitude}`)
        .join("|");
      const url =
        `${this.baseUrl}?locations=${encodeURIComponent(locationsParameter)}` +
        `&key=${encodeURIComponent(this.apiKey)}`;
      const response = await this.fetch(url);
      if (!response.ok) {
        throw new Error(
          `Google Elevation request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await response.json();
      if (payload.status !== "OK") {
        throw new Error(
          `Google Elevation request failed: ${payload.error_message ?? payload.status}.`,
        );
      }
      result.push(
        ...normalizeElevationResults(payload.results, batch.length, this.name),
      );
    }
    return result;
  }
}

export function localDistance(leftValue, rightValue) {
  const left = normalizeCoordinate(leftValue);
  const right = normalizeCoordinate(rightValue);
  const averageLatitude =
    (((left.latitude + right.latitude) / 2) * Math.PI) / 180;
  const latitudeDelta = ((right.latitude - left.latitude) * Math.PI) / 180;
  const longitudeDelta = ((right.longitude - left.longitude) * Math.PI) / 180;
  return Math.hypot(
    longitudeDelta * EARTH_RADIUS_M * Math.cos(averageLatitude),
    latitudeDelta * EARTH_RADIUS_M,
  );
}

export class GisPointElevationProvider {
  constructor(points, options = {}) {
    this.points = points.map((point) => {
      const coordinate = normalizeCoordinate(point);
      const elevation = Number(
        point.elevation ?? point.ele ?? point.altitude ?? point.z,
      );
      if (!Number.isFinite(elevation)) {
        throw new Error("Every GIS elevation point needs a numeric elevation.");
      }
      return { ...coordinate, elevation };
    });
    if (!this.points.length) {
      throw new Error("The GIS elevation dataset contains no points.");
    }
    this.maxDistanceM = options.maxDistanceM ?? Number.POSITIVE_INFINITY;
    this.name = options.name ?? "Local GIS";
    this.attribution =
      options.attribution ?? "Elevation data: local GIS dataset";
  }

  async elevations(locations) {
    return locations.map((location, index) => {
      const coordinate = normalizeCoordinate(location);
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const point of this.points) {
        const distance = localDistance(coordinate, point);
        if (distance < nearestDistance) {
          nearest = point;
          nearestDistance = distance;
        }
      }
      if (!nearest || nearestDistance > this.maxDistanceM) {
        throw new Error(
          `No GIS elevation sample is close enough to mission location ${index + 1}.`,
        );
      }
      return nearest.elevation;
    });
  }

  static fromGeoJson(input, options = {}) {
    const geoJson = typeof input === "string" ? JSON.parse(input) : input;
    const features =
      geoJson?.type === "FeatureCollection"
        ? geoJson.features
        : geoJson?.type === "Feature"
          ? [geoJson]
          : [];
    const points = [];
    const collect = (coordinates, properties = {}) => {
      if (!Array.isArray(coordinates)) return;
      if (
        coordinates.length >= 2 &&
        Number.isFinite(Number(coordinates[0])) &&
        Number.isFinite(Number(coordinates[1]))
      ) {
        points.push({
          longitude: Number(coordinates[0]),
          latitude: Number(coordinates[1]),
          elevation: Number(
            properties.elevation ??
              properties.ele ??
              properties.altitude ??
              properties.z ??
              coordinates[2],
          ),
        });
        return;
      }
      coordinates.forEach((nested) => collect(nested, properties));
    };
    for (const feature of features) {
      collect(feature.geometry?.coordinates, feature.properties ?? {});
    }
    return new GisPointElevationProvider(points, options);
  }

  static fromCsv(input, options = {}) {
    const rows = String(input)
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean);
    if (rows.length < 2) throw new Error("The GIS CSV file is empty.");
    const delimiter = rows[0].includes("\t") ? "\t" : ",";
    const headers = rows[0]
      .split(delimiter)
      .map((value) => value.trim().toLowerCase());
    const findHeader = (names) =>
      headers.findIndex((header) => names.includes(header));
    const latitudeIndex = findHeader(["latitude", "lat", "y"]);
    const longitudeIndex = findHeader(["longitude", "lon", "lng", "x"]);
    const elevationIndex = findHeader([
      "elevation",
      "elev",
      "ele",
      "altitude",
      "alt",
      "z",
    ]);
    if (
      [latitudeIndex, longitudeIndex, elevationIndex].some((index) => index < 0)
    ) {
      throw new Error(
        "GIS CSV headers must include latitude, longitude, and elevation.",
      );
    }
    const points = rows.slice(1).map((row) => {
      const fields = row.split(delimiter).map((value) => value.trim());
      return {
        latitude: Number(fields[latitudeIndex]),
        longitude: Number(fields[longitudeIndex]),
        elevation: Number(fields[elevationIndex]),
      };
    });
    return new GisPointElevationProvider(points, options);
  }
}

function interpolateCoordinate(left, right, ratio) {
  return {
    latitude: left.latitude + (right.latitude - left.latitude) * ratio,
    longitude: left.longitude + (right.longitude - left.longitude) * ratio,
  };
}

function densifyNavigationMission(mission, sampleSpacingM = 30) {
  const spacing = Number(sampleSpacingM);
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return mission.map((item) => ({
      ...item,
      ...(item?.metadata ? { metadata: { ...item.metadata } } : {}),
    }));
  }
  const hasInavMetadata = hasInavMissionMetadata(mission);
  const result = [];
  const originalIndexes = [];
  let previousNavigationItem = null;
  let previousSegment = null;
  let inserted = false;

  for (const [index, item] of mission.entries()) {
    const isNavigation = isTerrainWaypoint(item);
    const segment = Number.isInteger(
      Number(item?.metadata?.inavMultiMissionIndex),
    )
      ? Number(item.metadata.inavMultiMissionIndex)
      : null;
    const sameSegment =
      !hasInavMetadata ||
      previousSegment == null ||
      segment == null ||
      previousSegment === segment;
    if (isNavigation && previousNavigationItem && sameSegment) {
      const start = normalizeCoordinate(previousNavigationItem);
      const end = normalizeCoordinate(item);
      const totalDistance = localDistance(start, end);
      const sampleCount = Math.floor(totalDistance / spacing);
      for (let sample = 1; sample <= sampleCount; sample += 1) {
        const distance = sample * spacing;
        if (distance >= totalDistance - 0.01) break;
        const coordinate = interpolateCoordinate(
          start,
          end,
          distance / totalDistance,
        );
        result.push({
          ...item,
          ...coordinate,
          ...(hasInavMetadata
            ? { param2: 0, param3: Number(item.param3) & 1 }
            : {}),
          metadata: hasInavMetadata
            ? inavMetadataForInsertedItem(item, {
                kind: "terrain-sample",
              })
            : {
                ...(item.metadata ?? {}),
                kind: "terrain-sample",
              },
        });
        originalIndexes.push(null);
        inserted = true;
      }
    }
    result.push({
      ...item,
      ...(item?.metadata ? { metadata: { ...item.metadata } } : {}),
    });
    originalIndexes.push(index);
    if (isNavigation) {
      previousNavigationItem = item;
      previousSegment = segment;
    }
  }
  if (!inserted) return result;
  if (hasInavMetadata) return reindexInavMissionItems(result);

  const remappedIndexes = new Map();
  originalIndexes.forEach((oldIndex, newIndex) => {
    if (oldIndex != null) remappedIndexes.set(oldIndex, newIndex);
  });
  return result.map((item, newIndex) => {
    if (
      Number(item.command) !== MAV_CMD_DO_JUMP ||
      originalIndexes[newIndex] == null
    ) {
      return item;
    }
    const oldIndex = originalIndexes[newIndex];
    const target = Number(item.param1);
    if (!Number.isInteger(target) || target < 0 || target >= mission.length) {
      throw new Error(
        `Mission item ${oldIndex + 1} has invalid MAVLink DO_JUMP target ${item.param1}.`,
      );
    }
    const remappedTarget = remappedIndexes.get(target);
    if (remappedTarget == null) {
      throw new Error(
        `Mission item ${oldIndex + 1} DO_JUMP target was removed during terrain generation.`,
      );
    }
    return {
      ...item,
      param1: remappedTarget,
      ...(item?.metadata ? { metadata: { ...item.metadata } } : {}),
    };
  });
}

export function isTerrainWaypoint(item) {
  return (
    Number(item?.command) === MAV_CMD_NAV_WAYPOINT &&
    Number.isFinite(Number(item.latitude ?? item.lat)) &&
    Number.isFinite(Number(item.longitude ?? item.lon))
  );
}

export async function applyTerrainFollowing(mission, provider, options = {}) {
  const {
    clearanceM = 60,
    home = null,
    altitudeReference = "relative-home",
    sampleSpacingM = 30,
    onProgress = () => {},
    signal = null,
  } = options;
  const clearance = Number(clearanceM);
  if (!Number.isFinite(clearance)) {
    throw new Error("Terrain clearance must be a finite number.");
  }
  const densifiedMission = densifyNavigationMission(mission, sampleSpacingM);
  const navigationItems = densifiedMission.filter(isTerrainWaypoint);
  if (!navigationItems.length) {
    return {
      mission: densifiedMission,
      homeElevationM: null,
      attribution: provider.attribution,
    };
  }
  const coordinates = [
    normalizeCoordinate(home || navigationItems[0]),
    ...navigationItems.map(normalizeCoordinate),
  ];
  onProgress({ completed: 0, total: coordinates.length });
  const elevations = await provider.elevations(coordinates, {
    signal,
    onProgress: ({ completedLocations, totalLocations }) => {
      onProgress({ completed: completedLocations, total: totalLocations });
    },
  });
  onProgress({ completed: coordinates.length, total: coordinates.length });
  const homeElevation =
    home?.elevation != null && Number.isFinite(Number(home.elevation))
      ? Number(home.elevation)
      : elevations[0];
  let elevationIndex = 1;
  return {
    mission: densifiedMission.map((item) => {
      if (!isTerrainWaypoint(item)) return item;
      const terrainElevation = elevations[elevationIndex];
      elevationIndex += 1;
      const altitude =
        altitudeReference === "absolute"
          ? terrainElevation + clearance
          : terrainElevation + clearance - homeElevation;
      return {
        ...item,
        frame:
          altitudeReference === "absolute"
            ? MAV_FRAME_GLOBAL_INT
            : MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        altitude,
        metadata: {
          ...(item.metadata ?? {}),
          terrainElevationM: terrainElevation,
          terrainClearanceM: clearance,
          altitudeReference,
        },
      };
    }),
    homeElevationM: homeElevation,
    attribution: provider.attribution,
  };
}
