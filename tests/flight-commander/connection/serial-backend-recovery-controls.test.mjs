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

function loadRecoveryHarness({
  ports = ["COM9", "manual"],
  selectedPort = "COM9",
  sourceLineEnding = null,
} = {}) {
  const rawSource = readFileSync(
    resolve(projectRoot, "js/serial_backend.js"),
    "utf8",
  );
  const source = (
    sourceLineEnding === "\r\n"
      ? rawSource.replace(/\r?\n/g, "\r\n")
      : rawSource
  )
    .replace(/\r\n/g, "\n")
    .replace(
      /^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm,
      "",
    )
    .replace(
      "    return publicScope;\n\n})();",
      [
        "    globalThis.__serialBackendPrivate = privateScope;",
        "    globalThis.__serialBackendPublic = publicScope;",
        "    return publicScope;",
        "",
        "})();",
      ].join("\n"),
    )
    .replace(
      "export default SerialBackend;",
      "globalThis.__serialBackend = SerialBackend;",
    );

  const optionRecords = ports.map((port) => ({
    data: {
      isManual: port === "manual",
      isBle: port === "ble",
      isTcp: port === "tcp",
      isUdp: port === "udp",
      isSitl: port === "sitl" || port === "sitl-demo",
      isDFU: port === "DFU",
    },
    value: port,
  }));
  const elements = new Map();
  const timers = [];
  const connectCalls = [];
  const connectionFactoryCalls = [];
  const serialOptionCalls = [];
  const storeWrites = [];
  let nextTimerId = 1;

  class OptionCollection {
    constructor(records) {
      this.records = records;
      this.length = records.length;
    }

    data() {
      return this.records[0]?.data ?? {};
    }

    filter(predicate) {
      return new OptionCollection(
        this.records.filter((record) => predicate.call(record)),
      );
    }

    val() {
      return this.records[0]?.value;
    }
  }

  class Element {
    constructor(selector, value = "") {
      this.selector = selector;
      this.value = value;
      this.handlers = new Map();
      this.visible = true;
    }

    val(value) {
      if (arguments.length === 0) return this.value;
      this.value = value;
      return this;
    }

    on(eventName, handler) {
      if (!this.handlers.has(eventName)) {
        this.handlers.set(eventName, []);
      }
      this.handlers.get(eventName).push(handler);
      return this;
    }

    trigger(eventName) {
      for (const handler of this.handlers.get(eventName) ?? []) {
        handler.call(this, { type: eventName, target: this });
      }
      return this;
    }

    find(query) {
      if (this.selector !== "#port") return new OptionCollection([]);
      if (query === "option") return new OptionCollection(optionRecords);
      if (query === "option:selected") {
        return new OptionCollection(
          optionRecords.filter(
            (record) => String(record.value) === String(this.value),
          ),
        );
      }
      return new OptionCollection([]);
    }

    data() {
      return {};
    }

    is(query) {
      return query === ":checked" ? false : false;
    }

    text(value) {
      if (arguments.length === 0) return this.value;
      this.value = String(value);
      return this;
    }

    html() {
      return String(this.value);
    }

    hide() {
      this.visible = false;
      return this;
    }

    show() {
      this.visible = true;
      return this;
    }

    prop() {
      return this;
    }

    addClass() {
      return this;
    }

    removeClass() {
      return this;
    }

    attr() {
      return this;
    }

    empty() {
      return this;
    }

    click() {
      return this.trigger("click");
    }
  }

  const portElement = new Element("#port", selectedPort);
  const baudElement = new Element("#baud", "460800");
  const protocolElement = new Element("#protocol", "mavlink");
  const overrideElement = new Element("#port-override", "");
  elements.set("#port", portElement);
  elements.set("#baud", baudElement);
  elements.set("#protocol", protocolElement);
  elements.set("#port-override", overrideElement);

  function elementFor(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, new Element(selector));
    }
    return elements.get(selector);
  }

  function $(selector) {
    if (selector && typeof selector === "object" && "value" in selector) {
      return new OptionCollection([selector]);
    }
    if (typeof selector === "string" && selector.startsWith("<")) {
      return new Element(selector);
    }
    return elementFor(String(selector));
  }

  function makeConnection(type) {
    return {
      type,
      connectionId: false,
      connect(path, options, callback) {
        connectCalls.push({
          callback,
          options: { ...options },
          path,
          type: this.type,
        });
      },
    };
  }

  const ConnectionType = {
    Serial: 0,
    TCP: 1,
    UDP: 2,
    BLE: 3,
  };
  const CONFIGURATOR = {
    cliActive: false,
    connection: makeConnection(ConnectionType.Serial),
    connectionProtocol: null,
    connectionValid: false,
  };
  const GUI = {
    connect_lock: false,
    connected_to: false,
    connecting_to: false,
    log() {},
  };
  const storedValues = new Map([
    ["connectionProtocolPreference", "mavlink"],
    ["portOverride", ""],
  ]);
  const store = {
    get(key, defaultValue) {
      return storedValues.has(key) ? storedValues.get(key) : defaultValue;
    },
    set(key, value) {
      storedValues.set(key, value);
      storeWrites.push({ key, value });
    },
  };

  const context = vm.createContext({
    $,
    BitHelper: { bit_check() { return false; } },
    CONFIGURATOR,
    CONNECTION_BAUD_PREFERENCES_KEY: "connectionBaudPreferencesByProtocol",
    Connection: class {},
    ConnectionType,
    FC: {},
    GUI,
    MSP: {
      disconnect_cleanup() {},
    },
    MSPCodes: {},
    PortHandler: {
      initialize() {},
    },
    SERIAL_STARTUP_RECOVERY_DELAY_MS: 1500,
    SITLProcess: {
      start() {},
      stop() {},
    },
    clearTimeout(timer) {
      if (timer) timer.canceled = true;
    },
    cliTab: {},
    confirm() {
      return true;
    },
    connectionFactory(type, current) {
      connectionFactoryCalls.push({ current, type });
      if (current && (current.type === type || current.connectionId)) {
        return current;
      }
      return makeConnection(type);
    },
    console: { log() {} },
    defaultsDialog: {},
    groundstation: {
      deactivate() {},
      isActivated() {
        return false;
      },
    },
    i18n: {
      getMessage(key) {
        return key;
      },
    },
    inavMavlinkProfileStore: {},
    initializeExplicitMavlinkTransport() {
      return { ok: true };
    },
    interval: {
      killAll() {},
    },
    javascriptProgrammingTab: {
      isDirty: false,
    },
    jBox: class {},
    ltmDecoder: {
      reset() {},
    },
    mavlinkCommandRouter: {},
    mavlinkSession: {},
    mspDeduplicationQueue: {
      flush() {},
    },
    mspHelper: {
      setSensorStatusEx() {},
    },
    mspQueue: {
      flush() {},
      freeHardLock() {},
      freeSoftLock() {},
      setLockMethod() {},
    },
    persistProtocolBaudPreference() {},
    periodicStatusUpdater: {},
    queueGroundControlActivation() {},
    resolveConnectionBaud({ protocol }) {
      return protocol === "mavlink" ? 460800 : 115200;
    },
    runCriticalMavlinkTransition() {},
    semver: {},
    serialOptionsForProtocol(protocol, bitrate) {
      serialOptionCalls.push({ bitrate, protocol });
      return {
        bitrate,
        forceDtrLow: protocol === "mavlink",
        protocol,
      };
    },
    setTimeout(callback, delay) {
      const timer = {
        callback,
        canceled: false,
        delay,
        id: nextTimerId++,
      };
      timers.push(timer);
      return timer;
    },
    shouldAttemptMavlinkStartupRecovery() {
      return false;
    },
    store,
    timeout: {
      killAll() {},
    },
    unexpectedSerialTerminationMessage() {
      return "";
    },
    update: {},
  });

  new vm.Script(source, {
    filename: "js/serial_backend.js",
  }).runInContext(context);
  context.__serialBackend.init();

  return {
    CONFIGURATOR,
    ConnectionType,
    GUI,
    backendPrivate: context.__serialBackendPrivate,
    connectCalls,
    connectionFactoryCalls,
    elements,
    makeConnection,
    serialOptionCalls,
    storeWrites,
    timers,
  };
}

function startupCloseContext({
  port = "COM8",
  recoveryAttempt = 0,
} = {}) {
  return {
    openAttempt: {
      bitrate: 460800,
      port,
      protocol: "mavlink",
      recoveryAttempt,
    },
  };
}

test("the recovery harness instruments a Windows CRLF checkout", () => {
  const harness = loadRecoveryHarness({ sourceLineEnding: "\r\n" });
  assert.equal(
    typeof harness.backendPrivate.scheduleUnexpectedSerialRecovery,
    "function",
  );
});

test("port, protocol, and baud changes cancel recovery and invalidate its queued callback", () => {
  const cases = [
    { selector: "#port", value: "manual" },
    { selector: "#protocol", value: "msp" },
    { selector: "#baud", value: "115200" },
  ];

  for (const { selector, value } of cases) {
    const harness = loadRecoveryHarness();
    harness.backendPrivate.scheduleUnexpectedSerialRecovery(
      startupCloseContext(),
    );
    const timer = harness.timers.at(-1);
    assert.equal(timer.delay, 1500);

    harness.elements.get(selector).val(value).trigger("change");

    assert.equal(timer.canceled, true, `${selector} must cancel the timer`);
    assert.equal(
      harness.backendPrivate.unexpectedSerialRecoveryTimer,
      null,
    );

    // Simulate an already-queued timer callback which clearTimeout cannot
    // retract. The recovery generation must still make it inert.
    timer.callback();
    assert.equal(harness.connectCalls.length, 0);
    assert.equal(harness.elements.get(selector).val(), value);
  }
});

test("a missing COM option retries the exact MAVLink link through manual selection", () => {
  const harness = loadRecoveryHarness({
    ports: ["COM9", "manual", "tcp"],
    selectedPort: "COM9",
  });
  harness.CONFIGURATOR.connection = harness.makeConnection(
    harness.ConnectionType.UDP,
  );

  harness.backendPrivate.scheduleUnexpectedSerialRecovery(
    startupCloseContext({ port: "COM8" }),
  );
  const timer = harness.timers.at(-1);
  timer.callback();

  assert.equal(harness.elements.get("#port").val(), "manual");
  assert.equal(harness.elements.get("#port-override").val(), "COM8");
  assert.equal(harness.elements.get("#protocol").val(), "mavlink");
  assert.equal(String(harness.elements.get("#baud").val()), "460800");
  assert.equal(
    harness.storeWrites.some(
      ({ key, value }) => key === "portOverride" && value === "COM8",
    ),
    true,
  );
  assert.equal(
    harness.CONFIGURATOR.connection.type,
    harness.ConnectionType.Serial,
  );
  assert.equal(harness.connectCalls.length, 1);
  assert.deepEqual(
    {
      options: harness.connectCalls[0].options,
      path: harness.connectCalls[0].path,
      type: harness.connectCalls[0].type,
    },
    {
      options: {
        bitrate: 460800,
        forceDtrLow: true,
        protocol: "mavlink",
      },
      path: "COM8",
      type: harness.ConnectionType.Serial,
    },
  );
  assert.deepEqual(harness.serialOptionCalls, [
    { bitrate: 460800, protocol: "mavlink" },
  ]);
  assert.deepEqual(
    {
      ...harness.backendPrivate.pendingOpenAttempt,
    },
    {
      bitrate: 460800,
      port: "COM8",
      protocol: "mavlink",
      recoveryAttempt: 1,
    },
  );
  assert.equal(
    Object.isFrozen(harness.backendPrivate.pendingOpenAttempt),
    true,
  );
});

test("a newer recovery generation makes an older queued timer inert", () => {
  const harness = loadRecoveryHarness({
    ports: ["manual"],
    selectedPort: "manual",
  });

  harness.backendPrivate.scheduleUnexpectedSerialRecovery(
    startupCloseContext({ port: "COM8" }),
  );
  const staleTimer = harness.timers.at(-1);
  harness.backendPrivate.scheduleUnexpectedSerialRecovery(
    startupCloseContext({ port: "COM10" }),
  );
  const currentTimer = harness.timers.at(-1);

  assert.notEqual(currentTimer, staleTimer);
  assert.equal(staleTimer.canceled, true);

  staleTimer.callback();
  assert.equal(harness.connectCalls.length, 0);
  assert.equal(harness.elements.get("#port-override").val(), "");

  currentTimer.callback();
  assert.equal(harness.connectCalls.length, 1);
  assert.equal(harness.connectCalls[0].path, "COM10");
  assert.equal(harness.elements.get("#port-override").val(), "COM10");
});
