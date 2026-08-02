"use strict";

import { field } from "./frameNormalizer.js";
import mavlinkSession from "./mavlinkSession.js";

export const MAV_FTP_PAYLOAD_LENGTH = 251;
export const MAV_FTP_DATA_LENGTH = 239;

export const MAV_FTP_OPCODE = Object.freeze({
  terminateSession: 1,
  resetSessions: 2,
  listDirectory: 3,
  openFileReadOnly: 4,
  readFile: 5,
  createFile: 6,
  writeFile: 7,
  removeFile: 8,
  createDirectory: 9,
  openFileWriteOnly: 11,
  truncateFile: 12,
  calculateCrc32: 14,
  ack: 128,
  nak: 129,
});

export const MAV_FTP_ERROR = Object.freeze({
  none: 0,
  fail: 1,
  failErrno: 2,
  invalidDataSize: 3,
  invalidSession: 4,
  noSessions: 5,
  eof: 6,
  unknownCommand: 7,
  fileExists: 8,
  fileProtected: 9,
  fileNotFound: 10,
});

const FTP_ERROR_NAMES = Object.freeze({
  0: "no error",
  1: "operation failed",
  2: "filesystem error",
  3: "invalid data size",
  4: "invalid session",
  5: "no sessions available",
  6: "end of file",
  7: "unknown command",
  8: "file already exists",
  9: "file is protected",
  10: "file not found",
});

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  return Uint8Array.from(value ?? []);
}

function uint16(value) {
  return Number(value) & 0xffff;
}

export function encodeMavFtpPayload(request) {
  const data = bytes(request.data);
  const requestedSize = request.size == null ? data.length : Number(request.size);
  if (!Number.isInteger(requestedSize) || requestedSize < 0 || requestedSize > MAV_FTP_DATA_LENGTH) {
    throw new RangeError(`MAVLink FTP data size must be 0-${MAV_FTP_DATA_LENGTH} bytes.`);
  }
  if (data.length > MAV_FTP_DATA_LENGTH || (data.length && data.length < requestedSize)) {
    throw new RangeError(`MAVLink FTP payload data must contain ${requestedSize} bytes.`);
  }
  const payload = new Uint8Array(MAV_FTP_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  view.setUint16(0, uint16(request.sequence), true);
  payload[2] = Number(request.session ?? 0) & 0xff;
  payload[3] = Number(request.opcode ?? 0) & 0xff;
  payload[4] = requestedSize;
  payload[5] = Number(request.requestOpcode ?? 0) & 0xff;
  payload[6] = Number(request.burstComplete ?? 0) & 0xff;
  payload[7] = 0;
  view.setUint32(8, Number(request.offset ?? 0) >>> 0, true);
  payload.set(data.slice(0, requestedSize), 12);
  return payload;
}

export function decodeMavFtpPayload(value) {
  const payload = bytes(value);
  if (payload.length < 12) throw new Error("MAVLink FTP response is shorter than its header.");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const size = payload[4];
  if (size > MAV_FTP_DATA_LENGTH || payload.length < 12 + size) {
    throw new Error("MAVLink FTP response declares an invalid data size.");
  }
  return Object.freeze({
    sequence: view.getUint16(0, true),
    session: payload[2],
    opcode: payload[3],
    size,
    requestOpcode: payload[5],
    burstComplete: payload[6],
    offset: view.getUint32(8, true),
    data: payload.slice(12, 12 + size),
  });
}

function responsePayload(envelope) {
  return field(envelope?.data, "payload") ?? [];
}

function ftpError(response, operation) {
  const code = response.data[0] ?? MAV_FTP_ERROR.fail;
  const errno = code === MAV_FTP_ERROR.failErrno ? response.data[1] : null;
  const error = new Error(
    `${operation} failed: ${FTP_ERROR_NAMES[code] ?? `FTP error ${code}`}${errno == null ? "" : ` (errno ${errno})`}.`,
  );
  error.code = "MAVLINK_FTP_NAK";
  error.ftpCode = code;
  error.errno = errno;
  return error;
}

function pathBytes(path) {
  const normalized = String(path ?? "").trim().replace(/\\/g, "/");
  if (!normalized || !normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("MAVLink FTP paths must be absolute vehicle paths.");
  }
  const encoded = new TextEncoder().encode(normalized);
  if (encoded.length > MAV_FTP_DATA_LENGTH) {
    throw new Error(`Vehicle path exceeds ${MAV_FTP_DATA_LENGTH} UTF-8 bytes.`);
  }
  return encoded;
}

export class MavlinkFtpClient {
  constructor(options = {}) {
    this.session = options.session ?? mavlinkSession;
    this.timeoutMs = options.timeoutMs ?? 500;
    this.retries = options.retries ?? 6;
    this.sequence = options.initialSequence ?? 0;
    this.operationQueue = Promise.resolve();
  }

  runExclusive(operation) {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.catch(() => {});
    return run;
  }

  nextSequence() {
    this.sequence = uint16(this.sequence + 1);
    return this.sequence;
  }

  async request(request, options = {}) {
    const target = this.session.target();
    const sequence = request.sequence ?? this.nextSequence();
    const payload = encodeMavFtpPayload({ ...request, sequence });
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? this.retries;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const waiter = this.session.waitFor(
        ["FileTransferProtocol"],
        (envelope) => {
          try {
            const response = decodeMavFtpPayload(responsePayload(envelope));
            const sequenceMatches = response.sequence === sequence
              || response.sequence === uint16(sequence + 1);
            return sequenceMatches
              && response.requestOpcode === Number(request.opcode)
              && (response.opcode === MAV_FTP_OPCODE.ack || response.opcode === MAV_FTP_OPCODE.nak);
          } catch {
            return false;
          }
        },
        timeoutMs,
      );
      // A transport failure can occur before the response waiter settles.
      // Keep the timed-out waiter from becoming an unhandled rejection while
      // the same sequence is retried, as required by MAVLink FTP.
      waiter.catch(() => {});
      try {
        await this.session.send("FileTransferProtocol", {
          targetNetwork: 0,
          ...target,
          payload: Array.from(payload),
        });
        const envelope = await waiter;
        const response = decodeMavFtpPayload(responsePayload(envelope));
        this.sequence = response.sequence;
        if (response.opcode === MAV_FTP_OPCODE.nak) {
          throw ftpError(response, options.description ?? "MAVLink FTP operation");
        }
        return response;
      } catch (error) {
        lastError = error;
        if (error?.code === "MAVLINK_FTP_NAK") throw error;
      }
    }
    throw new Error(
      `${options.description ?? "MAVLink FTP operation"} did not receive a response after ${retries + 1} attempts: ${lastError?.message ?? "timeout"}`,
    );
  }

  async resetSessions() {
    return this.request({ opcode: MAV_FTP_OPCODE.resetSessions }, {
      description: "Resetting vehicle file sessions",
    });
  }

  async createDirectory(path, options = {}) {
    try {
      return await this.request({
        opcode: MAV_FTP_OPCODE.createDirectory,
        data: pathBytes(path),
      }, { description: `Creating ${path}` });
    } catch (error) {
      if (options.allowExisting && error.ftpCode === MAV_FTP_ERROR.fileExists) return null;
      throw error;
    }
  }

  async upload(path, content, options = {}) {
    return this.runExclusive(async () => {
      const data = bytes(content);
      const parent = String(path).replace(/\/[^/]+$/, "");
      if (options.createParent !== false && parent) {
        await this.createDirectory(parent, { allowExisting: true });
      }
      const opened = await this.request({
        opcode: MAV_FTP_OPCODE.createFile,
        session: 0,
        data: pathBytes(path),
      }, { description: `Opening ${path} for upload` });
      const session = opened.session;
      let offset = 0;
      try {
        while (offset < data.length) {
          const chunk = data.slice(offset, offset + MAV_FTP_DATA_LENGTH);
          await this.request({
            opcode: MAV_FTP_OPCODE.writeFile,
            session,
            offset,
            data: chunk,
          }, { description: `Uploading ${path}` });
          offset += chunk.length;
          options.onProgress?.({ received: offset, total: data.length });
        }
      } catch (error) {
        await this.resetSessions().catch(() => {});
        throw error;
      }
      await this.request({
        opcode: MAV_FTP_OPCODE.terminateSession,
        session,
      }, { description: `Closing ${path}` });
      return Object.freeze({ path, size: data.length });
    });
  }

  async download(path, options = {}) {
    return this.runExclusive(async () => {
      const opened = await this.request({
        opcode: MAV_FTP_OPCODE.openFileReadOnly,
        session: 0,
        data: pathBytes(path),
      }, { description: `Opening ${path} for download` });
      if (opened.size !== 4) {
        await this.resetSessions().catch(() => {});
        throw new Error(`The controller returned an invalid size for ${path}.`);
      }
      const sizeView = new DataView(opened.data.buffer, opened.data.byteOffset, opened.data.byteLength);
      const size = sizeView.getUint32(0, true);
      const output = new Uint8Array(size);
      const session = opened.session;
      let offset = 0;
      try {
        while (offset < size) {
          const requested = Math.min(MAV_FTP_DATA_LENGTH, size - offset);
          const response = await this.request({
            opcode: MAV_FTP_OPCODE.readFile,
            session,
            offset,
            size: requested,
          }, { description: `Downloading ${path}` });
          if (!response.size || response.offset !== offset) {
            throw new Error(`The controller returned an incomplete chunk for ${path} at byte ${offset}.`);
          }
          output.set(response.data, offset);
          offset += response.size;
          options.onProgress?.({ received: offset, total: size });
        }
      } catch (error) {
        await this.resetSessions().catch(() => {});
        throw error;
      }
      await this.request({
        opcode: MAV_FTP_OPCODE.terminateSession,
        session,
      }, { description: `Closing ${path}` });
      return output;
    });
  }
}

export const mavlinkFtpClient = new MavlinkFtpClient();
