import { bindHostTimer } from "../mavlink/hostTimers.js";

export function initializeExplicitMavlinkTransport(options = {}) {
  const {
    showWaitingState,
    scheduleNoHeartbeatTimeout,
    attachSession,
    onFailure,
  } = options;
  for (const [name, value] of Object.entries({
    showWaitingState,
    scheduleNoHeartbeatTimeout,
    attachSession,
    onFailure,
  })) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function.`);
    }
  }

  try {
    // The operator-visible waiting state and recovery timeout must exist before
    // any renderer subscriber or transport hook can fail synchronously.
    showWaitingState();
    scheduleNoHeartbeatTimeout();
    attachSession();
    return { ok: true, error: null };
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Failure reporting is deliberately isolated from the serial callback.
    }
    return { ok: false, error };
  }
}

export function runCriticalMavlinkTransition(options = {}) {
  const { transition, onFailure } = options;
  if (typeof transition !== "function" || typeof onFailure !== "function") {
    throw new TypeError("transition and onFailure must be functions.");
  }
  try {
    transition();
    return { ok: true, error: null };
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Preserve a contained result even if UI error reporting also fails.
    }
    return { ok: false, error };
  }
}

export function queueGroundControlActivation(options = {}) {
  const {
    isCurrent,
    isBusy,
    isOpen,
    activate,
    schedule = bindHostTimer("setTimeout"),
    cancelSchedule = bindHostTimer("clearTimeout"),
    retryDelayMs = 100,
    maxAttempts = 300,
    onExhausted = () => {},
  } = options;
  for (const [name, value] of Object.entries({
    isCurrent,
    isBusy,
    isOpen,
    activate,
    schedule,
    cancelSchedule,
    onExhausted,
  })) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function.`);
    }
  }

  let canceled = false;
  let timer = null;
  let attempts = 0;
  const exhaust = (error = null) => {
    canceled = true;
    try {
      onExhausted(error);
    } catch {
      // Tab activation diagnostics must not wedge the connection lifecycle.
    }
  };
  const attempt = () => {
    timer = null;
    if (canceled || !isCurrent() || isOpen()) return;
    if (attempts >= maxAttempts) {
      exhaust();
      return;
    }
    attempts += 1;
    if (isBusy()) {
      try {
        timer = schedule(attempt, retryDelayMs);
      } catch (error) {
        exhaust(error);
      }
      return;
    }
    try {
      activate();
    } catch (error) {
      exhaust(error);
      return;
    }
    if (!isOpen() && isCurrent()) {
      try {
        timer = schedule(attempt, retryDelayMs);
      } catch (error) {
        exhaust(error);
      }
    }
  };
  attempt();

  return () => {
    canceled = true;
    if (timer != null) cancelSchedule(timer);
    timer = null;
  };
}
