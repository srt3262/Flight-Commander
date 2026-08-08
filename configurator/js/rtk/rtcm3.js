"use strict";

export const RTCM3_PREAMBLE = 0xd3;
export const RTCM3_MAX_PAYLOAD_BYTES = 1023;
export const MAVLINK_RTCM_FRAGMENT_BYTES = 180;
export const MAVLINK_RTCM_MAX_BYTES = 4 * MAVLINK_RTCM_FRAGMENT_BYTES;

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError("RTCM data must be a byte array.");
}

export function crc24q(value) {
  const data = bytes(value);
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

export function rtcm3MessageType(frame) {
  const data = bytes(frame);
  if (data.length < 8 || data[0] !== RTCM3_PREAMBLE) return null;
  return (data[3] << 4) | (data[4] >> 4);
}

export function createRtcm3Frame(payload) {
  const body = bytes(payload);
  if (body.length > RTCM3_MAX_PAYLOAD_BYTES) {
    throw new RangeError("RTCM3 payload exceeds 1023 bytes.");
  }
  const frame = new Uint8Array(body.length + 6);
  frame[0] = RTCM3_PREAMBLE;
  frame[1] = (body.length >> 8) & 0x03;
  frame[2] = body.length & 0xff;
  frame.set(body, 3);
  const crc = crc24q(frame.subarray(0, frame.length - 3));
  frame[frame.length - 3] = (crc >> 16) & 0xff;
  frame[frame.length - 2] = (crc >> 8) & 0xff;
  frame[frame.length - 1] = crc & 0xff;
  return frame;
}

export class Rtcm3Parser {
  constructor(options = {}) {
    this.onFrame = options.onFrame ?? (() => {});
    this.onInvalid = options.onInvalid ?? (() => {});
    this.buffer = new Uint8Array(0);
    this.invalidFrames = 0;
  }

  reset() {
    this.buffer = new Uint8Array(0);
    this.invalidFrames = 0;
  }

  push(value) {
    const incoming = bytes(value);
    if (!incoming.length) return [];
    const combined = new Uint8Array(this.buffer.length + incoming.length);
    combined.set(this.buffer);
    combined.set(incoming, this.buffer.length);
    this.buffer = combined;

    const frames = [];
    while (this.buffer.length) {
      const preamble = this.buffer.indexOf(RTCM3_PREAMBLE);
      if (preamble < 0) {
        this.buffer = new Uint8Array(0);
        break;
      }
      if (preamble > 0) this.buffer = this.buffer.subarray(preamble);
      if (this.buffer.length < 3) break;

      if ((this.buffer[1] & 0xfc) !== 0) {
        this.rejectCandidate("reserved header bits are non-zero");
        continue;
      }

      const payloadLength = ((this.buffer[1] & 0x03) << 8) | this.buffer[2];
      const frameLength = payloadLength + 6;
      if (this.buffer.length < frameLength) break;

      const candidate = this.buffer.slice(0, frameLength);
      const expected =
        (candidate[frameLength - 3] << 16) |
        (candidate[frameLength - 2] << 8) |
        candidate[frameLength - 1];
      const actual = crc24q(candidate.subarray(0, frameLength - 3));
      if (actual !== expected) {
        this.rejectCandidate("CRC-24Q mismatch");
        continue;
      }

      this.buffer = this.buffer.subarray(frameLength);
      frames.push(candidate);
      this.onFrame(candidate, {
        messageType: rtcm3MessageType(candidate),
        payloadLength,
      });
    }
    return frames;
  }

  rejectCandidate(reason) {
    this.invalidFrames += 1;
    this.onInvalid({ reason, invalidFrames: this.invalidFrames });
    this.buffer = this.buffer.subarray(1);
  }
}

export function mavlinkRtcmPackets(value, sequenceId = 0) {
  const frame = bytes(value);
  if (!frame.length) throw new RangeError("An RTCM frame cannot be empty.");
  if (frame.length > MAVLINK_RTCM_MAX_BYTES) {
    throw new RangeError(
      `RTCM frame is ${frame.length} bytes; MAVLink GPS_RTCM_DATA supports at most ${MAVLINK_RTCM_MAX_BYTES}.`,
    );
  }
  if (frame.length <= MAVLINK_RTCM_FRAGMENT_BYTES) {
    return [{ flags: 0, len: frame.length, data: frame.slice() }];
  }

  const sequence = Number(sequenceId) & 0x1f;
  let fragmentCount = Math.ceil(frame.length / MAVLINK_RTCM_FRAGMENT_BYTES);
  if (
    frame.length < MAVLINK_RTCM_MAX_BYTES &&
    frame.length % MAVLINK_RTCM_FRAGMENT_BYTES === 0
  ) {
    // A short fragment marks the end of a fragmented MAVLink RTCM message.
    // Exact 180-byte multiples below 720 therefore need a zero-length terminator.
    fragmentCount += 1;
  }
  if (fragmentCount > 4) {
    throw new RangeError("RTCM frame requires more than four MAVLink fragments.");
  }

  return Array.from({ length: fragmentCount }, (_unused, fragmentId) => {
    const start = fragmentId * MAVLINK_RTCM_FRAGMENT_BYTES;
    const data = frame.slice(start, start + MAVLINK_RTCM_FRAGMENT_BYTES);
    return {
      flags: 1 | (fragmentId << 1) | (sequence << 3),
      len: data.length,
      data,
    };
  });
}

export function paddedMavlinkRtcmData(value) {
  const data = bytes(value);
  if (data.length > MAVLINK_RTCM_FRAGMENT_BYTES) {
    throw new RangeError("A MAVLink RTCM fragment cannot exceed 180 bytes.");
  }
  const padded = new Uint8Array(MAVLINK_RTCM_FRAGMENT_BYTES);
  padded.set(data);
  return Array.from(padded);
}
