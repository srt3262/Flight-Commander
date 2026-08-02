import assert from "node:assert/strict";
import test from "node:test";

import {
  MAV_FTP_DATA_LENGTH,
  MAV_FTP_OPCODE,
  MavlinkFtpClient,
  decodeMavFtpPayload,
  encodeMavFtpPayload,
} from "../../../js/mavlink/ftpClient.js";

function ackFor(request, options = {}) {
  return encodeMavFtpPayload({
    sequence: (request.sequence + 1) & 0xffff,
    session: options.session ?? request.session,
    opcode: MAV_FTP_OPCODE.ack,
    requestOpcode: request.opcode,
    offset: options.offset ?? request.offset,
    data: options.data ?? [],
  });
}

class FakeFtpSession {
  constructor(file = new Uint8Array()) {
    this.file = Uint8Array.from(file);
    this.upload = [];
    this.requests = [];
    this.waiter = null;
  }

  target() {
    return { targetSystem: 1, targetComponent: 1 };
  }

  waitFor(_names, predicate) {
    return new Promise((resolve) => {
      this.waiter = { predicate, resolve };
    });
  }

  async send(messageName, envelope) {
    assert.equal(messageName, "FileTransferProtocol");
    assert.equal(envelope.targetSystem, 1);
    const request = decodeMavFtpPayload(envelope.payload);
    this.requests.push(request);
    let response;
    if (request.opcode === MAV_FTP_OPCODE.openFileReadOnly) {
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, this.file.length, true);
      response = ackFor(request, { session: 9, data: size });
    } else if (request.opcode === MAV_FTP_OPCODE.readFile) {
      response = ackFor(request, {
        session: request.session,
        offset: request.offset,
        data: this.file.slice(request.offset, request.offset + request.size),
      });
    } else if (request.opcode === MAV_FTP_OPCODE.createFile) {
      response = ackFor(request, { session: 7 });
    } else if (request.opcode === MAV_FTP_OPCODE.writeFile) {
      this.upload.push({ offset: request.offset, data: request.data });
      response = ackFor(request, { session: request.session });
    } else {
      response = ackFor(request);
    }
    const decodedEnvelope = {
      messageName: "FileTransferProtocol",
      data: { payload: Array.from(response) },
    };
    assert.ok(this.waiter?.predicate(decodedEnvelope), "generated FTP response must match waiter");
    this.waiter.resolve(decodedEnvelope);
    this.waiter = null;
    return response.length;
  }
}

test("MAVLink FTP payload codec uses the documented 12-byte little-endian header", () => {
  const payload = encodeMavFtpPayload({
    sequence: 0x1234,
    session: 7,
    opcode: MAV_FTP_OPCODE.writeFile,
    offset: 0x12345678,
    data: Uint8Array.of(1, 2, 3),
  });
  assert.equal(payload.length, 251);
  assert.deepEqual(Array.from(payload.slice(0, 12)), [
    0x34, 0x12, 7, MAV_FTP_OPCODE.writeFile, 3, 0, 0, 0,
    0x78, 0x56, 0x34, 0x12,
  ]);
  assert.deepEqual(decodeMavFtpPayload(payload), {
    sequence: 0x1234,
    session: 7,
    opcode: MAV_FTP_OPCODE.writeFile,
    size: 3,
    requestOpcode: 0,
    burstComplete: 0,
    offset: 0x12345678,
    data: Uint8Array.of(1, 2, 3),
  });
});

test("uploads a Lua script in bounded chunks and closes the write session", async () => {
  const session = new FakeFtpSession();
  const client = new MavlinkFtpClient({ session, initialSequence: 40 });
  const source = new Uint8Array(MAV_FTP_DATA_LENGTH + 17).map((_value, index) => index & 0xff);
  const progress = [];
  const result = await client.upload("/APM/scripts/flight_commander.lua", source, {
    onProgress: (entry) => progress.push(entry.received),
  });

  assert.equal(result.size, source.length);
  assert.deepEqual(session.requests.map((request) => request.opcode), [
    MAV_FTP_OPCODE.createDirectory,
    MAV_FTP_OPCODE.createFile,
    MAV_FTP_OPCODE.writeFile,
    MAV_FTP_OPCODE.writeFile,
    MAV_FTP_OPCODE.terminateSession,
  ]);
  assert.deepEqual(session.upload.map((entry) => entry.offset), [0, MAV_FTP_DATA_LENGTH]);
  assert.deepEqual(progress, [MAV_FTP_DATA_LENGTH, source.length]);
  const reconstructed = new Uint8Array(source.length);
  for (const chunk of session.upload) reconstructed.set(chunk.data, chunk.offset);
  assert.deepEqual(reconstructed, source);
});

test("downloads a controller script by reported size and closes the read session", async () => {
  const source = new TextEncoder().encode("return function() return 1000 end\n".repeat(12));
  const session = new FakeFtpSession(source);
  const client = new MavlinkFtpClient({ session });
  const progress = [];
  const downloaded = await client.download("/APM/scripts/flight_commander.lua", {
    onProgress: (entry) => progress.push(entry.received),
  });

  assert.deepEqual(downloaded, source);
  assert.equal(session.requests[0].opcode, MAV_FTP_OPCODE.openFileReadOnly);
  assert.equal(session.requests.at(-1).opcode, MAV_FTP_OPCODE.terminateSession);
  assert.equal(progress.at(-1), source.length);
});
