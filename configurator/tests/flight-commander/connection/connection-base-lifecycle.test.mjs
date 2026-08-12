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

function loadConnectionClass(
  GUI = { connected_to: false, connecting_to: false },
) {
  const source = readFileSync(
    resolve(projectRoot, "js/connection/connection.js"),
    "utf8",
  )
    .replace(
      "import GUI from './../gui';",
      "const GUI = globalThis.__GUI;",
    )
    .replace(
      "export  { ConnectionType, Connection};",
      "globalThis.__Connection = Connection;",
    );
  const context = vm.createContext({
    __GUI: GUI,
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

test("authoritative abort uses the backend hook even while UI controls are locked", () => {
  let forcedAborts = 0;
  const GUI = {
    connected_to: "COM8",
    connecting_to: false,
    connect_lock: true,
    handleConnectionAbort() {
      forcedAborts += 1;
    },
  };
  const Connection = loadConnectionClass(GUI);
  const connection = createFakeConnection(Connection);

  connection.abort();

  assert.equal(forcedAborts, 1);
});

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

function createBufferedConnection(Connection) {
  return new class extends Connection {
    constructor() {
      super();
      this.writes = [];
      this.writeCallbacks = [];
    }

    connectImplementation() {}
    disconnectImplementation() {}
    addOnReceiveCallback() {}
    removeOnReceiveCallback() {}
    addOnReceiveErrorCallback() {}
    removeOnReceiveErrorCallback() {}

    sendImplementation(data, callback) {
      this.writes.push(Array.from(data));
      this.writeCallbacks.push(() => callback({
        bytesSent: data.byteLength,
        resultCode: 0,
      }));
    }

    completeWrite() {
      this.writeCallbacks.shift()();
    }
  }();
}

test("outbound connection scheduling preserves the active write and prioritizes control then RTCM", () => {
  const Connection = loadConnectionClass();
  const connection = createBufferedConnection(Connection);

  connection.send(Uint8Array.of(1), () => {});
  connection.send(Uint8Array.of(2), () => {});
  connection.send(Uint8Array.of(3), () => {}, { priority: 50 });
  connection.send(Uint8Array.of(4), () => {}, { priority: 100 });

  assert.deepEqual(connection.writes, [[1]]);
  connection.completeWrite();
  assert.deepEqual(connection.writes, [[1], [4]]);
  connection.completeWrite();
  assert.deepEqual(connection.writes, [[1], [4], [3]]);
  connection.completeWrite();
  assert.deepEqual(connection.writes, [[1], [4], [3], [2]]);
});

test("a fresh correction replaces an unsent correction in the transport queue", () => {
  const Connection = loadConnectionClass();
  const connection = createBufferedConnection(Connection);
  const replaced = [];

  connection.send(Uint8Array.of(1), () => {});
  connection.send(Uint8Array.of(2), (result) => replaced.push(result), {
    priority: 50,
    replaceKey: "rtcm",
  });
  connection.send(Uint8Array.of(3), () => {}, {
    priority: 50,
    replaceKey: "rtcm",
  });

  assert.equal(connection._outputBuffer.length, 2);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].replaced, true);
  connection.completeWrite();
  assert.deepEqual(connection.writes, [[1], [3]]);
});

test("RTCM is admitted by displacing lower-priority backlog when the transport queue is saturated", () => {
  const Connection = loadConnectionClass();
  const connection = createBufferedConnection(Connection);
  let preempted = 0;

  connection.send(Uint8Array.of(1), () => {});
  for (let value = 2; value <= 100; value += 1) {
    connection.send(Uint8Array.of(value), (result) => {
      if (result.preempted) preempted += 1;
    });
  }
  connection.send(Uint8Array.of(200), () => {}, {
    priority: 50,
    replaceKey: "rtcm",
  });

  assert.equal(connection._outputBuffer.length, 100);
  assert.equal(connection._outputBuffer[1].data[0], 200);
  assert.equal(preempted, 1);
});
