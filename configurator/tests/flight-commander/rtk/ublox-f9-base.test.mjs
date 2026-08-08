import assert from "node:assert/strict";
import test from "node:test";

import {
  buildF9BaseValset,
  buildUbxFrame,
  f9BaseConfigurationEntries,
  parseUbxAck,
  parseUbxMonVer,
  parseUbxNavSvin,
  UBLOX_F9_CONFIG_KEYS,
  UBX_CLASS_ACK,
  UBX_CLASS_CFG,
  UBX_ID_ACK_ACK,
  UBX_ID_CFG_VALSET,
  UbxParser,
} from "../../../js/rtk/ubloxF9Base.js";

function writeAscii(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  target.set(bytes.subarray(0, length), offset);
}

test("u-blox parser validates and reconstructs UBX frames", () => {
  const frame = buildUbxFrame(0x0a, 0x04, [1, 2, 3]);
  const received = [];
  const parser = new UbxParser({ onFrame: (value) => received.push(value) });
  parser.push(frame.subarray(0, 5));
  assert.equal(received.length, 0);
  parser.push(frame.subarray(5));
  assert.equal(received.length, 1);
  assert.equal(received[0].messageClass, 0x0a);
  assert.equal(received[0].messageId, 0x04);
  assert.deepEqual([...received[0].payload], [1, 2, 3]);
});

test("survey-in configuration enables USB RTCM MSM7 output", () => {
  const { entries } = f9BaseConfigurationEntries({
    mode: "survey-in",
    surveyInMinDurationS: 300,
    surveyInAccuracyM: 0.25,
    persist: true,
    constellations: { gps: true, glonass: false, galileo: true, beidou: false },
  });
  const byKey = new Map(entries.map((item) => [item.key, item.value]));
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_MODE), 1);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_SVIN_MIN_DUR), 300);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_SVIN_ACC_LIMIT), 2500);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.USB_OUT_RTCM3X), 1);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.USB_IN_RTCM3X), 0);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.MSGOUT_RTCM_1077_USB), 1);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.MSGOUT_RTCM_1087_USB), 0);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.MSGOUT_RTCM_1097_USB), 1);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.MSGOUT_RTCM_1127_USB), 0);
});

test("fixed base coordinates retain u-blox high-precision residuals", () => {
  const { entries } = f9BaseConfigurationEntries({
    mode: "fixed",
    latitude: 40.123456789,
    longitude: -105.987654321,
    ellipsoidHeightM: 1600.1234,
    fixedPositionAccuracyM: 0.01,
  });
  const byKey = new Map(entries.map((item) => [item.key, item.value]));
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_MODE), 2);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_POS_TYPE), 1);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_LAT), 401234567);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_LAT_HP), 89);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_LON), -1059876543);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_LON_HP), -21);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_HEIGHT), 160012);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_HEIGHT_HP), 34);
  assert.equal(byKey.get(UBLOX_F9_CONFIG_KEYS.TMODE_FIXED_POS_ACC), 100);

  const frame = buildF9BaseValset({
    mode: "fixed",
    latitude: 40.123456789,
    longitude: -105.987654321,
    ellipsoidHeightM: 1600.1234,
  });
  assert.equal(frame[2], UBX_CLASS_CFG);
  assert.equal(frame[3], UBX_ID_CFG_VALSET);
  assert.equal(frame[7], 0x07);
});

test("u-blox MON-VER, NAV-SVIN, and ACK status decode", () => {
  const versionPayload = new Uint8Array(100);
  writeAscii(versionPayload, 0, 30, "HPG 1.32");
  writeAscii(versionPayload, 30, 10, "00190000");
  writeAscii(versionPayload, 40, 30, "PROTVER=27.31");
  writeAscii(versionPayload, 70, 30, "MOD=ZED-F9P");
  const version = parseUbxMonVer(versionPayload);
  assert.equal(version.model, "ZED-F9P");
  assert.equal(version.protocolVersion, "27.31");

  const surveyPayload = new Uint8Array(40);
  const view = new DataView(surveyPayload.buffer);
  view.setUint32(8, 125, true);
  view.setUint32(28, 2345, true);
  view.setUint32(32, 600, true);
  view.setUint8(36, 1);
  view.setUint8(37, 0);
  const survey = parseUbxNavSvin(surveyPayload);
  assert.equal(survey.durationS, 125);
  assert.equal(survey.meanAccuracyM, 0.2345);
  assert.equal(survey.observations, 600);
  assert.equal(survey.valid, true);

  assert.deepEqual(parseUbxAck({
    messageClass: UBX_CLASS_ACK,
    messageId: UBX_ID_ACK_ACK,
    payload: Uint8Array.from([UBX_CLASS_CFG, UBX_ID_CFG_VALSET]),
  }), {
    acknowledged: true,
    rejected: false,
    messageClass: UBX_CLASS_CFG,
    messageId: UBX_ID_CFG_VALSET,
  });
});
