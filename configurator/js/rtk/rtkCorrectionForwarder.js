"use strict";

import { mavlinkRtcmPackets, rtcm3MessageType } from "./rtcm3.js";

export const DEFAULT_RTCM_PACKET_TIMEOUT_MS = 1250;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.max(1, Math.trunc(number))
    : fallback;
}

function correctionEntry(data) {
  return {
    data,
    messageType: rtcm3MessageType(data),
  };
}

function packetTimeoutError(timeoutMs) {
  const error = new Error(
    `RTCM correction transport did not acknowledge the packet within ${timeoutMs} ms.`,
  );
  error.code = "RTCM_PACKET_TIMEOUT";
  return error;
}

export class RtkCorrectionForwarder {
  constructor(options = {}) {
    if (typeof options.sendPacket !== "function") {
      throw new TypeError("RTK correction forwarding requires a packet sender.");
    }
    this.sendPacket = options.sendPacket;
    this.onChange = options.onChange ?? (() => {});
    this.maxQueuedFrames = positiveInteger(options.maxQueuedFrames, 8);
    this.packetTimeoutMs = positiveInteger(
      options.packetTimeoutMs,
      DEFAULT_RTCM_PACKET_TIMEOUT_MS,
    );
    this.setTimeoutFn =
      options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
    this.enabled = options.enabled !== false;
    this.queue = [];
    this.busy = false;
    this.sequenceId = 0;
    this.idleWaiters = [];
    this.stats = {
      receivedFrames: 0,
      receivedBytes: 0,
      forwardedFrames: 0,
      forwardedBytes: 0,
      forwardedPackets: 0,
      droppedFrames: 0,
      replacedFrames: 0,
      timedOutPackets: 0,
      oversizedFrames: 0,
      lastMessageType: null,
      lastTransport: null,
      lastError: null,
    };
  }

  snapshot() {
    return Object.freeze({
      ...this.stats,
      enabled: this.enabled,
      queuedFrames: this.queue.length,
      busy: this.busy,
    });
  }

  changed() {
    this.onChange(this.snapshot());
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.queue.length = 0;
    this.changed();
  }

  sendWithDeadline(packet) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.clearTimeoutFn(timer);
        callback(value);
      };
      timer = this.setTimeoutFn(
        () => finish(reject, packetTimeoutError(this.packetTimeoutMs)),
        this.packetTimeoutMs,
      );
      timer?.unref?.();
      Promise.resolve()
        .then(() => this.sendPacket(packet))
        .then(
          (result) => finish(resolve, result),
          (error) => finish(reject, error),
        );
    });
  }

  enqueue(frame) {
    const data = frame instanceof Uint8Array ? frame.slice() : Uint8Array.from(frame ?? []);
    const entry = correctionEntry(data);
    this.stats.receivedFrames += 1;
    this.stats.receivedBytes += data.length;
    this.stats.lastMessageType = entry.messageType;
    if (!this.enabled) {
      this.changed();
      return false;
    }
    if (data.length > 720) {
      this.stats.oversizedFrames += 1;
      this.stats.droppedFrames += 1;
      this.stats.lastError = `RTCM frame ${data.length} bytes exceeds the 720-byte MAVLink limit.`;
      this.changed();
      return false;
    }
    const sameTypeIndex = this.queue.findIndex(
      (queuedEntry) => queuedEntry.messageType === entry.messageType,
    );
    if (sameTypeIndex >= 0 || this.queue.length >= this.maxQueuedFrames) {
      const replacementIndex = sameTypeIndex >= 0 ? sameTypeIndex : 0;
      this.queue.splice(replacementIndex, 1, entry);
      this.stats.droppedFrames += 1;
      this.stats.replacedFrames += 1;
      this.changed();
      this.pump();
      return true;
    }
    this.queue.push(entry);
    this.changed();
    this.pump();
    return true;
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    while (this.enabled && this.queue.length) {
      const entry = this.queue.shift();
      const frame = entry.data;
      try {
        const packets = mavlinkRtcmPackets(frame, this.sequenceId);
        this.sequenceId = (this.sequenceId + 1) & 0x1f;
        let transport = null;
        for (const packet of packets) {
          const result = await this.sendWithDeadline(packet);
          transport = result?.transport ?? result ?? transport;
          this.stats.forwardedPackets += 1;
        }
        this.stats.forwardedFrames += 1;
        this.stats.forwardedBytes += frame.length;
        this.stats.lastTransport = transport;
        this.stats.lastError = null;
      } catch (error) {
        this.stats.droppedFrames += 1;
        if (error?.code === "RTCM_PACKET_TIMEOUT") {
          this.stats.timedOutPackets += 1;
        }
        this.stats.lastError = error?.message || String(error);
      }
      this.changed();
    }
    this.busy = false;
    this.changed();
    for (const resolve of this.idleWaiters.splice(0)) resolve(this.snapshot());
  }

  waitForIdle() {
    if (!this.busy && this.queue.length === 0) return Promise.resolve(this.snapshot());
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}

export default RtkCorrectionForwarder;
