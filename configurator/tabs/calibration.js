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
import {
    compassCalibrationState,
    enumerateCompassCalibrationTargets,
} from './../js/flightCommander/compassCalibration';
import {
    COMPASS_ORIENTATION_COMMAND,
    COMPASS_ORIENTATION_FACES,
    COMPASS_ORIENTATION_PHASE,
    COMPASS_ORIENTATION_SOURCE_LABELS,
    compassOrientationStage,
} from './../js/flightCommander/compassOrientation';

const COMPASS_POLL_INTERVAL = 'compass_calibration_status';
const COMPASS_ORIENTATION_POLL_INTERVAL = 'compass_orientation_status';
const COMPASS_FALLBACK_DURATION_MS = 31000;
const COMPASS_HARD_TIMEOUT_MS = 38000;

const calibrationTab = {
    compassSession: null,
    selectedCompassSource: 0,
    supportsHeadingFusion: false,
    supportsDronecanConfig: false,
    supportsCompassOrientation: false,
    supportsIndividualCompassCalibration: false,
    orientationCommandPending: false,
    orientationSelectionPending: false,
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
    const supportsHeadingFusion = true;
    const supportsDronecanConfig = true;
    const supportsCompassOrientation = true;
    const supportsIndividualCompassCalibration = true;

    this.supportsHeadingFusion = supportsHeadingFusion;
    this.supportsDronecanConfig = supportsDronecanConfig;
    this.supportsCompassOrientation = supportsCompassOrientation;
    this.supportsIndividualCompassCalibration = supportsIndividualCompassCalibration;

    let modalStart;
    let modalStop;
    let modalProcessing;

    if (GUI.active_tab !== this) GUI.active_tab = this;

    const loadChainer = new MSPChainerClass();
    const loadChain = [
        mspHelper.queryFcStatus,
        mspHelper.loadSensorConfig,
        mspHelper.loadCalibrationData,
    ];
    if (supportsHeadingFusion) {
        loadChain.push(
            mspHelper.loadFlightCommanderHeadingConfig,
            mspHelper.loadFlightCommanderHeadingStatus,
        );
    }
    if (supportsCompassOrientation) {
        loadChain.push(mspHelper.loadCompassOrientationStatus);
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

    function setRequirementState(selector, ready, readyText, blockedText) {
        $(selector)
            .toggleClass('is-ready', Boolean(ready))
            .toggleClass('is-blocked', !ready)
            .text(ready ? readyText : blockedText);
    }

    function allCompassTargets() {
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

    function compassTargets() {
        const targets = allCompassTargets();
        if (supportsIndividualCompassCalibration || !supportsHeadingFusion) return targets;
        return targets.filter((target) => target.index === 0);
    }

    function selectedTarget() {
        const targets = compassTargets();
        let target = targets.find((candidate) => (
            candidate.index === calibrationTab.selectedCompassSource
        ));
        if (!target && targets.length > 0) {
            target = targets[0];
            calibrationTab.selectedCompassSource = target.index;
        }
        return target ?? null;
    }

    function selectedOrientationStatus() {
        const status = FC.COMPASS_ORIENTATION_STATUS;
        return status?.source === calibrationTab.selectedCompassSource ? status : null;
    }

    function populateCompassSelector() {
        const targets = compassTargets();
        selectedTarget();
        const $selector = $('#compassCalibrationSource').empty();
        for (const target of targets) {
            const suffix = target.nodeId ? ` · CAN node ${target.nodeId}` : '';
            $('<option>')
                .val(target.index)
                .text(`${target.title}${suffix}`)
                .appendTo($selector);
        }
        if (targets.length === 0) {
            $('<option>').val('').text('No enabled compass detected').appendTo($selector);
        } else {
            $selector.val(String(calibrationTab.selectedCompassSource));
        }
        $selector.prop('disabled', Boolean(
            targets.length === 0
            || calibrationTab.compassSession
            || selectedOrientationStatus()?.active
            || calibrationTab.orientationCommandPending
            || calibrationTab.orientationSelectionPending
        ));
    }

    function renderCompassSource() {
        const target = selectedTarget();
        const targets = compassTargets();
        const $summary = $('#compassSourceSummary')
            .removeClass('is-ready is-warning is-error is-working');
        if (targets.length === 0) {
            $summary.addClass('is-warning').text(
                'No enabled, connected magnetic compass was detected. Enable the source, save and reboot, then return here.',
            );
        } else if (supportsHeadingFusion && !supportsIndividualCompassCalibration) {
            $summary.addClass('is-warning').text(
                'This firmware does not support isolated external-compass calibration. Flash Flight Commander 4.0.8 or newer to calibrate sources individually.',
            );
        } else if (calibrationTab.orientationSelectionPending) {
            $summary.addClass('is-working').text('Selecting the compass in firmware…');
        } else if (target) {
            const details = [target.description];
            if (target.ageMs !== null) details.push(`Last sample ${target.ageMs} ms ago.`);
            $summary.addClass(target.healthy ? 'is-ready' : 'is-warning').text(details.join(' '));
        }
    }

    function renderCompassOrientation() {
        const $panel = $('#compassOrientationPanel');
        if (!supportsCompassOrientation) {
            $panel.addClass('is-hidden');
            return;
        }
        $panel.removeClass('is-hidden');

        const target = selectedTarget();
        const status = selectedOrientationStatus();
        const stage = compassOrientationStage(status);
        const $summary = $('#compassOrientationSummary')
            .removeClass('is-ready is-warning is-error is-working')
            .addClass(`is-${stage.tone}`);

        if (!target) {
            $summary.text('Select an enabled compass before orientation learning.');
            return;
        }
        if (!status) {
            $summary.text(`Waiting for ${target.title} orientation status from firmware.`);
            return;
        }

        setRequirementState(
            '#compassOrientationAccelState',
            status.accelerometerCalibrated || FC.getAccelerometerCalibrated(),
            'Accelerometer calibrated',
            'Accelerometer calibration required',
        );
        setRequirementState(
            '#compassOrientationSensorState',
            status.compassPresent,
            `${target.title} detected`,
            `${target.title} not detected`,
        );
        setRequirementState(
            '#compassOrientationStoredState',
            status.valid,
            `Transform stored · generation ${status.calibrationGeneration}`,
            'Persistent transform not learned',
        );

        if (status.phase === COMPASS_ORIENTATION_PHASE.FAILED) {
            $summary.text(status.failureLabel || `${target.title} orientation learning failed.`);
        } else if (status.active) {
            const face = COMPASS_ORIENTATION_FACES[status.currentFace];
            $summary.text(
                face
                    ? `Keep ${face.label.toLowerCase()} and rotate around ${face.axis}. ${status.currentFaceRotationDegrees.toFixed(0)}° collected for ${target.title}.`
                    : `Place the complete aircraft in the next incomplete position and rotate it around the upward-facing axis for ${target.title}.`,
            );
        } else if (status.valid) {
            $summary.text(
                status.fieldCalibrated
                    ? `${target.title} has an independently stored six-side transform and offset/gain calibration.`
                    : `${target.title} orientation is stored. Complete its independent offset/gain calibration next.`,
            );
        } else if (!status.accelerometerCalibrated && !FC.getAccelerometerCalibrated()) {
            $summary.text('Complete and save accelerometer six-position calibration before learning any compass orientation.');
        } else if (!status.compassPresent) {
            $summary.text(`${target.title} must be detected before its six-side orientation learning can begin.`);
        } else {
            $summary.text(`Ready to learn ${target.title} orientation and axis alignment.`);
        }

        const $faces = $('#compassOrientationFaces').empty();
        for (const face of COMPASS_ORIENTATION_FACES) {
            const complete = (status.completedMask & (1 << face.index)) !== 0;
            const current = status.currentFace === face.index || status.detectedFace === face.index;
            const progress = status.faceProgress?.[face.index] ?? 0;
            const samples = status.faceSamples?.[face.index] ?? 0;
            const $face = $('<article>')
                .addClass('compass-orientation-face')
                .toggleClass('is-complete', complete)
                .toggleClass('is-current', current);
            $('<strong>').text(face.label).appendTo($face);
            $('<small>').text(`${face.axis} · ${samples} samples`).appendTo($face);
            $('<div>')
                .addClass('compass-orientation-progress')
                .append($('<span>').css('width', `${Math.max(0, Math.min(100, progress))}%`))
                .appendTo($face);
            $('<em>').text(complete ? 'Complete' : `${progress}%`).appendTo($face);
            $face.appendTo($faces);
        }

        const mapping = status.valid ? status.storedMapping : status.candidateMapping;
        $('#compassOrientationMapping').text(mapping || 'Not learned');
        $('#compassOrientationQuality').text(
            `Confidence ${status.confidencePercent}% · residual ${status.residualDegrees.toFixed(2)}° · separation ${status.separationDegrees.toFixed(2)}°`,
        );

        const prerequisitesReady = Boolean(
            (status.accelerometerCalibrated || FC.getAccelerometerCalibrated())
            && status.compassPresent
            && !status.armed,
        );
        $('#compassOrientationStart')
            .toggleClass('is-hidden', status.active)
            .prop('disabled', !prerequisitesReady || calibrationTab.orientationCommandPending)
            .text(status.valid ? `Relearn ${target.title} orientation` : 'Start six-side learning');
        $('#compassOrientationCancel')
            .toggleClass('is-hidden', !status.active)
            .prop('disabled', calibrationTab.orientationCommandPending);
        $('#compassOrientationClear')
            .toggleClass('is-hidden', !status.valid || status.active)
            .prop('disabled', calibrationTab.orientationCommandPending)
            .text(`Clear ${target.title} transform`);
    }

    function orientationBlocksFieldCalibration() {
        if (!supportsCompassOrientation) return false;
        const status = selectedOrientationStatus();
        return !status?.valid || status.active;
    }

    function vectorRow(label, values, unit) {
        const $row = $('<div>').addClass('compass-value-row');
        $('<span>').text(label).appendTo($row);
        ['X', 'Y', 'Z'].forEach((axis, index) => {
            const $value = $('<span>').addClass('compass-axis-value');
            $('<small>').text(axis).appendTo($value);
            $('<strong>').text(Number.isFinite(values?.[index]) ? values[index] : '--').appendTo($value);
            $value.appendTo($row);
        });
        $('<small>').addClass('compass-value-unit').text(unit).appendTo($row);
        return $row;
    }

    function renderSelectedCompass() {
        const target = selectedTarget();
        const session = calibrationTab.compassSession;
        const orientationLocked = orientationBlocksFieldCalibration();
        const $selected = $('#compassCalibrationSelected').empty();
        const $summary = $('#compassCalibrationSummary')
            .removeClass('is-ready is-warning is-error is-working');
        const $button = $('#compassFieldCalibrationStart');

        if (!target) {
            $summary.addClass('is-warning').text('No compass is available for field calibration.');
            $button.prop('disabled', true);
            return;
        }

        const state = compassCalibrationState(target);
        const $card = $('<article>')
            .addClass('compass-calibration-card')
            .attr('data-compass-source', target.index);
        const $header = $('<header>').addClass('compass-calibration-card__header');
        $('<div>')
            .append($('<strong>').text(target.title))
            .append($('<span>').text(target.description))
            .appendTo($header);
        $('<span>')
            .addClass(`compass-state compass-state--${state.tone}`)
            .text(state.label)
            .appendTo($header);
        $header.appendTo($card);
        const $grid = $('<div>')
            .addClass('compass-value-grid')
            .append(vectorRow('Zero', target.zero, target.zeroUnit))
            .append(vectorRow('Gain', target.gain, target.gainUnit));
        if (Array.isArray(target.alignment)) {
            $grid.append(vectorRow('Manual', target.alignment, target.alignmentUnit));
        }
        $grid.appendTo($card);
        const details = [];
        if (target.nodeId) details.push(`CAN node ${target.nodeId}`);
        if (target.ageMs !== null) details.push(`last sample ${target.ageMs} ms ago`);
        if (details.length) $('<p>').addClass('compass-card-meta').text(details.join(' · ')).appendTo($card);
        if (target.calibrationIssue) {
            $('<p>')
                .addClass('compass-card-calibration-error')
                .text(`${target.calibrationIssue} This result will not be used for heading fusion.`)
                .appendTo($card);
        }
        $card.appendTo($selected);

        if (!supportsIndividualCompassCalibration && supportsHeadingFusion) {
            $summary.addClass('is-warning').text(
                'External-source isolation requires Flight Commander firmware 4.0.8 or newer.',
            );
        } else if (orientationLocked) {
            $summary.addClass('is-warning').text(
                `Learn and store ${target.title} six-side orientation before calibrating its gains.`,
            );
        } else if (session) {
            $summary.addClass('is-working').text(
                `${target.title} is the only compass collecting offset/gain samples. Keep rotating the complete aircraft.`,
            );
        } else if (target.invalidCalibration) {
            $summary.addClass('is-error').text(
                `${target.title} has an implausible saved result and must be recalibrated before flight.`,
            );
        } else if (target.failed) {
            $summary.addClass('is-error').text(
                `${target.title} reported a failed calibration. Repeat with slower, wider rotations away from magnetic interference.`,
            );
        } else if (!target.calibrated) {
            $summary.addClass('is-warning').text(`${target.title} offset/gain calibration is required.`);
        } else {
            $summary.addClass('is-ready').text(`${target.title} reports valid independently stored offsets and gains.`);
        }

        $button
            .prop('disabled', Boolean(
                session
                || orientationLocked
                || calibrationTab.orientationCommandPending
                || calibrationTab.orientationSelectionPending
                || (!supportsIndividualCompassCalibration && supportsHeadingFusion)
            ))
            .text(
                session
                    ? 'Calibration in progress…'
                    : target.invalidCalibration
                        ? `Replace ${target.title} calibration`
                        : `Calibrate ${target.title} gains`,
            );
    }

    function renderCompassControls() {
        populateCompassSelector();
        renderCompassSource();
        renderCompassOrientation();
        renderSelectedCompass();
    }

    function discardInvalidCompassCalibrations() {
        const invalidTargets = allCompassTargets().filter((target) => target.invalidCalibration);
        for (const target of invalidTargets) {
            if (target.key === 'legacy-primary' || target.key === 'onboard') {
                for (const axis of ['X', 'Y', 'Z']) {
                    FC.CALIBRATION_DATA.magZero[axis] = 0;
                    FC.CALIBRATION_DATA.magGain[axis] = 1024;
                }
            } else if (target.key === 'external-i2c' && FC.HEADING_CONFIG) {
                FC.HEADING_CONFIG.externalMagZero = [0, 0, 0];
                FC.HEADING_CONFIG.externalMagGain = [1024, 1024, 1024];
            } else if (target.key === 'dronecan' && FC.HEADING_CONFIG) {
                FC.HEADING_CONFIG.dronecanMagZeroMilliGauss = [0, 0, 0];
                FC.HEADING_CONFIG.dronecanMagGainMilliGauss = [0, 0, 0];
                FC.HEADING_CONFIG.dronecanMagCalibrationNodeId = 0;
            }
        }
        if (invalidTargets.length > 0) {
            GUI.log(
                `<span class="error">Discarded ${invalidTargets.length} implausible compass calibration result${invalidTargets.length === 1 ? '' : 's'} instead of saving unsafe values.</span>`,
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
        renderCompassControls();
    }

    function selectCompassSource(source, done) {
        const target = compassTargets().find((candidate) => candidate.index === Number(source));
        if (!target) {
            renderCompassControls();
            done?.(false);
            return;
        }
        calibrationTab.selectedCompassSource = target.index;
        if (!supportsCompassOrientation) {
            updateSensorData();
            done?.(true);
            return;
        }
        calibrationTab.orientationSelectionPending = true;
        renderCompassControls();
        mspHelper.sendCompassOrientationCommand(
            COMPASS_ORIENTATION_COMMAND.SELECT,
            target.index,
            function () {
                mspHelper.loadCompassOrientationStatus(function () {
                    calibrationTab.orientationSelectionPending = false;
                    updateSensorData();
                    done?.(true);
                });
            },
        );
    }

    function reloadCompassData(done) {
        const finish = function () {
            if (!supportsCompassOrientation) {
                done?.();
                return;
            }
            mspHelper.loadCompassOrientationStatus(done);
        };
        mspHelper.loadCalibrationData(function () {
            if (!supportsHeadingFusion) {
                finish();
                return;
            }
            mspHelper.loadFlightCommanderHeadingConfig(function () {
                mspHelper.loadFlightCommanderHeadingStatus(finish);
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
            GUI.log(`${session.title} offset/gain calibration ended.`);
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
                : 'Reading selected compass result…',
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
            const target = allCompassTargets().find((candidate) => candidate.index === session.source);
            const calibrating = Boolean(target?.calibrating);
            if (calibrating) session.observed = true;
            renderCompassControls();
            if (session.observed && !calibrating) finishCompassCalibration();
            else if (!session.observed && elapsed >= COMPASS_FALLBACK_DURATION_MS) finishCompassCalibration();
        });
    }

    function startCompassCalibration(event) {
        event.preventDefault();
        const target = selectedTarget();
        if (!target || calibrationTab.compassSession || orientationBlocksFieldCalibration()) {
            renderCompassControls();
            return;
        }
        if (supportsHeadingFusion && !supportsIndividualCompassCalibration) {
            GUI.log('<span class="error">Flight Commander 4.0.8 firmware is required for isolated source calibration.</span>');
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
        modal.content.find('.modal-compass-source').text(target.title);
        calibrationTab.compassSession = {
            source: target.index,
            title: target.title,
            startedAt: Date.now(),
            observed: false,
            pollBusy: false,
            finishing: false,
            modal,
        };
        renderCompassControls();

        const started = function () {
            GUI.log(`${target.title} calibration started. No other compass will be modified.`);
        };
        if (supportsIndividualCompassCalibration) {
            mspHelper.sendCompassCalibrationCommand(target.index, started);
        } else {
            MSP.send_message(MSPCodes.MSP_MAG_CALIBRATION, false, false, started);
        }
        interval.add(COMPASS_POLL_INTERVAL, pollCompassCalibration, 500, true);
    }

    function stopCompassOrientationPolling() {
        interval.remove(COMPASS_ORIENTATION_POLL_INTERVAL);
    }

    function pollCompassOrientation() {
        if (!supportsCompassOrientation || calibrationTab.orientationCommandPending) return;
        const expectedSource = calibrationTab.selectedCompassSource;
        mspHelper.loadCompassOrientationStatus(function () {
            const status = selectedOrientationStatus();
            updateSensorData();
            if (!status || status.source !== expectedSource) return;
            if (!status.active) {
                stopCompassOrientationPolling();
                const target = selectedTarget();
                if (status.valid) {
                    reloadCompassData(updateSensorData);
                    GUI.log(`${target?.title ?? 'Selected compass'} six-side orientation stored independently. Its gain calibration is now available.`);
                } else if (status.phase === COMPASS_ORIENTATION_PHASE.FAILED) {
                    GUI.log(`<span class="error">${status.failureLabel || 'Compass-orientation learning failed.'}</span>`);
                }
            }
        });
    }

    function sendCompassOrientationCommand(command) {
        const target = selectedTarget();
        if (!target || !supportsCompassOrientation || calibrationTab.orientationCommandPending) return;
        calibrationTab.orientationCommandPending = true;
        renderCompassControls();
        mspHelper.sendCompassOrientationCommand(command, target.index, function () {
            calibrationTab.orientationCommandPending = false;
            mspHelper.loadCompassOrientationStatus(function () {
                updateSensorData();
                if (command === COMPASS_ORIENTATION_COMMAND.START) {
                    interval.add(COMPASS_ORIENTATION_POLL_INTERVAL, pollCompassOrientation, 350, true);
                    GUI.log(`${target.title} six-side orientation learning started. Other compass transforms remain unchanged.`);
                } else {
                    stopCompassOrientationPolling();
                }
            });
        });
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
        if (supportsCompassOrientation) {
            mspHelper.loadCompassOrientationStatus(updateSensorData);
        } else {
            updateSensorData();
        }
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
        discardInvalidCompassCalibrations();
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
            discardInvalidCompassCalibrations();
            saveChainer.execute();
        });

        if (FC.SENSOR_CONFIG.opflow === 0) {
            $('#opflow_btn, #opflow-calibrated-data').css('pointer-events', 'none').css('opacity', '0.4');
        }

        $('#compassCalibrationSource').on('change.calibrationTab', function () {
            const source = Number($(this).val());
            if (calibrationTab.compassSession || selectedOrientationStatus()?.active) {
                $(this).val(String(calibrationTab.selectedCompassSource));
                return;
            }
            selectCompassSource(source);
        });

        if (supportsCompassOrientation) {
            $('#compassOrientationPanel').removeClass('is-hidden');
            $('#compassOrientationStart').on('click.calibrationTab', function () {
                sendCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.START);
            });
            $('#compassOrientationCancel').on('click.calibrationTab', function () {
                sendCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.CANCEL);
            });
            $('#compassOrientationClear').on('click.calibrationTab', function () {
                sendCompassOrientationCommand(COMPASS_ORIENTATION_COMMAND.CLEAR);
            });
        }

        $('#compassFieldCalibrationStart').on('click.calibrationTab', startCompassCalibration);
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
        const target = selectedTarget();
        if (supportsCompassOrientation && target
            && FC.COMPASS_ORIENTATION_STATUS?.source !== target.index) {
            selectCompassSource(target.index);
        }
        GUI.content_ready(callback);
    }
};

calibrationTab.cleanup = function (callback) {
    interval.remove(COMPASS_POLL_INTERVAL);
    interval.remove(COMPASS_ORIENTATION_POLL_INTERVAL);
    interval.remove('opflow_calibration_interval');
    this.compassSession?.modal?.close();
    this.compassSession = null;
    this.orientationCommandPending = false;
    this.orientationSelectionPending = false;
    $('#compassOrientationPanel, #compassCalibrationSource, #compassFieldCalibrationStart, #opflow_btn, #modal-start-button, #modal-stop-button, #calibrate-start-button, #calibrateButtonSave')
        .off('.calibrationTab');
    if (callback) callback();
};

export default calibrationTab;
