import assert from "node:assert/strict";
import test from "node:test";

import {
  ARDUPILOT_SPEED_COMMAND_CONFLICT,
  MAV_CMD_DO_CHANGE_SPEED,
  compileArduPilotMission,
  compileInavMspMission,
  deriveArduPilotMissionBehavior,
} from "../../../js/mission/missionBehavior.js";
import {
  parseFlightPlan,
  serializeFlightPlan,
  serializeQgcWpl,
} from "../../../js/mission/flightPlanFiles.js";
import {
  GEOZONE_SHAPES,
  collectGeozoneErrors,
  collectSafehomeAndApproachErrors,
  createEmptyInavPlanningData,
  geozoneVertexUsage,
  missionSegmentCount,
} from "../../../js/mission/inavPlanningModel.js";

function waypoint(index, overrides = {}) {
  return {
    frame: 6,
    command: 16,
    current: index === 0,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: Number.NaN,
    latitude: 35 + index * 0.001,
    longitude: -80 - index * 0.001,
    altitude: 60,
    ...overrides,
  };
}

test("ArduPilot speed and completion compile canonically without duplication", () => {
  const original = [waypoint(0), waypoint(1)];
  const compiled = compileArduPilotMission(original, {
    cruiseSpeedMps: 14.5,
    completionAction: "rtl",
  });
  assert.deepEqual(
    compiled.map((item) => item.command),
    [16, MAV_CMD_DO_CHANGE_SPEED, 16, 20],
  );
  assert.equal(compiled[1].param2, 14.5);
  assert.equal(original.length, 2);

  const derived = deriveArduPilotMissionBehavior(compiled);
  assert.deepEqual(derived.behavior, {
    cruiseSpeedMps: 14.5,
    completionAction: "rtl",
  });
  assert.equal(derived.conflicts.length, 0);

  const updated = compileArduPilotMission(compiled, {
    cruiseSpeedMps: 18,
    completionAction: "rtl",
  });
  assert.equal(
    updated.filter((item) => item.command === MAV_CMD_DO_CHANGE_SPEED).length,
    1,
  );
  assert.equal(updated[1].param2, 18);
});

test("custom ArduPilot speed commands are preserved or rejected, never flattened", () => {
  const custom = [
    waypoint(0),
    {
      frame: 2,
      command: MAV_CMD_DO_CHANGE_SPEED,
      autocontinue: true,
      param1: 0,
      param2: 9,
      param3: -1,
      param4: 0,
      latitude: 0,
      longitude: 0,
      altitude: 0,
    },
    waypoint(1),
  ];
  assert.deepEqual(
    compileArduPilotMission(custom, {
      cruiseSpeedMps: 0,
      completionAction: "none",
    }),
    custom,
  );
  assert.throws(
    () =>
      compileArduPilotMission(custom, {
        cruiseSpeedMps: 12,
        completionAction: "none",
      }),
    (error) => error.code === ARDUPILOT_SPEED_COMMAND_CONFLICT,
  );
});

test("INAV MSP behavior returns native speed and terminal action", () => {
  const compiled = compileInavMspMission([waypoint(0), waypoint(1)], {
    cruiseSpeedMps: 8.75,
    completionAction: "land",
  });
  assert.equal(compiled.speedCmS, 875);
  assert.deepEqual(
    compiled.mission.map((item) => item.command),
    [16, 16, 21],
  );
});

test("Flight Commander JSON round trip preserves metadata and settings", () => {
  const plan = {
    mission: [
      waypoint(0, {
        metadata: {
          inavAction: 1,
          inavP1: 600,
          inavP2: 0,
          inavP3: 0,
          inavEndMission: 165,
          inavMultiMissionIndex: 0,
        },
      }),
    ],
    polygon: [{ latitude: 35, longitude: -80 }],
    settings: { cruiseSpeedMps: 6 },
  };
  const serialized = serializeFlightPlan(plan);
  const parsed = parseFlightPlan(serialized);
  assert.equal(parsed.format, "flight-commander-flight-plan");
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.mission, [{ ...plan.mission[0], param4: null }]);
  assert.deepEqual(parsed.settings, plan.settings);
});

test("QGC WPL validates sequence, JUMP targets, and INAV boundaries", () => {
  const text = [
    "QGC WPL 110",
    "1\t0\t6\t16\t0\t0\t0\t0\t35.1\t-80.1\t60\t1",
    "0\t1\t6\t16\t0\t0\t0\t0\t35\t-80\t60\t1",
    "2\t0\t2\t177\t0\t2\t0\t0\t0\t0\t0\t1",
  ].join("\n");
  const parsed = parseFlightPlan(text);
  assert.equal(parsed.mission[0].latitude, 35);
  assert.equal(parsed.mission[2].command, 177);

  assert.throws(
    () => parseFlightPlan(text.replace("2\t0\t2\t177\t0", "2\t0\t2\t177\t9")),
    /invalid DO_JUMP target 9/,
  );

  assert.throws(
    () =>
      serializeQgcWpl([
        waypoint(0, {
          metadata: {
            inavAction: 1,
            inavP1: 0,
            inavP2: 0,
            inavP3: 0,
            inavEndMission: 165,
            inavMultiMissionIndex: 0,
          },
        }),
        waypoint(1, {
          metadata: {
            inavAction: 1,
            inavP1: 0,
            inavP2: 0,
            inavP3: 0,
            inavEndMission: 165,
            inavMultiMissionIndex: 1,
          },
        }),
      ]),
    /cannot preserve INAV multi-mission boundaries|internal multi-mission boundary/,
  );
});

test("INAV planning model enforces safehome, approach, and geozone limits", () => {
  const planning = createEmptyInavPlanningData();
  planning.safehomes.push({ latitude: 91, longitude: -80 });
  planning.approaches[0] = {
    approachAltitudeCm: -100,
    landingAltitudeCm: -3000,
    direction: 2,
    heading1Deg: 361,
    heading2Deg: 0,
    seaLevelReference: false,
  };
  const safehomeErrors = collectSafehomeAndApproachErrors(planning);
  assert.ok(safehomeErrors.some((error) => /latitude/.test(error)));
  assert.ok(safehomeErrors.some((error) => /direction/.test(error)));
  assert.ok(safehomeErrors.some((error) => /below -2000/.test(error)));

  const circular = {
    shape: GEOZONE_SHAPES.CIRCULAR,
    type: 1,
    action: 0,
    minAltitudeCm: 0,
    maxAltitudeCm: 10000,
    radiusCm: 20000,
    vertices: [{ latitude: 35, longitude: -80 }],
  };
  const polygon = {
    shape: GEOZONE_SHAPES.POLYGON,
    type: 1,
    action: 0,
    minAltitudeCm: 0,
    maxAltitudeCm: 10000,
    radiusCm: 0,
    vertices: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 0 },
    ],
  };
  assert.equal(geozoneVertexUsage(circular), 2);
  assert.equal(geozoneVertexUsage(polygon), 4);
  assert.deepEqual(collectGeozoneErrors({ geozones: [circular, polygon] }), []);

  const crossing = {
    ...polygon,
    vertices: [
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 0 },
    ],
  };
  assert.ok(
    collectGeozoneErrors({ geozones: [crossing] }).some((error) =>
      /cross itself/.test(error),
    ),
  );
});

test("mission segment count follows raw INAV boundaries", () => {
  assert.equal(missionSegmentCount([]), 1);
  assert.equal(
    missionSegmentCount([
      { metadata: { inavMultiMissionIndex: 0, inavEndMission: 165 } },
      { metadata: { inavMultiMissionIndex: 1, inavEndMission: 165 } },
    ]),
    2,
  );
});
