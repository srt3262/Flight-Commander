import { SerialPortStream } from '@serialport/stream';
import { autoDetect } from '@serialport/bindings-cpp';
import {
  disposeSerialPort,
  prepareSerialPort,
  quarantineOpeningSerialPort,
  serialOpenControlLineOptions,
} from './serialControlLines';

const binding = autoDetect();
const OPEN_TIMEOUT_MS = 10000;
const MAX_WRITE_BYTES = 8192;

function errorResult(error) {
  return { error: true, msg: error?.message || String(error) };
}

const rtkBaseSerial = {
  _port: null,
  _connectionId: null,
  _path: null,
  _nextId: 1,
  _generation: 0,

  getActivePath() {
    return this._path;
  },

  async connect(path, options = {}, window) {
    if (typeof path !== 'string' || !path.trim()) {
      return { error: true, msg: 'Select a USB RTK base serial port.' };
    }
    const baudRate = Number(options.bitrate);
    if (!Number.isInteger(baudRate) || baudRate < 1200 || baudRate > 3000000) {
      return { error: true, msg: 'RTK base baud rate is invalid.' };
    }

    await this.close();
    const generation = ++this._generation;
    const connectionId = this._nextId++;
    return new Promise((resolve) => {
      let settled = false;
      let lifecycle = 'opening';
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const port = new SerialPortStream({
        binding,
        path,
        baudRate,
        autoOpen: true,
        ...serialOpenControlLineOptions({ forceDtrLow: true }),
      });
      this._port = port;
      this._path = path;

      const timeout = setTimeout(async () => {
        if (settled) return;
        if (this._port === port) {
          this._port = null;
          this._path = null;
          this._connectionId = null;
        }
        if (port.opening && !port.isOpen) quarantineOpeningSerialPort(port);
        else await disposeSerialPort(port);
        finish({ error: true, msg: `RTK base serial open timed out after ${OPEN_TIMEOUT_MS} ms.` });
      }, OPEN_TIMEOUT_MS);

      port.on('data', (data) => {
        if (!window?.isDestroyed()) {
          window.webContents.send('rtkBaseData', { connectionId, data });
        }
      });
      port.on('error', (error) => {
        if (!window?.isDestroyed()) {
          window.webContents.send('rtkBaseError', {
            connectionId,
            phase: lifecycle,
            error: error?.message || String(error),
          });
        }
        if (this._port === port) {
          this._port = null;
          this._path = null;
          this._connectionId = null;
        }
        disposeSerialPort(port).catch(() => {});
        finish(errorResult(error));
      });
      port.on('close', () => {
        if (!window?.isDestroyed()) {
          window.webContents.send('rtkBaseClose', { connectionId, phase: lifecycle });
        }
        if (this._port === port) {
          this._port = null;
          this._path = null;
          this._connectionId = null;
        }
        finish({ error: true, msg: 'RTK base serial port closed before setup completed.' });
      });
      port.on('open', async () => {
        lifecycle = 'configuring-control-lines';
        try {
          await prepareSerialPort(port, { forceDtrLow: true });
        } catch (error) {
          if (this._port === port) {
            this._port = null;
            this._path = null;
          }
          finish(errorResult(error));
          return;
        }
        if (generation !== this._generation || this._port !== port) {
          await disposeSerialPort(port);
          finish({ error: true, msg: 'RTK base connection was superseded.' });
          return;
        }
        lifecycle = 'active';
        this._connectionId = connectionId;
        finish({ error: false, connectionId, path, bitrate: baudRate });
      });
    });
  },

  async close(connectionId = this._connectionId) {
    if (this._port && connectionId != null && connectionId !== this._connectionId) {
      return { error: true, msg: 'Stale RTK base connection close was rejected.' };
    }
    this._generation += 1;
    const port = this._port;
    this._port = null;
    this._connectionId = null;
    this._path = null;
    if (!port) return { error: false };
    try {
      await disposeSerialPort(port);
      return { error: false };
    } catch (error) {
      return errorResult(error);
    }
  },

  send(value, connectionId) {
    const data = value instanceof Uint8Array ? value : Uint8Array.from(value ?? []);
    if (!data.length || data.length > MAX_WRITE_BYTES) {
      return Promise.resolve({ error: true, msg: 'RTK base serial write size is invalid.' });
    }
    return new Promise((resolve) => {
      if (!this._port?.isOpen || connectionId !== this._connectionId) {
        resolve({ error: true, msg: 'RTK base serial connection is closed or stale.' });
        return;
      }
      this._port.write(Buffer.from(data), (error) => {
        resolve(error ? errorResult(error) : { error: false, bytesWritten: data.length });
      });
    });
  },
};

export default rtkBaseSerial;
