import assert from "node:assert/strict";
import test from "node:test";

import {
  ardupilotGpsFixName,
  ardupilotRssiPercent,
  ardupilotSensorStatusRows,
  ardupilotSystemStatusName,
  formatArduPilotBootTime,
  recentArduPilotReadinessMessages,
} from "../../../js/ardupilot/statusModel.js";

test("ArduPilot status turns SYS_STATUS masks into readable sensor health", () => {
  assert.equal(
    ardupilotSensorStatusRows({})[0].status,
    "unknown",
  );
  const mask = (2 ** 0) + (2 ** 1) + (2 ** 5) + (2 ** 16);
  const healthy = mask - (2 ** 5);
  const rows = ardupilotSensorStatusRows({
    sensorsPresent: mask,
    sensorsEnabled: mask,
    sensorsHealthy: healthy,
  });
  assert.equal(rows.find((row) => row.id === "gyro").status, "healthy");
  assert.equal(rows.find((row) => row.id === "gps").status, "unhealthy");
  assert.equal(rows.find((row) => row.id === "compass").status, "unavailable");
});

test("status labels, link percentages, and uptime remain human readable", () => {
  assert.equal(ardupilotSystemStatusName(4), "Active");
  assert.equal(ardupilotGpsFixName(6), "RTK fixed");
  assert.equal(ardupilotRssiPercent(128), 50);
  assert.equal(ardupilotRssiPercent(255), 100);
  assert.equal(formatArduPilotBootTime(3_661_000), "01:01:01");
});

test("readiness messages keep the newest unique ArduPilot warnings", () => {
  const entries = [
    { text: "EKF3 IMU0 is using GPS" },
    { text: "PreArm: Compass not calibrated" },
    { text: "PreArm: Compass not calibrated" },
    { text: "Mission accepted" },
    { text: "Battery failsafe" },
  ];
  assert.deepEqual(
    recentArduPilotReadinessMessages(entries).map((entry) => entry.text),
    [
      "EKF3 IMU0 is using GPS",
      "PreArm: Compass not calibrated",
      "Battery failsafe",
    ],
  );
});
