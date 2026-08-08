"use strict";

import { bindHostTimer } from "../mavlink/hostTimers.js";
import {
  FLIGHT_COMMANDER_CAPABILITIES,
  FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK,
} from "../flightCommander/firmwareIdentity.js";

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
});

const MODE_NAMES_BY_ID = new Map(
  Object.entries(INAV_MODE_IDS).map(([name, id]) => [id, name]),
);
const COMMAND_TIMEOUT_MS = 6000;
const OVERRIDE_INTERVAL_MS = 125;
const MAVLINK_V1_CHANNEL_COUNT = 8;
const MAVLINK_V2_CHANNEL_COUNT = 18;
const SAFE_LOW_PWM = 1000;
const SAFE_NEUTRAL_PWM = 1500;
const MODE_CONFIRMATIONS = Object.freeze({
  ANGLE: ["STABILIZE", "FLY_BY_WIRE_A"],
  HORIZON: ["STABILIZE"],
  "NAV ALTHOLD": ["ALT_HOLD", "FLY_BY_WIRE_B"],
  "NAV POSHOLD": ["POSHOLD", "LOITER", "GUIDED", "QLOITER"],
  "NAV RTH": ["RTL", "QRTL", "SMART_RTL"],
  MANUAL: ["MANUAL"],
  "NAV WP": ["AUTO"],
  "GCS NAV": ["GUIDED"],
  "NAV LAUNCH": ["TAKEOFF", "THROW"],
});
const MISSION_RESUME_ABORT_MODES = Object.freeze(["NAV RTH", "NAV POSHOLD"]);
const MISSION_ABORT_MODES = Object.freeze(["NAV POSHOLD", "NAV RTH"]);
const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_STORAGE_KEY = "flightCommander.inavMavlinkProfiles.v1";
const MSP_TIMEOUT_MS = 5000;

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
});

export const MISSION_INTERRUPTION_ACTIONS = Object.freeze({
  HOLD: "hold",
  RTL: "rtl",
  LAND: "land",
});

export const INAV_NO_TARGET_ISOLATION_WARNING =
  "Flight Commander commands require a validated, target-isolated FCFW vehicle link.";

export function normalizedName(value) {
  const candidate =
    value && typeof value === "object"
      ? (value.name ?? value.label ?? value.value)
      : value;
  return String(candidate ?? "")
    .trim()
    .toUpperCase();
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export { FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK };

export function resolveCachedFlightCommanderIdentity(profileStore, state = {}) {
  // Firmware 4.0.8 predates the MAVLink AUTOPILOT_VERSION FCFW payload.
  // Accept only one controller-matched profile that was captured through
  // Flight Commander's wired MSP setup path. Signed MAVLink identity remains
  // authoritative and will replace this fallback when present.
  if (Number(state.autopilot) !== 0 || state.systemId == null) return null;
  const resolution = profileStore?.resolve?.(state.systemId);
  if (resolution?.status !== "resolved" || !resolution.profile) return null;
  const profile = resolution.profile;
  const family = String(profile.firmwareFamily ?? "").trim().toLowerCase();
  if (family && family !== "flight-commander") return null;
  const board = String(profile.boardIdentifier ?? "")
    .trim()
    .replace(/[\s_-]/g, "")
    .toUpperCase();
  if (board !== "MICOAIR743" && board !== "MICROAIR743") return null;

  const recordedCapabilities = Number(profile.flightCommanderCapabilities);
  const capabilities =
    Number.isInteger(recordedCapabilities) &&
    recordedCapabilities >= 0 &&
    recordedCapabilities <= 0xffffffff
      ? recordedCapabilities >>> 0
      : FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK;
  return Object.freeze({
    capabilities,
    source: family === "flight-commander"
      ? "cached-fcfw-profile"
      : "legacy-msp-profile",
    profileId: profile.profileId ?? null,
    firmwareVersion: profile.flightCommanderFirmwareVersion ?? "4.0.8",
  });
}

export function rangeIsConfigured(range) {
  return Number(range?.range?.end) > Number(range?.range?.start);
}

export function configuredModeRanges(ranges = []) {
  return ranges.filter(rangeIsConfigured).map((range) => ({
    ...range,
    name:
      normalizedName(range.name) ||
      MODE_NAMES_BY_ID.get(Number(range.id)) ||
      `MODE ${range.id}`,
    rcChannelIndex: Number.isInteger(Number(range.rcChannelIndex))
      ? Number(range.rcChannelIndex)
      : 4 + Number(range.auxChannelIndex),
  }));
}

export function modeRangeForName(ranges, name) {
  const wanted = normalizedName(name);
  return (
    configuredModeRanges(ranges).find((range) => range.name === wanted) ?? null
  );
}

export function activationValue(range) {
  return Math.round((Number(range.range.start) + Number(range.range.end)) / 2);
}

export function valueActivatesRange(value, range) {
  return value >= Number(range.range.start) && value < Number(range.range.end);
}

export function inactiveValueForChannel(ranges, channelIndex) {
  const channelRanges = configuredModeRanges(ranges).filter(
    (range) => range.rcChannelIndex === channelIndex,
  );
  return (
    [1000, 1500, 2000, 900, 2100].find((value) =>
      channelRanges.every((range) => !valueActivatesRange(value, range)),
    ) ?? 1000
  );
}

function settingValueName(setting) {
  const value = Number(setting?.value);
  return setting?.setting?.table?.values?.[value] ?? "";
}

export function buildRcOverrideFrame(
  baseChannels,
  overrides,
  channelCount = 8,
) {
  const highestOverride = Math.max(-1, ...overrides.keys());
  const count = Math.max(
    channelCount,
    baseChannels.length,
    highestOverride + 1,
  );
  const frame = Array.from({ length: count }, (_unused, index) => {
    const value = Number(baseChannels[index]);
    return Number.isFinite(value) && value >= 750 && value <= 2250
      ? value
      : SAFE_NEUTRAL_PWM;
  });
  for (const [index, value] of overrides) frame[index] = value;
  return frame;
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

export class InavMavlinkCommandAdapter {
  constructor(session, profile, options = {}) {
    if (!session?.state || typeof session.send !== "function") {
      throw new Error(
        "An active MAVLink session is required for INAV commands.",
      );
    }
    this.session = session;
    this.profile = profile ?? {};
    this.modeOverrides = new Map();
    this.armOverrides = new Map();
    this.activeModeName = null;
    this.commandStreamEnabled = false;
    this.overrideTimer = null;
    this.sendInFlight = null;
    this.intervalMs = options.intervalMs ?? OVERRIDE_INTERVAL_MS;
    this.setIntervalFn =
      options.setIntervalFn ?? bindHostTimer("setInterval");
    this.clearIntervalFn =
      options.clearIntervalFn ?? bindHostTimer("clearInterval");
  }

  stop() {
    if (this.overrideTimer != null) this.clearIntervalFn(this.overrideTimer);
    this.overrideTimer = null;
    this.modeOverrides.clear();
    this.armOverrides.clear();
    this.activeModeName = null;
    this.commandStreamEnabled = false;
  }

  profileCapability() {
    const profileSystemId = integerOrNull(this.profile.systemId);
    const connectedSystemId = integerOrNull(this.session.state.systemId);
    if (
      profileSystemId == null ||
      connectedSystemId == null ||
      profileSystemId !== connectedSystemId
    ) {
      return {
        available: false,
        reason: `The cached INAV profile does not match MAVLink system ID ${this.session.state.systemId ?? "unknown"}.`,
      };
    }
    if (normalizedName(this.profile.receiverType) !== "SERIAL") {
      return {
        available: false,
        reason:
          "INAV receiver_type must be SERIAL for MAVLink RC command control.",
      };
    }
    if (normalizedName(this.profile.serialRxProvider) !== "MAVLINK") {
      return {
        available: false,
        reason:
          "INAV serialrx_provider must be MAVLINK for MAVLink RC command control.",
      };
    }

    const mappedChannels = new Set();
    for (let logical = 0; logical < MAVLINK_V2_CHANNEL_COUNT; logical += 1) {
      const raw = this.rawChannelIndex(logical);
      if (mappedChannels.has(raw)) {
        return {
          available: false,
          reason:
            "The cached INAV RC map contains duplicate channels and cannot be used safely.",
        };
      }
      mappedChannels.add(raw);
    }
    const auxChannels = new Set(
      configuredModeRanges(this.profile.modeRanges ?? []).map(
        ({ rcChannelIndex }) => Number(rcChannelIndex),
      ),
    );
    for (const channel of auxChannels) {
      if (this.safeInactiveValue(channel) == null) {
        return {
          available: false,
          reason: `RC channel ${channel + 1} has no PWM value outside its configured INAV AUX ranges.`,
        };
      }
    }
    return { available: true, reason: "" };
  }

  rawChannelIndex(logicalIndex) {
    const mapped = integerOrNull(this.profile.rcMap?.[logicalIndex]);
    return mapped != null && mapped >= 0 && mapped < MAVLINK_V2_CHANNEL_COUNT
      ? mapped
      : logicalIndex;
  }

  effectiveProtocolVersion() {
    return (
      integerOrNull(this.session.state.protocolVersion) ??
      integerOrNull(this.profile.mavlinkVersion) ??
      2
    );
  }

  confirmationNames(modeName) {
    const profileNames = this.profile.modeConfirmations?.[modeName];
    return (
      (Array.isArray(profileNames)
        ? profileNames
        : MODE_CONFIRMATIONS[modeName]) ?? []
    )
      .map(normalizedName)
      .filter(Boolean);
  }

  confirmationCapability(modeName, confirmationNames) {
    if (!confirmationNames.length) {
      return {
        confirmable: false,
        reason: `${modeName} can be sent by MAVLink RC override, but INAV heartbeat telemetry cannot uniquely confirm that mode.`,
      };
    }
    const wanted = new Set(confirmationNames);
    const collision = configuredModeRanges(this.profile.modeRanges ?? [])
      .map(({ name }) => normalizedName(name))
      .filter((name) => name && name !== modeName)
      .flatMap((name) => this.confirmationNames(name))
      .find((name) => wanted.has(name));
    return collision
      ? {
          confirmable: false,
          reason: `${modeName} is being transmitted, but INAV heartbeat mode ${collision} also represents another configured AUX mode and cannot uniquely confirm this selection.`,
        }
      : { confirmable: true, reason: "" };
  }

  capabilityForMode(mode) {
    const name = normalizedName(mode);
    const profileCapability = this.profileCapability();
    if (!profileCapability.available) return profileCapability;
    const range = modeRangeForName(this.profile.modeRanges ?? [], name);
    if (!range) {
      return {
        available: false,
        reason: `${name} has no configured AUX range in the cached INAV profile.`,
      };
    }

    const activation = activationValue(range);
    const overlapping = configuredModeRanges(this.profile.modeRanges ?? [])
      .filter(
        (candidate) =>
          normalizedName(candidate.name) !== name &&
          Number(candidate.rcChannelIndex) === Number(range.rcChannelIndex) &&
          valueActivatesRange(activation, candidate),
      )
      .map(({ name: candidateName }) => normalizedName(candidateName));
    if (overlapping.length) {
      return {
        available: false,
        reason: `${name} overlaps ${overlapping.join(", ")} on RC channel ${range.rcChannelIndex + 1}; Flight Commander will not assert multiple unintended AUX modes.`,
      };
    }

    const rawChannelIndex = this.rawChannelIndex(range.rcChannelIndex);
    if (
      this.effectiveProtocolVersion() === 1 &&
      rawChannelIndex >= MAVLINK_V1_CHANNEL_COUNT
    ) {
      return {
        available: false,
        reason: `${name} uses RC channel ${rawChannelIndex + 1}, but MAVLink 1 RC override carries only channels 1 through 8. Configure MAVLink 2 or move the AUX range.`,
      };
    }
    const confirmationNames =
      name === "ARM" ? ["ARMED"] : this.confirmationNames(name);
    const confirmation =
      name === "ARM"
        ? { confirmable: true, reason: "" }
        : this.confirmationCapability(name, confirmationNames);
    return {
      available: true,
      confirmable: confirmation.confirmable,
      confirmationNames,
      modeRange: range,
      rawChannelIndex,
      reason: confirmation.reason,
    };
  }

  availableModes() {
    const hidden = new Set(["ARM", "MSP RC OVERRIDE"]);
    return [
      ...new Set(
        (this.profile.modeRanges ?? [])
          .map(
            ({ name, id }) =>
              normalizedName(name) || MODE_NAMES_BY_ID.get(Number(id)),
          )
          .filter((name) => name && !hidden.has(name))
          .filter((name) => this.capabilityForMode(name).available),
      ),
    ];
  }

  missionResumeAbortCapability() {
    const candidates = MISSION_RESUME_ABORT_MODES.map((modeName) => ({
      modeName,
      capability: this.capabilityForMode(modeName),
    }));
    const selected = candidates.find(
      ({ capability }) => capability.available && capability.confirmable,
    );
    if (selected) {
      return {
        available: true,
        modeName: selected.modeName,
        capability: selected.capability,
        reason:
          selected.modeName === "NAV RTH"
            ? "A failed INAV mission resume can be replaced with configured NAV RTH and confirmed from heartbeat telemetry."
            : "Configured NAV RTH cannot be confirmed; a failed INAV mission resume can be replaced with NAV POSHOLD and confirmed from heartbeat telemetry.",
      };
    }
    return {
      available: false,
      modeName: null,
      capability: null,
      reason:
        "Flight Commander cannot safely abort an INAV mission resume because no " +
        "configured non-mission AUX mode has unique heartbeat confirmation. " +
        candidates
          .map(
            ({ modeName, capability }) => `${modeName}: ${capability.reason}`,
          )
          .join(" "),
    };
  }

  missionAbortCapability() {
    const candidates = MISSION_ABORT_MODES.map((modeName) => ({
      modeName,
      capability: this.capabilityForMode(modeName),
    }));
    const selected = candidates.find(
      ({ capability }) => capability.available && capability.confirmable,
    );
    if (selected) {
      return {
        available: true,
        modeName: selected.modeName,
        capability: selected.capability,
        reason:
          selected.modeName === "NAV POSHOLD"
            ? "Abort Mission exits AUTO into the configured, heartbeat-confirmed NAV POSHOLD mode."
            : "NAV POSHOLD is unavailable; Abort Mission exits AUTO into configured, heartbeat-confirmed NAV RTH.",
      };
    }
    return {
      available: false,
      modeName: null,
      capability: null,
      reason:
        "Flight Commander cannot safely abort a mission because no configured " +
        "hold or return-home AUX mode has unique heartbeat confirmation. " +
        candidates
          .map(
            ({ modeName, capability }) => `${modeName}: ${capability.reason}`,
          )
          .join(" "),
    };
  }

  capabilities() {
    const arm = this.capabilityForMode("ARM");
    const mission = this.capabilityForMode("NAV WP");
    const hold = this.capabilityForMode("NAV POSHOLD");
    const rtl = this.capabilityForMode("NAV RTH");
    const takeoff = this.capabilityForMode("NAV LAUNCH");
    const abort = this.missionResumeAbortCapability();
    const missionAbort = this.missionAbortCapability();
    const configured = (this.profile.modeRanges ?? []).map(({ name, id }) =>
      this.capabilityForMode(
        normalizedName(name) || MODE_NAMES_BY_ID.get(Number(id)),
      ),
    );
    const firstUnavailable = [
      arm,
      mission,
      hold,
      rtl,
      takeoff,
      ...configured,
    ].find(({ available }) => !available);
    return {
      canArm: arm.available,
      canSetMode: configured.some(({ available }) => available),
      canStartMission: mission.available,
      canAbortMission: missionAbort.available,
      canResumeMission: mission.available && mission.confirmable,
      canAbortMissionResume: abort.available,
      canSetMissionCurrent: false,
      canHoldMission: hold.available,
      canPauseMission: hold.available,
      canTakeoff: takeoff.available,
      canRtl: rtl.available,
      canLand: false,
      takeoffReason: takeoff.available
        ? "Launch / Takeoff uses the configured INAV NAV LAUNCH AUX range."
        : takeoff.reason,
      rtlReason: rtl.available
        ? "Return Home uses the configured INAV NAV RTH AUX range."
        : rtl.reason,
      landReason:
        "The current Flight Commander Firmware does not expose a separately confirmable generic Land command. Use Return Home or a configured landing mission.",
      missionHoldMode: hold.available ? "NAV POSHOLD" : null,
      missionHoldReason: hold.available
        ? "Mission hold uses the configured INAV NAV POSHOLD AUX range."
        : hold.reason,
      missionResumeAbortMode: abort.modeName,
      missionResumeAbortReason: abort.reason,
      missionAbortMode: missionAbort.modeName,
      missionAbortReason: missionAbort.reason,
      missionResumeReason:
        mission.available && mission.confirmable
          ? "NAV WP can be selected and uniquely confirmed from heartbeat telemetry."
          : mission.reason,
      reason:
        firstUnavailable?.reason ??
        "INAV commands use a safe receiver baseline plus sustained MAVLink RC_CHANNELS_OVERRIDE frames.",
    };
  }

  safeInactiveValue(channelIndex) {
    const channelRanges = configuredModeRanges(
      this.profile.modeRanges ?? [],
    ).filter(({ rcChannelIndex }) => Number(rcChannelIndex) === channelIndex);
    if (!channelRanges.length) return SAFE_LOW_PWM;
    const value = inactiveValueForChannel(
      this.profile.modeRanges ?? [],
      channelIndex,
    );
    return channelRanges.every((range) => !valueActivatesRange(value, range))
      ? value
      : null;
  }

  safeLogicalChannels() {
    const channels = new Array(MAVLINK_V2_CHANNEL_COUNT).fill(SAFE_LOW_PWM);
    channels[0] = SAFE_NEUTRAL_PWM;
    channels[1] = SAFE_NEUTRAL_PWM;
    channels[2] = SAFE_NEUTRAL_PWM;
    channels[3] = SAFE_LOW_PWM;
    for (let index = 4; index < MAVLINK_V2_CHANNEL_COUNT; index += 1) {
      const inactive = this.safeInactiveValue(index);
      if (inactive == null) {
        throw new Error(
          `RC channel ${index + 1} has no safe inactive PWM value outside its configured AUX ranges.`,
        );
      }
      channels[index] = inactive;
    }
    return channels;
  }

  rawBaseChannels() {
    const raw = new Array(MAVLINK_V2_CHANNEL_COUNT).fill(SAFE_LOW_PWM);
    this.safeLogicalChannels().forEach((value, logicalIndex) => {
      const rawIndex = this.rawChannelIndex(logicalIndex);
      if (rawIndex >= 0 && rawIndex < MAVLINK_V2_CHANNEL_COUNT)
        raw[rawIndex] = value;
    });
    return raw;
  }

  combinedOverrides() {
    const combined = new Map(this.modeOverrides);
    for (const [channel, value] of this.armOverrides) {
      const existing = combined.get(channel);
      if (existing != null && existing !== value) {
        throw new Error(
          `The configured ARM range and ${this.activeModeName ?? "flight mode"} share RC channel ${channel + 1}; they cannot be asserted independently.`,
        );
      }
      combined.set(channel, value);
    }
    return combined;
  }

  currentFrame() {
    return buildRcOverrideFrame(
      this.rawBaseChannels(),
      this.combinedOverrides(),
      MAVLINK_V2_CHANNEL_COUNT,
    ).slice(0, MAVLINK_V2_CHANNEL_COUNT);
  }

  payloadForCurrentFrame() {
    const systemId = integerOrNull(this.session.state.systemId);
    if (systemId == null) throw new Error("No MAVLink autopilot is connected.");
    const payload = {
      targetSystem: systemId,
      targetComponent: integerOrNull(this.session.state.componentId) ?? 1,
    };
    this.currentFrame().forEach((value, index) => {
      payload[`chan${index + 1}Raw`] = value;
    });
    return payload;
  }

  sendCurrentFrame() {
    if (!this.commandStreamEnabled) return Promise.resolve(null);
    if (this.sendInFlight) return this.sendInFlight;
    this.sendInFlight = Promise.resolve(
      this.session.send("RcChannelsOverride", this.payloadForCurrentFrame()),
    ).finally(() => {
      this.sendInFlight = null;
    });
    return this.sendInFlight;
  }

  ensureOverrideLoop() {
    if (this.overrideTimer != null) return;
    this.overrideTimer = this.setIntervalFn(() => {
      this.sendCurrentFrame().catch(() => {});
    }, this.intervalMs);
    this.overrideTimer?.unref?.();
  }

  waitForMode(modeName, active, capability, options = {}) {
    if (!capability.confirmable) {
      return Promise.resolve(
        commandResult(stateCopy(this.session), {
          commandMode: modeName,
          confirmed: false,
          warning: capability.reason,
        }),
      );
    }
    if (modeName === "ARM") {
      return this.session
        .waitForState(
          (state) => state.armed === active,
          options.timeoutMs ?? COMMAND_TIMEOUT_MS,
          active ? "INAV armed state" : "INAV disarmed state",
        )
        .then((state) =>
          commandResult(state, {
            commandMode: modeName,
            confirmed: true,
          }),
        );
    }
    const confirmations = new Set(capability.confirmationNames);
    return this.session
      .waitForState(
        (state) =>
          active
            ? confirmations.has(normalizedName(state.modeName))
            : !confirmations.has(normalizedName(state.modeName)),
        options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        `INAV ${modeName} ${active ? "activation" : "deactivation"}`,
      )
      .then((state) =>
        commandResult(state, {
          commandMode: modeName,
          confirmed: true,
        }),
      );
  }

  async setMode(mode, active = true, options = {}) {
    const name = normalizedName(mode);
    const normalized = normalizeSetModeArguments(active, options);
    const capability = this.capabilityForMode(name);
    if (!capability.available) throw new Error(capability.reason);
    if (name === "ARM")
      return this.setArmed(normalized.active, normalized.options);

    if (normalized.active) {
      this.modeOverrides.clear();
      this.activeModeName = name;
      this.modeOverrides.set(
        capability.rawChannelIndex,
        activationValue(capability.modeRange),
      );
    } else if (this.activeModeName === name) {
      this.modeOverrides.clear();
      this.activeModeName = null;
    }
    this.commandStreamEnabled = true;
    this.ensureOverrideLoop();
    await this.sendCurrentFrame();
    return this.waitForMode(
      name,
      normalized.active,
      capability,
      normalized.options,
    );
  }

  async setArmed(armed, options = {}) {
    const capability = this.capabilityForMode("ARM");
    if (!capability.available) throw new Error(capability.reason);
    this.armOverrides.clear();
    this.armOverrides.set(
      capability.rawChannelIndex,
      armed
        ? activationValue(capability.modeRange)
        : inactiveValueForChannel(
            this.profile.modeRanges ?? [],
            capability.modeRange.rcChannelIndex,
          ),
    );
    this.commandStreamEnabled = true;
    this.ensureOverrideLoop();
    await this.sendCurrentFrame();
    return this.waitForMode("ARM", Boolean(armed), capability, options);
  }

  startMission(options = {}) {
    return this.setMode("NAV WP", true, options);
  }

  async abortMission(options = {}) {
    const capability = this.missionAbortCapability();
    if (!capability.available) {
      const error = new Error(capability.reason);
      error.code = "INAV_MISSION_ABORT_UNAVAILABLE";
      error.safeStateConfirmed = false;
      throw error;
    }
    try {
      const result = await this.setMode(capability.modeName, true, options);
      if (result.confirmed !== true) {
        throw new Error(
          `INAV heartbeat telemetry did not confirm ${capability.modeName}.`,
        );
      }
      return commandResult(result, {
        abortMode: capability.modeName,
        safeStateConfirmed: true,
        missionAborted: true,
      });
    } catch (cause) {
      const error = new Error(
        `Flight Commander requested ${capability.modeName} to abort the mission, ` +
          "but heartbeat telemetry did not confirm the safe non-mission state. " +
          "Use the dedicated Return Home or Land control only after checking the displayed vehicle mode.",
      );
      error.code = "INAV_MISSION_ABORT_UNCONFIRMED";
      error.cause = cause;
      error.abortMode = capability.modeName;
      error.safeStateConfirmed = false;
      throw error;
    }
  }

  async abortMissionResume(options = {}) {
    const capability = this.missionResumeAbortCapability();
    if (!capability.available) {
      const error = new Error(capability.reason);
      error.code = "INAV_MISSION_RESUME_ABORT_UNAVAILABLE";
      error.safeStateConfirmed = false;
      error.missionOverrideReplaced = false;
      throw error;
    }
    try {
      const result = await this.setMode(capability.modeName, true, options);
      if (result.confirmed !== true) {
        throw new Error(
          `INAV heartbeat telemetry did not confirm ${capability.modeName}.`,
        );
      }
      return commandResult(result, {
        abortMode: capability.modeName,
        safeStateConfirmed: true,
        missionOverrideReplaced: true,
      });
    } catch (cause) {
      const error = new Error(
        `Flight Commander replaced the sustained INAV NAV WP override with ${capability.modeName}, ` +
          "but heartbeat telemetry did not confirm the safe non-mission state. " +
          "The original mission must not be restored until the aircraft state is confirmed.",
      );
      error.code = "INAV_MISSION_RESUME_ABORT_UNCONFIRMED";
      error.cause = cause;
      error.abortMode = capability.modeName;
      error.safeStateConfirmed = false;
      error.missionOverrideReplaced =
        this.activeModeName === capability.modeName;
      throw error;
    }
  }

  holdMission(options = {}) {
    return this.setMode("NAV POSHOLD", true, options);
  }

  pauseMission(options = {}) {
    return this.holdMission(options);
  }

  takeoff(_altitude, options = {}) {
    return this.setMode("NAV LAUNCH", true, options);
  }

  returnToLaunch(options = {}) {
    return this.setMode("NAV RTH", true, options);
  }

  land() {
    throw new Error(
      "INAV 9.1 does not expose a generic Land command over MAVLink. " +
        "Configure and use NAV RTH; landing behavior follows the controller RTH settings.",
    );
  }
}

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultStorage() {
  return {
    get(key, fallback) {
      return (
        globalThis.window?.electronAPI?.storeGet?.(key, fallback) ?? fallback
      );
    },
    set(key, value) {
      globalThis.window?.electronAPI?.storeSet?.(key, value);
    },
  };
}

function emptyDocument() {
  return { schemaVersion: PROFILE_SCHEMA_VERSION, profilesBySystemId: {} };
}

function normalizeDocument(value) {
  if (
    !value ||
    value.schemaVersion !== PROFILE_SCHEMA_VERSION ||
    typeof value.profilesBySystemId !== "object" ||
    Array.isArray(value.profilesBySystemId)
  )
    return emptyDocument();
  const document = emptyDocument();
  for (const [systemId, profiles] of Object.entries(value.profilesBySystemId)) {
    if (Array.isArray(profiles)) {
      document.profilesBySystemId[systemId] = profiles
        .filter((profile) => profile && typeof profile === "object")
        .map(copy);
    }
  }
  return document;
}

function uidString(uid) {
  if (!Array.isArray(uid) || uid.length === 0) return "";
  const values = uid.map((value) => Number(value) >>> 0);
  return values.some((value) => value !== 0) ? values.join("-") : "";
}

function profileIdentity(FC, systemId) {
  const uid = uidString(FC?.CONFIG?.uid);
  if (uid) return `uid:${uid}`;
  const board = String(FC?.CONFIG?.boardIdentifier ?? "unknown-board").trim();
  const name = String(FC?.CONFIG?.name ?? "unnamed").trim();
  const platform = String(FC?.MIXER_CONFIG?.platformType ?? "unknown-platform");
  return `fallback:${board}:${name}:${platform}:${systemId}`;
}

function numericSetting(setting) {
  if (setting == null) return null;
  const value = Number(setting.value);
  return Number.isFinite(value) ? value : null;
}

function namedSetting(setting) {
  return (
    settingValueName(setting) ||
    (setting?.value == null ? "" : String(setting.value))
  );
}

function validateSystemId(value) {
  const systemId = Number(value);
  if (!Number.isInteger(systemId) || systemId < 1 || systemId > 255) {
    throw new Error(
      "INAV mavlink_sysid must be an integer from 1 through 255 before a MAVLink command profile can be saved.",
    );
  }
  return systemId;
}

function requestMsp(MSP, code, timeoutMs = MSP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`INAV did not respond to MSP command ${code}.`));
    }, timeoutMs);
    timer?.unref?.();
    MSP.send_message(code, false, false, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!response || response.unsupported) {
        reject(new Error(`INAV rejected MSP command ${code}.`));
      } else {
        resolve(response);
      }
    });
  });
}

async function defaultCaptureDependencies() {
  const [
    { default: FC },
    { default: MSP },
    { default: MSPCodes },
    { default: mspHelper },
  ] = await Promise.all([
    import("../fc.js"),
    import("../msp.js"),
    import("../msp/MSPCodes.js"),
    import("../msp/MSPHelper.js"),
  ]);
  return {
    FC,
    MSPCodes,
    mspHelper,
    requestMsp: (code) => requestMsp(MSP, code),
  };
}

export class InavMavlinkProfileStore {
  constructor(options = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.now = options.now ?? (() => new Date());
    this.storageKey = options.storageKey ?? PROFILE_STORAGE_KEY;
    this.documentCache = null;
  }

  readDocument() {
    if (this.documentCache == null) {
      this.documentCache = normalizeDocument(
        this.storage.get(this.storageKey, emptyDocument()),
      );
    }
    return copy(this.documentCache);
  }

  writeDocument(value) {
    const document = normalizeDocument(value);
    this.documentCache = copy(document);
    this.storage.set(this.storageKey, document);
    return copy(document);
  }

  profilesForSystemId(systemId) {
    return copy(
      this.readDocument().profilesBySystemId[
        String(validateSystemId(systemId))
      ] ?? [],
    );
  }

  save(profile) {
    const systemId = validateSystemId(profile?.systemId);
    if (!profile?.profileId) {
      throw new Error("An INAV MAVLink profile must have a stable profileId.");
    }
    const document = this.readDocument();
    for (const [key, profiles] of Object.entries(document.profilesBySystemId)) {
      const remaining = profiles.filter(
        ({ profileId }) => profileId !== profile.profileId,
      );
      if (remaining.length) document.profilesBySystemId[key] = remaining;
      else delete document.profilesBySystemId[key];
    }
    const key = String(systemId);
    document.profilesBySystemId[key] = [
      ...(document.profilesBySystemId[key] ?? []),
      copy({
        ...profile,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        systemId,
      }),
    ];
    this.writeDocument(document);
    return copy(profile);
  }

  resolve(systemId, options = {}) {
    let profiles;
    try {
      profiles = this.profilesForSystemId(systemId);
    } catch (error) {
      return {
        status: "missing",
        profile: null,
        profiles: [],
        reason: error.message,
      };
    }
    if (options.profileId) {
      profiles = profiles.filter(
        ({ profileId }) => profileId === options.profileId,
      );
    }
    if (options.platformType != null) {
      profiles = profiles.filter(
        ({ platformType }) =>
          Number(platformType) === Number(options.platformType),
      );
    }
    if (profiles.length === 1) {
      return {
        status: "resolved",
        profile: copy(profiles[0]),
        profiles: copy(profiles),
        reason: "",
      };
    }
    if (profiles.length > 1) {
      return {
        status: "ambiguous",
        profile: null,
        profiles: copy(profiles),
        reason:
          `Multiple INAV controller profiles use MAVLink system ID ${systemId}. ` +
          "Select the controller profile or configure unique mavlink_sysid values.",
      };
    }
    return {
      status: "missing",
      profile: null,
      profiles: [],
      reason: options.profileId
        ? `The selected INAV controller profile is not cached for MAVLink system ID ${systemId}.`
        : `No INAV controller profile is cached for MAVLink system ID ${systemId}. ` +
          "Connect it by USB and capture its MAVLink command profile first.",
    };
  }

  async captureFromMsp(dependencies = null) {
    const {
      FC,
      MSPCodes,
      mspHelper,
      requestMsp: sendMsp,
    } = dependencies ?? (await defaultCaptureDependencies());
    if (!FC || !MSPCodes || !mspHelper || typeof sendMsp !== "function") {
      throw new Error(
        "Incomplete MSP dependencies were supplied for INAV profile capture.",
      );
    }

    await sendMsp(MSPCodes.MSP_BOXIDS);
    FC.generateAuxConfig?.();
    await sendMsp(MSPCodes.MSP_MODE_RANGES);
    await sendMsp(MSPCodes.MSP_RX_MAP);
    await sendMsp(MSPCodes.MSP_RC);

    const mavlinkSystemId = await mspHelper.getSetting("mavlink_sysid");
    const mavlinkVersion = await mspHelper.getSetting("mavlink_version");
    const receiverType = await mspHelper.getSetting("receiver_type");
    const serialRxProvider = await mspHelper.getSetting("serialrx_provider");
    const systemId = validateSystemId(numericSetting(mavlinkSystemId));
    const activeChannels = Number(FC.RC?.active_channels);
    const capturedAt = this.now();
    const profile = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileId: profileIdentity(FC, systemId),
      uid: uidString(FC.CONFIG?.uid),
      name: String(FC.CONFIG?.name ?? ""),
      boardIdentifier: String(FC.CONFIG?.boardIdentifier ?? ""),
      firmwareFamily: String(
        FC.CONFIG?.firmwareIdentity?.family ?? FC.CONFIG?.firmwareFamily ?? "",
      ),
      flightCommanderFirmwareVersion:
        FC.CONFIG?.flightCommanderFirmware?.firmwareVersion ?? null,
      flightCommanderIdentitySchema:
        FC.CONFIG?.flightCommanderFirmware?.schemaVersion ?? null,
      flightCommanderCapabilities:
        FC.CONFIG?.flightCommanderFirmware?.capabilities ?? null,
      platformType: FC.MIXER_CONFIG?.platformType ?? null,
      systemId,
      mavlinkVersion: numericSetting(mavlinkVersion),
      receiverType: namedSetting(receiverType),
      receiverTypeValue: numericSetting(receiverType),
      serialRxProvider: namedSetting(serialRxProvider),
      serialRxProviderValue: numericSetting(serialRxProvider),
      rcMap: Array.from(FC.RC_MAP ?? [], (value) => Number(value)),
      rcChannels: Array.from(FC.RC?.channels ?? [], (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
      ).slice(
        0,
        Number.isFinite(activeChannels) && activeChannels > 0
          ? activeChannels
          : MAVLINK_V2_CHANNEL_COUNT,
      ),
      modeRanges: configuredModeRanges(FC.MODE_RANGES ?? []).map((range) => ({
        id: Number(range.id),
        name: range.name,
        auxChannelIndex: Number(range.auxChannelIndex),
        rcChannelIndex: Number(range.rcChannelIndex),
        range: {
          start: Number(range.range.start),
          end: Number(range.range.end),
        },
      })),
      capturedAt: (capturedAt instanceof Date
        ? capturedAt
        : new Date(capturedAt)
      ).toISOString(),
    };
    this.save(profile);
    return copy(profile);
  }
}

export const inavMavlinkProfileStore = new InavMavlinkProfileStore();

function unavailable(reason) {
  return { ...UNAVAILABLE_CAPABILITIES, reason };
}

export class MavlinkCommandRouter {
  constructor(session, options = {}) {
    if (!session?.state)
      throw new Error("A MAVLink session is required for command routing.");
    this.session = session;
    this.profileStore = options.profileStore ?? inavMavlinkProfileStore;
    this.adapterFactory =
      options.adapterFactory ??
      ((adapterSession, profile) =>
        new InavMavlinkCommandAdapter(adapterSession, profile));
    this.selectedProfileId = options.profileId ?? null;
    this.inavAdapter = null;
    this.inavAdapterProfileId = null;
    this.singleInavAircraftAcknowledged = false;
    this.commandBlockReason = null;
  }

  firmwareFamily() {
    return String(this.session.state.firmwareFamily ?? "unknown").toLowerCase();
  }

  flightCommanderCommandCapability() {
    return {
      available: true,
      reason:
        "Ground Control commands are enabled by the Flight Commander product contract; firmware identity metadata is informational.",
    };
  }

  linkCapability() {
    if (this.commandBlockReason) {
      return {
        available: false,
        reason: this.commandBlockReason,
      };
    }
    if (!this.session.state.connected) {
      return {
        available: false,
        reason:
          "Mission commands require an active MAVLink vehicle connection.",
      };
    }
    if (this.session.state.linkLost) {
      return {
        available: false,
        reason:
          "The MAVLink vehicle link is lost; no mission command was sent.",
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

  selectInavProfile(profileId) {
    this.selectedProfileId = profileId || null;
    this.releaseInavAdapter();
  }

  releaseInavAdapter() {
    this.inavAdapter?.stop?.();
    this.inavAdapter = null;
    this.inavAdapterProfileId = null;
  }

  acknowledgeSingleInavAircraft(acknowledged = true) {
    if (this.firmwareFamily() !== "inav" && acknowledged) {
      throw new Error(
        "The single-aircraft acknowledgement applies only to an identified INAV MAVLink connection.",
      );
    }
    this.singleInavAircraftAcknowledged = Boolean(acknowledged);
    return this.singleInavAircraftAcknowledged;
  }

  hasSingleInavAircraftAcknowledgement() {
    return this.singleInavAircraftAcknowledged;
  }

  inavTargetIsolationCapability() {
    return this.singleInavAircraftAcknowledged
      ? {
          available: true,
          reason:
            "Single-aircraft link confirmed for this connection. Stock INAV does not " +
            "isolate RC_CHANNELS_OVERRIDE by target_system; do not share this transport " +
            "with another INAV aircraft.",
        }
      : { available: false, reason: INAV_NO_TARGET_ISOLATION_WARNING };
  }

  inavResolution() {
    const systemId = this.session.state.systemId;
    return systemId == null
      ? {
          status: "missing",
          profile: null,
          profiles: [],
          reason: "No MAVLink autopilot is connected.",
        }
      : this.profileStore.resolve(systemId, {
          profileId: this.selectedProfileId,
        });
  }

  resolveInavAdapter() {
    const resolution = this.inavResolution();
    if (resolution.status !== "resolved") {
      this.releaseInavAdapter();
      return { resolution, adapter: null };
    }
    if (
      !this.inavAdapter ||
      this.inavAdapterProfileId !== resolution.profile.profileId
    ) {
      this.releaseInavAdapter();
      this.inavAdapter = this.adapterFactory(this.session, resolution.profile);
      this.inavAdapterProfileId = resolution.profile.profileId;
    }
    return { resolution, adapter: this.inavAdapter };
  }

  capabilities() {
    const link = this.linkCapability();
    if (!link.available) {
      this.releaseInavAdapter();
      return unavailable(link.reason);
    }
    const commandCapability = this.flightCommanderCommandCapability();
    const { resolution, adapter } = this.resolveInavAdapter();
    if (!adapter) return unavailable(resolution.reason);
    const adapterCapabilities = adapter.capabilities();
    return {
      ...UNAVAILABLE_CAPABILITIES,
      ...adapterCapabilities,
      canSetMissionCurrent: true,
      canResumeMission: adapterCapabilities.canResumeMission,
      missionResumeReason: adapterCapabilities.missionResumeReason,
      reason: commandCapability.reason,
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
    const { resolution, adapter } = this.resolveInavAdapter();
    if (!adapter) throw new Error(resolution.reason);
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
    const link = this.linkCapability();
    if (!link.available) throw new Error(link.reason);
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
    this.singleInavAircraftAcknowledged = false;
  }
}
