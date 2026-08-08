'use strict';

import { marked } from 'marked';
import semver from 'semver';

import i18n from './../js/localization';
import GUI from './../js/gui';
import MSP from './../js/msp';
import MSPCodes from './../js/msp/MSPCodes';
import FC from './../js/fc';
import { usbDevices, PortHandler } from './../js/port_handler';
import CONFIGURATOR from './../js/data_storage';
import SerialBackend from './../js/serial_backend';
import timeout from './../js/timeouts';
import interval from './../js/intervals';
import mspQueue from './../js/serial_queue';
import mspHelper from './../js/msp/MSPHelper';
import STM32 from './../js/protocols/stm32';
import STM32DFU from './../js/protocols/stm32usbdfu';

import mspDeduplicationQueue from './../js/msp/mspDeduplicationQueue';
import store from './../js/store';
import dialog from '../js/dialog.js';
import BackupRestore from './../js/backup_restore';
import MigrationHandler from './../js/migration/migration_handler';
import { FlashRestoreFlow, showMigrationPreview, prepareRestoreData, executeRestore } from './firmware_flasher_restore';
import {
    FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
    FLIGHT_COMMANDER_FIRMWARE_TARGETS,
    catalogByTarget,
    flightCommanderReleaseDescriptors,
    inferFlightCommanderFirmwareTarget,
    localFlightCommanderFirmwareDescriptor,
    normalizeFirmwareTarget,
    parsedHexContainsFlightCommanderIdentity,
    verifyFlightCommanderOnlinePayload,
} from './../js/flightCommander/firmwareCatalog';
import {
    FIRMWARE_FAMILY_FLIGHT_COMMANDER,
    applyFirmwareIdentity,
    isInavCompatibleFirmwareVariant,
    probeFlightCommanderFirmware,
} from './../js/flightCommander/firmwareIdentity';

const firmwareFlasherTab = {};

// Normalize target names to underscores for consistent dictionary lookups.
// Hyphens supported as workaround for 9.0.0 filename inconsistency.
function normalizeTargetName(name) {
    if (name == null) return '';
    return String(name).replace(/-/g, '_');
}

/**
 * Disconnect with a timeout fallback.
 * After save/exit the FC reboots and the serial port may vanish before
 * the disconnect callback fires, which would leave connect_lock stuck.
 */
function disconnectSafely(callback) {
    var done = false;
    var fallback = setTimeout(function() {
        if (!done) {
            done = true;
            console.warn('Disconnect timed out, forcing unlock');
            callback();
        }
    }, 3000);

    try {
        CONFIGURATOR.connection.disconnect(function() {
            if (!done) {
                done = true;
                clearTimeout(fallback);
                callback();
            }
        });
    } catch (e) {
        if (!done) {
            done = true;
            clearTimeout(fallback);
            console.warn('Disconnect threw:', e);
            callback();
        }
    }
}

firmwareFlasherTab.initialize = function (callback) {

    if (GUI.active_tab !== firmwareFlasherTab) {
        GUI.active_tab = firmwareFlasherTab;
    }

    var intel_hex = false, // standard intel hex in string format
        parsed_hex = false, // parsed raw hex in array format
        localFirmwareLoaded = false, // true when firmware loaded from local file
        fileName = "flight-commander.hex";
    var firmwareBackend = 'flight-commander';
    var loadedFirmwareFamily = null;
    var loadedFirmwareDescriptor = null;
    var flightCommanderCatalogReady = false;

    function flightCommanderCatalogIsReady() {
        return flightCommanderCatalogReady;
    }

    import('./firmware_flasher.html?raw').then(({default: html}) => GUI.load(html, function () {
        // translate to user-selected language
        i18n.localize();
        function setFirmwareBackend(backend) {
            firmwareBackend = 'flight-commander';
            store.set('firmware_backend', firmwareBackend);
            $('#firmware_backend').val(firmwareBackend);
            $('div.release_info, div.git_info').hide();
            $('#cancel_firmware').addClass('is-hidden disabled');
            $('.progress').val(0).removeClass('valid invalid');
            parsed_hex = false;
            intel_hex = false;
            localFirmwareLoaded = false;
            loadedFirmwareFamily = null;
            loadedFirmwareDescriptor = null;
            $('a.flash_firmware').addClass('disabled');
            $('.show_development_releases').closest('tr').toggle(
                firmwareBackend === 'inav',
            );

            if (firmwareBackend === 'flight-commander') {
                $('#firmware_backend_description').text(
                    'Load published Flight Commander Firmware from GitHub or select a local HEX file, then flash it.',
                );
                $('a.load_file').text(i18n.getMessage('firmwareFlasherButtonLoadLocal')).removeClass('disabled');
                $('a.load_remote_file').text(i18n.getMessage('firmwareFlasherButtonLoadOnline')).addClass('disabled');
                $('a.flash_firmware').text(i18n.getMessage('firmwareFlasherFlashFirmware')).addClass('disabled');
                buildFlightCommanderBoardOptions();
                if (flightCommanderCatalogIsReady()) {
                    firmwareFlasherTab.getTarget();
                }
            } else {
                $('#firmware_backend_description').text(
                    'Only Flight Commander Firmware is supported. Load a published or local FCFW HEX, then flash it.',
                );
                $('a.load_file').text(i18n.getMessage('firmwareFlasherButtonLoadLocal')).removeClass('disabled');
                $('a.load_remote_file').text(i18n.getMessage('firmwareFlasherButtonLoadOnline')).addClass('disabled');
                $('a.flash_firmware').text(i18n.getMessage('firmwareFlasherFlashFirmware')).addClass('disabled');
                $('span.progressLabel').text(i18n.getMessage('firmwareFlasherLoadFirmwareFile'));
                if (Array.isArray(firmwareFlasherTab.inavReleasesData)) {
                    buildBoardOptions();
                }
            }
        }

        $('#firmware_backend').on('change', function () {
            setFirmwareBackend(String($(this).val()));
        });

        function refreshFirmwareSourceButtons(summary = null) {
            if (firmwareBackend === 'flight-commander') {
                $('a.load_remote_file')
                    .text(i18n.getMessage('firmwareFlasherButtonLoadOnline'))
                    .toggleClass('disabled', !summary?.url);
                return;
            }
            $('a.load_remote_file')
                .text(i18n.getMessage('firmwareFlasherButtonLoadOnline'))
                .toggleClass('disabled', !summary);
        }

        function flightCommanderSourceStatus(summary, targetDisplay) {
            if (summary?.url) {
                return `Firmware ${summary.version} is published online for ${targetDisplay}. Click Load Firmware [Online].`;
            }
            return 'Select a published firmware version or load a local HEX file.';
        }

        function parse_hex(str, callback) {
            // parsing hex in different thread
            const worker = new Worker(new URL('./../js/workers/hex_parser.js', import.meta.url));
            
            // "callback"
            worker.onmessage = function (event) {
                callback(event.data);
            };

            // send data/string over for processing
            worker.postMessage(str);
            
        }

        function getReleaseMajor(releaseName) {
            // "name":"inav-9.0.0-dev-20250124-28-d1ef85e82d8aa5bb8b85e518893c8e4f6ab61d6e"
            var releaseNameExpression = /^inav-(\d+)([\d.]+)-(ci|dev)-(\d{4})(\d{2})(\d{2})-(\d+)-(\w+)$/;
            var match = releaseNameExpression.exec(releaseName);

            if(!match) {
                console.log(releaseName + " not matched");
                //alert(releaseName);
                return 0;
            }

            return match[1];
        }

        function parseDevFilename(filename) {
            //var targetFromFilenameExpression = /inav_([\d.]+)?_?([^.]+)\.(.*)/;
            // inav_8.0.0_TUNERCF405_dev-20240617-88fb1d0.hex
            // inav_8.0.0_TUNERCF405_ci-20240617-88fb1d0.hex
            var targetFromFilenameExpression = /^inav_(\d+)([\d.]+)_([A-Za-z0-9_-]+)_(ci|dev)-(\d{4})(\d{2})(\d{2})-(\w+)\.(hex)$/;
            var match = targetFromFilenameExpression.exec(filename);

            if (!match) {
                console.log(filename + " not matched");
                return null;
            }

            var rawMatch = match[3];  // e.g., "TBS-LUCID-H7-WING" or "TBS_LUCID_H7_WING"
            return {
                target_id: normalizeTargetName(rawMatch),
                target: rawMatch.replace(/_/g, " ").replace(/-/g, " "),  // Display: "TBS LUCID H7 WING"
                format: match[9],
                version: match[1]+match[2],
                major: match[1]
            };
        }

        function parseFilename(filename) {
            //var targetFromFilenameExpression = /inav_([\d.]+)?_?([^.]+)\.(.*)/;
            var targetFromFilenameExpression = /inav_([\d.]+(?:-rc\d+)?)?_?([^.]+)\.(.*)/;
            var match = targetFromFilenameExpression.exec(filename);

            if (!match) {
                return null;
            }

            //GUI.log("non dev: match[2]: " + match[2] + " match[3]: " + match[3]);

            var rawMatch = match[2];  // e.g., "MATEKF405" or "MATEK-F405"
            return {
                target_id: normalizeTargetName(rawMatch),
                target: rawMatch.replace(/_/g, " ").replace(/-/g, " "),  // Display: "MATEKF405"
                format: match[3],
            };
        }

        $('input.show_development_releases').on('click', function () {
            if (firmwareBackend !== 'inav') {
                return;
            }
            let selectedTarget = String($('select[name="board"]').val());
            GUI.log(i18n.getMessage('selectedTarget') + selectedTarget);
            buildBoardOptions();
            GUI.log(i18n.getMessage('toggledRCs'));
            if (selectedTarget === "0") {
                firmwareFlasherTab.getTarget();
            } else {
                $('select[name="board"] option[value="' + selectedTarget + '"]').attr("selected", "selected");
                $('select[name="board"]').trigger('change');
            }
        });

        $('.target_search').on('input', function(){
            var searchText = $('.target_search').val().toLocaleLowerCase();

            $('#board_targets option').each(function(i){
                var target = $(this);
                //alert("Comparing " + searchText + " with " + target.text());
                if (searchText.length > 0 && i !== 0) { 
                    if (target.text().toLowerCase().includes(searchText) || target.val().toLowerCase().includes(searchText)) {
                        target.show();
                    } else {
                        target.hide();
                    }
                } else {
                    target.show();
                }
            });
        });

        var buildBoardOptions = function(releasesData) {
            const start = performance.now();
            var boards_e = $('select[name="board"]').empty();
            var versions_e = $('select[name="firmware_version"]').empty();
            var showDevReleases = ($('input.show_development_releases').is(':checked'));
            
            boards_e.append($("<option value='0'>{0}</option>".format(i18n.getMessage('firmwareFlasherOptionLabelSelectBoard'))));
            versions_e.append($("<option value='0'>{0}</option>".format(i18n.getMessage('firmwareFlasherOptionLabelSelectFirmwareVersion'))));

            var releases = {};
            var sortedTargets = [];
            var unsortedTargets = [];

            (firmwareFlasherTab.inavReleasesData || []).forEach(function(release){
                release.assets.forEach(function(asset){
                    var result = parseFilename(asset.name);

                    if ((!showDevReleases && release.prerelease) || !result) {
                        return;
                    }
                    if($.inArray(result.target_id, unsortedTargets) == -1) {
                        unsortedTargets.push(result.target_id);
                    }
                });
            });

            if (showDevReleases) {
                var majorCount = {};
                (firmwareFlasherTab.inavDevReleasesData || []).forEach(function (release) {
                    release.assets.forEach(function (asset) {
                        var result = parseDevFilename(asset.name);

                        if (result) {
                            if ($.inArray(result.target_id, unsortedTargets) == -1) {
                                unsortedTargets.push(result.target_id);
                            }
                        }
                    });
                });
            }

            sortedTargets = unsortedTargets.sort();

            sortedTargets.forEach(function(release) {
                releases[release] = [];
            });

            (firmwareFlasherTab.inavReleasesData || []).forEach(function(release){

                var versionFromTagExpression = /v?(.*)/;
                var matchVersionFromTag = versionFromTagExpression.exec(release.tag_name);
                var version = matchVersionFromTag[1];

                release.assets.forEach(function(asset){
                    var result = parseFilename(asset.name);
                    if ((!showDevReleases && release.prerelease) || !result) {
                        return;
                    }

                    if (result.format != 'hex') {
                        return;
                    }

                    var date = new Date(release.published_at);
                    var formattedDate = "{0}-{1}-{2} {3}:{4}".format(
                            date.getFullYear(),
                            date.getMonth() + 1,
                            date.getDate(),
                            date.getUTCHours(),
                            date.getMinutes()
                    );
                    
                    var descriptor = {
                        "releaseUrl": release.html_url,
                        "name"      : semver.clean(release.name),
                        "version"   : release.tag_name,
                        "url"       : asset.browser_download_url,
                        "file"      : asset.name,
                        "target_id" : result.target_id,
                        "target"    : result.target,
                        "date"      : formattedDate,
                        "notes"     : release.body,
                        "status"    : release.prerelease ? "release-candidate" : "stable"
                    };
                    // Skip duplicate entries (e.g. both hyphen and underscore variants of same target+version)
                    if (!releases[result.target_id].some(d => d.version === descriptor.version && d.status === descriptor.status)) {
                        releases[result.target_id].push(descriptor);
                    }
                });
            });

            if(showDevReleases && firmwareFlasherTab.inavDevReleasesData) {
                var majorCount = {};
                firmwareFlasherTab.inavDevReleasesData.forEach(function(release){
                    var major = getReleaseMajor(release.name);

                    if (!(major in majorCount)) {
                        majorCount[major] = 0;
                    }

                    if(majorCount[major] >= 10) {
                        return;
                    }

                    majorCount[major]++;

                    var versionFromTagExpression = /v?(.*)/;
                    var matchVersionFromTag = versionFromTagExpression.exec(release.tag_name);
                    var version = matchVersionFromTag[1];

                    release.assets.forEach(function(asset){
                        var result = parseDevFilename(asset.name);
                        if ((!showDevReleases && release.prerelease) || !result) {
                            return;
                        }

                        if (result.format != 'hex') {
                            return;
                        }

                        var date = new Date(release.published_at);
                        var formattedDate = "{0}-{1}-{2} {3}:{4}".format(
                                date.getFullYear(),
                                date.getMonth() + 1,
                                date.getDate(),
                                date.getUTCHours(),
                                date.getMinutes()
                        );

                        var descriptor = {
                            "releaseUrl": release.html_url,
                            "name"      : semver.clean(release.name),
                            "version"   : release.tag_name,
                            "url"       : asset.browser_download_url,
                            "file"      : asset.name,
                            "target_id" : result.target_id,
                            "target"    : result.target,
                            "date"      : formattedDate,
                            "notes"     : release.body,
                            "status"    : release.prerelease ? "nightly" : "stable"
                        };
                        // Skip duplicate entries (e.g. both hyphen and underscore variants of same target+version)
                        if (!releases[result.target_id].some(d => d.version === descriptor.version && d.status === descriptor.status)) {
                            releases[result.target_id].push(descriptor);
                        }
                    });
                });
            }
            
            var selectTargets = [];
            Object.keys(releases)
                .sort()
                .forEach(function(target, i) {
                    var descriptors = releases[target];
                    descriptors.forEach(function(descriptor){
                        if($.inArray(target, selectTargets) == -1) {
                            selectTargets.push(target);
                            var select_e =
                                    $("<option value='{0}'>{1}</option>".format(
                                            descriptor.target_id,
                                            descriptor.target
                                    )).data('summary', descriptor);
                            boards_e.append(select_e);
                        }
                    });
                });
            firmwareFlasherTab.releases = releases;
            const end = performance.now();
            console.log(`buildBoardOptions: ${end - start} ms`)
            return;
        };

        var buildFlightCommanderBoardOptions = function() {
            const previouslySelectedTarget = normalizeFirmwareTarget(
                $('select[name="board"]').val(),
            );
            const boards = $('select[name="board"]').empty();
            const versions = $('select[name="firmware_version"]').empty();
            boards.append($("<option value='0'>{0}</option>".format(
                i18n.getMessage('firmwareFlasherOptionLabelSelectBoard'),
            )));
            versions.append($("<option value='0'>{0}</option>".format(
                i18n.getMessage('firmwareFlasherOptionLabelSelectFirmwareVersion'),
            )));

            const onlineDescriptors = flightCommanderReleaseDescriptors(
                firmwareFlasherTab.flightCommanderReleasesData || [],
            );
            firmwareFlasherTab.onlineReleases = catalogByTarget(onlineDescriptors);
            firmwareFlasherTab.releases = firmwareFlasherTab.onlineReleases;
            for (const target of FLIGHT_COMMANDER_FIRMWARE_TARGETS) {
                boards.append(
                    $('<option>')
                        .val(target.id)
                        .text(target.name),
                );
            }
            $('a.auto_select_target').toggleClass(
                'disabled',
                !flightCommanderCatalogIsReady(),
            );
            if (firmwareFlasherTab.releases[previouslySelectedTarget]?.length) {
                boards.val(previouslySelectedTarget).trigger('change');
            }
            if (!onlineDescriptors.length) {
                $('span.progressLabel').text(
                    'No published Flight Commander Firmware image is available from GitHub. ' +
                    'Select the detected target and load a local Flight Commander HEX.',
                );
            }
        };

        function selectedFirmwareTarget() {
            return normalizeFirmwareTarget($('select[name="board"]').val());
        }

        function rejectLoadedFirmware(message) {
            parsed_hex = false;
            intel_hex = false;
            localFirmwareLoaded = false;
            loadedFirmwareFamily = null;
            loadedFirmwareDescriptor = null;
            $('a.flash_firmware').addClass('disabled');
            $('span.progressLabel').text(message);
        }

        function acceptParsedFirmware(data, { filename, descriptor = null, local = false } = {}) {
            if (!data) {
                rejectLoadedFirmware(i18n.getMessage('firmwareFlasherHexCorrupted'));
                return false;
            }

            const containsFlightCommanderIdentity =
                parsedHexContainsFlightCommanderIdentity(data);
            if (firmwareBackend === 'flight-commander') {
                if (!containsFlightCommanderIdentity) {
                    rejectLoadedFirmware(
                        'The HEX does not contain the required FCFW firmware identity. ' +
                        'It cannot be flashed as Flight Commander Firmware.',
                    );
                    return false;
                }

                const selectedTarget = selectedFirmwareTarget();
                const embeddedTarget = inferFlightCommanderFirmwareTarget(data);
                let imageDescriptor = descriptor;

                if (local) {
                    imageDescriptor = localFlightCommanderFirmwareDescriptor(data, {
                        filename,
                        selectedTarget,
                    });
                    if (!imageDescriptor) {
                        rejectLoadedFirmware(
                            'The firmware family is valid, but its controller target could not be determined. ' +
                            'Select the controller target and load the local HEX again.',
                        );
                        return false;
                    }
                } else if (!imageDescriptor) {
                    rejectLoadedFirmware(
                        'The online firmware is missing its verified release descriptor.',
                    );
                    return false;
                }

                const imageTarget = normalizeFirmwareTarget(
                    imageDescriptor.target_id || imageDescriptor.target,
                );
                const knownImageTarget = FLIGHT_COMMANDER_FIRMWARE_TARGETS.some(
                    ({ id }) => id === imageTarget,
                );
                if (!knownImageTarget) {
                    rejectLoadedFirmware(
                        `Firmware target ${imageTarget || 'unknown'} is not supported by this Configurator.`,
                    );
                    return false;
                }

                if (!local && embeddedTarget && embeddedTarget !== imageTarget) {
                    rejectLoadedFirmware(
                        `The compiled firmware target ${embeddedTarget} does not match the verified online descriptor target ${imageTarget}.`,
                    );
                    return false;
                }
                if (
                    selectedTarget &&
                    selectedTarget !== '0' &&
                    selectedTarget !== imageTarget
                ) {
                    rejectLoadedFirmware(
                        `Firmware target ${imageTarget} does not match the selected controller target ${selectedTarget}.`,
                    );
                    return false;
                }
                if (selectedTarget === '0') {
                    $('select[name="board"]').val(imageTarget).trigger('change');
                }
                loadedFirmwareDescriptor = imageDescriptor;
            } else if (containsFlightCommanderIdentity) {
                rejectLoadedFirmware(
                    'This HEX contains the Flight Commander Firmware identity. ' +
                    'Select Flight Commander Firmware before flashing it.',
                );
                return false;
            } else {
                loadedFirmwareDescriptor = descriptor;
            }

            parsed_hex = data;
            localFirmwareLoaded = local;
            loadedFirmwareFamily = firmwareBackend;
            $('a.flash_firmware').removeClass('disabled');
            return true;
        }

        firmwareFlasherTab.inavDevReleasesData = [];
        firmwareFlasherTab.inavReleasesData = [];

        $.get(FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL, function (releasesData) {
            firmwareFlasherTab.flightCommanderReleasesData = releasesData;
            flightCommanderCatalogReady = true;
            if (firmwareBackend === 'flight-commander') {
                buildFlightCommanderBoardOptions();
                firmwareFlasherTab.getTarget();
            }
        }).fail(function () {
            firmwareFlasherTab.flightCommanderReleasesData = [];
            flightCommanderCatalogReady = true;
            if (firmwareBackend === 'flight-commander') {
                buildFlightCommanderBoardOptions();
                firmwareFlasherTab.getTarget();
            }
        });

        $('select[name="board"]').on('change', function () {
            $('a.load_remote_file').addClass('disabled');
            const target = normalizeFirmwareTarget($(this).children('option:selected').val());
            const targetDisplay = $(this).children('option:selected').text();

            if (!GUI.connect_lock) {
                $('.progress').val(0).removeClass('valid invalid');
                $('span.progressLabel').text(i18n.getMessage('firmwareFlasherLoadFirmwareFile'));
                $('div.git_info').slideUp();
                $('div.release_info').slideUp();
                $('a.flash_firmware').addClass('disabled');

                const versions = $('select[name="firmware_version"]').empty();
                if (target === '0') {
                    versions.append($("<option value='0'>{0}</option>".format(
                        i18n.getMessage('firmwareFlasherOptionLabelSelectFirmwareVersion'),
                    )));
                } else {
                    versions.append($("<option value='0'>{0} {1}</option>".format(
                        i18n.getMessage('firmwareFlasherOptionLabelSelectFirmwareVersionFor'),
                        targetDisplay,
                    )));
                }

                if (typeof firmwareFlasherTab.releases[target]?.forEach === 'function') {
                    firmwareFlasherTab.releases[target].forEach(function(summary) {
                        if (firmwareBackend === 'flight-commander') {
                            versions.append(
                                $("<option value='{0}'>{0} - {1} - {2} ({3})</option>".format(
                                    summary.version,
                                    summary.target,
                                    summary.date,
                                    summary.status,
                                )).data('summary', summary),
                            );
                            return;
                        }
                        versions.append(
                            $("<option value='{0}'>{0} - {1} - {2} ({3})</option>".format(
                                summary.version,
                                summary.target,
                                summary.date,
                                summary.status,
                            )).data('summary', summary),
                        );
                    });
                }
                if (
                    firmwareBackend === 'flight-commander'
                    && firmwareFlasherTab.releases[target]?.length
                ) {
                    const latest = firmwareFlasherTab.releases[target][0];
                    versions.val(latest.version).trigger('change');
                    $('span.progressLabel').text(
                        flightCommanderSourceStatus(latest, targetDisplay),
                    );
                }
            }
        });

        $('a.load_file').on('click', function () {
            var options = {
                filters: [ { name: "HEX file", extensions: ['hex'] } ]
            };
            dialog.showOpenDialog(options).then(result =>  {
                if (result.canceled) {
                    return;
                }

                let filename;
                if (result.filePaths.length == 1) {
                    filename = result.filePaths[0];
                }
                
                $('div.git_info').slideUp();

                console.log('Loading file from: ' + filename);

                window.electronAPI.readFile(filename).then(response => {

                    if (response.error) {
                        console.log("Error loading local file", response.error);
                        rejectLoadedFirmware('Unable to read the selected firmware file.');
                        return;
                    }

                    console.log('File loaded');

                    parse_hex(response.data.toString(), function (data) {
                        const basename = String(filename).split(/[\\/]/).pop();
                        if (acceptParsedFirmware(data, {
                            filename: basename,
                            local: true,
                        })) {
                            const flashAction = firmwareBackend === 'flight-commander'
                                ? 'Flash Selected Firmware'
                                : i18n.getMessage('firmwareFlasherFlashFirmware');
                            $('span.progressLabel').text(
                                `Local Flight Commander Firmware file selected (${data.bytes_total} bytes). Click ${flashAction}.`,
                            );
                        }
                    });
                });

            });

        });

        /**
         * Lock / Unlock the firmware download button according to the firmware selection dropdown.
         */
        $('select[name="firmware_version"]').on('change', function(evt){
            $('div.release_info').slideUp();
            $('a.flash_firmware').addClass('disabled');
            parsed_hex = false;
            intel_hex = false;
            loadedFirmwareFamily = null;
            loadedFirmwareDescriptor = null;
            if (evt.target.value=="0") {
                $("a.load_remote_file").addClass('disabled');
            }
            else {
                refreshFirmwareSourceButtons(
                    $('select[name="firmware_version"] option:selected').data('summary'),
                );
            }
        });

        function processLoadedFirmware(data, summary, sourceLabel) {
            intel_hex = data;
            localFirmwareLoaded = false;

            parse_hex(intel_hex, function (parsedData) {
                if (acceptParsedFirmware(parsedData, {
                    filename: summary.file,
                    descriptor: summary,
                    local: false,
                })) {
                    const flashAction = firmwareBackend === 'flight-commander'
                        ? 'Flash Selected Firmware'
                        : i18n.getMessage('firmwareFlasherFlashFirmware');
                    $('span.progressLabel').html(
                        '<a class="save_firmware" href="#" title="Save Firmware">' +
                        sourceLabel + ' (' + parsedData.bytes_total + ' bytes)</a>. Click ' +
                        flashAction + '.',
                    );

                    if (summary.commit) {
                        $.get('https://api.github.com/repos/iNavFlight/inav/commits/' + summary.commit, function (commitData) {
                            const d = new Date(commitData.commit.author.date);
                            const offset = d.getTimezoneOffset() / 60;
                            let date = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
                            date += ' @ ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                            date += (offset > 0) ? ' GMT+' + offset : ' GMT' + offset;

                            $('div.git_info .committer').text(commitData.commit.author.name);
                            $('div.git_info .date').text(date);
                            $('div.git_info .hash').text(commitData.sha.slice(0, 7)).prop('href', 'https://api.github.com/repos/iNavFlight/inav/commit/' + commitData.sha);
                            $('div.git_info .message').text(commitData.commit.message);
                            $('div.git_info').slideDown();
                        });
                    }

                    $('div.release_info .target').text(summary.target);
                    const statusElement = $('div.release_info .status');
                    if (summary.status == 'release-candidate') {
                        statusElement.html(i18n.getMessage('firmwareFlasherReleaseStatusReleaseCandidate')).show();
                    } else {
                        statusElement.hide();
                    }

                    $('div.release_info .name').text(summary.name).prop('href', summary.releaseUrl || '#');
                    $('div.release_info .date').text(summary.date);
                    statusElement.text(summary.status);
                    $('div.release_info .file').text(summary.file).prop('href', summary.url || '#');
                    $('div.release_info .notes').html(marked.parse(summary.notes));
                    $('div.release_info .notes a').each(function () {
                        $(this).attr('target', '_blank');
                    });
                    $('div.release_info').slideDown();
                }
            });
        }

        $('a.load_remote_file').on('click', function () {
            if ($(this).hasClass('disabled')) return;
            if ($('select[name="firmware_version"]').val() == "0") {
                GUI.log(i18n.getMessage('noFirmwareSelectedToLoad'));
                return;
            }

            const selected = $('select[name="firmware_version"] option:selected').data('summary');
            const summary = firmwareBackend === 'flight-commander'
                ? selected
                : selected;
            if (!summary?.url) {
                $('span.progressLabel').text(
                    'No online firmware asset is available for the selected version.',
                );
                refreshFirmwareSourceButtons(selected);
                return;
            }

            fileName = summary.file;
            $('a.load_remote_file')
                .text(i18n.getMessage('firmwareFlasherButtonLoading'))
                .addClass('disabled');

            if (firmwareBackend === 'flight-commander') {
                fetch(summary.url, { cache: 'no-store' })
                    .then((response) => {
                        if (!response.ok) {
                            throw new Error(`GitHub returned HTTP ${response.status}.`);
                        }
                        return response.arrayBuffer();
                    })
                    .then((payload) => verifyFlightCommanderOnlinePayload(payload, summary))
                    .then((verifiedHex) => {
                        refreshFirmwareSourceButtons(selected);
                        processLoadedFirmware(
                            verifiedHex,
                            summary,
                            'Online firmware downloaded and SHA-256 verified',
                        );
                    })
                    .catch((error) => {
                        console.warn('Online Flight Commander Firmware download failed:', error);
                        $('span.progressLabel').text(
                            'Online firmware download failed. You can retry or load a local firmware file.',
                        );
                        $('a.flash_firmware').addClass('disabled');
                        refreshFirmwareSourceButtons(selected);
                    });
                return;
            }

            $.get(summary.url, function (data) {
                refreshFirmwareSourceButtons(summary);
                processLoadedFirmware(data, summary, 'Online firmware downloaded');
            }).fail(function () {
                $('span.progressLabel').text(i18n.getMessage('firmwareFlasherFailedToLoadOnlineFirmware'));
                $('a.flash_firmware').addClass('disabled');
                refreshFirmwareSourceButtons(summary);
            });
        });

        $('a.flash_firmware').on('click', function () {
            if (!$(this).hasClass('disabled')) {
                if (!GUI.connect_lock) { // button disabled while flashing is in progress
                    if (parsed_hex != false) {
                        if (loadedFirmwareFamily !== firmwareBackend) {
                            rejectLoadedFirmware(
                                'The selected firmware family changed after this image was loaded. Reload the image before flashing.',
                            );
                            return;
                        }
                        if (
                            firmwareBackend === 'flight-commander' &&
                            loadedFirmwareDescriptor &&
                            normalizeFirmwareTarget(
                                loadedFirmwareDescriptor.target_id || loadedFirmwareDescriptor.target,
                            ) !== selectedFirmwareTarget()
                        ) {
                            rejectLoadedFirmware(
                                'The selected controller target no longer matches the loaded Flight Commander Firmware image. Reload the correct image.',
                            );
                            return;
                        }
                        var options = {};
                        var skipAutoRestore = false;

                        if ($('input.erase_chip').is(':checked')) {
                            options.erase_chip = true;
                        }

                        var originalPort = String($('div#port-picker #port').val());
                        var originalBaud = parseInt($('div#port-picker #baud').val());

                        var currentVersion = (FC.CONFIG && FC.CONFIG.flightControllerVersion) ? FC.CONFIG.flightControllerVersion : null;
                        var selectedSummary = $('select[name="firmware_version"] option:selected').data('summary');
                        var targetVersion = (
                            firmwareBackend === 'inav' && !localFirmwareLoaded && selectedSummary
                        ) ? semver.clean(selectedSummary.version) : null;
                        var isMinorOrMajorUpdate = false;

                        if (currentVersion && targetVersion && semver.valid(currentVersion) && semver.valid(targetVersion)) {
                            var diffType = semver.diff(currentVersion, targetVersion);
                            if (diffType && diffType !== 'patch' && diffType !== 'prepatch' && diffType !== 'prerelease') {
                                isMinorOrMajorUpdate = true;
                            }
                        }

                        if (isMinorOrMajorUpdate && !options.erase_chip) {
                            showVersionWarning(currentVersion, targetVersion, function onContinue() {
                                skipAutoRestore = true;
                                proceedWithFlash();
                            });
                            return; // wait for user decision
                        }

                        proceedWithFlash();
                        return;

                        function showVersionWarning(fromVer, toVer, onContinue) {
                            var $warn = $('#version-warning-overlay');
                            $warn.find('.version-warning-overlay__text').text(
                                i18n.getMessage('firmwareFlasherVersionWarningText', [fromVer, toVer])
                            );
                            $warn.removeClass('is-hidden');
                            i18n.localize($warn);

                            var $continueBtn = $warn.find('.version-warning-overlay__btn--continue');
                            var $cancelBtn = $warn.find('.version-warning-overlay__btn--cancel');

                            function cleanup() {
                                $continueBtn.off('click.versionWarn');
                                $cancelBtn.off('click.versionWarn');
                                $warn.addClass('is-hidden');
                            }

                            $cancelBtn.on('click.versionWarn', function(e) {
                                e.preventDefault();
                                cleanup();
                            });

                            $continueBtn.on('click.versionWarn', function(e) {
                                e.preventDefault();
                                cleanup();
                                onContinue();
                            });
                        }

                        function proceedWithFlash() {
                        BackupRestore.clearLastAutoBackup();

                        var restoreFlow = new FlashRestoreFlow({
                            options,
                            skipAutoRestore,
                            originalPort,
                            originalBaud,
                            targetVersion,
                            disconnectSafely,
                        });

                        if (String($('div#port-picker #port').val()) != 'DFU') {
                            if (String($('div#port-picker #port').val()) != '0') {
                                var port = String($('div#port-picker #port').val()),
                                    baud;

                                switch (GUI.operating_system) {
                                    case 'Windows':
                                    case 'MacOS':
                                    case 'ChromeOS':
                                    case 'Linux':
                                    case 'UNIX':
                                        baud = 921600;
                                        break;

                                    default:
                                        baud = 115200;
                                }

                                if ($('input.updating').is(':checked')) {
                                    options.no_reboot = true;
                                } else {
                                    options.reboot_baud = parseInt($('div#port-picker #baud').val());
                                }

                                if ($('input.flash_manual_baud').is(':checked')) {
                                    baud = parseInt($('#flash_manual_baud_rate').val());
                                }

                                if (!options.no_reboot) {
                                    options.onCliReady = BackupRestore.createOnCliReadyHandler(function(msgKey) {
                                        $('span.progressLabel').text(i18n.getMessage(msgKey));
                                    });
                                }

                                STM32.connect(port, baud, parsed_hex, options, success => {
                                    if (success === true) restoreFlow.onFlashComplete();
                                });
                            } else {
                                console.log('Please select valid serial port');
                                GUI.log(i18n.getMessage('selectValidSerialPort'));
                            }
                        } else {
                            STM32DFU.connect(usbDevices, parsed_hex, options, success => {
                                if (success === true) restoreFlow.onFlashComplete();
                            });
                        }

                        } // end proceedWithFlash

                    } else {
                        $('span.progressLabel').text(i18n.getMessage('firmwareFlasherFirmwareNotLoaded'));
                    }
                }
            }
        });

        $('a.backup_config').on('click', function () {
            if (GUI.connect_lock) return;

            var port = String($('div#port-picker #port').val());
            if (port === '0' || port === 'DFU') {
                GUI.log(i18n.getMessage('selectValidSerialPort'));
                return;
            }

            $('span.progressLabel').text(i18n.getMessage('backupRestoreStatusConnecting'));

            var rebootBaud = parseInt($('div#port-picker #baud').val());
            GUI.connect_lock = true;

            CONFIGURATOR.connection.connect(port, {bitrate: rebootBaud}, function(openInfo) {
                if (!openInfo) {
                    GUI.connect_lock = false;
                    GUI.log(i18n.getMessage('failedToOpenSerialPort'));
                    return;
                }

                BackupRestore.performBackupToFile(function(msgKey) {
                    $('span.progressLabel').text(i18n.getMessage(msgKey));
                }).then(function(result) {
                    if (result) {
                        GUI.log(i18n.getMessage('backupRestoreBackupSaved', [result.filePath]));
                        $('span.progressLabel').text(i18n.getMessage('backupRestoreBackupComplete'));
                    } else {
                        $('span.progressLabel').text(i18n.getMessage('backupRestoreBackupCancelled'));
                    }
                    disconnectSafely(function() {
                        GUI.connect_lock = false;
                    });
                }).catch(function(err) {
                    console.error('Backup failed:', err);
                    GUI.log(i18n.getMessage('backupRestoreBackupFailed'));
                    $('span.progressLabel').text(i18n.getMessage('backupRestoreBackupFailed'));
                    disconnectSafely(function() {
                        GUI.connect_lock = false;
                    });
                });
            });
        });

        $('a.restore_config').on('click', async function () {
            if (GUI.connect_lock) return;

            var port = String($('div#port-picker #port').val());
            if (port === '0' || port === 'DFU') {
                GUI.log(i18n.getMessage('selectValidSerialPort'));
                return;
            }

            var backupDir = await window.electronAPI.getBackupDir();
            var fileResult = await window.electronAPI.showOpenDialog({
                defaultPath: backupDir,
                filters: [
                    { name: 'CLI/TXT', extensions: ['cli', 'txt'] },
                    { name: 'ALL', extensions: ['*'] },
                ],
                properties: ['openFile'],
            });

            if (fileResult.canceled || !fileResult.filePaths || fileResult.filePaths.length === 0) {
                $('span.progressLabel').text(i18n.getMessage('backupRestoreRestoreCancelled'));
                return;
            }

            var fileResponse = await window.electronAPI.readFile(fileResult.filePaths[0]);
            if (fileResponse.error) {
                GUI.log(i18n.getMessage('backupRestoreRestoreFailed'));
                $('span.progressLabel').text(i18n.getMessage('backupRestoreRestoreFailed'));
                return;
            }

            var fileData = fileResponse.data;

            var $overlay = $('#restore-overlay');
            var $overlayStatus = $overlay.find('.restore-overlay__status');
            var $overlayFill = $overlay.find('.restore-overlay__progress-fill');
            var $overlayText = $overlay.find('.restore-overlay__progress-text');
            $overlayFill.css('width', '0%');
            $overlayText.text('');
            $overlayStatus.text(i18n.getMessage('backupRestoreStatusConnecting'));
            $overlay.removeClass('is-hidden');

            $('span.progressLabel').text(i18n.getMessage('backupRestoreStatusConnecting'));

            var rebootBaud = parseInt($('div#port-picker #baud').val());
            GUI.connect_lock = true;

            CONFIGURATOR.connection.connect(port, {bitrate: rebootBaud}, function(openInfo) {
                if (!openInfo) {
                    $overlay.addClass('is-hidden');
                    GUI.connect_lock = false;
                    GUI.log(i18n.getMessage('failedToOpenSerialPort'));
                    return;
                }

                $overlayStatus.text(i18n.getMessage('backupRestoreStatusConnecting'));
                MSP.disconnect_cleanup();
                var mspListener = function(info) { MSP.read(info); };
                CONFIGURATOR.connection.addOnReceiveCallback(mspListener);

                var versionQueryDone = false;
                var versionQueryTimeout = setTimeout(function() {
                    if (!versionQueryDone) {
                        versionQueryDone = true;
                        CONFIGURATOR.connection.removeOnReceiveCallback(mspListener);
                        console.warn('MSP_FC_VERSION query timed out, using cached version');
                        proceedAfterVersionQuery();
                    }
                }, 3000);

                MSP.send_message(MSPCodes.MSP_FC_VERSION, false, false, function() {
                    if (!versionQueryDone) {
                        versionQueryDone = true;
                        clearTimeout(versionQueryTimeout);
                        CONFIGURATOR.connection.removeOnReceiveCallback(mspListener);
                        proceedAfterVersionQuery();
                    }
                });

                function proceedAfterVersionQuery() {
                    var currentFcVersion = FC.CONFIG.flightControllerVersion;
                    var { dataToRestore, migrationResult } = prepareRestoreData(fileData, currentFcVersion);

                    if (migrationResult && (migrationResult.summary.totalChanges > 0 ||
                                           migrationResult.summary.warnings.length > 0)) {
                        $overlay.addClass('is-hidden');
                        showMigrationPreview(migrationResult.summary, function onContinue() {
                            GUI.log(i18n.getMessage('backupRestoreMigrationApplied', [
                                migrationResult.summary.fromVersion,
                                migrationResult.summary.toVersion,
                                migrationResult.summary.totalChanges.toString()
                            ]));
                            $overlay.removeClass('is-hidden');
                            executeRestore(port, rebootBaud, dataToRestore, $overlay, { disconnectSafely });
                        }, function onCancel() {
                            $('span.progressLabel').text(i18n.getMessage('backupRestoreRestoreCancelled'));
                            disconnectSafely(function() { GUI.connect_lock = false; });
                        });
                    } else {
                        executeRestore(port, rebootBaud, dataToRestore, $overlay, { disconnectSafely });
                    }
                }
            });
        });

        $('a.open_backups_folder').on('click', function (e) {
            e.preventDefault();
            window.electronAPI.openBackupDir();
        });

        $(document).on('click', 'span.progressLabel a.save_firmware', function () {
            var options = {
                defaultPath: fileName,
                filters: [ {name: "HEX File", extensions: ['hex'] } ]
            };
            dialog.showSaveDialog(options).then(result => {
                if (result.canceled) {
                    return;
                }
                fs.writeFileSync(result.filePath, intel_hex, (err) => {
                    if (err) {
                        GUI.log(i18n.getMessage('ErrorWritingFile'));
                        return console.error(err);
                    }
                });
                let sFilename = String(result.filePath.split('\\').pop().split('/').pop());
                GUI.log(sFilename + i18n.getMessage('savedSuccessfully'));
            });
        });

        
        if (store.get('no_reboot_sequence', false)) {
            $('input.updating').prop('checked', true);
            $('.flash_on_connect_wrapper').show();
        } else {
            $('input.updating').prop('checked', false);
        }

        // bind UI hook so the status is saved on change
        $('input.updating').on('change', function () {
            var status = $(this).is(':checked');

            if (status) {
                $('.flash_on_connect_wrapper').show();
            } else {
                $('input.flash_on_connect').prop('checked', false).trigger('change');
                $('.flash_on_connect_wrapper').hide();
            }

            store.set('no_reboot_sequence', status);
        });

        $('input.updating').trigger('change');
        
        if (store.get('flash_manual_baud', false)) {
            $('input.flash_manual_baud').prop('checked', true);
        } else {
            $('input.flash_manual_baud').prop('checked', false);
        }

        // bind UI hook so the status is saved on change
        $('input.flash_manual_baud').on('change', function () {
            var status = $(this).is(':checked');
            store.set('flash_manual_baud', status);
        });

        $('input.flash_manual_baud').trigger('change');
        

        var flash_manual_baud_rate = store.get('flash_manual_baud_rate', '');
        $('#flash_manual_baud_rate').val(flash_manual_baud_rate);

        // bind UI hook so the status is saved on change
        $('#flash_manual_baud_rate').on('change', function () {
            var baud = parseInt($('#flash_manual_baud_rate').val());
            store.set('flash_manual_baud_rate', baud);
        });

        $('input.flash_manual_baud_rate').trigger('change');

        
        if (store.get('flash_on_connect', false)) {
            $('input.flash_on_connect').prop('checked', true);
        } else {
            $('input.flash_on_connect').prop('checked', false);
        }

        $('input.flash_on_connect').on('change', function () {
            var status = $(this).is(':checked');

            if (status) {
                var catch_new_port = function () {
                    PortHandler.port_detected('flash_detected_device', function (result) {
                        var port = result[0];

                        if (!GUI.connect_lock) {
                            GUI.log('Detected: <strong>' + port + '</strong> - triggering flash on connect');
                            console.log('Detected: ' + port + ' - triggering flash on connect');

                            // Trigger regular Flashing sequence
                            timeout.add('initialization_timeout', function () {
                                $('a.flash_firmware').trigger( "click" );
                            }, 100); // timeout so bus have time to initialize after being detected by the system
                        } else {
                            GUI.log('Detected <strong>' + port + '</strong> - previous device still flashing, please replug to try again');
                        }

                        // Since current port_detected request was consumed, create new one
                        catch_new_port();
                    }, false, true);
                };

                catch_new_port();
            } else {
                PortHandler.flush_callbacks();
            }

            store.set('flash_on_connect', status);
        }).trigger('change');
        

        
        if (store.get('erase_chip', false)) {
            $('input.erase_chip').prop('checked', true);
        } else {
            $('input.erase_chip').prop('checked', false);
        }

        // bind UI hook so the status is saved on change
        $('input.erase_chip').on('change', async function () {
            store.set('erase_chip', $(this).is(':checked'));
        });

        $('input.erase_chip').trigger('change');

        

        $(document).keypress(function (e) {
            if (e.which == 13) { // enter
                // Trigger regular Flashing sequence
                $('a.flash_firmware').trigger( "click" );
            }
        });

        $('a.auto_select_target').on('click', function () {
            firmwareFlasherTab.getTarget();
        });

        setFirmwareBackend('flight-commander');
        GUI.content_ready(callback);
    }));
};

firmwareFlasherTab.FLASH_MESSAGE_TYPES = {NEUTRAL : 'NEUTRAL',
                                             VALID   : 'VALID',
                                             INVALID : 'INVALID',
                                             ACTION  : 'ACTION'};

firmwareFlasherTab.flashingMessage = function(message, type) {
    let self = this;

    let progressLabel_e = $('span.progressLabel');
    switch (type) {
        case self.FLASH_MESSAGE_TYPES.VALID:
            progressLabel_e.removeClass('invalid actionRequired')
                           .addClass('valid');
            break;
        case self.FLASH_MESSAGE_TYPES.INVALID:
            progressLabel_e.removeClass('valid actionRequired')
                           .addClass('invalid');
            break;
        case self.FLASH_MESSAGE_TYPES.ACTION:
            progressLabel_e.removeClass('valid invalid')
                           .addClass('actionRequired');
            break;
        case self.FLASH_MESSAGE_TYPES.NEUTRAL:
        default:
            progressLabel_e.removeClass('valid invalid actionRequired');
            break;
    }
    if (message != null) {
        progressLabel_e.html(message);
    }

    return self;
};

firmwareFlasherTab.flashProgress = function(value) {
    $('.progress').val(value);

    return this;
};

firmwareFlasherTab.cleanup = function (callback) {
    PortHandler.flush_callbacks();

    // unbind "global" events
    $(document).unbind('keypress');
    $(document).off('click', 'span.progressLabel a');
    if (callback) callback();
};

firmwareFlasherTab.getTarget = function() {
    GUI.log(i18n.getMessage('automaticTargetSelect'));
    
    var selected_baud = parseInt($('#baud').val());
    var selected_port = $('#port').find('option:selected').data().isManual ? $('#port-override').val() : String($('#port').val());
    
    if (selected_port !== 'DFU') {
        if (!selected_port || selected_port == '0') {
            GUI.log(i18n.getMessage('targetPrefetchFailNoPort'));
        } else {
            console.log('Connecting to: ' + selected_port);
            GUI.connecting_to = selected_port;

            if (selected_port == 'tcp' || selected_port == 'udp') {
                CONFIGURATOR.connection.connect($portOverride.val(), {}, firmwareFlasherTab.onOpen);
            } else {
                CONFIGURATOR.connection.connect(selected_port, {bitrate: selected_baud}, firmwareFlasherTab.onOpen);
            }
        }
    } else {
        GUI.log(i18n.getMessage('targetPrefetchFailDFU'));
    }
};

firmwareFlasherTab.onOpen = async function(openInfo) {
    if (openInfo) {
        GUI.connected_to = GUI.connecting_to;

        // reset connecting_to
        GUI.connecting_to = false;

        // save selected port with chrome.storage if the port differs
        var last_used_port = store.get('last_used_port', '');
        if (last_used_port) {
            if (last_used_port != GUI.connected_to) {
                // last used port doesn't match the one found in local db, we will store the new one
                store.set('last_used_port', GUI.connected_to);
            }
        } else {
            // variable isn't stored yet, saving
            store.set('last_used_port', GUI.connected_to);
        }
        

        store.set('last_used_bps', CONFIGURATOR.connection.bitrate);
        store.set('wireless_mode_enabled', $('#wireless-mode').is(":checked"));

        CONFIGURATOR.connection.addOnReceiveListener(SerialBackend.read_serial);

        // disconnect after 10 seconds with error if we don't get IDENT data
        timeout.add('connecting', function () {
            if (!CONFIGURATOR.connectionValid) {
                GUI.log(i18n.getMessage('targetPrefetchFail') + i18n.getMessage('noConfigurationReceived'));

                firmwareFlasherTab.closeTempConnection();
            }
        }, 10000);

        FC.resetState();

        // request configuration data. Start with MSPv1 and
        // upgrade to MSPv2 if possible.
        MSP.protocolVersion = MSP.constants.PROTOCOL_V2;
        MSP.send_message(MSPCodes.MSP_API_VERSION, false, false, function () {
            
            if (FC.CONFIG.apiVersion === "0.0.0") {
                GUI.log("Cannot prefetch target: <span style='color: red; font-weight: bolder'><strong>" + i18n.getMessage("illegalStateRestartRequired") + "</strong></span>");
                FC.restartRequired = true;
                return;
            }

            MSP.send_message(MSPCodes.MSP_FC_VARIANT, false, false, function () {
                const reportedVariant = FC.CONFIG.flightControllerIdentifier;
                if (isInavCompatibleFirmwareVariant(reportedVariant)) {
                    MSP.send_message(MSPCodes.MSP_FC_VERSION, false, false, function () {
                        const reportedVersion = FC.CONFIG.flightControllerVersion;
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
                                    'Cannot prefetch target: the controller did not provide a supported Flight Commander FCFW identity.',
                                );
                                firmwareFlasherTab.closeTempConnection();
                                return;
                            }
                            applyFirmwareIdentity(FC, identity);
                            if (semver.lt(FC.CONFIG.flightControllerVersion, "5.0.0")) {
                                GUI.log(i18n.getMessage('targetPrefetchFailOld'));
                                firmwareFlasherTab.closeTempConnection();
                                return;
                            }
                            GUI.log(
                                `Detected Flight Commander Firmware ${identity.firmwareVersion || 'unknown'} ` +
                                `(protocol baseline ${identity.compatibleInavVersion}).`,
                            );
                            mspHelper.getCraftName(function(name) {
                                if (name) {
                                    FC.CONFIG.name = name;
                                }
                                firmwareFlasherTab.onValidFirmware();
                            });
                        });
                    });
                } else {
                    GUI.log(i18n.getMessage('targetPrefetchFailNonINAV'));
                    firmwareFlasherTab.closeTempConnection();
                }
            });
        });
    } else {
        GUI.log(i18n.getMessage('targetPrefetchFail') + i18n.getMessage('serialPortOpenFail'));
        return;
    }
};

firmwareFlasherTab.onValidFirmware = function() {
    MSP.send_message(MSPCodes.MSP_BUILD_INFO, false, false, function () {
        MSP.send_message(MSPCodes.MSP_BOARD_INFO, false, false, function () {
            var boardSelect = $('select[name="board"]');
            var normalizedTarget = normalizeFirmwareTarget(FC.CONFIG.target);
            boardSelect.val(normalizedTarget);

            GUI.log(i18n.getMessage('targetPrefetchsuccessful') + FC.CONFIG.target);

            firmwareFlasherTab.closeTempConnection();

            // Only trigger change if the board was actually found and selected
            if (boardSelect.val() === normalizedTarget) {
                boardSelect.trigger('change');
            }
        });
    });
};

firmwareFlasherTab.closeTempConnection = function() {
    timeout.killAll();
    interval.killAll(['global_data_refresh', 'msp-load-update', 'ltm-connection-check']);

    mspQueue.flush();
    mspQueue.freeHardLock();
    mspQueue.freeSoftLock();
    mspDeduplicationQueue.flush();
    CONFIGURATOR.connection.emptyOutputBuffer();

    CONFIGURATOR.connectionValid = false;
    GUI.connected_to = false;

    CONFIGURATOR.connection.disconnect();
    MSP.disconnect_cleanup();
};
export default firmwareFlasherTab;
