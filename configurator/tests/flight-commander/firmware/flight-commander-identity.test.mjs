import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FIRMWARE_FAMILY_FLIGHT_COMMANDER,
  FLIGHT_COMMANDER_CAPABILITIES,
  FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK,
  MSP2_FLIGHT_COMMANDER_INFO,
  applyFirmwareIdentity,
  createInavFirmwareIdentity,
  firmwareFeatureSupport,
  inspectFlightCommanderInfo,
  isInavCompatibleFirmwareVariant,
  probeFlightCommanderFirmware,
} from "../../../js/flightCommander/firmwareIdentity.js";

function identityPayload({
  schema = 1,
  firmware = [0, 1, 0],
  compatibleInav = [9, 1, 0],
  capabilities = 0,
} = {}) {
  const payload = new Uint8Array(15);
  payload.set([0x46, 0x43, 0x46, 0x57, schema], 0);
  payload.set(firmware, 5);
  payload.set(compatibleInav, 8);
  new DataView(payload.buffer).setUint32(11, capabilities, true);
  return payload;
}

describe("Flight Commander firmware identity", () => {
  test("recognizes inherited transport variants while keeping FCFW metadata optional", () => {
    assert.equal(isInavCompatibleFirmwareVariant("INAV"), true);
    assert.equal(isInavCompatibleFirmwareVariant("FCFW"), true);
    assert.equal(isInavCompatibleFirmwareVariant("ARDU"), false);
  });
  test("parses the exact firmware 0.1.0 schema and little-endian capabilities", () => {
    const capabilities =
      FLIGHT_COMMANDER_CAPABILITIES.MULTIROTOR_AUTOTUNE |
      FLIGHT_COMMANDER_CAPABILITIES.MISSION_STREAMING |
      FLIGHT_COMMANDER_CAPABILITIES.COMPASS_ORIENTATION_LEARNING;
    const identity = inspectFlightCommanderInfo(
      identityPayload({ capabilities }),
      "9.1.0",
    );

    assert.equal(identity.family, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(identity.displayName, "Flight Commander Firmware");
    assert.equal(identity.detected, true);
    assert.equal(identity.protocolSupported, true);
    assert.equal(identity.schemaVersion, 1);
    assert.equal(identity.firmwareVersion, "0.1.0");
    assert.equal(identity.compatibleInavVersion, "9.1.0");
    assert.equal(identity.capabilities, capabilities);
    assert.deepEqual(identity.capabilityNames, [
      "MULTIROTOR_AUTOTUNE",
      "MISSION_STREAMING",
      "COMPASS_ORIENTATION_LEARNING",
    ]);
  });

  test("treats a missing FCFW response as optional diagnostic metadata", () => {
    const identity = inspectFlightCommanderInfo(new Uint8Array(), "9.1.0");
    assert.equal(identity.family, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(identity.compatibleInavVersion, "9.1.0");
    assert.equal(identity.capabilities, FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK);
    assert.equal(identity.displayName, "Flight Commander Firmware");
    assert.equal(identity.protocolSupported, true);
    assert.equal(identity.detected, false);
  });

  test("reports a newer Flight Commander schema without using it as a feature gate", () => {
    const identity = inspectFlightCommanderInfo(
      identityPayload({ schema: 2 }),
      "9.1.0",
    );
    assert.equal(identity.family, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(identity.detected, true);
    assert.equal(identity.protocolSupported, false);
    assert.equal(identity.capabilities, 0);
    assert.equal(identity.displayName, "Flight Commander Firmware");
    assert.match(identity.probeError, /schema 2/);
    assert.equal(firmwareFeatureSupport(identity, "missionStreaming").enabled, true);
  });

  test("rejects malformed nonempty payloads instead of granting capabilities", () => {
    assert.throws(
      () => inspectFlightCommanderInfo(new Uint8Array([1, 2, 3, 4, 1])),
      (error) => error.code === "INVALID_SIGNATURE",
    );
    assert.throws(
      () => inspectFlightCommanderInfo(identityPayload().slice(0, 14)),
      (error) => error.code === "INVALID_LENGTH",
    );
  });

  test("feature availability follows the product contract, not identity bits", () => {
    const stock = createInavFirmwareIdentity("9.1.0");
    assert.equal(
      firmwareFeatureSupport(stock, "multirotorAutotune").enabled,
      true,
    );
    assert.match(
      firmwareFeatureSupport(stock, "multirotorAutotune").reason,
      /product contract/,
    );

    const fork = inspectFlightCommanderInfo(
      identityPayload({
        capabilities: FLIGHT_COMMANDER_CAPABILITIES.TERRAIN_WAYPOINTS,
      }),
    );
    assert.equal(
      firmwareFeatureSupport(fork, "terrainWaypoints").enabled,
      true,
    );
    assert.equal(
      firmwareFeatureSupport(fork, "missionStreaming").enabled,
      true,
    );
  });

  test("the optional MSPv2 probe is single-attempt and falls back safely", async () => {
    const calls = [];
    const MSP = {
      constants: { PROTOCOL_V2: 2 },
      send_message(...args) {
        calls.push(args);
        args[3]({ data: new DataView(identityPayload().buffer) });
        return true;
      },
    };
    const identity = await probeFlightCommanderFirmware({
      MSP,
      MSPCodes: { MSP2_FLIGHT_COMMANDER_INFO },
      compatibleInavVersion: "9.1.0",
    });
    assert.equal(identity.family, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], MSP2_FLIGHT_COMMANDER_INFO);
    assert.equal(calls[0][4], 2);
    assert.deepEqual(calls[0][5], { retryCounter: 0 });

    const unsupported = await probeFlightCommanderFirmware({
      MSP: {
        constants: { PROTOCOL_V2: 2 },
        send_message(_code, _data, _sent, callback) {
          callback({ data: new DataView(new ArrayBuffer(0)) });
          return true;
        },
      },
      compatibleInavVersion: "9.1.0",
    });
    assert.equal(unsupported.family, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(unsupported.capabilities, FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK);
  });

  test("applies Flight Commander identity without replacing the inherited protocol version", () => {
    const FC = {
      CONFIG: {
        flightControllerIdentifier: "INAV",
        flightControllerVersion: "9.1.0",
      },
    };
    const identity = inspectFlightCommanderInfo(identityPayload());
    const applied = applyFirmwareIdentity(FC, identity);
    assert.equal(FC.CONFIG.firmwareFamily, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(FC.CONFIG.flightCommanderFirmware.firmwareVersion, "0.1.0");
    assert.equal(FC.CONFIG.flightControllerIdentifier, "INAV");
    assert.equal(FC.CONFIG.flightControllerVersion, "9.1.0");
    assert.equal(applied.capabilities, FLIGHT_COMMANDER_KNOWN_CAPABILITY_MASK);
    assert.equal(applied.advertisedCapabilities, 0);
  });
});
