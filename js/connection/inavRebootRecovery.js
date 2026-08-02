"use strict";

export const INAV_REBOOT_RECONNECT_DELAY_MS = 5000;
export const INAV_REBOOT_MAX_OPEN_ATTEMPTS = 3;

export function createInavRebootRecoveryAttempt(openAttempt) {
  const protocol = openAttempt?.protocol;
  const port = String(openAttempt?.port ?? "").trim();
  const bitrate = Number(openAttempt?.bitrate);

  if (
    !["auto", "msp"].includes(protocol)
    || port === ""
    || !Number.isInteger(bitrate)
    || bitrate <= 0
  ) {
    return null;
  }

  return Object.freeze({
    protocol,
    port,
    bitrate,
    recoveryAttempt: 0,
    rebootRecoveryAttempt: 1,
  });
}

export function nextInavRebootRecoveryAttempt(openAttempt) {
  const attempt = Number(openAttempt?.rebootRecoveryAttempt);
  if (
    !Number.isInteger(attempt)
    || attempt < 1
    || attempt >= INAV_REBOOT_MAX_OPEN_ATTEMPTS
  ) {
    return null;
  }

  return Object.freeze({
    protocol: openAttempt.protocol,
    port: openAttempt.port,
    bitrate: openAttempt.bitrate,
    recoveryAttempt: 0,
    rebootRecoveryAttempt: attempt + 1,
  });
}
