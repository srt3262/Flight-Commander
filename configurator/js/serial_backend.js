'use strict';

import semver from 'semver';

import GUI from './gui';
import MSP from './msp';
import FC from './fc';
import MSPCodes from './msp/MSPCodes';
import mspHelper from './msp/MSPHelper';
import { ConnectionType, Connection } from './connection/connection';
import connectionFactory from './connection/connectionFactory';
import CONFIGURATOR from './data_storage';
import  { PortHandler } from './port_handler';
import i18n from './../js/localization';
import interval from './intervals';
import periodicStatusUpdater from './periodicStatusUpdater';
import mspQueue from './serial_queue';
import timeout from './timeouts';
import defaultsDialog from './defaults_dialog';
import { SITLProcess } from './sitl';
import update from './globalUpdates';
import BitHelper from './bitHelper';
import jBox from 'jbox';
import groundstation from './groundstation';
import ltmDecoder from './ltmDecoder';
import mspDeduplicationQueue from './msp/mspDeduplicationQueue';
import store from './store';
import mavlinkSession from './mavlink/mavlinkSession';
import {
    inavMavlinkProfileStore,
    mavlinkCommandRouter,
} from './gcs/mavlinkCommandRouterInstance';
import cliTab from '../tabs/cli';
import javascriptProgrammingTab from '../tabs/javascript_programming';
import {
    CONNECTION_BAUD_PREFERENCES_KEY,
    persistProtocolBaudPreference,
    resolveConnectionBaud,
    serialOptionsForProtocol,
} from './connection/connectionPreferences';
import {
    INAV_REBOOT_RECONNECT_DELAY_MS,
    createInavRebootRecoveryAttempt,
    nextInavRebootRecoveryAttempt,
} from './connection/inavRebootRecovery';
import {
    SERIAL_STARTUP_RECOVERY_DELAY_MS,
    SERIAL_TERMINAL_OPERATOR_GUARD_MS,
    shouldAttemptMavlinkStartupRecovery,
    unexpectedSerialTerminationMessage,
} from './connection/serialRecoveryPolicy';
import {
    initializeExplicitMavlinkTransport,
    queueGroundControlActivation,
    runCriticalMavlinkTransition,
} from './gcs/mavlinkTransportStartup';
import {
    FIRMWARE_FAMILY_FLIGHT_COMMANDER,
    applyFirmwareIdentity,
    isInavCompatibleFirmwareVariant,
    probeFlightCommanderFirmware,
} from './flightCommander/firmwareIdentity';

var SerialBackend = (function () {

    const MAVLINK_WAITING_REFRESH_DELAY_MS = 12000;
    const MAVLINK_WAITING_REOPEN_SETTLE_MS = 750;

    const mavlinkWaitingTransportIsRecoverable = function (options = {}) {
        return Boolean(
            options.protocol === 'mavlink' &&
            options.activeProtocol === 'mavlink' &&
            options.connectionProtocol === 'mavlink' &&
            options.serialTransport === true &&
            options.hasPort === true &&
            options.connectionValid !== true &&
            options.vehicleConnected !== true &&
            options.refreshInProgress !== true &&
            options.disconnectInProgress !== true
        );
    };

    var publicScope = {},
        privateScope = {};
        
    privateScope.isDemoRunning = false;

    privateScope.isWirelessMode = false;

    privateScope.reopenTab = null;
    privateScope.activeProtocol = null;
    privateScope.mavlinkConnectedUnsubscribe = null;
    privateScope.mavlinkStateUnsubscribe = null;
    privateScope.mavlinkDiagnosticUnsubscribe = null;
    privateScope.cancelGroundControlActivation = null;
    privateScope.pendingOpenAttempt = null;
    privateScope.activeOpenAttempt = null;
    privateScope.activeOpenedAt = null;
    privateScope.activeMavlinkHeartbeatReceived = false;
    privateScope.unexpectedSerialRecoveryTimer = null;
    privateScope.unexpectedSerialRecoveryGeneration = 0;
    privateScope.disconnectInProgress = false;
    privateScope.pendingDisconnectFinish = null;
    privateScope.pendingReconnectRequest = null;
    privateScope.unexpectedTerminalOperatorGuardUntil = 0;
    privateScope.sitlDemoConnectTimer = null;
    privateScope.mavlinkWaitingRefreshTimer = null;
    privateScope.mavlinkWaitingRefreshGeneration = 0;
    privateScope.mavlinkWaitingRefreshInProgress = false;
    privateScope.mavlinkWaitingRefreshAttempt = 0;

    privateScope.runBestEffort = function (label, action) {
        try {
            return action();
        } catch (error) {
            console.log(
                `${label} failed during connection cleanup: ` +
                (error?.message || error),
            );
            return undefined;
        }
    };

    privateScope.cancelUnexpectedSerialRecovery = function () {
        privateScope.unexpectedSerialRecoveryGeneration += 1;
        if (privateScope.unexpectedSerialRecoveryTimer != null) {
            clearTimeout(privateScope.unexpectedSerialRecoveryTimer);
            privateScope.unexpectedSerialRecoveryTimer = null;
            return true;
        }
        return false;
    };

    privateScope.clearMavlinkWaitingRefreshTimer = function () {
        if (privateScope.mavlinkWaitingRefreshTimer == null) {
            return false;
        }
        clearTimeout(privateScope.mavlinkWaitingRefreshTimer);
        privateScope.mavlinkWaitingRefreshTimer = null;
        return true;
    };

    privateScope.cancelMavlinkWaitingRefresh = function ({
        resetAttempts = true,
    } = {}) {
        privateScope.mavlinkWaitingRefreshGeneration += 1;
        privateScope.clearMavlinkWaitingRefreshTimer();
        privateScope.mavlinkWaitingRefreshInProgress = false;
        if (resetAttempts) {
            privateScope.mavlinkWaitingRefreshAttempt = 0;
        }
    };

    privateScope.canRefreshMavlinkWaitingTransport = function () {
        return mavlinkWaitingTransportIsRecoverable({
            protocol: privateScope.activeOpenAttempt?.protocol,
            activeProtocol: privateScope.activeProtocol,
            connectionProtocol: CONFIGURATOR.connectionProtocol,
            serialTransport:
                CONFIGURATOR.connection?.type === ConnectionType.Serial,
            hasPort: Boolean(
                privateScope.activeOpenAttempt?.port && GUI.connected_to,
            ),
            connectionValid: CONFIGURATOR.connectionValid,
            vehicleConnected: mavlinkSession.state.connected,
            refreshInProgress:
                privateScope.mavlinkWaitingRefreshInProgress,
            disconnectInProgress: privateScope.disconnectInProgress,
        });
    };

    privateScope.scheduleMavlinkWaitingRefresh = function (
        delayMs = MAVLINK_WAITING_REFRESH_DELAY_MS,
    ) {
        privateScope.clearMavlinkWaitingRefreshTimer();
        if (!privateScope.canRefreshMavlinkWaitingTransport()) {
            return false;
        }
        const generation = privateScope.mavlinkWaitingRefreshGeneration;
        privateScope.mavlinkWaitingRefreshTimer = setTimeout(() => {
            privateScope.mavlinkWaitingRefreshTimer = null;
            if (
                generation !== privateScope.mavlinkWaitingRefreshGeneration
            ) {
                return;
            }
            privateScope.refreshMavlinkWaitingTransport();
        }, delayMs);
        return true;
    };

    privateScope.refreshMavlinkWaitingTransport = function () {
        if (!privateScope.canRefreshMavlinkWaitingTransport()) {
            return false;
        }

        const generation = privateScope.mavlinkWaitingRefreshGeneration;
        const openAttempt = privateScope.activeOpenAttempt;
        const connection = CONFIGURATOR.connection;
        const attempt = ++privateScope.mavlinkWaitingRefreshAttempt;
        const safePort = $('<div>').text(openAttempt.port).html();
        privateScope.mavlinkWaitingRefreshInProgress = true;
        privateScope.clearMavlinkWaitingRefreshTimer();

        GUI.log(
            `<span style="color: #d98f00">No vehicle heartbeat has arrived. ` +
            `Flight Commander is refreshing ${safePort} to re-arm the ` +
            `radio USB MAVLink bridge (attempt ${attempt}). ` +
            `The independent USB RTK base connection and survey continue.</span>`,
        );

        mavlinkSession.detach();
        connection.emptyOutputBuffer?.();

        const scheduleAnotherAttempt = () => {
            if (
                generation !== privateScope.mavlinkWaitingRefreshGeneration
            ) {
                return;
            }
            privateScope.mavlinkWaitingRefreshInProgress = false;
            privateScope.scheduleMavlinkWaitingRefresh();
        };

        const reopen = () => {
            setTimeout(() => {
                if (
                    generation !== privateScope.mavlinkWaitingRefreshGeneration ||
                    GUI.connected_to === false ||
                    privateScope.disconnectInProgress
                ) {
                    privateScope.mavlinkWaitingRefreshInProgress = false;
                    return;
                }

                connection.connect(
                    openAttempt.port,
                    serialOptionsForProtocol('mavlink', openAttempt.bitrate),
                    openInfo => {
                        if (
                            generation !== privateScope.mavlinkWaitingRefreshGeneration ||
                            GUI.connected_to === false ||
                            privateScope.disconnectInProgress
                        ) {
                            privateScope.mavlinkWaitingRefreshInProgress = false;
                            if (openInfo && connection.connectionId) {
                                connection.disconnect();
                            }
                            return;
                        }

                        privateScope.mavlinkWaitingRefreshInProgress = false;
                        if (!openInfo) {
                            GUI.log(
                                `<span style="color: #d98f00">${safePort} ` +
                                `did not reopen during MAVLink recovery; ` +
                                `Flight Commander will keep retrying.</span>`,
                            );
                            privateScope.scheduleMavlinkWaitingRefresh();
                            return;
                        }

                        privateScope.activeOpenedAt = Date.now();
                        privateScope.activeMavlinkHeartbeatReceived = false;
                        GUI.log(
                            `MAVLink radio transport refreshed on ${safePort}; ` +
                            `waiting for the aircraft heartbeat.`,
                        );
                        try {
                            privateScope.onMavlinkTransportOpen();
                            mavlinkSession.attach(connection);
                        } catch (error) {
                            privateScope.onMavlinkTransportStartupFailure(error);
                            privateScope.scheduleMavlinkWaitingRefresh();
                        }
                    },
                );
            }, MAVLINK_WAITING_REOPEN_SETTLE_MS);
        };

        try {
            if (connection.connectionId) {
                connection.disconnect(() => reopen());
            } else {
                reopen();
            }
        } catch (error) {
            GUI.log(
                `<span style="color: #d42133">Unable to refresh ${safePort}: ` +
                `${$('<div>').text(error?.message || error).html()}</span>`,
            );
            scheduleAnotherAttempt();
        }
        return true;
    };

    /*
     * Handle "Wireless" mode with strict queueing of messages
     */
    publicScope.init = function() {
        
        privateScope.$port = $('#port'),
        privateScope.$baud = $('#baud'),
        privateScope.$protocol = $('#protocol'),
        publicScope.$portOverride = $('#port-override'),
        mspHelper.setSensorStatusEx(privateScope.sensor_status_ex);

        const storedProtocol = store.get('connectionProtocolPreference', 'auto');
        const initialProtocol = ['auto', 'msp', 'mavlink'].includes(storedProtocol)
            ? storedProtocol
            : 'auto';
        privateScope.$protocol.val(initialProtocol);
        privateScope.$baud.val(resolveConnectionBaud({
            protocol: initialProtocol,
            preferences: store.get(CONNECTION_BAUD_PREFERENCES_KEY, {}),
            legacyBaud: store.get('last_used_bps', null),
        }));
        privateScope.$protocol.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();
            const protocol = privateScope.$protocol.val() || 'auto';
            store.set('connectionProtocolPreference', protocol);
            privateScope.$baud.val(resolveConnectionBaud({
                protocol,
                preferences: store.get(CONNECTION_BAUD_PREFERENCES_KEY, {}),
                legacyBaud: store.get('last_used_bps', null),
            }));
        });
        privateScope.$baud.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();
            persistProtocolBaudPreference(
                store,
                privateScope.$protocol.val() || 'auto',
                privateScope.$baud.val(),
            );
        });
        
        $('#wireless-mode').on('change', function () {
            var $this = $(this);

            if ($this.is(':checked')) {
                mspQueue.setLockMethod('hard');
            } else {
                mspQueue.setLockMethod('soft');
            }
        });

        GUI.handleReconnect = function (reopenLastTab = true) {

            const rebootOpenAttempt = createInavRebootRecoveryAttempt(
                privateScope.activeOpenAttempt,
            );

            let modal = new jBox('Modal', {
                width: 400,
                height: 120,
                animation: false,
                closeOnClick: false,
                closeOnEsc: false,
                content: '<div id="modal-reconnect"><div data-i18n="deviceRebooting">Device - <span style="color: red">Rebooting</span></div></div>'
            }).open();

            if (typeof reopenLastTab === 'boolean') {
                const $anchor = $('#tabs > ul li.active a');
                privateScope.reopenTab = reopenLastTab && $anchor.length ? $anchor : null;
            } else {
                // Callers may pass an <a> or an <li>; normalize to the <a> element
                const $el = reopenLastTab ? $(reopenLastTab) : null;
                if ($el) {
                    const anchor = $el.is('a') ? $el : $('a', $el);
                    privateScope.reopenTab = anchor.length ? anchor : null;
                } else {
                    privateScope.reopenTab = null;
                }
            }

            /*
            Disconnect
            */
            setTimeout(function () {
                privateScope.reConnect();
            }, 100);

            /*
            Connect again
            */
            setTimeout(function start_connection() {
                modal.close();
                privateScope.reConnect(
                    rebootOpenAttempt ? {openAttempt: rebootOpenAttempt} : {},
                );
            }, INAV_REBOOT_RECONNECT_DELAY_MS);
        };

    
        GUI.updateManualPortVisibility = function(){
            var selected_port = privateScope.$port.find('option:selected');
            if (selected_port.data().isManual || selected_port.data().isTcp || selected_port.data().isUdp) {
                $('#port-override-option').show();
            }
            else {
                $('#port-override-option').hide();
            }

            if (selected_port.data().isTcp || selected_port.data().isUdp) {
                $('#port-override-label').text("IP:Port");
            } else {
                $('#port-override-label').text("Port");
            }

            if (selected_port.data().isDFU || selected_port.data().isBle || selected_port.data().isTcp || selected_port.data().isUdp || selected_port.data().isSitl) {
                privateScope.$baud.hide();
            }
            else {
                privateScope.$baud.show();
            }        

            if (selected_port.data().isBle || selected_port.data().isTcp || selected_port.data().isUdp || selected_port.data().isSitl) {
                $('.tab_firmware_flasher').hide();
            } else {
                $('.tab_firmware_flasher').show();
            }
            var type = ConnectionType.Serial;
            if (selected_port.data().isBle) {
                type = ConnectionType.BLE;
            } else if (selected_port.data().isTcp || selected_port.data().isSitl) {
                type = ConnectionType.TCP;
            } else if (selected_port.data().isUdp) {
                type = ConnectionType.UDP;
            } 
            CONFIGURATOR.connection = connectionFactory(type, CONFIGURATOR.connection);
            
        };

        GUI.updateManualPortVisibility();
        GUI.handleConnectionAbort = function () {
            privateScope.reConnect({forceDisconnect: true});
        };

        publicScope.$portOverride.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();
            store.set('portOverride', publicScope.$portOverride.val());
        });
        
        publicScope.$portOverride.val(store.get('portOverride', ''));        

        privateScope.$port.on('change', function (target) {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();
            GUI.updateManualPortVisibility();
        });

    $('div.connect_controls a.connect').on('click', () => {
        privateScope.reopenTab = null;
        privateScope.reConnect({operatorClick: true});
    });
    
    privateScope.reConnect = function(options = {}) {
        const forceDisconnect = options.forceDisconnect === true;
        if (privateScope.disconnectInProgress) {
            if (forceDisconnect) {
                privateScope.pendingDisconnectFinish?.();
            } else {
                privateScope.pendingReconnectRequest = options.openAttempt
                    ? {openAttempt: options.openAttempt}
                    : {};
            }
            return;
        }
        if (
            options.operatorClick === true
            && GUI.connected_to === false
            && GUI.connecting_to === false
            && Date.now() < privateScope.unexpectedTerminalOperatorGuardUntil
        ) {
            privateScope.unexpectedTerminalOperatorGuardUntil = 0;
            privateScope.cancelUnexpectedSerialRecovery();
            return;
        }

        privateScope.runBestEffort('Ground-station deactivation', () => {
            if (groundstation.isActivated()) {
                groundstation.deactivate();
            }
        });

        if (GUI.connect_lock != true || forceDisconnect) {

                // Use the real connection state, not a toggle flag that competing
                // async aborts could desync.
                const isIdle = (GUI.connected_to === false) && (GUI.connecting_to === false);
                const requestedAttempt = options.openAttempt || null;
                if (isIdle && !requestedAttempt) {
                    privateScope.cancelUnexpectedSerialRecovery();
                    privateScope.cancelMavlinkWaitingRefresh();
                }
                var selected_baud = isIdle
                    ? requestedAttempt?.bitrate ?? parseInt(privateScope.$baud.val())
                    : 0;
                const requestedProtocol = isIdle
                    ? requestedAttempt?.protocol ||
                        privateScope.$protocol.val() ||
                        'auto'
                    : privateScope.activeOpenAttempt?.protocol || 'auto';
                var selected_port = isIdle
                    ? requestedAttempt?.port || (
                        privateScope.$port.find('option:selected').data().isManual ?
                            publicScope.$portOverride.val() :
                                String(privateScope.$port.val())
                    )
                    : String(GUI.connected_to || GUI.connecting_to || '');
                const openAttempt = Object.freeze({
                    protocol: requestedProtocol,
                    port: selected_port,
                    bitrate: selected_baud,
                    recoveryAttempt: requestedAttempt?.recoveryAttempt || 0,
                    ...(requestedAttempt?.rebootRecoveryAttempt > 0
                        ? {
                            rebootRecoveryAttempt:
                                requestedAttempt.rebootRecoveryAttempt,
                        }
                        : {}),
                });
                const handleOpen = openInfo => privateScope.onOpen(openInfo, openAttempt);
                
                if (isIdle && selected_port === 'DFU') {
                    GUI.log(i18n.getMessage('dfu_connect_message'));
                }
                else if (!isIdle || selected_port != '0') {
                    if (isIdle) {
                        if (privateScope.sitlDemoConnectTimer != null) {
                            clearTimeout(privateScope.sitlDemoConnectTimer);
                            privateScope.sitlDemoConnectTimer = null;
                        }
                        console.log('Connecting to: ' + selected_port);
                        GUI.connecting_to = selected_port;
                        privateScope.pendingOpenAttempt = openAttempt;

                        // Clear leftover MSP state so a fast reconnect isn't
                        // blocked by a previous session's retrying requests.
                        mspQueue.flush();
                        mspQueue.freeHardLock();
                        mspQueue.freeSoftLock();
                        mspDeduplicationQueue.flush();
                        MSP.disconnect_cleanup();
                        ltmDecoder.reset();

                        // lock port select & baud while we are connecting / connected
                        $('#port, #baud, #protocol, #delay').prop('disabled', true);
                        $('div.connect_controls a.connect_state').text(i18n.getMessage('connecting'));

                        if (selected_port == 'tcp' || selected_port == 'udp') {
                            CONFIGURATOR.connection.connect(publicScope.$portOverride.val(), {}, handleOpen);
                        } else if (selected_port == 'sitl') {
                            CONFIGURATOR.connection.connect("127.0.0.1:5760", {}, handleOpen);
                        } else if (selected_port == 'sitl-demo') {
                            SITLProcess.stop();
                            SITLProcess.start("demo.bin");                        
                            this.isDemoRunning = true;

                            // Wait 1 sec until SITL is ready
                            privateScope.sitlDemoConnectTimer = setTimeout(() => {
                                privateScope.sitlDemoConnectTimer = null;
                                if (
                                    privateScope.pendingOpenAttempt !== openAttempt ||
                                    GUI.connecting_to !== selected_port
                                ) {
                                    return;
                                }
                                CONFIGURATOR.connection.connect("127.0.0.1:5760", {}, handleOpen);
                            }, 1000);
                        } else {
                            CONFIGURATOR.connection.connect(
                                selected_port,
                                serialOptionsForProtocol(requestedProtocol, selected_baud),
                                handleOpen,
                            );
                        }
                    } else {
                        // Check for unsaved changes in JavaScript Programming tab
                        if (!forceDisconnect &&
                            GUI.active_tab === javascriptProgrammingTab &&
                            javascriptProgrammingTab.isDirty) {
                            console.log('[Disconnect] Checking for unsaved changes in JavaScript Programming tab');
                            const confirmMsg = i18n.getMessage('unsavedChanges') ||
                                'You have unsaved changes. Leave anyway?';

                            if (!confirm(confirmMsg)) {
                                console.log('[Disconnect] User cancelled disconnect due to unsaved changes');
                                return; // Cancel disconnect
                            }
                            console.log('[Disconnect] User confirmed, proceeding with disconnect');
                            // Clear isDirty flag so tab switch during disconnect doesn't show warning again
                            javascriptProgrammingTab.isDirty = false;
                        }

                        privateScope.cancelMavlinkWaitingRefresh();
                        privateScope.disconnectInProgress = true;
                        const operatorRequested = !forceDisconnect;

                        if (this.isDemoRunning) {
                            privateScope.runBestEffort(
                                'SITL shutdown',
                                () => SITLProcess.stop(),
                            );
                            this.isDemoRunning = false;
                        }

                        var wasConnected = CONFIGURATOR.connectionValid;

                        privateScope.runBestEffort('Connection timers', () => {
                            timeout.killAll();
                            interval.killAll([
                                'global_data_refresh',
                                'msp-load-update',
                            ]);
                        });

                        let disconnectFinished = false;
                        privateScope.pendingDisconnectFinish = finishDisconnect;
                        if (CONFIGURATOR.cliActive && !forceDisconnect) {
                            try {
                                GUI.tab_switch_cleanup(finishDisconnect);
                            } catch (error) {
                                console.log(
                                    'CLI tab cleanup failed during disconnect: ' +
                                    (error?.message || error),
                                );
                                finishDisconnect();
                            }
                        } else {
                            privateScope.runBestEffort(
                                'Active tab',
                                () => GUI.tab_switch_cleanup(),
                            );
                            finishDisconnect();
                        }

                        function finishDisconnect() {
                            if (disconnectFinished) return;
                            disconnectFinished = true;
                            privateScope.pendingDisconnectFinish = null;

                            const disconnectCause =
                                CONFIGURATOR.connection.consumeDisconnectCause?.() || null;
                            const disconnectedAttempt = privateScope.activeOpenAttempt;
                            const connectedDurationMs = (
                                Number.isFinite(privateScope.activeOpenedAt)
                            )
                                ? Date.now() - privateScope.activeOpenedAt
                                : null;
                            const closeContext = Object.freeze({
                                cause: disconnectCause,
                                openAttempt: disconnectedAttempt,
                                connectedDurationMs,
                                port: GUI.connected_to || disconnectedAttempt?.port || null,
                                hadVehicleHeartbeat:
                                    privateScope.activeMavlinkHeartbeatReceived,
                                operatorRequested,
                            });

                            GUI.tab_switch_in_progress = false;
                            CONFIGURATOR.connectionValid = false;
                            CONFIGURATOR.connectionProtocol = null;
                            GUI.connected_to = false;
                            GUI.connecting_to = false;
                            if (privateScope.sitlDemoConnectTimer != null) {
                                clearTimeout(privateScope.sitlDemoConnectTimer);
                                privateScope.sitlDemoConnectTimer = null;
                            }
                            privateScope.pendingOpenAttempt = null;
                            privateScope.activeOpenAttempt = null;
                            privateScope.activeOpenedAt = null;
                            privateScope.activeMavlinkHeartbeatReceived = false;

                            const handleClosed = result => {
                                const reconnectRequest =
                                    privateScope.pendingReconnectRequest;
                                privateScope.pendingReconnectRequest = null;
                                privateScope.disconnectInProgress = false;
                                privateScope.pendingDisconnectFinish = null;
                                try {
                                    privateScope.onClosed(result, closeContext);
                                } catch (error) {
                                    console.log(
                                        'Serial close status rendering failed: ' +
                                        (error?.message || error),
                                    );
                                }
                                if (reconnectRequest) {
                                    privateScope.reConnect(reconnectRequest);
                                }
                            };
                            try {
                                if (CONFIGURATOR.connection.connectionId) {
                                    CONFIGURATOR.connection.disconnect(handleClosed);
                                } else {
                                    CONFIGURATOR.connection.disconnect();
                                    handleClosed(true);
                                }
                            } catch (error) {
                                console.log(
                                    'Serial disconnect failed synchronously: ' +
                                    (error?.message || error),
                                );
                                handleClosed(false);
                            }

                            privateScope.runBestEffort(
                                'Protocol session',
                                () => privateScope.clearProtocolSession({
                                    preserveStatusMessage: Boolean(
                                        disconnectCause && !operatorRequested
                                    ),
                                }),
                            );
                            privateScope.runBestEffort('Allowed tabs', () => {
                                GUI.allowedTabs =
                                    GUI.defaultAllowedTabsWhenDisconnected.slice();
                            });
                            privateScope.runBestEffort('MSP queue', () => {
                                mspQueue.flush();
                                mspQueue.freeHardLock();
                                mspQueue.freeSoftLock();
                                mspDeduplicationQueue.flush();
                                MSP.disconnect_cleanup();
                            });
                            privateScope.runBestEffort('Status fields', () => {
                                $('span.i2c-error').text(0);
                                $('span.cycle-time').text(0);
                                $('span.cpu-load').text('');
                            });
                            privateScope.runBestEffort('Connection controls', () => {
                                privateScope.$port.prop('disabled', false);
                                privateScope.$baud.prop('disabled', false);
                                privateScope.$protocol.prop('disabled', false);
                                $('div.connect_controls a.connect').removeClass('active');
                                $('div.connect_controls a.connect_state')
                                    .text(i18n.getMessage('connect'));
                            });
                            privateScope.runBestEffort(
                                'Sensor status',
                                () => privateScope.sensor_status(0),
                            );
                            if (wasConnected) {
                                privateScope.runBestEffort(
                                    'Connected tab content',
                                    () => $('#content').empty(),
                                );
                            }
                            privateScope.runBestEffort(
                                'Landing tab',
                                () => $('#tabs .tab_landing a').trigger('click'),
                            );
                        }
                    }
                }
            }
        }

        PortHandler.initialize();
    }

    privateScope.onValidFirmware = function ()
    {
    if (!privateScope.selectProtocol('msp')) {
        return;
    }
    privateScope.rememberValidatedBaud();
    MSP.send_message(MSPCodes.MSP_BUILD_INFO, false, false, function () {

        GUI.log(i18n.getMessage('buildInfoReceived', [FC.CONFIG.buildInfo]));

        MSP.send_message(MSPCodes.MSP_BOARD_INFO, false, false, function () {

            GUI.log(i18n.getMessage('boardInfoReceived', [FC.CONFIG.boardIdentifier, FC.CONFIG.boardVersion]));

            MSP.send_message(MSPCodes.MSP_UID, false, false, function () {

                GUI.log(i18n.getMessage('uniqueDeviceIdReceived', [FC.CONFIG.uid[0].toString(16) + FC.CONFIG.uid[1].toString(16) + FC.CONFIG.uid[2].toString(16)]));

                // continue as usually
                CONFIGURATOR.connectionValid = true;
                GUI.allowedTabs = GUI.defaultAllowedTabsWhenConnected.slice();
                $('body')
                    .addClass('fc-firmware-flight-commander')
                    .removeClass('fc-firmware-unsupported fc-controller-unsupported');
                privateScope.onConnect();

                defaultsDialog.init().then( () => {

                    if (privateScope.reopenTab) {
                        privateScope.reopenTab.trigger('click');
                    } else {
                        $('#tabs ul.mode-connected .tab_flight_data a').trigger('click');
                    }
                    
                    update.firmwareVersion();
                });
            });
        });
    });
}

    privateScope.retryInavRebootConnection = function (openAttempt) {
        const nextAttempt = nextInavRebootRecoveryAttempt(openAttempt);
        if (nextAttempt) {
            const safePort = $('<div>').text(nextAttempt.port).html();
            GUI.log(
                `<span style="color: #d98f00">Flight Commander Firmware is not responding after reboot. ` +
                `Flight Commander will close and reopen ${safePort} ` +
                `(attempt ${nextAttempt.rebootRecoveryAttempt} of 3).</span>`,
            );
            privateScope.pendingReconnectRequest = {openAttempt: nextAttempt};
        } else {
            GUI.log(
                '<span style="color: red">Flight Commander Firmware did not respond after three post-reboot ' +
                'connection attempts. The serial port has been closed; reconnect manually ' +
                'after checking the USB connection.</span>',
            );
        }
        privateScope.reConnect({forceDisconnect: true});
    };

    privateScope.onInvalidFirmwareVariant = function ()
    {
        if (!privateScope.selectProtocol('msp')) {
            return;
        }
        GUI.log(
            '<span style="color: red">Unsupported controller firmware detected. ' +
            'Only Flight Commander Firmware with a valid FCFW identity is supported. ' +
            'CLI recovery remains available so the controller can be reflashed.</span>',
        );
        CONFIGURATOR.connectionValid = true;
        GUI.allowedTabs = ['cli'];
        privateScope.onConnect();
        $('#tabs .tab_cli a').trigger('click');
    }

    privateScope.onInvalidFirmwareVersion = function ()
    {
        if (!privateScope.selectProtocol('msp')) {
            return;
        }
        GUI.log(i18n.getMessage('firmwareVersionNotSupported', [CONFIGURATOR.minfirmwareVersionAccepted, CONFIGURATOR.maxFirmwareVersionAccepted]));
        CONFIGURATOR.connectionValid = true; // making it possible to open the CLI tab
        GUI.allowedTabs = ['cli'];
        privateScope.onConnect();
        $('#tabs .tab_cli a').trigger( "click" );
    }

    privateScope.onBleNotSupported = function () {
        GUI.log(i18n.getMessage('connectionBleNotSupported'));
        CONFIGURATOR.connection.abort();
    }


    privateScope.onOpen = function (openInfo, openAttempt = null) {

        if (openAttempt && openAttempt !== privateScope.pendingOpenAttempt) {
            console.log('Ignored stale serial open callback.');
            return;
        }

        if (FC.restartRequired) {
            GUI.log("<span style='color: red; font-weight: bolder'><strong>" + i18n.getMessage("illegalStateRestartRequired") + "</strong></span>");
            $('div.connect_controls a').trigger( "click" ); // disconnect
            return;
        }

        if (openInfo) {
            const requestedProtocol =
                openAttempt?.protocol || privateScope.$protocol.val() || 'auto';
            privateScope.activeOpenAttempt = openAttempt || {
                protocol: requestedProtocol,
                port: GUI.connecting_to,
                bitrate: openInfo.bitrate,
                recoveryAttempt: 0,
            };
            privateScope.activeOpenedAt = Date.now();
            privateScope.activeMavlinkHeartbeatReceived = false;
            privateScope.unexpectedTerminalOperatorGuardUntil = 0;
            privateScope.pendingOpenAttempt = null;

            // update connected_to
            GUI.connected_to = GUI.connecting_to;

            // reset connecting_to
            GUI.connecting_to = false;

            GUI.log(
                `Serial transport opened with ID ${openInfo.connectionId}` +
                ` (${GUI.connected_to} @ ${openInfo.bitrate} baud).`,
            );

            // save selected port if the port differs
            var last_used_port = store.get('last_used_port', false);
            if (last_used_port) {
                if (last_used_port != GUI.connected_to) {
                    // last used port doesn't match the one found in local db, we will store the new one
                    store.set('last_used_port', GUI.connected_to);
                }
            } else {
                // variable isn't stored yet, saving
                store.set('last_used_port', GUI.connected_to);
            }
        

            store.set('wireless_mode_enabled', $('#wireless-mode').is(":checked"));

            privateScope.activeProtocol = null;
            CONFIGURATOR.connectionProtocol = null;
            try {
                mavlinkCommandRouter.stop();
                mavlinkCommandRouter.clearCommandBlock();
                FC.resetState();
                MSP.disconnect_cleanup();
            } catch (error) {
                if (requestedProtocol === 'mavlink') {
                    privateScope.onMavlinkTransportStartupFailure(error);
                    return;
                }
                throw error;
            }

            const allowMsp = requestedProtocol !== 'mavlink';
            const allowMavlink = requestedProtocol !== 'msp';
            let connectingTimeoutInstalled = false;
            const scheduleConnectingTimeout = function () {
                if (connectingTimeoutInstalled) return;
                connectingTimeoutInstalled = true;
                timeout.add('connecting', function () {
                    if (
                        !CONFIGURATOR.connectionValid &&
                        openAttempt?.rebootRecoveryAttempt > 0
                    ) {
                        privateScope.retryInavRebootConnection(openAttempt);
                        return;
                    }
                    if (
                        !CONFIGURATOR.connectionValid &&
                        !ltmDecoder.isReceiving() &&
                        !mavlinkSession.state.connected
                    ) {
                        if (requestedProtocol === 'mavlink') {
                            const message =
                                'The MAVLink serial transport is open, but no vehicle heartbeat was received. ' +
                                'Flight Commander will keep listening and periodically refresh only the selected ' +
                                'radio COM port; verify the aircraft/radio link and use 460800 baud for ExpressLRS USB MAVLink. ' +
                                'Any independent USB RTK base survey remains connected.';
                            GUI.mavlinkWaitingMessage = message;
                            GUI.log(`<span style="color: #d98f00">${message}</span>`);
                            $('#logo .firmware_version').text('MAVLink / Waiting for vehicle heartbeat');
                            $('#flightDataActionStatus')
                                .text(message)
                                .addClass('fc-action-status--error');
                            privateScope.requestGroundControlOpen();
                            return;
                        }
                        GUI.log(i18n.getMessage('noConfigurationReceived'));

                        mspQueue.flush();
                        mspQueue.freeHardLock();
                        mspQueue.freeSoftLock();
                        mspDeduplicationQueue.flush();
                        CONFIGURATOR.connection.emptyOutputBuffer();

                        $('div.connect_controls a').click(); // disconnect
                    }
                }, 10000);
            };

            if (allowMsp) {
                CONFIGURATOR.connection.addOnReceiveListener(publicScope.read_serial);
            }
            if (allowMavlink) {
                privateScope.mavlinkConnectedUnsubscribe = mavlinkSession.on('connected', function (state) {
                    runCriticalMavlinkTransition({
                        transition: () => privateScope.onMavlinkConnected(state),
                        onFailure: error => (
                            privateScope.onMavlinkConnectedTransitionFailure(error)
                        ),
                    });
                });
                privateScope.mavlinkDiagnosticUnsubscribe =
                    mavlinkSession.on('transportDiagnostic', privateScope.onMavlinkTransportDiagnostic);
                if (requestedProtocol === 'mavlink') {
                    const startup = initializeExplicitMavlinkTransport({
                        showWaitingState: privateScope.onMavlinkTransportOpen,
                        scheduleNoHeartbeatTimeout: scheduleConnectingTimeout,
                        attachSession: () => mavlinkSession.attach(CONFIGURATOR.connection),
                        onFailure: privateScope.onMavlinkTransportStartupFailure,
                    });
                    if (!startup.ok) return;
                } else {
                    try {
                        mavlinkSession.attach(CONFIGURATOR.connection);
                    } catch (error) {
                        privateScope.onMavlinkAutoAttachFailure(error);
                    }
                }
            }

            scheduleConnectingTimeout();


            // request configuration data. Start with MSPv1 and
            // upgrade to MSPv2 if possible.
            if (allowMsp) {
                MSP.protocolVersion = MSP.constants.PROTOCOL_V2;
                MSP.send_message(MSPCodes.MSP_API_VERSION, false, false, function () {
                
                if (FC.CONFIG.apiVersion === "0.0.0") {
                    GUI.log("<span style='color: red; font-weight: bolder'><strong>" + i18n.getMessage("illegalStateRestartRequired") + "</strong></span>");
                    FC.restartRequired = true;
                    return;
                }

                GUI.log(i18n.getMessage('apiVersionReceived', [FC.CONFIG.apiVersion]));

                MSP.send_message(MSPCodes.MSP_FC_VARIANT, false, false, function () {
                    const reportedVariant = FC.CONFIG.flightControllerIdentifier;
                    if (isInavCompatibleFirmwareVariant(reportedVariant)) {
                        MSP.send_message(MSPCodes.MSP_FC_VERSION, false, false, function () {
                            const reportedVersion = FC.CONFIG.flightControllerVersion;
                            GUI.log(i18n.getMessage('fcInfoReceived', [reportedVariant, reportedVersion]));
                            probeFlightCommanderFirmware({
                                MSP,
                                MSPCodes,
                                compatibleInavVersion: reportedVariant === 'INAV'
                                    ? reportedVersion
                                    : '0.0.0',
                            }).then(function(identity) {
                                if (
                                    (
                                        identity.family !== FIRMWARE_FAMILY_FLIGHT_COMMANDER
                                        || identity.protocolSupported !== true
                                    )
                                ) {
                                    GUI.log(
                                        '<span style="color: #d98f00">The controller did not provide a supported Flight Commander FCFW identity. Only Flight Commander Firmware is supported.</span>',
                                    );
                                    privateScope.onInvalidFirmwareVariant();
                                    return;
                                }

                                applyFirmwareIdentity(FC, identity);
                                const compatibilityVersion = FC.CONFIG.flightControllerVersion;
                                if (
                                    !semver.gte(compatibilityVersion, CONFIGURATOR.minfirmwareVersionAccepted)
                                    || !semver.lt(compatibilityVersion, CONFIGURATOR.maxFirmwareVersionAccepted)
                                ) {
                                    privateScope.onInvalidFirmwareVersion();
                                    return;
                                }
                                if (
                                    CONFIGURATOR.connection.type === ConnectionType.BLE
                                    && semver.lt(compatibilityVersion, '5.0.0')
                                ) {
                                    privateScope.onBleNotSupported();
                                    return;
                                }
                                GUI.log(
                                    `Flight Commander Firmware ${identity.firmwareVersion ?? 'unknown'} ` +
                                    `(protocol baseline ${identity.compatibleInavVersion}, ` +
                                    `capabilities 0x${identity.capabilities.toString(16).padStart(8, '0')}).`,
                                );
                                mspHelper.getCraftName(function(name) {
                                    if (name) {
                                        FC.CONFIG.name = name;
                                    }
                                    privateScope.onValidFirmware();
                                });
                            });
                        });
                    } else {
                        privateScope.onInvalidFirmwareVariant();
                    }
                });
                });
            }
        } else {
            privateScope.pendingOpenAttempt = null;
            privateScope.activeOpenAttempt = null;
            privateScope.activeOpenedAt = null;
            privateScope.activeMavlinkHeartbeatReceived = false;
            console.log('Failed to open serial port');
            const openError = CONFIGURATOR.connection?.lastOpenError;
            const safeOpenError = openError ? $('<div>').text(openError).html() : '';
            GUI.log(
                i18n.getMessage('serialPortOpenFail')
                + (safeOpenError ? `: ${safeOpenError}` : ''),
            );

            // Clear connecting state so the button reflects "disconnected".
            GUI.connecting_to = false;
            GUI.connected_to = false;

            var $connectButton = $('#connectbutton');

            $connectButton.find('.connect_state').text(i18n.getMessage('connect'));
            $connectButton.find('.connect').removeClass('active');

            // unlock port select & baud
            $('#port, #baud, #protocol, #delay').prop('disabled', false);
        }
    }

    privateScope.selectProtocol = function (protocol) {
        if (privateScope.activeProtocol && privateScope.activeProtocol !== protocol) {
            return false;
        }
        if (privateScope.activeProtocol === protocol) {
            return true;
        }

        privateScope.activeProtocol = protocol;
        CONFIGURATOR.connectionProtocol = protocol;

        if (protocol === 'msp') {
            mavlinkSession.detach();
            CONFIGURATOR.connection.removeOnReceiveCallback(ltmDecoder.read);
            interval.remove('ltm-connection-check');
        } else if (protocol === 'mavlink') {
            CONFIGURATOR.connection.removeOnReceiveCallback(publicScope.read_serial);
            CONFIGURATOR.connection.removeOnReceiveCallback(ltmDecoder.read);
            mspQueue.flush();
            mspQueue.freeHardLock();
            mspQueue.freeSoftLock();
            mspDeduplicationQueue.flush();
            MSP.disconnect_cleanup();
            interval.remove('ltm-connection-check');
        } else if (protocol === 'ltm') {
            mavlinkSession.detach();
            CONFIGURATOR.connection.removeOnReceiveCallback(publicScope.read_serial);
            mspQueue.flush();
            mspQueue.freeHardLock();
            mspQueue.freeSoftLock();
            mspDeduplicationQueue.flush();
            MSP.disconnect_cleanup();
            interval.remove('ltm-connection-check');
        }
        return true;
    };

    privateScope.onMavlinkConnected = function (state) {
        if (!privateScope.selectProtocol('mavlink')) {
            return;
        }
        privateScope.activeMavlinkHeartbeatReceived = true;
        privateScope.cancelUnexpectedSerialRecovery();
        privateScope.cancelMavlinkWaitingRefresh();
        GUI.mavlinkWaitingMessage = null;
        privateScope.rememberValidatedBaud();
        CONFIGURATOR.connectionValid = true;
        GUI.allowedTabs = GUI.defaultAllowedTabsWhenMavlinkConnected.slice();
        timeout.remove('connecting');
        GUI.log(`MAVLink vehicle connected: ${state.vehicleTypeName} (system ${state.systemId})`);
        privateScope.onMavlinkConnect(state);
    };

    privateScope.onMavlinkTransportDiagnostic = function (diagnostic) {
        switch (diagnostic?.stage) {
            case 'discovery-heartbeat-write-accepted':
                GUI.log(
                    `MAVLink v${diagnostic.version} discovery heartbeat write ` +
                    `accepted by the serial driver (${diagnostic.bytesSent} bytes).`,
                );
                break;
            case 'discovery-heartbeat-failed':
                GUI.log(
                    `<span style="color: #d42133">MAVLink v${diagnostic.version} ` +
                    `discovery write failed: ${$('<div>').text(diagnostic.error).html()}</span>`,
                );
                break;
            case 'serial-bytes-received':
                GUI.log(
                    `MAVLink serial data received (${diagnostic.byteLength} bytes); ` +
                    'waiting for a complete valid frame.',
                );
                break;
            case 'valid-frame-decoded':
                GUI.log(
                    `Valid ${diagnostic.protocol || 'MAVLink'} ` +
                    `${diagnostic.messageName} frame decoded.`,
                );
                break;
            case 'vehicle-heartbeat-timeout': {
                const serialAge = diagnostic.millisecondsSinceSerialByte;
                const frameAge = diagnostic.millisecondsSinceValidFrame;
                const serialStatus = serialAge == null
                    ? 'no inbound serial bytes were received'
                    : serialAge <= 1500
                        ? `inbound serial bytes are still arriving (${serialAge} ms ago)`
                        : `last inbound serial bytes arrived ${serialAge} ms ago`;
                const frameStatus = frameAge == null
                    ? 'no valid MAVLink frame was decoded'
                    : frameAge <= 1500
                        ? `valid frames are still decoding (${frameAge} ms ago)`
                        : `last valid frame decoded ${frameAge} ms ago`;
                const lastMessage = $('<div>')
                    .text(diagnostic.lastMessageName || 'none')
                    .html();
                GUI.log(
                    `<span style="color: #d98f00">Vehicle heartbeat timed out ` +
                    `after ${diagnostic.millisecondsSinceHeartbeat} ms; ${serialStatus}; ` +
                    `${frameStatus}; ${diagnostic.receivedByteCount} inbound bytes, ` +
                    `${diagnostic.decodedFrameCount} decoded frames, last message ` +
                    `${lastMessage}.</span>`,
                );
                break;
            }
            case 'vehicle-heartbeat-restored':
                GUI.log(
                    `MAVLink vehicle heartbeat restored after link loss ` +
                    `(${diagnostic.receivedByteCount} inbound bytes, ` +
                    `${diagnostic.decodedFrameCount} decoded frames).`,
                );
                break;
            default:
                break;
        }
    };

    privateScope.onMavlinkTransportStartupFailure = function (error) {
        const detail = error?.message || String(error);
        const message = `MAVLink transport startup failed: ${detail}`;
        mavlinkSession.detach();
        mavlinkCommandRouter.blockCommands(message);
        timeout.remove('connecting');
        GUI.mavlinkWaitingMessage = message;
        GUI.log(
            `<span style="color: #d42133">${$('<div>').text(message).html()}</span>`,
        );
        $('#logo .firmware_version').text('MAVLink / Transport startup failed');
        $('#flightDataActionStatus')
            .text(message)
            .addClass('fc-action-status--error');
    };

    privateScope.onMavlinkConnectedTransitionFailure = function (error) {
        const detail = error?.message || String(error);
        const message =
            `A vehicle heartbeat was decoded, but Ground Control could not finish connecting: ${detail}`;
        CONFIGURATOR.connectionValid = false;
        mavlinkCommandRouter.blockCommands(message);
        GUI.allowedTabs = ['flight_data', 'landing', 'help'];
        privateScope.cancelGroundControlActivation?.();
        privateScope.cancelGroundControlActivation = null;
        GUI.mavlinkWaitingMessage = message;
        timeout.remove('connecting');
        GUI.log(
            `<span style="color: #d42133">${$('<div>').text(message).html()}</span>`,
        );
        $('#logo .firmware_version').text('MAVLink / Ground Control startup failed');
        $('#flightDataActionStatus')
            .text(message)
            .addClass('fc-action-status--error');
        $('#flightDataMode, #flightDataSetMode, #flightDataArm, ' +
          '#flightDataStartMission, #flightDataTakeoff, #flightDataRtl, ' +
          '#flightDataLand, #flightDataResumeMission, #flightDataConfirmSingleInav')
            .prop('disabled', true);
    };

    privateScope.onMavlinkAutoAttachFailure = function (error) {
        mavlinkSession.detach();
        privateScope.mavlinkConnectedUnsubscribe?.();
        privateScope.mavlinkConnectedUnsubscribe = null;
        privateScope.mavlinkDiagnosticUnsubscribe?.();
        privateScope.mavlinkDiagnosticUnsubscribe = null;
        const detail = $('<div>').text(error?.message || String(error)).html();
        GUI.log(
            `<span style="color: #d98f00">MAVLink auto-detection could not start ` +
            `(${detail}); MSP detection remains active.</span>`,
        );
    };

    privateScope.requestGroundControlOpen = function () {
        privateScope.cancelGroundControlActivation?.();
        privateScope.cancelGroundControlActivation = queueGroundControlActivation({
            isCurrent: () => (
                privateScope.activeProtocol === 'mavlink' &&
                CONFIGURATOR.connectionProtocol === 'mavlink' &&
                Boolean(GUI.connected_to) &&
                $('#tabs ul.mode-mavlink .tab_flight_data a').length > 0
            ),
            isBusy: () => Boolean(
                GUI.tab_switch_in_progress || GUI.connect_lock
            ),
            isOpen: () => $('#tabs ul.mode-mavlink .tab_flight_data').hasClass('active'),
            activate: () => $('#tabs ul.mode-mavlink .tab_flight_data a').trigger('click'),
            onExhausted: error => {
                const detail = error?.message ? `: ${error.message}` : '';
                GUI.log(
                    `<span style="color: #d98f00">Ground Control tab activation ` +
                    `did not complete${$('<div>').text(detail).html()}.</span>`,
                );
            },
        });
    };

    privateScope.onMavlinkTransportOpen = function () {
        if (!privateScope.selectProtocol('mavlink')) {
            return;
        }
        CONFIGURATOR.connectionValid = false;
        GUI.allowedTabs = ['flight_data', 'landing', 'help'];
        GUI.mavlinkWaitingMessage =
            'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live. If startup order left the radio bridge idle, Flight Commander will refresh only its COM port automatically.';

        $('#connectbutton a.connect_state')
            .text(i18n.getMessage('disconnect'))
            .addClass('active');
        $('#connectbutton a.connect').addClass('active');
        $('.mode-disconnected, .mode-connected, .mode-telemetry').hide();
        $('.mode-mavlink').show();
        $('#sensor-status, #dataflash_wrapper_global, #profiles_wrapper_global').hide();
        $('#portsinput').hide();
        $('#quad-status_wrapper').show();
        $('body').removeClass('fc-controller-flight-commander-mavlink fc-controller-unsupported');
        $('#logo .firmware_version').text('MAVLink / Waiting for vehicle heartbeat');

        GUI.log(
            `MAVLink transport ready on ${GUI.connected_to} at ` +
            `${CONFIGURATOR.connection.bitrate} baud; waiting for a vehicle heartbeat.`,
        );
        privateScope.requestGroundControlOpen();
        privateScope.scheduleMavlinkWaitingRefresh();
    };

    privateScope.onLtmConnected = function () {
        if (!privateScope.selectProtocol('ltm')) {
            return;
        }
        privateScope.rememberValidatedBaud();
        CONFIGURATOR.connectionValid = true;
        GUI.allowedTabs = GUI.defaultAllowedTabsWhenTelemetryConnected.slice();
        timeout.remove('connecting');
        GUI.log('LTM telemetry is unsupported because it cannot verify the Flight Commander FCFW identity.');
        $('#connectbutton a.connect_state')
            .text(i18n.getMessage('disconnect'))
            .addClass('active');
        $('#connectbutton a.connect').addClass('active');
        $('.mode-disconnected, .mode-connected, .mode-mavlink').hide();
        $('.mode-telemetry').show();
        $('#sensor-status, #dataflash_wrapper_global, #profiles_wrapper_global').hide();
        $('#portsinput').hide();
        $('#quad-status_wrapper').show();
        $('#logo .firmware_version').text('Unsupported LTM telemetry');
        $('#tabs ul.mode-telemetry .tab_flight_data a').trigger('click');
    };

    privateScope.onMavlinkConnect = function (state) {
        $('#connectbutton a.connect_state')
            .text(i18n.getMessage('disconnect'))
            .addClass('active');
        $('#connectbutton a.connect').addClass('active');
        $('.mode-disconnected, .mode-connected').hide();
        $('.mode-mavlink').show();
        $('#sensor-status, #dataflash_wrapper_global, #profiles_wrapper_global').hide();
        $('#portsinput').hide();
        $('#quad-status_wrapper').show();
        $('#logo .firmware_version').text(`MAVLink / ${state.vehicleTypeName}`);

        privateScope.mavlinkStateUnsubscribe?.();
        const renderState = function (nextState) {
            const firmwareName = nextState.firmwareFamily === 'flight-commander'
                ? 'Flight Commander Firmware'
                : nextState.firmwareFamily === 'unsupported'
                    ? 'Unsupported firmware'
                    : 'Detecting Flight Commander Firmware';
            $('#logo .firmware_version').text(`${firmwareName} / ${nextState.vehicleTypeName}`);

            if (nextState.firmwareFamily === 'flight-commander') {
                $('body')
                    .addClass('fc-controller-flight-commander-mavlink')
                    .removeClass('fc-controller-unsupported');
                mavlinkCommandRouter.clearCommandBlock();
            } else if (nextState.firmwareFamily === 'unsupported') {
                const newlyUnsupported = !$('body').hasClass('fc-controller-unsupported');
                $('body')
                    .addClass('fc-controller-unsupported')
                    .removeClass('fc-controller-flight-commander-mavlink');
                const message =
                    'This vehicle did not provide a supported Flight Commander FCFW identity; configuration, missions, and commands are disabled.';
                mavlinkCommandRouter.blockCommands(message);
                if (newlyUnsupported) {
                    GUI.log(`<span style="color: #d42133">${message}</span>`);
                }
            } else {
                $('body').removeClass('fc-controller-flight-commander-mavlink fc-controller-unsupported');
            }

            const batteryRemaining = Number.isFinite(nextState.batteryRemaining)
                ? Math.max(0, Math.min(100, nextState.batteryRemaining))
                : 0;
            $('.battery-status').css({
                width: `${batteryRemaining}%`,
                display: 'inline-block',
                backgroundColor: batteryRemaining > 20 ? '#59AA29' : '#D42133',
            });
            $('.battery-legend').text(
                Number.isFinite(nextState.voltage) ? `${nextState.voltage.toFixed(1)} V` : '-- V',
            );
            $('#armedIcon')
                .toggleClass('armed-active', nextState.armed)
                .toggleClass('armed', !nextState.armed);
            $('#linkicon')
                .toggleClass('link-active', !nextState.linkLost)
                .toggleClass('link', nextState.linkLost);
        };

        privateScope.mavlinkStateUnsubscribe = mavlinkSession.on('state', renderState);
        renderState(state);
        if (!$('#tabs ul.mode-mavlink .tab_flight_data').hasClass('active')) {
            privateScope.requestGroundControlOpen();
        }
    };

    privateScope.rememberValidatedBaud = function () {
        const requestedProtocol =
            privateScope.activeOpenAttempt?.protocol ||
            privateScope.activeProtocol ||
            privateScope.$protocol.val() ||
            'auto';
        persistProtocolBaudPreference(
            store,
            requestedProtocol,
            CONFIGURATOR.connection.bitrate,
        );
    };

    privateScope.clearProtocolSession = function ({
        preserveStatusMessage = false,
    } = {}) {
        privateScope.cancelMavlinkWaitingRefresh();
        mavlinkCommandRouter.stop();
        privateScope.mavlinkConnectedUnsubscribe?.();
        privateScope.mavlinkConnectedUnsubscribe = null;
        privateScope.mavlinkStateUnsubscribe?.();
        privateScope.mavlinkStateUnsubscribe = null;
        privateScope.mavlinkDiagnosticUnsubscribe?.();
        privateScope.mavlinkDiagnosticUnsubscribe = null;
        privateScope.cancelGroundControlActivation?.();
        privateScope.cancelGroundControlActivation = null;
        mavlinkSession.detach();
        ltmDecoder.reset();
        privateScope.activeProtocol = null;
        CONFIGURATOR.connectionProtocol = null;
        if (!preserveStatusMessage) {
            GUI.mavlinkWaitingMessage = null;
        }
    };

    privateScope.onConnect = function () {
        timeout.remove('connecting'); // kill connecting timer
        $('#connectbutton a.connect_state').text(i18n.getMessage('disconnect')).addClass('active');
        $('#connectbutton a.connect').addClass('active');
        $('.mode-disconnected').hide();
        $('.mode-mavlink, .mode-telemetry').hide();
        $('.mode-connected').show();

        
        MSP.send_message(MSPCodes.MSP_BOXIDS, false, false, function () {
            FC.generateAuxConfig();
        });

        inavMavlinkProfileStore.captureFromMsp()
            .then(function (profile) {
                GUI.log(
                    `Flight Commander MAVLink command profile saved for system ${profile.systemId}` +
                    `${profile.name ? ` (${profile.name})` : ''}.`,
                );
            })
            .catch(function (error) {
                GUI.log(`Flight Commander MAVLink command profile was not saved: ${error.message}`);
            });

        MSP.send_message(MSPCodes.MSP_DATAFLASH_SUMMARY, false, false, function () {
            $('#sensor-status').show();
            $('#portsinput').hide();
            $('#dataflash_wrapper_global').show();
            $('#profiles_wrapper_global').show();

            /*
            * Init PIDs bank with a length that depends on the version
            */
            let pidCount = 11;

            for (let i = 0; i < pidCount; i++) {
                FC.PIDs.push(new Array(4));
            }

            
            interval.add('msp-load-update', function () {
                $('#msp-version').text("MSP version: " + MSP.protocolVersion.toFixed(0));
                $('#msp-load').text("MSP load: " + mspQueue.getLoad().toFixed(1));
                $('#msp-roundtrip').text("MSP round trip: " + mspQueue.getRoundtrip().toFixed(0));
                $('#hardware-roundtrip').text("HW round trip: " + mspQueue.getHardwareRoundtrip().toFixed(0));
            }, 100);

            interval.add('global_data_refresh', periodicStatusUpdater.run, periodicStatusUpdater.getUpdateInterval(CONFIGURATOR.connection.bitrate), false);
        });
    }

    privateScope.prepareSerialRecoveryAttempt = function (openAttempt) {
        privateScope.$protocol.val(openAttempt.protocol);
        privateScope.$baud.val(String(openAttempt.bitrate));

        const matchingPort = privateScope.$port.find('option').filter(function () {
            return String($(this).val()) === String(openAttempt.port);
        });
        if (matchingPort.length) {
            privateScope.$port.val(openAttempt.port);
        } else {
            privateScope.$port.val('manual');
            publicScope.$portOverride.val(openAttempt.port);
            store.set('portOverride', openAttempt.port);
        }
        GUI.updateManualPortVisibility();
    };

    privateScope.scheduleUnexpectedSerialRecovery = function (closeContext) {
        privateScope.cancelUnexpectedSerialRecovery();
        const recoveryGeneration =
            privateScope.unexpectedSerialRecoveryGeneration;

        const previousAttempt = closeContext.openAttempt;
        const recoveryAttempt = Object.freeze({
            protocol: previousAttempt.protocol,
            port: previousAttempt.port,
            bitrate: previousAttempt.bitrate,
            recoveryAttempt: (previousAttempt.recoveryAttempt || 0) + 1,
        });

        privateScope.unexpectedSerialRecoveryTimer = setTimeout(() => {
            if (
                recoveryGeneration !==
                privateScope.unexpectedSerialRecoveryGeneration
            ) {
                return;
            }
            privateScope.unexpectedSerialRecoveryTimer = null;
            if (GUI.connected_to !== false || GUI.connecting_to !== false) {
                return;
            }
            try {
                privateScope.prepareSerialRecoveryAttempt(recoveryAttempt);
            } catch (error) {
                console.log(
                    'Serial recovery controls could not be restored: ' +
                    (error?.message || error),
                );
            } finally {
                privateScope.reConnect({openAttempt: recoveryAttempt});
            }
        }, SERIAL_STARTUP_RECOVERY_DELAY_MS);

        privateScope.runBestEffort('Serial recovery notice', () => {
            const safePort = $('<div>').text(recoveryAttempt.port).html();
            GUI.log(
                `<span style="color: #d98f00">The serial link ended during MAVLink startup. ` +
                `Flight Commander will retry ${safePort} once after the USB device settles.</span>`,
            );
        });
    };

    privateScope.onClosed = function (result, closeContext = {}) {
        const unexpectedCause = closeContext.operatorRequested
            ? null
            : closeContext.cause || null;
        const shouldRecover = shouldAttemptMavlinkStartupRecovery({
            cause: unexpectedCause,
            openAttempt: closeContext.openAttempt,
            connectedDurationMs: closeContext.connectedDurationMs,
            hadVehicleHeartbeat: closeContext.hadVehicleHeartbeat,
        });

        // Install recovery before any optional renderer work. A broken status
        // widget must not suppress the only bounded reopen attempt.
        if (shouldRecover) {
            privateScope.scheduleUnexpectedSerialRecovery(closeContext);
        }

        if (unexpectedCause) {
            privateScope.unexpectedTerminalOperatorGuardUntil =
                Date.now() + SERIAL_TERMINAL_OPERATOR_GUARD_MS;
            const message = unexpectedSerialTerminationMessage(
                unexpectedCause,
                closeContext.port,
            );
            privateScope.runBestEffort('Unexpected serial status', () => {
                GUI.mavlinkWaitingMessage = message;
                GUI.log(
                    `<span style="color: #d42133">${$('<div>').text(message).html()}</span>`,
                );
                $('#logo .firmware_version').text('MAVLink / Serial link interrupted');
                $('#flightDataActionStatus')
                    .text(message)
                    .addClass('fc-action-status--error');
            });
        } else if (result) { // All went as expected
            privateScope.unexpectedTerminalOperatorGuardUntil = 0;
            privateScope.runBestEffort(
                'Serial close status',
                () => GUI.log(i18n.getMessage('serialPortClosedOk')),
            );
        } else { // Something went wrong
            privateScope.runBestEffort(
                'Serial close status',
                () => GUI.log(i18n.getMessage('serialPortClosedFail')),
            );
        }

        privateScope.runBestEffort('Disconnected layout', () => {
            $('.mode-connected, .mode-mavlink, .mode-telemetry').hide();
            $('.mode-disconnected').show();
            $('body').removeClass(
                'fc-controller-flight-commander-mavlink fc-controller-unsupported ' +
                'fc-firmware-flight-commander fc-firmware-unsupported',
            );

            $('#sensor-status').hide();
            $('#portsinput').show();
            $('#dataflash_wrapper_global').hide();
            $('#profiles_wrapper_global').hide();
            $('#quad-status_wrapper').hide();
        });
        //updateFirmwareVersion();
    }

    publicScope.read_serial = function (info) {
        if (!CONFIGURATOR.cliActive) {
            MSP.read(info);
        } else if (CONFIGURATOR.cliActive) {
            cliTab.read(info);
        }
    }

    /**
     * Sensor handler used in INAV >= 1.5
     * @param hw_status
     */
    privateScope.sensor_status_ex = function (hw_status)
    {
        var statusHash = privateScope.sensor_status_hash(hw_status);

        if (privateScope.sensor_status_ex.previousHash == statusHash) {
            return;
        }

        privateScope.sensor_status_ex.previousHash = statusHash;

        privateScope.sensor_status_update_icon('.gyro',      '.gyroicon',        hw_status.gyroHwStatus);
        privateScope.sensor_status_update_icon('.accel',     '.accicon',         hw_status.accHwStatus);
        privateScope.sensor_status_update_icon('.mag',       '.magicon',         hw_status.magHwStatus);
        privateScope.sensor_status_update_icon('.baro',      '.baroicon',        hw_status.baroHwStatus);
        privateScope.sensor_status_update_icon('.gps',       '.gpsicon',         hw_status.gpsHwStatus);
        privateScope.sensor_status_update_icon('.sonar',     '.sonaricon',       hw_status.rangeHwStatus);
        privateScope.sensor_status_update_icon('.airspeed',  '.airspeedicon',    hw_status.speedHwStatus);
        privateScope.sensor_status_update_icon('.opflow',    '.opflowicon',      hw_status.flowHwStatus);
    }

    privateScope.sensor_status_update_icon = function (sensId, sensIconId, status)
    {
        var e_sensor_status = $('#sensor-status');

        if (status == 0) {
            $(sensId, e_sensor_status).removeClass('on');
            $(sensIconId, e_sensor_status).removeClass('active');
            $(sensIconId, e_sensor_status).removeClass('error');
        }
        else if (status == 1) {
            $(sensId, e_sensor_status).addClass('on');
            $(sensIconId, e_sensor_status).addClass('active');
            $(sensIconId, e_sensor_status).removeClass('error');
        }
        else {
            $(sensId, e_sensor_status).removeClass('on');
            $(sensIconId, e_sensor_status).removeClass('active');
            $(sensIconId, e_sensor_status).addClass('error');
        }
    }

    privateScope.sensor_status_hash = function (hw_status)
    {
        return "S" +
            hw_status.isHardwareHealthy +
            hw_status.gyroHwStatus +
            hw_status.accHwStatus +
            hw_status.magHwStatus +
            hw_status.baroHwStatus +
            hw_status.gpsHwStatus +
            hw_status.rangeHwStatus +
            hw_status.speedHwStatus +
            hw_status.flowHwStatus;
    }

    /**
     * Legacy sensor handler used in INAV < 1.5 versions
     * @param sensors_detected
     * @deprecated
     */
    privateScope.sensor_status = function (sensors_detected) {

        if (typeof SENSOR_STATUS === 'undefined') {
            return;
        }

        SENSOR_STATUS.isHardwareHealthy = 1;
        SENSOR_STATUS.gyroHwStatus      = publicScope.have_sensor(sensors_detected, 'gyro') ? 1 : 0;
        SENSOR_STATUS.accHwStatus       = publicScope.have_sensor(sensors_detected, 'acc') ? 1 : 0;
        SENSOR_STATUS.magHwStatus       = publicScope.have_sensor(sensors_detected, 'mag') ? 1 : 0;
        SENSOR_STATUS.baroHwStatus      = publicScope.have_sensor(sensors_detected, 'baro') ? 1 : 0;
        SENSOR_STATUS.gpsHwStatus       = publicScope.have_sensor(sensors_detected, 'gps') ? 1 : 0;
        SENSOR_STATUS.rangeHwStatus     = publicScope.have_sensor(sensors_detected, 'sonar') ? 1 : 0;
        SENSOR_STATUS.speedHwStatus     = publicScope.have_sensor(sensors_detected, 'airspeed') ? 1 : 0;
        SENSOR_STATUS.flowHwStatus      = publicScope.have_sensor(sensors_detected, 'opflow') ? 1 : 0;
        privateScope.sensor_status_ex(SENSOR_STATUS);
    }

    publicScope.have_sensor = function (sensors_detected, sensor_code) {
        switch(sensor_code) {
            case 'acc':
            case 'gyro':
                return BitHelper.bit_check(sensors_detected, 0);
            case 'baro':
                return BitHelper.bit_check(sensors_detected, 1);
            case 'mag':
                return BitHelper.bit_check(sensors_detected, 2);
            case 'gps':
                return BitHelper.bit_check(sensors_detected, 3);
            case 'sonar':
                return BitHelper.bit_check(sensors_detected, 4);
            case 'opflow':
                return BitHelper.bit_check(sensors_detected, 5);
            case 'airspeed':
                return BitHelper.bit_check(sensors_detected, 6);
        }
        return false;
    }


    return publicScope;

})();

export default SerialBackend;
