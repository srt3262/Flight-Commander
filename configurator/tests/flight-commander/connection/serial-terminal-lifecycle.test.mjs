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

function loadConnectionSerial() {
  const logs = [];
  const consoleLogs = [];
  const handlers = new Map();
  const closeCalls = [];
  const GUI = {
    connected_to: false,
    connecting_to: false,
    log(message) {
      logs.push(message);
    },
  };
  const electronAPI = {
    serialConnect: async () => ({ error: false, id: 41 }),
    serialClose: async (connectionId) => {
      closeCalls.push(connectionId);
      return { error: false };
    },
    serialSend: async (data) => ({
      error: false,
      bytesWritten: data.byteLength,
    }),
    onSerialData(handler) {
      handlers.set("data", handler);
      return handler;
    },
    offSerialData(handler) {
      if (handlers.get("data") === handler) handlers.delete("data");
    },
    onSerialClose(handler) {
      handlers.set("close", handler);
      return handler;
    },
    offSerialClose(handler) {
      if (handlers.get("close") === handler) handlers.delete("close");
    },
    onSerialError(handler) {
      handlers.set("error", handler);
      return handler;
    },
    offSerialError(handler) {
      if (handlers.get("error") === handler) handlers.delete("error");
    },
  };
  const jquery = () => {
    let value = "";
    return {
      text(nextValue) {
        value = String(nextValue);
        return this;
      },
      html() {
        return value;
      },
      trigger() {},
    };
  };
  const context = vm.createContext({
    __GUI: GUI,
    __electronAPI: electronAPI,
    $: jquery,
    console: {
      log(message) {
        consoleLogs.push(String(message));
      },
    },
    setTimeout,
  });

  const connectionSource = readFileSync(
    resolve(projectRoot, "js/connection/connection.js"),
    "utf8",
  )
    .replace(
      "import GUI from './../gui';",
      "const GUI = globalThis.__GUI;",
    )
    .replace(
      "export  { ConnectionType, Connection};",
      "globalThis.__connectionExports = { ConnectionType, Connection };",
    );
  new vm.Script(`{${connectionSource}}`, {
    filename: "js/connection/connection.js",
  }).runInContext(context);

  const serialSource = readFileSync(
    resolve(projectRoot, "js/connection/connectionSerial.js"),
    "utf8",
  )
    .replace(
      "import GUI from './../gui';",
      "const GUI = globalThis.__GUI;",
    )
    .replace(
      "import { ConnectionType, Connection } from './connection';",
      "const { ConnectionType, Connection } = globalThis.__connectionExports;",
    )
    .replace(
      "import i18n from './../localization';",
      "const i18n = { getMessage: () => 'connected' };",
    )
    .replace(
      "export default ConnectionSerial;",
      "globalThis.__ConnectionSerial = ConnectionSerial;",
    );
  context.window = { electronAPI };
  new vm.Script(`{${serialSource}}`, {
    filename: "js/connection/connectionSerial.js",
  }).runInContext(context);

  return {
    ConnectionSerial: context.__ConnectionSerial,
    closeCalls,
    consoleLogs,
    handlers,
    logs,
  };
}

async function openConnection(connection) {
  return new Promise((resolve) => {
    connection.connect(
      "COM8",
      { bitrate: 460800 },
      resolve,
    );
  });
}

test("native error and close are deduplicated and expose one structured cause", async () => {
  const {
    ConnectionSerial,
    closeCalls,
    consoleLogs,
    handlers,
    logs,
  } = loadConnectionSerial();
  const connection = new ConnectionSerial();
  const opened = await openConnection(connection);
  assert.equal(opened.connectionId, 41);

  let aborts = 0;
  connection.abort = () => {
    aborts += 1;
  };
  connection.addOnReceiveErrorListener(() => {
    throw new Error("renderer error listener failed");
  });
  const errorHandler = handlers.get("error");
  const closeHandler = handlers.get("close");
  errorHandler({
    connectionId: 41,
    event: "error",
    origin: "native",
    expected: false,
    phase: "active",
    error: "Access to COM8 was lost",
    errorDetails: {
      name: "Error",
      message: "Access to COM8 was lost",
      code: "ERROR_DEVICE_NOT_CONNECTED",
      errno: 1167,
    },
  });
  closeHandler({
    connectionId: 41,
    event: "close",
    origin: "native",
    expected: false,
    phase: "active",
    error: "Access to COM8 was lost",
  });

  assert.equal(aborts, 1);
  assert.equal(
    logs.filter((message) => message.includes("failed during active")).length,
    0,
  );
  assert.equal(
    consoleLogs.filter((message) => message.includes("failed during active")).length,
    1,
  );
  assert.equal(
    consoleLogs.filter((message) =>
      message.includes("renderer error listener failed")).length,
    1,
  );

  let cleanupResult = null;
  connection.disconnect((result) => {
    cleanupResult = result;
  });
  assert.equal(cleanupResult, true);
  assert.deepEqual(closeCalls, []);

  const cause = connection.consumeDisconnectCause();
  assert.equal(cause.connectionId, 41);
  assert.equal(cause.event, "error");
  assert.equal(cause.origin, "native");
  assert.equal(cause.expected, false);
  assert.equal(cause.phase, "active");
  assert.equal(cause.message, "Access to COM8 was lost");
  assert.equal(cause.details.code, "ERROR_DEVICE_NOT_CONNECTED");
  assert.equal(cause.details.errno, 1167);
  assert.equal(connection.consumeDisconnectCause(), null);
});

test("native close triggers cleanup without a redundant serialClose IPC", async () => {
  const {
    ConnectionSerial,
    closeCalls,
    handlers,
  } = loadConnectionSerial();
  const connection = new ConnectionSerial();
  await openConnection(connection);

  handlers.get("close")({
    connectionId: 41,
    event: "close",
    origin: "native",
    expected: false,
    phase: "active",
    error: "ReadFile failed on COM8",
    errorDetails: {
      name: "Error",
      message: "ReadFile failed on COM8",
      disconnected: true,
    },
  });

  assert.equal(connection.connectionId, false);
  assert.deepEqual(closeCalls, []);
  const cause = connection.consumeDisconnectCause();
  assert.equal(cause.event, "close");
  assert.equal(cause.message, "ReadFile failed on COM8");
  assert.equal(cause.details.disconnected, true);
});

test("an intentional renderer disconnect still closes the live native handle", async () => {
  const {
    ConnectionSerial,
    closeCalls,
  } = loadConnectionSerial();
  const connection = new ConnectionSerial();
  await openConnection(connection);

  const result = await new Promise((resolve) => {
    connection.disconnect(resolve);
  });

  assert.equal(result, true);
  assert.deepEqual(closeCalls, [41]);
  assert.equal(connection.consumeDisconnectCause(), null);
});
