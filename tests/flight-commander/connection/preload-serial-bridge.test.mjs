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

function loadPreloadApi() {
  const listeners = new Map();
  let exposedApi = null;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        assert.equal(name, "electronAPI");
        exposedApi = api;
      },
    },
    ipcRenderer: {
      invoke() {},
      on(channel, handler) {
        listeners.set(channel, handler);
      },
      removeListener(channel, handler) {
        if (listeners.get(channel) === handler) {
          listeners.delete(channel);
        }
      },
      send() {},
      sendSync() {},
    },
  };
  const source = readFileSync(
    resolve(projectRoot, "js/main/preload.js"),
    "utf8",
  ).replace(
    "import { contextBridge, ipcRenderer } from 'electron';",
    "const { contextBridge, ipcRenderer } = globalThis.__electron;",
  );
  const context = vm.createContext({ __electron: electron });

  new vm.Script(source, { filename: "js/main/preload.js" }).runInContext(
    context,
  );

  assert.ok(exposedApi);
  return { api: exposedApi, listeners };
}

test("preload preserves the connection ID on serial close events", () => {
  const { api, listeners } = loadPreloadApi();
  const received = [];
  const token = api.onSerialClose((envelope) => received.push(envelope));
  const envelope = {
    connectionId: 83,
    event: "close",
    origin: "native",
    expected: false,
    phase: "active",
    error: "ReadFile failed",
    errorDetails: {
      name: "Error",
      message: "ReadFile failed",
      code: "EIO",
      disconnected: true,
    },
  };

  listeners.get("serialClose")({}, envelope);
  assert.deepEqual(received, [envelope]);

  api.offSerialClose(token);
  assert.equal(listeners.has("serialClose"), false);
});
