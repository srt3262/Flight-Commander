import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function loadMainSerial({ prepareSerialPort, disposeSerialPort, ports }) {
  const raw = readFileSync(
    resolve(projectRoot, "js/main/serial.js"),
    "utf8",
  );
  const source = raw
    .slice(raw.indexOf("const binding = autoDetect();"))
    .replace("const binding = autoDetect();", "const binding = {};")
    .replace("export default serial;", "globalThis.__serial = serial;");

  class FakeSerialPortStream extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.opening = true;
      this.isOpen = false;
      this.writes = [];
      ports.push(this);
    }

    write(data, callback) {
      this.writes.push(Buffer.from(data));
      callback(null);
    }

    destroy() {
      this.destroyed = true;
      this.opening = false;
      this.isOpen = false;
    }
  }

  const timers = new Set();
  const context = vm.createContext({
    Buffer,
    SerialPort: { list: async () => [] },
    SerialPortStream: FakeSerialPortStream,
    prepareSerialPort,
    disposeSerialPort,
    quarantineOpeningSerialPort() {
      return true;
    },
    serialOpenControlLineOptions() {
      return {};
    },
    console: { log() {} },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    setTimeout(callback, delay) {
      const handle = { callback, delay };
      timers.add(handle);
      if (delay === 100) queueMicrotask(callback);
      return handle;
    },
  });
  new vm.Script(source, {
    filename: "js/main/serial.js",
  }).runInContext(context);
  return context.__serial;
}

test("a late old control-line setup cannot replace the current main-process connection ID", async () => {
  const ports = [];
  let releaseFirstPreparation;
  const preparation = new Map();
  const disposed = [];
  const serial = loadMainSerial({
    ports,
    prepareSerialPort(port) {
      if (!preparation.has(port)) {
        preparation.set(
          port,
          ports.indexOf(port) === 0
            ? new Promise((resolve) => {
                releaseFirstPreparation = resolve;
              })
            : Promise.resolve(),
        );
      }
      return preparation.get(port);
    },
    async disposeSerialPort(port) {
      disposed.push(port);
      port.opening = false;
      port.isOpen = false;
    },
  });
  const window = {
    isDestroyed: () => false,
    webContents: { send() {} },
  };

  const firstOpen = serial.connect(
    "COM8",
    { bitrate: 460800, forceDtrLow: true },
    window,
  );
  const firstPort = ports[0];
  firstPort.opening = false;
  firstPort.isOpen = true;
  firstPort.emit("open");
  assert.equal(typeof releaseFirstPreparation, "function");

  const secondOpen = serial.connect(
    "COM8",
    { bitrate: 460800, forceDtrLow: true },
    window,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const secondPort = ports[1];
  assert.ok(secondPort);
  secondPort.opening = false;
  secondPort.isOpen = true;
  secondPort.emit("open");
  const secondResult = await secondOpen;
  assert.equal(secondResult.error, false);

  releaseFirstPreparation();
  const firstResult = await firstOpen;
  assert.equal(firstResult.error, true);
  assert.match(firstResult.msg, /superseded/);
  assert.equal(serial._serialport, secondPort);
  assert.equal(serial._connectionId, secondResult.id);
  assert.equal(disposed.includes(firstPort), true);

  const write = await serial.send(Uint8Array.of(0xfe, 0x01), secondResult.id);
  assert.equal(write.error, false);
  assert.equal(write.bytesWritten, 2);
});

test("an active native close preserves its phase and disconnected error details", async () => {
  const ports = [];
  const sent = [];
  const serial = loadMainSerial({
    ports,
    prepareSerialPort: async () => {},
    async disposeSerialPort(port) {
      port.opening = false;
      port.isOpen = false;
    },
  });
  const window = {
    isDestroyed: () => false,
    webContents: {
      send(channel, envelope) {
        sent.push({ channel, envelope });
      },
    },
  };

  const opening = serial.connect(
    "COM8",
    { bitrate: 460800, forceDtrLow: true },
    window,
  );
  const port = ports[0];
  port.opening = false;
  port.isOpen = true;
  port.emit("open");
  const opened = await opening;
  assert.equal(opened.error, false);

  const disconnectError = new Error("ReadFile failed on COM8");
  disconnectError.code = "EIO";
  disconnectError.disconnected = true;
  port.emit("close", disconnectError);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "serialClose");
  assert.equal(sent[0].envelope.connectionId, opened.id);
  assert.equal(sent[0].envelope.event, "close");
  assert.equal(sent[0].envelope.origin, "native");
  assert.equal(sent[0].envelope.expected, false);
  assert.equal(sent[0].envelope.phase, "active");
  assert.equal(sent[0].envelope.error, "ReadFile failed on COM8");
  assert.equal(sent[0].envelope.errorDetails.name, "Error");
  assert.equal(sent[0].envelope.errorDetails.message, "ReadFile failed on COM8");
  assert.equal(sent[0].envelope.errorDetails.code, "EIO");
  assert.equal(sent[0].envelope.errorDetails.disconnected, true);
  assert.equal(serial._serialport, null);
  assert.equal(serial._connectionId, null);
});

test("an active native error preserves its phase and platform error details", async () => {
  const ports = [];
  const sent = [];
  const serial = loadMainSerial({
    ports,
    prepareSerialPort: async () => {},
    async disposeSerialPort(port) {
      port.opening = false;
      port.isOpen = false;
    },
  });
  const window = {
    isDestroyed: () => false,
    webContents: {
      send(channel, envelope) {
        sent.push({ channel, envelope });
      },
    },
  };

  const opening = serial.connect(
    "COM8",
    { bitrate: 460800, forceDtrLow: true },
    window,
  );
  const port = ports[0];
  port.opening = false;
  port.isOpen = true;
  port.emit("open");
  const opened = await opening;
  assert.equal(opened.error, false);

  const nativeError = new Error("Access to COM8 was lost");
  nativeError.code = "ERROR_DEVICE_NOT_CONNECTED";
  nativeError.errno = 1167;
  port.emit("error", nativeError);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "serialError");
  assert.equal(sent[0].envelope.connectionId, opened.id);
  assert.equal(sent[0].envelope.event, "error");
  assert.equal(sent[0].envelope.origin, "native");
  assert.equal(sent[0].envelope.expected, false);
  assert.equal(sent[0].envelope.phase, "active");
  assert.equal(sent[0].envelope.error, "Access to COM8 was lost");
  assert.equal(
    sent[0].envelope.errorDetails.code,
    "ERROR_DEVICE_NOT_CONNECTED",
  );
  assert.equal(sent[0].envelope.errorDetails.errno, 1167);
  assert.equal(port.destroyed, true);
  assert.equal(serial._serialport, null);
  assert.equal(serial._connectionId, null);
});
