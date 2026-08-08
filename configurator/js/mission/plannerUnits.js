'use strict';

import {
  GROUND_CONTROL_UNIT_SYSTEMS,
  METERS_PER_SECOND_TO_MILES_PER_HOUR,
  METERS_TO_FEET,
  resolveConfiguredUnitSystem,
} from './../gcs/groundControlUnits.js';

const SQUARE_METERS_TO_SQUARE_FEET = METERS_TO_FEET * METERS_TO_FEET;
const SQUARE_METERS_PER_ACRE = 4046.8564224;
const METERS_PER_MILE = 1609.344;

export function resolvePlannerUnitSystem(unitType, osdUnits) {
  return resolveConfiguredUnitSystem(unitType, osdUnits);
}

export function plannerUnitLabels(unitSystem) {
  const imperial = unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  return {
    distance: imperial ? 'ft' : 'm',
    speed: imperial ? 'mph' : 'm/s',
    area: imperial ? 'ft²' : 'm²',
  };
}

export function distanceToPlannerDisplay(meters, unitSystem) {
  const value = Number(meters);
  return unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    ? value * METERS_TO_FEET
    : value;
}

export function distanceFromPlannerDisplay(value, unitSystem) {
  const number = Number(value);
  return unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    ? number / METERS_TO_FEET
    : number;
}

export function speedToPlannerDisplay(metersPerSecond, unitSystem) {
  const value = Number(metersPerSecond);
  return unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    ? value * METERS_PER_SECOND_TO_MILES_PER_HOUR
    : value;
}

export function speedFromPlannerDisplay(value, unitSystem) {
  const number = Number(value);
  return unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
    ? number / METERS_PER_SECOND_TO_MILES_PER_HOUR
    : number;
}

export function formatPlannerDistance(meters, unitSystem) {
  const value = Number(meters) || 0;
  if (unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL) {
    return value >= METERS_PER_MILE
      ? `${(value / METERS_PER_MILE).toFixed(2)} mi`
      : `${distanceToPlannerDisplay(value, unitSystem).toFixed(0)} ft`;
  }
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} km`
    : `${value.toFixed(0)} m`;
}

export function formatPlannerArea(squareMeters, unitSystem) {
  const value = Number(squareMeters) || 0;
  if (unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL) {
    return value >= SQUARE_METERS_PER_ACRE
      ? `${(value / SQUARE_METERS_PER_ACRE).toFixed(2)} ac`
      : `${(value * SQUARE_METERS_TO_SQUARE_FEET).toFixed(0)} ft²`;
  }
  return value >= 10000
    ? `${(value / 10000).toFixed(2)} ha`
    : `${value.toFixed(0)} m²`;
}
