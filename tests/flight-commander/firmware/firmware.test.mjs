import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { zlibSync } from "fflate";

import ElectronSerialByteTransport from "../../../js/connection/electronSerialByteTransport.js";
import { rebootArduPilotToBootloader } from "../../../js/connection/ardupilotBootloaderEntry.js";
import {
  ArduPilotFirmwareProvider,
  FirmwarePackageError,
  PX4_BOOTLOADER,
  Px4BootloaderUploader,
  checkFirmwareCompatibility,
  parseApjPackage,
  parseArduPilotManifest,
  sha256Hex,
} from "../../../js/firmware/index.js";

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function apjDescriptor(image, overrides = {}) {
  return {
    magic: "APJFWv1",
    board_id: 50,
    board_revision: 0,
    image_size: image.byteLength,
    image: base64(zlibSync(image)),
    image_sha256: sha256Hex(image),
    version: "4.6.1",
    ...overrides,
  };
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

test("APJ parsing verifies zlib size, SHA-256, and padding", () => {
  const image = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.equal(
    sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );

  const firmware = parseApjPackage(JSON.stringify(apjDescriptor(image)));
  assert.deepEqual([...firmware.image], [...image]);
  assert.deepEqual([...firmware.paddedImage], [1, 2, 3, 4, 5, 255, 255, 255]);
  assert.deepEqual(firmware.verifiedChecksums, ["image_sha256"]);
  assert.equal(firmware.boardId, 50);
  assert.equal(firmware.imageSize, 5);
  assert(Object.isFrozen(firmware));
});

test("APJ parsing fails closed on identity, size, checksum, and external-flash ambiguity", () => {
  const image = Uint8Array.from([9, 8, 7]);
  assert.throws(
    () => parseApjPackage(apjDescriptor(image, { magic: "not-apj" })),
    /Unsupported APJ magic/,
  );
  assert.throws(
    () => parseApjPackage(apjDescriptor(image, { image_size: 4 })),
    /expands to 3 bytes/,
  );
  assert.throws(
    () =>
      parseApjPackage(apjDescriptor(image, { image_sha256: "0".repeat(64) })),
    /does not match/,
  );
  assert.throws(
    () => parseApjPackage(apjDescriptor(image, { extf_image_size: 1 })),
    /extf_image is missing/,
  );
  assert.throws(
    () => parseApjPackage(apjDescriptor(image, { md5: "unsupported" })),
    /checksum algorithm is not supported/,
  );
});

test("manifest parsing rejects unsafe entries and provider restricts download origins", async () => {
  const manifest = parseArduPilotManifest({
    "format-version": "1.0.0",
    firmware: [
      {
        url: "http://firmware.ardupilot.org/Copter/stable/board/fw.apj",
        platform: "board",
        vehicletype: "Copter",
        "mav-firmware-version": "4.6.0",
        "mav-firmware-version-type": "OFFICIAL",
      },
      {
        url: "https://firmware.ardupilot.org/Copter/stable/board/fw.apj",
        platform: "board",
        vehicletype: "Copter",
        "mav-firmware-version": "4.6.1",
        "mav-firmware-version-major": 4,
        "mav-firmware-version-minor": 6,
        "mav-firmware-version-patch": 1,
        "mav-firmware-version-type": "OFFICIAL",
        latest: 1,
      },
    ],
  });

  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.rejectedEntries.length, 1);
  assert.equal(manifest.entries[0].packageFormat, "apj");

  let receiver;
  const provider = new ArduPilotFirmwareProvider({
    fetchImpl(url) {
      receiver = this;
      return Promise.resolve({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });
    },
  });
  await provider.downloadPackage(manifest.entries[0], { parse: false });
  assert.equal(receiver, provider);

  await assert.rejects(
    provider.downloadPackage({
      ...manifest.entries[0],
      url: "https://attacker.invalid/fw.apj",
    }),
    /origin is not allowed/,
  );
});

test("firmware compatibility requires exact hardware identity and supported image layout", () => {
  const image = Uint8Array.from([1, 2, 3, 4]);
  const board = { boardId: 50, boardRevision: 2, flashSize: 1024 };
  const firmware = {
    boardId: 50,
    boardRevision: 2,
    boardRevisionMin: null,
    boardRevisionMax: null,
    image,
    imageSize: image.byteLength,
    requiresExternalFlash: false,
  };
  assert.equal(checkFirmwareCompatibility(board, firmware).compatible, true);

  const wrongBoard = checkFirmwareCompatibility(board, {
    ...firmware,
    boardId: 51,
    requiresExternalFlash: true,
  });
  assert.equal(wrongBoard.compatible, false);
  assert.match(wrongBoard.reasons.join(" "), /does not match/);

  const external = checkFirmwareCompatibility(board, {
    ...firmware,
    requiresExternalFlash: true,
  });
  assert.equal(external.compatible, false);
  assert.match(external.reasons.join(" "), /external-flash/);
});

test("PX4 bootloader identification uses the documented framed protocol", async () => {
  const reads = [
    Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    uint32(5),
    Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    uint32(50),
    Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    uint32(2),
    Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    uint32(1024),
    Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
  ];
  const writes = [];
  const transport = {
    flushInput() {},
    async write(value) {
      writes.push([...value]);
      return value.byteLength;
    },
    async readExactly(length) {
      const value = reads.shift();
      assert.equal(value.byteLength, length);
      return value;
    },
  };

  const uploader = new Px4BootloaderUploader(transport, { maxRetries: 0 });
  assert.deepEqual(await uploader.identify(), {
    bootloaderRevision: 5,
    boardId: 50,
    boardRevision: 2,
    flashSize: 1024,
  });
  assert.deepEqual(writes, [
    [PX4_BOOTLOADER.command.GET_SYNC, PX4_BOOTLOADER.EOC],
    [
      PX4_BOOTLOADER.command.GET_DEVICE,
      PX4_BOOTLOADER.info.BOOTLOADER_REVISION,
      PX4_BOOTLOADER.EOC,
    ],
    [
      PX4_BOOTLOADER.command.GET_DEVICE,
      PX4_BOOTLOADER.info.BOARD_ID,
      PX4_BOOTLOADER.EOC,
    ],
    [
      PX4_BOOTLOADER.command.GET_DEVICE,
      PX4_BOOTLOADER.info.BOARD_REVISION,
      PX4_BOOTLOADER.EOC,
    ],
    [
      PX4_BOOTLOADER.command.GET_DEVICE,
      PX4_BOOTLOADER.info.FLASH_SIZE,
      PX4_BOOTLOADER.EOC,
    ],
  ]);
});

test("Electron serial byte transport buffers events and rejects partial writes", async () => {
  const listeners = {};
  const removed = [];
  const api = {
    onSerialData(callback) {
      listeners.data = callback;
      return callback;
    },
    onSerialError(callback) {
      listeners.error = callback;
      return callback;
    },
    onSerialClose(callback) {
      listeners.close = callback;
      return callback;
    },
    offSerialData(handler) {
      removed.push(handler);
    },
    offSerialError(handler) {
      removed.push(handler);
    },
    offSerialClose(handler) {
      removed.push(handler);
    },
    async serialConnect() {
      listeners.data({
        connectionId: 999,
        data: Uint8Array.from([99]),
      });
      listeners.data({
        connectionId: 1,
        data: Uint8Array.from([1]),
      });
      return { id: 1 };
    },
    async serialSend(value, connectionId) {
      assert.equal(connectionId, 1);
      return { bytesWritten: value.byteLength };
    },
    async serialClose(connectionId) {
      assert.equal(connectionId, 1);
    },
  };

  const transport = new ElectronSerialByteTransport(api);
  await transport.open("COM9");
  const pending = transport.readExactly(3);
  listeners.data({
    connectionId: 999,
    data: Uint8Array.from([88]),
  });
  listeners.close({ connectionId: 999 });
  listeners.error({ connectionId: 999, error: "stale error" });
  listeners.data({
    connectionId: 1,
    data: Uint8Array.from([2, 3, 4]),
  });
  assert.deepEqual([...(await pending)], [1, 2, 3]);
  assert.deepEqual([...(await transport.readExactly(1))], [4]);

  api.serialSend = async () => ({ bytesWritten: 1 });
  await assert.rejects(transport.write(Uint8Array.from([1, 2])), /incomplete/);
  await transport.close();
  assert.equal(removed.length, 3);
});

test("Electron serial byte transport removes event handlers when opening fails", async () => {
  const handlers = [];
  const removed = [];
  const api = {
    onSerialData(callback) {
      handlers.push(callback);
      return callback;
    },
    onSerialError(callback) {
      handlers.push(callback);
      return callback;
    },
    onSerialClose(callback) {
      handlers.push(callback);
      return callback;
    },
    offSerialData: (handler) => removed.push(handler),
    offSerialError: (handler) => removed.push(handler),
    offSerialClose: (handler) => removed.push(handler),
    async serialConnect() {
      throw new Error("IPC unavailable");
    },
  };
  const transport = new ElectronSerialByteTransport(api);
  await assert.rejects(transport.open("COM99"), /IPC unavailable/);
  assert.equal(removed.length, handlers.length);
  assert.equal(transport.path, null);
  assert.equal(transport.opened, false);
});

test("ArduPilot bootloader entry sends command 246 with bootloader selector and closes serial", async () => {
  let mavlinkMessage;
  let encodedRequest;
  const fed = [];
  let closed = 0;
  const api = {
    mavlinkReset() {},
    onSerialData(callback) {
      this.serialData = callback;
      return callback;
    },
    offSerialData() {},
    mavlinkFeed(data) {
      fed.push([...data]);
      queueMicrotask(() =>
        mavlinkMessage({
          messageName: "HEARTBEAT",
          protocol: "MAVLinkV2",
          header: { sysid: 42, compid: 1 },
          data: { type: 2, autopilot: 3 },
        }),
      );
    },
    onMavlinkMessage(callback) {
      mavlinkMessage = callback;
      return callback;
    },
    offMavlinkMessage() {},
    async serialConnect() {
      this.serialData({
        connectionId: 999,
        data: Uint8Array.from([99]),
      });
      this.serialData({
        connectionId: 1,
        data: Uint8Array.from([1, 2]),
      });
      return { id: 1 };
    },
    async mavlinkEncode(name, data, options) {
      encodedRequest = { name, data, options };
      return Uint8Array.from([1, 2, 3]);
    },
    async serialSend(value, connectionId) {
      assert.equal(connectionId, 1);
      return { bytesWritten: value.byteLength };
    },
    async serialClose(connectionId) {
      assert.equal(connectionId, 1);
      closed += 1;
    },
  };

  const heartbeat = await rebootArduPilotToBootloader("COM4", { api });
  assert.deepEqual(heartbeat, {
    systemId: 42,
    componentId: 1,
    protocolVersion: 2,
  });
  assert.equal(encodedRequest.name, "CommandLong");
  assert.equal(encodedRequest.data.command, 246);
  assert.equal(encodedRequest.data.param1, 3);
  assert.equal(encodedRequest.data.targetSystem, 42);
  assert.deepEqual(fed, [[1, 2]]);
  assert.equal(closed, 1);
});

test("ArduPilot bootloader entry preserves a MAVLink v1 heartbeat protocol", async () => {
  let mavlinkMessage;
  let encodedOptions;
  const api = {
    mavlinkReset() {},
    onSerialData(callback) {
      return callback;
    },
    offSerialData() {},
    mavlinkFeed() {},
    onMavlinkMessage(callback) {
      mavlinkMessage = callback;
      return callback;
    },
    offMavlinkMessage() {},
    async serialConnect() {
      queueMicrotask(() =>
        mavlinkMessage({
          messageName: "HEARTBEAT",
          protocol: "MAV_V1",
          header: { sysid: 7, compid: 1 },
          data: { type: 2, autopilot: 3 },
        }),
      );
      return { id: 1 };
    },
    async mavlinkEncode(name, data, options) {
      encodedOptions = options;
      return Uint8Array.from([1]);
    },
    async serialSend() {
      return { bytesWritten: 1 };
    },
    async serialClose() {},
  };

  await rebootArduPilotToBootloader("COM5", { api });
  assert.equal(encodedOptions.version, 1);
});

test("ArduPilot bootloader entry honors cancellation before opening serial", async () => {
  const controller = new AbortController();
  controller.abort(new Error("operator cancelled"));
  let opened = false;
  const api = {
    mavlinkReset() {},
    onSerialData(callback) {
      return callback;
    },
    offSerialData() {},
    mavlinkFeed() {},
    onMavlinkMessage(callback) {
      return callback;
    },
    offMavlinkMessage() {},
    async serialConnect() {
      opened = true;
      return { id: 1 };
    },
  };

  await assert.rejects(
    rebootArduPilotToBootloader("COM6", {
      api,
      signal: controller.signal,
    }),
    /operator cancelled/,
  );
  assert.equal(opened, false);
});

test("ArduPilot catalog, package, and bootloader waits share the cancel signal", () => {
  const source = readFileSync(
    new URL("../../../tabs/ardupilot_firmware_flasher.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /loadManifest\(\{\s*signal:\s*controller\.signal,/);
  assert.match(
    source,
    /downloadPackage\(this\.selectedEntry,\s*\{\s*signal:\s*controller\.signal,/,
  );
  assert.match(
    source,
    /rebootArduPilotToBootloader\(selectedPath,\s*\{[\s\S]*?signal,/,
  );
});

test("APJ public errors preserve a stable machine-readable code", () => {
  assert.throws(
    () => parseApjPackage({}),
    (error) =>
      error instanceof FirmwarePackageError &&
      error.code === "FIRMWARE_PACKAGE_INVALID",
  );
});
