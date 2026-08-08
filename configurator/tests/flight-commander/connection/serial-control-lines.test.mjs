import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";

import { SerialPortStream } from "@serialport/stream";

import {
  configureSerialControlLines,
  disposeSerialPort,
  prepareSerialPort,
  quarantineOpeningSerialPort,
  serialOpenControlLineOptions,
} from "../../../js/main/serialControlLines.js";

test("native Windows open starts ExpressLRS with DTR and RTS low", () => {
  assert.deepEqual(
    serialOpenControlLineOptions({ forceDtrLow: true }, "win32"),
    {
      hupcl: false,
      rtscts: false,
    },
  );
  assert.deepEqual(
    serialOpenControlLineOptions({ forceDtrLow: false }, "win32"),
    {},
  );
  assert.deepEqual(
    serialOpenControlLineOptions({ forceDtrLow: true }, "linux"),
    {},
  );
});

test("pinned serial library receives low control lines before and after open", async () => {
  let openOptions;
  let setOptions;
  const nativePort = {
    isOpen: true,
    async close() {
      this.isOpen = false;
    },
    async drain() {},
    async flush() {},
    async get() {
      return {};
    },
    async read(buffer) {
      return { bytesRead: 0, buffer };
    },
    async set(options) {
      setOptions = options;
    },
    async update() {},
    async write() {},
  };
  const binding = {
    async open(options) {
      openOptions = options;
      return nativePort;
    },
  };
  const port = new SerialPortStream({
    binding,
    path: "COM8",
    baudRate: 460800,
    autoOpen: true,
    ...serialOpenControlLineOptions({ forceDtrLow: true }, "win32"),
  });

  await once(port, "open");
  assert.equal(openOptions.hupcl, false);
  assert.equal(openOptions.rtscts, false);

  await configureSerialControlLines(
    port,
    { forceDtrLow: true },
    "win32",
  );
  assert.equal(setOptions.dtr, false);
  assert.equal(setOptions.rts, false);

  await new Promise((resolve, reject) => {
    port.close((error) => (error ? reject(error) : resolve()));
  });
});

test("DTR/RTS-low setup is applied only when explicitly requested on Windows", async () => {
  const calls = [];
  const port = {
    set(signals, callback) {
      calls.push(signals);
      callback();
    },
  };

  assert.equal(
    await configureSerialControlLines(port, { forceDtrLow: true }, "linux"),
    false,
  );
  assert.equal(
    await configureSerialControlLines(port, { forceDtrLow: false }, "win32"),
    false,
  );
  assert.deepEqual(calls, []);

  assert.equal(
    await configureSerialControlLines(port, { forceDtrLow: true }, "win32"),
    true,
  );
  assert.deepEqual(calls, [{ dtr: false, rts: false }]);
});

test("DTR/RTS-low setup does not settle until the serial driver callback", async () => {
  let driverCallback;
  let settled = false;
  const port = {
    set(signals, callback) {
      assert.deepEqual(signals, { dtr: false, rts: false });
      driverCallback = callback;
    },
  };

  const setup = configureSerialControlLines(
    port,
    { forceDtrLow: true },
    "win32",
  ).then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  driverCallback();
  await setup;
  assert.equal(settled, true);
});

test("DTR/RTS-low setup propagates callback and synchronous driver failures", async () => {
  await assert.rejects(
    configureSerialControlLines(
      {
        set(_signals, callback) {
          callback(new Error("control-line failure"));
        },
      },
      { forceDtrLow: true },
      "win32",
    ),
    /control-line failure/,
  );

  await assert.rejects(
    configureSerialControlLines(
      {
        set() {
          throw new Error("driver threw");
        },
      },
      { forceDtrLow: true },
      "win32",
    ),
    /driver threw/,
  );
});

test("DTR/RTS-low setup fails instead of leaving the UI connecting forever", async () => {
  await assert.rejects(
    configureSerialControlLines(
      {
        set() {
          // Simulate a driver that neither returns a promise nor invokes its
          // completion callback.
        },
      },
      { forceDtrLow: true, controlLineTimeoutMs: 5 },
      "win32",
    ),
    /timed out after 5 ms/,
  );
});

test("DTR/RTS-low setup supports promise-based serial drivers", async () => {
  const calls = [];
  const port = {
    set(signals) {
      calls.push(signals);
      return Promise.resolve();
    },
  };

  assert.equal(
    await configureSerialControlLines(port, { forceDtrLow: true }, "win32"),
    true,
  );
  assert.deepEqual(calls, [{ dtr: false, rts: false }]);
});

test("failed serial setup removes listeners, closes, then destroys the port", async () => {
  const events = [];
  let closeCallback;
  const port = {
    isOpen: true,
    removeAllListeners() {
      events.push("remove-listeners");
    },
    close(callback) {
      events.push("close");
      closeCallback = callback;
    },
    destroy() {
      events.push("destroy");
    },
  };

  let disposed = false;
  const cleanup = disposeSerialPort(port).then(() => {
    disposed = true;
  });

  await Promise.resolve();
  assert.equal(disposed, false);
  assert.deepEqual(events, ["remove-listeners", "close"]);

  closeCallback(new Error("close error is best effort"));
  await cleanup;
  assert.equal(disposed, true);
  assert.deepEqual(events, ["remove-listeners", "close", "destroy"]);
});

test("failed serial setup destroys a port which is already closed", async () => {
  const events = [];
  await disposeSerialPort({
    isOpen: false,
    removeAllListeners() {
      events.push("remove-listeners");
    },
    close() {
      events.push("close");
    },
    destroy() {
      events.push("destroy");
    },
  });

  assert.deepEqual(events, ["remove-listeners", "destroy"]);
});

test("failed serial cleanup destroys the port when its close callback hangs", async () => {
  const events = [];
  const port = {
    isOpen: true,
    removeAllListeners() {
      events.push("remove-listeners");
    },
    close() {
      events.push("close");
      // Simulate a serial driver that never invokes its completion callback.
    },
    destroy() {
      events.push("destroy");
    },
  };

  await disposeSerialPort(port, 5);
  assert.deepEqual(events, ["remove-listeners", "close", "destroy"]);
});

test("serial preparation closes the port before propagating a DTR failure", async () => {
  const events = [];
  const port = {
    isOpen: true,
    set(signals, callback) {
      events.push(["set", signals]);
      callback(new Error("DTR rejected"));
    },
    removeAllListeners() {
      events.push("remove-listeners");
    },
    close(callback) {
      events.push("close");
      callback();
    },
    destroy() {
      events.push("destroy");
    },
  };

  await assert.rejects(
    prepareSerialPort(port, { forceDtrLow: true }, "win32"),
    /DTR rejected/,
  );
  assert.deepEqual(events, [
    ["set", { dtr: false, rts: false }],
    "remove-listeners",
    "close",
    "destroy",
  ]);
});

test("serial preparation cannot hang when both DTR setup and close callbacks stall", async () => {
  const events = [];
  const port = {
    isOpen: true,
    set() {
      events.push("set");
    },
    removeAllListeners() {
      events.push("remove-listeners");
    },
    close() {
      events.push("close");
    },
    destroy() {
      events.push("destroy");
    },
  };

  await assert.rejects(
    prepareSerialPort(
      port,
      { forceDtrLow: true, controlLineTimeoutMs: 5, closeTimeoutMs: 5 },
      "win32",
    ),
    /control-line setup timed out after 5 ms/,
  );
  assert.deepEqual(events, [
    "set",
    "remove-listeners",
    "close",
    "destroy",
  ]);
});

test("a native port which opens after the app deadline is immediately closed", async () => {
  const events = [];
  const port = new EventEmitter();
  port.isOpen = false;
  port.opening = true;
  port.removeAllListeners = port.removeAllListeners.bind(port);
  port.close = (callback) => {
    events.push("close");
    port.isOpen = false;
    callback();
  };
  port.destroy = () => events.push("destroy");
  port.on("data", () => events.push("obsolete-listener"));

  assert.equal(quarantineOpeningSerialPort(port), true);
  port.opening = false;
  port.isOpen = true;
  port.emit("open");
  await Promise.resolve();

  assert.deepEqual(events, ["close", "destroy"]);
  assert.equal(port.listenerCount("data"), 0);
});
