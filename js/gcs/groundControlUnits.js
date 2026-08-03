"use strict";

export const GROUND_CONTROL_UNIT_SYSTEMS = Object.freeze({
  METRIC: "metric",
  IMPERIAL: "imperial",
});

export const DEFAULT_GROUND_CONTROL_UNIT_SYSTEM =
  GROUND_CONTROL_UNIT_SYSTEMS.METRIC;

export const METERS_TO_FEET = 3.280839895013123;
export const METERS_PER_SECOND_TO_MILES_PER_HOUR = 2.2369362920544;
export const METERS_PER_KILOMETER = 1000;
export const METERS_PER_MILE = 1609.344;

const quantity = (symbol, spoken, multiplier) =>
  Object.freeze({ symbol, spoken, multiplier });

const tapeSteps = (compact, regular) => Object.freeze({ compact, regular });

const PROFILES = Object.freeze({
  [GROUND_CONTROL_UNIT_SYSTEMS.METRIC]: Object.freeze({
    id: GROUND_CONTROL_UNIT_SYSTEMS.METRIC,
    altitude: quantity("m", "meters", 1),
    distance: quantity("m", "meters", 1),
    horizontalSpeed: quantity("m/s", "meters per second", 1),
    verticalSpeed: quantity("m/s", "meters per second", 1),
    hudTapeSteps: Object.freeze({
      groundSpeed: tapeSteps(2, 5),
      relativeAltitude: tapeSteps(5, 10),
    }),
  }),
  [GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL]: Object.freeze({
    id: GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL,
    altitude: quantity("ft", "feet", METERS_TO_FEET),
    distance: quantity("ft", "feet", METERS_TO_FEET),
    horizontalSpeed: quantity(
      "mph",
      "miles per hour",
      METERS_PER_SECOND_TO_MILES_PER_HOUR,
    ),
    verticalSpeed: quantity("ft/s", "feet per second", METERS_TO_FEET),
    hudTapeSteps: Object.freeze({
      groundSpeed: tapeSteps(5, 10),
      relativeAltitude: tapeSteps(20, 50),
    }),
  }),
});

const QUANTITY_PROFILE_KEYS = Object.freeze({
  altitude: "altitude",
  relativeAltitude: "altitude",
  distance: "distance",
  distanceToWaypoint: "distance",
  horizontalSpeed: "horizontalSpeed",
  groundSpeed: "horizontalSpeed",
  airSpeed: "horizontalSpeed",
  verticalSpeed: "verticalSpeed",
  climbRate: "verticalSpeed",
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function profileQuantity(quantityName, unitSystem) {
  const profileKey = QUANTITY_PROFILE_KEYS[quantityName];
  if (!profileKey) {
    throw new RangeError(`Unsupported Ground Control quantity: ${quantityName}`);
  }
  return getGroundControlUnitProfile(unitSystem)[profileKey];
}

export function normalizeGroundControlUnitSystem(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    ? GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    : GROUND_CONTROL_UNIT_SYSTEMS.METRIC;
}

/**
 * Resolve Flight Commander's Configurator-wide unit preference. OSD unit
 * families 0, 3, and 4 use imperial distance/speed conventions; every other
 * OSD family and the legacy "none" setting remain metric.
 */
export function resolveConfiguredUnitSystem(unitType, osdUnits) {
  if (
    normalizeGroundControlUnitSystem(unitType) ===
      GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
  ) {
    return GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  }
  if (unitType === "OSD" && [0, 3, 4].includes(Number(osdUnits))) {
    return GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  }
  return GROUND_CONTROL_UNIT_SYSTEMS.METRIC;
}

export function getGroundControlUnitProfile(unitSystem) {
  return PROFILES[normalizeGroundControlUnitSystem(unitSystem)];
}

/**
 * Convert one canonical SI telemetry value for display. The input is never
 * mutated, and unavailable/non-finite values remain unavailable as `null`.
 */
export function convertGroundControlValue(value, quantityName, unitSystem) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return number * profileQuantity(quantityName, unitSystem).multiplier;
}

/**
 * Convert a user-entered display value back to the canonical SI value used by
 * commands, persisted RTK configuration, and protocol payloads.
 */
export function groundControlDisplayToCanonicalValue(
  value,
  quantityName,
  unitSystem,
) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return number / profileQuantity(quantityName, unitSystem).multiplier;
}

/**
 * Produce a display-only telemetry snapshot. All calculations, commands, and
 * persisted vehicle data should continue to use the original SI state.
 */
export function toGroundControlDisplayState(state = {}, unitSystem) {
  const source = state && typeof state === "object" ? state : {};
  return {
    ...source,
    relativeAltitude: convertGroundControlValue(
      source.relativeAltitude,
      "relativeAltitude",
      unitSystem,
    ),
    groundSpeed: convertGroundControlValue(
      source.groundSpeed,
      "groundSpeed",
      unitSystem,
    ),
    airSpeed: convertGroundControlValue(
      source.airSpeed,
      "airSpeed",
      unitSystem,
    ),
    climbRate: convertGroundControlValue(
      source.climbRate,
      "climbRate",
      unitSystem,
    ),
    distanceToWaypoint: convertGroundControlValue(
      source.distanceToWaypoint,
      "distanceToWaypoint",
      unitSystem,
    ),
  };
}

export function groundControlUnitLabel(
  quantityName,
  unitSystem,
  { spoken = false } = {},
) {
  const unit = profileQuantity(quantityName, unitSystem);
  return spoken ? unit.spoken : unit.symbol;
}

export function formatGroundControlValue(
  value,
  quantityName,
  unitSystem,
  { decimals = 1, spoken = false } = {},
) {
  const converted = convertGroundControlValue(value, quantityName, unitSystem);
  if (converted === null) return "--";
  const places = Number.isInteger(decimals)
    ? Math.min(10, Math.max(0, decimals))
    : 1;
  return `${converted.toFixed(places)} ${groundControlUnitLabel(
    quantityName,
    unitSystem,
    { spoken },
  )}`;
}

export function formatGroundControlLongDistance(
  meters,
  unitSystem,
  { decimals = 1 } = {},
) {
  const value = finiteNumber(meters);
  if (value === null) return "--";
  const places = Number.isInteger(decimals)
    ? Math.min(10, Math.max(0, decimals))
    : 1;
  if (
    normalizeGroundControlUnitSystem(unitSystem) ===
    GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
  ) {
    return `${(value / METERS_PER_MILE).toFixed(places)} mi`;
  }
  return `${(value / METERS_PER_KILOMETER).toFixed(places)} km`;
}
