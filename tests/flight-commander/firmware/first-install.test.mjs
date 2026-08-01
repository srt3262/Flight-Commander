import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ArduPilotFirmwareProvider,
  assertArduPilotWithBootloaderHex,
  findArduPilotWithBootloaderEntry,
  listArduPilotFirmware,
  parseArduPilotManifest,
  parseIntelHex,
  resolveArduPilotPlatformForInav,
} from "../../../js/firmware/index.js";
import {
  MSP_V1,
  identifyInavRuntime,
} from "../../../js/connection/inavRuntimeIdentity.js";

function hexByte(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function intelHexRecord(address, type, data = []) {
  const values = [
    data.length,
    (address >> 8) & 0xff,
    address & 0xff,
    type,
    ...data,
  ];
  const checksum = (-values.reduce((sum, value) => sum + value, 0)) & 0xff;
  return `:${[...values, checksum].map(hexByte).join("")}`;
}

function mspResponse(command, payload, direction = MSP_V1.RESPONSE) {
  const data = Uint8Array.from(payload);
  let checksum = data.length ^ command;
  for (const value of data) checksum ^= value;
  return Uint8Array.from([
    MSP_V1.BEGIN,
    MSP_V1.PROTOCOL,
    direction,
    data.length,
    command,
    ...data,
    checksum,
  ]);
}

class MspFixtureTransport {
  constructor(responses) {
    this.responses = responses;
    this.buffer = new Uint8Array(0);
    this.writes = [];
  }

  flushInput() {
    this.buffer = new Uint8Array(0);
  }

  async write(frame) {
    this.writes.push([...frame]);
    const command = frame[4];
    this.buffer = this.responses.get(command) ?? new Uint8Array(0);
    return frame.byteLength;
  }

  async readExactly(length) {
    if (this.buffer.byteLength < length) {
      throw new Error(`fixture short read: ${length}`);
    }
    const value = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return value;
  }
}

test("Intel HEX parser accepts an official-style bootloader plus application image", () => {
  const lines = [intelHexRecord(0, 0x04, [0x08, 0x00])];
  for (let offset = 0; offset < 4096; offset += 16) {
    lines.push(
      intelHexRecord(
        offset,
        0x00,
        Array.from({ length: 16 }, (_unused, index) => (offset + index) & 0xff),
      ),
    );
  }
  lines.push(intelHexRecord(0, 0x05, [0x08, 0x00, 0x00, 0x00]));
  lines.push(intelHexRecord(0, 0x01));

  const parsed = assertArduPilotWithBootloaderHex(
    parseIntelHex(lines.join("\r\n")),
  );
  assert.equal(parsed.bytes_total, 4096);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].address, 0x08000000);
  assert.equal(parsed.data[0].bytes, 4096);
  assert.equal(parsed.start_linear_address, 0x08000000);
});

test("Intel HEX parser rejects corruption, missing EOF, and non-bootloader layouts", () => {
  const validData = intelHexRecord(0, 0x00, [1, 2, 3, 4]);
  const corrupted = `${validData.slice(0, -2)}00\n${intelHexRecord(0, 0x01)}`;
  assert.throws(() => parseIntelHex(corrupted), /checksum failed/);
  assert.throws(() => parseIntelHex(validData), /missing its EOF/);

  const wrongBase = [
    intelHexRecord(0, 0x04, [0x08, 0x01]),
    intelHexRecord(0, 0x00, Array(4096).fill(0).slice(0, 16)),
    intelHexRecord(0, 0x01),
  ].join("\n");
  assert.throws(
    () => assertArduPilotWithBootloaderHex(parseIntelHex(wrongBase)),
    /not STM32 flash base/,
  );
});

test("official APJ entry resolves only its same-release with-bootloader HEX", async () => {
  const common = {
    platform: "MicoAir743",
    vehicletype: "Copter",
    "mav-firmware-version": "4.7.0",
    "mav-firmware-version-type": "OFFICIAL",
  };
  const manifest = parseArduPilotManifest({
    "format-version": "1.0.0",
    firmware: [
      {
        ...common,
        "mav-type": "HELICOPTER",
        format: "apj",
        board_id: 1166,
        url: "https://firmware.ardupilot.org/Copter/stable-4.7.0/MicoAir743-heli/arducopter-heli.apj",
      },
      {
        ...common,
        "mav-type": "HELICOPTER",
        format: "hex",
        url: "https://firmware.ardupilot.org/Copter/stable-4.7.0/MicoAir743-heli/arducopter-heli_with_bl.hex",
      },
      {
        ...common,
        "mav-type": "Copter",
        format: "apj",
        board_id: 1166,
        url: "https://firmware.ardupilot.org/Copter/stable-4.7.0/MicoAir743/arducopter.apj",
      },
      {
        ...common,
        "mav-type": "Copter",
        format: "hex",
        url: "https://firmware.ardupilot.org/Copter/stable-4.7.0/MicoAir743/arducopter_with_bl.hex",
      },
      {
        ...common,
        "mav-type": "Copter",
        format: "hex",
        url: "https://firmware.ardupilot.org/Copter/stable-4.7.0/MicoAir743/other_with_bl.hex",
      },
    ],
  });
  const listed = listArduPilotFirmware(manifest, {
    vehicleClass: "copter",
    releaseChannel: "stable",
    platform: "MicoAir743",
    mavType: "Copter",
  });
  assert.equal(listed.length, 1);
  const apj = listed[0];
  assert.match(apj.url, /\/MicoAir743\/arducopter\.apj$/);
  const withBootloader = findArduPilotWithBootloaderEntry(manifest, apj);
  assert.equal(withBootloader.packageFormat, "hex");
  assert.equal(withBootloader.flashableByStm32Dfu, true);
  assert.match(withBootloader.url, /arducopter_with_bl\.hex$/);

  let fetchedUrl;
  const provider = new ArduPilotFirmwareProvider({
    fetchImpl: async (url) => {
      fetchedUrl = url;
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(":00000001FF\n").buffer,
      };
    },
  });
  await provider.downloadWithBootloaderHex(withBootloader, { parse: false });
  assert.equal(fetchedUrl, withBootloader.url);
  await assert.rejects(
    provider.downloadWithBootloaderHex(apj, { parse: false }),
    /not an ArduPilot with-bootloader HEX/,
  );
});

test("INAV MICOAIR743 identity exact-matches the official MicoAir743 platform", () => {
  const entries = [
    { platform: "MicoAir743" },
    { platform: "MicoAir743v2" },
    { platform: "MicoAir743-AIO" },
  ];
  const exact = resolveArduPilotPlatformForInav("MICOAIR743", entries);
  assert.equal(exact.matched, true);
  assert.equal(exact.platform, "MicoAir743");
  assert.equal(exact.method, "exact-name");

  const branded = resolveArduPilotPlatformForInav("AEROSELFIEH743V1.3", entries);
  assert.equal(branded.matched, true);
  assert.equal(branded.platform, "MicoAir743");
  assert.equal(branded.method, "documented-alias");
});

test("running INAV identity probe reads firmware, board, and target over MSPv1", async () => {
  const target = new TextEncoder().encode("MICOAIR743");
  const board = Uint8Array.from([
    ...new TextEncoder().encode("MI74"),
    0x03,
    0x01,
    1,
    0,
    target.length,
    ...target,
  ]);
  const responses = new Map([
    [MSP_V1.API_VERSION, mspResponse(MSP_V1.API_VERSION, [0, 2, 6])],
    [MSP_V1.FC_VARIANT, mspResponse(MSP_V1.FC_VARIANT, new TextEncoder().encode("INAV"))],
    [MSP_V1.FC_VERSION, mspResponse(MSP_V1.FC_VERSION, [9, 1, 1])],
    [MSP_V1.BOARD_INFO, mspResponse(MSP_V1.BOARD_INFO, board)],
  ]);
  const transport = new MspFixtureTransport(responses);
  const identity = await identifyInavRuntime(transport);
  assert.deepEqual(identity, {
    firmwareFamily: "inav",
    apiVersion: "0.2.6",
    firmwareVersion: "9.1.1",
    boardIdentifier: "MI74",
    boardVersion: 0x0103,
    target: "MICOAIR743",
  });
  assert.deepEqual(
    transport.writes.map((frame) => frame[4]),
    [1, 2, 3, 4],
  );
});

test("ArduPilot renderer routes INAV/DFU first installs through full erase", () => {
  const flasher = readFileSync(
    new URL("../../../tabs/ardupilot_firmware_flasher.js", import.meta.url),
    "utf8",
  );
  const host = readFileSync(
    new URL("../../../tabs/firmware_flasher.js", import.meta.url),
    "utf8",
  );
  assert.match(flasher, /identifyInavRuntime\(transport/);
  assert.match(flasher, /findArduPilotWithBootloaderEntry/);
  assert.match(flasher, /downloadWithBootloaderHex/);
  assert.match(flasher, /erase_chip:\s*true/);
  assert.match(flasher, /verify every programmed byte/);
  assert.match(host, /path === 'DFU'/);
  assert.match(host, /STM32\.connect\(path, 921600/);
  assert.equal(
    host.match(/if \(success === true\) restoreFlow\.onFlashComplete\(\);/g)?.length,
    2,
    "serial and USB DFU restore flows must run only after verified flashing",
  );
});
