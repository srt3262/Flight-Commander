"use strict";

export const INAV_PLANNING_FORMAT_VERSION = 1;
export const INAV_MAX_SAFEHOMES = 8;
export const INAV_MAX_FW_APPROACHES = 17;
export const INAV_MAX_MISSION_APPROACHES =
  INAV_MAX_FW_APPROACHES - INAV_MAX_SAFEHOMES;
export const INAV_MAX_GEOZONES = 63;
export const INAV_MAX_GEOZONE_VERTICES = 126;
export const INAV_MIN_RELATIVE_LANDING_ALTITUDE_CM = -2000;

export const GEOZONE_TYPES = Object.freeze({
  EXCLUSIVE: 0,
  INCLUSIVE: 1,
});
export const GEOZONE_SHAPES = Object.freeze({
  CIRCULAR: 0,
  POLYGON: 1,
});
export const GEOZONE_ACTIONS = Object.freeze({
  NONE: 0,
  AVOID: 1,
  POSHOLD: 2,
  RTH: 3,
});

export class InavPlanningValidationError extends Error {
  constructor(errors) {
    const normalized = Array.isArray(errors) ? errors : [String(errors)];
    super(normalized.join(" "));
    this.name = "InavPlanningValidationError";
    this.code = "INAV_PLANNING_VALIDATION_ERROR";
    this.errors = normalized;
  }
}

function defaultApproach(slot) {
  return {
    slot,
    approachAltitudeCm: 0,
    landingAltitudeCm: 0,
    direction: 0,
    heading1Deg: 0,
    heading2Deg: 0,
    seaLevelReference: false,
  };
}

export function createEmptyInavPlanningData() {
  return {
    version: INAV_PLANNING_FORMAT_VERSION,
    safehomes: [],
    approaches: Array.from({ length: INAV_MAX_FW_APPROACHES }, (_, slot) =>
      defaultApproach(slot),
    ),
    geozones: [],
  };
}

function finiteNumber(value, fallback = Number.NaN) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function normalizeApproach(approach, slot) {
  return {
    slot,
    approachAltitudeCm: finiteNumber(approach?.approachAltitudeCm, 0),
    landingAltitudeCm: finiteNumber(approach?.landingAltitudeCm, 0),
    direction: finiteNumber(approach?.direction, 0),
    heading1Deg: finiteNumber(approach?.heading1Deg, 0),
    heading2Deg: finiteNumber(approach?.heading2Deg, 0),
    seaLevelReference: !!approach?.seaLevelReference,
  };
}

function normalizeSafehome(safehome, number) {
  return {
    number,
    latitude: finiteNumber(safehome?.latitude),
    longitude: finiteNumber(safehome?.longitude),
  };
}

function normalizeVertex(vertex, number) {
  return {
    number,
    latitude: finiteNumber(vertex?.latitude),
    longitude: finiteNumber(vertex?.longitude),
  };
}

function normalizeGeozone(geozone, number) {
  const vertices = Array.isArray(geozone?.vertices)
    ? geozone.vertices.map(normalizeVertex)
    : [];
  return {
    number,
    type: finiteNumber(geozone?.type, GEOZONE_TYPES.INCLUSIVE),
    shape: finiteNumber(geozone?.shape, GEOZONE_SHAPES.CIRCULAR),
    minAltitudeCm: finiteNumber(geozone?.minAltitudeCm, 0),
    maxAltitudeCm: finiteNumber(geozone?.maxAltitudeCm, 10000),
    seaLevelReference: !!geozone?.seaLevelReference,
    radiusCm: finiteNumber(geozone?.radiusCm, 20000),
    action: finiteNumber(geozone?.action, GEOZONE_ACTIONS.NONE),
    vertices,
  };
}

export function normalizeInavPlanningData(planning = {}) {
  const approaches = Array.from({ length: INAV_MAX_FW_APPROACHES }, (_, slot) =>
    normalizeApproach(planning?.approaches?.[slot], slot),
  );
  return {
    version: INAV_PLANNING_FORMAT_VERSION,
    safehomes: Array.isArray(planning?.safehomes)
      ? planning.safehomes.map(normalizeSafehome)
      : [],
    approaches,
    geozones: Array.isArray(planning?.geozones)
      ? planning.geozones.map(normalizeGeozone)
      : [],
  };
}

function pushIntegerError(errors, value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function pushCoordinateErrors(errors, coordinate, label) {
  if (
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90
  ) {
    errors.push(`${label} latitude must be between -90 and 90 degrees.`);
  }
  if (
    !Number.isFinite(coordinate.longitude) ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180
  ) {
    errors.push(`${label} longitude must be between -180 and 180 degrees.`);
  }
}

export function approachIsConfigured(approach) {
  return !!(
    approach?.approachAltitudeCm ||
    approach?.landingAltitudeCm ||
    approach?.heading1Deg ||
    approach?.heading2Deg ||
    approach?.seaLevelReference ||
    approach?.direction
  );
}

function validateApproach(approach, label, errors) {
  pushIntegerError(
    errors,
    approach.approachAltitudeCm,
    -2147483648,
    2147483647,
    `${label} approach altitude`,
  );
  pushIntegerError(
    errors,
    approach.landingAltitudeCm,
    -2147483648,
    2147483647,
    `${label} landing altitude`,
  );
  pushIntegerError(errors, approach.direction, 0, 1, `${label} direction`);
  for (const [key, description] of [
    ["heading1Deg", "heading 1"],
    ["heading2Deg", "heading 2"],
  ]) {
    if (!Number.isInteger(approach[key]) || Math.abs(approach[key]) > 360) {
      errors.push(
        `${label} ${description} must be an integer from -360 to 360 degrees; ` +
          "negative values mark an exclusive heading.",
      );
    }
  }
  if (
    Number.isFinite(approach.approachAltitudeCm) &&
    Number.isFinite(approach.landingAltitudeCm) &&
    approach.approachAltitudeCm < approach.landingAltitudeCm
  ) {
    errors.push(
      `${label} approach altitude must not be below its landing altitude.`,
    );
  }
  if (!approach.seaLevelReference) {
    if (approach.approachAltitudeCm < 0) {
      errors.push(
        `${label} relative approach altitude cannot be below ground level.`,
      );
    }
    if (approach.landingAltitudeCm < INAV_MIN_RELATIVE_LANDING_ALTITUDE_CM) {
      errors.push(
        `${label} relative landing altitude cannot be below -2000 cm.`,
      );
    }
  }
}

export function collectSafehomeAndApproachErrors(planning) {
  const normalized = normalizeInavPlanningData(planning);
  const errors = [];
  if (normalized.safehomes.length > INAV_MAX_SAFEHOMES) {
    errors.push(`INAV supports at most ${INAV_MAX_SAFEHOMES} safe homes.`);
  }
  normalized.safehomes.forEach((safehome, index) => {
    pushCoordinateErrors(errors, safehome, `Safe home ${index + 1}`);
    validateApproach(
      normalized.approaches[index],
      `Safe home ${index + 1}`,
      errors,
    );
  });
  for (let mission = 0; mission < INAV_MAX_MISSION_APPROACHES; mission += 1) {
    const approach = normalized.approaches[INAV_MAX_SAFEHOMES + mission];
    if (approachIsConfigured(approach)) {
      validateApproach(
        approach,
        `Mission ${mission + 1} landing approach`,
        errors,
      );
    }
  }
  return errors;
}

function polygonSignedArea(vertices) {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const point = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    area += point.longitude * next.latitude - next.longitude * point.latitude;
  }
  return area / 2;
}

function orientation(left, middle, right) {
  const cross =
    (middle.longitude - left.longitude) * (right.latitude - left.latitude) -
    (middle.latitude - left.latitude) * (right.longitude - left.longitude);
  return Math.abs(cross) < 1e-12 ? 0 : cross > 0 ? 1 : -1;
}

function pointOnSegment(left, point, right) {
  return (
    point.longitude >= Math.min(left.longitude, right.longitude) &&
    point.longitude <= Math.max(left.longitude, right.longitude) &&
    point.latitude >= Math.min(left.latitude, right.latitude) &&
    point.latitude <= Math.max(left.latitude, right.latitude)
  );
}

function segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd) {
  const first = orientation(leftStart, leftEnd, rightStart);
  const second = orientation(leftStart, leftEnd, rightEnd);
  const third = orientation(rightStart, rightEnd, leftStart);
  const fourth = orientation(rightStart, rightEnd, leftEnd);
  if (first !== second && third !== fourth) return true;
  return (
    (first === 0 && pointOnSegment(leftStart, rightStart, leftEnd)) ||
    (second === 0 && pointOnSegment(leftStart, rightEnd, leftEnd)) ||
    (third === 0 && pointOnSegment(rightStart, leftStart, rightEnd)) ||
    (fourth === 0 && pointOnSegment(rightStart, leftEnd, rightEnd))
  );
}

function polygonIsComplex(vertices) {
  for (let first = 0; first < vertices.length; first += 1) {
    const firstEnd = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondEnd = (second + 1) % vertices.length;
      if (
        first !== second &&
        firstEnd !== second &&
        secondEnd !== first &&
        segmentsIntersect(
          vertices[first],
          vertices[firstEnd],
          vertices[second],
          vertices[secondEnd],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function geozoneVertexUsage(geozone) {
  return Number(geozone.shape) === GEOZONE_SHAPES.CIRCULAR
    ? 2
    : geozone.vertices.length;
}

export function collectGeozoneErrors(planning) {
  const normalized = normalizeInavPlanningData(planning);
  const errors = [];
  if (normalized.geozones.length > INAV_MAX_GEOZONES) {
    errors.push(`INAV supports at most ${INAV_MAX_GEOZONES} geozones.`);
  }
  const vertexUsage = normalized.geozones.reduce(
    (total, geozone) => total + geozoneVertexUsage(geozone),
    0,
  );
  if (vertexUsage > INAV_MAX_GEOZONE_VERTICES) {
    errors.push(
      `INAV geozones use ${vertexUsage} vertex slots; the controller limit is ` +
        `${INAV_MAX_GEOZONE_VERTICES}.`,
    );
  }
  normalized.geozones.forEach((geozone, index) => {
    const label = `Geozone ${index + 1}`;
    pushIntegerError(errors, geozone.type, 0, 1, `${label} type`);
    pushIntegerError(errors, geozone.shape, 0, 1, `${label} shape`);
    pushIntegerError(errors, geozone.action, 0, 3, `${label} action`);
    pushIntegerError(
      errors,
      geozone.minAltitudeCm,
      -2147483648,
      2147483647,
      `${label} minimum altitude`,
    );
    pushIntegerError(
      errors,
      geozone.maxAltitudeCm,
      -2147483648,
      2147483647,
      `${label} maximum altitude`,
    );
    if (
      geozone.maxAltitudeCm !== 0 &&
      geozone.maxAltitudeCm <= geozone.minAltitudeCm
    ) {
      errors.push(
        `${label} maximum altitude must exceed its minimum, or be 0 for unlimited.`,
      );
    }
    if (geozone.shape === GEOZONE_SHAPES.CIRCULAR) {
      if (geozone.vertices.length !== 1) {
        errors.push(
          `${label} circular shape requires exactly one center point.`,
        );
      }
      pushIntegerError(
        errors,
        geozone.radiusCm,
        1,
        2147483647,
        `${label} radius`,
      );
    } else if (geozone.shape === GEOZONE_SHAPES.POLYGON) {
      if (geozone.vertices.length < 3) {
        errors.push(`${label} polygon requires at least three vertices.`);
      } else {
        if (polygonSignedArea(geozone.vertices) <= 0) {
          errors.push(`${label} polygon vertices must be counter-clockwise.`);
        }
        if (polygonIsComplex(geozone.vertices)) {
          errors.push(`${label} polygon cannot cross itself.`);
        }
      }
    }
    geozone.vertices.forEach((vertex, vertexIndex) => {
      pushCoordinateErrors(
        errors,
        vertex,
        `${label} vertex ${vertexIndex + 1}`,
      );
    });
  });
  return errors;
}

export function assertSafehomesAndApproachesValid(planning) {
  const errors = collectSafehomeAndApproachErrors(planning);
  if (errors.length) throw new InavPlanningValidationError(errors);
  return normalizeInavPlanningData(planning);
}

export function assertGeozonesValid(planning) {
  const errors = collectGeozoneErrors(planning);
  if (errors.length) throw new InavPlanningValidationError(errors);
  return normalizeInavPlanningData(planning);
}

export function hasInavPlanningData(planning) {
  const normalized = normalizeInavPlanningData(planning);
  return !!(
    normalized.safehomes.length ||
    normalized.geozones.length ||
    normalized.approaches.some(approachIsConfigured)
  );
}

export function missionSegmentCount(mission) {
  if (!Array.isArray(mission) || mission.length === 0) return 1;
  let maximumSegment = 0;
  let boundaryCount = 0;
  for (const item of mission) {
    const segment = Number(item?.metadata?.inavMultiMissionIndex);
    if (Number.isInteger(segment) && segment >= 0) {
      maximumSegment = Math.max(maximumSegment, segment);
    }
    if (Number(item?.metadata?.inavEndMission) === 0xa5) {
      boundaryCount += 1;
    }
  }
  return Math.min(
    INAV_MAX_MISSION_APPROACHES,
    Math.max(1, maximumSegment + 1, boundaryCount),
  );
}
