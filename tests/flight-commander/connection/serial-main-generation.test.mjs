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
