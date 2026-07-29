'use strict'

import GUI from './../gui';
import { ConnectionType, Connection } from './connection';
import i18n from './../localization';

const serialDevices = [
    { vendorId: 1027, productId: 24577 }, // FT232R USB UART
    { vendorId: 1155, productId: 12886 }, // STM32 in HID mode
    { vendorId: 1155, productId: 14158 }, // 0483:374e STM Electronics STLink Virtual COM Port (NUCLEO boards)
    { vendorId: 1155, productId: 22336 }, // STM Electronics Virtual COM Port
    { vendorId: 4292, productId: 60000 }, // CP210x
    { vendorId: 4292, productId: 60001 }, // CP210x
    { vendorId: 4292, productId: 60002 }, // CP210x
    { vendorId: 11836, productId: 22336 }, // AT32 VCP
    { vendorId: 12619, productId: 22336 }, // APM32 VCP
];
const MAX_PENDING_IPC_EVENTS = 256;

class ConnectionSerial extends Connection {
    constructor() {
        super();
        this._errorListeners = [];
        this._onReceiveListeners = [];
        this._onErrorListener = [];
        this.ports = [];
        super._type = ConnectionType.Serial;

        this._ipcDataHandler = null;
        this._ipcCloseHandler = null;
        this._ipcErrorHandler = null;
        this._pendingIpcEvents = [];
        this._receiveReady = false;
        this._lastOpenError = '';
    }

    get lastOpenError() {
        return this._lastOpenError;
    }

    dispatchReceived(buffer) {
        this._onReceiveListeners.forEach(listener => {
            listener({
                connectionId: this._connectionId,
                data: buffer
            });
        });
    }

    queuePendingIpcEvent(type, envelope) {
        if (this._pendingIpcEvents.length >= MAX_PENDING_IPC_EVENTS) {
            this._pendingIpcEvents.shift();
        }
        this._pendingIpcEvents.push({type, envelope});
    }

    isCurrentIpcEnvelope(envelope) {
        return (
            Number.isInteger(envelope?.connectionId)
            && envelope.connectionId === this._connectionId
        );
    }

    handleSerialClose(envelope) {
        if (!this.isCurrentIpcEnvelope(envelope)) return;
        console.log("Serial connection closed");
        this.abort();
    }

    handleSerialError(envelope) {
        if (!this.isCurrentIpcEnvelope(envelope)) return;
        const error = envelope.error || 'Serial transport error';
        GUI.log($('<div>').text(error).html());
        console.log(error);
        this.abort();

        this._onReceiveErrorListeners.forEach(listener => {
            listener(error);
        });
    }

    dispatchIpcEvent(type, envelope) {
        if (!this.isCurrentIpcEnvelope(envelope)) return;
        if (type === 'data') {
            this.dispatchReceived(envelope.data);
        } else if (type === 'close') {
            this.handleSerialClose(envelope);
        } else if (type === 'error') {
            this.handleSerialError(envelope);
        }
    }

    registerIpcListeners() {
        if (this._ipcDataHandler) {
            return; // Already registered
        }

        this._ipcDataHandler = window.electronAPI.onSerialData(envelope => {
            // Windows can deliver bytes immediately after the COM handle opens,
            // before serialConnect resolves back to the renderer.  Preserve
            // those bytes until the protocol listeners have been installed by
            // the connection callback. Each event carries the main-process
            // connection ID so delayed IPC from an older COM attempt can never
            // be delivered to the new transport.
            if (!this._receiveReady) {
                this.queuePendingIpcEvent('data', envelope);
                return;
            }
            this.dispatchIpcEvent('data', envelope);
        });

        this._ipcCloseHandler = window.electronAPI.onSerialClose(envelope => {
            if (!this._receiveReady) {
                this.queuePendingIpcEvent('close', envelope);
                return;
            }
            this.dispatchIpcEvent('close', envelope);
        });

        this._ipcErrorHandler = window.electronAPI.onSerialError(envelope => {
            if (!this._receiveReady) {
                this.queuePendingIpcEvent('error', envelope);
                return;
            }
            this.dispatchIpcEvent('error', envelope);
        });
    }

    removeIpcListeners() {
        if (this._ipcDataHandler) {
            window.electronAPI.offSerialData(this._ipcDataHandler);
            this._ipcDataHandler = null;
        }
        if (this._ipcCloseHandler) {
            window.electronAPI.offSerialClose(this._ipcCloseHandler);
            this._ipcCloseHandler = null;
        }
        if (this._ipcErrorHandler) {
            window.electronAPI.offSerialError(this._ipcErrorHandler);
            this._ipcErrorHandler = null;
        }
    }

    connectImplementation(path, options, callback) {
        this._receiveReady = false;
        this._pendingIpcEvents = [];
        this._lastOpenError = '';
        this.registerIpcListeners();

        window.electronAPI.serialConnect(path, options).then(response => {
            if (!response.error) {
                GUI.log(i18n.getMessage('connectionConnected', [`${path} @ ${options.bitrate} baud`]));
                this._connectionId = response.id;
                try {
                    if (callback) {
                        callback({
                            bitrate: options.bitrate,
                            connectionId: this._connectionId
                        });
                    }
                } finally {
                    this._receiveReady = true;
                    const pending = this._pendingIpcEvents;
                    this._pendingIpcEvents = [];
                    pending.forEach(({type, envelope}) => {
                        this.dispatchIpcEvent(type, envelope);
                    });
                } 
            } else {
                this._pendingIpcEvents = [];
                this._lastOpenError = String(response.msg || 'Unknown serial error');
                console.log("Serial connection error: " + response.msg);
                if (callback) {
                    callback(false);
                }
            }
        });
    }

    disconnectImplementation(callback) {   
        this._receiveReady = false;
        this._pendingIpcEvents = [];
        if (this._connectionId) {
            window.electronAPI.serialClose(this._connectionId).then(response => {
                var ok = true;
                if (response.error) {
                    console.log("Unable to close serial: " + response.msg);
                    ok = false;
                }            
                if (callback) {
                    callback(ok);
                }
            });  
        }  
    }

    sendImplementation(data, callback) {        
        if (this._connectionId) {
            window.electronAPI.serialSend(data, this._connectionId).then(response => {
                var result = 0;
                var sent = response.bytesWritten;
                if (response.error) {
                    console.log("Serial write error: " + response.msg);
                    result = 1;
                    sent = 0;
                }
                if (callback) {
                    callback({
                        bytesSent: sent,
                        resultCode: result
                    });
                }
            });
        }
    }

    addOnReceiveCallback(callback){
        this._onReceiveListeners.push(callback);
    }

    removeOnReceiveCallback(callback){
        this._onReceiveListeners = this._onReceiveListeners.filter(listener => listener !== callback);
    }

    addOnReceiveErrorCallback(callback) {
        this._onReceiveErrorListeners.push(callback);
    }

    removeOnReceiveErrorCallback(callback) {
        this._onReceiveErrorListeners = this._onReceiveErrorListeners.filter(listener => listener !== callback);
    } 

    static async getDevices() {
        return window.electronAPI.listSerialDevices();
    }
}

export default ConnectionSerial;
