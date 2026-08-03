'use strict';

import semver from 'semver';
import Map from 'ol/Map.js';
import XYZ from 'ol/source/XYZ.js';
import OSM from 'ol/source/OSM.js';
import TileWMS from 'ol/source/TileWMS'
import TileLayer from 'ol/layer/Tile.js';
import View from 'ol/View.js'
import { fromLonLat } from 'ol/proj';
import Style from 'ol/style/Style'
import Icon from 'ol/style/Icon';
import Text from 'ol/style/Text';
import Fill from 'ol/style/Fill';
import Point from 'ol/geom/Point.js';
import Feature from 'ol/Feature';
import VectorSource from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import interval from './../js/intervals';
import GUI from './../js/gui';
import FC from './../js/fc';
import i18n from './../js/localization';
import Settings from './../js/settings';
import serialPortHelper from './../js/serialPortHelper';
import features from './../js/feature_framework';
import { globalSettings } from './../js/globalSettings';
import jBox from 'jbox';
import SerialBackend from '../js/serial_backend';
import ublox from '../js/ublox/UBLOX';
import dialog from '../js/dialog';
import { firmwareFeatureSupport } from '../js/flightCommander/firmwareIdentity';
import {
    DRONECAN_NODE_ID_DISABLED,
    encodeDronecanConfig,
} from '../js/flightCommander/dualGps';
import {
    EXTERNAL_MAG_HARDWARE,
    HEADING_SOURCE_COUNT,
    HEADING_SOURCE_LABELS,
    HEADING_SOURCE_MOVING_BASELINE,
    encodeHeadingConfig,
} from '../js/flightCommander/headingFusion';
import {
    UART_GPS_PRESETS,
    UART_RTK_ROVER_PRESET_ID,
    detectUartGpsPreset,
    uartRtkRoverNextAction,
} from '../js/flightCommander/uartGpsPresets';


const gpsTab = {};
gpsTab.initialize = function (callback) {

    const firmwareIdentity = FC.CONFIG.firmwareIdentity;
    const supportsRtkUart = firmwareFeatureSupport(firmwareIdentity, 'rtkGpsUart').enabled;
    const supportsDronecanGps = firmwareFeatureSupport(firmwareIdentity, 'dronecanGps').enabled;
    const supportsDronecanConfig = firmwareFeatureSupport(firmwareIdentity, 'dronecanNodeConfig').enabled;
    const supportsHeadingFusion = firmwareFeatureSupport(firmwareIdentity, 'headingFusion').enabled;
    const supportsMovingBaseline = firmwareFeatureSupport(firmwareIdentity, 'movingBaselineYaw').enabled;

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    // mavlink ADSB_EMITTER_TYPE
    const ADSB_VEHICLE_TYPE = {
        0: {iconNum: 14, name: 'No info'}, // ADSB_EMITTER_TYPE_NO_INFO
        1: {iconNum: 1,  name: 'Light'}, // ADSB_EMITTER_TYPE_LIGHT
        2: {iconNum: 1,  name: 'Small'}, // ADSB_EMITTER_TYPE_SMALL
        3: {iconNum: 2,  name: 'Large'}, // ADSB_EMITTER_TYPE_LARGE
        4: {iconNum: 14, name: 'High vortex large'}, // ADSB_EMITTER_TYPE_HIGH_VORTEX_LARGE
        5: {iconNum: 5,  name: 'Heavy'}, // ADSB_EMITTER_TYPE_HEAVY
        6: {iconNum: 14, name: 'Manuv'}, // ADSB_EMITTER_TYPE_HIGHLY_MANUV
        7: {iconNum: 13, name: 'Rotorcraft'}, // ADSB_EMITTER_TYPE_ROTOCRAFT
        8: {iconNum: 14, name: 'Unassigned'}, // ADSB_EMITTER_TYPE_UNASSIGNED
        9: {iconNum: 6,  name: 'Glider'}, // ADSB_EMITTER_TYPE_GLIDER
        10:{iconNum: 7,  name: 'Lighter air'}, // ADSB_EMITTER_TYPE_LIGHTER_AIR
        11:{iconNum: 15, name: 'Parachute'}, // ADSB_EMITTER_TYPE_PARACHUTE
        12:{iconNum: 1,  name: 'Ultra light'}, // ADSB_EMITTER_TYPE_ULTRA_LIGHT
        13:{iconNum: 14, name: 'Unassigned 2'}, // ADSB_EMITTER_TYPE_UNASSIGNED2
        14:{iconNum: 8,  name: 'UAV'}, // ADSB_EMITTER_TYPE_UAV
        15:{iconNum: 14, name: 'Space'}, // ADSB_EMITTER_TYPE_SPACE
        16:{iconNum: 14, name: 'Unassigned 3'}, // ADSB_EMITTER_TYPE_UNASSGINED3
        17:{iconNum: 9,  name: 'Surface'}, // ADSB_EMITTER_TYPE_EMERGENCY_SURFACE
        18:{iconNum: 10, name: 'Service surface'}, // ADSB_EMITTER_TYPE_SERVICE_SURFACE
        19:{iconNum: 12, name: 'Pint obstacle'}, // ADSB_EMITTER_TYPE_POINT_OBSTACLE
    };

    var loadChainer = new MSPChainerClass();

    var loadChain = [
        mspHelper.loadFeatures,
        mspHelper.loadSerialPorts,
        mspHelper.loadMiscV2
    ];
    if (supportsDronecanConfig) {
        loadChain.push(mspHelper.loadDronecanConfig, mspHelper.loadDronecanNodes);
    }
    if (supportsHeadingFusion) {
        loadChain.push(mspHelper.loadFlightCommanderHeadingConfig);
    }

    loadChainer.setChain(loadChain);
    loadChainer.setExitPoint(load_html);
    loadChainer.execute();

    var saveChainer = new MSPChainerClass();

    var saveChain = [
        mspHelper.saveMiscV2,
        mspHelper.saveSerialPorts,
        saveSettings,
    ];
    if (supportsDronecanConfig) {
        saveChain.push(mspHelper.saveDronecanConfig);
    }
    if (supportsHeadingFusion) {
        saveChain.push(mspHelper.saveFlightCommanderHeadingConfig);
    }
    saveChain.push(mspHelper.saveToEeprom);

    function saveSettings(onComplete) {
        Settings.saveInputs(onComplete);
    }

    saveChainer.setChain(saveChain);
    saveChainer.setExitPoint(reboot);

    function reboot() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('configurationEepromSaved'));

        GUI.tab_switch_cleanup(function () {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, function () {
                //noinspection JSUnresolvedVariable
                GUI.log(i18n.getMessage('deviceRebooting'));
                GUI.handleReconnect($('.tab_gps a'));
            });
        });
    }
    
    async function loadIcons() {
        for (let i = 0; i <= 19; i++) {
            ADSB_VEHICLE_TYPE[i].icon = (await import(`./../resources/adsb/adsb_${ADSB_VEHICLE_TYPE[i].iconNum}.png?inline`)).default;
        }
        arrowIcon = (await import('./../images/icons/map/cf_icon_position.png?inline')).default;
    }

    async function load_html() {
        const { default: html } = await import('./gps.html?raw');
        await loadIcons();
        GUI.load(html, Settings.processHtml(process_html));
    }

    let cursorInitialized = false;
    let iconStyle;
    let mapHandler;
    let iconGeometry;
    let iconFeature;

    let vehicleVectorSource;
    let vehiclesCursorInitialized = false;
    let arrowIcon;

    async function process_html(settingsPromise) {
        // Wait for settings to finish loading to avoid race conditions
        // where user changes are overwritten by background setting loads
        if (settingsPromise) {
            await settingsPromise;
        }

        i18n.localize();

        var fcFeatures = FC.getFeatures();
        const supportsRtkStatus = supportsRtkUart || supportsDronecanGps;

        features.updateUI($('.tab-gps'), FC.FEATURES);

        //Generate serial port options
        let $port = $('#gps_port');
        let $baud = $('#gps_baud');

        let ports = serialPortHelper.getPortIdentifiersForFunction('GPS');

        let currentPort = null;

        if (ports.length == 1) {
            currentPort = ports[0];
        }

        let availablePorts = serialPortHelper.getPortList();

        //Generate port select
        $port.append('<option value="-1">NONE</option>');
        for (let i = 0; i < availablePorts.length; i++) {
            let port = availablePorts[i];
            $port.append('<option value="' + port.identifier + '">' + port.displayName + '</option>');
        }

        //Generate baud select
        serialPortHelper.getBauds('SENSOR').forEach(function (baud) {
            $baud.append('<option value="' + baud + '">' + baud + '</option>');
        });

        //Select defaults
        if (currentPort !== null) {
            $port.val(currentPort);
            let portConfig = serialPortHelper.getPortByIdentifier(currentPort);
            $baud.val(portConfig.sensors_baudrate);
        } else {
            $port.val(-1);
            $baud.val(serialPortHelper.getRuleByName('GPS').defaultBaud);
        }

        // generate GPS
        var gpsProtocols = FC.getGpsProtocols();
        var gpsSbas = FC.getGpsSbasProviders();

        var gps_protocol_e = $('#gps_protocol');
        for (let i = 0; i < gpsProtocols.length; i++) {
            gps_protocol_e.append('<option value="' + i + '">' + gpsProtocols[i] + '</option>');
        }

        gps_protocol_e.on('change', function () {
            FC.MISC.gps_type = parseInt($(this).val());
        });

        gps_protocol_e.val(FC.MISC.gps_type);
        gps_protocol_e.trigger('change');
        $('#flightCommanderRtkStatus').toggleClass('is-hidden', !supportsRtkStatus);
        $('#flightCommanderDualGpsStatus').toggleClass('is-hidden', !supportsDronecanGps);
        $('#flightCommanderDualGpsNote').toggleClass('is-hidden', !supportsDronecanGps);
        $('#flightCommanderDronecanGpsConfig').toggleClass('is-hidden', !supportsDronecanConfig);
        $('#flightCommanderHeadingConfig').toggleClass('is-hidden', !supportsHeadingFusion);
        $('#movingBaselineConfig').toggleClass('is-hidden', !supportsMovingBaseline);

        function describeDronecanNode(node) {
            const capabilities = [];
            if ((node.capabilities & (1 << 0)) !== 0) capabilities.push('GPS / RTK');
            if ((node.capabilities & (1 << 3)) !== 0) capabilities.push('compass');
            if ((node.capabilities & (1 << 4)) !== 0) capabilities.push('relative heading');
            return `Node ${node.nodeId} · ${capabilities.join(' + ') || 'status only'}`;
        }

        function populateDronecanNodeSelect(selector, configuredNodeId, capabilityMask, automaticLabel) {
            const $select = $(selector).empty()
                .append('<option value="255">Disabled</option>')
                .append($('<option/>').val(0).text(automaticLabel));
            let configuredNodeFound = configuredNodeId === 0 || configuredNodeId === DRONECAN_NODE_ID_DISABLED;
            for (const node of FC.DRONECAN_STATUS.nodes) {
                if ((node.capabilities & capabilityMask) === 0) continue;
                $('<option/>').val(node.nodeId).text(describeDronecanNode(node)).appendTo($select);
                if (node.nodeId === configuredNodeId) configuredNodeFound = true;
            }
            if (!configuredNodeFound) {
                $('<option/>')
                    .val(configuredNodeId)
                    .text(`Node ${configuredNodeId} · configured, not currently detected`)
                    .appendTo($select);
            }
            $select.val(String(configuredNodeId));
        }

        function renderDronecanGpsConfig() {
            if (!supportsDronecanConfig) return;

            $('#gpsDronecanControllerNodeId').val(FC.DRONECAN_CONFIG.nodeId);
            $('#gpsDronecanBitrate').val(String(FC.DRONECAN_CONFIG.bitrate));
            $('#gpsPrimarySource').val(String(FC.DRONECAN_CONFIG.primaryGpsSource));

            populateDronecanNodeSelect(
                '#gpsDronecanNode',
                FC.DRONECAN_CONFIG.gpsNodeId,
                1 << 0,
                'Automatic GPS selection',
            );
            populateDronecanNodeSelect(
                '#gpsDronecanMagNode',
                FC.DRONECAN_CONFIG.magNodeId,
                1 << 3,
                'Automatic compass selection',
            );

            const stateNames = ['Starting', 'Online', 'Bus off', 'Unavailable'];
            $('#gpsDronecanBusStatus').text(
                `${stateNames[FC.DRONECAN_STATUS.state] ?? 'Unknown'} · ` +
                `${FC.DRONECAN_STATUS.bitrateKbps || '--'} kbit/s · ` +
                `${FC.DRONECAN_STATUS.nodes.length} node(s) detected`,
            );
        }

        function collectDronecanGpsConfig() {
            FC.DRONECAN_CONFIG.nodeId = Number.parseInt($('#gpsDronecanControllerNodeId').val(), 10);
            FC.DRONECAN_CONFIG.bitrate = Number.parseInt($('#gpsDronecanBitrate').val(), 10);
            FC.DRONECAN_CONFIG.gpsNodeId = Number.parseInt($('#gpsDronecanNode').val(), 10);
            FC.DRONECAN_CONFIG.primaryGpsSource = Number.parseInt($('#gpsPrimarySource').val(), 10);
            FC.DRONECAN_CONFIG.magNodeId = Number.parseInt($('#gpsDronecanMagNode').val(), 10);
            encodeDronecanConfig(FC.DRONECAN_CONFIG);
        }

        function renderHeadingConfig() {
            if (!supportsHeadingFusion || !FC.HEADING_CONFIG) return;

            for (let sourceIndex = 0; sourceIndex < HEADING_SOURCE_COUNT; sourceIndex += 1) {
                const source = FC.HEADING_CONFIG.sources[sourceIndex];
                const $priority = $(`#headingSourcePriority${sourceIndex}`).empty();
                for (let priority = 1; priority <= HEADING_SOURCE_COUNT; priority += 1) {
                    $('<option/>').val(priority).text(priority).appendTo($priority);
                }
                $(`#headingSourceEnabled${sourceIndex}`).prop('checked', source.enabled);
                $priority.val(String(source.priority));
                $(`#headingSourceWeight${sourceIndex}`).val(source.weight);
                $(`#headingSourceYaw${sourceIndex}`).val((source.yawOffsetCentidegrees / 100).toFixed(2));
            }

            const $hardware = $('#externalMagHardware').empty();
            for (const hardware of EXTERNAL_MAG_HARDWARE) {
                $('<option/>').val(hardware.value).text(hardware.label).appendTo($hardware);
            }
            $hardware.val(String(FC.HEADING_CONFIG.externalMagHardware));

            const externalAlignment = FC.HEADING_CONFIG.externalMagAlignmentDecidegrees;
            $('#externalMagRoll').val((externalAlignment[0] / 10).toFixed(1));
            $('#externalMagPitch').val((externalAlignment[1] / 10).toFixed(1));
            $('#externalMagYaw').val((externalAlignment[2] / 10).toFixed(1));

            const dronecanAlignment = FC.HEADING_CONFIG.dronecanMagAlignmentDecidegrees;
            $('#dronecanMagRoll').val((dronecanAlignment[0] / 10).toFixed(1));
            $('#dronecanMagPitch').val((dronecanAlignment[1] / 10).toFixed(1));
            $('#dronecanMagYaw').val((dronecanAlignment[2] / 10).toFixed(1));

            $('#movingBaselineEnabled').prop('checked', FC.HEADING_CONFIG.movingBaselineEnabled);
            $('#movingBaselineProvider').val(String(FC.HEADING_CONFIG.movingBaselineProvider));
            $('#movingBaselineLength').val((FC.HEADING_CONFIG.expectedBaselineCm / 100).toFixed(2));
            $('#movingBaselineTolerance').val((FC.HEADING_CONFIG.baselineToleranceCm / 100).toFixed(2));
            $('#movingBaselineAccuracy').val((FC.HEADING_CONFIG.maxHeadingAccuracyCentidegrees / 100).toFixed(2));
            $('#movingBaselineFixedOnly').prop('checked', FC.HEADING_CONFIG.movingBaselineFixedOnly);
            $('#headingSourceTimeout').val(FC.HEADING_CONFIG.sourceTimeoutMs);
            $('#headingMaxDisagreement').val((FC.HEADING_CONFIG.maxDisagreementCentidegrees / 100).toFixed(2));

            if (!supportsMovingBaseline) {
                $('#headingSourceEnabled3, #movingBaselineEnabled, #movingBaselineProvider, #movingBaselineLength, #movingBaselineTolerance, #movingBaselineAccuracy, #movingBaselineFixedOnly')
                    .prop('disabled', true);
            }
        }

        function collectHeadingConfig() {
            const config = FC.HEADING_CONFIG;
            for (let sourceIndex = 0; sourceIndex < HEADING_SOURCE_COUNT; sourceIndex += 1) {
                config.sources[sourceIndex].enabled = $(`#headingSourceEnabled${sourceIndex}`).prop('checked');
                config.sources[sourceIndex].priority = Number.parseInt($(`#headingSourcePriority${sourceIndex}`).val(), 10);
                config.sources[sourceIndex].weight = Number.parseInt($(`#headingSourceWeight${sourceIndex}`).val(), 10);
                config.sources[sourceIndex].yawOffsetCentidegrees = Math.round(Number.parseFloat($(`#headingSourceYaw${sourceIndex}`).val()) * 100);
            }

            config.externalMagHardware = Number.parseInt($('#externalMagHardware').val(), 10);
            config.externalMagAlignmentDecidegrees = [
                $('#externalMagRoll'),
                $('#externalMagPitch'),
                $('#externalMagYaw'),
            ].map(($input) => Math.round(Number.parseFloat($input.val()) * 10));
            config.dronecanMagAlignmentDecidegrees = [
                $('#dronecanMagRoll'),
                $('#dronecanMagPitch'),
                $('#dronecanMagYaw'),
            ].map(($input) => Math.round(Number.parseFloat($input.val()) * 10));

            config.movingBaselineEnabled = supportsMovingBaseline && $('#movingBaselineEnabled').prop('checked');
            config.sources[HEADING_SOURCE_MOVING_BASELINE].enabled = config.movingBaselineEnabled;
            config.movingBaselineProvider = Number.parseInt($('#movingBaselineProvider').val(), 10);
            config.expectedBaselineCm = Math.round(Number.parseFloat($('#movingBaselineLength').val()) * 100);
            config.baselineToleranceCm = Math.round(Number.parseFloat($('#movingBaselineTolerance').val()) * 100);
            config.maxHeadingAccuracyCentidegrees = Math.round(Number.parseFloat($('#movingBaselineAccuracy').val()) * 100);
            config.movingBaselineFixedOnly = $('#movingBaselineFixedOnly').prop('checked');
            config.sourceTimeoutMs = Number.parseInt($('#headingSourceTimeout').val(), 10);
            config.maxDisagreementCentidegrees = Math.round(Number.parseFloat($('#headingMaxDisagreement').val()) * 100);

            encodeHeadingConfig(config, FC.DRONECAN_CONFIG);
        }

        function updateHeadingUi() {
            const status = FC.HEADING_STATUS;
            const hasFusedHeading = status.activeMask !== 0;
            $('#headingFusedValue').text(
                hasFusedHeading ? `${(status.fusedHeadingCentidegrees / 100).toFixed(2)}°` : 'No valid source',
            );
            $('#headingAnchorValue').text(
                status.anchorSource < HEADING_SOURCE_COUNT
                    ? `Primary authority: ${HEADING_SOURCE_LABELS[status.anchorSource]}`
                    : 'No primary authority',
            );

            for (let sourceIndex = 0; sourceIndex < HEADING_SOURCE_COUNT; sourceIndex += 1) {
                const source = status.sources[sourceIndex];
                const sourceConfig = FC.HEADING_CONFIG?.sources?.[sourceIndex];
                const $row = $(`[data-heading-source="${sourceIndex}"]`)
                    .removeClass('heading-source-active heading-source-rejected');
                let label = 'Unavailable / stale';
                if (!sourceConfig?.enabled) {
                    label = 'Disabled';
                } else if (sourceIndex < HEADING_SOURCE_MOVING_BASELINE && source?.calibrating) {
                    label = 'Calibrating · rotate aircraft';
                } else if (sourceIndex < HEADING_SOURCE_MOVING_BASELINE && source?.calibrationFailed) {
                    label = 'Calibration failed';
                    $row.addClass('heading-source-rejected');
                } else if (sourceIndex < HEADING_SOURCE_MOVING_BASELINE && !source?.calibrated) {
                    label = 'Calibration required';
                } else if (source?.rejected) {
                    label = `Rejected · ${(source.headingCentidegrees / 100).toFixed(2)}°`;
                    $row.addClass('heading-source-rejected');
                } else if (source?.active) {
                    label = `Active · ${(source.headingCentidegrees / 100).toFixed(2)}° · Q${source.quality}%`;
                    $row.addClass('heading-source-active');
                } else if (source?.healthy) {
                    label = `Healthy standby · ${(source.headingCentidegrees / 100).toFixed(2)}°`;
                }
                if (source && source.ageMs !== 0xffff) {
                    label += ` · ${source.ageMs} ms`;
                }
                $(`#headingSourceStatus${sourceIndex}`).text(label);
            }

        }

        renderDronecanGpsConfig();
        renderHeadingConfig();
        $('#headingSourceEnabled3, #movingBaselineEnabled').on('change.gpsTab', function () {
            const enabled = $(this).prop('checked');
            $('#headingSourceEnabled3, #movingBaselineEnabled').prop('checked', enabled);
        });
        $('#gpsDronecanRefresh').on('click.gpsTab', function (event) {
            event.preventDefault();
            const $button = $(this).prop('disabled', true);
            mspHelper.loadDronecanNodes(function () {
                renderDronecanGpsConfig();
                $button.prop('disabled', false);
            });
        });

        var gps_ubx_sbas_e = $('#gps_ubx_sbas');
        for (let i = 0; i < gpsSbas.length; i++) {
            gps_ubx_sbas_e.append('<option value="' + i + '">' + gpsSbas[i] + '</option>');
        }

        gps_ubx_sbas_e.on('change', function () {
            FC.MISC.gps_ubx_sbas = parseInt($(this).val());
        });

        gps_ubx_sbas_e.val(FC.MISC.gps_ubx_sbas);

        // GPS Preset Configuration
        const GPS_PRESETS = UART_GPS_PRESETS;

        function updateRtkRoverGuidance() {
            const selectedPreset = $('#gps_preset_mode').val();
            const isRtkRover = selectedPreset === UART_RTK_ROVER_PRESET_ID;
            $('#gpsRtkRoverGuidance').toggleClass('is-hidden', !isRtkRover);
            if (!isRtkRover) return;
            $('#gpsRtkRoverNextAction').text(uartRtkRoverNextAction({
                portIdentifier: $port.val(),
                supportsRtkUart,
            }));
        }

        function applyGPSPreset(presetId) {
            // Handle special cases first (before checking GPS_PRESETS)
            if (presetId === 'manual') {
                // Enable all controls
                $('.preset-controlled').prop('disabled', false);
                $('#gps_ublox_nav_hz').prop('disabled', false);
                $('#preset_info').hide();
                updateRtkRoverGuidance();
                return;
            }

            if (presetId === 'auto') {
                // Try to auto-detect from FC
                if (FC.GPS_DATA && FC.GPS_DATA.hwVersion) {
                    const detectedPreset = detectUartGpsPreset(FC.GPS_DATA.hwVersion);
                    applyGPSPreset(detectedPreset);
                    $('#gps_preset_mode').val(detectedPreset);
                    GUI.log(i18n.getMessage('gpsAutoDetectSuccess') + ' ' + GPS_PRESETS[detectedPreset].name);
                } else {
                    // Fall back to manual if can't detect
                    applyGPSPreset('manual');
                    $('#gps_preset_mode').val('manual');
                    GUI.log(i18n.getMessage('gpsAutoDetectFailed'));
                }
                return;
            }

            // Normal preset application
            const preset = GPS_PRESETS[presetId];
            if (!preset) return;

            // Apply preset values (user can still adjust after applying)
            if (preset.protocol) {
                const protocolIndex = gpsProtocols.indexOf(preset.protocol);
                if (protocolIndex >= 0) gps_protocol_e.val(String(protocolIndex)).trigger('change');
            }
            if (preset.baud && $baud.find(`option[value="${preset.baud}"]`).length) {
                $baud.val(preset.baud);
            }
            $('#gps_use_galileo').prop('checked', preset.galileo);
            $('#gps_use_glonass').prop('checked', preset.glonass);
            $('#gps_use_beidou').prop('checked', preset.beidou);
            $('#gps_ublox_nav_hz').val(preset.rate);

            // Show preset info
            $('#preset_name').text(preset.name);
            $('#preset_details').html(preset.description.map(d => `<li>${d}</li>`).join(''));
            $('#preset_info').show();
            updateRtkRoverGuidance();
        }

        // Set up preset mode handler (namespaced to prevent memory leaks)
        $('#gps_preset_mode').on('change.gpsTab', function() {
            applyGPSPreset($(this).val());
        });
        $port.on('change.gpsTab', updateRtkRoverGuidance);

        // Hardware detection status indicator
        function updateHardwareStatus() {
            if (FC.GPS_DATA && FC.GPS_DATA.hwVersion && FC.GPS_DATA.hwVersion > 0) {
                const detectedPreset = detectUartGpsPreset(FC.GPS_DATA.hwVersion);
                if (detectedPreset && detectedPreset !== 'manual' && GPS_PRESETS[detectedPreset]) {
                    $('#gps_hardware_name').text(GPS_PRESETS[detectedPreset].name + ' detected');
                    $('#gps_hardware_status').show();
                }
            }
        }

        // Handler for "Use optimal settings" link (namespaced)
        $('#gps_apply_optimal').on('click.gpsTab', function(e) {
            e.preventDefault();
            if (FC.GPS_DATA && FC.GPS_DATA.hwVersion) {
                const detectedPreset = detectUartGpsPreset(FC.GPS_DATA.hwVersion);
                if (detectedPreset && detectedPreset !== 'manual') {
                    $('#gps_preset_mode').val(detectedPreset).trigger('change');
                    GUI.log('Applied recommended settings for ' + GPS_PRESETS[detectedPreset].name);
                }
            }
        });

        // Initialize - default to manual mode to preserve user's existing settings
        // User can explicitly select a preset or use "Auto-detect" if desired
        applyGPSPreset('manual');

        // Check for hardware detection after a short delay to allow GPS data to arrive
        setTimeout(updateHardwareStatus, 500);

        let mapView = new View({
            center: [0, 0],
            zoom: 15
        });

        let mapLayers = [];

        if (globalSettings.mapProviderType == 'esri') {
            mapLayers.push(new TileLayer({
                    source: new XYZ({
                        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                        attributions: 'Source: <a href="https://www.esri.com/" target="_blank">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
                        maxZoom: 19
                    })
            }));
            mapLayers.push(new TileLayer({
                    source: new XYZ({
                        url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
                        maxZoom: 19
                    })
            }));
            mapLayers.push(new TileLayer({
                    source: new XYZ({
                        url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
                        maxZoom: 19
                    })
            }));
        } else if (globalSettings.mapProviderType == 'mapproxy' ) {
            mapLayers.push(new TileLayer({
                source: new TileWMS({
                            url: globalSettings.proxyURL,
                            params: {'LAYERS':globalSettings.proxyLayer}
                        })
            }));
        } else {
            mapLayers.push(new TileLayer({
                source: new OSM()
            }));
        }

        $("#center_button").on('click.gpsTab', function () {
            let lat = FC.GPS_DATA.lat / 10000000;
            let lon = FC.GPS_DATA.lon / 10000000;
            let center = fromLonLat([lon, lat]);
            mapView.setCenter(center);
        });

        mapHandler = new Map({
            target: 'gps-map',
            layers: mapLayers,
            view: mapView
        });

        gpsTab.toolboxAdsbVehicle = new jBox('Mouse', {
            position: {
                x: "right",
                y: "bottom"
            },
            offset: {
                x: -5,
                y: 20,
            },
        });

        mapHandler.on('pointermove', function(evt) {
            var feature = mapHandler.forEachFeatureAtPixel(mapHandler.getEventPixel(evt.originalEvent), function(feature, layer) {
                return feature;
            });

            if (feature && feature.get('data') && feature.get('name')) {
                gpsTab.toolboxAdsbVehicle.setContent(
                    `callsign: <strong>` + feature.get('name') + `</strong><br />`
                    + `lat: <strong>`+ (feature.get('data').lat / 10000000) + `</strong><br />`
                    + `lon: <strong>`+ (feature.get('data').lon / 10000000) + `</strong><br />`
                    + `ASL: <strong>`+ (feature.get('data').altCM ) / 100 + `m</strong><br />`
                    + `heading: <strong>`+ feature.get('data').headingDegrees + `°</strong><br />`
                    + `type: <strong>`+ ADSB_VEHICLE_TYPE[feature.get('data').emitterType].name + `</strong>`
                ).open();
            }else{
                gpsTab.toolboxAdsbVehicle.close();
            }
        });

        let center = fromLonLat([0, 0]);
        mapView.setCenter(center);
        mapView.setZoom(2);

        function get_raw_gps_data() {
            MSP.send_message(MSPCodes.MSP_RAW_GPS, false, false, get_comp_gps_data);
        }

        function get_comp_gps_data() {
            MSP.send_message(MSPCodes.MSP_COMP_GPS, false, false, get_gpsstatistics_data);
        }

        function get_gpsstatistics_data() {
            MSP.send_message(MSPCodes.MSP_GPSSTATISTICS, false, false, update_gps_ui);
        }

        function get_raw_adsb_data() {
            MSP.send_message(MSPCodes.MSP2_ADSB_VEHICLE_LIST, false, false, update_adsb_ui);
        }

        function update_gps_ui() {
            let lat = FC.GPS_DATA.lat / 10000000;
            let lon = FC.GPS_DATA.lon / 10000000;

            let gpsFixType = i18n.getMessage('gpsFixNone');
            if (FC.GPS_DATA.fix === 4) {
                gpsFixType = 'RTK Fixed';
            } else if (FC.GPS_DATA.fix === 3) {
                gpsFixType = 'RTK Float';
            } else if (FC.GPS_DATA.fix >= 2) {
                gpsFixType = i18n.getMessage('gpsFix3D');
            } else if (FC.GPS_DATA.fix >= 1) {
                gpsFixType = i18n.getMessage('gpsFix2D');
            }

            $('.GPS_info td.fix').html(gpsFixType);
            $('.GPS_info td.alt').text(FC.GPS_DATA.alt + ' m');
            $('.GPS_info td.lat').text(lat.toFixed(4) + ' deg');
            $('.GPS_info td.lon').text(lon.toFixed(4) + ' deg');
            $('.GPS_info td.speed').text(FC.GPS_DATA.speed + ' cm/s');
            $('.GPS_info td.sats').text(FC.GPS_DATA.numSat);
            $('.GPS_info td.distToHome').text(FC.GPS_DATA.distanceToHome + ' m');

            let gpsRate = 0;
            if (FC.GPS_DATA.messageDt > 0) {
                gpsRate = 1000 / FC.GPS_DATA.messageDt;
            }

            $('.GPS_stat td.messages').text(FC.GPS_DATA.packetCount);
            $('.GPS_stat td.rate').text(gpsRate.toFixed(1) + ' Hz');
            $('.GPS_stat td.errors').text(FC.GPS_DATA.errors);
            $('.GPS_stat td.timeouts').text(FC.GPS_DATA.timeouts);
            $('.GPS_stat td.eph').text((FC.GPS_DATA.eph / 100).toFixed(2) + ' m');
            $('.GPS_stat td.epv').text((FC.GPS_DATA.epv / 100).toFixed(2) + ' m');
            $('.GPS_stat td.hdop').text((FC.GPS_DATA.hdop / 100).toFixed(2));

            //Update map
            if (FC.GPS_DATA.fix >= 2) {

                let center = fromLonLat([lon, lat]);

                if (!cursorInitialized) {
                    cursorInitialized = true;

                    iconStyle = new Style({
                        image: new Icon(({
                            anchor: [0.5, 1],
                            opacity: 1,
                            scale: 0.5,
                            src: arrowIcon
                        }))
                    });

                    let currentPositionLayer;
                    iconGeometry = new Point(fromLonLat([0, 0]));
                    iconFeature = new Feature({
                        geometry: iconGeometry
                    });

                    iconFeature.setStyle(iconStyle);

                    let vectorSource = new VectorSource({
                        features: [iconFeature]
                    });
                    currentPositionLayer = new VectorLayer ({
                        source: vectorSource
                    });

                    mapHandler.addLayer(currentPositionLayer);

                    mapView.setCenter(center);
                    mapView.setZoom(14);
                }

                iconGeometry.setCoordinates(center);

            }
        }

        function update_adsb_ui() {

            if (vehiclesCursorInitialized) {
                vehicleVectorSource.clear();
            }

            $('.adsbVehicleTotalMessages').html(FC.ADSB_VEHICLES.vehiclePacketCount);
            $('.adsbHeartbeatTotalMessages').html(FC.ADSB_VEHICLES.heartbeatPacketCount);

            for (let key in FC.ADSB_VEHICLES.vehicles) {
                let vehicle = FC.ADSB_VEHICLES.vehicles[key];

                if (!vehiclesCursorInitialized) {
                    vehiclesCursorInitialized = true;

                    vehicleVectorSource = new VectorSource({});

                    let vehicleLayer = new VectorLayer({
                        source: vehicleVectorSource
                    });

                    mapHandler.addLayer(vehicleLayer);
                }

                if (vehicle.lat != 0 && vehicle.lon != 0 && vehicle.ttl > 0) {
                    let vehicleIconStyle = new Style({
                        image: new Icon(({
                            opacity: 1,
                            rotation: vehicle.headingDegrees * (Math.PI / 180),
                            scale: 0.8,
                            anchor: [0.5, 0.5],
                            src: ADSB_VEHICLE_TYPE[vehicle.emitterType].icon,
                        })),
                        text: new Text(({
                            text: vehicle.callsign,
                            textAlign: 'center',
                            textBaseline: "bottom",
                            offsetY: +40,
                            padding: [2, 2, 2, 2],
                            backgroundFill: new Fill({ color: '#444444' }),
                            fill: new Fill({color: '#ffffff'}),
                        })),
                    });


                    let iconGeometry = new Point(fromLonLat([vehicle.lon / 10000000, vehicle.lat / 10000000]));
                    let iconFeature = new Feature({
                        geometry: iconGeometry,
                        name: vehicle.callsign,
                        type: 'adsb',
                        data: vehicle,
                    });

                    iconFeature.setStyle(vehicleIconStyle);
                    vehicleVectorSource.addFeature(iconFeature);
                }
            }
        }

        function updateRtkUi() {
            const transportNames = ['Inactive', 'UART GPS', 'DroneCAN GPS', 'UART + DroneCAN GPS'];
            const fixNames = ['No fix', '2D', '3D', 'RTK Float', 'RTK Fixed'];
            const status = FC.RTK_STATUS;
            $('#rtkTransport').text(transportNames[status.transport] ?? `Unknown (${status.transport})`);
            $('#rtkFix').text(fixNames[status.fixType] ?? `Unknown (${status.fixType})`);
            $('#rtkPendingBytes').text(status.pendingBytes);
            $('#rtkPackets').text(status.receivedPackets);
            $('#rtkMessages').text(status.completedMessages);
            $('#rtkInjectedBytes').text(status.injectedBytes);
            $('#rtkErrors').text(status.invalidPackets + status.incompleteMessages);
            $('#rtkQueueDrops').text(status.queueDrops);
        }

        function updateDualGpsUi() {
            const fixNames = ['No fix', '2D', '3D', 'RTK Float', 'RTK Fixed'];
            const providerNames = ['u-blox UART', 'MSP', 'Fake'];
            const status = FC.DUAL_GPS_STATUS;
            $('#uartGpsRole').text(status.primarySource === 0 ? '· Primary' : '· Active alternate');
            $('#dronecanGpsRole').text(status.primarySource === 1 ? '· Primary' : '· Active alternate');
            $('#uartGpsState').text(
                !status.uartEnabled
                    ? 'Not configured'
                    : status.uartHealthy ? 'Healthy' : 'Waiting for UART data',
            );
            $('#uartGpsProvider').text(providerNames[status.uartProvider] ?? `Provider ${status.uartProvider}`);
            $('#uartGpsFix').text(fixNames[status.uartFixType] ?? `Fix ${status.uartFixType}`);
            $('#uartGpsSatellites').text(status.uartSatellites);
            $('#uartGpsPosition').text(
                `${(status.uartLatitude / 1e7).toFixed(7)}, ${(status.uartLongitude / 1e7).toFixed(7)}`,
            );

            $('#dronecanGpsState').text(
                !status.dronecanEnabled
                    ? 'Disabled in Ports'
                    : status.dronecanHealthy ? 'Healthy' : 'Waiting for DroneCAN data',
            );
            $('#dronecanGpsNode').text(status.dronecanNodeId || '--');
            $('#dronecanGpsFix').text(fixNames[status.dronecanFixType] ?? `Fix ${status.dronecanFixType}`);
            $('#dronecanGpsSatellites').text(status.dronecanSatellites);
            $('#dronecanGpsPosition').text(
                `${(status.dronecanLatitude / 1e7).toFixed(7)}, ${(status.dronecanLongitude / 1e7).toFixed(7)}`,
            );
            $('#dronecanGpsAge').text(
                status.dronecanAgeMs === 0xffffffff ? 'Never' : `${status.dronecanAgeMs} ms`,
            );
            $('#dualGpsBaseline').text(
                status.baselineDistanceCm > 0
                    ? `${(status.baselineHeadingCentidegrees / 100).toFixed(2)}° · ${(status.baselineDistanceCm / 100).toFixed(2)} m`
                    : 'No valid relative-heading solution',
            );
        }

        /*
         * enable data pulling
         * GPS is usually refreshed at 5Hz, there is no reason to pull it much more often, really...
         */
        interval.add('gps_pull', function gps_update() {
            // avoid usage of the GPS commands until a GPS sensor is detected for targets that are compiled without GPS support.
            if (!SerialBackend.have_sensor(FC.CONFIG.activeSensors, 'gps')) {
                update_gps_ui();
                return;
            }

            get_raw_gps_data();

        }, 200);

        if (supportsRtkStatus) {
            interval.add('flight_commander_rtk_pull', function () {
                mspHelper.loadFlightCommanderRtkStatus(updateRtkUi);
            }, 1000, true);
        }

        if (supportsDronecanGps) {
            interval.add('flight_commander_dual_gps_pull', function () {
                mspHelper.loadFlightCommanderDualGpsStatus(updateDualGpsUi);
            }, 1000, true);
        }

        if (supportsHeadingFusion) {
            interval.add('flight_commander_heading_pull', function () {
                mspHelper.loadFlightCommanderHeadingStatus(updateHeadingUi);
            }, 500, true);
        }


        if (semver.gte(FC.CONFIG.flightControllerVersion, "8.0.0")) {
            $('.adsb_info_block').hide();
            mspHelper.loadSerialPorts(function () {
                for(var i  in FC.SERIAL_CONFIG.ports){
                   if(FC.SERIAL_CONFIG.ports[i].functions && FC.SERIAL_CONFIG.ports[i].functions.includes("TELEMETRY_MAVLINK")){
                       $('.adsb_info_block').show();
                       interval.add('adsb_pull', get_raw_adsb_data, 200);
                       break;
                   }
                }
            });
        }

        $('a.save').on('click.gpsTab', function () {
            try {
                if (supportsDronecanConfig) {
                    collectDronecanGpsConfig();
                }
                if (supportsHeadingFusion) {
                    collectHeadingConfig();
                }
            } catch (error) {
                GUI.log(`<span class="error">${$('<div>').text(error.message).html()}</span>`);
                return;
            }
            serialPortHelper.set($port.val(), 'GPS', $baud.val());
            features.reset();
            features.fromUI($('.tab-gps'));
            features.execute(function () {
                saveChainer.execute();
            });
        });

        function processUbloxData(data) {
            if(data != null) {
                //console.log("processing data type: " + typeof(data));
                let totalSent = 0;
                let total = data.length;

                var ubloxChainer = MSPChainerClass();
                var chain = [];
                let d = new Date();

                GUI.log(i18n.getMessage('gpsAssistnowStart'));
                data.forEach((item) => {
                    chain.push(function (callback) {
                        //console.log("UBX command: " + item.length);
                        let callCallback = false;
                        if (ublox.isAssistnowDataRelevant(item, d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate()+1)) {
                            mspHelper.sendUbloxCommand(item, callback);
                        } else {
                            // Ignore msp command, but keep counter going.
                            callCallback = true;
                        }
                        totalSent++;
                        if((totalSent % 100) == 0) {
                            GUI.log(totalSent + '/' + total + ' ' + i18n.getMessage('gpsAssistnowUpdate'));
                        }
                        if(callCallback) {
                            callback();
                        }
                    });
                });
                ubloxChainer.setChain(chain);
                ubloxChainer.setExitPoint(function () {
                    if ((totalSent % 100) != 0) {
                        GUI.log(totalSent + '/' + total + ' ' + i18n.getMessage('gpsAssistnowUpdate'));
                    }
                    GUI.log(i18n.getMessage('gpsAssistnowDone'));
                });

                ubloxChainer.execute();
            }
        }

        $('a.loadAssistnowOnline').on('click.gpsTab', function () {
            if(globalSettings.assistnowApiKey != null && globalSettings.assistnowApiKey != '') {
                ublox.loadAssistnowOnline(processUbloxData);
           } else {
                dialog.alert("Assistnow Token not set!");
            }
        });

        $('a.loadAssistnowOffline').on('click.gpsTab', function () {
            if(globalSettings.assistnowApiKey != null && globalSettings.assistnowApiKey != '') {
                ublox.loadAssistnowOffline(processUbloxData);
            } else {
                dialog.alert("Assistnow Token not set!");
            }
        });

        GUI.content_ready(callback);
    }

};

gpsTab.cleanup = function (callback) {
    // Remove all namespaced event handlers to prevent memory leaks
    $('#gps_preset_mode').off('.gpsTab');
    $('#gps_port').off('.gpsTab');
    $('#gps_apply_optimal').off('.gpsTab');
    $('#center_button').off('.gpsTab');
    $('#gpsDronecanRefresh').off('.gpsTab');
    $('#headingSourceEnabled3, #movingBaselineEnabled').off('.gpsTab');
    $('a.save').off('.gpsTab');
    $('a.loadAssistnowOnline').off('.gpsTab');
    $('a.loadAssistnowOffline').off('.gpsTab');

    if (callback) callback();
    if (gpsTab.toolboxAdsbVehicle){
        gpsTab.toolboxAdsbVehicle.close();
    }
};

export default gpsTab;
