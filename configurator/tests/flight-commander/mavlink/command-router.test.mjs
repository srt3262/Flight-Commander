import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FlightCommanderMavlinkCommandAdapter,
  InavMavlinkCommandAdapter,
  MavlinkCommandRouter,
} from "../../../js/gcs/mavlinkCommandRouter.js";

function nativeSession(stateOverrides = {}) {
  const calls = [];
  const modeByPermanentId = new Map([
    [1, "STABILIZE"],
    [2, "STABILIZE"],
    [3, "ALT_HOLD"],
    [10, "RTL"],
    [11, "GUIDED"],
    [12, "MANUAL"],
    [28, "AUTO"],
    [36, "TAKEOFF"],
  ]);
  const session = {
    state: {
      connected: true,
      linkLost: false,
      firmwareFamily: "flight-commander",
      systemId: 9,
      componentId: 1,
      vehicleType: 2,
      vehicleTypeName: "Quadrotor",
      armed: true,
      gcsNavEnabled: true,
      baseMode: 8 | 128,
      modeName: "GUIDED",
      missionTotal: 3,
      rcChannels: [],
      ...stateOverrides,
    },
    snapshot() {
      return { ...this.state, rcChannels: [...this.state.rcChannels] };
    },
    async sendCommandLong(command, parameters, options) {
      calls.push({ command, parameters, options });
      switch (command) {
        case 176:
          this.state.modeName =
            modeByPermanentId.get(Number(parameters.param2)) ??
            this.state.modeName;
          break;
        case 400:
          this.state.armed = Number(parameters.param1) === 1;
          break;
        case 300:
          if (this.state.armed) this.state.modeName = "AUTO";
          break;
        case 193:
          this.state.modeName =
            Number(parameters.param1) === 0 ? "GUIDED" : "AUTO";
          break;
        case 20:
          this.state.modeName = "RTL";
          break;
        case 21:
          this.state.modeName = "LAND";
          break;
        case 22:
          this.state.modeName =
            this.state.vehicleType === 1 ? "TAKEOFF" : "GUIDED";
          break;
        default:
          break;
      }
      return { command, result: 0 };
    },
    waitForState(predicate, _timeout, description) {
      const state = this.snapshot();
      if (!predicate(state)) {
        return Promise.reject(
          new Error(`Test state did not satisfy ${description}.`),
        );
      }
      return Promise.resolve(state);
    },
  };
  session.calls = calls;
  return session;
}

describe("Flight Commander product-policy command access", () => {
  function policyRouter(firmwareFamily = "unsupported") {
    const session = nativeSession({ firmwareFamily });
    const adapter = {
      capabilities: () => ({
        canSetMode: true,
        canArm: true,
        canStartMission: true,
        canResumeMission: true,
      }),
      availableModes: () => ["NAV WP"],
      setMode: () => "mode-routed",
      setArmed: () => "arm-routed",
      stop() {},
    };
    return {
      session,
      router: new MavlinkCommandRouter(session, {
        adapterFactory: () => adapter,
      }),
    };
  }

  test("firmware-family metadata never disables commands", () => {
    for (const family of ["unsupported", "unknown", "inav", "flight-commander"]) {
      const { router } = policyRouter(family);
      assert.equal(router.capabilities().canArm, true, family);
      assert.deepEqual(router.availableModes(), ["NAV WP"]);
      assert.equal(router.setMode("NAV WP"), "mode-routed");
      assert.equal(router.setArmed(true), "arm-routed");
    }
  });

  test("link loss blocks every command before routing", () => {
    const session = nativeSession({ linkLost: true });
    const router = new MavlinkCommandRouter(session);
    assert.equal(router.capabilities().canArm, false);
    assert.throws(() => router.setArmed(true), /link is lost/);
    assert.throws(() => router.returnToLaunch(), /link is lost/);
  });

  test("an application transition block remains authoritative", () => {
    const { session, router } = policyRouter();

    router.blockCommands(
      "Ground Control transition failed; commands are disabled.",
    );
    assert.equal(router.capabilities().canArm, false);
    assert.match(router.capabilities().reason, /commands are disabled/);
    assert.throws(() => router.setArmed(true), /commands are disabled/);
    assert.deepEqual(session.calls, []);

    router.clearCommandBlock();
    assert.equal(router.capabilities().canArm, true);
  });
});

describe("Flight Commander native command routing", () => {
  test("GCS NAV is a live authorization gate for every native command", async () => {
    const session = nativeSession({
      gcsNavEnabled: false,
      baseMode: 128,
    });
    const router = new MavlinkCommandRouter(session);
    const capabilities = router.capabilities();

    assert.equal(capabilities.canArm, false);
    assert.equal(capabilities.canSetMode, false);
    assert.equal(capabilities.canStartMission, false);
    assert.equal(capabilities.canSetMissionCurrent, false);
    assert.equal(capabilities.canTakeoff, false);
    assert.equal(capabilities.canRtl, false);
    assert.equal(capabilities.canLand, false);
    assert.match(capabilities.reason, /Enable.*GCS NAV/i);
    await assert.rejects(router.setArmed(true), /GCS NAV/i);
    await assert.rejects(router.setMode("NAV WP"), /GCS NAV/i);
    await assert.rejects(router.startMission(), /GCS NAV/i);
    assert.equal(session.calls.length, 0);

    session.state.gcsNavEnabled = true;
    session.state.baseMode |= 8;
    assert.equal(router.capabilities().canArm, true);
    assert.equal(router.capabilities().canSetMode, true);
  });

  test("a GCS NAV drop between rendering and a click prevents transmission", async () => {
    const session = nativeSession();
    const router = new MavlinkCommandRouter(session);
    assert.equal(router.capabilities().canArm, true);

    session.state.gcsNavEnabled = false;
    session.state.baseMode &= ~8;
    await assert.rejects(router.setArmed(false), /GCS NAV/i);
    assert.equal(session.calls.length, 0);
  });

  test("routes all flight controls through COMMAND_LONG", async () => {
    const session = nativeSession();
    const router = new MavlinkCommandRouter(session);

    assert.equal(router.capabilities().canArm, true);
    assert.equal(router.capabilities().canStartMission, true);
    assert.equal(router.capabilities().canAbortMission, true);
    assert.equal(router.capabilities().missionAbortMode, "NAV POSHOLD");
    assert.equal(router.capabilities().canTakeoff, false);
    assert.equal(router.capabilities().canLand, true);
    assert.match(router.capabilities().reason, /native MAVLink/i);

    await router.setMode("NAV WP");
    await router.startMission();
    const abortResult = await router.abortMission();
    await router.returnToLaunch();
    await router.land();
    await router.setArmed(false);

    assert.equal(abortResult.abortMode, "NAV POSHOLD");
    assert.equal(abortResult.safeStateConfirmed, true);
    assert.deepEqual(
      session.calls.map(({ command }) => command),
      [176, 300, 193, 20, 21, 400],
    );
    assert.equal(session.calls[0].parameters.param2, 28);
    assert.equal(session.calls[1].parameters.param1, 0);
  });

  test("GCS NAV cannot be enabled by a GCS mode command", async () => {
    const session = nativeSession();
    const router = new MavlinkCommandRouter(session);

    await assert.rejects(router.setMode("GCS NAV"), /not exposed/i);
    assert.equal(session.calls.length, 0);
  });

  test("the historical adapter name aliases the native implementation", () => {
    assert.equal(
      InavMavlinkCommandAdapter,
      FlightCommanderMavlinkCommandAdapter,
    );
  });

  test("fixed-wing launch is staged before arming", async () => {
    const session = nativeSession({
      vehicleType: 1,
      vehicleTypeName: "Fixed Wing",
      armed: false,
      baseMode: 8,
      modeName: "MANUAL",
    });
    const adapter = new FlightCommanderMavlinkCommandAdapter(session);

    assert.equal(adapter.capabilities().canTakeoff, true);
    const result = await adapter.takeoff(60);
    assert.equal(result.confirmed, true);
    assert.equal(result.executionPending, true);
    assert.equal(session.calls.at(-1).command, 22);
    assert.equal(session.calls.at(-1).parameters.param7, 60);
  });

  test("multirotor takeoff remains unavailable", async () => {
    const session = nativeSession({ armed: false, baseMode: 8 });
    const adapter = new FlightCommanderMavlinkCommandAdapter(session);

    assert.equal(adapter.capabilities().canTakeoff, false);
    await assert.rejects(adapter.takeoff(20), /multirotor auto-takeoff/i);
    assert.equal(session.calls.length, 0);
  });

  test("mission resume selection is acknowledged while disarmed", async () => {
    const session = nativeSession({
      armed: false,
      baseMode: 8,
      modeName: "STABILIZE",
    });
    const router = new MavlinkCommandRouter(session);

    const result = await router.startMission({
      checkpoint: { sequence: 2 },
    });
    assert.equal(result.confirmed, true);
    assert.equal(result.executionPending, true);
    assert.equal(session.calls.at(-1).command, 300);
    assert.equal(session.calls.at(-1).parameters.param1, 2);
  });
});
