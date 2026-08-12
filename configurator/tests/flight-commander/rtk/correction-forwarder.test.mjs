import assert from "node:assert/strict";
import test from "node:test";

import { createRtcm3Frame } from "../../../js/rtk/rtcm3.js";
import RtkCorrectionForwarder from "../../../js/rtk/rtkCorrectionForwarder.js";

function frameForType(messageType, marker = 0) {
  return createRtcm3Frame([
    (messageType >> 4) & 0xff,
    (messageType & 0x0f) << 4,
    marker,
  ]);
}

test("RTK correction forwarder sends an RTCM frame in ordered MAVLink fragments", async () => {
  const packets = [];
  const forwarder = new RtkCorrectionForwarder({
    sendPacket: async (packet) => {
      packets.push(packet);
      return { transport: "MAVLink" };
    },
  });
  const frame = createRtcm3Frame(new Uint8Array(354));
  assert.equal(frame.length, 360);
  assert.equal(forwarder.enqueue(frame), true);
  const state = await forwarder.waitForIdle();

  assert.deepEqual(packets.map(({ len }) => len), [180, 180, 0]);
  assert.equal(state.forwardedFrames, 1);
  assert.equal(state.forwardedPackets, 3);
  assert.equal(state.forwardedBytes, 360);
  assert.equal(state.lastTransport, "MAVLink");
});

test("RTK correction forwarder bounds its queue and records transport failures", async () => {
  let release;
  const firstSend = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const forwarder = new RtkCorrectionForwarder({
    maxQueuedFrames: 1,
    sendPacket: async () => {
      calls += 1;
      if (calls === 1) await firstSend;
      throw new Error("aircraft link unavailable");
    },
  });
  const frame = createRtcm3Frame([0x43, 0x50, 1]);
  assert.equal(forwarder.enqueue(frame), true);
  assert.equal(forwarder.enqueue(frame), true);
  assert.equal(forwarder.enqueue(frame), true);
  release();
  const state = await forwarder.waitForIdle();
  assert.equal(state.droppedFrames, 3);
  assert.equal(state.replacedFrames, 1);
  assert.match(state.lastError, /aircraft link unavailable/);
});

test("RTK correction forwarder coalesces a faster producer to the latest frame of each message type", async () => {
  let releaseFirst;
  let calls = 0;
  const markers = [];
  const forwarder = new RtkCorrectionForwarder({
    maxQueuedFrames: 4,
    sendPacket: async (packet) => {
      calls += 1;
      markers.push(packet.data[5]);
      if (calls === 1) {
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
      return { transport: "MAVLink" };
    },
  });

  forwarder.enqueue(frameForType(1005, 1));
  await Promise.resolve();
  for (let marker = 2; marker <= 20; marker += 1) {
    forwarder.enqueue(frameForType(1077, marker));
  }

  assert.equal(forwarder.snapshot().queuedFrames, 1);
  assert.equal(forwarder.snapshot().replacedFrames, 18);
  releaseFirst();
  const state = await forwarder.waitForIdle();

  assert.deepEqual(markers, [1, 20]);
  assert.equal(state.forwardedFrames, 2);
  assert.equal(state.droppedFrames, 18);
  assert.equal(state.lastError, null);
});

test("RTK correction forwarder times out an unacknowledged packet and recovers with fresh data", async () => {
  let calls = 0;
  const markers = [];
  const forwarder = new RtkCorrectionForwarder({
    packetTimeoutMs: 10,
    sendPacket: async (packet) => {
      calls += 1;
      markers.push(packet.data[5]);
      if (calls === 1) await new Promise(() => {});
      return { transport: "MSP" };
    },
  });

  forwarder.enqueue(frameForType(1077, 1));
  await Promise.resolve();
  forwarder.enqueue(frameForType(1077, 2));
  const state = await forwarder.waitForIdle();

  assert.deepEqual(markers, [1, 2]);
  assert.equal(state.timedOutPackets, 1);
  assert.equal(state.droppedFrames, 1);
  assert.equal(state.forwardedFrames, 1);
  assert.equal(state.lastTransport, "MSP");
  assert.equal(state.lastError, null);
});
