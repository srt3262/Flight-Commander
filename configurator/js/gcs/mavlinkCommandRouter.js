"use strict";

export const INAV_MODE_IDS = Object.freeze({
  ARM: 0,
  ANGLE: 1,
  HORIZON: 2,
  "NAV ALTHOLD": 3,
  "HEADING HOLD": 5,
  "NAV RTH": 10,
  "NAV POSHOLD": 11,
  MANUAL: 12,
  "AUTO TUNE": 21,
  "NAV WP": 28,
  "AIR MODE": 29,
  "GCS NAV": 31,
  "NAV LAUNCH": 36,
  "NAV COURSE HOLD": 45,
  "MSP RC OVERRIDE": 50,
  "NAV CRUISE": 53,
});

const COMMAND_TIMEOUT_MS = 6000;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_NAV_LAND = 21;
const MAV_CMD_NAV_TAKEOFF = 22;
const MAV_CMD_DO_SET_MODE = 176;
const MAV_CMD_DO_PAUSE_CONTINUE = 193;
const MAV_CMD_MISSION_START = 300;
const MAV_CMD_COMPONENT_ARM_DISARM = 400;
const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1;
const MAV_MODE_FLAG_GUIDED_ENABLED = 8;
const GCS_NAV_DISABLED_REASON =
  "Enable the pilot-controlled GCS NAV mode to authorize Flight Commander commands.";

const MODE_CONFIRMATIONS = Object.freeze({
  ANGLE: ["STABILIZE", "FLY_BY_WIRE_A"],
  HORIZON: ["STABILIZE"],
  "NAV ALTHOLD": ["ALT_HOLD", "FLY_BY_WIRE_B"],
  "NAV POSHOLD": ["POSHOLD", "LOITER", "GUIDED", "QLOITER"],
  "NAV RTH": ["RTL", "QRTL", "SMART_RTL"],
  MANUAL: ["MANUAL"],
  "NAV WP": ["AUTO"],
  "NAV LAUNCH": ["TAKEOFF", "THROW"],
});

const UNAVAILABLE_CAPABILITIES = Object.freeze({
  canArm: false,
  canSetMode: false,
  canStartMission: false,
  canAbortMission: false,
  canAbortMissionResume: false,
  canSetMissionCurrent: false,
  canResumeMission: false,
  canHoldMission: false,
  canPauseMission: false,
  canTakeoff: false,
  canRtl: false,
  canLand: false,
  takeoffReason: "Launch / Takeoff is unavailable.",
  rtlReason: "Return Home is unavailable.",
  landReason: "Land is unavailable.",
  missionHoldMode: null,
  missionHoldReason: "Mission hold is unavailable.",
  missionAbortMode: null,
  missionAbortReason: "Mission abort is unavailable.",
  missionResumeAbortMode: null,
  missionResumeAbortReason: "Mission-resume abort is unavailable.",
  missionResumeReason: "Mission resume is unavailable.",
});

export const MISSION_INTERRUPTION_ACTIONS = Object.freeze({
  HOLD: "hold",
  RTL: "rtl",
  LAND: "land",
});

const NATIVE_COMMON_MODES = Object.freeze([
  "ANGLE",
  "HORIZON",
  "NAV ALTHOLD",
  "NAV POSHOLD",
  "NAV RTH",
  "NAV WP",
]);
const NATIVE_PLANE_MODES = Object.freeze([
  "MANUAL",
  ...NATIVE_COMMON_MODES,
  "NAV LAUNCH",
]);
const PLANE_VEHICLE_TYPES = new Set([1, 19, 20, 21]);

export function normalizedName(value) {
  const candidate =
    value && typeof value === "object"
      ? (value.name ?? value.label ?? value.value)
      : value;
  return String(candidate ?? "")
    .trim()
    .toUpperCase();
}

function stateCopy(session) {
  return typeof session.snapshot === "function"
    ? session.snapshot()
    : {
        ...session.state,
        rcChannels: [...(session.state?.rcChannels ?? [])],
      };
}

function commandResult(state, extra = {}) {
  return { ...state, ...extra };
}

function normalizeSetModeArguments(active, options) {
  return active && typeof active === "object"
    ? { active: true, options: active }
    : {
        active: active == null ? true : Boolean(active),
        options: options ?? {},
      };
}

export class FlightCommanderMavlinkCommandAdapter {
  constructor(session) {
    if (
      !session?.state ||
      typeof session.sendCommandLong !== "function" ||
      typeof session.waitForState !== "function"
    ) {
      throw new Error(
        "An active MAVLink command session is required for Flight Commander commands.",
      );
    }
    this.session = session;
  }

  stop() {}

  gcsNavEnabled() {
    return Boolean(
      this.session.state.gcsNavEnabled ??
        (Number(this.session.state.baseMode) & MAV_MODE_FLAG_GUIDED_ENABLED),
    );
  }

  isPlane() {
    return PLANE_VEHICLE_TYPES.has(Number(this.session.state.vehicleType));
  }

  assertAuthorized() {
    if (!this.gcsNavEnabled()) {
      const error = new Error(GCS_NAV_DISABLED_REASON);
      error.code = "FLIGHT_COMMANDER_GCS_NAV_DISABLED";
      throw error;
    }
  }

  availableModes() {
    return [...(this.isPlane() ? NATIVE_PLANE_MODES : NATIVE_COMMON_MODES)];
  }

  capabilityForMode(mode) {
    const name = normalizedName(mode);
    if (!this.availableModes().includes(name)) {
      return {
        available: false,
        reason: `${name || "The requested mode"} is not exposed as a native Flight Commander mode command for this vehicle.`,
      };
    }
    if (!this.gcsNavEnabled()) {
      return { available: false, reason: GCS_NAV_DISABLED_REASON };
    }
    return {
      available: true,
      confirmable: true,
      confirmationNames: MODE_CONFIRMATIONS[name] ?? [],
      reason:
        "Native MAVLink command; GCS NAV remains the pilot authorization gate.",
    };
  }

  capabilities() {
    if (!this.gcsNavEnabled()) {
      return {
        ...UNAVAILABLE_CAPABILITIES,
        takeoffReason: GCS_NAV_DISABLED_REASON,
        rtlReason: GCS_NAV_DISABLED_REASON,
        landReason: GCS_NAV_DISABLED_REASON,
        missionHoldReason: GCS_NAV_DISABLED_REASON,
        missionAbortReason: GCS_NAV_DISABLED_REASON,
        missionResumeAbortReason: GCS_NAV_DISABLED_REASON,
        missionResumeReason: GCS_NAV_DISABLED_REASON,
        reason: GCS_NAV_DISABLED_REASON,
      };
    }

    const armed = Boolean(this.session.state.armed);
    const takeoffSupported = this.isPlane();
    const takeoffReady = takeoffSupported && !armed;
    const activeFlightReason = armed
      ? ""
      : "Arm the aircraft before sending this in-flight command.";
    const takeoffReason = !takeoffSupported
      ? "Flight Commander does not synthesize multirotor auto-takeoff; use a pilot-controlled takeoff."
      : armed
        ? "Select native NAV LAUNCH before arming a fixed-wing aircraft."
        : "Native NAV LAUNCH will be staged before normal fixed-wing arming checks.";

    return {
      canArm: true,
      canSetMode: true,
      canStartMission: true,
      canAbortMission: armed,
      canAbortMissionResume: armed,
      canSetMissionCurrent: true,
      canResumeMission: true,
      canHoldMission: armed,
      canPauseMission: armed,
      canTakeoff: takeoffReady,
      canRtl: armed,
      canLand: armed,
      takeoffReason,
      rtlReason: armed
        ? "Native return-to-launch command authorized by GCS NAV."
        : activeFlightReason,
      landReason: armed
        ? "Native emergency landing command authorized by GCS NAV."
        : activeFlightReason,
      missionHoldMode: armed ? "NAV POSHOLD" : null,
      missionHoldReason: armed
        ? "Native mission pause enters NAV POSHOLD/loiter."
        : activeFlightReason,
      missionResumeAbortMode: armed ? "NAV RTH" : null,
      missionResumeAbortReason: armed
        ? "A failed resume is replaced with native return-to-launch."
        : activeFlightReason,
      missionAbortMode: armed ? "NAV POSHOLD" : null,
      missionAbortReason: armed
        ? "Abort Mission sends native pause and confirms a safe hold mode."
        : activeFlightReason,
      missionResumeReason:
        "The mission item and native mission-start request can be staged before arming.",
      reason:
        "GCS NAV is enabled. Commands use native MAVLink acknowledgements.",
    };
  }

  async sendNativeCommand(command, parameters = {}, options = {}) {
    this.assertAuthorized();
    try {
      return await this.session.sendCommandLong(command, parameters, {
        timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      });
    } catch (cause) {
      if (cause?.commandResult === 2) {
        const error = new Error(
          "Flight Commander denied the command. Keep GCS NAV enabled and verify the vehicle's arming and flight-safety conditions.",
        );
        error.code = "FLIGHT_COMMANDER_COMMAND_DENIED";
        error.cause = cause;
        throw error;
      }
      throw cause;
    }
  }

  async waitForMode(modeName, options = {}) {
    const confirmations = new Set(
      (MODE_CONFIRMATIONS[modeName] ?? []).map(normalizedName),
    );
    if (!confirmations.size) {
      return commandResult(stateCopy(this.session), {
        commandMode: modeName,
        confirmed: true,
        confirmation: "COMMAND_ACK",
      });
    }
    const state = await this.session.waitForState(
      (candidate) => confirmations.has(normalizedName(candidate.modeName)),
      options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      `Flight Commander ${modeName} activation`,
    );
    return commandResult(state, {
      commandMode: modeName,
      confirmed: true,
      confirmation: "HEARTBEAT",
    });
  }

  async setMode(mode, active = true, options = {}) {
    const name = normalizedName(mode);
    const normalized = normalizeSetModeArguments(active, options);
    if (!normalized.active) {
      throw new Error(
        "Native Flight Commander mode commands select a replacement mode instead of deactivating the current mode.",
      );
    }
    const capability = this.capabilityForMode(name);
    if (!capability.available) throw new Error(capability.reason);
    await this.sendNativeCommand(
      MAV_CMD_DO_SET_MODE,
      {
        param1: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        param2: INAV_MODE_IDS[name],
      },
      normalized.options,
    );
    return this.waitForMode(name, normalized.options);
  }

  async setArmed(armed, options = {}) {
    await this.sendNativeCommand(
      MAV_CMD_COMPONENT_ARM_DISARM,
      { param1: armed ? 1 : 0 },
      options,
    );
    const state = await this.session.waitForState(
      (candidate) => candidate.armed === Boolean(armed),
      options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      armed ? "Flight Commander armed state" : "Flight Commander disarmed state",
    );
    return commandResult(state, {
      commandMode: "ARM",
      confirmed: true,
      confirmation: "HEARTBEAT",
    });
  }

  async startMission(options = {}) {
    const sequence = Number(options.checkpoint?.sequence ?? options.sequence ?? 0);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) {
      throw new RangeError(
        "Flight Commander mission start sequence must be an integer from 0 through 255.",
      );
    }
    await this.sendNativeCommand(
      MAV_CMD_MISSION_START,
      { param1: sequence },
      options,
    );
    if (!this.session.state.armed) {
      return commandResult(stateCopy(this.session), {
        commandMode: "NAV WP",
        confirmed: true,
        confirmation: "COMMAND_ACK",
        executionPending: true,
      });
    }
    return this.waitForMode("NAV WP", options);
  }

  async holdMission(options = {}) {
    await this.sendNativeCommand(
      MAV_CMD_DO_PAUSE_CONTINUE,
      { param1: 0 },
      options,
    );
    return this.waitForMode("NAV POSHOLD", options);
  }

  pauseMission(options = {}) {
    return this.holdMission(options);
  }

  async abortMission(options = {}) {
    const result = await this.holdMission(options);
    return commandResult(result, {
      abortMode: "NAV POSHOLD",
      safeStateConfirmed: true,
      missionAborted: true,
    });
  }

  async abortMissionResume(options = {}) {
    const result = await this.returnToLaunch(options);
    return commandResult(result, {
      abortMode: "NAV RTH",
      safeStateConfirmed: true,
      missionOverrideReplaced: true,
    });
  }

  async takeoff(altitude, options = {}) {
    const altitudeM = Number(altitude);
    if (!Number.isFinite(altitudeM) || altitudeM <= 0 || altitudeM > 1000) {
      throw new RangeError(
        "Takeoff altitude must be greater than zero and no more than 1000 metres.",
      );
    }
    const capability = this.capabilities();
    if (!capability.canTakeoff) throw new Error(capability.takeoffReason);
    await this.sendNativeCommand(
      MAV_CMD_NAV_TAKEOFF,
      { param7: altitudeM },
      options,
    );
    return commandResult(stateCopy(this.session), {
      commandMode: "NAV LAUNCH",
      confirmed: true,
      confirmation: "COMMAND_ACK",
      executionPending: true,
    });
  }

  async returnToLaunch(options = {}) {
    const capability = this.capabilities();
    if (!capability.canRtl) throw new Error(capability.rtlReason);
    await this.sendNativeCommand(MAV_CMD_NAV_RETURN_TO_LAUNCH, {}, options);
    return this.waitForMode("NAV RTH", options);
  }

  async land(options = {}) {
    const capability = this.capabilities();
    if (!capability.canLand) throw new Error(capability.landReason);
    await this.sendNativeCommand(MAV_CMD_NAV_LAND, {}, options);
    if (this.isPlane()) {
      return commandResult(stateCopy(this.session), {
        commandMode: "LAND",
        confirmed: true,
        confirmation: "COMMAND_ACK",
      });
    }
    const state = await this.session.waitForState(
      (candidate) =>
        ["LAND", "QLAND", "AUTOLAND"].includes(
          normalizedName(candidate.modeName),
        ),
      options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      "Flight Commander landing mode",
    );
    return commandResult(state, {
      commandMode: "LAND",
      confirmed: true,
      confirmation: "HEARTBEAT",
    });
  }
}

// Keep the historical class name as an import-compatible alias. It is the
// native COMMAND_LONG implementation, not an AUX/RC override implementation.
export { FlightCommanderMavlinkCommandAdapter as InavMavlinkCommandAdapter };

function unavailable(reason) {
  return { ...UNAVAILABLE_CAPABILITIES, reason };
}

export class MavlinkCommandRouter {
  constructor(session, options = {}) {
    if (!session?.state) {
      throw new Error("A MAVLink session is required for command routing.");
    }
    this.session = session;
    this.adapterFactory =
      options.adapterFactory ??
      ((adapterSession) =>
        new FlightCommanderMavlinkCommandAdapter(adapterSession));
    this.inavAdapter = null;
    this.inavAdapterTarget = null;
    this.commandBlockReason = null;
  }

  linkCapability() {
    if (this.commandBlockReason) {
      return { available: false, reason: this.commandBlockReason };
    }
    if (!this.session.state.connected) {
      return {
        available: false,
        reason: "Mission commands require an active MAVLink vehicle connection.",
      };
    }
    if (this.session.state.linkLost) {
      return {
        available: false,
        reason: "The MAVLink vehicle link is lost; no mission command was sent.",
      };
    }
    return { available: true, reason: "" };
  }

  blockCommands(reason) {
    this.commandBlockReason =
      String(reason || "MAVLink command controls are unavailable.");
    this.releaseInavAdapter();
    return this.commandBlockReason;
  }

  clearCommandBlock() {
    this.commandBlockReason = null;
  }

  releaseInavAdapter() {
    this.inavAdapter?.stop?.();
    this.inavAdapter = null;
    this.inavAdapterTarget = null;
  }

  nativeTarget() {
    const systemId = this.session.state.systemId;
    if (systemId == null) return null;
    const componentId = this.session.state.componentId ?? 1;
    return {
      key: `${systemId}:${componentId}`,
      systemId,
      componentId,
    };
  }

  resolveInavAdapter() {
    const target = this.nativeTarget();
    if (!target) {
      this.releaseInavAdapter();
      return {
        adapter: null,
        reason: "No MAVLink autopilot is connected.",
      };
    }
    if (!this.inavAdapter || this.inavAdapterTarget !== target.key) {
      this.releaseInavAdapter();
      this.inavAdapter = this.adapterFactory(this.session, target);
      this.inavAdapterTarget = target.key;
    }
    return { adapter: this.inavAdapter, reason: "" };
  }

  capabilities() {
    const link = this.linkCapability();
    if (!link.available) {
      this.releaseInavAdapter();
      return unavailable(link.reason);
    }
    const { adapter, reason } = this.resolveInavAdapter();
    if (!adapter) return unavailable(reason);
    return {
      ...UNAVAILABLE_CAPABILITIES,
      ...adapter.capabilities(),
    };
  }

  availableModes() {
    if (!this.linkCapability().available) {
      this.releaseInavAdapter();
      return [];
    }
    return this.resolveInavAdapter().adapter?.availableModes() ?? [];
  }

  commandTarget(methodName) {
    const link = this.linkCapability();
    if (!link.available) {
      this.releaseInavAdapter();
      throw new Error(link.reason);
    }
    const { adapter, reason } = this.resolveInavAdapter();
    if (!adapter) throw new Error(reason);
    if (typeof adapter[methodName] !== "function") {
      throw new Error(`Flight Commander command ${methodName} is unavailable.`);
    }
    return adapter;
  }

  setMode(mode, options = {}) {
    return this.commandTarget("setMode").setMode(mode, options);
  }

  setArmed(armed, options = {}) {
    return this.commandTarget("setArmed").setArmed(armed, options);
  }

  startMission(options = {}) {
    return this.commandTarget("startMission").startMission(options);
  }

  abortMission(options = {}) {
    return this.commandTarget("abortMission").abortMission(options);
  }

  abortMissionResume(options = {}) {
    return this.commandTarget("abortMissionResume").abortMissionResume(options);
  }

  holdMission(options = {}) {
    return this.commandTarget("holdMission").holdMission(options);
  }

  pauseMission(options = {}) {
    return this.holdMission(options);
  }

  interruptMission(action, options = {}) {
    switch (
      String(action ?? "")
        .trim()
        .toLowerCase()
    ) {
      case MISSION_INTERRUPTION_ACTIONS.HOLD:
      case "pause":
        return this.holdMission(options);
      case MISSION_INTERRUPTION_ACTIONS.RTL:
      case "rth":
        return this.returnToLaunch(options);
      case MISSION_INTERRUPTION_ACTIONS.LAND:
        return this.land(options);
      default:
        throw new Error(
          `Unsupported mission interruption "${action}". Use hold, RTL, or land.`,
        );
    }
  }

  takeoff(altitude, options = {}) {
    return this.commandTarget("takeoff").takeoff(altitude, options);
  }

  returnToLaunch(options = {}) {
    return this.commandTarget("returnToLaunch").returnToLaunch(options);
  }

  land(options = {}) {
    return this.commandTarget("land").land(options);
  }

  stop() {
    this.releaseInavAdapter();
  }
}
