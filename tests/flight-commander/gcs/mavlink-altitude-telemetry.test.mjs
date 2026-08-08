import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRMWARE_FAMILY_INAV,
  FIRMWARE_FAMILY_UNSUPPORTED,
  MAV_AUTOPILOT_GENERIC,
  MavlinkSession,
} from "../../../js/mavlink/mavlinkSession.js";

function sessionForTelemetry(overrides = {}) {
  const session = new MavlinkSession({
    bridge: {},
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  session.connection = {};
  Object.assign(session.state, overrides);
  return session;
}

function frame(messageName, data) {
  return {
    messageName,
    data,
    header: { sysid: 1, compid: 1 },
    protocol: "MAV_V2",
  };
}

test("INAV VFR_HUD altitude feeds relative altitude without GPS", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_INAV,
    autopilot: MAV_AUTOPILOT_GENERIC,
  });
  session.handleMessage(frame("VfrHud", {
    alt: 12.75,
    airspeed: 0,
    groundspeed: 0,
    climb: -0.2,
    heading: 275,
  }));
  assert.equal(session.state.relativeAltitude, 12.75);
  assert.equal(session.state.altitudeMsl, null);
});

test("GPS_RAW_INT supplies MSL altitude only with a 3D fix", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_INAV,
    autopilot: MAV_AUTOPILOT_GENERIC,
  });
  session.handleMessage(frame("GpsRawInt", {
    fixType: 1,
    alt: 123450,
    satellitesVisible: 0,
    eph: 65535,
  }));
  assert.equal(session.state.altitudeMsl, null);

  session.handleMessage(frame("GpsRawInt", {
    fixType: 3,
    alt: 123450,
    satellitesVisible: 12,
    eph: 95,
  }));
  assert.equal(session.state.altitudeMsl, 123.45);
});

test("GLOBAL_POSITION_INT keeps existing MSL and relative altitude behavior", () => {
  const session = sessionForTelemetry({ gpsFix: 0 });
  session.handleMessage(frame("GlobalPositionInt", {
    lat: 334455667,
    lon: -881122334,
    alt: 123450,
    relativeAlt: 6789,
    vx: 0,
    vy: 0,
    hdg: 9000,
  }));
  assert.equal(session.state.altitudeMsl, 123.45);
  assert.equal(session.state.relativeAltitude, 6.789);
});

test("non-INAV VFR_HUD keeps standard MSL semantics", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_UNSUPPORTED,
    autopilot: 12,
  });
  session.handleMessage(frame("VfrHud", {
    alt: 85.5,
    airspeed: 0,
    groundspeed: 0,
    climb: 0,
    heading: 0,
  }));
  assert.equal(session.state.altitudeMsl, 85.5);
  assert.equal(session.state.relativeAltitude, null);
});
