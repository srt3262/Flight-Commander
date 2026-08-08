import assert from "node:assert/strict";
import test from "node:test";

import { estimateInavMissionProgress } from "../../../js/gcs/inavMissionProgress.js";
import { MissionOperationCoordinator } from "../../../js/mission/missionOperationCoordinator.js";
import {
  bootClockElapsedMatches,
  fingerprintMission,
  inavResumeSuffix,
} from "../../../js/mission/missionResumeManager.js";
import {
  assertMissionReadback,
  compareMissionReadback,
  filterExpectedMissionForProtocol,
} from "../../../js/mission/missionVerification.js";

function waypoint(index, overrides = {}) {
  return {
    frame: 3,
    command: 16,
    current: index === 0,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    latitude: 35 + index * 0.001,
    longitude: -80 - index * 0.001,
    altitude: 60,
    ...overrides,
  };
}

test("protocol filter refuses camera command 206 and raw INAV loss over MAVLink", () => {
  assert.throws(
    () =>
      filterExpectedMissionForProtocol(
        [waypoint(0, { command: 206 })],
        "mavlink",
        { firmwareProfile: "inav" },
      ),
    /unsupported command 206/,
  );
  assert.throws(
    () =>
      filterExpectedMissionForProtocol(
        [
          waypoint(0, {
            metadata: {
              inavAction: 1,
              inavP1: 0,
            },
          }),
        ],
        "mavlink",
        { firmwareProfile: "inav" },
      ),
    /raw INAV metadata/,
  );
});

test("Flight Commander preserves command 206 over MAVLink and native MSP action 9", () => {
  const photo = waypoint(0, {
    frame: 2,
    command: 206,
    param1: 12.345,
    latitude: 35,
    longitude: -80,
    altitude: 60,
  });
  const mavlink = filterExpectedMissionForProtocol([photo], "mavlink", {
    firmwareProfile: "flight-commander",
  });
  assert.equal(mavlink[0].command, 206);
  assert.equal(mavlink[0].frame, 2);
  assert.equal(mavlink[0].param1, 12.35);
  assert.equal(mavlink[0].latitude, 0);
  assert.equal(mavlink[0].longitude, 0);
  assert.equal(mavlink[0].altitude, 0);

  const msp = filterExpectedMissionForProtocol([photo], "msp", {
    firmwareProfile: "flight-commander",
  });
  assert.equal(msp[0].command, 206);
  assert.equal(msp[0].frame, 2);
  assert.equal(msp[0].param1, 12.35);
  assert.equal(msp[0].metadata.inavAction, 9);
  assert.equal(msp[0].metadata.inavP1, 1235);

  assert.throws(
    () =>
      filterExpectedMissionForProtocol([photo], "msp", {
        firmwareProfile: "inav",
      }),
    /Flight Commander extension/,
  );
});

test("Flight Commander preserves absolute-MSL terrain waypoint frames", () => {
  const absolute = waypoint(0, {
    frame: 5,
    altitude: 412.75,
    metadata: {
      terrainElevationM: 352.75,
      terrainClearanceM: 60,
    },
  });
  const flightCommander = filterExpectedMissionForProtocol(
    [absolute],
    "mavlink",
    { firmwareProfile: "flight-commander" },
  );
  assert.equal(flightCommander[0].frame, 0);
  assert.equal(flightCommander[0].altitude, 412.75);

  assert.throws(
    () =>
      filterExpectedMissionForProtocol([absolute], "mavlink", {
        firmwareProfile: "inav",
      }),
    /requires frame 3 or 6/,
  );
});

test("mission verification checks canonical INAV coordinates", () => {
  const expected = [waypoint(0), waypoint(1)];
  const actual = structuredClone(expected);
  actual[1].latitude += 0.001;
  const mismatch = compareMissionReadback(expected, actual);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /latitude mismatch/);
  assert.throws(
    () => assertMissionReadback(expected, actual),
    /Mission readback verification failed/,
  );
});

test("INAV progress estimate advances monotonically and recognizes final RTL", () => {
  const mission = [
    waypoint(0),
    waypoint(1),
    waypoint(2, {
      frame: 2,
      command: 20,
      latitude: 0,
      longitude: 0,
      altitude: 0,
    }),
  ];
  const first = estimateInavMissionProgress({
    mission,
    latitude: mission[0].latitude,
    longitude: mission[0].longitude,
    modeName: "NAV_WP",
    reachedDistanceM: 30,
  });
  assert.equal(first.missionCurrent, 1);
  const final = estimateInavMissionProgress({
    mission,
    latitude: mission[1].latitude,
    longitude: mission[1].longitude,
    modeName: "NAV WP",
    previousIndex: first.missionCurrent,
    reachedDistanceM: 30,
  });
  assert.equal(final.missionCurrent, 2);
  assert.equal(final.distanceToWaypoint, null);
});

test("mission coordinator releases an attachment-scoped lease on abort", () => {
  const coordinator = new MissionOperationCoordinator();
  const controller = new AbortController();
  const operation = coordinator.acquire("Ground Control mission download", {
    signal: controller.signal,
  });

  assert.equal(coordinator.isBusy(), true);
  controller.abort();
  assert.equal(coordinator.isBusy(), false);
  assert.equal(operation.release(), false);
  assert.ok(coordinator.acquire("new attachment mission download"));
});

test("mission fingerprint is stable across metadata-only changes", () => {
  const left = [waypoint(0, { metadata: { source: "one" } })];
  const right = [waypoint(0, { metadata: { source: "two" } })];
  assert.equal(fingerprintMission(left), fingerprintMission(right));
  right[0].altitude = 61;
  assert.notEqual(fingerprintMission(left), fingerprintMission(right));
});

test("boot continuity supports clock wrap and rejects a reboot", () => {
  assert.equal(bootClockElapsedMatches(4294967000, 1000, 704, 2000), true);
  assert.equal(bootClockElapsedMatches(100000, 1000, 500, 2000), false);
});

test("INAV resume suffix accepts only waypoints and optional final RTL", () => {
  const mission = [
    waypoint(0),
    waypoint(1),
    waypoint(2, {
      frame: 2,
      command: 20,
      latitude: 0,
      longitude: 0,
      altitude: 0,
    }),
  ];
  assert.equal(inavResumeSuffix(mission, 1).length, 2);
  assert.equal(
    inavResumeSuffix([waypoint(0), waypoint(1, { command: 206 })], 0),
    null,
  );
});
