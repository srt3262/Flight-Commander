import assert from "node:assert/strict";
import test from "node:test";

import {
  SERIAL_STARTUP_RECOVERY_DELAY_MS,
  SERIAL_STARTUP_RECOVERY_LIMIT,
  SERIAL_STARTUP_RECOVERY_WINDOW_MS,
  SERIAL_TERMINAL_OPERATOR_GUARD_MS,
  isUnexpectedNativeSerialTermination,
  shouldAttemptMavlinkStartupRecovery,
  unexpectedSerialTerminationMessage,
} from "../../../js/connection/serialRecoveryPolicy.js";

const nativeClose = Object.freeze({
  connectionId: 41,
  event: "close",
  origin: "native",
  expected: false,
  phase: "active",
  message: "The operating system closed the serial port",
});

test("one immediate native MAVLink close is eligible for bounded recovery", () => {
  assert.equal(SERIAL_STARTUP_RECOVERY_DELAY_MS, 1500);
  assert.equal(SERIAL_STARTUP_RECOVERY_WINDOW_MS, 5000);
  assert.equal(SERIAL_STARTUP_RECOVERY_LIMIT, 1);
  assert.equal(SERIAL_TERMINAL_OPERATOR_GUARD_MS, 500);
  assert.equal(isUnexpectedNativeSerialTermination(nativeClose), true);
  assert.equal(
    shouldAttemptMavlinkStartupRecovery({
      cause: nativeClose,
      openAttempt: {
        protocol: "mavlink",
        port: "COM8",
        bitrate: 460800,
        recoveryAttempt: 0,
      },
      connectedDurationMs: 1200,
      hadVehicleHeartbeat: false,
    }),
    true,
  );
});

test("recovery is denied after its single attempt or outside startup", () => {
  assert.equal(
    shouldAttemptMavlinkStartupRecovery({
      cause: nativeClose,
      openAttempt: {
        protocol: "mavlink",
        port: "COM8",
        bitrate: 460800,
        recoveryAttempt: 1,
      },
      connectedDurationMs: 1200,
      hadVehicleHeartbeat: false,
    }),
    false,
  );
  assert.equal(
    shouldAttemptMavlinkStartupRecovery({
      cause: nativeClose,
      openAttempt: {
        protocol: "mavlink",
        port: "COM8",
        bitrate: 460800,
        recoveryAttempt: 0,
      },
      connectedDurationMs: 6000,
      hadVehicleHeartbeat: false,
    }),
    false,
  );
});

test("intentional, non-native, and non-MAVLink closes never auto-reconnect", () => {
  for (const cause of [
    { ...nativeClose, expected: true },
    { ...nativeClose, origin: "renderer" },
    null,
  ]) {
    assert.equal(
      shouldAttemptMavlinkStartupRecovery({
        cause,
        openAttempt: {
          protocol: "mavlink",
          recoveryAttempt: 0,
        },
        connectedDurationMs: 1000,
        hadVehicleHeartbeat: false,
      }),
      false,
    );
  }
  assert.equal(
    shouldAttemptMavlinkStartupRecovery({
      cause: nativeClose,
      openAttempt: {
        protocol: "msp",
        recoveryAttempt: 0,
      },
      connectedDurationMs: 1000,
      hadVehicleHeartbeat: false,
    }),
    false,
  );
});

test("a native close after a real vehicle heartbeat never auto-reconnects", () => {
  assert.equal(
    shouldAttemptMavlinkStartupRecovery({
      cause: nativeClose,
      openAttempt: {
        protocol: "mavlink",
        port: "COM8",
        bitrate: 460800,
        recoveryAttempt: 0,
      },
      connectedDurationMs: 2000,
      hadVehicleHeartbeat: true,
    }),
    false,
  );
});

test("unexpected-close status preserves the port, phase, and native detail", () => {
  assert.equal(
    unexpectedSerialTerminationMessage(nativeClose, "COM8"),
    "Serial transport on COM8 closed unexpectedly during active: " +
      "The operating system closed the serial port. " +
      "The USB device may have reset or briefly re-enumerated.",
  );
});
