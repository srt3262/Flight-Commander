"use strict";

import { estimateInavMissionProgress } from "../gcs/inavMissionProgress.js";
import { mavlinkCommandRouter } from "../gcs/mavlinkCommandRouterInstance.js";
import mavlinkSession from "../mavlink/mavlinkSession.js";
import {
  mavlinkMissionManager,
  mavlinkParameterManager,
} from "../mavlink/services.js";
import { missionOperationCoordinator } from "./missionOperationCoordinator.js";
import {
  assertMissionReadback,
  filterExpectedMissionForProtocol,
} from "./missionVerification.js";

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_MISSION_STATE_COMPLETE = 5;
const MAV_MISSION_STATES_IN_PROGRESS = new Set([2, 3, 4]);
export const ARDUPILOT_MISSION_RESTART_PARAMETER = "MIS_RESTART";
const BOOT_TIME_MODULUS_MS = 4294967296;
const BOOT_CONTINUITY_MIN_TOLERANCE_MS = 5000;
const BOOT_CONTINUITY_MAX_TOLERANCE_MS = 60000;
const ACTIVE_MISSION_MODES = new Set(["AUTO", "NAV WP", "WAYPOINTS"]);
const RETURN_MODES = new Set([
  "RTL",
  "RTH",
  "NAV RTH",
  "QRTL",
  "SMART RTL",
  "AUTO RTL",
]);

export const RESUME_STATUS = Object.freeze({
  IDLE: "idle",
  REGISTERED: "registered",
  CHECKPOINT: "checkpoint",
  RESUMING: "resuming",
  RESUMED: "resumed",
  ERROR: "error",
});

export class MissionResumeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "MissionResumeError";
    this.code = code;
    this.clearCheckpoint = !!options.clearCheckpoint;
    Object.assign(this, options.details ?? {});
  }
}

function resumeError(code, message, options = {}) {
  return new MissionResumeError(code, message, options);
}

export function normalizeMissionMode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isMissionMode(value) {
  return ACTIVE_MISSION_MODES.has(normalizeMissionMode(value));
}

export function isReturnMode(value) {
  return RETURN_MODES.has(normalizeMissionMode(value));
}

function finiteInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function finiteNumberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneValue(value, seen = new Map()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) {
    throw new TypeError("Mission data must not contain circular references.");
  }
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  if (Array.isArray(value)) {
    value.forEach((item) => result.push(cloneValue(item, seen)));
  } else {
    for (const [key, item] of Object.entries(value)) {
      result[key] = cloneValue(item, seen);
    }
  }
  seen.delete(value);
  return result;
}

function cloneMission(mission) {
  if (!Array.isArray(mission)) {
    throw new TypeError("Registered onboard mission must be an array.");
  }
  return cloneValue(mission);
}

function canonicalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isNaN(number)) return "NaN";
  if (number === Number.POSITIVE_INFINITY) return "Infinity";
  if (number === Number.NEGATIVE_INFINITY) return "-Infinity";
  return Number.isFinite(number) ? number : String(value);
}

function canonicalMissionItem(item = {}) {
  return {
    frame: canonicalNumber(item.frame),
    command: canonicalNumber(item.command ?? MAV_CMD_NAV_WAYPOINT),
    autocontinue: item.autocontinue !== false,
    param1: canonicalNumber(item.param1),
    param2: canonicalNumber(item.param2),
    param3: canonicalNumber(item.param3),
    param4: canonicalNumber(item.param4),
    latitude: canonicalNumber(item.latitude ?? item.lat),
    longitude: canonicalNumber(item.longitude ?? item.lon),
    altitude: canonicalNumber(item.altitude ?? item.alt),
    missionType: canonicalNumber(item.missionType),
  };
}

export function canonicalMission(mission) {
  return JSON.stringify(cloneMission(mission).map(canonicalMissionItem));
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt(code >>> 8);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function fingerprintMission(mission) {
  const canonical = canonicalMission(mission);
  return `mission-v1:${JSON.parse(canonical).length}:${fnv1a64(canonical)}`;
}

function systemIdFrom(state) {
  const systemId = finiteInteger(state?.systemId);
  if (systemId == null || systemId > 255) {
    throw resumeError(
      "SYSTEM_UNKNOWN",
      "Mission resume requires an identified MAVLink vehicle system.",
    );
  }
  return systemId;
}

function firmwareFamilyFrom(state) {
  const family = String(state?.firmwareFamily ?? "")
    .trim()
    .toLowerCase();
  if (!["ardupilot", "inav"].includes(family)) {
    throw resumeError(
      "FIRMWARE_UNKNOWN",
      "Mission resume is unavailable until the controller is identified as ArduPilot or INAV.",
    );
  }
  return family;
}

function vehicleIdentityFrom(state) {
  const version = state?.autopilotVersion;
  const uid2 = String(version?.uid2Hex ?? "")
    .trim()
    .toLowerCase();
  if (uid2 && /[1-9a-f]/.test(uid2)) return `uid2:${uid2}`;
  const uid = String(version?.uid ?? "").trim();
  return uid && uid !== "0" ? `uid:${uid}` : null;
}

function registrationSummary(registration) {
  return registration
    ? {
        firmwareFamily: registration.firmwareFamily,
        systemId: registration.systemId,
        fingerprint: registration.fingerprint,
        itemCount: registration.mission.length,
        missionId: registration.missionId,
        missionMode: registration.missionMode,
        missionTotal: registration.missionTotal,
        bootGeneration: registration.bootGeneration,
        registeredAt: registration.registeredAt,
        source: registration.source,
        vehicleIdentity: registration.vehicleIdentity,
      }
    : null;
}

function cloneCheckpoint(checkpoint) {
  return checkpoint ? cloneValue(checkpoint) : null;
}

function stateSnapshot(session) {
  return typeof session?.snapshot === "function"
    ? session.snapshot()
    : cloneValue(session?.state ?? {});
}

function checkpointSequenceBeforeCompletion(sequence, state, mission) {
  if (
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence >= mission.length ||
    Number(state?.missionState) === MAV_MISSION_STATE_COMPLETE ||
    Number(mission[sequence]?.command ?? MAV_CMD_NAV_WAYPOINT) ===
      MAV_CMD_NAV_RETURN_TO_LAUNCH
  ) {
    return false;
  }
  const reached = finiteInteger(state?.missionReached);
  return !(
    sequence === mission.length - 1 &&
    reached != null &&
    reached >= sequence
  );
}

function missionHasCompleted(state, mission) {
  if (Number(state?.missionState) === MAV_MISSION_STATE_COMPLETE) return true;
  const finalIndex = mission.length - 1;
  if (finalIndex < 0) return true;
  const reached = finiteInteger(state?.missionReached);
  if (reached != null && reached >= finalIndex) return true;
  return (
    finiteInteger(state?.missionCurrent) === finalIndex &&
    Number(mission[finalIndex]?.command) === MAV_CMD_NAV_RETURN_TO_LAUNCH
  );
}

function missionCurrentExtensionPresent(envelope, fieldName, payloadLength) {
  if (
    Object.prototype.hasOwnProperty.call(
      envelope?.header ?? {},
      "payloadLength",
    )
  ) {
    const actualLength = finiteInteger(envelope.header.payloadLength);
    return actualLength != null && actualLength >= payloadLength;
  }
  return Object.prototype.hasOwnProperty.call(envelope?.data ?? {}, fieldName);
}

export function bootClockElapsedMatches(
  initialBootMs,
  initialHostMs,
  currentBootMs,
  currentHostMs,
) {
  const initialBoot = finiteNumberOrNull(initialBootMs);
  const initialHost = finiteNumberOrNull(initialHostMs);
  const currentBoot = finiteNumberOrNull(currentBootMs);
  const currentHost = finiteNumberOrNull(currentHostMs);
  if (
    initialBoot == null ||
    initialHost == null ||
    currentBoot == null ||
    currentHost == null
  ) {
    return false;
  }
  const hostElapsed = currentHost - initialHost;
  if (hostElapsed < 0 || hostElapsed >= BOOT_TIME_MODULUS_MS) return false;
  let bootElapsed = currentBoot - initialBoot;
  if (bootElapsed < -2000) {
    bootElapsed += BOOT_TIME_MODULUS_MS;
  } else if (bootElapsed < 0) {
    bootElapsed = 0;
  }
  const tolerance = Math.min(
    BOOT_CONTINUITY_MAX_TOLERANCE_MS,
    Math.max(BOOT_CONTINUITY_MIN_TOLERANCE_MS, hostElapsed * 0.02),
  );
  return Math.abs(bootElapsed - hostElapsed) <= tolerance;
}

function bootClockMatchesHostElapsed(checkpoint, currentBootMs, currentHostMs) {
  return bootClockElapsedMatches(
    checkpoint?.timeBootMs,
    checkpoint?.capturedAt,
    currentBootMs,
    currentHostMs,
  );
}

export function inavResumeSuffix(mission, sequence) {
  if (!Array.isArray(mission) || !Number.isInteger(sequence) || sequence < 0) {
    return null;
  }
  const suffix = mission.slice(sequence);
  if (!suffix.length) return null;
  for (let index = 0; index < suffix.length; index += 1) {
    const command = Number(suffix[index]?.command ?? MAV_CMD_NAV_WAYPOINT);
    const finalRtl =
      command === MAV_CMD_NAV_RETURN_TO_LAUNCH && index === suffix.length - 1;
    if (command !== MAV_CMD_NAV_WAYPOINT && !finalRtl) return null;
  }
  return cloneMission(suffix);
}

export class MissionResumeManager {
  constructor(options = {}) {
    if (!options.session?.state) {
      throw new TypeError("MissionResumeManager requires a MAVLink session.");
    }
    this.session = options.session;
    this.commandRouter = options.commandRouter;
    this.missionManager = options.missionManager;
    this.parameterManager = options.parameterManager;
    this.operationCoordinator =
      options.operationCoordinator ?? missionOperationCoordinator;
    this.now = options.now ?? Date.now;
    this.registration = null;
    this.activeCheckpoint = null;
    this.lastSessionState = stateSnapshot(this.session);
    this.lastSessionStateObservedAt = this.now();
    this.lastInavObservation = null;
    this.lastInavMissionReference = null;
    this.listeners = new Set();
    this.resumeInFlight = null;
    this.transportDetached = false;
    this.status = RESUME_STATUS.IDLE;
    this.message = "No onboard mission is registered for resume.";
    this.lastError = null;
    this.unsubscribers = [];
    this.attach();
  }

  attach() {
    if (typeof this.session.on !== "function") return;
    this.unsubscribers.push(
      this.session.on("state", (state) => this.observeSessionState(state)),
      this.session.on("missionCheckpointInvalid", (event) => {
        this.invalidate(
          event?.error?.message ??
            "The flight controller invalidated the saved mission checkpoint.",
          {
            clearMission: true,
            reason: "session-invalidated",
          },
        );
      }),
      this.session.on("detach", () => this.observeTransportDetach()),
      this.session.on("detached", () => this.observeTransportDetach()),
      this.session.on("message:MISSION_CURRENT", (envelope) =>
        this.observeMissionCurrentConfirmation(envelope),
      ),
      this.session.on("message:MissionCurrent", (envelope) =>
        this.observeMissionCurrentConfirmation(envelope),
      ),
    );
  }

  destroy() {
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers = [];
    this.listeners.clear();
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("Mission resume subscriber must be a function.");
    }
    this.listeners.add(listener);
    if (options.immediate !== false) {
      listener(this.snapshot(), { reason: "subscribe" });
    }
    return () => this.listeners.delete(listener);
  }

  emitUpdate(reason, context = {}) {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot, { reason, ...context });
    }
  }

  snapshot() {
    const availability = this.availability({ mutate: false });
    return {
      status: this.status,
      message: this.message,
      registration: registrationSummary(this.registration),
      checkpoint: cloneCheckpoint(this.activeCheckpoint),
      canResume: availability.available,
      unavailableReason: availability.reason,
      resuming: !!this.resumeInFlight,
      lastError: this.lastError
        ? {
            name: this.lastError.name,
            code: this.lastError.code,
            message: this.lastError.message,
          }
        : null,
    };
  }

  registeredMission() {
    return this.registration ? cloneMission(this.registration.mission) : null;
  }

  getCheckpoint() {
    return cloneCheckpoint(this.activeCheckpoint);
  }

  registerMission(mission, options = {}) {
    const clonedMission = cloneMission(mission);
    if (!clonedMission.length) {
      throw resumeError(
        "MISSION_EMPTY",
        "An empty mission cannot be registered for resume.",
      );
    }
    const state = {
      ...stateSnapshot(this.session),
      ...(options.state ?? {}),
    };
    const systemId = systemIdFrom({
      ...state,
      ...(options.systemId != null ? { systemId: options.systemId } : {}),
    });
    const firmwareFamily = firmwareFamilyFrom({
      ...state,
      ...(options.firmwareFamily != null
        ? { firmwareFamily: options.firmwareFamily }
        : {}),
    });
    const canonical = canonicalMission(clonedMission);
    const previousRegistration = this.registration;
    const registration = {
      mission: clonedMission,
      canonical,
      fingerprint: fingerprintMission(clonedMission),
      firmwareFamily,
      systemId,
      missionId: finiteInteger(options.missionId ?? state.missionId),
      missionMode: finiteInteger(options.missionMode ?? state.missionMode),
      missionTotal: clonedMission.length,
      timeBootMs: finiteNumberOrNull(options.timeBootMs ?? state.timeBootMs),
      bootGeneration:
        finiteInteger(options.bootGeneration ?? state.bootGeneration) ?? 0,
      vehicleIdentity: options.vehicleIdentity ?? vehicleIdentityFrom(state),
      registeredAt: this.now(),
      source: options.source ?? "onboard-readback",
    };
    const changed =
      !previousRegistration ||
      previousRegistration.systemId !== registration.systemId ||
      previousRegistration.firmwareFamily !== registration.firmwareFamily ||
      previousRegistration.fingerprint !== registration.fingerprint ||
      previousRegistration.bootGeneration !== registration.bootGeneration;

    if (this.activeCheckpoint) {
      const checkpoint = this.activeCheckpoint;
      const identityChanged =
        checkpoint.systemId !== registration.systemId ||
        checkpoint.firmwareFamily !== registration.firmwareFamily ||
        checkpoint.missionFingerprint !== registration.fingerprint ||
        (checkpoint.vehicleIdentity != null &&
          registration.vehicleIdentity != null &&
          checkpoint.vehicleIdentity !== registration.vehicleIdentity);
      const connectedBootChanged =
        !checkpoint.transportDetached &&
        checkpoint.bootGeneration !== registration.bootGeneration;
      const detachedBootReset =
        checkpoint.transportDetached &&
        checkpoint.timeBootMs != null &&
        registration.timeBootMs != null &&
        registration.timeBootMs < checkpoint.timeBootMs;
      if (identityChanged || connectedBootChanged || detachedBootReset) {
        this.activeCheckpoint = null;
      }
    }

    this.registration = registration;
    if (changed) this.lastInavObservation = null;
    this.lastInavMissionReference = options.missionReference ?? mission;
    this.status = this.activeCheckpoint
      ? RESUME_STATUS.CHECKPOINT
      : RESUME_STATUS.REGISTERED;
    this.message = this.activeCheckpoint
      ? `Mission resume checkpoint saved at item ${this.activeCheckpoint.sequence + 1}.`
      : `${clonedMission.length} onboard mission items registered for resume monitoring.`;
    this.lastError = null;
    this.emitUpdate("mission-registered");
    return registrationSummary(registration);
  }

  clearCheckpoint(
    message = "Mission resume checkpoint cleared.",
    options = {},
  ) {
    const hadCheckpoint = !!this.activeCheckpoint;
    this.activeCheckpoint = null;
    this.status = this.registration
      ? RESUME_STATUS.REGISTERED
      : RESUME_STATUS.IDLE;
    this.message = message;
    if (!options.keepError) this.lastError = null;
    if (hadCheckpoint || options.emitWhenEmpty) {
      this.emitUpdate(options.reason ?? "checkpoint-cleared");
    }
    return hadCheckpoint;
  }

  clearRegisteredMission(message = "Registered onboard mission cleared.") {
    this.registration = null;
    this.activeCheckpoint = null;
    this.lastInavObservation = null;
    this.lastInavMissionReference = null;
    this.status = RESUME_STATUS.IDLE;
    this.message = message;
    this.lastError = null;
    this.emitUpdate("mission-cleared");
  }

  invalidate(message, options = {}) {
    this.activeCheckpoint = null;
    if (options.clearMission) {
      this.registration = null;
      this.lastInavObservation = null;
      this.lastInavMissionReference = null;
    }
    this.status = this.registration
      ? RESUME_STATUS.REGISTERED
      : RESUME_STATUS.IDLE;
    this.message = message;
    this.lastError = null;
    this.emitUpdate(options.reason ?? "checkpoint-invalidated");
  }

  observeTransportDetach() {
    this.transportDetached = true;
    if (this.activeCheckpoint) {
      this.activeCheckpoint = {
        ...this.activeCheckpoint,
        transportDetached: true,
      };
    }
    this.lastSessionState = {
      ...this.lastSessionState,
      connected: false,
      linkLost: true,
      modeName: null,
    };
    this.lastSessionStateObservedAt = this.now();
    this.status = this.activeCheckpoint
      ? RESUME_STATUS.CHECKPOINT
      : this.registration
        ? RESUME_STATUS.REGISTERED
        : RESUME_STATUS.IDLE;
    this.message = this.activeCheckpoint
      ? "Telemetry disconnected. The checkpoint is retained but must be revalidated against the same powered flight controller."
      : "Telemetry disconnected. The registered mission will be revalidated after reconnecting.";
    this.lastError = null;
    this.emitUpdate("session-detached");
  }

  observeMissionCurrentConfirmation(envelope = {}) {
    const checkpoint = this.activeCheckpoint;
    if (!checkpoint || checkpoint.estimated || !checkpoint.tentative) {
      return this.snapshot();
    }
    const state = stateSnapshot(this.session);
    if (
      finiteInteger(state.systemId) !== checkpoint.systemId ||
      String(state.firmwareFamily ?? "").toLowerCase() !==
        checkpoint.firmwareFamily
    ) {
      return this.snapshot();
    }
    const missionState = missionCurrentExtensionPresent(
      envelope,
      "missionState",
      5,
    )
      ? finiteInteger(envelope?.data?.missionState)
      : null;
    const confirmedState = {
      ...state,
      missionCurrent:
        finiteInteger(envelope?.data?.seq) ?? state.missionCurrent,
      missionState,
    };
    if (missionHasCompleted(confirmedState, this.registration?.mission ?? [])) {
      this.clearCheckpoint(
        "The mission reached its terminal item normally; no interruption checkpoint was retained.",
        { reason: "mission-completed", emitWhenEmpty: true },
      );
      return this.snapshot();
    }
    if (
      isReturnMode(confirmedState.modeName) &&
      finiteInteger(confirmedState.missionCurrent) === checkpoint.sequence &&
      MAV_MISSION_STATES_IN_PROGRESS.has(missionState)
    ) {
      this.activeCheckpoint = {
        ...checkpoint,
        tentative: false,
      };
      this.status = RESUME_STATUS.CHECKPOINT;
      this.message = `Exact mission resume checkpoint confirmed at item ${checkpoint.sequence + 1}.`;
      this.lastError = null;
      this.emitUpdate("checkpoint-confirmed");
    }
    return this.snapshot();
  }

  observeSessionState(value) {
    const state = cloneValue(value ?? {});
    const previousState = this.lastSessionState;
    const previousObservedAt = this.lastSessionStateObservedAt;
    const observedAt = this.now();
    this.lastSessionState = state;
    this.lastSessionStateObservedAt = observedAt;
    if (state.connected && !state.linkLost) this.transportDetached = false;

    if (
      this.activeCheckpoint &&
      finiteInteger(state.systemId) === this.activeCheckpoint.systemId &&
      String(state.firmwareFamily ?? "").toLowerCase() ===
        this.activeCheckpoint.firmwareFamily &&
      missionHasCompleted(state, this.registration?.mission ?? [])
    ) {
      this.clearCheckpoint(
        "The mission reached its terminal item normally; no interruption checkpoint was retained.",
        { reason: "mission-completed" },
      );
    }

    if (
      String(state.firmwareFamily ?? "").toLowerCase() === "inav" &&
      this.registration?.firmwareFamily === "inav" &&
      finiteInteger(state.systemId) === this.registration.systemId
    ) {
      const estimate = estimateInavMissionProgress({
        mission: this.registration.mission,
        latitude: state.latitude,
        longitude: state.longitude,
        modeName: state.modeName,
        previousIndex: this.lastInavObservation?.missionCurrent ?? Number.NaN,
      });
      this.observeInavEstimatedProgress({
        ...state,
        ...estimate,
        source: "inav-session-telemetry",
      });
      return this.snapshot();
    }

    if (
      String(state.firmwareFamily ?? "").toLowerCase() === "ardupilot" &&
      previousState &&
      isMissionMode(previousState.modeName) &&
      isReturnMode(state.modeName)
    ) {
      this.captureTransitionCheckpoint({
        state: previousState,
        returnState: state,
        stateObservedAt: previousObservedAt,
        returnStateObservedAt: observedAt,
        sequence: finiteInteger(previousState.missionCurrent),
        estimated: false,
        source: "ardupilot-mission-current",
      });
    }
    return this.snapshot();
  }

  observeInavEstimatedProgress(value = {}) {
    const observedAt = this.now();
    const state = {
      ...stateSnapshot(this.session),
      ...value,
      firmwareFamily: "inav",
    };
    if (
      Array.isArray(value.mission) &&
      value.mission.length > 0 &&
      (!this.registration ||
        this.registration.firmwareFamily !== "inav" ||
        value.mission !== this.lastInavMissionReference)
    ) {
      this.registerMission(value.mission, {
        state,
        firmwareFamily: "inav",
        source: value.source ?? "inav-ground-control",
        missionReference: value.mission,
      });
    }
    const previous = this.lastInavObservation;
    if (
      previous &&
      previous.estimated === true &&
      isMissionMode(previous.modeName) &&
      isReturnMode(state.modeName)
    ) {
      this.captureTransitionCheckpoint({
        state: previous,
        returnState: state,
        stateObservedAt: previous.observedAt,
        returnStateObservedAt: observedAt,
        sequence: finiteInteger(previous.missionCurrent),
        estimated: true,
        source: "inav-position-estimate",
      });
    }
    this.lastInavObservation = {
      ...state,
      estimated: value.estimated === true,
      missionCurrent: finiteInteger(value.missionCurrent),
      observedAt,
    };
    return this.snapshot();
  }

  captureTransitionCheckpoint({
    state,
    returnState,
    stateObservedAt,
    returnStateObservedAt,
    sequence,
    estimated,
    source,
  }) {
    if (
      !this.registration ||
      this.registration.firmwareFamily !==
        String(
          returnState?.firmwareFamily ?? state?.firmwareFamily ?? "",
        ).toLowerCase() ||
      !isMissionMode(state?.modeName) ||
      !isReturnMode(returnState?.modeName) ||
      !checkpointSequenceBeforeCompletion(
        sequence,
        state,
        this.registration.mission,
      ) ||
      !bootClockElapsedMatches(
        state?.timeBootMs,
        stateObservedAt,
        returnState?.timeBootMs,
        returnStateObservedAt,
      )
    ) {
      return null;
    }
    const systemId = finiteInteger(returnState?.systemId ?? state?.systemId);
    if (systemId !== this.registration.systemId) return null;
    const bootGeneration =
      finiteInteger(returnState?.bootGeneration ?? state?.bootGeneration) ?? 0;
    if (bootGeneration !== this.registration.bootGeneration) return null;
    const missionTotal = finiteInteger(state?.missionTotal);
    if (
      missionTotal != null &&
      missionTotal !== this.registration.mission.length
    ) {
      return null;
    }
    const timeBootMs = finiteNumberOrNull(
      returnState?.timeBootMs ??
        state?.timeBootMs ??
        this.registration.timeBootMs,
    );
    if (timeBootMs == null) return null;

    this.activeCheckpoint = {
      sequence,
      estimated: !!estimated,
      tentative: !estimated,
      firmwareFamily: this.registration.firmwareFamily,
      systemId,
      missionFingerprint: this.registration.fingerprint,
      missionId: finiteInteger(state?.missionId ?? this.registration.missionId),
      missionMode: finiteInteger(
        state?.missionMode ?? this.registration.missionMode,
      ),
      missionTotal: this.registration.mission.length,
      timeBootMs,
      bootGeneration,
      vehicleIdentity:
        vehicleIdentityFrom(returnState) ??
        vehicleIdentityFrom(state) ??
        this.registration.vehicleIdentity,
      fromMode: normalizeMissionMode(state?.modeName),
      returnMode: normalizeMissionMode(returnState?.modeName),
      source,
      capturedAt: this.now(),
    };
    this.status = RESUME_STATUS.CHECKPOINT;
    this.message = estimated
      ? `Estimated mission resume checkpoint saved at item ${sequence + 1}.`
      : `Potential interruption detected at item ${sequence + 1}; waiting for mission-progress confirmation.`;
    this.lastError = null;
    this.emitUpdate("checkpoint-captured");
    return cloneCheckpoint(this.activeCheckpoint);
  }

  validateCheckpoint(options = {}) {
    if (!this.activeCheckpoint) {
      throw resumeError(
        "NO_CHECKPOINT",
        "No mission resume checkpoint is available.",
      );
    }
    if (!this.registration) {
      throw resumeError(
        "MISSION_NOT_REGISTERED",
        "The onboard mission associated with this checkpoint is no longer registered.",
        { clearCheckpoint: true },
      );
    }
    const state = {
      ...stateSnapshot(this.session),
      ...(options.state ?? {}),
    };
    if (this.transportDetached || !state.connected || state.linkLost) {
      throw resumeError(
        "LINK_UNAVAILABLE",
        "Reconnect the same MAVLink vehicle before resuming the mission.",
      );
    }
    const checkpoint = this.activeCheckpoint;
    if (checkpoint.tentative) {
      throw resumeError(
        "CHECKPOINT_PENDING",
        "Waiting for a current mission-progress update to confirm that RTL interrupted the mission rather than completing it.",
      );
    }
    if (
      systemIdFrom(state) !== checkpoint.systemId ||
      this.registration.systemId !== checkpoint.systemId
    ) {
      throw resumeError(
        "SYSTEM_CHANGED",
        "The connected MAVLink system does not match the vehicle that created this checkpoint.",
        { clearCheckpoint: true },
      );
    }
    if (
      firmwareFamilyFrom(state) !== checkpoint.firmwareFamily ||
      this.registration.firmwareFamily !== checkpoint.firmwareFamily
    ) {
      throw resumeError(
        "FIRMWARE_CHANGED",
        "The connected firmware family does not match the saved mission checkpoint.",
        { clearCheckpoint: true },
      );
    }
    const vehicleIdentity = vehicleIdentityFrom(state);
    if (checkpoint.vehicleIdentity != null && vehicleIdentity == null) {
      throw resumeError(
        "VEHICLE_IDENTITY_UNAVAILABLE",
        "Waiting for the flight controller hardware identity before validating mission resume.",
      );
    }
    if (
      checkpoint.vehicleIdentity != null &&
      vehicleIdentity !== checkpoint.vehicleIdentity
    ) {
      throw resumeError(
        "SYSTEM_CHANGED",
        "The connected flight-controller hardware identity does not match the vehicle that created this checkpoint.",
        { clearCheckpoint: true },
      );
    }
    const bootGeneration = finiteInteger(state.bootGeneration) ?? 0;
    if (
      !checkpoint.transportDetached &&
      (bootGeneration !== checkpoint.bootGeneration ||
        bootGeneration !== this.registration.bootGeneration)
    ) {
      throw resumeError(
        "VEHICLE_REBOOTED",
        "The flight controller rebooted after the checkpoint was saved; resume is no longer valid.",
        { clearCheckpoint: true },
      );
    }
    const currentBootMs = finiteNumberOrNull(state.timeBootMs);
    if (checkpoint.timeBootMs == null || currentBootMs == null) {
      throw resumeError(
        "BOOT_CLOCK_UNAVAILABLE",
        "Mission resume requires the flight controller boot clock to prove that controller power was not lost.",
      );
    }
    if (!bootClockMatchesHostElapsed(checkpoint, currentBootMs, this.now())) {
      throw resumeError(
        "VEHICLE_REBOOTED",
        "The flight controller boot clock did not advance with elapsed time; continuous controller power cannot be proven.",
        { clearCheckpoint: true },
      );
    }
    if (this.registration.fingerprint !== checkpoint.missionFingerprint) {
      throw resumeError(
        "MISSION_CHANGED",
        "The registered mission no longer matches the mission checkpoint.",
        { clearCheckpoint: true },
      );
    }
    const missionTotal = finiteInteger(state.missionTotal);
    if (
      checkpoint.missionTotal !== this.registration.mission.length ||
      (missionTotal != null && missionTotal !== checkpoint.missionTotal)
    ) {
      throw resumeError(
        "MISSION_CHANGED",
        "The controller mission item count changed after the checkpoint was saved.",
        { clearCheckpoint: true },
      );
    }
    const missionId = finiteInteger(state.missionId);
    if (
      checkpoint.missionId != null &&
      missionId != null &&
      missionId !== checkpoint.missionId
    ) {
      throw resumeError(
        "MISSION_CHANGED",
        "The controller mission ID changed after the checkpoint was saved.",
        { clearCheckpoint: true },
      );
    }
    const missionMode = finiteInteger(state.missionMode);
    if (
      checkpoint.missionMode != null &&
      missionMode != null &&
      missionMode !== checkpoint.missionMode
    ) {
      throw resumeError(
        "MISSION_CHANGED",
        "The controller mission type changed after the checkpoint was saved.",
        { clearCheckpoint: true },
      );
    }
    if (
      !checkpointSequenceBeforeCompletion(
        checkpoint.sequence,
        {},
        this.registration.mission,
      )
    ) {
      throw resumeError(
        "CHECKPOINT_COMPLETE",
        "The saved item is at or beyond mission completion and cannot be resumed.",
        { clearCheckpoint: true },
      );
    }
    this.validateCommandCapability(checkpoint);
    return {
      state,
      checkpoint: cloneCheckpoint(checkpoint),
      mission: cloneMission(this.registration.mission),
    };
  }

  validateCommandCapability(checkpoint) {
    if (typeof this.commandRouter?.capabilities !== "function") {
      throw resumeError(
        "RESUME_COMMAND_UNAVAILABLE",
        "The mission-resume command capability is unavailable.",
      );
    }
    const capabilities = this.commandRouter.capabilities();
    if (capabilities?.canResumeMission !== true) {
      throw resumeError(
        "RESUME_COMMAND_UNAVAILABLE",
        capabilities?.missionResumeReason ??
          capabilities?.reason ??
          "The connected vehicle does not expose canResumeMission.",
      );
    }
    if (
      checkpoint.firmwareFamily === "inav" &&
      capabilities.canAbortMissionResume !== true
    ) {
      throw resumeError(
        "RESUME_ABORT_UNAVAILABLE",
        capabilities.missionResumeAbortReason ??
          "INAV mission resume requires a confirmed RTH or non-mission mode that can replace a failed NAV WP override.",
      );
    }
    return capabilities;
  }

  availability(options = {}) {
    try {
      const validated = this.validateCheckpoint(options);
      if (
        validated.checkpoint.firmwareFamily === "inav" &&
        (this.normalizeInavMission(validated.mission),
        !inavResumeSuffix(validated.mission, validated.checkpoint.sequence))
      ) {
        return {
          available: false,
          reason:
            "The estimated INAV checkpoint cannot be resumed safely: the remaining mission must contain only waypoints and an optional final RTL.",
          checkpoint: validated.checkpoint,
        };
      }
      return {
        available: true,
        reason: "",
        checkpoint: validated.checkpoint,
      };
    } catch (error) {
      if (options.mutate && error?.clearCheckpoint) {
        this.clearCheckpoint(error.message, {
          reason: "checkpoint-validation-failed",
          keepError: true,
        });
      }
      return {
        available: false,
        reason: error.message,
        checkpoint: this.getCheckpoint(),
        error,
      };
    }
  }

  async downloadAndVerifyRegisteredMission(validated) {
    if (typeof this.missionManager?.download !== "function") {
      throw resumeError(
        "MISSION_SERVICE_UNAVAILABLE",
        "Mission resume cannot verify the onboard mission because mission download is unavailable.",
      );
    }
    const inav = validated.checkpoint.firmwareFamily === "inav";
    const downloaded = await this.missionManager.download(
      inav ? { legacyOnly: true } : {},
    );
    if (
      fingerprintMission(downloaded) !== this.registration.fingerprint ||
      canonicalMission(downloaded) !== this.registration.canonical
    ) {
      throw resumeError(
        "MISSION_CHANGED",
        "The onboard mission changed after the resume checkpoint was saved.",
        { clearCheckpoint: true },
      );
    }
    return cloneMission(downloaded);
  }

  resume(options = {}) {
    if (this.resumeInFlight) return this.resumeInFlight;
    const operation = this.operationCoordinator.acquire("mission resume");
    if (!operation) {
      const error = resumeError(
        "MISSION_OPERATION_BUSY",
        this.operationCoordinator.busyMessage("mission resume"),
      );
      this.status = RESUME_STATUS.ERROR;
      this.message = error.message;
      this.lastError = error;
      this.emitUpdate("resume-blocked");
      return Promise.reject(error);
    }
    this.resumeInFlight = this.resumeUnlocked(options).finally(() => {
      operation.release();
      this.resumeInFlight = null;
      this.emitUpdate("resume-idle");
    });
    this.emitUpdate("resume-started");
    return this.resumeInFlight;
  }

  resumeFromCheckpoint(options = {}) {
    return this.resume(options);
  }

  async resumeUnlocked(options = {}) {
    let validated;
    try {
      validated = this.validateCheckpoint(options);
    } catch (error) {
      if (error?.clearCheckpoint) {
        this.clearCheckpoint(error.message, {
          reason: "checkpoint-validation-failed",
          keepError: true,
        });
      }
      this.status = RESUME_STATUS.ERROR;
      this.message = error.message;
      this.lastError = error;
      this.emitUpdate("resume-failed");
      throw error;
    }
    this.status = RESUME_STATUS.RESUMING;
    this.message = `Verifying mission item ${validated.checkpoint.sequence + 1} before resume…`;
    this.lastError = null;
    this.emitUpdate("resume-verifying");
    try {
      const mission = await this.downloadAndVerifyRegisteredMission(validated);
      return validated.checkpoint.firmwareFamily === "ardupilot"
        ? await this.resumeArduPilot(validated, mission, options)
        : await this.resumeInav(validated, mission, options);
    } catch (error) {
      if (error?.clearCheckpoint) {
        this.clearCheckpoint(error.message, {
          reason: "checkpoint-validation-failed",
          keepError: true,
        });
      }
      this.status = RESUME_STATUS.ERROR;
      this.message = error.message;
      this.lastError = error;
      this.emitUpdate("resume-failed");
      throw error;
    }
  }

  async resumeArduPilot(validated, mission, options) {
    if (typeof this.commandRouter?.resumeMissionFrom !== "function") {
      throw resumeError(
        "RESUME_COMMAND_UNAVAILABLE",
        "The ArduPilot mission-resume command service is unavailable.",
      );
    }
    this.message = "Re-reading ArduPilot MIS_RESTART before exact resume…";
    this.emitUpdate("ardupilot-policy-verifying");
    const restartPolicy = await this.requireArduPilotResumePolicy(options);
    const checkpoint = cloneCheckpoint(validated.checkpoint);
    const commandResult = await this.commandRouter.resumeMissionFrom(
      checkpoint.sequence,
      { ...options, checkpoint },
    );
    const executionPending = stateSnapshot(this.session).armed === false;
    this.activeCheckpoint = null;
    this.status = RESUME_STATUS.RESUMED;
    this.message = executionPending
      ? `ArduPilot resume item ${checkpoint.sequence + 1} selected and AUTO confirmed; arm/launch is required before mission execution.`
      : `ArduPilot mission resumed from item ${checkpoint.sequence + 1}.`;
    this.lastError = null;
    const result = {
      ok: true,
      firmwareFamily: "ardupilot",
      exact: true,
      estimated: false,
      executionPending,
      sequence: checkpoint.sequence,
      checkpoint,
      restartPolicy,
      commandResult,
    };
    this.emitUpdate("resume-succeeded", { result });
    return result;
  }

  async requireArduPilotResumePolicy(options = {}) {
    if (typeof this.parameterManager?.request !== "function") {
      throw resumeError(
        "ARDUPILOT_MIS_RESTART_UNAVAILABLE",
        "Exact ArduPilot resume was blocked because MIS_RESTART could not be read. Open Flight Planner, read the ArduPilot interruption policy, and set it to RESUME (0).",
      );
    }
    let parameter;
    try {
      parameter = await this.parameterManager.request(
        ARDUPILOT_MISSION_RESTART_PARAMETER,
        options.parameterTimeoutMs ?? 3000,
      );
    } catch (error) {
      throw resumeError(
        "ARDUPILOT_MIS_RESTART_UNAVAILABLE",
        "Exact ArduPilot resume was blocked because the controller did not confirm MIS_RESTART. Reconnect, then read the ArduPilot interruption policy in Flight Planner before trying again.",
        { cause: error },
      );
    }
    const value = Number(parameter?.value);
    if (!Number.isInteger(value) || ![0, 1].includes(value)) {
      throw resumeError(
        "ARDUPILOT_MIS_RESTART_UNSUPPORTED",
        `Exact ArduPilot resume was blocked because the controller returned unsupported MIS_RESTART value ${String(parameter?.value)}. No resume command was sent.`,
      );
    }
    if (value !== 0) {
      throw resumeError(
        "ARDUPILOT_MIS_RESTART_RESTART",
        "Exact ArduPilot resume requires MIS_RESTART = 0 (RESUME), but the controller confirmed MIS_RESTART = 1 (RESTART). Change and verify the policy in Flight Planner before trying again.",
      );
    }
    return {
      id: ARDUPILOT_MISSION_RESTART_PARAMETER,
      value,
      type: parameter?.type,
    };
  }

  normalizeInavMission(mission) {
    const normalized = filterExpectedMissionForProtocol(mission, "mavlink", {
      firmwareProfile: "inav",
    });
    if (normalized.length !== mission.length) {
      throw resumeError(
        "INAV_MISSION_UNSUPPORTED",
        "INAV resume refuses to omit unsupported active mission items.",
      );
    }
    if (canonicalMission(normalized) !== canonicalMission(mission)) {
      throw resumeError(
        "INAV_MISSION_NORMALIZATION_LOSS",
        "INAV resume refuses to alter the mission because its active items cannot be represented losslessly by the INAV MAVLink mission profile.",
      );
    }
    return normalized;
  }

  setAuthoritativeMissionTotal(value) {
    const missionTotal = finiteInteger(value);
    if (missionTotal == null) return;
    if (this.session?.state) {
      this.session.state.missionTotal = missionTotal;
    }
    if (this.lastSessionState) {
      this.lastSessionState.missionTotal = missionTotal;
    }
  }

  replaceRegistrationMission(mission, source) {
    if (!this.registration) return;
    const clonedMission = cloneMission(mission);
    const fingerprint = fingerprintMission(clonedMission);
    const changed = fingerprint !== this.registration.fingerprint;
    this.registration = {
      ...this.registration,
      mission: clonedMission,
      canonical: canonicalMission(clonedMission),
      fingerprint,
      missionTotal: clonedMission.length,
      source,
    };
    if (changed) {
      this.lastInavObservation = null;
      this.lastInavMissionReference = null;
    }
  }

  async replaceInavActiveMission(mission, options = {}) {
    if (
      typeof this.missionManager?.upload !== "function" ||
      typeof this.missionManager?.download !== "function"
    ) {
      throw resumeError(
        "MISSION_SERVICE_UNAVAILABLE",
        "INAV mission resume requires MAVLink mission upload and download services.",
      );
    }
    const normalized = this.normalizeInavMission(mission);
    await this.missionManager.upload(normalized, {
      legacyOnly: true,
      firmwareProfile: "inav",
      ...(options.uploadOptions ?? {}),
    });
    const readback = await this.missionManager.download({
      legacyOnly: true,
      ...(options.downloadOptions ?? {}),
    });
    assertMissionReadback(normalized, readback, {
      compareProtocolFields: true,
    });
    return cloneMission(readback);
  }

  async restoreInavMission(mission, options = {}) {
    try {
      return {
        restored: true,
        mission: await this.replaceInavActiveMission(mission, options),
        error: null,
      };
    } catch (error) {
      return {
        restored: false,
        mission: null,
        error,
      };
    }
  }

  async resumeInav(validated, mission, options) {
    const checkpoint = cloneCheckpoint(validated.checkpoint);
    const originalMission = this.normalizeInavMission(mission);
    const suffix = inavResumeSuffix(originalMission, checkpoint.sequence);
    if (!suffix) {
      throw resumeError(
        "INAV_SUFFIX_UNSAFE",
        "The estimated INAV checkpoint cannot be resumed safely: the remaining mission must contain only waypoints and an optional final RTL.",
      );
    }
    if (typeof this.commandRouter?.startMission !== "function") {
      throw resumeError(
        "RESUME_COMMAND_UNAVAILABLE",
        "The INAV mission-start command service is unavailable.",
      );
    }
    this.validateCommandCapability(checkpoint);
    this.message = `Writing and verifying ${suffix.length} remaining INAV mission items in active RAM…`;
    this.emitUpdate("inav-suffix-uploading");
    let transferStarted = false;
    let suffixWritten = false;
    let missionTotalChanged = false;
    let suffixReadback = null;
    try {
      transferStarted = true;
      suffixReadback = await this.replaceInavActiveMission(suffix, options);
      suffixWritten = true;
      this.setAuthoritativeMissionTotal(suffixReadback.length);
      missionTotalChanged = true;
      const commandResult = await this.commandRouter.startMission({
        ...options,
        checkpoint,
      });
      if (commandResult?.confirmed !== true) {
        throw resumeError(
          "INAV_RESUME_START_UNCONFIRMED",
          "INAV did not uniquely confirm NAV WP after the remaining mission was written.",
        );
      }
      const executionPending = stateSnapshot(this.session).armed === false;
      this.activeCheckpoint = null;
      this.registerMission(suffixReadback, {
        state: stateSnapshot(this.session),
        firmwareFamily: "inav",
        source: "inav-resumed-suffix",
      });
      this.status = RESUME_STATUS.RESUMED;
      this.message = executionPending
        ? `INAV remaining mission selected from estimated original item ${checkpoint.sequence + 1}; arm/launch is required before mission execution.`
        : `INAV mission resumed from estimated original item ${checkpoint.sequence + 1}.`;
      this.lastError = null;
      const result = {
        ok: true,
        firmwareFamily: "inav",
        exact: false,
        estimated: true,
        executionPending,
        originalSequence: checkpoint.sequence,
        resumedSequence: 0,
        remainingItems: suffixReadback.length,
        persistentMissionChanged: false,
        checkpoint,
        commandResult,
      };
      this.emitUpdate("resume-succeeded", { result });
      return result;
    } catch (error) {
      if (!transferStarted) throw error;
      if (missionTotalChanged) {
        let abortResult = null;
        let abortError = null;
        try {
          if (typeof this.commandRouter?.abortMissionResume !== "function") {
            throw new Error(
              "The INAV mission-resume abort service is unavailable.",
            );
          }
          abortResult = await this.commandRouter.abortMissionResume({
            ...options,
            checkpoint,
            cause: error,
          });
        } catch (abortFailure) {
          abortError = abortFailure;
        }
        if (abortResult?.confirmed !== true) {
          if (suffixReadback) {
            this.replaceRegistrationMission(
              suffixReadback,
              "inav-resume-abort-unconfirmed",
            );
            this.setAuthoritativeMissionTotal(suffixReadback.length);
          } else {
            this.registration = null;
          }
          throw resumeError(
            "INAV_RESUME_ABORT_UNCONFIRMED",
            "INAV mission start failed and a safe non-mission/RTH command state could not be confirmed. The original mission was not restored because doing so could start it unexpectedly.",
            {
              cause: error,
              clearCheckpoint: true,
              details: {
                abortConfirmed: false,
                abortResult,
                abortError,
                restoreAttempted: false,
              },
            },
          );
        }
      }
      const restored = await this.restoreInavMission(originalMission, options);
      const failurePoint = suffixWritten ? "start" : "transfer or verify";
      const resumeFailure = resumeError(
        restored.restored
          ? suffixWritten
            ? "INAV_RESUME_START_FAILED"
            : "INAV_RESUME_TRANSFER_FAILED"
          : "INAV_RESUME_RESTORE_FAILED",
        restored.restored
          ? `INAV remaining-mission ${failurePoint} failed; the original active mission was restored. ${error.message}`
          : `INAV remaining-mission ${failurePoint} failed and the original active mission could not be restored. ${error.message}`,
        {
          cause: error,
          clearCheckpoint: !restored.restored,
          details: {
            restoreSucceeded: restored.restored,
            restoreError: restored.error ?? null,
          },
        },
      );
      if (restored.restored) {
        this.replaceRegistrationMission(
          restored.mission,
          "inav-resume-restored",
        );
        this.setAuthoritativeMissionTotal(restored.mission.length);
      } else {
        this.registration = null;
      }
      throw resumeFailure;
    }
  }
}

export const missionResumeManager = new MissionResumeManager({
  session: mavlinkSession,
  commandRouter: mavlinkCommandRouter,
  missionManager: mavlinkMissionManager,
  parameterManager: mavlinkParameterManager,
});
