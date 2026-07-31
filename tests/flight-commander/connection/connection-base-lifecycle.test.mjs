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

function loadConnectionClass() {
  const source = readFileSync(
    resolve(projectRoot, "js/connection/connection.js"),
    "utf8",
  )
    .replace(
      "import GUI from './../gui';",
      "const GUI = { connected_to: false, connecting_to: false };",
    )
    .replace(
      "export  { ConnectionType, Connection};",
      "globalThis.__Connection = Connection;",
    );
  const context = vm.createContext({
    console: { log() {} },
    setTimeout,
  });
  new vm.Script(source, {
    filename: "js/connection/connection.js",
  }).runInContext(context);
  return context.__Connection;
}

function createFakeConnection(Connection) {
  return new class extends Connection {
    constructor() {
      super();
      this.openCallbacks = [];
      this.closeCallbacks = [];
    }

    connectImplementation(_path, _options, callback) {
      this.openCallbacks.push(callback);
    }

    disconnectImplementation(callback) {
      this.closeCallbacks.push(callback);
    }

    completeOpen(callback, connectionInfo) {
      // The production serial/TCP/UDP implementations assign the raw
      // connection ID before invoking the base-class completion callback.
      if (connectionInfo) {
        this._connectionId = connectionInfo.connectionId;
      }
      callback(connectionInfo);
    }

    addOnReceiveCallback() {}
    removeOnReceiveCallback() {}
    addOnReceiveErrorCallback() {}
    removeOnReceiveErrorCallback() {}
    sendImplementation() {}
  }();
}

test("a delayed disconnect cannot clear or close the UI for a replacement connection", () => {
  const Connection = loadConnectionClass();
  const connection = createFakeConnection(Connection);
  connection.connect("COM8", {}, () => {});
  connection.completeOpen(connection.openCallbacks.shift(), {
    connectionId: 1,
    bitrate: 460800,
  });

  let staleUiCleanupCalls = 0;
  connection.disconnect(() => {
    staleUiCleanupCalls += 1;
  });

  connection.connect("COM8", {}, () => {});
  connection.completeOpen(connection.openCallbacks.shift(), {
    connectionId: 2,
    bitrate: 460800,
  });
  connection.closeCallbacks.shift()(true);

  assert.equal(connection.connectionId, 2);
  assert.equal(staleUiCleanupCalls, 0);
});

test("a stale successful open cannot replace a newer connection or replay its callback", () => {
  const Connection = loadConnectionClass();
  const connection = createFakeConnection(Connection);
  const completions = [];

  connection.connect("COM8", {}, result => {
    completions.push(["old", result]);
  });
  const staleOpen = connection.openCallbacks.shift();
  connection.disconnect();

  connection.connect("COM8", {}, result => {
    completions.push(["new", result.connectionId]);
  });
  const currentOpen = connection.openCallbacks.shift();
  connection.completeOpen(currentOpen, {
    connectionId: 2,
    bitrate: 460800,
  });
  connection.completeOpen(staleOpen, {
    connectionId: 1,
    bitrate: 115200,
  });

  assert.equal(connection.connectionId, 2);
  assert.deepEqual(completions, [["new", 2]]);
});

test("a stale failed open cannot report failure after a newer connection succeeds", () => {
  const Connection = loadConnectionClass();
  const connection = createFakeConnection(Connection);
  const completions = [];

  connection.connect("COM8", {}, result => {
    completions.push(["old", result]);
  });
  const staleOpen = connection.openCallbacks.shift();
  connection.disconnect();

  connection.connect("COM8", {}, result => {
    completions.push(["new", result.connectionId]);
  });
  const currentOpen = connection.openCallbacks.shift();
  connection.completeOpen(currentOpen, {
    connectionId: 2,
    bitrate: 460800,
  });
  connection.completeOpen(staleOpen, false);

  assert.equal(connection.connectionId, 2);
  assert.deepEqual(completions, [["new", 2]]);
});

test("a failed replacement cannot restore a connection whose close is pending", () => {
  const Connection = loadConnectionClass();
  const connection = createFakeConnection(Connection);
  const completions = [];

  connection.connect("COM8", {}, () => {});
  connection.completeOpen(connection.openCallbacks.shift(), {
    connectionId: 1,
    bitrate: 460800,
  });
  connection.disconnect(() => {
    completions.push("old-close");
  });

  connection.connect("COM8", {}, result => {
    completions.push(["replacement", result]);
  });
  connection.completeOpen(connection.openCallbacks.shift(), false);
  connection.closeCallbacks.shift()(true);

  assert.equal(connection.connectionId, false);
  assert.equal(connection._activeConnectionId, false);
  assert.deepEqual(completions, [["replacement", false]]);
});
