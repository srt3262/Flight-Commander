
import { SerialPort } from 'serialport';
import { SerialPortStream } from '@serialport/stream';
import { autoDetect } from '@serialport/bindings-cpp';
import {
    disposeSerialPort,
    prepareSerialPort,
    quarantineOpeningSerialPort,
    serialOpenControlLineOptions,
} from './serialControlLines';

const binding = autoDetect();
const SERIAL_OPEN_TIMEOUT_MS = 10000;
const SERIAL_ERROR_DETAIL_KEYS = [
    'code',
    'errno',
    'syscall',
    'path',
    'address',
    'disconnected',
    'canceled',
];

function describeSerialError(error) {
    if (error == null) {
        return {
            error: null,
            errorDetails: null,
        };
    }

    const message = error.message || String(error);
    const errorDetails = {
        name: error.name || 'Error',
        message,
    };
    SERIAL_ERROR_DETAIL_KEYS.forEach(key => {
        const value = error[key];
        if (
            typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
        ) {
            errorDetails[key] = value;
        }
    });

    return {
        error: message,
        errorDetails,
    };
}

const serial = {
    _serialport: null,
    _connectionId: null,
    _id: 1,
    _openGeneration: 0,

    getActivePath: function() {
        return this._serialport && this._connectionId
            ? this._serialport.path
            : null;
    },

    connect: async function(path, options, window) {
        const openGeneration = ++this._openGeneration;
        // Clean up any existing serial port to prevent handle leaks
        if (this._serialport) {
            try {
                const oldPort = this._serialport;
                this._serialport = null;
                this._connectionId = null;
                if (oldPort.opening && !oldPort.isOpen) {
                    quarantineOpeningSerialPort(oldPort);
                } else {
                    await disposeSerialPort(oldPort);
                }
                // Small delay to ensure OS releases the file handle
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                console.log('Cleanup error (ignored):', e.message);
            }
        }

        return new Promise(resolve => {
            let openPortResolved = false;
            let openTimeout = null;
            let lifecyclePhase = 'opening';
            const connectionId = this._id++;
            const finishOpen = result => {
                if (openPortResolved) return false;
                openPortResolved = true;
                clearTimeout(openTimeout);
                resolve(result);
                return true;
            };
            try {
                const port = new SerialPortStream({
                    binding,
                    path: path,
                    baudRate: options.bitrate,
                    autoOpen: true,
                    ...serialOpenControlLineOptions(options),
                });
                this._serialport = port;
                const openTimeoutMs = (
                    Number.isFinite(Number(options.openTimeoutMs))
                    && Number(options.openTimeoutMs) > 0
                    && Number(options.openTimeoutMs) <= 60000
                )
                    ? Number(options.openTimeoutMs)
                    : SERIAL_OPEN_TIMEOUT_MS;
                openTimeout = setTimeout(async () => {
                    if (openPortResolved) return;
                    openPortResolved = true;
                    if (this._serialport === port) {
                        this._serialport = null;
                    }
                    if (this._connectionId === connectionId) {
                        this._connectionId = null;
                    }
                    if (port.opening && !port.isOpen) {
                        quarantineOpeningSerialPort(port);
                    } else {
                        await disposeSerialPort(port);
                    }
                    resolve({
                        error: true,
                        msg: `Serial port open timed out after ${openTimeoutMs} ms`,
                    });
                }, openTimeoutMs);
                port.on('error', error => {
                    console.log('Serial port error:', error.message);
                    if (!window.isDestroyed()) {
                        window.webContents.send('serialError', {
                            connectionId,
                            event: 'error',
                            origin: 'native',
                            expected: false,
                            phase: lifecyclePhase,
                            ...describeSerialError(error),
                        });
                    }

                    // Clean up the serial port to prevent handle leaks
                    // This prevents "Resource temporarily unavailable Cannot lock port" errors
                    if (this._serialport === port) {
                        this._serialport = null;
                    }
                    if (this._connectionId === connectionId) {
                        this._connectionId = null;
                    }
                    port.removeAllListeners();
                    port.destroy();

                    // Fixed: Report error correctly so connection handling works properly
                    finishOpen({error: true, msg: error.message || 'Serial port error'});
                });

                port.on('close', disconnectError => {
                    if (!window.isDestroyed()) {
                        window.webContents.send('serialClose', {
                            connectionId,
                            event: 'close',
                            origin: 'native',
                            expected: false,
                            phase: lifecyclePhase,
                            ...describeSerialError(disconnectError),
                        });
                    }
                    if (this._serialport === port) {
                        this._serialport = null;
                    }
                    if (this._connectionId === connectionId) {
                        this._connectionId = null;
                    }
                    finishOpen({
                        error: true,
                        msg: 'Serial port closed before setup completed',
                    });
                });

                port.on('data', buffer => {
                    if (!window.isDestroyed()) {
                        window.webContents.send('serialData', {
                            connectionId,
                            data: buffer,
                        });
                    }
                });

                port.on('open', async () => {
                    clearTimeout(openTimeout);
                    lifecyclePhase = 'configuring-control-lines';
                    try {
                        await prepareSerialPort(port, options);
                    } catch (error) {
                        if (this._serialport === port) {
                            this._serialport = null;
                        }
                        finishOpen({
                            error: true,
                            msg: `Unable to configure serial control lines: ${error.message || error}`,
                        });
                        return;
                    }

                    if (
                        openGeneration !== this._openGeneration
                        || this._serialport !== port
                    ) {
                        await disposeSerialPort(port);
                        finishOpen({
                            error: true,
                            msg: 'Serial port open was superseded by a newer connection',
                        });
                        return;
                    }
                    if (openPortResolved) return;
                    lifecyclePhase = 'active';
                    this._connectionId = connectionId;
                    finishOpen({error: false, id: connectionId});
                });

            } catch (err) {
                finishOpen({error: true, msg: err.message || String(err)});
            }
        });
    },
    close: async function(connectionId = this._connectionId) {
        if (
            this._serialport
            && connectionId !== this._connectionId
        ) {
            return {
                error: true,
                msg: 'Stale serial connection close was rejected',
            };
        }
        this._openGeneration += 1;
        const port = this._serialport;
        this._serialport = null;
        this._connectionId = null;
        if (!port) {
            return {error: false};
        }
        try {
            await disposeSerialPort(port);
            return {error: false};
        } catch (error) {
            return {error: true, msg: error.message || String(error)};
        }
    },
    send: function(data, connectionId) {
        return new Promise(resolve => {
            if (
                this._serialport
                && this._serialport.isOpen
                && connectionId === this._connectionId
            ) {
                const port = this._serialport;
                port.write(Buffer.from(data), error => {
                    if (error) {
                        resolve({error: true, msg: `Serial write error: ${error}`});
                    } else {
                        resolve({error: false, bytesWritten: data.byteLength});
                    }
                });
            } else {
                resolve({
                    error: true,
                    msg: "Invalid, stale, or closed serial connection",
                });
            }
        });
    },
    getDeviceInfo: async function() {
        return (await SerialPort.list())
            .filter(port => (
                process.platform !== 'linux'
                || Boolean(
                    port.pnpId
                    || port.path.match(/rfcomm\d*/)
                    || port.path.match(/ttyS[0-5]$/),
                )
            ))
            .map(port => ({
                path: port.path,
                manufacturer: port.manufacturer ?? null,
                serialNumber: port.serialNumber ?? null,
                pnpId: port.pnpId ?? null,
                locationId: port.locationId ?? null,
                vendorId: port.vendorId ?? null,
                productId: port.productId ?? null,
                friendlyName: port.friendlyName ?? null,
            }));
    },

    getDevices: async function() {
        return (await this.getDeviceInfo()).map(port => port.path);
    },
};

export default serial;
