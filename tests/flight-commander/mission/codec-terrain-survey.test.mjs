import assert from "node:assert/strict";
import test from "node:test";

import {
  INAV_END_MISSION,
  MAV_CMD_DO_JUMP,
  decodeInavMissionRecords,
  encodeInavMissionItems,
  reindexInavMissionItems,
} from "../../../js/mission/inavMissionCodec.js";
import {
  OpenTopoDataElevationProvider,
  applyTerrainFollowing,
} from "../../../js/mission/elevationProviders.js";
import {
  MAV_CMD_DO_SET_CAM_TRIGG_DIST,
  generateSurveyGrid,
  surveyGridToMission,
} from "../../../js/mission/surveyGrid.js";

function record({
  number,
  action = 1,
  latitudeE7 = 350000000,
  longitudeE7,
  altitudeCm = 6000,
  p1 = 0,
  p2 = 0,
  p3 = 0,
  endMission = 0,
}) {
  return {
    number,
    action,
    latitudeE7,
    longitudeE7,
    altitudeCm,
    p1,
    p2,
    p3,
    endMission,
  };
}

test("terrain insertion gives INAV samples fresh identities and remaps JUMP", async () => {
  const decoded = decodeInavMissionRecords([
    record({ number: 1, longitudeE7: -800000000 }),
    record({ number: 2, longitudeE7: -799990000, p3: 0b1011 }),
    record({ number: 3, longitudeE7: -799980000 }),
    record({ number: 4, longitudeE7: -799970000 }),
    record({
      number: 5,
      action: 6,
      longitudeE7: 0,
      latitudeE7: 0,
      p1: 2,
      p2: 1,
      endMission: INAV_END_MISSION,
    }),
    record({
      number: 6,
      longitudeE7: -810000000,
      latitudeE7: 360000000,
    }),
    record({
      number: 7,
      longitudeE7: -809990000,
      latitudeE7: 360000000,
      endMission: INAV_END_MISSION,
    }),
  ]);
  const provider = {
    attribution: "test terrain",
    async elevations(locations) {
      return locations.map((_, index) => 100 + index);
    },
  };

  const result = await applyTerrainFollowing(decoded, provider, {
    sampleSpacingM: 70,
    clearanceM: 50,
  });

  assert.equal(result.attribution, "test terrain");
  assert.ok(result.mission.length > decoded.length);
  assert.deepEqual(
    result.mission.map((item) => item.metadata.inavNumber),
    Array.from({ length: result.mission.length }, (_, index) => index + 1),
  );
  assert.deepEqual(
    [
      ...new Set(
        result.mission.map((item) => item.metadata.inavMultiMissionIndex),
      ),
    ],
    [0, 1],
  );

  const samples = result.mission.filter(
    (item) => item.metadata.kind === "terrain-sample",
  );
  assert.ok(samples.length >= 4);
  assert.ok(samples.every((item) => [0, 1].includes(item.param3)));
  assert.equal(samples[0].param3, 1);

  const jump = result.mission.find(
    (item) => Number(item.command) === MAV_CMD_DO_JUMP,
  );
  assert.ok(jump);
  assert.equal(jump.metadata.inavP1, 3);
  assert.equal(jump.param1, 2);

  const encoded = encodeInavMissionItems(result.mission);
  assert.deepEqual(
    encoded.map((item) => item.number),
    Array.from({ length: encoded.length }, (_, index) => index + 1),
  );
  assert.equal(encoded.find((item) => item.action === 6).p1, 3);
  assert.deepEqual(
    encoded
      .filter((item) => item.endMission === INAV_END_MISSION)
      .map((item) => item.multiMissionIndex),
    [0, 1],
  );
});

test("reindexing fails closed on duplicate INAV source identities", () => {
  const decoded = decodeInavMissionRecords([
    record({ number: 1, longitudeE7: -800000000 }),
    record({
      number: 2,
      longitudeE7: -799990000,
      endMission: INAV_END_MISSION,
    }),
  ]);
  decoded[1].metadata.inavNumber = 1;
  assert.throws(
    () => reindexInavMissionItems(decoded),
    /duplicate raw INAV item number 1/,
  );
});

test("built-in terrain keeps native fetch bound to globalThis", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function boundFetch() {
    assert.equal(this, globalThis);
    calls += 1;
    return Promise.resolve({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ elevation: 123 }],
      }),
    });
  };
  try {
    const provider = new OpenTopoDataElevationProvider({
      minRequestIntervalMs: 0,
      requestTimeoutMs: 1000,
      maxRetries: 0,
    });
    assert.deepEqual(
      await provider.elevations([{ latitude: 35, longitude: -80 }]),
      [123],
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("survey camera command 206 is explicit and optional", () => {
  const grid = generateSurveyGrid(
    [
      { latitude: 35, longitude: -80 },
      { latitude: 35, longitude: -79.998 },
      { latitude: 35.002, longitude: -79.998 },
      { latitude: 35.002, longitude: -80 },
    ],
    {
      lineSpacingM: 50,
      triggerDistanceM: 25,
    },
  );
  assert.ok(grid.lines.length > 0);
  assert.ok(grid.statistics.estimatedPhotos > 0);

  const ardupilot = surveyGridToMission(grid, {
    altitudeM: 60,
    triggerDistanceM: 25,
    includeCameraCommands: true,
  });
  const inav = surveyGridToMission(grid, {
    altitudeM: 60,
    triggerDistanceM: 25,
    includeCameraCommands: false,
  });
  assert.ok(
    ardupilot.some((item) => item.command === MAV_CMD_DO_SET_CAM_TRIGG_DIST),
  );
  assert.equal(
    inav.some((item) => item.command === MAV_CMD_DO_SET_CAM_TRIGG_DIST),
    false,
  );
});
