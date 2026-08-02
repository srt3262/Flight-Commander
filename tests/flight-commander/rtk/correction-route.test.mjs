import assert from "node:assert/strict";
import test from "node:test";

import {
  FLIGHT_COMMANDER_CAPABILITIES,
  FIRMWARE_FAMILY_FLIGHT_COMMANDER,
  FIRMWARE_FAMILY_INAV,
} from "../../../js/flightCommander/firmwareIdentity.js";
import { resolveRtkCorrectionRoute } from "../../../js/rtk/rtkCorrectionRoute.js";

const capability = FLIGHT_COMMANDER_CAPABILITIES.GCS_RTK_BASE;

test("RTK correction routing prefers an advertised Flight Commander MAVLink link", () => {
  assert.deepEqual(resolveRtkCorrectionRoute({
    mavlinkState: {
      connected: true,
      firmwareFamily: FIRMWARE_FAMILY_FLIGHT_COMMANDER,
      flightCommanderCapabilities: capability,
    },
  }), { available: true, transport: "MAVLink" });
});

test("RTK correction routing supports wired Flight Commander MSP injection", () => {
  assert.deepEqual(resolveRtkCorrectionRoute({
    connectionValid: true,
    connectionProtocol: "msp",
    firmwareIdentity: {
      family: FIRMWARE_FAMILY_FLIGHT_COMMANDER,
      protocolSupported: true,
      capabilities: capability,
    },
  }), { available: true, transport: "MSP" });
});

test("Official INAV cannot receive Flight Commander GCS base corrections", () => {
  const route = resolveRtkCorrectionRoute({
    mavlinkState: {
      connected: true,
      firmwareFamily: FIRMWARE_FAMILY_INAV,
      flightCommanderCapabilities: 0,
    },
  });
  assert.equal(route.available, false);
  assert.match(route.reason, /disabled for Official INAV/);
});
