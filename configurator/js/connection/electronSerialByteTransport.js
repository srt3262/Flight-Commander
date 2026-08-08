export class ElectronSerialByteTransport {
  constructor(api = globalThis.window?.electronAPI) {
    if (!api) {
      throw new TypeError(
        "Electron serial transport requires an Electron API bridge.",
      );
    }
    this.api = api;
    this.path = null;
    this.opened = false;
    this.buffer = new Uint8Array(0);
    this.waiters = [];
    this.dataHandler = null;
    this.errorHandler = null;
    this.closeHandler = null;
    this.connectionId = null;
    this.pendingIpcEvents = [];
    this.pendingOpenError = null;
  }

  async open(path, bitrate = 115200) {
    if (this.opened) {
      await this.close();
    }
    this.path = path;
    this.buffer = new Uint8Array(0);
    this.connectionId = null;
    this.pendingIpcEvents = [];
    this.pendingOpenError = null;
    this.bindEvents();

    try {
      const response = await this.api.serialConnect(path, { bitrate });
      if (response?.error) {
        throw new Error(response.msg || `Unable to open ${path}.`);
      }
      this.connectionId = response.id;
      const pending = this.pendingIpcEvents;
      this.pendingIpcEvents = [];
      pending.forEach(({ type, envelope }) =>
        this.dispatchIpcEvent(type, envelope),
      );
      if (this.pendingOpenError) {
        throw this.pendingOpenError;
      }
      this.opened = true;
      return response;
    } catch (error) {
      this.unbindEvents();
      this.path = null;
      this.connectionId = null;
      this.pendingIpcEvents = [];
      this.pendingOpenError = null;
      this.buffer = new Uint8Array(0);
      throw error;
    }
  }

  bindEvents() {
    this.dataHandler = this.api.onSerialData((envelope) => {
      this.receiveIpcEvent("data", envelope);
    });
    this.errorHandler = this.api.onSerialError((envelope) => {
      this.receiveIpcEvent("error", envelope);
    });
    this.closeHandler = this.api.onSerialClose((envelope) => {
      this.receiveIpcEvent("close", envelope);
    });
  }

  receiveIpcEvent(type, envelope) {
    if (this.connectionId == null) {
      if (this.pendingIpcEvents.length >= 256) {
        this.pendingIpcEvents.shift();
      }
      this.pendingIpcEvents.push({ type, envelope });
      return;
    }
    this.dispatchIpcEvent(type, envelope);
  }

  dispatchIpcEvent(type, envelope) {
    if (envelope?.connectionId !== this.connectionId) return;
    if (type === "data") {
      const value = envelope.data;
      const data =
        value instanceof Uint8Array ? value : Uint8Array.from(value ?? []);
      if (!data.length) return;
      const combined = new Uint8Array(this.buffer.length + data.length);
      combined.set(this.buffer, 0);
      combined.set(data, this.buffer.length);
      this.buffer = combined;
      this.serviceWaiters();
      return;
    }

    const error =
      type === "error"
        ? new Error(envelope.error || "Serial transport error.")
        : new Error(`Serial port ${this.path ?? ""} closed.`);
    if (!this.opened) {
      this.pendingOpenError = error;
      return;
    }
    this.opened = false;
    this.failWaiters(error);
  }

  unbindEvents() {
    if (this.dataHandler) {
      this.api.offSerialData(this.dataHandler);
    }
    if (this.errorHandler) {
      this.api.offSerialError(this.errorHandler);
    }
    if (this.closeHandler) {
      this.api.offSerialClose(this.closeHandler);
    }
    this.dataHandler = null;
    this.errorHandler = null;
    this.closeHandler = null;
  }

  serviceWaiters() {
    while (
      this.waiters.length &&
      this.buffer.length >= this.waiters[0].length
    ) {
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.abort);
      const result = this.buffer.slice(0, waiter.length);
      this.buffer = this.buffer.slice(waiter.length);
      waiter.resolve(result);
    }
  }

  failWaiters(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.reject(error);
    }
  }

  flushInput() {
    this.buffer = new Uint8Array(0);
  }

  async write(value) {
    if (!this.opened) {
      throw new Error("Serial transport is not open.");
    }
    const data =
      value instanceof Uint8Array ? value : Uint8Array.from(value ?? []);
    const response = await this.api.serialSend(data, this.connectionId);
    if (response?.error) {
      throw new Error(response.msg || "Serial write failed.");
    }
    if (response?.bytesWritten !== data.length) {
      throw new Error(
        `Serial write was incomplete (${response?.bytesWritten ?? 0} of ${data.length} bytes).`,
      );
    }
    return response.bytesWritten;
  }

  read(length, timeoutMs = 2000, signal = null) {
    if (!this.opened) {
      return Promise.reject(new Error("Serial transport is not open."));
    }
    if (!Number.isInteger(length) || length < 0) {
      return Promise.reject(
        new TypeError("Serial read length must be a non-negative integer."),
      );
    }
    if (length === 0) {
      return Promise.resolve(new Uint8Array(0));
    }
    if (this.buffer.length >= length) {
      const result = this.buffer.slice(0, length);
      this.buffer = this.buffer.slice(length);
      return Promise.resolve(result);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        length,
        resolve,
        reject,
        signal,
        timer: null,
        abort: null,
      };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        signal?.removeEventListener("abort", waiter.abort);
        reject(new Error(`Timed out waiting for ${length} serial bytes.`));
      }, timeoutMs);
      waiter.abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        clearTimeout(waiter.timer);
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error("Serial read cancelled."),
        );
      };

      if (signal?.aborted) {
        waiter.abort();
        return;
      }
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.serviceWaiters();
    });
  }

  readExactly(length, options = {}) {
    return this.read(length, options.timeoutMs ?? 2000, options.signal ?? null);
  }

  flushOutput() {
    // serialSend resolves only after the bridge has accepted the full write.
  }

  async close() {
    const wasOpened = this.opened;
    this.opened = false;
    this.failWaiters(new Error("Serial transport closed."));
    this.buffer = new Uint8Array(0);
    try {
      if (wasOpened) {
        await this.api.serialClose(this.connectionId);
      }
    } finally {
      this.unbindEvents();
      this.path = null;
      this.connectionId = null;
      this.pendingIpcEvents = [];
      this.pendingOpenError = null;
    }
  }
}

export default ElectronSerialByteTransport;
