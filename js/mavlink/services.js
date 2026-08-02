"use strict";

import mavlinkSession from "./mavlinkSession.js";
import { field } from "./frameNormalizer.js";
import { bindHostTimer } from "./hostTimers.js";

export const MAV_MISSION_TYPE_MISSION = 0;
export const MAV_MISSION_ACCEPTED = 0;
export const MAV_FRAME_GLOBAL = 0;
export const MAV_FRAME_MISSION = 2;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
export const MAV_FRAME_GLOBAL_INT = 5;
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;
export const MAV_CMD_NAV_WAYPOINT = 16;
export const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;

const INAV_MAVLINK_SUPPORTED_COMMANDS = new Set([
  MAV_CMD_NAV_WAYPOINT,
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
]);
const MISSION_COUNT_NAMES = new Set(["MISSION_COUNT", "MissionCount"]);
const MISSION_ITEM_NAMES = new Set([
  "MISSION_ITEM_INT",
  "MissionItemInt",
  "MISSION_ITEM",
  "MissionItem",
]);
const MISSION_REQUEST_NAMES = new Set([
  "MISSION_REQUEST_INT",
  "MissionRequestInt",
  "MISSION_REQUEST",
  "MissionRequest",
]);
const MISSION_ACK_NAMES = new Set(["MISSION_ACK", "MissionAck"]);

function timerUnref(timer) {
  timer?.unref?.();
  return timer;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function missionRequestName(attempt, options = {}) {
  if (options.legacyOnly) return "MissionRequest";
  if (options.legacyRequestFirst) {
    return attempt % 2 === 0 ? "MissionRequest" : "MissionRequestInt";
  }
  return attempt === 0 ? "MissionRequestInt" : "MissionRequest";
}

export function normalizeMissionItem(envelope) {
  const data = envelope.data;
  const integerCoordinates =
    envelope.messageName === "MISSION_ITEM_INT" ||
    envelope.messageName === "MissionItemInt";
  const x = finiteNumber(field(data, "x"));
  const y = finiteNumber(field(data, "y"));
  return {
    seq: Number(field(data, "seq")),
    frame: Number(field(data, "frame")),
    command: Number(field(data, "command")),
    current: Boolean(field(data, "current")),
    autocontinue: Boolean(field(data, "autocontinue")),
    param1: finiteNumber(field(data, "param1")),
    param2: finiteNumber(field(data, "param2")),
    param3: finiteNumber(field(data, "param3")),
    param4: finiteNumber(field(data, "param4"), Number.NaN),
    latitude: integerCoordinates ? x / 1e7 : x,
    longitude: integerCoordinates ? y / 1e7 : y,
    altitude: finiteNumber(field(data, "z")),
    missionType: Number(
      field(data, "missionType", "mission_type") ?? MAV_MISSION_TYPE_MISSION,
    ),
  };
}

export function toMissionItemInt(item, sequence, target, missionType) {
  return {
    ...target,
    seq: sequence,
    frame: item.frame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
    command: item.command ?? MAV_CMD_NAV_WAYPOINT,
    current: item.current ? 1 : 0,
    autocontinue: item.autocontinue === false ? 0 : 1,
    param1: finiteNumber(item.param1),
    param2: finiteNumber(item.param2),
    param3: finiteNumber(item.param3),
    param4: Number(item.param4 ?? Number.NaN),
    x: Math.round(finiteNumber(item.latitude ?? item.lat) * 1e7),
    y: Math.round(finiteNumber(item.longitude ?? item.lon) * 1e7),
    z: finiteNumber(item.altitude ?? item.alt),
    missionType,
  };
}

export function toMissionItem(item, sequence, target, missionType) {
  const integerItem = toMissionItemInt(item, sequence, target, missionType);
  return {
    ...integerItem,
    frame:
      integerItem.frame === MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        ? MAV_FRAME_GLOBAL_RELATIVE_ALT
        : integerItem.frame === MAV_FRAME_GLOBAL_INT
          ? MAV_FRAME_GLOBAL
          : integerItem.frame,
    x: integerItem.x / 1e7,
    y: integerItem.y / 1e7,
  };
}

export function normalizeInavMissionUploadItem(item, index = 0) {
  const command = Number(item?.command ?? MAV_CMD_NAV_WAYPOINT);
  if (!INAV_MAVLINK_SUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `INAV MAVLink mission item ${index + 1} uses unsupported command ${command}; ` +
        "stock INAV accepts only waypoint (16) and return-to-launch (20).",
    );
  }
  return {
    ...item,
    command,
    frame:
      command === MAV_CMD_NAV_RETURN_TO_LAUNCH
        ? MAV_FRAME_MISSION
        : MAV_FRAME_GLOBAL_RELATIVE_ALT,
    autocontinue: true,
    latitude: finiteNumber(item?.latitude ?? item?.lat),
    longitude: finiteNumber(item?.longitude ?? item?.lon),
    altitude: finiteNumber(item?.altitude ?? item?.alt),
  };
}

function firmwareProfile(options, session) {
  const explicit = options?.firmwareProfile ?? options?.profile;
  return String(
    explicit != null && explicit !== ""
      ? explicit
      : (session?.state?.firmwareFamily ?? ""),
  )
    .trim()
    .toLowerCase();
}

export function isInavMission(options, session) {
  return ["inav", "inav-mavlink", "inav/mavlink"].includes(
    firmwareProfile(options, session),
  );
}

export function abortError(message = "Mission transaction was cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function withAbortSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => settle(reject, abortError());

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    );
  });
}

export class MavlinkMissionManager {
  constructor(session, options = {}) {
    if (
      !session?.state ||
      typeof session.on !== "function" ||
      typeof session.send !== "function" ||
      typeof session.target !== "function"
    ) {
      throw new TypeError(
        "A MAVLink session is required for mission transactions.",
      );
    }
    this.session = session;
    this.transactionTail = Promise.resolve();
    this.setTimeoutFn = options.setTimeoutFn ?? bindHostTimer("setTimeout");
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? bindHostTimer("clearTimeout");
  }

  targetMatches(envelope) {
    const systemId = this.session.state.systemId;
    return (
      systemId == null ||
      envelope.header?.sysid == null ||
      envelope.header.sysid === systemId
    );
  }

  missionTypeMatches(envelope, missionType) {
    return (
      Number(
        field(envelope.data, "missionType", "mission_type") ??
          MAV_MISSION_TYPE_MISSION,
      ) === missionType
    );
  }

  runTransaction(operation, signal) {
    // Subscribe when the operation is queued, not when it reaches the front of
    // the transaction chain. A queued operation from attachment A must not
    // silently start against attachment B after a reconnect.
    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    const unsubscribeDetached = this.session.on("detached", abort);
    let callerAbortListener = null;
    if (signal) {
      callerAbortListener = abort;
      signal.addEventListener("abort", callerAbortListener, { once: true });
      if (signal.aborted) abort();
    }
    const cleanup = () => {
      unsubscribeDetached();
      if (callerAbortListener) {
        signal.removeEventListener("abort", callerAbortListener);
        callerAbortListener = null;
      }
    };
    const transaction = this.transactionTail
      .then(async () => {
        throwIfAborted(controller.signal);
        return operation(controller.signal);
      })
      .finally(cleanup);
    this.transactionTail = transaction.catch(() => {});
    return transaction;
  }

  createResponseWaiter(messageNames, predicate, timeoutMs, signal) {
    throwIfAborted(signal);
    const names = new Set(
      Array.isArray(messageNames) ? messageNames : [messageNames],
    );
    let settled = false;
    let timer = null;
    let unsubscribe = () => {};
    let abortListener = null;
    let rejectPromise = () => {};

    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        unsubscribe();
        if (abortListener) signal?.removeEventListener("abort", abortListener);
        callback(value);
      };
      unsubscribe = this.session.on("message", (envelope) => {
        if (!names.has(envelope.messageName)) return;
        try {
          if (predicate(envelope)) settle(resolve, envelope);
        } catch (error) {
          settle(reject, error);
        }
      });
      timer = timerUnref(
        this.setTimeoutFn(
          () => settle(reject, new Error("Mission response timed out.")),
          timeoutMs,
        ),
      );
      if (signal) {
        abortListener = () => settle(reject, abortError());
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) abortListener();
      }
    });

    return {
      promise,
      cancel: (reason = new Error("Mission response wait was cancelled.")) => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        unsubscribe();
        if (abortListener) signal?.removeEventListener("abort", abortListener);
        rejectPromise(reason);
      },
    };
  }

  async requestAndWait(
    requestName,
    payload,
    responseNames,
    predicate,
    timeoutMs,
    signal,
  ) {
    const waiter = this.createResponseWaiter(
      responseNames,
      predicate,
      timeoutMs,
      signal,
    );
    try {
      await withAbortSignal(
        this.session.send(requestName, payload),
        signal,
      );
    } catch (error) {
      const transactionError = signal?.aborted ? abortError() : error;
      waiter.cancel(transactionError);
      await waiter.promise.catch(() => {});
      throw transactionError;
    }
    return waiter.promise;
  }

  download(options = {}) {
    return this.runTransaction(
      (signal) => this.downloadUnlocked({ ...options, signal }),
      options.signal,
    );
  }

  async downloadUnlocked(options = {}) {
    const {
      missionType = MAV_MISSION_TYPE_MISSION,
      timeoutMs = 4000,
      retries = 3,
      onProgress = () => {},
      legacyRequestFirst = false,
      signal,
    } = options;
    const legacyOnly = Boolean(
      options.legacyOnly || isInavMission(options, this.session),
    );
    const target = this.session.target();

    let countEnvelope = null;
    let countError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        countEnvelope = await this.requestAndWait(
          "MissionRequestList",
          { ...target, missionType },
          [...MISSION_COUNT_NAMES],
          (envelope) =>
            this.targetMatches(envelope) &&
            this.missionTypeMatches(envelope, missionType),
          timeoutMs,
          signal,
        );
        countError = null;
        break;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        countError = error;
      }
    }
    if (countError) {
      throw new Error(
        `Mission list request failed after ${retries + 1} attempts: ${countError.message}`,
      );
    }

    const count = Number(field(countEnvelope.data, "count"));
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `Autopilot reported invalid mission count ${field(countEnvelope.data, "count")}.`,
      );
    }

    const items = new Array(count);
    for (let sequence = 0; sequence < count; sequence += 1) {
      let itemError = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const requestName = missionRequestName(attempt, {
            legacyRequestFirst,
            legacyOnly,
          });
          const envelope = await this.requestAndWait(
            requestName,
            { ...target, seq: sequence, missionType },
            [...MISSION_ITEM_NAMES],
            (candidate) =>
              this.targetMatches(candidate) &&
              this.missionTypeMatches(candidate, missionType) &&
              Number(field(candidate.data, "seq")) === sequence,
            timeoutMs,
            signal,
          );
          items[sequence] = normalizeMissionItem(envelope);
          onProgress({
            completed: sequence + 1,
            total: count,
            item: items[sequence],
          });
          itemError = null;
          break;
        } catch (error) {
          if (error.name === "AbortError") throw error;
          itemError = error;
        }
      }
      if (itemError) {
        throw new Error(
          `Mission download failed at item ${sequence}: ${itemError.message}`,
        );
      }
    }

    throwIfAborted(signal);
    await withAbortSignal(
      this.session.send("MissionAck", {
        ...target,
        type: MAV_MISSION_ACCEPTED,
        missionType,
      }),
      signal,
    );
    throwIfAborted(signal);
    return items;
  }

  upload(items, options = {}) {
    return this.runTransaction(
      (signal) => this.uploadUnlocked(items, { ...options, signal }),
      options.signal,
    );
  }

  async uploadUnlocked(items, options = {}) {
    if (!Array.isArray(items))
      throw new TypeError("Mission upload requires an array.");
    if (items.length === 0) {
      throw new Error("Mission upload is empty; use mission clear instead.");
    }

    const {
      missionType = MAV_MISSION_TYPE_MISSION,
      timeoutMs = 30000,
      onProgress = () => {},
      initialRetries = 2,
      initialRetryMs = Math.min(1000, Math.max(100, Math.floor(timeoutMs / 4))),
      signal,
    } = options;
    throwIfAborted(signal);

    const target = this.session.target();
    const inav = isInavMission(options, this.session);
    const legacyOnly = Boolean(options.legacyOnly || inav);
    const normalizedItems = inav
      ? items.map(normalizeInavMissionUploadItem)
      : items.map((item) => ({ ...item }));
    const integerItems = normalizedItems.map((item, sequence) =>
      toMissionItemInt(item, sequence, target, missionType),
    );
    const legacyItems = normalizedItems.map((item, sequence) =>
      toMissionItem(item, sequence, target, missionType),
    );

    return new Promise((resolve, reject) => {
      let timeout = null;
      let initialRetry = null;
      let settled = false;
      let requestReceived = false;
      let countSends = 0;
      let unsubscribe = () => {};
      let abortListener = null;
      const completed = new Set();

      const cleanup = () => {
        this.clearTimeoutFn(timeout);
        this.clearTimeoutFn(initialRetry);
        unsubscribe();
        if (abortListener) signal?.removeEventListener("abort", abortListener);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const resetTimeout = () => {
        this.clearTimeoutFn(timeout);
        timeout = timerUnref(
          this.setTimeoutFn(
            () =>
              fail(
                new Error(
                  "Mission upload timed out waiting for the autopilot.",
                ),
              ),
            timeoutMs,
          ),
        );
      };
      const sendCount = async () => {
        if (settled || requestReceived) return;
        countSends += 1;
        resetTimeout();
        try {
          await this.session.send("MissionCount", {
            ...target,
            count: normalizedItems.length,
            missionType,
          });
        } catch (error) {
          fail(error);
          return;
        }
        if (!settled && !requestReceived && countSends <= initialRetries) {
          initialRetry = timerUnref(
            this.setTimeoutFn(sendCount, initialRetryMs),
          );
        }
      };

      unsubscribe = this.session.on("message", (envelope) => {
        if (
          !this.targetMatches(envelope) ||
          !this.missionTypeMatches(envelope, missionType)
        )
          return;

        if (MISSION_ACK_NAMES.has(envelope.messageName)) {
          requestReceived = true;
          this.clearTimeoutFn(initialRetry);
          const result = Number(field(envelope.data, "type"));
          if (result === MAV_MISSION_ACCEPTED) finish(envelope.data);
          else {
            fail(
              new Error(
                `Autopilot rejected the mission with MAV_MISSION_RESULT ${result}.`,
              ),
            );
          }
          return;
        }
        if (!MISSION_REQUEST_NAMES.has(envelope.messageName)) return;

        requestReceived = true;
        this.clearTimeoutFn(initialRetry);
        const sequence = Number(field(envelope.data, "seq"));
        if (
          !Number.isInteger(sequence) ||
          sequence < 0 ||
          sequence >= normalizedItems.length
        ) {
          fail(
            new Error(
              `Autopilot requested invalid mission sequence ${sequence}.`,
            ),
          );
          return;
        }

        const wantsInteger =
          (envelope.messageName === "MISSION_REQUEST_INT" ||
            envelope.messageName === "MissionRequestInt") &&
          !legacyOnly;
        resetTimeout();
        this.session
          .send(
            wantsInteger ? "MissionItemInt" : "MissionItem",
            wantsInteger ? integerItems[sequence] : legacyItems[sequence],
          )
          .then(() => {
            if (settled) return;
            completed.add(sequence);
            onProgress({
              completed: completed.size,
              total: normalizedItems.length,
              item: normalizedItems[sequence],
            });
          })
          .catch(fail);
      });

      if (signal) {
        abortListener = () => fail(abortError());
        signal.addEventListener("abort", abortListener, { once: true });
      }
      if (signal?.aborted) {
        fail(abortError());
        return;
      }
      sendCount();
    });
  }

  clear(options = {}) {
    return this.runTransaction(
      (signal) => this.clearUnlocked({ ...options, signal }),
      options.signal,
    );
  }

  async clearUnlocked(options = {}) {
    const {
      missionType = MAV_MISSION_TYPE_MISSION,
      timeoutMs = 5000,
      retries = 3,
      verifyDelayMs = 150,
      legacyRequestFirst = false,
      signal,
    } = options;
    const inav = isInavMission(options, this.session);
    const legacyOnly = Boolean(options.legacyOnly || inav);
    const volatile = Boolean(options.volatile || inav);
    const target = this.session.target();

    let acknowledgement = null;
    let clearError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        acknowledgement = await this.requestAndWait(
          "MissionClearAll",
          { ...target, missionType },
          [...MISSION_ACK_NAMES],
          (envelope) =>
            this.targetMatches(envelope) &&
            this.missionTypeMatches(envelope, missionType),
          timeoutMs,
          signal,
        );
        clearError = null;
        break;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        clearError = error;
      }
    }
    if (clearError) {
      throw new Error(
        `Mission clear timed out after ${retries + 1} attempts: ${clearError.message}`,
      );
    }
    const result = Number(field(acknowledgement.data, "type"));
    if (result !== MAV_MISSION_ACCEPTED) {
      throw new Error(
        `Autopilot rejected mission clear with MAV_MISSION_RESULT ${result}.`,
      );
    }

    if (verifyDelayMs > 0) {
      await new Promise((resolve, reject) => {
        let settled = false;
        let abortListener = null;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          this.clearTimeoutFn(timer);
          if (abortListener)
            signal?.removeEventListener("abort", abortListener);
          callback(value);
        };
        const timer = timerUnref(
          this.setTimeoutFn(() => finish(resolve), verifyDelayMs),
        );
        if (signal) {
          abortListener = () => finish(reject, abortError());
          signal.addEventListener("abort", abortListener, { once: true });
          if (signal.aborted) abortListener();
        }
      });
    }

    const remaining = await this.downloadUnlocked({
      missionType,
      timeoutMs,
      retries,
      legacyRequestFirst,
      legacyOnly,
      signal,
    });
    if (remaining.length !== 0) {
      throw new Error(
        `Mission clear verification failed: the autopilot still reports ${remaining.length} items.`,
      );
    }
    return {
      ...acknowledgement.data,
      cleared: true,
      verified: true,
      storage: volatile ? "volatile" : "persistent",
      persistent: !volatile,
      ...(volatile ? { volatile: true } : {}),
    };
  }
}

export const mavlinkMissionManager = new MavlinkMissionManager(mavlinkSession);
