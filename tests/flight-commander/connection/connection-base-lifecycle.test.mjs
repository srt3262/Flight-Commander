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

test("a delayed disconnect cannot clear or close the UI for a replacement connection", () => {
  const Connection = loadConnectionClass();
  class FakeConnection extends Connection {
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

    addOnReceiveCallback() {}
    removeOnReceiveCallback() {}
    addOnReceiveErrorCallback() {}
    removeOnReceiveErrorCallback() {}
    sendImplementation() {}
  }

  const connection = new FakeConnection();
  connection.connect("COM8", {}, () => {});
  connection.openCallbacks.shift()({
    connectionId: 1,
    bitrate: 460800,
  });

  let staleUiCleanupCalls = 0;
  connection.disconnect(() => {
    staleUiCleanupCalls += 1;
  });

  connection.connect("COM8", {}, () => {});
  connection.openCallbacks.shift()({
    connectionId: 2,
    bitrate: 460800,
  });
  connection.closeCallbacks.shift()(true);

  assert.equal(connection.connectionId, 2);
  assert.equal(staleUiCleanupCalls, 0);
});
