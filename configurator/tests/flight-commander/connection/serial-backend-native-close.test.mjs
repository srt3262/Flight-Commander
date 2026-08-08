import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  CONNECTION_BAUD_PREFERENCES_KEY,
  persistProtocolBaudPreference,
  resolveConnectionBaud,
  serialOptionsForProtocol,
} from "../../../js/connection/connectionPreferences.js";
import {
  INAV_REBOOT_RECONNECT_DELAY_MS,
  createInavRebootRecoveryAttempt,
  nextInavRebootRecoveryAttempt,
} from "../../../js/connection/inavRebootRecovery.js";
import {
  SERIAL_STARTUP_RECOVERY_DELAY_MS,
  SERIAL_TERMINAL_OPERATOR_GUARD_MS,
  shouldAttemptMavlinkStartupRecovery,
  unexpectedSerialTerminationMessage,
} from "../../../js/connection/serialRecoveryPolicy.js";
import {
  initializeExplicitMavlinkTransport,
  runCriticalMavlinkTransition,
} from "../../../js/gcs/mavlinkTransportStartup.js";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const SERIAL_CLOSED_OK = "__serial_port_closed_ok__";
const SERIAL_CLOSED_FAIL = "__serial_port_closed_fail__";

function createBackendHarness({ deferDisconnect = false, protocol = "mavlink" } = {}) {
  const logs = [];
  const consoleLogs = [];
  const connectCalls = [];
  const timers = [];
  const commandBlocks = [];
  const startupErrors = [];
  const elementHandlers = new Map();
  const elementValues = new Map([
    ["#port", "COM8"],
    ["#baud", "460800"],
    ["#protocol", protocol],
    ["#port-override", ""],
  ]);
  const elementClasses = new Map();
  const storedValues = new Map([
    ["connectionProtocolPreference", protocol],
    [CONNECTION_BAUD_PREFERENCES_KEY, { [protocol]: 460800 }],
  ]);
  let nextConnectionId = 41;
  let failBatteryRender = false;
  let pendingDisconnectCallback = null;

  const portOptions = [
    "COM8",
    "manual",
    "ble",
    "tcp",
    "udp",
    "sitl",
    "sitl-demo",
  ];

  function handlersFor(selector, event) {
    const key = `${selector}:${event}`;
    if (!elementHandlers.has(key)) elementHandlers.set(key, []);
    return elementHandlers.get(key);
  }

  function selectedPortData() {
    const selected = elementValues.get("#port");
    return {
      isManual: selected === "manual",
      isBle: selected === "ble",
      isTcp: selected === "tcp",
      isUdp: selected === "udp",
      isSitl: selected === "sitl" || selected === "sitl-demo",
      isDFU: selected === "DFU",
    };
  }

  class FakeOption {
    constructor(value) {
      this.value = value;
    }

    val() {
      return this.value;
    }
  }

  class FakeElement {
    constructor(selector) {
      this.selector = String(selector);
      this.length = 1;
      this._text = "";
      this._props = new Map();
      this._attrs = new Map();
    }

    val(value) {
      if (arguments.length === 0) {
        return elementValues.get(this.selector) ?? "";
      }
      elementValues.set(this.selector, String(value));
      return this;
    }

    data() {
      if (this.selector === "#port option:selected") {
        return selectedPortData();
      }
      return {};
    }

    find(query) {
      if (this.selector === "#port" && query === "option:selected") {
        return new FakeElement("#port option:selected");
      }
      if (this.selector === "#port" && query === "option") {
        return {
          filter(callback) {
            const matches = portOptions.filter((value) =>
              callback.call(new FakeOption(value)),
            );
            return { length: matches.length };
          },
        };
      }
      return element(`${this.selector} ${query}`);
    }

    on(event, callback) {
      handlersFor(this.selector, event).push(callback);
      return this;
    }

    trigger(event) {
      for (const callback of [...handlersFor(this.selector, event)]) {
        callback.call(this, { type: event, target: this });
      }
      return this;
    }

    click() {
      return this.trigger("click");
    }

    text(value) {
      if (arguments.length === 0) return this._text;
      this._text = String(value);
      return this;
    }

    html() {
      return this._text;
    }

    prop(name, value) {
      if (arguments.length === 1) return this._props.get(name);
      this._props.set(name, value);
      return this;
    }

    attr(name, value) {
      if (typeof name === "object") {
        for (const [key, nextValue] of Object.entries(name)) {
          this._attrs.set(key, nextValue);
        }
      } else if (arguments.length === 1) {
        return this._attrs.get(name);
      } else {
        this._attrs.set(name, value);
      }
      return this;
    }

    addClass(...names) {
      const classes = elementClasses.get(this.selector) ?? new Set();
      for (const name of names.join(" ").split(/\s+/).filter(Boolean)) {
        classes.add(name);
      }
      elementClasses.set(this.selector, classes);
      return this;
    }

    removeClass(...names) {
      const classes = elementClasses.get(this.selector) ?? new Set();
      for (const name of names.join(" ").split(/\s+/).filter(Boolean)) {
        classes.delete(name);
      }
      elementClasses.set(this.selector, classes);
      return this;
    }

    toggleClass(name, enabled) {
      return enabled ? this.addClass(name) : this.removeClass(name);
    }

    hasClass(name) {
      return (elementClasses.get(this.selector) ?? new Set()).has(name);
    }

    css() {
      if (this.selector === ".battery-status" && failBatteryRender) {
        failBatteryRender = false;
        throw new Error("battery status renderer failed");
      }
      return this;
    }

    is(query) {
      if (query === ":checked") return false;
      if (query === "a") return this.selector.includes(" a");
      return false;
    }

    hide() {
      return this;
    }

    show() {
      return this;
    }

    empty() {
      return this;
    }

    toggle() {
      return this;
    }
  }

  const elements = new Map();
  function element(selector) {
    const key = String(selector);
    if (!elements.has(key)) elements.set(key, new FakeElement(key));
    return elements.get(key);
  }

  function $(selector) {
    if (selector instanceof FakeOption || selector instanceof FakeElement) {
      return selector;
    }
    return element(selector);
  }

  const GUI = {
    active_tab: null,
    allowedTabs: [],
    connect_lock: false,
    connected_to: false,
    connecting_to: false,
    defaultAllowedTabsWhenConnected: ["setup"],
    defaultAllowedTabsWhenDisconnected: ["landing"],
    defaultAllowedTabsWhenMavlinkConnected: ["flight_data"],
    defaultAllowedTabsWhenTelemetryConnected: ["flight_data"],
    mavlinkWaitingMessage: null,
    tab_switch_in_progress: false,
    log(message) {
      logs.push(String(message));
    },
    tab_switch_cleanup(callback) {
      if (callback) callback();
    },
  };

  const connection = {
    type: 0,
    connectionId: false,
    bitrate: 0,
    cause: null,
    disconnectCalls: 0,
    connect(path, options, callback) {
      const connectionId = nextConnectionId++;
      this.connectionId = connectionId;
      this.bitrate = options.bitrate;
      connectCalls.push({
        connectionId,
        path,
        options: { ...options },
      });
      callback({
        bitrate: options.bitrate,
        connectionId,
      });
    },
    disconnect(callback) {
      this.disconnectCalls += 1;
      if (deferDisconnect) {
        pendingDisconnectCallback = callback;
        return;
      }
      this.connectionId = false;
      if (callback) callback(true);
    },
    consumeDisconnectCause() {
      const cause = this.cause;
      this.cause = null;
      return cause;
    },
    addOnReceiveListener() {},
    removeOnReceiveCallback() {},
    emptyOutputBuffer() {},
  };

  const CONFIGURATOR = {
    cliActive: false,
    connection,
    connectionProtocol: null,
    connectionValid: false,
    maxFirmwareVersionAccepted: "10.0.0",
    minFirmwareVersionAccepted: "9.0.0",
  };

  const sessionListeners = new Map();
  const mavlinkSession = {
    attached: false,
    attachCount: 0,
    detachCount: 0,
    state: {
      connected: false,
      firmwareFamily: "unknown",
      linkLost: false,
    },
    attach() {
      this.attached = true;
      this.attachCount += 1;
    },
    detach() {
      this.attached = false;
      this.detachCount += 1;
      this.state.connected = false;
    },
    on(event, callback) {
      if (!sessionListeners.has(event)) sessionListeners.set(event, []);
      sessionListeners.get(event).push(callback);
      return () => {
        const callbacks = sessionListeners.get(event) ?? [];
        const index = callbacks.indexOf(callback);
        if (index >= 0) callbacks.splice(index, 1);
      };
    },
    emit(event, payload) {
      if (event === "connected") {
        Object.assign(this.state, payload, { connected: true });
      }
      for (const callback of [...(sessionListeners.get(event) ?? [])]) {
        callback(payload);
      }
    },
  };

  const mavlinkCommandRouter = {
    blockedReason: null,
    blockCommands(reason) {
      this.blockedReason = String(reason);
      commandBlocks.push(this.blockedReason);
      return this.blockedReason;
    },
    clearCommandBlock() {
      this.blockedReason = null;
    },
    stop() {},
  };

  const timeoutEntries = new Map();
  const timeout = {
    add(name, callback, delay) {
      timeoutEntries.set(name, { callback, delay });
    },
    remove(name) {
      timeoutEntries.delete(name);
    },
    killAll() {
      timeoutEntries.clear();
    },
  };

  const queue = {
    flush() {},
    freeHardLock() {},
    freeSoftLock() {},
    getLoad: () => 0,
    getRoundtrip: () => 0,
    getHardwareRoundtrip: () => 0,
    setLockMethod() {},
  };

  const context = vm.createContext({
    $,
    BitHelper: { bit_check: () => false },
    CONFIGURATOR,
    CONNECTION_BAUD_PREFERENCES_KEY,
    Connection: {},
    ConnectionType: {
      Serial: 0,
      TCP: 1,
      UDP: 2,
      BLE: 3,
    },
    Date,
    FC: {
      CONFIG: {},
      PIDs: [],
      restartRequired: false,
      generateAuxConfig() {},
      resetState() {},
    },
    GUI,
    INAV_REBOOT_RECONNECT_DELAY_MS,
    MSP: {
      constants: { PROTOCOL_V2: 2 },
      disconnect_cleanup() {},
      isReceiving: () => false,
      read() {},
      send_message() {},
    },
    MSPCodes: {},
    PortHandler: { initialize() {} },
    Promise,
    SERIAL_STARTUP_RECOVERY_DELAY_MS,
    SERIAL_TERMINAL_OPERATOR_GUARD_MS,
    SITLProcess: {
      start() {},
      stop() {},
    },
    clearTimeout(handle) {
      if (handle) handle.canceled = true;
    },
    cliTab: { read() {} },
    confirm: () => true,
    connectionFactory(type, instance) {
      assert.equal(type, 0);
      return instance;
    },
    console: {
      log(...parts) {
        consoleLogs.push(parts.map(String).join(" "));
      },
    },
    defaultsDialog: { init: async () => {} },
    createInavRebootRecoveryAttempt,
    globalThis: null,
    groundstation: {
      deactivate() {},
      isActivated: () => false,
    },
    i18n: {
      getMessage(key) {
        if (key === "serialPortClosedOk") return SERIAL_CLOSED_OK;
        if (key === "serialPortClosedFail") return SERIAL_CLOSED_FAIL;
        return key;
      },
    },
    inavMavlinkProfileStore: {
      captureFromMsp: async () => ({ systemId: 1 }),
    },
    initializeExplicitMavlinkTransport(options) {
      const result = initializeExplicitMavlinkTransport(options);
      if (!result.ok) startupErrors.push(result.error);
      return result;
    },
    interval: {
      add() {},
      killAll() {},
      remove() {},
    },
    jBox: class {
      open() {
        return this;
      }

      close() {}
    },
    javascriptProgrammingTab: { isDirty: false },
    ltmDecoder: {
      isReceiving: () => false,
      read() {},
      reset() {},
    },
    mavlinkCommandRouter,
    mavlinkSession,
    mspDeduplicationQueue: { flush() {} },
    mspHelper: {
      getCraftName(callback) {
        callback("");
      },
      setSensorStatusEx() {},
    },
    mspQueue: queue,
    nextInavRebootRecoveryAttempt,
    periodicStatusUpdater: {
      getUpdateInterval: () => 1000,
      run() {},
    },
    persistProtocolBaudPreference,
    queueGroundControlActivation() {
      return () => {};
    },
    resolveConnectionBaud,
    runCriticalMavlinkTransition,
    semver: {
      gte: () => true,
      lt: () => true,
    },
    serialOptionsForProtocol,
    setTimeout(callback, delay) {
      const handle = {
        callback,
        canceled: false,
        delay,
        fired: false,
      };
      timers.push(handle);
      return handle;
    },
    shouldAttemptMavlinkStartupRecovery,
    store: {
      get(key, defaultValue) {
        return storedValues.has(key)
          ? storedValues.get(key)
          : defaultValue;
      },
      set(key, value) {
        storedValues.set(key, value);
      },
    },
    timeout,
    unexpectedSerialTerminationMessage,
    update: { firmwareVersion() {} },
  });
  context.globalThis = context;

  const raw = readFileSync(
    resolve(projectRoot, "js/serial_backend.js"),
    "utf8",
  );
  const start = raw.indexOf("var SerialBackend =");
  assert.ok(start >= 0, "serial_backend.js must retain its module body");
  const source = raw
    .slice(start)
    .replace(
      "    return publicScope;\n\n})();",
      "    publicScope.__privateScope = privateScope;\n" +
        "    return publicScope;\n\n})();",
    )
    .replace(
      "export default SerialBackend;",
      "globalThis.__SerialBackend = SerialBackend;",
    );
  new vm.Script(source, {
    filename: "js/serial_backend.js",
  }).runInContext(context);

  const backend = context.__SerialBackend;
  assert.ok(backend);
  backend.init();

  function connect() {
    element("div.connect_controls a.connect").trigger("click");
  }

  function activeRecoveryTimers() {
    return timers.filter(
      (timer) =>
        timer.delay === SERIAL_STARTUP_RECOVERY_DELAY_MS &&
        !timer.canceled &&
        !timer.fired,
    );
  }

  function runRecoveryTimer() {
    const timer = activeRecoveryTimers()[0];
    assert.ok(timer, "expected one scheduled serial recovery");
    timer.fired = true;
    timer.callback();
  }

  function runTimerByDelay(delay) {
    const timer = timers.find(
      (candidate) =>
        candidate.delay === delay &&
        !candidate.canceled &&
        !candidate.fired,
    );
    assert.ok(timer, `expected one scheduled ${delay} ms timer`);
    timer.fired = true;
    timer.callback();
  }

  function runNamedTimeout(name) {
    const entry = timeoutEntries.get(name);
    assert.ok(entry, `expected the ${name} timeout`);
    timeoutEntries.delete(name);
    entry.callback();
  }

  function raiseNativeClose(message = "ReadFile failed on COM8") {
    assert.ok(connection.connectionId, "native close requires an open connection");
    connection.cause = Object.freeze({
      connectionId: connection.connectionId,
      event: "close",
      origin: "native",
      expected: false,
      phase: "active",
      message,
      details: Object.freeze({
        code: "ERROR_DEVICE_NOT_CONNECTED",
      }),
    });
    GUI.handleConnectionAbort();
  }

  function emitHeartbeat({
    firmwareFamily = "inav",
    systemId = 1,
    vehicleTypeName = "Fixed Wing",
  } = {}) {
    const state = {
      armed: false,
      batteryRemaining: 80,
      firmwareFamily,
      linkLost: false,
      systemId,
      vehicleTypeName,
      voltage: 12.1,
    };
    mavlinkSession.emit("connected", state);
  }

  return {
    CONFIGURATOR,
    GUI,
    activeRecoveryTimers,
    commandBlocks,
    completeDisconnect(result = true) {
      assert.ok(
        pendingDisconnectCallback,
        "expected a deferred disconnect callback",
      );
      const callback = pendingDisconnectCallback;
      pendingDisconnectCallback = null;
      connection.connectionId = false;
      callback(result);
    },
    connect,
    connectCalls,
    connection,
    consoleLogs,
    element,
    emitHeartbeat,
    logs,
    mavlinkCommandRouter,
    mavlinkSession,
    raiseNativeClose,
    runNamedTimeout,
    runRecoveryTimer,
    runTimerByDelay,
    setFailBatteryRender(value = true) {
      failBatteryRender = value;
    },
    startupErrors,
  };
}

test("an unresponsive Flight Commander reboot performs bounded full serial reopen attempts", () => {
  const harness = createBackendHarness({ protocol: "msp" });

  harness.connect();
  harness.CONFIGURATOR.connectionValid = true;
  assert.equal(harness.connectCalls.length, 1);
  assert.equal(harness.GUI.connected_to, "COM8");

  harness.GUI.handleReconnect(false);
  harness.runTimerByDelay(100);
  assert.equal(harness.GUI.connected_to, false);

  harness.runTimerByDelay(INAV_REBOOT_RECONNECT_DELAY_MS);
  assert.equal(harness.connectCalls.length, 2);
  assert.equal(harness.GUI.connected_to, "COM8");

  harness.runNamedTimeout("connecting");
  assert.equal(harness.connectCalls.length, 3);
  assert.equal(harness.connection.disconnectCalls, 2);
  assert.equal(harness.GUI.connected_to, "COM8");

  harness.runNamedTimeout("connecting");
  assert.equal(harness.connectCalls.length, 4);
  assert.equal(harness.connection.disconnectCalls, 3);
  assert.equal(harness.GUI.connected_to, "COM8");

  harness.runNamedTimeout("connecting");
  assert.equal(harness.connectCalls.length, 4);
  assert.equal(harness.connection.disconnectCalls, 4);
  assert.equal(harness.GUI.connected_to, false);
  assert.equal(harness.GUI.connecting_to, false);
  assert.ok(
    harness.logs.some((message) =>
      message.includes("Flight Commander Firmware did not respond after three post-reboot"),
    ),
  );
  for (const attempt of harness.connectCalls.slice(1)) {
    assert.equal(attempt.path, "COM8");
    assert.equal(attempt.options.bitrate, 460800);
  }
  assert.equal(harness.element("#protocol").val(), "msp");
});

test("native MAVLink close forces cleanup through connect lock without a false success and retries once", () => {
  const harness = createBackendHarness();

  harness.connect();
  assert.equal(harness.connectCalls.length, 1);
  assert.equal(harness.connectCalls[0].path, "COM8");
  assert.equal(harness.connectCalls[0].options.bitrate, 460800);
  assert.equal(harness.GUI.connected_to, "COM8");
  assert.equal(
    harness.mavlinkSession.attached,
    true,
    [
      ...harness.consoleLogs,
      ...harness.logs,
      `attach=${harness.mavlinkSession.attachCount}`,
      `detach=${harness.mavlinkSession.detachCount}`,
      ...harness.startupErrors.map((error) => `startup=${error?.stack || error}`),
    ].join("\n"),
  );

  harness.GUI.connect_lock = true;
  harness.raiseNativeClose();

  assert.equal(
    harness.connection.disconnectCalls,
    1,
    "native loss must force renderer cleanup despite connect_lock",
  );
  assert.equal(harness.GUI.connected_to, false);
  assert.equal(harness.GUI.connecting_to, false);
  assert.equal(harness.activeRecoveryTimers().length, 1);
  assert.equal(
    harness.logs.includes(SERIAL_CLOSED_OK),
    false,
    "native loss must never be reported as an intentional successful close",
  );
  assert.ok(
    harness.logs.some((message) =>
      message.includes("closed unexpectedly during active")),
  );

  harness.GUI.connect_lock = false;
  harness.runRecoveryTimer();

  assert.equal(harness.connectCalls.length, 2);
  assert.equal(harness.connectCalls[1].path, "COM8");
  assert.equal(harness.connectCalls[1].options.bitrate, 460800);
  assert.equal(harness.element("#protocol").val(), "mavlink");

  harness.raiseNativeClose("COM8 reset again");
  assert.equal(harness.connection.disconnectCalls, 2);
  assert.equal(
    harness.activeRecoveryTimers().length,
    0,
    "the recovery connection must not schedule a second automatic retry",
  );
  assert.equal(harness.logs.includes(SERIAL_CLOSED_OK), false);
});

test("a vehicle heartbeat makes a later native close ineligible for startup recovery", () => {
  const harness = createBackendHarness();

  harness.connect();
  harness.emitHeartbeat();
  assert.equal(
    harness.CONFIGURATOR.connectionValid,
    true,
    [
      ...harness.consoleLogs,
      ...harness.logs,
      `attach=${harness.mavlinkSession.attachCount}`,
      `detach=${harness.mavlinkSession.detachCount}`,
      ...harness.startupErrors.map((error) => `startup=${error?.stack || error}`),
    ].join("\n"),
  );

  harness.raiseNativeClose();

  assert.equal(harness.connection.disconnectCalls, 1);
  assert.equal(harness.activeRecoveryTimers().length, 0);
  assert.equal(harness.logs.includes(SERIAL_CLOSED_OK), false);
});

test("a queued Disconnect click after native loss cancels recovery instead of reconnecting", () => {
  const harness = createBackendHarness();

  harness.connect();
  harness.raiseNativeClose();
  assert.equal(harness.connectCalls.length, 1);
  assert.equal(harness.activeRecoveryTimers().length, 1);

  // This represents a click already queued by the operator while the button
  // still said Disconnect, just before the native-close IPC reset the UI.
  harness.connect();

  assert.equal(harness.connectCalls.length, 1);
  assert.equal(harness.activeRecoveryTimers().length, 0);
  assert.equal(harness.GUI.connected_to, false);
  assert.equal(harness.GUI.connecting_to, false);
});

test("a fast Connect waits until an intentional native close releases the COM handle", () => {
  const harness = createBackendHarness({ deferDisconnect: true });

  harness.connect();
  assert.equal(harness.connectCalls.length, 1);

  harness.connect();
  assert.equal(harness.connection.disconnectCalls, 1);
  assert.equal(harness.GUI.connected_to, false);

  harness.connect();
  assert.equal(
    harness.connectCalls.length,
    1,
    "the old COM handle is still closing",
  );

  harness.completeDisconnect();
  assert.equal(harness.connectCalls.length, 2);
  assert.equal(harness.connectCalls[1].path, "COM8");
  assert.equal(harness.connectCalls[1].options.bitrate, 460800);
});

test("post-heartbeat renderer failure preserves telemetry attachment but blocks commands", () => {
  const harness = createBackendHarness();

  harness.connect();
  assert.equal(
    harness.mavlinkSession.attached,
    true,
    [
      ...harness.consoleLogs,
      ...harness.logs,
      `attach=${harness.mavlinkSession.attachCount}`,
      `detach=${harness.mavlinkSession.detachCount}`,
      ...harness.startupErrors.map((error) => `startup=${error?.stack || error}`),
    ].join("\n"),
  );
  const detachCountBeforeHeartbeat = harness.mavlinkSession.detachCount;

  harness.setFailBatteryRender();
  harness.emitHeartbeat();

  assert.equal(harness.mavlinkSession.attached, true);
  assert.equal(
    harness.mavlinkSession.detachCount,
    detachCountBeforeHeartbeat,
    "renderer transition failure must not tear down a healthy MAVLink session",
  );
  assert.equal(harness.CONFIGURATOR.connectionValid, false);
  assert.equal(harness.commandBlocks.length, 1);
  assert.match(
    harness.mavlinkCommandRouter.blockedReason,
    /Ground Control could not finish connecting/,
  );
});
