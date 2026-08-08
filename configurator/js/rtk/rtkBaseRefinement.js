"use strict";

export const RTK_REFINEMENT_MIN_FIXED_SAMPLES = 10;
export const RTK_REFINEMENT_MAX_FIXED_SAMPLES = 60;

const METERS_PER_LATITUDE_DEGREE = 111132;
const METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR = 111320;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be finite.`);
  return number;
}

export function summarizeFixedSamples(
  samples = [],
  requiredSamples = RTK_REFINEMENT_MIN_FIXED_SAMPLES,
) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const normalized = samples.map((sample) => ({
    latitude: finite(sample.latitude, "RTK latitude"),
    longitude: finite(sample.longitude, "RTK longitude"),
    ellipsoidHeightM: finite(sample.ellipsoidHeightM, "RTK ellipsoid height"),
    altitudeMsl: finite(sample.altitudeMsl ?? 0, "RTK MSL altitude"),
    horizontalAccuracyM: Math.max(0, finite(sample.horizontalAccuracyM ?? 0, "RTK horizontal accuracy")),
    verticalAccuracyM: Math.max(0, finite(sample.verticalAccuracyM ?? 0, "RTK vertical accuracy")),
  }));
  const count = normalized.length;
  const mean = normalized.reduce((result, sample) => ({
    latitude: result.latitude + sample.latitude / count,
    longitude: result.longitude + sample.longitude / count,
    ellipsoidHeightM: result.ellipsoidHeightM + sample.ellipsoidHeightM / count,
    altitudeMsl: result.altitudeMsl + sample.altitudeMsl / count,
  }), { latitude: 0, longitude: 0, ellipsoidHeightM: 0, altitudeMsl: 0 });
  const longitudeScale = METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR *
    Math.cos(mean.latitude * Math.PI / 180);
  let horizontalSquared = 0;
  let verticalSquared = 0;
  let reportedAccuracyM = 0;
  for (const sample of normalized) {
    const northM = (sample.latitude - mean.latitude) * METERS_PER_LATITUDE_DEGREE;
    const eastM = (sample.longitude - mean.longitude) * longitudeScale;
    const upM = sample.ellipsoidHeightM - mean.ellipsoidHeightM;
    horizontalSquared += northM * northM + eastM * eastM;
    verticalSquared += upM * upM;
    reportedAccuracyM = Math.max(
      reportedAccuracyM,
      sample.horizontalAccuracyM,
      sample.verticalAccuracyM,
    );
  }
  const horizontalRmsM = Math.sqrt(horizontalSquared / count);
  const verticalRmsM = Math.sqrt(verticalSquared / count);
  const stabilityM = Math.max(horizontalRmsM, verticalRmsM);
  return Object.freeze({
    samples: count,
    ready: count >= requiredSamples,
    latitude: mean.latitude,
    longitude: mean.longitude,
    ellipsoidHeightM: mean.ellipsoidHeightM,
    altitudeMsl: mean.altitudeMsl,
    horizontalRmsM,
    verticalRmsM,
    stabilityM,
    reportedAccuracyM,
    fixedPositionAccuracyM: Math.max(0.005, reportedAccuracyM, stabilityM * 2),
  });
}
