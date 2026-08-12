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

function loadMsp(options = {}) {
  const queued = [];
  const source = readFileSync(resolve(projectRoot, "js/msp.js"), "utf8")
    .replace("import MSPCodes from './msp/MSPCodes';", "const MSPCodes = globalThis.__MSPCodes;")
    .replace("import mspQueue from './serial_queue';", "const mspQueue = globalThis.__mspQueue;")
    .replace("import eventFrequencyAnalyzer from './eventFrequencyAnalyzer';", "const eventFrequencyAnalyzer = globalThis.__events;")
    .replace("import timeout from './timeouts';", "const timeout = globalThis.__timeout;")
    .replace("export default MSP;", "globalThis.__MSP = MSP;");
  const context = vm.createContext({
    __MSPCodes: { MSP_SET_REBOOT: 68, MSP_EEPROM_WRITE: 250 },
    __mspQueue: {
      put(message) {
        queued.push(message);
        return true;
      },
    },
    __events: { put() {} },
    __timeout: { add() {} },
    console,
    setTimeout,
    clearTimeout,
    clearInterval,
    Uint8Array,
    ArrayBuffer,
    Promise,
    ...options,
  });
  new vm.Script(source, { filename: "js/msp.js" }).runInContext(context);
  return { MSP: context.__MSP, queued };
}

function loadSerialQueue(connection) {
  const pendingCodes = new Set();
  const intervals = [];
  const source = readFileSync(resolve(projectRoot, "js/serial_queue.js"), "utf8")
    .replace("import CONFIGURATOR from './data_storage';", "const CONFIGURATOR = globalThis.__CONFIGURATOR;")
    .replace("import MSPCodes from './msp/MSPCodes';", "const MSPCodes = globalThis.__MSPCodes;")
    .replace("import SimpleSmoothFilter from './simple_smooth_filter';", "const SimpleSmoothFilter = globalThis.__SimpleSmoothFilter;")
    .replace("import eventFrequencyAnalyzer from './eventFrequencyAnalyzer';", "const eventFrequencyAnalyzer = globalThis.__events;")
    .replace("import mspDeduplicationQueue from './msp/mspDeduplicationQueue';", "const mspDeduplicationQueue = globalThis.__dedup;")
    .replace("import { insertMspRequestByPriority } from './msp/mspPriorityQueue';", "const insertMspRequestByPriority = globalThis.__insertByPriority;")
    .replace("export default mspQueue;", "globalThis.__mspQueue = mspQueue;");
  class Filter {
    apply(value) { this.value = value; }
    get() { return this.value ?? 0; }
  }
  const context = vm.createContext({
    __CONFIGURATOR: { connection },
    __MSPCodes: { MSP_SET_REBOOT: 68, MSP_EEPROM_WRITE: 250 },
    __SimpleSmoothFilter: Filter,
    __events: { put() {} },
    __dedup: {
      check: (code) => pendingCodes.has(code),
      put: (code) => pendingCodes.add(code),
      remove: (code) => pendingCodes.delete(code),
      flush: () => pendingCodes.clear(),
    },
    __insertByPriority(queue, request) {
      const index = request.priority
        ? queue.findIndex((entry) => !entry.priority)
        : -1;
      if (index >= 0) queue.splice(index, 0, request);
      else queue.push(request);
    },
    console: { log() {} },
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
  });
  new vm.Script(source, { filename: "js/serial_queue.js" }).runInContext(context);
  return context.__mspQueue;
}

test("MSP correction options reach both the MSP scheduler and serial transport", () => {
  const { MSP, queued } = loadMsp();
  MSP.send_message(0x2012, [1, 2, 3], false, () => {}, MSP.constants.PROTOCOL_V2, {
    priority: true,
    transportPriority: 50,
    replaceKey: "msp-rtcm",
    timeoutMs: 750,
    retryCounter: 0,
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].priority, true);
  assert.equal(queued[0].transportPriority, 50);
  assert.equal(queued[0].replaceKey, "msp-rtcm");
  assert.equal(queued[0].timeoutMs, 750);
  assert.equal(queued[0].retryCounter, 0);
});

test("a preempted MSP write fails immediately and releases the scheduler for fresh RTCM", () => {
  let sendOptions;
  let finished = 0;
  const queue = loadSerialQueue({
    getTimeout: () => 3000,
    send(_data, callback, options) {
      sendOptions = options;
      callback({ bytesSent: 0, resultCode: 2, preempted: true });
      return null;
    },
  });
  queue.setPutCallback(() => {});
  queue.setremoveCallback(() => {});
  queue.put({
    code: 0x2012,
    messageBody: new ArrayBuffer(12),
    priority: true,
    transportPriority: 50,
    replaceKey: "msp-rtcm",
    timeoutMs: 750,
    retryCounter: 0,
    sentOn: null,
    onFinish(result) {
      assert.equal(result, false);
      finished += 1;
    },
  });

  queue.executor();

  assert.equal(sendOptions.priority, 50);
  assert.equal(sendOptions.replaceKey, "msp-rtcm");
  assert.equal(finished, 1);
  assert.equal(queue.isLocked(), false);
});

test("an MSP correction acknowledgement timeout cancels the stale queued write", async () => {
  let canceled = 0;
  let finished = 0;
  const queue = loadSerialQueue({
    getTimeout: () => 3000,
    send() {
      return {
        cancel() {
          canceled += 1;
          return true;
        },
      };
    },
  });
  queue.setPutCallback(() => {});
  queue.setremoveCallback(() => {});
  queue.put({
    code: 0x2012,
    messageBody: new ArrayBuffer(12),
    priority: true,
    transportPriority: 50,
    replaceKey: "msp-rtcm",
    timeoutMs: 10,
    retryCounter: 0,
    sentOn: null,
    onFinish(result) {
      assert.equal(result, false);
      finished += 1;
    },
  });

  queue.executor();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(canceled, 1);
  assert.equal(finished, 1);
  assert.equal(queue.isLocked(), false);
});
