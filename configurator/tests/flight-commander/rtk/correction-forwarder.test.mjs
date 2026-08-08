import assert from "node:assert/strict";
import test from "node:test";

import { createRtcm3Frame } from "../../../js/rtk/rtcm3.js";
import RtkCorrectionForwarder from "../../../js/rtk/rtkCorrectionForwarder.js";

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
  assert.equal(forwarder.enqueue(frame), false);
  release();
  const state = await forwarder.waitForIdle();
  assert.equal(state.droppedFrames, 3);
  assert.match(state.lastError, /aircraft link unavailable/);
});
