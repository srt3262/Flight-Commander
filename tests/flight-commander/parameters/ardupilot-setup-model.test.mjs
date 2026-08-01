import assert from "node:assert/strict";
import test from "node:test";

import {
  activeArduPilotModeSlot,
  bitmaskValueFromBits,
  detectMovedRcChannel,
  discoverArduPilotAuxiliaryChannels,
  discoverArduPilotModeConfiguration,
  discoverArduPilotPidGroups,
  discoverArduPilotReceiverChannels,
  discoverArduPilotSerialPorts,
  selectedBitsFromBitmask,
  serialReceiverProtocolValue,
} from "../../../js/ardupilot/setupModel.js";

const parameter = (id, value = 0) => ({ id, value, type: 9, index: 0 });

test("ArduPilot serial ports are discovered from the controller instead of assumed", () => {
  const parameters = [
    parameter("SERIAL0_PROTOCOL", 2),
    parameter("SERIAL0_BAUD", 115),
    parameter("SERIAL1_PROTOCOL", 23),
    parameter("SERIAL1_BAUD", 420),
    parameter("SERIAL1_OPTIONS", 0),
  ];
  const metadata = new Map([
    ["SERIAL1_PROTOCOL", {
      values: [{ value: 2, label: "MAVLink2" }, { value: 23, label: "RCIN" }],
    }],
  ]);
  const ports = discoverArduPilotSerialPorts(parameters, metadata);
  assert.deepEqual(ports.map((port) => port.number), [0, 1]);
  assert.equal(ports[0].options, null);
  assert.equal(ports[1].baud.id, "SERIAL1_BAUD");
  assert.equal(serialReceiverProtocolValue(ports[1]), 23);
});

test("flight mode discovery supports Copter/Plane and Rover parameter families", () => {
  const copter = discoverArduPilotModeConfiguration([
    parameter("FLTMODE_CH", 5),
    ...Array.from({ length: 6 }, (_, index) => parameter(`FLTMODE${index + 1}`, index)),
  ]);
  assert.equal(copter.channel.id, "FLTMODE_CH");
  assert.equal(copter.slots.length, 6);
  assert.equal(copter.slots[5].label, "1750–2200");

  const rover = discoverArduPilotModeConfiguration([
    parameter("MODE_CH", 8),
    ...Array.from({ length: 6 }, (_, index) => parameter(`MODE${index + 1}`, index)),
  ]);
  assert.equal(rover.channel.id, "MODE_CH");
  assert.equal(rover.slots[0].id, "MODE1");
});

test("fixed ArduPilot mode slots and transmitter movement detection are exact", () => {
  assert.equal(activeArduPilotModeSlot(1230), 1);
  assert.equal(activeArduPilotModeSlot(1231), 2);
  assert.equal(activeArduPilotModeSlot(1490), 3);
  assert.equal(activeArduPilotModeSlot(1491), 4);
  assert.equal(activeArduPilotModeSlot(1750), 6);
  assert.equal(activeArduPilotModeSlot(null), null);

  assert.deepEqual(
    detectMovedRcChannel(
      [1500, 1500, 1000, 1500],
      [1510, 1900, 1050, 1200],
      { allowedChannels: [1, 2, 3] },
    ),
    { channel: 2, pwm: 1900, baseline: 1500, delta: 400 },
  );
  assert.equal(
    detectMovedRcChannel([1500], [1600], { threshold: 150 }),
    null,
  );
});

test("receiver and auxiliary rows mirror only parameters actually exposed", () => {
  const parameters = [
    parameter("RC1_MIN", 1000),
    parameter("RC1_TRIM", 1500),
    parameter("RC1_MAX", 2000),
    parameter("RC1_REVERSED", 0),
    parameter("RC5_OPTION", 0),
    parameter("RC7_OPTION", 11),
  ];
  const receiver = discoverArduPilotReceiverChannels(parameters);
  assert.equal(receiver.length, 1);
  assert.equal(receiver[0].trim.id, "RC1_TRIM");
  assert.equal(receiver[0].dz, undefined);
  assert.deepEqual(
    discoverArduPilotAuxiliaryChannels(parameters).map((entry) => entry.channel),
    [5, 7],
  );
});

test("receiver protocol bitmasks use ArduPilot bit numbers", () => {
  assert.equal(bitmaskValueFromBits([0, 3, 9]), 521);
  assert.deepEqual(
    selectedBitsFromBitmask(521, [0, 1, 3, 9].map((value) => ({ value }))),
    [0, 3, 9],
  );
});

test("PID groups are discovered from vehicle parameters without assuming axes", () => {
  const groups = discoverArduPilotPidGroups([
    parameter("ATC_RAT_RLL_P", 0.13),
    parameter("ATC_RAT_RLL_I", 0.13),
    parameter("ATC_RAT_RLL_D", 0.004),
    parameter("ATC_RAT_RLL_FF", 0),
    parameter("PSC_ACCZ_P", 0.3),
    parameter("PSC_ACCZ_I", 0.6),
    parameter("SERVO1_P", 1),
  ]);
  assert.deepEqual(groups.map((group) => group.id), [
    "ATC_RAT_RLL",
    "PSC_ACCZ",
  ]);
  assert.equal(groups[0].label, "Roll rate");
  assert.equal(groups[0].gains.ff.id, "ATC_RAT_RLL_FF");
  assert.equal(groups[1].gains.d, undefined);
});
