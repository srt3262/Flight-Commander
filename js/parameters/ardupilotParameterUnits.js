"use strict";

import {
  GROUND_CONTROL_UNIT_SYSTEMS,
  METERS_PER_SECOND_TO_MILES_PER_HOUR,
  METERS_TO_FEET,
  normalizeGroundControlUnitSystem,
} from "../gcs/groundControlUnits.js";

const CENTIMETERS_TO_FEET = METERS_TO_FEET / 100;
const MILLIMETERS_TO_INCHES = 1 / 25.4;
const METERS_TO_MILES = 0.000621371192237334;
const SQUARE_METERS_TO_SQUARE_FEET = METERS_TO_FEET ** 2;
const CUBIC_METERS_TO_CUBIC_FEET = METERS_TO_FEET ** 3;
const LITERS_TO_US_GALLONS = 0.2641720523581484;
const KILOGRAMS_TO_POUNDS = 2.2046226218487757;
const GRAMS_TO_OUNCES = 0.035273961949580414;
const PASCALS_TO_INHG = 0.00029529983071445;
const KILOPASCALS_TO_PSI = 0.14503773773020923;
const HECTOPASCALS_TO_INHG = 0.029529983071445;

const conversion = (displayUnit, scale, offset = 0) =>
  Object.freeze({ displayUnit, scale, offset });

/**
 * ArduPilot metadata uses exact unit tokens. Keep this list intentionally
 * explicit: an unknown or dimensionless token must remain controller-native
 * rather than being guessed from a parameter name.
 */
const IMPERIAL_CONVERSIONS = Object.freeze({
  m: conversion("ft", METERS_TO_FEET),
  cm: conversion("ft", CENTIMETERS_TO_FEET),
  mm: conversion("in", MILLIMETERS_TO_INCHES),
  km: conversion("mi", METERS_TO_MILES * 1000),
  "m/s": conversion("mph", METERS_PER_SECOND_TO_MILES_PER_HOUR),
  "cm/s": conversion("ft/s", CENTIMETERS_TO_FEET),
  "mm/s": conversion("in/s", MILLIMETERS_TO_INCHES),
  "km/h": conversion("mph", 0.621371192237334),
  "m/s/s": conversion("ft/s²", METERS_TO_FEET),
  "m/s^2": conversion("ft/s²", METERS_TO_FEET),
  "m/s²": conversion("ft/s²", METERS_TO_FEET),
  "cm/s/s": conversion("ft/s²", CENTIMETERS_TO_FEET),
  "cm/s^2": conversion("ft/s²", CENTIMETERS_TO_FEET),
  "cm/s²": conversion("ft/s²", CENTIMETERS_TO_FEET),
  "m^2": conversion("ft²", SQUARE_METERS_TO_SQUARE_FEET),
  "m²": conversion("ft²", SQUARE_METERS_TO_SQUARE_FEET),
  "m^3": conversion("ft³", CUBIC_METERS_TO_CUBIC_FEET),
  "m³": conversion("ft³", CUBIC_METERS_TO_CUBIC_FEET),
  l: conversion("US gal", LITERS_TO_US_GALLONS),
  liter: conversion("US gal", LITERS_TO_US_GALLONS),
  liters: conversion("US gal", LITERS_TO_US_GALLONS),
  kg: conversion("lb", KILOGRAMS_TO_POUNDS),
  g: conversion("oz", GRAMS_TO_OUNCES),
  pa: conversion("inHg", PASCALS_TO_INHG),
  kpa: conversion("psi", KILOPASCALS_TO_PSI),
  hpa: conversion("inHg", HECTOPASCALS_TO_INHG),
  degc: conversion("°F", 9 / 5, 32),
  "°c": conversion("°F", 9 / 5, 32),
});

function normalizedUnitToken(units) {
  return String(units ?? "").trim().toLowerCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedDisplayNumber(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  if (number === 0) return 0;
  return Number.parseFloat(number.toPrecision(10));
}

export function arduPilotUnitConversion(units, unitSystem) {
  const sourceUnit = String(units ?? "").trim();
  const normalizedSystem = normalizeGroundControlUnitSystem(unitSystem);
  const imperial = normalizedSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  const selected = imperial
    ? IMPERIAL_CONVERSIONS[normalizedUnitToken(sourceUnit)]
    : null;
  return Object.freeze({
    sourceUnit,
    displayUnit: selected?.displayUnit ?? sourceUnit,
    scale: selected?.scale ?? 1,
    offset: selected?.offset ?? 0,
    converted: Boolean(selected),
    unitSystem: normalizedSystem,
  });
}

export function toArduPilotDisplayValue(value, units, unitSystem) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const selected = arduPilotUnitConversion(units, unitSystem);
  return roundedDisplayNumber(number * selected.scale + selected.offset);
}

export function fromArduPilotDisplayValue(value, units, unitSystem) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const selected = arduPilotUnitConversion(units, unitSystem);
  return (number - selected.offset) / selected.scale;
}

export function toArduPilotDisplayIncrement(value, units, unitSystem) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const selected = arduPilotUnitConversion(units, unitSystem);
  return roundedDisplayNumber(Math.abs(number * selected.scale));
}

export function arduPilotDisplayMetadata(metadata = {}, unitSystem) {
  const selected = arduPilotUnitConversion(metadata.units, unitSystem);
  return {
    ...metadata,
    units: selected.displayUnit,
    min: toArduPilotDisplayValue(metadata.min, metadata.units, unitSystem),
    max: toArduPilotDisplayValue(metadata.max, metadata.units, unitSystem),
    increment: toArduPilotDisplayIncrement(
      metadata.increment,
      metadata.units,
      unitSystem,
    ),
    nativeUnits: selected.sourceUnit,
    convertedUnits: selected.converted,
  };
}

export function formatArduPilotDisplayNumber(value) {
  const number = roundedDisplayNumber(value);
  return number === null ? "" : String(number);
}

export { IMPERIAL_CONVERSIONS };
