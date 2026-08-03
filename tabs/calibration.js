'use strict';

import jBox from 'jbox';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import FC from './../js/fc';
import timeout from './../js/timeouts';
import interval from './../js/intervals';
import i18n from './../js/localization';
import { firmwareFeatureSupport } from './../js/flightCommander/firmwareIdentity';
import {
    compassCalibrationState,
    enumerateCompassCalibrationTargets,
} from './../js/flightCommander/compassCalibration';
import {
    MICOAIR743_ONBOARD_COMPASS_PROFILE,
    onboardCompassOrientationRequirement,
} from './../js/flightCommander/compassOrientation';

const COMPASS_POLL_INTERVAL = 'compass_calibration_status';
const COMPASS_FALLBACK_DURATION_MS = 31000;
const COMPASS_HARD_TIMEOUT_MS = 38000;

const calibrationTab = {
    compassSession: null,
    supportsHeadingFusion: false,
    supportsDronecanConfig: false,
    compassCustomAngles: { roll: null, pitch: null, yaw: null },
};

calibrationTab.model = (function () {
    const privateScope = { step: null };
    const publicScope = {};

    publicScope.next = function () {
        if (privateScope.step === null) {
            privateScope.step = 1;
        } else {
            let count = 0;
            for (let index = 0; index < 6; index += 1) {
                if (FC.CALIBRATION_DATA.acc[`Pos${index}`] === 1) count += 1;
            }
            privateScope.step = count;
        }
        if (privateScope.step > 5) privateScope.step = null;
        return privateScope.step;
    };

    publicScope.getStep = function () {
        return privateScope.step;
    };

    return publicScope;
}());

calibrationTab.initialize = function (callback) {
    const firmwareIdentity = FC.CONFIG.firmwareIdentity;
    const supportsHeadingFusion = firmwareFeatureSupport(
        firmwareIdentity,
        'headingFusion',
    ).enabled;
    const supportsDronecanConfig = firmwareFeatureSupport(
        firmwareIdentity,
        'dronecanNodeConfig',
    ).enabled;
    this.supportsHeadingFusion = supportsHeadingFusion;
    this.supportsDronecanConfig = supportsDronecanConfig;

    let modalStart;
    let modalStop;
    let modalProcessing;

    if (GUI.active_tab !== this) GUI.active_tab = this;

    const loadChainer = new MSPChainerClass();
    const loadChain = [
        mspHelper.queryFcStatus,
        mspHelper.loadSensorConfig,
        mspHelper.loadSensorAlignment,
        function loadCompassCustomAlignment(callback) {
            Promise.all([
                mspHelper.getSetting('align_mag_roll'),
                mspHelper.getSetting('align_mag_pitch'),
                mspHelper.getSetting('align_mag_yaw'),
            ]).then(([roll, pitch, yaw]) => {
                calibrationTab.compassCustomAngles = {
                    roll: roll?.value ?? null,
                    pitch: pitch?.value ?? null,
                    yaw: yaw?.value ?? null,
                };
            }).catch((error) => {
                console.error('Unable to read compass custom alignment:', error);
                calibrationTab.compassCustomAngles = { roll: null, pitch: null, yaw: null };
            }).finally(callback);
        },
        mspHelper.loadCalibrationData,
    ];
    if (supportsHeadingFusion) {
        loadChain.push(
            mspHelper.loadFlightCommanderHeadingConfig,
            mspHelper.loadFlightCommanderHeadingStatus,
        );
    }
    if (supportsDronecanConfig) {
        loadChain.push(mspHelper.loadDronecanConfig, mspHelper.loadDronecanNodes);
    }
    loadChainer.setChain(loadChain);
    loadChainer.setExitPoint(loadHtml);
    loadChainer.execute();

    const saveChainer = new MSPChainerClass();
    const saveChain = [mspHelper.saveCalibrationData];
    if (supportsHeadingFusion) saveChain.push(mspHelper.saveFlightCommanderHeadingConfig);
    saveChain.push(mspHelper.saveToEeprom);
    saveChainer.setChain(saveChain);
    saveChainer.setExitPoint(reboot);

    function reboot() {
        GUI.log(i18n.getMessage('configurationEepromSaved'));
        GUI.tab_switch_cleanup(function () {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
        });
    }

    function reinitialize() {
        GUI.log(i18n.getMessage('deviceRebooting'));
        GUI.handleReconnect($('.tab_calibration a'));
    }

    function loadHtml() {
        import('./calibration.html?raw').then(({ default: html }) => GUI.load(html, processHtml));
    }

    function updateCalibrationSteps() {
        for (let index = 0; index < 6; index += 1) {
            const $element = $(`[data-step="${index + 1}"]`);
            if (FC.CALIBRATION_DATA.acc[`Pos${index}`] === 0) {
                $element.removeClass('finished active');
            } else {
                $element.addClass('finished').removeClass('active');
            }
        }
    }

    function compassTargets() {
        return enumerateCompassCalibrationTargets({
            supportsHeadingFusion,
            activeSensors: FC.CONFIG.activeSensors,
            sensorConfig: FC.SENSOR_CONFIG,
            calibrationData: FC.CALIBRATION_DATA,
            headingConfig: FC.HEADING_CONFIG,
            headingStatus: FC.HEADING_STATUS,
            dronecanConfig: FC.DRONECAN_CONFIG,
            dronecanStatus: FC.DRONECAN_STATUS,
        });
    }

    function compassOrientationRequirement() {
        return onboardCompassOrientationRequirement({
            config: FC.CONFIG,
            activeSensors: FC.CONFIG.activeSensors,
            sensorConfig: FC.SENSOR_CONFIG,
            sensorAlignment: FC.SENSOR_ALIGNMENT,
            customAngles: calibrationTab.compassCustomAngles,
        });
    }

    function renderCompassOrientation() {
        const requirement = compassOrientationRequirement();
        const $notice = $('#compassOrientationNotice');
        if (!requirement) {
            $notice.addClass('is-hidden').removeClass('is-ready');
            return;
        }

        $notice.removeClass('is-hidden').toggleClass('is-ready', requirement.ready);
        $('#compassOrientationTitle').text(
            requirement.ready
                ? 'MICOAIR743 onboard compass orientation verified'
                : 'MICOAIR743 onboard compass orientation must be corrected first',
        );
        $('#compassOrientationBody').text(
            requirement.ready
                ? `The onboard ${requirement.sensor} is using ${requirement.label}. Calibration can now solve offsets and scale without reversing or tilting the heading.`
                : `This board's onboard ${requirement.sensor} requires ${requirement.label}. The active configuration does not match, so calibration alone cannot produce a trustworthy heading. Apply the board profile, reboot, then run calibration.`,
        );
        $('#applyCompassOrientation')
            .toggleClass('is-hidden', requirement.ready)
            .prop('disabled', Boolean(calibrationTab.compassSession));
    }

    function vectorRow(label, values, unit) {
        const $row = $('<div>').addClass('compass-value-row');
        $('<span>').text(label).appendTo($row);
        ['X', 'Y', 'Z'].forEach((axis, index) => {
            const $value = $('<span>').addClass('compass-axis-value');
            $('<small>').text(axis).appendTo($value);
            $('<strong>').text(Number.isFinite(values[index]) ? values[index] : '--').appendTo($value);
            $value.appendTo($row);
        });
        $('<small>').addClass('compass-value-unit').text(unit).appendTo($row);
        return $row;
    }

    function renderCompassTargets() {
        const targets = compassTargets();
        const session = calibrationTab.compassSession;
        const orientation = compassOrientationRequirement();
        const $list = $('#compassCalibrationList').empty();

        renderCompassOrientation();

        for (const target of targets) {
            const status = compassCalibrationState(target);
            const $card = $('<article>')
                .addClass('compass-calibration-card')
                .attr('data-compass-source', target.index);
            const $header = $('<header>').addClass('compass-calibration-card__header');
            $('<div>')
                .append($('<strong>').text(target.title))
                .append($('<span>').text(target.description))
                .appendTo($header);
            $('<span>')
                .addClass(`compass-state compass-state--${status.tone}`)
                .text(status.label)
                .appendTo($header);
            $header.appendTo($card);
            $('<div>')
                .addClass('compass-value-grid')
                .append(vectorRow('Zero', target.zero, target.zeroUnit))
                .append(vectorRow('Gain', target.gain, target.gainUnit))
                .appendTo($card);
            const details = [];
            if (target.nodeId) details.push(`CAN node ${target.nodeId}`);
            if (target.ageMs !== null) details.push(`last sample ${target.ageMs} ms ago`);
            if (details.length) $('<p>').addClass('compass-card-meta').text(details.join(' · ')).appendTo($card);
            $('<button>')
                .attr({
                    type: 'button',
                    'data-compass-calibrate': target.index,
                })
                .addClass('compass-calibrate-button')
                .prop('disabled', Boolean(session) || Boolean(orientation?.needsCorrection))
                .text(
                    session
                        ? 'Calibration in progress…'
                        : orientation?.needsCorrection && target.index === 0
                            ? 'Apply orientation first'
                            : 'Calibrate this compass',
                )
                .appendTo($card);
            $card.appendTo($list);
        }

        const $summary = $('#compassCalibrationSummary')
            .removeClass('is-ready is-warning is-error is-working');
        if (orientation?.needsCorrection) {
            $summary.addClass('is-error').text(
                'Compass calibration is blocked until the MICOAIR743 onboard-sensor orientation is corrected and the controller reboots.',
            );
        } else if (session) {
            $summary.addClass('is-working').text(
                'Calibration is running for every enabled compass. Keep rotating the entire aircraft through all axes.',
            );
        } else if (targets.length === 0) {
            $summary.addClass('is-warning').text(
                'No enabled, connected magnetic compass was detected. Enable the compass in GPS or sensor configuration, save and reboot, then return here.',
            );
        } else if (targets.some((target) => target.failed)) {
            $summary.addClass('is-error').text(
                'At least one compass reported a failed calibration. Repeat with slower, wider rotations away from magnets and high-current wiring.',
            );
        } else if (targets.some((target) => !target.calibrated)) {
            $summary.addClass('is-warning').text(
                `${targets.length} connected compass${targets.length === 1 ? '' : 'es'} detected. Calibration is still required for one or more devices.`,
            );
        } else {
            $summary.addClass('is-ready').text(
                `All ${targets.length} connected compass${targets.length === 1 ? '' : 'es'} report calibrated values.`,
            );
        }
    }

    function updateSensorData() {
        ['X', 'Y', 'Z'].forEach((axis) => {
            $(`[name=accGain${axis}]`).val(FC.CALIBRATION_DATA.accGain[axis]);
            $(`[name=accZero${axis}]`).val(FC.CALIBRATION_DATA.accZero[axis]);
        });
        $('[name=OpflowScale]').val(FC.CALIBRATION_DATA.opflow.Scale);
        updateCalibrationSteps();
        renderCompassTargets();
    }

    function reloadCompassData(done) {
        mspHelper.loadCalibrationData(function () {
            if (!supportsHeadingFusion) {
                done?.();
                return;
            }
            mspHelper.loadFlightCommanderHeadingConfig(function () {
                mspHelper.loadFlightCommanderHeadingStatus(function () {
                    done?.();
                });
            });
        });
    }

    function finishCompassCalibration() {
        const session = calibrationTab.compassSession;
        if (!session || session.finishing) return;
        session.finishing = true;
        interval.remove(COMPASS_POLL_INTERVAL);
        reloadCompassData(function () {
            session.modal?.close();
            calibrationTab.compassSession = null;
            $('.jBox-wrapper').filter(':has(.modal-compass-countdown)').remove();
            updateSensorData();
            GUI.log(i18n.getMessage('initialSetupMagCalibEnded'));
        });
    }

    function pollCompassCalibration() {
        const session = calibrationTab.compassSession;
        if (!session || session.finishing) return;
        const elapsed = Date.now() - session.startedAt;
        const secondsRemaining = Math.max(0, Math.ceil((COMPASS_FALLBACK_DURATION_MS - elapsed) / 1000));
        session.modal?.content.find('.modal-compass-countdown').text(
            secondsRemaining > 0
                ? `${secondsRemaining} seconds remaining`
                : 'Reading calibration results…',
        );

        if (elapsed >= COMPASS_HARD_TIMEOUT_MS) {
            finishCompassCalibration();
            return;
        }
        if (!supportsHeadingFusion) {
            if (elapsed >= COMPASS_FALLBACK_DURATION_MS) finishCompassCalibration();
            return;
        }
        if (session.pollBusy) return;
        session.pollBusy = true;
        mspHelper.loadFlightCommanderHeadingStatus(function () {
            session.pollBusy = false;
            if (calibrationTab.compassSession !== session || session.finishing) return;
            const targets = compassTargets();
            const calibrating = targets.some((target) => target.calibrating);
            if (calibrating) session.observed = true;
            renderCompassTargets();
            if (session.observed && !calibrating) finishCompassCalibration();
            else if (!session.observed && elapsed >= COMPASS_FALLBACK_DURATION_MS) finishCompassCalibration();
        });
    }

    function startCompassCalibration(event) {
        event.preventDefault();
        if (calibrationTab.compassSession) return;
        if (compassOrientationRequirement()?.needsCorrection) {
            GUI.log('<span class="error">Apply the MICOAIR743 onboard compass orientation and reboot before calibration.</span>');
            renderCompassTargets();
            return;
        }
        const sourceIndex = Number(event.currentTarget.dataset.compassCalibrate);
        const target = compassTargets().find((candidate) => candidate.index === sourceIndex);
        if (!target) {
            GUI.log('<span class="error">That compass is no longer connected or enabled.</span>');
            renderCompassTargets();
            return;
        }

        const modal = new jBox('Modal', {
            width: 440,
            height: 180,
            animation: false,
            closeOnClick: false,
            closeOnEsc: false,
            content: $('#modal-compass-processing').clone(),
        }).open();
        calibrationTab.compassSession = {
            startedAt: Date.now(),
            observed: false,
            pollBusy: false,
            finishing: false,
            modal,
        };
        renderCompassTargets();
        MSP.send_message(MSPCodes.MSP_MAG_CALIBRATION, false, false, function () {
            GUI.log(`Compass calibration started from ${target.title}; every enabled physical compass is being solved.`);
        });
        interval.add(COMPASS_POLL_INTERVAL, pollCompassCalibration, 500, true);
    }

    function applyCompassOrientation(event) {
        event.preventDefault();
        const requirement = compassOrientationRequirement();
        if (!requirement?.needsCorrection || calibrationTab.compassSession) return;

        $('#applyCompassOrientation, .compass-calibrate-button').prop('disabled', true);
        $('#compassOrientationTitle').text('Applying MICOAIR743 compass orientation…');
        $('#compassOrientationBody').text(
            'Saving the unflipped 90° board profile, clearing stale compass calibration, and rebooting the controller.',
        );

        FC.SENSOR_ALIGNMENT.align_mag = MICOAIR743_ONBOARD_COMPASS_PROFILE.alignMag;
        ['X', 'Y', 'Z'].forEach((axis) => {
            FC.CALIBRATION_DATA.magZero[axis] = 0;
            FC.CALIBRATION_DATA.magGain[axis] = 1024;
        });

        const orientationChainer = new MSPChainerClass();
        orientationChainer.setChain([
            mspHelper.saveSensorAlignment,
            (callback) => mspHelper.setSetting('align_mag_roll', 0, callback),
            (callback) => mspHelper.setSetting('align_mag_pitch', 0, callback),
            (callback) => mspHelper.setSetting('align_mag_yaw', 0, callback),
            mspHelper.saveCalibrationData,
            mspHelper.saveToEeprom,
        ]);
        orientationChainer.setExitPoint(function rebootWithCorrectOrientation() {
            GUI.log('MICOAIR743 onboard compass orientation saved as CW90 (unflipped). Rebooting before calibration.');
            GUI.tab_switch_cleanup(function () {
                MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
            });
        });
        orientationChainer.execute();
    }

    function checkFinishAccCalibrate() {
        if (calibrationTab.model.next() === null) {
            modalStop = new jBox('Modal', {
                width: 400,
                height: 200,
                animation: false,
                closeOnClick: false,
                closeOnEsc: false,
                content: $('#modal-acc-calibration-stop'),
            }).open();
        }
        updateSensorData();
    }

    function calibrateNew(buttonElement) {
        let newStep = null;
        const $button = $(buttonElement);
        if (calibrationTab.model.getStep() === null) {
            for (let index = 0; index < 6; index += 1) {
                if (FC.CALIBRATION_DATA.acc[`Pos${index}`] === 1) {
                    FC.CALIBRATION_DATA.acc[`Pos${index}`] = 0;
                }
            }
            updateCalibrationSteps();
            modalStart = new jBox('Modal', {
                width: 400,
                height: 200,
                animation: false,
                closeOnClick: false,
                closeOnEsc: false,
                content: $('#modal-acc-calibration-start'),
            }).open();
        } else {
            newStep = calibrationTab.model.next();
        }

        if (newStep !== null) {
            $button.addClass('disabled');
            modalProcessing = new jBox('Modal', {
                width: 400,
                height: 120,
                animation: false,
                closeOnClick: false,
                closeOnEsc: false,
                content: $('#modal-acc-processing'),
            }).open();
            MSP.send_message(MSPCodes.MSP_ACC_CALIBRATION, false, false, function () {
                GUI.log(i18n.getMessage('initialSetupAccelCalibStarted'));
            });
            timeout.add('acc_calibration_timeout', function () {
                $button.removeClass('disabled');
                modalProcessing.close();
                MSP.send_message(MSPCodes.MSP_CALIBRATION_DATA, false, false, checkFinishAccCalibrate);
                GUI.log(i18n.getMessage('initialSetupAccelCalibEnded'));
            }, 2000);
        }
    }

    function setupCalibrationButton() {
        const calibrated = FC.getAccelerometerCalibrated();
        $('#calibrate-start-button')
            .html(i18n.getMessage(calibrated ? 'AccResetBtn' : 'AccBtn'))
            .prop('title', i18n.getMessage(calibrated ? 'AccResetBtn' : 'AccBtn'))
            .toggleClass('resetCalibration', calibrated)
            .toggleClass('calibrate', !calibrated);
    }

    function resetAccCalibration() {
        ['X', 'Y', 'Z'].forEach((axis) => {
            FC.CALIBRATION_DATA.accGain[axis] = 4096;
            FC.CALIBRATION_DATA.accZero[axis] = 0;
        });
        saveChainer.execute();
    }

    function actionCalibrateButton(event) {
        event.preventDefault();
        if ($('#calibrate-start-button').hasClass('resetCalibration')) resetAccCalibration();
        else calibrateNew(event.currentTarget);
    }

    function processHtml() {
        $('#calibrateButtonSave').on('click.calibrationTab', function (event) {
            event.preventDefault();
            FC.CALIBRATION_DATA.opflow.Scale = parseFloat($('[name=OpflowScale]').val());
            saveChainer.execute();
        });

        if (FC.SENSOR_CONFIG.opflow === 0) {
            $('#opflow_btn, #opflow-calibrated-data').css('pointer-events', 'none').css('opacity', '0.4');
        }

        $('#compassCalibrationList').on(
            'click.calibrationTab',
            '.compass-calibrate-button',
            startCompassCalibration,
        );
        $('#applyCompassOrientation').on('click.calibrationTab', applyCompassOrientation);

        $('#opflow_btn').on('click.calibrationTab', function (event) {
            event.preventDefault();
            MSP.send_message(MSPCodes.MSP2_INAV_OPFLOW_CALIBRATION, false, false, function () {
                GUI.log(i18n.getMessage('initialSetupOpflowCalibStarted'));
            });
            const $button = $(this).addClass('disabled');
            modalProcessing = new jBox('Modal', {
                width: 400,
                height: 120,
                animation: false,
                closeOnClick: false,
                closeOnEsc: false,
                content: $('#modal-opflow-processing'),
            }).open();
            let countdown = 30;
            interval.add('opflow_calibration_interval', function () {
                countdown -= 1;
                $('#modal-opflow-countdown').text(countdown);
                if (countdown === 0) {
                    $button.removeClass('disabled');
                    modalProcessing.close();
                    GUI.log(i18n.getMessage('initialSetupOpflowCalibEnded'));
                    MSP.send_message(MSPCodes.MSP_CALIBRATION_DATA, false, false, updateSensorData);
                    interval.remove('opflow_calibration_interval');
                }
            }, 1000);
        });

        $('#modal-start-button').on('click.calibrationTab', function () {
            modalStart.close();
            calibrationTab.model.next();
        });
        $('#modal-stop-button').on('click.calibrationTab', function () {
            modalStop.close();
        });

        i18n.localize();
        setupCalibrationButton();
        $('#calibrate-start-button').on('click.calibrationTab', actionCalibrateButton);
        updateSensorData();
        GUI.content_ready(callback);
    }
};

calibrationTab.cleanup = function (callback) {
    interval.remove(COMPASS_POLL_INTERVAL);
    interval.remove('opflow_calibration_interval');
    this.compassSession?.modal?.close();
    this.compassSession = null;
    $('#compassCalibrationList, #applyCompassOrientation, #opflow_btn, #modal-start-button, #modal-stop-button, #calibrate-start-button, #calibrateButtonSave')
        .off('.calibrationTab');
    if (callback) callback();
};

export default calibrationTab;
