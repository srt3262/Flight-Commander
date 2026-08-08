"use strict";

const EARTH_RADIUS_M = 6378137;

export const MAV_CMD_NAV_WAYPOINT = 16;
export const MAV_CMD_DO_SET_CAM_TRIGG_DIST = 206;
export const MAV_FRAME_MISSION = 2;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;

export function normalizeCoordinate(coordinate) {
  return Array.isArray(coordinate)
    ? { longitude: Number(coordinate[0]), latitude: Number(coordinate[1]) }
    : {
        longitude: Number(coordinate?.longitude ?? coordinate?.lon),
        latitude: Number(coordinate?.latitude ?? coordinate?.lat),
      };
}

function assertPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("A survey polygon needs at least three vertices.");
  }
  const normalized = polygon.map(normalizeCoordinate);
  if (
    normalized.some(
      ({ latitude, longitude }) =>
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180,
    )
  ) {
    throw new Error(
      "The survey polygon contains an invalid latitude or longitude.",
    );
  }
  return normalized;
}

function createLocalProjection(polygon) {
  const normalized = assertPolygon(polygon);
  const latitude =
    normalized.reduce((sum, point) => sum + point.latitude, 0) /
    normalized.length;
  const longitude =
    normalized.reduce((sum, point) => sum + point.longitude, 0) /
    normalized.length;
  const cosine = Math.max(1e-9, Math.cos((latitude * Math.PI) / 180));
  return {
    reference: { latitude, longitude },
    toLocal(value) {
      const point = normalizeCoordinate(value);
      return {
        x:
          (((point.longitude - longitude) * Math.PI) / 180) *
          EARTH_RADIUS_M *
          cosine,
        y: (((point.latitude - latitude) * Math.PI) / 180) * EARTH_RADIUS_M,
      };
    },
    toGeographic(value) {
      return {
        latitude: latitude + ((value.y / EARTH_RADIUS_M) * 180) / Math.PI,
        longitude:
          longitude + ((value.x / (EARTH_RADIUS_M * cosine)) * 180) / Math.PI,
      };
    },
  };
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return Math.abs(area) / 2;
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function intersectScanline(points, scanline) {
  const intersections = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const delta = next.v - point.v;
    if (
      Math.abs(delta) < 1e-9 ||
      !(
        (point.v <= scanline && next.v > scanline) ||
        (next.v <= scanline && point.v > scanline)
      )
    ) {
      continue;
    }
    const ratio = (scanline - point.v) / delta;
    intersections.push(point.u + ratio * (next.u - point.u));
  }
  intersections.sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    if (intersections[index + 1] - intersections[index] > 1e-9) {
      segments.push({
        uStart: intersections[index],
        uEnd: intersections[index + 1],
      });
    }
  }
  return segments;
}

function normalizeAngle(value) {
  return ((Number(value) % 360) + 360) % 360;
}

export function generateSurveyGrid(polygon, options = {}) {
  const {
    angleDeg = 0,
    lineSpacingM = 25,
    overshootM = 0,
    turnaroundM = 0,
    triggerDistanceM = 0,
  } = options;
  const spacing = Number(lineSpacingM);
  const overshoot = Math.max(0, Number(overshootM));
  const turnaround = Math.max(0, Number(turnaroundM));
  const triggerDistance = Math.max(0, Number(triggerDistanceM));
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new Error("Survey line spacing must be greater than zero.");
  }
  if (![overshoot, turnaround, triggerDistance].every(Number.isFinite)) {
    throw new Error("Survey distances must be finite numbers.");
  }

  const geographic = assertPolygon(polygon);
  const projection = createLocalProjection(geographic);
  const local = geographic.map((point) => projection.toLocal(point));
  const areaM2 = polygonArea(local);
  if (areaM2 < 1)
    throw new Error("The survey polygon is too small to generate a grid.");

  const angle = normalizeAngle(angleDeg);
  const radians = (angle * Math.PI) / 180;
  const lineAxis = { x: Math.sin(radians), y: Math.cos(radians) };
  const scanAxis = { x: Math.cos(radians), y: -Math.sin(radians) };
  const toAxes = ({ x, y }) => ({
    u: x * lineAxis.x + y * lineAxis.y,
    v: x * scanAxis.x + y * scanAxis.y,
  });
  const fromAxes = ({ u, v }) => ({
    x: u * lineAxis.x + v * scanAxis.x,
    y: u * lineAxis.y + v * scanAxis.y,
  });
  const rotated = local.map(toAxes);
  const minimum = Math.min(...rotated.map(({ v }) => v));
  const extent = Math.max(...rotated.map(({ v }) => v)) - minimum;
  const lineCount = Math.max(1, Math.ceil(extent / spacing));
  const actualSpacing = extent / lineCount;
  const scanlines = Array.from(
    { length: lineCount },
    (_, index) => minimum + actualSpacing * (index + 0.5),
  );

  const lines = [];
  const waypoints = [];
  let captureDistanceM = 0;
  for (let lineIndex = 0; lineIndex < scanlines.length; lineIndex += 1) {
    const scanline = scanlines[lineIndex];
    const intersections = intersectScanline(rotated, scanline);
    const forward = lineIndex % 2 === 0;
    const ordered = forward ? intersections : [...intersections].reverse();
    for (
      let segmentIndex = 0;
      segmentIndex < ordered.length;
      segmentIndex += 1
    ) {
      const segment = ordered[segmentIndex];
      const start = forward ? segment.uStart : segment.uEnd;
      const end = forward ? segment.uEnd : segment.uStart;
      const direction = Math.sign(end - start) || 1;
      const lineStart = start - direction * overshoot;
      const lineEnd = end + direction * overshoot;
      const turnEntry = lineStart - direction * turnaround;
      const turnExit = lineEnd + direction * turnaround;
      const points = [];
      if (turnaround > 0)
        points.push({ u: turnEntry, v: scanline, kind: "turn-entry" });
      points.push({ u: lineStart, v: scanline, kind: "line-start" });
      points.push({ u: lineEnd, v: scanline, kind: "line-end" });
      if (turnaround > 0)
        points.push({ u: turnExit, v: scanline, kind: "turn-exit" });

      const resolved = points.map((point) => {
        const localPoint = fromAxes(point);
        return {
          ...projection.toGeographic(localPoint),
          local: localPoint,
          lineIndex,
          segmentIndex,
          kind: point.kind,
        };
      });
      waypoints.push(...resolved);
      const line = {
        lineIndex,
        segmentIndex,
        forward,
        points: resolved,
        captureStart: resolved.find(({ kind }) => kind === "line-start"),
        captureEnd: resolved.find(({ kind }) => kind === "line-end"),
      };
      line.captureDistanceM = distance(
        line.captureStart.local,
        line.captureEnd.local,
      );
      captureDistanceM += line.captureDistanceM;
      lines.push(line);
    }
  }
  if (!lines.length)
    throw new Error("No flight lines intersect the survey polygon.");

  let routeDistanceM = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    routeDistanceM += distance(
      waypoints[index - 1].local,
      waypoints[index].local,
    );
  }

  return {
    polygon: geographic,
    reference: projection.reference,
    angleDeg: angle,
    requestedSpacingM: spacing,
    actualSpacingM: actualSpacing,
    options: {
      overshootM: overshoot,
      turnaroundM: turnaround,
      triggerDistanceM: triggerDistance,
    },
    lines,
    waypoints,
    statistics: {
      areaM2,
      routeDistanceM,
      captureDistanceM,
      lineCount: scanlines.length,
      segmentCount: lines.length,
      waypointCount: waypoints.length,
      estimatedPhotos:
        triggerDistance > 0
          ? lines.reduce(
              (total, line) =>
                total +
                Math.max(1, Math.ceil(line.captureDistanceM / triggerDistance)),
              0,
            )
          : 0,
    },
  };
}

function navWaypoint(point, altitude, options = {}) {
  return {
    frame: options.frame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
    command: MAV_CMD_NAV_WAYPOINT,
    autocontinue: true,
    param1: options.holdTimeS ?? 0,
    param2: options.acceptanceRadiusM ?? 0,
    param3: options.passRadiusM ?? 0,
    param4: options.yawDeg ?? Number.NaN,
    latitude: point.latitude,
    longitude: point.longitude,
    altitude,
    metadata: {
      kind: point.kind,
      lineIndex: point.lineIndex,
      segmentIndex: point.segmentIndex,
    },
  };
}

function cameraTriggerCommand(distanceM, point, altitude, options = {}) {
  return {
    frame: MAV_FRAME_MISSION,
    command: MAV_CMD_DO_SET_CAM_TRIGG_DIST,
    autocontinue: true,
    param1: distanceM,
    param2: 0,
    param3: 0,
    param4: 0,
    latitude: point.latitude,
    longitude: point.longitude,
    altitude,
    metadata: {
      kind: distanceM > 0 ? "camera-trigger-start" : "camera-trigger-stop",
      lineIndex: point.lineIndex,
      segmentIndex: point.segmentIndex,
    },
  };
}

export function surveyGridToMission(grid, options = {}) {
  const {
    altitudeM = 60,
    triggerDistanceM = grid.options?.triggerDistanceM ?? 0,
    includeCameraCommands = triggerDistanceM > 0,
  } = options;
  const altitude = Number(altitudeM);
  const triggerDistance = Math.max(0, Number(triggerDistanceM));
  if (!Number.isFinite(altitude)) {
    throw new Error("Survey altitude must be a finite number.");
  }
  const mission = [];
  for (const line of grid.lines) {
    for (const point of line.points) {
      mission.push(navWaypoint(point, altitude, options));
      if (
        includeCameraCommands &&
        triggerDistance > 0 &&
        point.kind === "line-start"
      ) {
        mission.push(
          cameraTriggerCommand(triggerDistance, point, altitude, options),
        );
      }
      if (
        includeCameraCommands &&
        triggerDistance > 0 &&
        point.kind === "line-end"
      ) {
        mission.push(cameraTriggerCommand(0, point, altitude, options));
      }
    }
  }
  return mission;
}
