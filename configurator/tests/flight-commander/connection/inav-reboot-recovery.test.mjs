import assert from "node:assert/strict";
import test from "node:test";

import {
  INAV_REBOOT_MAX_OPEN_ATTEMPTS,
  INAV_REBOOT_RECONNECT_DELAY_MS,
  createInavRebootRecoveryAttempt,
  nextInavRebootRecoveryAttempt,
} from "../../../js/connection/inavRebootRecovery.js";

test("INAV reboot recovery preserves the exact MSP serial endpoint", () => {
  const attempt = createInavRebootRecoveryAttempt({
    protocol: "msp",
    port: "COM7",
    bitrate: 460800,
    recoveryAttempt: 9,
  });

  assert.deepEqual(attempt, {
    protocol: "msp",
    port: "COM7",
    bitrate: 460800,
    recoveryAttempt: 0,
    rebootRecoveryAttempt: 1,
  });
  assert.ok(Object.isFrozen(attempt));
  assert.equal(INAV_REBOOT_RECONNECT_DELAY_MS, 5000);
});

test("INAV reboot recovery is bounded to three full open attempts", () => {
  const first = createInavRebootRecoveryAttempt({
    protocol: "auto",
    port: "COM7",
    bitrate: 115200,
  });
  const second = nextInavRebootRecoveryAttempt(first);
  const third = nextInavRebootRecoveryAttempt(second);

  assert.equal(INAV_REBOOT_MAX_OPEN_ATTEMPTS, 3);
  assert.equal(first.rebootRecoveryAttempt, 1);
  assert.equal(second.rebootRecoveryAttempt, 2);
  assert.equal(third.rebootRecoveryAttempt, 3);
  assert.equal(nextInavRebootRecoveryAttempt(third), null);
});

test("reboot recovery never hijacks MAVLink or an invalid serial target", () => {
  assert.equal(createInavRebootRecoveryAttempt({
    protocol: "mavlink",
    port: "COM7",
    bitrate: 460800,
  }), null);
  assert.equal(createInavRebootRecoveryAttempt({
    protocol: "msp",
    port: "",
    bitrate: 460800,
  }), null);
  assert.equal(createInavRebootRecoveryAttempt({
    protocol: "msp",
    port: "COM7",
    bitrate: 0,
  }), null);
});
