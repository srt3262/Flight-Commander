"use strict";

import {
  MAVLINK_RTCM_FRAGMENT_BYTES,
  MAVLINK_RTCM_MAX_BYTES,
  mavlinkRtcmPackets,
  rtcm3MessageType,
} from "./rtcm3.js";

export const DEFAULT_RTCM_PACKET_TIMEOUT_MS = 3000;
export const DEFAULT_RTCM_EGRESS_BYTES_PER_SECOND = 1500;
const RTCM_PACKET_WIRE_OVERHEAD_BYTES = 20;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.max(1, Math.trunc(number))
    : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.max(0, Math.trunc(number))
    : fallback;
}

function correctionEntry(data) {
  return {
    data,
    messageType: rtcm3MessageType(data),
  };
}

function correctionPacketCount(frameLength) {
  if (frameLength <= MAVLINK_RTCM_FRAGMENT_BYTES) return 1;
  let count = Math.ceil(frameLength / MAVLINK_RTCM_FRAGMENT_BYTES);
  if (
    frameLength < MAVLINK_RTCM_MAX_BYTES
    && frameLength % MAVLINK_RTCM_FRAGMENT_BYTES === 0
  ) {
    count += 1;
  }
  return count;
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
    this.maxBytesPerSecond = positiveInteger(
      options.maxBytesPerSecond,
      DEFAULT_RTCM_EGRESS_BYTES_PER_SECOND,
    );
    this.setTimeoutFn =
      options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
    this.nowFn = options.nowFn ?? Date.now;
    this.sleepFn = options.sleepFn ?? ((delayMs) => new Promise((resolve) => {
      this.setTimeoutFn(resolve, delayMs);
    }));
    this.enabled = options.enabled !== false;
    this.queue = [];
    this.busy = false;
    this.nextFrameAt = 0;
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
      pacingDelayMs: 0,
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
    if (!this.enabled) {
      this.queue.length = 0;
      this.nextFrameAt = 0;
    }
    this.changed();
  }

  paceFrame(frameLength, packetCount) {
    const estimatedWireBytes = (
      nonNegativeInteger(frameLength, 0)
      + nonNegativeInteger(packetCount, 0) * RTCM_PACKET_WIRE_OVERHEAD_BYTES
    );
    const now = this.nowFn();
    const sendAt = Math.max(now, this.nextFrameAt);
    this.nextFrameAt = sendAt + Math.ceil(
      estimatedWireBytes * 1000 / this.maxBytesPerSecond,
    );
    const delayMs = Math.max(0, sendAt - now);
    if (delayMs > 0) {
      this.stats.pacingDelayMs += delayMs;
      this.changed();
      return this.sleepFn(delayMs);
    }
    return null;
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
      try {
        // Rate-limit complete frames rather than individual fragments. This
        // prevents a fast caster from filling a slower radio's hidden transmit
        // buffer while keeping every fragment of a selected frame contiguous.
        // Leave the candidate in the queue during the wait so a newer frame of
        // the same RTCM type can replace it before any stale bytes are encoded.
        const candidate = this.queue[0].data;
        const candidatePacketCount = correctionPacketCount(candidate.length);
        const pacing = this.paceFrame(candidate.length, candidatePacketCount);
        if (pacing) await pacing;
        if (!this.enabled) break;
        const entry = this.queue.shift();
        const frame = entry.data;
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
