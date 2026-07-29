import assert from "node:assert/strict";
import test from "node:test";

import { estimateInavMissionProgress } from "../../../js/gcs/inavMissionProgress.js";
import { MissionOperationCoordinator } from "../../../js/mission/missionOperationCoordinator.js";
import {
  MissionResumeManager,
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

function fakeSession(initialState) {
  return {
    state: { ...initialState },
    snapshot() {
      return { ...this.state };
    },
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

test("mission verification checks canonical speed values and coordinates", () => {
  const expected = [
    waypoint(0),
    {
      frame: 2,
      command: 178,
      autocontinue: true,
      param1: 1,
      param2: 12.5,
      param3: -1,
      param4: 0,
      latitude: 0,
      longitude: 0,
      altitude: 0,
    },
  ];
  const actual = structuredClone(expected);
  actual[1].param2 = 12.7;
  const mismatch = compareMissionReadback(expected, actual);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /param2 mismatch/);
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

test("ArduPilot resume rechecks MIS_RESTART and blocks restart policy", async () => {
  let now = 1000;
  const mission = [waypoint(0), waypoint(1), waypoint(2)];
  const session = fakeSession({
    connected: true,
    linkLost: false,
    systemId: 7,
    firmwareFamily: "ardupilot",
    bootGeneration: 0,
    timeBootMs: 100000,
    missionTotal: mission.length,
    missionCurrent: 1,
    missionState: 3,
    modeName: "AUTO",
    armed: true,
  });
  let resumeCommands = 0;
  const manager = new MissionResumeManager({
    session,
    commandRouter: {
      capabilities: () => ({ canResumeMission: true }),
      resumeMissionFrom: async () => {
        resumeCommands += 1;
        return { confirmed: true };
      },
    },
    missionManager: {
      download: async () => structuredClone(mission),
    },
    parameterManager: {
      request: async () => ({ value: 1, type: 6 }),
    },
    operationCoordinator: new MissionOperationCoordinator(),
    now: () => now,
  });
  manager.registerMission(mission, { state: session.snapshot() });
  now = 2000;
  session.state = {
    ...session.state,
    modeName: "RTL",
    timeBootMs: 101000,
  };
  manager.captureTransitionCheckpoint({
    state: {
      ...session.state,
      modeName: "AUTO",
      timeBootMs: 100000,
    },
    returnState: session.snapshot(),
    stateObservedAt: 1000,
    returnStateObservedAt: 2000,
    sequence: 1,
    estimated: false,
    source: "test",
  });
  manager.observeMissionCurrentConfirmation({
    header: { payloadLength: 5 },
    data: { seq: 1, missionState: 3 },
  });
  now = 3000;
  session.state.timeBootMs = 102000;

  await assert.rejects(
    manager.resume(),
    (error) => error.code === "ARDUPILOT_MIS_RESTART_RESTART",
  );
  assert.equal(resumeCommands, 0);
  assert.equal(manager.getCheckpoint()?.sequence, 1);
  manager.destroy();
});

test("ArduPilot exact resume succeeds only after mission readback matches", async () => {
  let now = 1000;
  const mission = [waypoint(0), waypoint(1), waypoint(2)];
  const session = fakeSession({
    connected: true,
    linkLost: false,
    systemId: 8,
    firmwareFamily: "ardupilot",
    bootGeneration: 0,
    timeBootMs: 200000,
    missionTotal: mission.length,
    missionCurrent: 1,
    missionState: 3,
    modeName: "AUTO",
    armed: false,
  });
  let selectedSequence = null;
  const manager = new MissionResumeManager({
    session,
    commandRouter: {
      capabilities: () => ({ canResumeMission: true }),
      resumeMissionFrom: async (sequence) => {
        selectedSequence = sequence;
        return { confirmed: true };
      },
    },
    missionManager: {
      download: async () => structuredClone(mission),
    },
    parameterManager: {
      request: async () => ({ value: 0, type: 6 }),
    },
    operationCoordinator: new MissionOperationCoordinator(),
    now: () => now,
  });
  manager.registerMission(mission, { state: session.snapshot() });
  now = 2000;
  session.state = {
    ...session.state,
    modeName: "RTL",
    timeBootMs: 201000,
  };
  manager.captureTransitionCheckpoint({
    state: {
      ...session.state,
      modeName: "AUTO",
      timeBootMs: 200000,
    },
    returnState: session.snapshot(),
    stateObservedAt: 1000,
    returnStateObservedAt: 2000,
    sequence: 1,
    estimated: false,
    source: "test",
  });
  manager.observeMissionCurrentConfirmation({
    header: { payloadLength: 5 },
    data: { seq: 1, missionState: 3 },
  });
  now = 3000;
  session.state.timeBootMs = 202000;

  const result = await manager.resume();
  assert.equal(selectedSequence, 1);
  assert.equal(result.exact, true);
  assert.equal(result.executionPending, true);
  assert.equal(manager.getCheckpoint(), null);
  manager.destroy();
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
