import { calculateFirmwareCrc, padFirmwareImage } from "./apj.js";
import { assertFirmwareCompatible } from "./compatibility.js";
import {
  BootloaderProtocolError,
  BootloaderTimeoutError,
  FirmwareCompatibilityError,
  FirmwareUploadCancelledError,
} from "./errors.js";

export const PX4_BOOTLOADER = Object.freeze({
  INSYNC: 0x12,
  EOC: 0x20,
  response: Object.freeze({
    OK: 0x10,
    FAILED: 0x11,
    INVALID: 0x13,
    BAD_SILICON_REVISION: 0x14,
  }),
  command: Object.freeze({
    GET_SYNC: 0x21,
    GET_DEVICE: 0x22,
    CHIP_ERASE: 0x23,
    PROG_MULTI: 0x27,
    GET_CRC: 0x29,
    REBOOT: 0x30,
  }),
  info: Object.freeze({
    BOOTLOADER_REVISION: 1,
    BOARD_ID: 2,
    BOARD_REVISION: 3,
    FLASH_SIZE: 4,
  }),
  MIN_IDENTIFY_REVISION: 2,
  MAX_IDENTIFY_REVISION: 5,
  MIN_CRC_FLASH_REVISION: 3,
  PROG_MULTI_MAX: 252,
});

function bytes(...values) {
  return Uint8Array.from(values);
}

function asUint8Array(value, label) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new BootloaderProtocolError(`${label} did not return bytes`);
}

function uint32LittleEndian(value) {
  const bytesValue = asUint8Array(value, "Bootloader");
  if (bytesValue.byteLength !== 4) {
    throw new BootloaderProtocolError(
      `Expected a four-byte device value, received ${bytesValue.byteLength}`,
    );
  }
  return new DataView(bytesValue.buffer, bytesValue.byteOffset, 4).getUint32(
    0,
    true,
  );
}

function cancellationFromSignal(signal) {
  return new FirmwareUploadCancelledError("Firmware operation cancelled", {
    cause: signal?.reason instanceof Error ? signal.reason : undefined,
  });
}

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw cancellationFromSignal(signal);
  }
}

function isNonRetryable(error) {
  return (
    error instanceof FirmwareUploadCancelledError ||
    [
      "BOOTLOADER_OPERATION_FAILED",
      "BOOTLOADER_INVALID_OPERATION",
      "BOOTLOADER_BAD_SILICON",
      "BOOTLOADER_PARTIAL_WRITE",
      "BOOTLOADER_UNKNOWN_STATUS",
    ].includes(error?.code)
  );
}

function validateTransport(transport) {
  if (
    !transport ||
    typeof transport.write !== "function" ||
    typeof transport.readExactly !== "function"
  ) {
    throw new TypeError(
      "PX4 bootloader transport requires async write() and readExactly() methods",
    );
  }
}

function validateOptions(options) {
  for (const field of [
    "timeoutMs",
    "eraseTimeoutMs",
    "maxRetries",
    "chunkSize",
  ]) {
    const value = options[field];
    const valid =
      field === "maxRetries"
        ? Number.isInteger(value) && value >= 0
        : Number.isInteger(value) && value > 0;
    if (!valid) {
      throw new TypeError(
        `${field} must be ${field === "maxRetries" ? "a non-negative" : "a positive"} integer`,
      );
    }
  }

  if (
    options.chunkSize > PX4_BOOTLOADER.PROG_MULTI_MAX ||
    options.chunkSize > 255 ||
    options.chunkSize % 4 !== 0
  ) {
    throw new TypeError(
      `chunkSize must be a four-byte multiple no larger than ${PX4_BOOTLOADER.PROG_MULTI_MAX}`,
    );
  }
}

export class Px4BootloaderUploader {
  constructor(transport, options = {}) {
    validateTransport(transport);
    this.transport = transport;
    this.options = {
      timeoutMs: options.timeoutMs ?? 2000,
      eraseTimeoutMs: options.eraseTimeoutMs ?? 20000,
      maxRetries: options.maxRetries ?? 2,
      chunkSize: options.chunkSize ?? PX4_BOOTLOADER.PROG_MULTI_MAX,
      onProgress: options.onProgress ?? null,
    };
    validateOptions(this.options);
    this.state = "idle";
    this.boardInfo = null;
    this._active = false;
  }

  _setState(state) {
    this.state = state;
  }

  _emitProgress(callback, phase, completed, total, overallRatio, details = {}) {
    const ratio = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
    const event = Object.freeze({
      phase,
      state: this.state,
      completed,
      total,
      ratio,
      overallRatio: Math.max(0, Math.min(1, overallRatio)),
      ...details,
    });
    const callbacks = [this.options.onProgress, callback].filter(
      (candidate, index, all) =>
        typeof candidate === "function" && all.indexOf(candidate) === index,
    );
    for (const listener of callbacks) {
      try {
        listener(event);
      } catch {
        // Progress reporting must never compromise a flash operation.
      }
    }
  }

  async _withTimeout(operation, { timeoutMs, label, signal }) {
    throwIfCancelled(signal);

    const controller = new AbortController();
    let timedOut = false;
    let timeout;
    let abortHandler;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new BootloaderTimeoutError(
            `${label} timed out after ${timeoutMs} ms`,
            {
              details: { label, timeoutMs },
            },
          ),
        );
      }, timeoutMs);
    });
    const cancellationPromise = signal
      ? new Promise((resolve, reject) => {
          abortHandler = () => {
            controller.abort(signal.reason);
            reject(cancellationFromSignal(signal));
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        })
      : new Promise(() => {});

    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        timeoutPromise,
        cancellationPromise,
      ]);
    } catch (error) {
      if (signal?.aborted) {
        throw cancellationFromSignal(signal);
      }
      if (timedOut && !(error instanceof BootloaderTimeoutError)) {
        throw new BootloaderTimeoutError(
          `${label} timed out after ${timeoutMs} ms`,
          {
            cause: error,
            details: { label, timeoutMs },
          },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }

  async _flushInput(signal) {
    throwIfCancelled(signal);
    if (typeof this.transport.flushInput === "function") {
      await this._withTimeout(
        (operationSignal) =>
          this.transport.flushInput({ signal: operationSignal }),
        {
          timeoutMs: this.options.timeoutMs,
          label: "Serial input flush",
          signal,
        },
      );
    }
  }

  async _write(
    value,
    {
      signal,
      timeoutMs = this.options.timeoutMs,
      label = "Bootloader write",
    } = {},
  ) {
    throwIfCancelled(signal);
    const payload = asUint8Array(value, "Bootloader write");
    const result = await this._withTimeout(
      (operationSignal) =>
        this.transport.write(payload, { signal: operationSignal }),
      { timeoutMs, label, signal },
    );
    const bytesWritten =
      typeof result === "number"
        ? result
        : result && typeof result.bytesWritten === "number"
          ? result.bytesWritten
          : payload.byteLength;
    if (bytesWritten !== payload.byteLength) {
      throw new BootloaderProtocolError(
        `${label} wrote ${bytesWritten} of ${payload.byteLength} bytes`,
        { code: "BOOTLOADER_PARTIAL_WRITE" },
      );
    }
  }

  async _readExactly(
    length,
    {
      signal,
      timeoutMs = this.options.timeoutMs,
      label = "Bootloader read",
    } = {},
  ) {
    const result = await this._withTimeout(
      (operationSignal) =>
        this.transport.readExactly(length, {
          timeoutMs,
          signal: operationSignal,
        }),
      { timeoutMs, label, signal },
    );
    const payload = asUint8Array(result, label);
    if (payload.byteLength !== length) {
      throw new BootloaderProtocolError(
        `${label} returned ${payload.byteLength} bytes; ${length} were required`,
        { code: "BOOTLOADER_SHORT_READ" },
      );
    }
    return payload;
  }

  async _readSync({
    signal,
    timeoutMs = this.options.timeoutMs,
    label = "Bootloader response",
  } = {}) {
    const response = await this._readExactly(2, { signal, timeoutMs, label });
    if (response[0] !== PX4_BOOTLOADER.INSYNC) {
      throw new BootloaderProtocolError(
        `Expected INSYNC (0x12), received 0x${response[0].toString(16).padStart(2, "0")}`,
        {
          code: "BOOTLOADER_NOT_IN_SYNC",
          details: { response: Array.from(response) },
        },
      );
    }

    switch (response[1]) {
      case PX4_BOOTLOADER.response.OK:
        return;
      case PX4_BOOTLOADER.response.FAILED:
        throw new BootloaderProtocolError(
          "Bootloader reported operation failure",
          {
            code: "BOOTLOADER_OPERATION_FAILED",
          },
        );
      case PX4_BOOTLOADER.response.INVALID:
        throw new BootloaderProtocolError(
          "Bootloader reported an invalid operation",
          {
            code: "BOOTLOADER_INVALID_OPERATION",
          },
        );
      case PX4_BOOTLOADER.response.BAD_SILICON_REVISION:
        throw new BootloaderProtocolError(
          "Bootloader reports that this silicon revision cannot be programmed",
          { code: "BOOTLOADER_BAD_SILICON" },
        );
      default:
        throw new BootloaderProtocolError(
          `Unknown bootloader response status 0x${response[1].toString(16).padStart(2, "0")}`,
          {
            code: "BOOTLOADER_UNKNOWN_STATUS",
            details: { response: Array.from(response) },
          },
        );
    }
  }

  async _retryIdempotent(label, operation, signal) {
    let lastError;
    const attempts = this.options.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      throwIfCancelled(signal);
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (isNonRetryable(error) || attempt === attempts) {
          throw error;
        }
        await this._flushInput(signal);
      }
    }
    throw lastError ?? new BootloaderProtocolError(`${label} failed`);
  }

  async sync({ signal } = {}) {
    this._setState("syncing");
    await this._flushInput(signal);
    await this._retryIdempotent(
      "Bootloader synchronization",
      async () => {
        await this._write(
          bytes(PX4_BOOTLOADER.command.GET_SYNC, PX4_BOOTLOADER.EOC),
          { signal, label: "GET_SYNC write" },
        );
        await this._readSync({ signal, label: "GET_SYNC response" });
      },
      signal,
    );
    return true;
  }

  async _getDeviceInfo(infoId, label, signal) {
    return this._retryIdempotent(
      `GET_DEVICE ${label}`,
      async () => {
        await this._write(
          bytes(PX4_BOOTLOADER.command.GET_DEVICE, infoId, PX4_BOOTLOADER.EOC),
          { signal, label: `GET_DEVICE ${label} write` },
        );
        const value = await this._readExactly(4, {
          signal,
          label: `GET_DEVICE ${label} value`,
        });
        await this._readSync({ signal, label: `GET_DEVICE ${label} response` });
        return uint32LittleEndian(value);
      },
      signal,
    );
  }

  async identify({ signal, onProgress } = {}) {
    this._setState("identifying");
    this._emitProgress(onProgress, "identify", 0, 5, 0);
    await this.sync({ signal });
    this._setState("identifying");
    this._emitProgress(onProgress, "identify", 1, 5, 0.01);

    const bootloaderRevision = await this._getDeviceInfo(
      PX4_BOOTLOADER.info.BOOTLOADER_REVISION,
      "bootloader revision",
      signal,
    );
    this._emitProgress(onProgress, "identify", 2, 5, 0.02);
    if (
      bootloaderRevision < PX4_BOOTLOADER.MIN_IDENTIFY_REVISION ||
      bootloaderRevision > PX4_BOOTLOADER.MAX_IDENTIFY_REVISION
    ) {
      throw new BootloaderProtocolError(
        `Unsupported PX4 bootloader protocol revision ${bootloaderRevision}`,
        {
          code: "BOOTLOADER_REVISION_UNSUPPORTED",
          details: { bootloaderRevision },
        },
      );
    }

    const boardId = await this._getDeviceInfo(
      PX4_BOOTLOADER.info.BOARD_ID,
      "board ID",
      signal,
    );
    this._emitProgress(onProgress, "identify", 3, 5, 0.03);
    const boardRevision = await this._getDeviceInfo(
      PX4_BOOTLOADER.info.BOARD_REVISION,
      "board revision",
      signal,
    );
    this._emitProgress(onProgress, "identify", 4, 5, 0.04);
    const flashSize = await this._getDeviceInfo(
      PX4_BOOTLOADER.info.FLASH_SIZE,
      "flash size",
      signal,
    );

    if (!Number.isInteger(boardId) || boardId <= 0) {
      throw new BootloaderProtocolError(
        "Bootloader returned an invalid board ID",
        {
          code: "BOOTLOADER_BOARD_ID_INVALID",
          details: { boardId },
        },
      );
    }
    if (!Number.isInteger(flashSize) || flashSize <= 0) {
      throw new BootloaderProtocolError(
        "Bootloader returned an invalid flash size",
        {
          code: "BOOTLOADER_FLASH_SIZE_INVALID",
          details: { flashSize },
        },
      );
    }

    this.boardInfo = Object.freeze({
      bootloaderRevision,
      boardId,
      boardRevision,
      flashSize,
    });
    this._emitProgress(onProgress, "identify", 5, 5, 0.05, {
      boardInfo: this.boardInfo,
    });
    return this.boardInfo;
  }

  async erase({ signal, onProgress } = {}) {
    this._setState("erasing");
    this._emitProgress(onProgress, "erase", 0, 1, 0.05);
    await this._write(
      bytes(PX4_BOOTLOADER.command.CHIP_ERASE, PX4_BOOTLOADER.EOC),
      { signal, label: "CHIP_ERASE write" },
    );
    await this._readSync({
      signal,
      timeoutMs: this.options.eraseTimeoutMs,
      label: "CHIP_ERASE response",
    });
    this._emitProgress(onProgress, "erase", 1, 1, 0.15);
  }

  async program(image, { signal, onProgress } = {}) {
    const padded = padFirmwareImage(image);
    if (padded.byteLength === 0) {
      throw new BootloaderProtocolError(
        "Cannot program an empty firmware image",
      );
    }

    this._setState("programming");
    this._emitProgress(onProgress, "program", 0, padded.byteLength, 0.15);
    for (
      let offset = 0;
      offset < padded.byteLength;
      offset += this.options.chunkSize
    ) {
      throwIfCancelled(signal);
      const chunk = padded.subarray(
        offset,
        Math.min(offset + this.options.chunkSize, padded.length),
      );
      const command = new Uint8Array(chunk.byteLength + 3);
      command[0] = PX4_BOOTLOADER.command.PROG_MULTI;
      command[1] = chunk.byteLength;
      command.set(chunk, 2);
      command[command.length - 1] = PX4_BOOTLOADER.EOC;

      await this._write(command, {
        signal,
        label: `PROG_MULTI at offset ${offset}`,
      });
      await this._readSync({
        signal,
        label: `PROG_MULTI response at offset ${offset}`,
      });

      const completed = offset + chunk.byteLength;
      this._emitProgress(
        onProgress,
        "program",
        completed,
        padded.byteLength,
        0.15 + 0.7 * (completed / padded.byteLength),
      );
    }
    return padded.byteLength;
  }

  async verifyCrc(image, flashSize, { signal, onProgress } = {}) {
    const expectedCrc = calculateFirmwareCrc(image, flashSize);
    this._setState("verifying");
    this._emitProgress(onProgress, "verify", 0, 1, 0.85, { expectedCrc });

    const reportedCrc = await this._retryIdempotent(
      "GET_CRC",
      async () => {
        await this._write(
          bytes(PX4_BOOTLOADER.command.GET_CRC, PX4_BOOTLOADER.EOC),
          { signal, label: "GET_CRC write" },
        );
        const value = await this._readExactly(4, {
          signal,
          label: "GET_CRC value",
        });
        await this._readSync({ signal, label: "GET_CRC response" });
        return uint32LittleEndian(value);
      },
      signal,
    );

    if (reportedCrc !== expectedCrc) {
      throw new BootloaderProtocolError(
        `Firmware CRC verification failed: expected 0x${expectedCrc.toString(16).padStart(8, "0")}, ` +
          `received 0x${reportedCrc.toString(16).padStart(8, "0")}`,
        {
          code: "BOOTLOADER_CRC_MISMATCH",
          details: { expectedCrc, reportedCrc },
        },
      );
    }

    this._emitProgress(onProgress, "verify", 1, 1, 0.95, {
      expectedCrc,
      reportedCrc,
    });
    return reportedCrc;
  }

  async reboot({ signal, onProgress } = {}) {
    this._setState("rebooting");
    this._emitProgress(onProgress, "reboot", 0, 1, 0.95);
    await this._write(
      bytes(PX4_BOOTLOADER.command.REBOOT, PX4_BOOTLOADER.EOC),
      { signal, label: "REBOOT write" },
    );
    if ((this.boardInfo?.bootloaderRevision ?? 3) >= 3) {
      await this._readSync({ signal, label: "REBOOT response" });
    }
    if (typeof this.transport.flushOutput === "function") {
      await this._withTimeout(
        (operationSignal) =>
          this.transport.flushOutput({ signal: operationSignal }),
        {
          timeoutMs: this.options.timeoutMs,
          label: "Serial output flush",
          signal,
        },
      );
    }
    this._emitProgress(onProgress, "reboot", 1, 1, 1);
  }

  async flash(
    firmware,
    { signal, onProgress, compatibleBoardIds, reboot = true } = {},
  ) {
    if (this._active) {
      throw new BootloaderProtocolError(
        "A firmware operation is already in progress",
        {
          code: "BOOTLOADER_BUSY",
        },
      );
    }
    this._active = true;
    this._setState("starting");

    try {
      throwIfCancelled(signal);
      const boardInfo = await this.identify({ signal, onProgress });
      if (
        boardInfo.bootloaderRevision < PX4_BOOTLOADER.MIN_CRC_FLASH_REVISION
      ) {
        throw new FirmwareCompatibilityError(
          `Bootloader revision ${boardInfo.bootloaderRevision} requires read-back verification, ` +
            "which this CRC-only uploader does not implement",
          {
            details: {
              bootloaderRevision: boardInfo.bootloaderRevision,
              minimumRevision: PX4_BOOTLOADER.MIN_CRC_FLASH_REVISION,
            },
          },
        );
      }
      if (boardInfo.flashSize % 4 !== 0) {
        throw new FirmwareCompatibilityError(
          `Controller flash size ${boardInfo.flashSize} is not four-byte aligned`,
        );
      }

      const compatibility = assertFirmwareCompatible(boardInfo, firmware, {
        compatibleBoardIds,
      });
      await this.erase({ signal, onProgress });
      const bytesProgrammed = await this.program(firmware.image, {
        signal,
        onProgress,
      });
      const crc = await this.verifyCrc(firmware.image, boardInfo.flashSize, {
        signal,
        onProgress,
      });
      if (reboot) {
        await this.reboot({ signal, onProgress });
      }

      this._setState("complete");
      this._emitProgress(onProgress, "complete", 1, 1, 1, {
        boardInfo,
        bytesProgrammed,
        crc,
        rebooted: reboot,
      });
      return Object.freeze({
        boardInfo,
        compatibility,
        bytesProgrammed,
        crc,
        rebooted: reboot,
      });
    } catch (error) {
      if (signal?.aborted || error instanceof FirmwareUploadCancelledError) {
        this._setState("cancelled");
        throw error instanceof FirmwareUploadCancelledError
          ? error
          : cancellationFromSignal(signal);
      }
      this._setState("error");
      throw error;
    } finally {
      this._active = false;
    }
  }
}

export default Px4BootloaderUploader;
