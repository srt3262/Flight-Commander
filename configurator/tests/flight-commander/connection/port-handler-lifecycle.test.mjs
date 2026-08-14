import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function createHarness({
  snapshots,
  connectedPort = "COM8",
  connectionId = 41,
} = {}) {
  const raw = readFileSync(
    resolve(projectRoot, "js/port_handler.js"),
    "utf8",
  );
  const source = raw
    .slice(raw.indexOf("var usbDevices"))
    .replace(
      "export  { usbDevices, PortHandler };",
      "globalThis.__portHandler = PortHandler;",
    );

  const state = {
    disconnectClicks: 0,
    enumerateCalls: 0,
    options: [],
    portValue: connectedPort || "manual",
    baudValue: null,
    protocolValue: "mavlink",
  };
  const timers = [];
  let nextTimerId = 1;
  const portElement = {
    html(value) {
      if (value === "") state.options = [];
      return this;
    },
    append(option) {
      state.options.push(option.attrs);
      return this;
    },
    val(value) {
      if (arguments.length === 0) return state.portValue;
      state.portValue = value;
      return this;
    },
  };
  const protocolElement = {
    val(value) {
      if (arguments.length === 0) return state.protocolValue;
      state.protocolValue = value;
      return this;
    },
  };
  const baudElement = {
    val(value) {
      if (arguments.length === 0) return state.baudValue;
      state.baudValue = value;
      return this;
    },
  };
  const inertElement = {
    length: 0,
    append() {
      return this;
    },
    prop() {
      return this;
    },
    remove() {
      return this;
    },
    trigger() {
      return this;
    },
    val() {
      return null;
    },
  };
  function $(selector, attributes) {
    if (String(selector).startsWith("<option")) {
      return { attrs: { ...attributes } };
    }
    if (
      selector === "#port" ||
      selector === "div#port-picker #port"
    ) {
      return portElement;
    }
    if (selector === "#protocol") return protocolElement;
    if (selector === "#baud") return baudElement;
    if (selector === "div#port-picker a.connect") {
      return {
        trigger() {
          state.disconnectClicks += 1;
          return this;
        },
      };
    }
    return inertElement;
  }

  const remainingSnapshots = snapshots.map((ports) => [...ports]);
  const GUI = {
    connected_to: connectedPort || false,
    updateManualPortVisibility() {},
  };
  const CONFIGURATOR = {
    connection: {
      type: 0,
      connectionId,
    },
  };
  const context = vm.createContext({
    $,
    CONNECTION_BAUD_PREFERENCES_KEY: "connectionBaudPreferencesByProtocol",
    CONFIGURATOR,
    ConnectionSerial: {
      async getDevices() {
        state.enumerateCalls += 1;
        const next = remainingSnapshots.shift();
        return next ?? [];
      },
    },
    ConnectionType: { Serial: 0 },
    GUI,
    Promise,
    clearTimeout(handle) {
      if (handle) handle.canceled = true;
    },
    console: { log() {} },
    navigator: { usb: { getDevices: async () => [] } },
    resolveConnectionBaud() {
      return 460800;
    },
    self: {},
    setTimeout(callback, delay) {
      const handle = {
        callback,
        canceled: false,
        delay,
        fired: false,
        id: nextTimerId++,
      };
      timers.push(handle);
      return handle;
    },
    store: {
      get(key, defaultValue) {
        return defaultValue;
      },
      set() {},
    },
  });
  new vm.Script(source, {
    filename: "js/port_handler.js",
  }).runInContext(context);
  const handler = context.__portHandler;
  handler.check_usb_devices = () => {};

  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }

  function activePollTimers() {
    return timers.filter(
      (timer) =>
        timer.delay === 250 &&
        !timer.canceled &&
        !timer.fired,
    );
  }

  async function runNextPoll() {
    const timer = activePollTimers()[0];
    assert.ok(timer, "expected one scheduled PortHandler poll");
    timer.fired = true;
    timer.callback();
    await settle();
  }

  return {
    CONFIGURATOR,
    GUI,
    activePollTimers,
    handler,
    runNextPoll,
    settle,
    state,
  };
}

test("a transient COM omission cannot disconnect or remove a live connected port", async () => {
  const harness = createHarness({
    snapshots: [["COM8"], [], ["COM8"]],
  });

  assert.equal(harness.handler.initialize(), true);
  await harness.settle();
  assert.deepEqual(
    harness.state.options.map(({ value }) => value).slice(0, 1),
    ["COM8"],
  );
  assert.equal(harness.state.portValue, "COM8");

  let removalCallbacks = 0;
  harness.handler.port_removed_callbacks.push({
    code() {
      removalCallbacks += 1;
    },
    timer: false,
  });

  await harness.runNextPoll();
  assert.deepEqual(Array.from(harness.handler.initial_ports), ["COM8"]);
  assert.equal(harness.state.portValue, "COM8");
  assert.ok(
    harness.state.options.some(({ value }) => value === "COM8"),
    "the connected COM option must remain in the selector",
  );
  assert.equal(harness.state.disconnectClicks, 0);
  assert.equal(removalCallbacks, 0);

  await harness.runNextPoll();
  assert.deepEqual(Array.from(harness.handler.initial_ports), ["COM8"]);
  assert.equal(harness.state.disconnectClicks, 0);
  assert.equal(removalCallbacks, 0);
});

test("repeated initialize calls create exactly one polling loop", async () => {
  const harness = createHarness({
    snapshots: [["COM8"], ["COM8"]],
  });

  assert.equal(harness.handler.initialize(), true);
  assert.equal(harness.handler.initialize(), false);
  assert.equal(harness.handler.initialize(), false);
  await harness.settle();

  assert.equal(harness.state.enumerateCalls, 1);
  assert.equal(harness.activePollTimers().length, 1);

  await harness.runNextPoll();
  assert.equal(harness.state.enumerateCalls, 2);
  assert.equal(harness.activePollTimers().length, 1);
  assert.equal(harness.handler.initialize(), false);
  assert.equal(harness.activePollTimers().length, 1);
});

test("port removal callbacks still run after the native connection is no longer live", async () => {
  const harness = createHarness({
    snapshots: [["COM8"], []],
    connectedPort: "COM8",
    connectionId: 41,
  });

  harness.handler.initialize();
  await harness.settle();
  let removed = null;
  harness.handler.port_removed_callbacks.push({
    code(ports) {
      removed = Array.from(ports);
    },
    timer: false,
  });

  harness.GUI.connected_to = false;
  harness.CONFIGURATOR.connection.connectionId = false;
  await harness.runNextPoll();
  assert.deepEqual(removed, ["COM8"]);
  assert.equal(harness.state.disconnectClicks, 0);
});

test("exact reboot-port wait ignores unrelated COM arrivals", async () => {
  const harness = createHarness({
    snapshots: [[], ["COM9"], ["COM9", "COM16"]],
    connectedPort: false,
    connectionId: false,
  });

  harness.handler.initialize();
  await harness.settle();
  assert.equal(harness.handler.is_port_available("COM16"), false);

  const detections = [];
  const wait = harness.handler.port_detected_exact(
    "cube-reboot",
    "COM16",
    (ports) => detections.push(ports),
    30000,
  );

  await harness.runNextPoll();
  assert.deepEqual(detections, []);
  assert.ok(harness.handler.port_detected_callbacks.includes(wait));

  await harness.runNextPoll();
  assert.equal(harness.handler.is_port_available("COM16"), true);
  assert.deepEqual(
    detections.map((ports) => Array.from(ports)),
    [["COM16"]],
  );
  assert.equal(harness.handler.port_detected_callbacks.includes(wait), false);
});
