"use strict";

import { field } from "./frameNormalizer.js";
import mavlinkSession from "./mavlinkSession.js";

function number(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function logEntry(envelope) {
  const data = envelope?.data ?? {};
  return Object.freeze({
    id: number(field(data, "id"), -1),
    count: number(field(data, "numLogs", "num_logs"), 0),
    lastId: number(field(data, "lastLogNum", "last_log_num"), -1),
    timeUtc: number(field(data, "timeUtc", "time_utc"), 0),
    size: number(field(data, "size"), 0),
  });
}

export class MavlinkLogManager {
  constructor(options = {}) {
    this.session = options.session ?? mavlinkSession;
    this.setTimeoutFn = options.setTimeoutFn
      ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimeoutFn = options.clearTimeoutFn
      ?? ((timer) => globalThis.clearTimeout(timer));
  }

  async list(options = {}) {
    const target = this.session.target();
    const timeoutMs = options.timeoutMs ?? 5000;
    const entries = new Map();
    return new Promise((resolve, reject) => {
      let timer = null;
      let expected = null;
      let settled = false;
      const cleanup = () => {
        this.clearTimeoutFn(timer);
        unsubscribe();
      };
      const finish = (value, error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(Object.freeze(value));
      };
      const resetTimer = () => {
        this.clearTimeoutFn(timer);
        timer = this.setTimeoutFn(() => {
          if (entries.size) {
            finish([...entries.values()].sort((left, right) => left.id - right.id));
          } else {
            finish([], new Error("Timed out waiting for the ArduPilot log list."));
          }
        }, timeoutMs);
      };
      const unsubscribe = this.session.on("message:LogEntry", (envelope) => {
        const entry = logEntry(envelope);
        if (entry.id < 0) return;
        expected = entry.count;
        if (expected === 0) {
          finish([]);
          return;
        }
        entries.set(entry.id, entry);
        options.onProgress?.({ received: entries.size, total: expected });
        if (expected === 0 || entries.size >= expected) {
          finish([...entries.values()].sort((left, right) => left.id - right.id));
        } else {
          resetTimer();
        }
      });
      resetTimer();
      this.session.send("LogRequestList", {
        ...target,
        start: options.start ?? 0,
        end: options.end ?? 0xffff,
      }).catch((error) => finish([], error));
    });
  }

  async download(entry, options = {}) {
    const id = number(entry?.id, -1);
    const size = number(entry?.size, -1);
    if (id < 0 || size < 0) throw new Error("A valid ArduPilot log entry is required.");
    const target = this.session.target();
    const chunks = [];
    let offset = 0;
    try {
      while (offset < size) {
        const requested = Math.min(90, size - offset);
        const expectedOffset = offset;
        const waiter = this.session.waitFor(
          ["LogData"],
          (envelope) => (
            number(field(envelope.data, "id"), -1) === id
            && number(field(envelope.data, "ofs"), -1) === expectedOffset
          ),
          options.timeoutMs ?? 3000,
        );
        waiter.catch(() => {});
        await this.session.send("LogRequestData", {
          ...target,
          id,
          ofs: expectedOffset,
          count: requested,
        });
        const envelope = await waiter;
        const count = Math.min(
          requested,
          Math.max(0, number(field(envelope.data, "count"), 0)),
        );
        const data = Array.from(field(envelope.data, "data") ?? []).slice(0, count);
        if (!count || data.length !== count) {
          throw new Error(`ArduPilot returned an incomplete log chunk at byte ${offset}.`);
        }
        chunks.push(Uint8Array.from(data));
        offset += count;
        options.onProgress?.({ received: offset, total: size, id });
      }
      const output = new Uint8Array(size);
      let cursor = 0;
      for (const chunk of chunks) {
        output.set(chunk, cursor);
        cursor += chunk.length;
      }
      return output;
    } finally {
      await this.session.send("LogRequestEnd", target).catch(() => {});
    }
  }

  erase() {
    return this.session.send("LogErase", this.session.target());
  }
}

export const mavlinkLogManager = new MavlinkLogManager();
