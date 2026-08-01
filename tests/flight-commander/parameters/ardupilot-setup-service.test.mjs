import assert from "node:assert/strict";
import test from "node:test";

import {
  ARDUPILOT_REBOOT_AUTOPILOT,
  ArduPilotSetupService,
  MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
} from "../../../js/ardupilot/setupService.js";

function harness(overrides = {}) {
  const sent = [];
  const writes = [];
  const state = {
    connected: true,
    linkLost: false,
    firmwareFamily: "ardupilot",
    systemId: 12,
    componentId: 1,
    vehicleType: 2,
    armed: false,
    bootGeneration: 0,
    autopilotVersion: { flight: { raw: 1234 } },
    ...overrides,
  };
  const parameters = new Map([
    ["TEST_VALUE", { id: "TEST_VALUE", value: 1, type: 9, index: 0 }],
  ]);
  const metadata = new Map([
    ["TEST_VALUE", {
      id: "TEST_VALUE",
      displayName: "Test value",
      description: "Test setting",
      units: "",
      min: 0,
      max: 10,
      increment: 1,
      values: [],
      bitmask: [],
      user: "standard",
      category: "",
      group: "",
      readOnly: false,
      rebootRequired: true,
      volatile: false,
    }],
  ]);
  const session = {
    snapshot: () => ({ ...state }),
    target: () => ({ targetSystem: state.systemId, targetComponent: state.componentId }),
    send: async (name, payload) => sent.push({ name, payload }),
  };
  const parameterManager = {
    parameters,
    values: () => [...parameters.values()],
    set: async (id, value, options) => {
      writes.push({ id, value, options });
      const confirmed = { ...parameters.get(id), value };
      parameters.set(id, confirmed);
      return confirmed;
    },
  };
  const service = new ArduPilotSetupService({
    session,
    parameterManager,
    metadataProvider: {},
  });
  service.metadata = metadata;
  service.metadataResult = { metadata };
  service.loadedIdentity = "12:1:2:1234:0";
  return { service, sent, writes };
}

test("setup writes validate and confirm native parameters in order", async () => {
  const { service, writes } = harness();
  const confirmations = await service.writeChanges(new Map([["TEST_VALUE", 3]]));
  assert.equal(confirmations[0].value, 3);
  assert.deepEqual(writes, [{ id: "TEST_VALUE", value: 3, options: { type: 9 } }]);
});

test("setup writes and reboot are both refused while armed", async () => {
  const { service } = harness({ armed: true });
  await assert.rejects(
    service.writeChanges(new Map([["TEST_VALUE", 3]])),
    /Disarm the vehicle/,
  );
  await assert.rejects(service.rebootAutopilot(), /Disarm the vehicle/);
});

test("normal reboot uses MAV_CMD 246 param1 1 and never the bootloader selector", async () => {
  const { service, sent } = harness();
  await service.rebootAutopilot();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, "CommandLong");
  assert.equal(sent[0].payload.command, MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN);
  assert.equal(sent[0].payload.param1, ARDUPILOT_REBOOT_AUTOPILOT);
  assert.notEqual(sent[0].payload.param1, 3);
});

test("a failed batch reports exactly which writes were already confirmed", async () => {
  const { service } = harness();
  const metadata = { ...service.metadata.get("TEST_VALUE"), id: "SECOND_VALUE" };
  service.parameterManager.parameters.set(
    "SECOND_VALUE",
    { id: "SECOND_VALUE", value: 1, type: 9, index: 1 },
  );
  service.metadata.set("SECOND_VALUE", metadata);
  const set = service.parameterManager.set;
  service.parameterManager.set = async (id, value, options) => {
    if (id === "SECOND_VALUE") throw new Error("second write failed");
    return set(id, value, options);
  };
  await assert.rejects(
    service.writeChanges(new Map([
      ["TEST_VALUE", 2],
      ["SECOND_VALUE", 3],
    ])),
    (error) => {
      assert.match(error.message, /second write failed/);
      assert.deepEqual(error.confirmedParameterIds, ["TEST_VALUE"]);
      return true;
    },
  );
});
