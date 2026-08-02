import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  InavMavlinkCommandAdapter,
  InavMavlinkProfileStore,
  MavlinkCommandRouter,
} from "../../../js/gcs/mavlinkCommandRouter.js";
import { FLIGHT_COMMANDER_CAPABILITIES } from "../../../js/flightCommander/firmwareIdentity.js";

function fakeUnsupportedSession(overrides = {}) {
  const { state: stateOverrides = {}, ...methodOverrides } = overrides;
  const calls = [];
  const session = {
    state: {
      connected: true,
      linkLost: false,
      firmwareFamily: "unsupported",
      systemId: 1,
      componentId: 1,
      vehicleType: 2,
      vehicleTypeName: "Quadrotor",
      missionTotal: 3,
      ...stateOverrides,
    },
    availableModes: () =>
      ["STABILIZE", "AUTO", "GUIDED", "LOITER", "RTL", "LAND"].map(
        (name, number) => ({ name, number }),
      ),
    setMode: async (...args) => {
      calls.push(["setMode", ...args]);
      return { modeName: args[0] };
    },
    setArmed: async (...args) => {
      calls.push(["setArmed", ...args]);
      return { armed: args[0] };
    },
    startMission: async (...args) => {
      calls.push(["startMission", ...args]);
      return { result: 0 };
    },
    setMissionCurrent: async (...args) => {
      calls.push(["setMissionCurrent", ...args]);
      return { sequence: args[0] };
    },
    resumeMissionFrom: async (...args) => {
      calls.push(["resumeMissionFrom", ...args]);
      return { sequence: args[0] };
    },
    takeoff: async (...args) => {
      calls.push(["takeoff", ...args]);
      return { altitude: args[0] };
    },
    returnToLaunch: async (...args) => {
      calls.push(["returnToLaunch", ...args]);
      return { modeName: "RTL" };
    },
    land: async (...args) => {
      calls.push(["land", ...args]);
      return { modeName: "LAND" };
    },
    ...methodOverrides,
  };
  session.calls = calls;
  return session;
}

function inavProfile() {
  return {
    profileId: "test-profile",
    systemId: 9,
    receiverType: "SERIAL",
    serialRxProvider: "MAVLINK",
    mavlinkVersion: 2,
    rcMap: Array.from({ length: 18 }, (_unused, index) => index),
    modeRanges: [
      {
        id: 0,
        name: "ARM",
        auxChannelIndex: 0,
        rcChannelIndex: 4,
        range: { start: 1700, end: 2100 },
      },
      {
        id: 28,
        name: "NAV WP",
        auxChannelIndex: 1,
        rcChannelIndex: 5,
        range: { start: 1700, end: 2100 },
      },
      {
        id: 10,
        name: "NAV RTH",
        auxChannelIndex: 2,
        rcChannelIndex: 6,
        range: { start: 1700, end: 2100 },
      },
      {
        id: 11,
        name: "NAV POSHOLD",
        auxChannelIndex: 3,
        rcChannelIndex: 7,
        range: { start: 1700, end: 2100 },
      },
      {
        id: 36,
        name: "NAV LAUNCH",
        auxChannelIndex: 4,
        rcChannelIndex: 8,
        range: { start: 1700, end: 2100 },
      },
    ],
  };
}

describe("unsupported firmware command gates", () => {
  test("blocks every command for a parameter-capable non-INAV vehicle", () => {
    const session = fakeUnsupportedSession();
    const router = new MavlinkCommandRouter(session);
    const capabilities = router.capabilities();

    for (const capability of [
      "canSetMode",
      "canArm",
      "canStartMission",
      "canTakeoff",
      "canRtl",
      "canLand",
      "canHoldMission",
    ]) {
      assert.equal(capabilities[capability], false, capability);
    }
    assert.match(capabilities.reason, /ArduPilot support has been removed/);
    assert.deepEqual(router.availableModes(), []);
    assert.throws(() => router.setMode("GUIDED"), /support has been removed/);
    assert.throws(() => router.setArmed(true), /support has been removed/);
    assert.throws(() => router.startMission(), /support has been removed/);
    assert.throws(() => router.takeoff(12), /support has been removed/);
    assert.throws(() => router.returnToLaunch(), /support has been removed/);
    assert.throws(() => router.land(), /support has been removed/);
    assert.throws(() => router.holdMission(), /support has been removed/);
    assert.deepEqual(session.calls, []);
  });

  test("link loss remains the first failure for every firmware family", () => {
    const session = fakeUnsupportedSession({ state: { linkLost: true } });
    const router = new MavlinkCommandRouter(session);
    assert.equal(router.capabilities().canArm, false);
    assert.throws(() => router.setArmed(true), /link is lost/);
    assert.throws(() => router.returnToLaunch(), /link is lost/);
  });

  test("does not route commands until firmware family is known", () => {
    const session = fakeUnsupportedSession({
      state: { firmwareFamily: "unknown" },
    });
    const router = new MavlinkCommandRouter(session);
    assert.equal(router.capabilities().canSetMode, false);
    assert.throws(
      () => router.setMode("AUTO"),
      /Flight Commander Firmware is identified/,
    );
  });

  test("keeps all command controls disabled for official INAV", () => {
    const session = fakeUnsupportedSession({
      state: {
        firmwareFamily: "inav",
        systemId: 9,
      },
    });
    const router = new MavlinkCommandRouter(session, {
      profileStore: {
        resolve() {
          return {
            status: "resolved",
            profile: inavProfile(),
            profiles: [inavProfile()],
            reason: "",
          };
        },
      },
    });
    assert.equal(router.capabilities().canArm, false);
    assert.match(router.capabilities().reason, /disabled for official INAV/);
    assert.throws(() => router.setMode("NAV WP"), /disabled for official INAV/);
    assert.throws(() => router.setArmed(true), /disabled for official INAV/);
    assert.deepEqual(session.calls, []);
  });

  test("an application transition failure remains blocked after the transient block clears", () => {
    const session = fakeUnsupportedSession();
    const router = new MavlinkCommandRouter(session);

    router.blockCommands(
      "Ground Control transition failed; commands are disabled.",
    );
    assert.equal(session.state.connected, true);
    assert.equal(router.capabilities().canArm, false);
    assert.match(router.capabilities().reason, /commands are disabled/);
    assert.throws(
      () => router.setArmed(true),
      /commands are disabled/,
    );
    assert.deepEqual(session.calls, []);

    router.clearCommandBlock();
    assert.equal(router.capabilities().canArm, false);
    assert.match(router.capabilities().reason, /support has been removed/);
  });
});

describe("Flight Commander command routing", () => {
  test("default override timers retain the Chromium host receiver", () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const calls = [];

    try {
      globalThis.setInterval = function (callback, delay) {
        assert.equal(this, globalThis);
        calls.push(["set", delay]);
        return { callback, delay, unref() {} };
      };
      globalThis.clearInterval = function (handle) {
        assert.equal(this, globalThis);
        calls.push(["clear", handle.delay]);
      };

      const adapter = new InavMavlinkCommandAdapter(
        {
          state: { systemId: 9, componentId: 1 },
          async send() {
            return 1;
          },
        },
        inavProfile(),
      );
      assert.doesNotThrow(() => adapter.ensureOverrideLoop());
      assert.doesNotThrow(() => adapter.stop());
      assert.deepEqual(calls, [
        ["set", 125],
        ["clear", 125],
      ]);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("requires the firmware capability and a matching cached profile", async () => {
    const sent = [];
    const session = {
      state: {
        connected: true,
        linkLost: false,
        firmwareFamily: "flight-commander",
        flightCommanderCapabilities: FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS,
        systemId: 9,
        componentId: 1,
        protocolVersion: 2,
        armed: false,
        modeName: "STABILIZE",
        rcChannels: [],
      },
      snapshot() {
        return { ...this.state, rcChannels: [] };
      },
      async send(name, payload) {
        sent.push({ name, payload });
        return 1;
      },
      waitForState(predicate) {
        const next = {
          ...this.state,
          armed: true,
          modeName: "AUTO",
          rcChannels: [],
        };
        return predicate(next) ? Promise.resolve(next) : Promise.resolve(next);
      },
    };
    const profileStore = {
      resolve() {
        return {
          status: "resolved",
          profile: inavProfile(),
          profiles: [inavProfile()],
          reason: "",
        };
      },
    };
    const adapters = [];
    const router = new MavlinkCommandRouter(session, {
      profileStore,
      adapterFactory: (adapterSession, profile) => {
        const adapter = new InavMavlinkCommandAdapter(adapterSession, profile, {
          setIntervalFn: () => ({ unref() {} }),
          clearIntervalFn: () => {},
        });
        adapters.push(adapter);
        return adapter;
      },
    });

    assert.equal(router.capabilities().canArm, true);
    assert.equal(router.capabilities().canStartMission, true);
    assert.equal(router.capabilities().canTakeoff, true);
    assert.equal(router.capabilities().canLand, false);

    await router.startMission();
    assert.equal(sent.at(-1).name, "RcChannelsOverride");
    assert.equal(sent.at(-1).payload.chan6Raw, 1900);
    assert.throws(
      () => router.land(),
      /does not expose a generic Land command/,
    );

    router.stop();
    assert.equal(adapters.at(-1).commandStreamEnabled, false);
  });

  test("rejects mismatched and ambiguous profiles", () => {
    const session = {
      state: {
        connected: true,
        linkLost: false,
        firmwareFamily: "flight-commander",
        flightCommanderCapabilities: FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS,
        systemId: 9,
      },
    };
    const router = new MavlinkCommandRouter(session, {
      profileStore: {
        resolve() {
          return {
            status: "ambiguous",
            profile: null,
            profiles: [{}, {}],
            reason: "Multiple profiles use system ID 9.",
          };
        },
      },
    });
    assert.equal(router.capabilities().canSetMode, false);
    assert.throws(() => router.setMode("NAV WP"), /Multiple profiles/);
  });
});

describe("INAV profile persistence", () => {
  test("resolves one profile and reports ambiguity without silently choosing", () => {
    let stored;
    const storage = {
      get: (_key, fallback) => stored ?? fallback,
      set: (_key, value) => {
        stored = value;
      },
    };
    const store = new InavMavlinkProfileStore({ storage });
    store.save(inavProfile());
    assert.equal(store.resolve(9).status, "resolved");

    store.save({
      ...inavProfile(),
      profileId: "second-controller",
    });
    const ambiguous = store.resolve(9);
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.profile, null);
    assert.equal(ambiguous.profiles.length, 2);
  });

  test("captures the command-safe MSP profile fields used by MAVLink routing", async () => {
    let stored;
    const storage = {
      get: (_key, fallback) => stored ?? fallback,
      set: (_key, value) => {
        stored = value;
      },
    };
    const requestedCodes = [];
    const settings = {
      mavlink_sysid: { value: 23 },
      mavlink_version: { value: 2 },
      receiver_type: {
        value: 3,
        setting: { table: { values: { 3: "SERIAL" } } },
      },
      serialrx_provider: {
        value: 8,
        setting: { table: { values: { 8: "MAVLINK" } } },
      },
    };
    const store = new InavMavlinkProfileStore({
      storage,
      now: () => new Date("2026-07-29T12:00:00Z"),
    });

    const profile = await store.captureFromMsp({
      FC: {
        CONFIG: {
          uid: [1, 2, 3],
          name: "Survey aircraft",
          boardIdentifier: "DALRCF722DUAL",
        },
        MIXER_CONFIG: { platformType: 3 },
        RC_MAP: Array.from({ length: 18 }, (_unused, index) => index),
        RC: {
          active_channels: 8,
          channels: [1500, 1500, 1500, 1000, 1000, 1000, 1000, 1000],
        },
        MODE_RANGES: inavProfile().modeRanges,
        generateAuxConfig() {},
      },
      MSPCodes: {
        MSP_BOXIDS: 1,
        MSP_MODE_RANGES: 2,
        MSP_RX_MAP: 3,
        MSP_RC: 4,
      },
      mspHelper: {
        async getSetting(name) {
          return settings[name];
        },
      },
      async requestMsp(code) {
        requestedCodes.push(code);
        return {};
      },
    });

    assert.deepEqual(requestedCodes, [1, 2, 3, 4]);
    assert.equal(profile.systemId, 23);
    assert.equal(profile.receiverType, "SERIAL");
    assert.equal(profile.serialRxProvider, "MAVLINK");
    assert.equal(profile.profileId, "uid:1-2-3");
    assert.equal(
      profile.modeRanges.find(({ name }) => name === "NAV WP").rcChannelIndex,
      5,
    );
    assert.equal(store.resolve(23).status, "resolved");
  });
});
