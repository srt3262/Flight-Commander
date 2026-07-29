'use strict';

import GUI from './../gui';

const ConnectionType = {
    Serial: 0,
    TCP:    1,
    UDP:    2,
    BLE:    3
}

class Connection {

    constructor() {       
        this._connectionId   = 0;
        this._openRequested  = false;
        this._openCanceled   = false;
        this._bitrate        = 0;
        this._bytesReceived  = 0;
        this._bytesSent      = 0;
        this._transmitting   = false;
        this._outputBuffer   = [];
        this._outputGeneration = 0;
        this._lifecycleGeneration = 0;
        this._onReceiveListeners      = [];
        this._onReceiveErrorListeners = [];
        this._type = null;
        
        if (this.constructor === Connection) {
            throw new TypeError("Abstract class, cannot be instanced.");
        }

        if (this.connectImplementation === Connection.prototype.connectImplementation) {
            throw new TypeError("connectImplementation is an abstract member and not implemented.")
        }

        if (this.disconnectImplementation === Connection.prototype.disconnectImplementation) {
            throw new TypeError("disconnectImplementation is an abstract member and not implemented.")
        }

        if (this.addOnReceiveCallback === Connection.prototype.addOnReceiveCallback) {
            throw new TypeError("addOnReceiveCallback is an abstract member and not implemented.")
        }

        if (this.removeOnReceiveCallback === Connection.prototype.removeOnReceiveCallback) {
            throw new TypeError("removeOnReceiveCallback is an abstract member and not implemented.")
        }

        if (this.addOnReceiveErrorCallback === Connection.prototype.addOnReceiveErrorCallback) {
            throw new TypeError("addOnReceiveErrorCallback is an abstract member and not implemented.")
        }

        if (this.removeOnReceiveErrorCallback === Connection.prototype.removeOnReceiveErrorCallback) {
            throw new TypeError("removeOnReceiveErrorCallback is an abstract member and not implemented.")
        }
    }

    get connectionId() {
        return this._connectionId;
    }

    get bitrate() {
        return this._bitrate;
    }

    get type() {
        return this._type;
    }

    connectImplementation(path, options, callback) {
        throw new TypeError("Abstract method");
    }

    connect(path, options, callback) {
        // Starting a new connection invalidates any asynchronous completion
        // which belongs to an older disconnect.  Without this guard, a slow
        // Windows close can clear the new connection ID and replay stale UI
        // cleanup after a rapid reconnect.
        this._lifecycleGeneration += 1;
        this._openRequested = true;
        this._openCanceled = false;
        this._failed = 0;
        this.connectImplementation(path, options, connectionInfo => {                   
            if (connectionInfo && !this._openCanceled) { 
                this._connectionId = connectionInfo.connectionId;
                this._bitrate = connectionInfo.bitrate;
                this._bytesReceived = 0;
                this._bytesSent = 0;    
                this._openRequested = false;
            
                this.addOnReceiveListener((info) => {
                    this._bytesReceived += info.data.byteLength;
                });

                console.log('Connection opened with ID: ' + connectionInfo.connectionId + ', Baud: ' + connectionInfo.bitrate); 

                if (callback) { 
                    callback(connectionInfo);
                }
            } else if (connectionInfo && this._openCanceled) {
                // connection opened, but this connect sequence was canceled
                // we will disconnect without triggering any callbacks
                this._connectionId = connectionInfo.connectionId;
                console.log('Connection opened with ID: ' + connectionInfo.connectionId + ', but request was canceled, disconnecting');

                // some bluetooth dongles/dongle drivers really doesn't like to be closed instantly, adding a small delay
                setTimeout(() => {
                    this._openRequested = false;
                    this._openCanceled = false;
                    this.disconnect(() => {
                        if (callback) {
                            callback(false);
                        }
                    });
                }, 150);
            } else if (this._openCanceled) {
                // connection didn't open and sequence was canceled, so we will do nothing
                console.log('Connection didn\'t open and request was canceled');
                this._openRequested = false;
                this._openCanceled = false;
                if (callback) {
                    callback(false);
                }
            } else {
                this._openRequested = false;
                console.log('Failed to open');
                if (callback) {
                    callback(false);
                }
            }
        });
    }
    
    disconnectImplementation(callback) {
        throw new TypeError("Abstract method");
    }

    disconnect(callback) {
        if (this._connectionId) {
            const lifecycleGeneration = ++this._lifecycleGeneration;
            const closingConnectionId = this._connectionId;
            const bytesSent = this._bytesSent;
            const bytesReceived = this._bytesReceived;
            this.emptyOutputBuffer();
            this.removeAllListeners();

            // Clean up IPC listeners if the subclass implements this method
            if (typeof this.removeIpcListeners === 'function') {
                this.removeIpcListeners();
            }

            this.disconnectImplementation(result => {

                if (result) {
                    console.log('Connection with ID: ' + closingConnectionId + ' closed, Sent: ' + bytesSent + ' bytes, Received: ' + bytesReceived + ' bytes');
                } else {
                    console.log('Failed to close connection with ID: ' + closingConnectionId + ' closed, Sent: ' + bytesSent + ' bytes, Received: ' + bytesReceived + ' bytes');
                }

                if (
                    lifecycleGeneration !== this._lifecycleGeneration
                    || this._connectionId !== closingConnectionId
                ) {
                    console.log('Ignored stale disconnect completion for connection ID: ' + closingConnectionId);
                    return;
                }

                this._connectionId = false;
                if (callback) {
                    callback(result);
                }
            });
        } else {
            this._lifecycleGeneration += 1;
            this._openCanceled = true;
        }
    }
    
    sendImplementation(data, callback) {
        throw new TypeError("Abstract method");
    }

    send(data, callback) {
        if (this._outputBuffer.length >= 100) {
            console.log('Send buffer full, rejected one entry');
            if (callback) {
                callback({bytesSent: 0, resultCode: 1});
            }
            return;
        }
        const entry = {
            data,
            callback,
            generation: this._outputGeneration,
        };
        this._outputBuffer.push(entry);

        const send = currentEntry => {
            if (
                currentEntry !== this._outputBuffer[0]
                || currentEntry.generation !== this._outputGeneration
            ) {
                return;
            }

            this.sendImplementation(currentEntry.data, sendInfo => {
                // Always settle the callback which belongs to the attempted
                // write, but never let a delayed callback from a detached
                // connection mutate the new connection's queue.
                if (currentEntry.callback) {
                    currentEntry.callback(sendInfo);
                }
                if (
                    currentEntry.generation !== this._outputGeneration
                    || this._outputBuffer[0] !== currentEntry
                ) {
                    return;
                }

                // track sent bytes for statistics
                this._bytesSent += sendInfo.bytesSent;

                // remove data for current transmission from the buffer
                this._outputBuffer.shift();

                // if there is any data in the queue fire send immediately, otherwise stop transmitting
                if (this._outputBuffer.length) {
                    send(this._outputBuffer[0]);
                } else {
                    this._transmitting = false;
                }
            });
        }

        if (!this._transmitting) {
            this._transmitting = true;
            send(entry);
        }
    }
    
    abort() {
        if (GUI.connected_to || GUI.connecting_to) {
            $('a.connect').trigger('click');
        } else {
            this.disconnect();
        }
    }

    addOnReceiveCallback(callback) {
        throw new TypeError("Abstract method");
    }

    removeOnReceiveCallback(callback) {
        throw new TypeError("Abstract method");
    }

    addOnReceiveListener(callback) {
        this._onReceiveListeners.push(callback);
        // Note: Don't call addOnReceiveCallback here - it would duplicate the push
    }

    addOnReceiveErrorCallback(callback) {
        throw new TypeError("Abstract method");
    }

    removeOnReceiveErrorCallback(callback) {
        throw new TypeError("Abstract method");
    }

    addOnReceiveErrorListener(callback) {
        this._onReceiveErrorListeners.push(callback);
        // Note: Don't call addOnReceiveErrorCallback here - it would duplicate the push
    }

    removeAllListeners() {
        this._onReceiveListeners.forEach(listener => this.removeOnReceiveCallback(listener));
        this._onReceiveListeners = [];

        this._onReceiveErrorListeners.forEach(listener => this.removeOnReceiveErrorCallback(listener));
        this._onReceiveErrorListeners = [];
    }

    emptyOutputBuffer() {
        this._outputGeneration += 1;
        this._outputBuffer = [];
        this._transmitting = false;
    }

    /**
     * Default timeout values
     * @returns {number} [ms]
     */
    getTimeout() {
        if (this._bitrate >= 57600) {
            return 3000;
        } if (this._bitrate >= 19200) {
            return 4000;
        } else {
            return 6000;
        }
    }
}

export  { ConnectionType, Connection};
