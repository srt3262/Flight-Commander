#!/usr/bin/env python3
"""Apply the Flight Commander 4.0.0 Configurator moving-baseline changes.

The script is intentionally idempotent. It is used by the development workflow
so the branch contains normal reviewable source files rather than a generated
runtime-only patch.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if new in value:
        return
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}: {old[:100]!r}")
    write(path, value.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected_minimum: int = 1) -> None:
    value = read(path)
    if old not in value:
        if new in value:
            return
        raise RuntimeError(f"{path}: replacement target not found: {old[:100]!r}")
    if value.count(old) < expected_minimum:
        raise RuntimeError(f"{path}: too few replacement targets")
    write(path, value.replace(old, new))


def update_versions() -> None:
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = "4.0.0"
    fc = package.setdefault("flightCommander", {})
    fc["firmwareMajor"] = 4
    fc["firmwareReleaseVersion"] = "4.0.0"
    fc["firmwareChangedInRelease"] = True
    fc["firmwareSourceAvailable"] = True
    fc["firmwareSourceVersion"] = "4.0.0"
    fc["firmwareSourceArchive"] = "release/firmware/Flight-Commander-Firmware-Source-v4.0.0.zip"
    # The coordinated build workflow replaces these after producing the exact artifacts.
    fc["firmwareReleaseSha256"] = "PENDING_4_0_0_BUILD"
    fc["firmwareSourceSha256"] = "PENDING_4_0_0_BUILD"
    fc["firmwareSourceRevision"] = "PENDING_4_0_0_BUILD"
    fc["firmwareSourceTree"] = "PENDING_4_0_0_BUILD"
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "4.0.0"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def patch_identity() -> None:
    replace_once(
        "js/flightCommander/firmwareIdentity.js",
        "  MOVING_BASELINE_YAW: 1 << 12,\n",
        "  MOVING_BASELINE_YAW: 1 << 12,\n  DRONECAN_MOVING_BASELINE_MANAGER: 1 << 13,\n",
    )
    replace_once(
        "js/flightCommander/firmwareIdentity.js",
        '''  movingBaselineYaw: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MOVING_BASELINE_YAW,
    capabilityName: "MOVING_BASELINE_YAW",
    label: "Dual-GNSS moving-baseline yaw",
  }),
''',
        '''  movingBaselineYaw: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MOVING_BASELINE_YAW,
    capabilityName: "MOVING_BASELINE_YAW",
    label: "Dual-GNSS moving-baseline yaw",
  }),
  dronecanMovingBaselineManager: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.DRONECAN_MOVING_BASELINE_MANAGER,
    capabilityName: "DRONECAN_MOVING_BASELINE_MANAGER",
    label: "Two-node DroneCAN moving-baseline setup manager",
  }),
''',
    )


def patch_msp() -> None:
    replace_once(
        "js/msp/MSPCodes.js",
        "    MSP2_FLIGHT_COMMANDER_DRONECAN_NODES: 0x2F12,\n",
        "    MSP2_FLIGHT_COMMANDER_DRONECAN_NODES: 0x2F12,\n"
        "    MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_STATUS: 0x2F13,\n"
        "    MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_COMMAND: 0x2F14,\n",
    )

    replace_once(
        "js/msp/MSPHelper.js",
        "} from './../flightCommander/dualGps';\n",
        "} from './../flightCommander/dualGps';\n"
        "import {\n"
        "    decodeDronecanPairStatus,\n"
        "    encodeDronecanPairCommand,\n"
        "} from './../flightCommander/dronecanMovingBaseline';\n",
    )
    replace_once(
        "js/msp/MSPHelper.js",
        '''            case MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_CONFIG:
                if (data.byteLength >= 4) {
                    Object.assign(FC.DRONECAN_CONFIG, decodeDronecanConfig(data));
                }
                break;
''',
        '''            case MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_CONFIG:
                if (data.byteLength >= 4) {
                    Object.assign(FC.DRONECAN_CONFIG, decodeDronecanConfig(data));
                }
                break;

            case MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_STATUS:
                Object.assign(FC.DRONECAN_PAIR_STATUS, decodeDronecanPairStatus(data));
                break;

            case MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_COMMAND:
                // Empty ACK confirms that the disarmed pair-management command was accepted.
                break;
''',
    )
    replace_once(
        "js/msp/MSPHelper.js",
        '''    self.loadDronecanNodes = function (callback) {
        MSP.send_message(MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_NODES, false, false, callback);
    };

    self.saveDronecanConfig = function (callback) {
''',
        '''    self.loadDronecanNodes = function (callback) {
        MSP.send_message(MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_NODES, false, false, callback);
    };

    self.loadDronecanPairStatus = function (callback) {
        MSP.send_message(MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_STATUS, false, false, callback);
    };

    self.sendDronecanPairCommand = function (command, callback) {
        MSP.send_message(
            MSPCodes.MSP2_FLIGHT_COMMANDER_DRONECAN_PAIR_COMMAND,
            [...encodeDronecanPairCommand(command)],
            false,
            callback,
        );
    };

    self.saveDronecanConfig = function (callback) {
''',
    )


def patch_fc_state() -> None:
    replace_once(
        "js/fc.js",
        "    DRONECAN_STATUS: null,\n",
        "    DRONECAN_STATUS: null,\n    DRONECAN_PAIR_STATUS: null,\n",
    )
    replace_once(
        "js/fc.js",
        '''        this.DRONECAN_CONFIG = {
            nodeId: 10,
            bitrate: 3,
            gpsNodeId: 255,
            batteryNodeId: 255,
            primaryGpsSource: 0,
            magNodeId: 255
        };
''',
        '''        this.DRONECAN_CONFIG = {
            schema: 2,
            nodeId: 10,
            bitrate: 3,
            navigationNodeId: 255,
            gpsNodeId: 255,
            batteryNodeId: 255,
            primaryGpsSource: 0,
            magNodeId: 255,
            movingBaseNodeId: 255,
            movingRoverNodeId: 255,
            requireApPeriphIdentity: true,
            baseTermination: 0,
            roverTermination: 0
        };
''',
    )
    replace_once(
        "js/fc.js",
        '''        this.DRONECAN_STATUS = {
            state: 0,
            bitrateKbps: 0,
            nodes: []
        };
''',
        '''        this.DRONECAN_STATUS = {
            state: 0,
            bitrateKbps: 0,
            nodes: []
        };

        this.DRONECAN_PAIR_STATUS = {
            schema: 1,
            state: 0,
            progress: 0,
            errorCode: 0,
            activeNodeId: 0,
            baseOnline: false,
            roverOnline: false,
            baseRoleVerified: false,
            roverRoleVerified: false,
            baseIdentityValid: false,
            roverIdentityValid: false,
            relativeHeadingFresh: false,
            configured: false,
            baseNodeId: 255,
            roverNodeId: 255,
            baseFixType: 0,
            baseSatellites: 0,
            baseAgeMs: 65535,
            roverFixType: 0,
            roverSatellites: 0,
            roverAgeMs: 65535,
            baseGpsType: -1,
            roverGpsType: -1,
            baseAutoConfig: -1,
            roverAutoConfig: -1,
            baseTermination: -1,
            roverTermination: -1,
            relativeHeadingCentidegrees: 0,
            relativeAccuracyCentidegrees: 65535,
            relativeDistanceCm: 0,
            relativeAgeMs: 65535,
            relativeHeadingCount: 0,
            serviceRequestCount: 0,
            serviceResponseCount: 0,
            serviceTimeoutCount: 0,
            baseSoftwareMajor: 0,
            baseSoftwareMinor: 0,
            roverSoftwareMajor: 0,
            roverSoftwareMinor: 0,
            baseName: '',
            roverName: ''
        };
''',
    )


def patch_heading_contract() -> None:
    replace_all(
        "js/flightCommander/headingFusion.js",
        "Number(dronecanConfig?.gpsNodeId ?? 255)",
        "Number(dronecanConfig?.movingRoverNodeId ?? dronecanConfig?.gpsNodeId ?? 255)",
    )
    replace_once(
        "js/flightCommander/headingFusion.js",
        "Enable a DroneCAN GNSS node before using DroneCAN moving-baseline yaw.",
        "Bind a DroneCAN moving-rover node before using DroneCAN moving-baseline yaw.",
    )


def patch_gps_tab() -> None:
    replace_once(
        "tabs/gps.js",
        "    DRONECAN_NODE_ID_DISABLED,\n    encodeDronecanConfig,\n} from '../js/flightCommander/dualGps';\n",
        "    DRONECAN_NODE_ID_DISABLED,\n"
        "    DRONECAN_TERMINATION_DISABLED,\n"
        "    DRONECAN_TERMINATION_ENABLED,\n"
        "    DRONECAN_TERMINATION_UNCHANGED,\n"
        "    encodeDronecanConfig,\n"
        "} from '../js/flightCommander/dualGps';\n"
        "import {\n"
        "    DRONECAN_PAIR_COMMAND_ABORT,\n"
        "    DRONECAN_PAIR_COMMAND_CONFIGURE,\n"
        "    DRONECAN_PAIR_COMMAND_VERIFY,\n"
        "    DRONECAN_PAIR_ERROR_LABELS,\n"
        "    DRONECAN_PAIR_STATE_LABELS,\n"
        "} from '../js/flightCommander/dronecanMovingBaseline';\n",
    )
    replace_once(
        "tabs/gps.js",
        "    const supportsMovingBaseline = firmwareFeatureSupport(firmwareIdentity, 'movingBaselineYaw').enabled;\n",
        "    const supportsMovingBaseline = firmwareFeatureSupport(firmwareIdentity, 'movingBaselineYaw').enabled;\n"
        "    const supportsDronecanPairManager = firmwareFeatureSupport(firmwareIdentity, 'dronecanMovingBaselineManager').enabled;\n",
    )
    replace_once(
        "tabs/gps.js",
        "        $('#movingBaselineConfig').toggleClass('is-hidden', !supportsMovingBaseline);\n",
        "        $('#movingBaselineConfig').toggleClass('is-hidden', !supportsMovingBaseline);\n"
        "        $('#dronecanMovingBaselinePair').toggleClass('is-hidden', !supportsDronecanPairManager);\n",
    )

    old_render = '''        function renderDronecanGpsConfig() {
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
'''
    new_render = '''        function populatePairNodeSelect(selector, configuredNodeId, roleLabel) {
            const $select = $(selector).empty().append('<option value="255">Disabled</option>');
            let found = configuredNodeId === DRONECAN_NODE_ID_DISABLED;
            for (const node of FC.DRONECAN_STATUS.nodes) {
                if ((node.capabilities & (1 << 0)) === 0) continue;
                $('<option/>').val(node.nodeId).text(`${roleLabel}: ${describeDronecanNode(node)}`).appendTo($select);
                if (node.nodeId === configuredNodeId) found = true;
            }
            if (!found) {
                $('<option/>')
                    .val(configuredNodeId)
                    .text(`${roleLabel}: Node ${configuredNodeId} · configured, not currently detected`)
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
                FC.DRONECAN_CONFIG.navigationNodeId ?? FC.DRONECAN_CONFIG.gpsNodeId,
                1 << 0,
                'Automatic navigation GPS selection',
            );
            populateDronecanNodeSelect(
                '#gpsDronecanMagNode',
                FC.DRONECAN_CONFIG.magNodeId,
                1 << 3,
                'Automatic compass selection',
            );
            if (supportsDronecanPairManager) {
                populatePairNodeSelect('#gpsMovingBaseNode', FC.DRONECAN_CONFIG.movingBaseNodeId, 'Moving base');
                populatePairNodeSelect('#gpsMovingRoverNode', FC.DRONECAN_CONFIG.movingRoverNodeId, 'Moving rover');
                $('#gpsPairRequireApPeriph').prop('checked', FC.DRONECAN_CONFIG.requireApPeriphIdentity !== false);
                $('#gpsMovingBaseTermination').val(String(FC.DRONECAN_CONFIG.baseTermination));
                $('#gpsMovingRoverTermination').val(String(FC.DRONECAN_CONFIG.roverTermination));
            }

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
            FC.DRONECAN_CONFIG.navigationNodeId = Number.parseInt($('#gpsDronecanNode').val(), 10);
            FC.DRONECAN_CONFIG.gpsNodeId = FC.DRONECAN_CONFIG.navigationNodeId;
            FC.DRONECAN_CONFIG.primaryGpsSource = Number.parseInt($('#gpsPrimarySource').val(), 10);
            FC.DRONECAN_CONFIG.magNodeId = Number.parseInt($('#gpsDronecanMagNode').val(), 10);
            if (supportsDronecanPairManager) {
                FC.DRONECAN_CONFIG.movingBaseNodeId = Number.parseInt($('#gpsMovingBaseNode').val(), 10);
                FC.DRONECAN_CONFIG.movingRoverNodeId = Number.parseInt($('#gpsMovingRoverNode').val(), 10);
                FC.DRONECAN_CONFIG.requireApPeriphIdentity = $('#gpsPairRequireApPeriph').prop('checked');
                FC.DRONECAN_CONFIG.baseTermination = Number.parseInt($('#gpsMovingBaseTermination').val(), 10);
                FC.DRONECAN_CONFIG.roverTermination = Number.parseInt($('#gpsMovingRoverTermination').val(), 10);
            }
            encodeDronecanConfig(FC.DRONECAN_CONFIG);
        }

        function renderDronecanPairStatus() {
            if (!supportsDronecanPairManager) return;
            const status = FC.DRONECAN_PAIR_STATUS;
            const fixNames = ['No fix', '2D', '3D', 'RTK Float', 'RTK Fixed'];
            const state = DRONECAN_PAIR_STATE_LABELS[status.state] ?? `State ${status.state}`;
            const error = status.errorCode
                ? ` · ${DRONECAN_PAIR_ERROR_LABELS[status.errorCode] ?? `Error ${status.errorCode}`}`
                : '';
            $('#gpsPairState').text(`${state} · ${status.progress}%${error}`);
            $('#gpsPairProgress').val(status.progress);
            $('#gpsPairBaseIdentity').text(
                `${status.baseName || `Node ${status.baseNodeId}`} · firmware ${status.baseSoftwareMajor}.${status.baseSoftwareMinor}`,
            );
            $('#gpsPairRoverIdentity').text(
                `${status.roverName || `Node ${status.roverNodeId}`} · firmware ${status.roverSoftwareMajor}.${status.roverSoftwareMinor}`,
            );
            $('#gpsPairBaseLive').text(
                `${status.baseOnline ? 'Online' : 'Offline'} · GPS_TYPE ${status.baseGpsType} · ` +
                `${fixNames[status.baseFixType] ?? `Fix ${status.baseFixType}`} · ${status.baseSatellites} satellites`,
            );
            $('#gpsPairRoverLive').text(
                `${status.roverOnline ? 'Online' : 'Offline'} · GPS_TYPE ${status.roverGpsType} · ` +
                `${fixNames[status.roverFixType] ?? `Fix ${status.roverFixType}`} · ${status.roverSatellites} satellites`,
            );
            $('#gpsPairRelativeLive').text(
                status.relativeHeadingFresh
                    ? `${(status.relativeHeadingCentidegrees / 100).toFixed(2)}° · ` +
                      `${(status.relativeAccuracyCentidegrees / 100).toFixed(2)}° accuracy · ` +
                      `${(status.relativeDistanceCm / 100).toFixed(2)} m · ${status.relativeAgeMs} ms`
                    : 'Waiting for rover RelPosHeading; satellite view is required for a live solution.',
            );
            $('#gpsPairServiceStats').text(
                `${status.serviceRequestCount} requests · ${status.serviceResponseCount} responses · ` +
                `${status.serviceTimeoutCount} timeouts`,
            );
        }

        function sendPairCommand(command) {
            try {
                collectDronecanGpsConfig();
            } catch (error) {
                GUI.log(`<span class="error">${$('<div>').text(error.message).html()}</span>`);
                return;
            }
            const buttons = $('#gpsPairConfigure, #gpsPairVerify, #gpsPairAbort').prop('disabled', true);
            mspHelper.saveDronecanConfig(function () {
                mspHelper.saveToEeprom(function () {
                    mspHelper.sendDronecanPairCommand(command, function () {
                        buttons.prop('disabled', false);
                        mspHelper.loadDronecanPairStatus(renderDronecanPairStatus);
                    });
                });
            });
        }
'''
    replace_once("tabs/gps.js", old_render, new_render)

    replace_once(
        "tabs/gps.js",
        '''        $('#gpsDronecanRefresh').on('click.gpsTab', function (event) {
            event.preventDefault();
            const $button = $(this).prop('disabled', true);
            mspHelper.loadDronecanNodes(function () {
                renderDronecanGpsConfig();
                $button.prop('disabled', false);
            });
        });
''',
        '''        $('#gpsDronecanRefresh').on('click.gpsTab', function (event) {
            event.preventDefault();
            const $button = $(this).prop('disabled', true);
            mspHelper.loadDronecanNodes(function () {
                renderDronecanGpsConfig();
                if (supportsDronecanPairManager) {
                    mspHelper.loadDronecanPairStatus(renderDronecanPairStatus);
                }
                $button.prop('disabled', false);
            });
        });
        $('#gpsPairConfigure').on('click.gpsTab', (event) => {
            event.preventDefault();
            sendPairCommand(DRONECAN_PAIR_COMMAND_CONFIGURE);
        });
        $('#gpsPairVerify').on('click.gpsTab', (event) => {
            event.preventDefault();
            sendPairCommand(DRONECAN_PAIR_COMMAND_VERIFY);
        });
        $('#gpsPairAbort').on('click.gpsTab', (event) => {
            event.preventDefault();
            mspHelper.sendDronecanPairCommand(DRONECAN_PAIR_COMMAND_ABORT, () => {
                mspHelper.loadDronecanPairStatus(renderDronecanPairStatus);
            });
        });
''',
    )
    replace_once(
        "tabs/gps.js",
        '''        if (supportsDronecanGps) {
            interval.add('flight_commander_dual_gps_pull', function () {
                mspHelper.loadFlightCommanderDualGpsStatus(updateDualGpsUi);
            }, 1000, true);
        }

        if (supportsHeadingFusion) {
''',
        '''        if (supportsDronecanGps) {
            interval.add('flight_commander_dual_gps_pull', function () {
                mspHelper.loadFlightCommanderDualGpsStatus(updateDualGpsUi);
            }, 1000, true);
        }

        if (supportsDronecanPairManager) {
            interval.add('flight_commander_dronecan_pair_pull', function () {
                mspHelper.loadDronecanPairStatus(renderDronecanPairStatus);
            }, 500, true);
        }

        if (supportsHeadingFusion) {
''',
    )
    replace_once(
        "tabs/gps.js",
        "    $('#gpsDronecanRefresh').off('.gpsTab');\n",
        "    $('#gpsDronecanRefresh').off('.gpsTab');\n"
        "    $('#gpsPairConfigure, #gpsPairVerify, #gpsPairAbort').off('.gpsTab');\n",
    )

    pair_html = '''
                        <section id="dronecanMovingBaselinePair" class="gps-moving-baseline-pair is-hidden">
                            <h3>Holybro / AP_Periph two-node moving-baseline setup</h3>
                            <p>
                                Select two fixed DroneCAN node IDs. Flight Commander configures the first F9P as the
                                moving base (<code>GPS_TYPE=17</code>), the second as the moving rover
                                (<code>GPS_TYPE=18</code>), enables GPS auto-configuration, saves both nodes, restarts
                                them, and verifies the role readback. The rover must publish
                                <code>ardupilot.gnss.RelPosHeading</code> before its yaw can enter heading fusion.
                            </p>
                            <div class="gps-can-grid">
                                <label for="gpsMovingBaseNode"><span>Moving-base node</span><select id="gpsMovingBaseNode"></select></label>
                                <label for="gpsMovingRoverNode"><span>Moving-rover node</span><select id="gpsMovingRoverNode"></select></label>
                                <label for="gpsMovingBaseTermination">
                                    <span>Moving-base termination</span>
                                    <select id="gpsMovingBaseTermination">
                                        <option value="0">Leave module setting unchanged</option>
                                        <option value="1">Disable module termination</option>
                                        <option value="2">Enable module termination</option>
                                    </select>
                                </label>
                                <label for="gpsMovingRoverTermination">
                                    <span>Moving-rover termination</span>
                                    <select id="gpsMovingRoverTermination">
                                        <option value="0">Leave module setting unchanged</option>
                                        <option value="1">Disable module termination</option>
                                        <option value="2">Enable module termination</option>
                                    </select>
                                </label>
                                <label class="gps-pair-checkbox" for="gpsPairRequireApPeriph">
                                    <span>Require AP_Periph-compatible identity</span>
                                    <input id="gpsPairRequireApPeriph" type="checkbox" checked>
                                </label>
                            </div>
                            <p class="gps-can-note">
                                Do not enable termination on both modules unless they are the two physical ends of the
                                CAN trunk. A CAN hub or other device may already provide the required end termination.
                            </p>
                            <div class="gps-pair-actions">
                                <button id="gpsPairConfigure" type="button">Configure and verify pair</button>
                                <button id="gpsPairVerify" type="button">Verify current roles</button>
                                <button id="gpsPairAbort" type="button">Abort</button>
                            </div>
                            <progress id="gpsPairProgress" min="0" max="100" value="0"></progress>
                            <dl class="gps-pair-status">
                                <div><dt>Manager</dt><dd id="gpsPairState">Idle</dd></div>
                                <div><dt>Moving base</dt><dd id="gpsPairBaseIdentity">Not selected</dd><dd id="gpsPairBaseLive"></dd></div>
                                <div><dt>Moving rover</dt><dd id="gpsPairRoverIdentity">Not selected</dd><dd id="gpsPairRoverLive"></dd></div>
                                <div><dt>Relative heading</dt><dd id="gpsPairRelativeLive">No solution</dd></div>
                                <div><dt>DroneCAN services</dt><dd id="gpsPairServiceStats">0 requests</dd></div>
                            </dl>
                        </section>
'''
    replace_once(
        "tabs/gps.html",
        '''                        <p class="gps-can-note">
                            UART and DroneCAN receivers remain active together. Either can be the
                            navigation primary, and both retain independent RTK Float/Fixed state and
                            receive RTCM corrections. Battery-node assignments remain available in Ports.
                        </p>
''',
        '''                        <p class="gps-can-note">
                            UART and DroneCAN receivers remain active together. Either can be the
                            navigation primary, and both retain independent RTK Float/Fixed state and
                            receive RTCM corrections. Battery-node assignments remain available in Ports.
                        </p>
''' + pair_html,
    )
    replace_once(
        "tabs/gps.html",
        "<span>DroneCAN GPS / RTK node</span>",
        "<span>DroneCAN navigation GPS / RTK node</span>",
    )
    replace_once(
        "tabs/gps.html",
        "<label><span>Require RTK Fixed</span><input id=\"movingBaselineFixedOnly\" type=\"checkbox\"></label>",
        "<label><span>Require fixed relative-baseline solution</span><input id=\"movingBaselineFixedOnly\" type=\"checkbox\"></label>",
    )


def patch_styles() -> None:
    css = read("src/css/flight-commander.css")
    marker = "/* Flight Commander 4.0.0 DroneCAN moving-baseline pair manager */"
    if marker in css:
        return
    css += '''

/* Flight Commander 4.0.0 DroneCAN moving-baseline pair manager */
.gps-moving-baseline-pair {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
}
.gps-moving-baseline-pair h3 { margin: 0 0 8px; }
.gps-pair-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.gps-moving-baseline-pair progress { width: 100%; height: 12px; }
.gps-pair-status { display: grid; gap: 8px; margin: 12px 0 0; }
.gps-pair-status > div { padding: 8px; background: rgba(0, 0, 0, 0.18); border-radius: 4px; }
.gps-pair-status dt { font-weight: 700; }
.gps-pair-status dd { margin: 2px 0 0; overflow-wrap: anywhere; }
.gps-pair-checkbox { align-items: center; }
'''
    write("src/css/flight-commander.css", css)


def patch_docs() -> None:
    changelog = read("CHANGELOG.md")
    if not changelog.startswith("# Flight Commander 4.0.0"):
        changelog = '''# Flight Commander 4.0.0

- Adds one-stage setup for two Holybro/AP_Periph DroneCAN F9P modules used as an aircraft moving-baseline pair.
- Stores independent navigation, moving-base, moving-rover, compass, and battery node bindings.
- Configures and verifies AP_Periph `CAN_NODE`, `GPS_TYPE`, `GPS_AUTO_CONFIG`, optional `CAN_TERMINATE`, parameter save, and node restart while disarmed.
- Accepts relative heading only from the bound rover and reports per-node fix, role, service, timeout, baseline, and heading diagnostics.
- Preserves Flight Commander 3.0.7's accepted MICOAIR743 onboard IST8310 transform as the magnetic fallback baseline.

''' + changelog
        write("CHANGELOG.md", changelog)

    heading = read("docs/HEADING_FUSION.md")
    heading = heading.replace("Flight Commander Firmware 3.0.7", "Flight Commander Firmware 4.0.0", 1)
    marker = "## Moving-baseline setup\n"
    addition = '''## Holybro DroneCAN H-RTK F9P pair manager

Flight Commander 4.0.0 can configure two AP_Periph-compatible DroneCAN F9P nodes without a separate CAN setup application. Select fixed node IDs for **Moving Base on aircraft** and **Moving Rover on aircraft**, review CAN termination, then use **Configure and verify pair**. The firmware writes and verifies the module roles, saves the remote parameters, restarts both nodes, and binds `RelPosHeading` acceptance to the rover identity.

The role binding is independent of navigation-primary selection. Either paired module can provide normal position, but only the configured rover may provide moving-baseline yaw. A stationary RTK base or NTRIP stream remains a separate absolute-position correction source.

'''
    if addition not in heading:
        heading = heading.replace(marker, addition + marker, 1)
    write("docs/HEADING_FUSION.md", heading)

    gps = read("docs/GPS_AND_RTK.md")
    addition = '''
### Two-node Holybro/AP_Periph moving-baseline pair

With Flight Commander Firmware 4.0.0, select the two discovered GNSS nodes as **Moving Base** and **Moving Rover**. The one-stage setup manager assigns AP_Periph moving-baseline roles, saves and restarts both modules, and verifies role readback. Select the rover as navigation primary when practical, but keep navigation selection logically separate from the fixed base/rover heading roles.

Leave module termination unchanged unless the physical CAN topology is known. Exactly the two ends of the CAN trunk should be terminated; a hub or another peripheral may already provide one or both terminations.

'''
    marker = "## Concurrent receivers and primary navigation\n"
    if addition not in gps:
        gps = gps.replace(marker, addition + marker, 1)
    write("docs/GPS_AND_RTK.md", gps)


def main() -> None:
    update_versions()
    patch_identity()
    patch_msp()
    patch_fc_state()
    patch_heading_contract()
    patch_gps_tab()
    patch_styles()
    patch_docs()
    print("Flight Commander Configurator 4.0.0 source migration applied.")


if __name__ == "__main__":
    main()
