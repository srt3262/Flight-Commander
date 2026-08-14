'use strict';

import GUI from './../js/gui';
import ConnectionSerial from './connection/connectionSerial';
import { ConnectionType } from './connection/connection';
import CONFIGURATOR from './data_storage';
import store from './store';
import {
    CONNECTION_BAUD_PREFERENCES_KEY,
    resolveConnectionBaud,
} from './connection/connectionPreferences';

var usbDevices =  [
    { 'vendorId': 1155, 'productId': 57105}, 
    { 'vendorId': 11836, 'productId': 57105},
    { 'vendorId': 12619, 'productId': 262}, // APM32 DFU Bootloader
];


var PortHandler = new function () {
    this.initial_ports = false;
    this.port_detected_callbacks = [];
    this.port_removed_callbacks = [];
    this.dfu_available = false;
    this.polling = false;
    this.poll_timer = null;
    this.check_in_flight = false;
};

PortHandler.initialize = function () {
    if (this.polling) {
        return false;
    }
    this.polling = true;
    this.check();
    return true;
};

PortHandler.schedule_next_check = function () {
    if (!this.polling || this.poll_timer !== null) {
        return;
    }
    this.poll_timer = setTimeout(() => {
        this.poll_timer = null;
        this.check();
    }, 250);
};

PortHandler.connected_serial_port = function () {
    const connection = CONFIGURATOR.connection;
    if (
        !GUI.connected_to ||
        connection?.type !== ConnectionType.Serial ||
        !connection.connectionId
    ) {
        return null;
    }
    return String(GUI.connected_to);
};

PortHandler.with_advisory_connected_port = function (ports) {
    const currentPorts = [...ports];
    const connectedPort = this.connected_serial_port();
    if (connectedPort && currentPorts.indexOf(connectedPort) === -1) {
        currentPorts.push(connectedPort);
    }
    return currentPorts;
};

PortHandler.check = function () {
    var self = this;

    if (self.check_in_flight) {
        return false;
    }
    self.check_in_flight = true;

    Promise.resolve()
    .then(() => ConnectionSerial.getDevices())
    .then((all_ports) => {
        // filter out ports that are not serial
        let listed_ports = [];
        for (var i = 0; i < all_ports.length; i++) {
            if (all_ports[i].indexOf(':') === -1) {
                listed_ports.push(all_ports[i]);
            }
        }

        // Enumeration can briefly omit a Windows COM device even while its
        // already-open native handle remains valid.  The native close/error
        // events are authoritative for that connection; keep its option and
        // logical presence stable until the connection lifecycle closes it.
        const current_ports = self.with_advisory_connected_port(listed_ports);
        
        // port got removed or initial_ports wasn't initialized yet
        if (self.array_difference(self.initial_ports, current_ports).length > 0 || !self.initial_ports) {
            var removed_ports = self.array_difference(self.initial_ports, current_ports);

            if (self.initial_ports != false) {
                if (removed_ports.length > 1) {
                    console.log('PortHandler - Removed: ' + removed_ports);
                } else {
                    console.log('PortHandler - Removed: ' + removed_ports[0]);
                }
            }

            self.update_port_select(current_ports);
            const connectedPort = self.connected_serial_port();
            if (connectedPort) {
                $('div#port-picker #port').val(connectedPort);
            }

            // trigger callbacks (only after initialization)
            if (self.initial_ports) {
                for (var i = (self.port_removed_callbacks.length - 1); i >= 0; i--) {
                    var obj = self.port_removed_callbacks[i];

                    // remove timeout
                    clearTimeout(obj.timer);

                    // trigger callback
                    obj.code(removed_ports);

                    // remove object from array
                    var index = self.port_removed_callbacks.indexOf(obj);
                    if (index > -1) self.port_removed_callbacks.splice(index, 1);
                }
            }

            // auto-select last used port (only during initialization)
            if (!self.initial_ports) {
                const last_used_port = store.get('last_used_port', false);
                // if last_used_port was set, we try to select it
                if (last_used_port) {
                    if (last_used_port == "ble" || last_used_port == "tcp" || last_used_port == "udp" || last_used_port == "sitl" || last_used_port == "sitl-demo") {
                        $('#port').val(last_used_port);
                    } else {
                        current_ports.forEach(function(port) {
                            if (port == last_used_port) {
                                console.log('Selecting last used port: ' + last_used_port);
                                $('#port').val(last_used_port);
                            }
                        });
                    }
                } else {
                    console.log('Last used port wasn\'t saved "yet", auto-select disabled.');
                }
                
                const selectedProtocol = $('#protocol').val() || 'auto';
                $('#baud').val(resolveConnectionBaud({
                    protocol: selectedProtocol,
                    preferences: store.get(CONNECTION_BAUD_PREFERENCES_KEY, {}),
                    legacyBaud: store.get('last_used_bps', null),
                }));

                if (store.get('wireless_mode_enabled', false)) {
                    $('#wireless-mode').prop('checked', true).trigger('change');
                }

            }

            if (!self.initial_ports) {
                // initialize
                self.initial_ports = current_ports;
            } else {
                for (var i = 0; i < removed_ports.length; i++) {
                    self.initial_ports.splice(self.initial_ports.indexOf(removed_ports[i]), 1);
                }
            }
        }

        // new port detected
        var new_ports = self.array_difference(current_ports, self.initial_ports);

        if (new_ports.length) {
            if (new_ports.length > 1) {
                console.log('PortHandler - Found: ' + new_ports);
            } else {
                console.log('PortHandler - Found: ' + new_ports[0]);
            }

            self.update_port_select(current_ports);

            // select / highlight new port, if connected -> select connected port
            if (!GUI.connected_to) {
                $('div#port-picker #port').val(new_ports[0]);
            } else {
                $('div#port-picker #port').val(GUI.connected_to);
            }

            // trigger callbacks
            for (var i = (self.port_detected_callbacks.length - 1); i >= 0; i--) {
                var obj = self.port_detected_callbacks[i];

                if (
                    obj.expectedPort &&
                    new_ports.indexOf(obj.expectedPort) === -1
                ) {
                    continue;
                }

                // remove timeout
                clearTimeout(obj.timer);

                // trigger callback
                obj.code(new_ports);

                // remove object from array
                var index = self.port_detected_callbacks.indexOf(obj);
                if (index > -1) self.port_detected_callbacks.splice(index, 1);
            }

            self.initial_ports = current_ports;
        }

        self.check_usb_devices();

        GUI.updateManualPortVisibility();
    })
    .catch((error) => {
        console.log(
            'PortHandler - Unable to enumerate serial ports: ' +
            (error?.message || error),
        );
    })
    .finally(() => {
        self.check_in_flight = false;
        self.schedule_next_check();
    });

    return true;
};

PortHandler.check_usb_devices = function (callback) {
    
    self.dfu_available = false;
    
    navigator.usb.getDevices().then(devices => {
        devices.forEach(device  => {
            usbDevices.forEach(usbDev => {
                if (device.vendorId == usbDev.vendorId && device.productId == usbDev.productId) {
                    self.dfu_available = true;
                    return;
                }
            });
        });

        if (self.dfu_available) {
            if (!$("div#port-picker #port [value='DFU']").length) {
                $('div#port-picker #port').append($('<option/>', {value: "DFU", text: "DFU", data: {isDFU: true}}));
                $('div#port-picker #port').val('DFU');
            }
        } else {
            if ($("div#port-picker #port [value='DFU']").length) {
                $("div#port-picker #port [value='DFU']").remove();
            }
        }
    
        if (callback) 
            callback(self.dfu_available);
    });
}

PortHandler.update_port_select = function (ports) {
    $('div#port-picker #port').html(''); // drop previous one

    for (var i = 0; i < ports.length; i++) {
        $('div#port-picker #port').append($("<option/>", {value: ports[i], text: ports[i], data: {isManual: false}}));
    }

    $('div#port-picker #port').append($("<option/>", {value: 'manual', text: 'Manual Selection', data: {isManual: true}}));
    $('div#port-picker #port').append($("<option/>", {value: 'ble', text: 'BLE', data: {isBle: true}}));
    $('div#port-picker #port').append($("<option/>", {value: 'tcp', text: 'TCP', data: {isTcp: true}}));
    $('div#port-picker #port').append($("<option/>", {value: 'udp', text: 'UDP', data: {isUdp: true}}));
    $('div#port-picker #port').append($("<option/>", {value: 'sitl', text: 'SITL', data: {isSitl: true}}));
    $('div#port-picker #port').append($("<option/>", {value: 'sitl-demo', text: 'Demo mode', data: {isSitl: true}}));
};

PortHandler.port_detected = function(name, code, timeout, ignore_timeout, expectedPort) {
    var self = this;
    var obj = {
        'name': name,
        'code': code,
        'timeout': (timeout) ? timeout : 10000,
        'expectedPort': expectedPort ? String(expectedPort) : null,
    };

    if (!ignore_timeout) {
        obj.timer = setTimeout(function() {
            console.log('PortHandler - timeout - ' + obj.name);

            // trigger callback
            code(false);

            // remove object from array
            var index = self.port_detected_callbacks.indexOf(obj);
            if (index > -1) self.port_detected_callbacks.splice(index, 1);
        }, (timeout) ? timeout : 10000);
    } else {
        obj.timer = false;
        obj.timeout = false;
    }

    this.port_detected_callbacks.push(obj);

    return obj;
};

PortHandler.is_port_available = function (port) {
    const normalizedPort = String(port || '').trim();
    return Boolean(
        normalizedPort &&
        Array.isArray(this.initial_ports) &&
        this.initial_ports.indexOf(normalizedPort) !== -1
    );
};

PortHandler.port_detected_exact = function (name, port, code, timeout) {
    const normalizedPort = String(port || '').trim();
    if (!normalizedPort) {
        throw new Error('An exact serial port is required.');
    }
    return this.port_detected(
        name,
        code,
        timeout,
        false,
        normalizedPort,
    );
};

PortHandler.cancel_port_detected = function (obj) {
    if (!obj) {
        return false;
    }
    if (obj.timer) {
        clearTimeout(obj.timer);
    }
    const index = this.port_detected_callbacks.indexOf(obj);
    if (index === -1) {
        return false;
    }
    this.port_detected_callbacks.splice(index, 1);
    return true;
};

PortHandler.port_removed = function (name, code, timeout, ignore_timeout) {
    var self = this;
    var obj = {'name': name, 'code': code, 'timeout': (timeout) ? timeout : 10000};

    if (!ignore_timeout) {
        obj.timer = setTimeout(function () {
            console.log('PortHandler - timeout - ' + obj.name);

            // trigger callback
            code(false);

            // remove object from array
            var index = self.port_removed_callbacks.indexOf(obj);
            if (index > -1) self.port_removed_callbacks.splice(index, 1);
        }, (timeout) ? timeout : 10000);
    } else {
        obj.timer = false;
        obj.timeout = false;
    }

    this.port_removed_callbacks.push(obj);

    return obj;
};

// accepting single level array with "value" as key
PortHandler.array_difference = function (firstArray, secondArray) {
    var cloneArray = [];

    // create hardcopy
    for (var i = 0; i < firstArray.length; i++) {
        cloneArray.push(firstArray[i]);
    }

    for (var i = 0; i < secondArray.length; i++) {
        if (cloneArray.indexOf(secondArray[i]) != -1) {
            cloneArray.splice(cloneArray.indexOf(secondArray[i]), 1);
        }
    }

    return cloneArray;
};

PortHandler.flush_callbacks = function () {
    var killed = 0;

    for (var i = this.port_detected_callbacks.length - 1; i >= 0; i--) {
        if (this.port_detected_callbacks[i].timer) clearTimeout(this.port_detected_callbacks[i].timer);
        this.port_detected_callbacks.splice(i, 1);

        killed++;
    }

    for (var i = this.port_removed_callbacks.length - 1; i >= 0; i--) {
        if (this.port_removed_callbacks[i].timer) clearTimeout(this.port_removed_callbacks[i].timer);
        this.port_removed_callbacks.splice(i, 1);

        killed++;
    }

    return killed;
};

export  { usbDevices, PortHandler };
