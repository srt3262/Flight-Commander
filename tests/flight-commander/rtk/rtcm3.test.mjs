import assert from "node:assert/strict";
import test from "node:test";

import {
  createRtcm3Frame,
  crc24q,
  mavlinkRtcmPackets,
  Rtcm3Parser,
  rtcm3MessageType,
} from "../../../js/rtk/rtcm3.js";

test("RTCM3 parser validates CRC and reconstructs chunked input", () => {
  const payload = Uint8Array.from([0x3e, 0xd0, 1, 2, 3, 4]);
  const frame = createRtcm3Frame(payload);
  const received = [];
  const parser = new Rtcm3Parser({ onFrame: (value) => received.push(value) });

  parser.push(Uint8Array.from([0, 1, ...frame.subarray(0, 4)]));
  assert.equal(received.length, 0);
  parser.push(frame.subarray(4));

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], frame);
  assert.equal(rtcm3MessageType(frame), 1005);
  assert.equal(crc24q(frame.subarray(0, -3)), (
    frame.at(-3) << 16 | frame.at(-2) << 8 | frame.at(-1)
  ));
});

test("RTCM3 parser rejects a corrupt frame", () => {
  const frame = createRtcm3Frame([0x43, 0x50, 1, 2, 3]);
  frame[4] ^= 0x01;
  const parser = new Rtcm3Parser();
  assert.deepEqual(parser.push(frame), []);
  assert.equal(parser.invalidFrames, 1);
});

test("MAVLink RTCM fragmentation follows the four-fragment protocol", () => {
  const frame181 = Uint8Array.from({ length: 181 }, (_unused, index) => index);
  const packets181 = mavlinkRtcmPackets(frame181, 7);
  assert.deepEqual(packets181.map(({ len }) => len), [180, 1]);
  assert.equal(packets181[0].flags, 1 | (7 << 3));
  assert.equal(packets181[1].flags, 1 | (1 << 1) | (7 << 3));

  const exact360 = mavlinkRtcmPackets(new Uint8Array(360), 2);
  assert.deepEqual(exact360.map(({ len }) => len), [180, 180, 0]);

  const exact720 = mavlinkRtcmPackets(new Uint8Array(720), 31);
  assert.deepEqual(exact720.map(({ len }) => len), [180, 180, 180, 180]);
  assert.throws(() => mavlinkRtcmPackets(new Uint8Array(721)), /at most 720/);
});
