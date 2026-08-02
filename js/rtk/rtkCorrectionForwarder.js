"use strict";

import { mavlinkRtcmPackets, rtcm3MessageType } from "./rtcm3.js";

export class RtkCorrectionForwarder {
  constructor(options = {}) {
    if (typeof options.sendPacket !== "function") {
      throw new TypeError("RTK correction forwarding requires a packet sender.");
    }
    this.sendPacket = options.sendPacket;
    this.onChange = options.onChange ?? (() => {});
    this.maxQueuedFrames = options.maxQueuedFrames ?? 8;
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

  enqueue(frame) {
    const data = frame instanceof Uint8Array ? frame.slice() : Uint8Array.from(frame ?? []);
    this.stats.receivedFrames += 1;
    this.stats.receivedBytes += data.length;
    this.stats.lastMessageType = rtcm3MessageType(data);
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
    if (this.queue.length >= this.maxQueuedFrames) {
      this.stats.droppedFrames += 1;
      this.stats.lastError = "RTCM correction queue is full; a frame was dropped.";
      this.changed();
      return false;
    }
    this.queue.push(data);
    this.changed();
    this.pump();
    return true;
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    while (this.enabled && this.queue.length) {
      const frame = this.queue.shift();
      try {
        const packets = mavlinkRtcmPackets(frame, this.sequenceId);
        this.sequenceId = (this.sequenceId + 1) & 0x1f;
        let transport = null;
        for (const packet of packets) {
          const result = await this.sendPacket(packet);
          transport = result?.transport ?? result ?? transport;
          this.stats.forwardedPackets += 1;
        }
        this.stats.forwardedFrames += 1;
        this.stats.forwardedBytes += frame.length;
        this.stats.lastTransport = transport;
        this.stats.lastError = null;
      } catch (error) {
        this.stats.droppedFrames += 1;
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
