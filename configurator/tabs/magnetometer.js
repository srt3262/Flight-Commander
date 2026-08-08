'use strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import noUiSlider from 'nouislider';

import MSPChainerClass from './../js/msp/MSPchainer';
import MSP from './../js/msp';
import MSPCodes from './../js/msp/MSPCodes';
import mspHelper from './../js/msp/MSPHelper';
import FC from './../js/fc';
import GUI from './../js/gui';
import i18n from './../js/localization';
import { mixer } from './../js/model';
import interval from './../js/intervals';
import {
    ALIGNMENT_TARGET_LEGACY_MAG,
    applyAlignmentDrafts,
    createAlignmentDrafts,
    enumerateAlignmentTargets,
    readAlignmentDraft,
    updateAlignmentDraft,
    updateAlignmentDraftAxis,
} from './../js/flightCommander/alignmentTargets';
import {
    HEADING_SOURCE_MOVING_BASELINE,
    diagnoseHeadingSourceAvailability,
} from './../js/flightCommander/headingFusion';

const magnetometerTab = {};


magnetometerTab.initialize = function (callback) {
    var self = this;
    const supportsRtkUart = true;
    const supportsDronecanGps = true;
    const supportsDronecanConfig = true;
    const supportsHeadingFusion = true;
    const supportsMovingBaseline = true;

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    self.alignmentConfig = {
        pitch: 0,
        roll: 0,
        yaw: 0
    };

    self.boardAlignmentConfig = {
        pitch: 0,
        roll: 0,
        yaw: 0
    };

    self.pageElements = {};
    self.isSavePreset = true;
    self.legacyIsSavePreset = true;
    self.legacyAlignmentConfig = null;
    self.alignmentTarget = ALIGNMENT_TARGET_LEGACY_MAG;
    self.alignmentTargets = [];
    self.alignmentDrafts = new Map();
    self.isPopulatingAlignmentControls = false;
    self.elementToShow = 0;
    self.legacyPreviewIndex = 0;
    //========================
    // Load chain
    // =======================
    var loadChainer = new MSPChainerClass();

    var loadChain = [
        mspHelper.loadMixerConfig,
        mspHelper.loadBoardAlignment,
        function (callback) {
            self.boardAlignmentConfig.pitch = Math.round(FC.BOARD_ALIGNMENT.pitch / 10);
            self.boardAlignmentConfig.roll = Math.round(FC.BOARD_ALIGNMENT.roll / 10);
            self.boardAlignmentConfig.yaw = Math.round(FC.BOARD_ALIGNMENT.yaw / 10);
            callback();
        },
        mspHelper.loadSensorAlignment,
        // Pitch and roll must be inverted
        function (callback) {
            mspHelper.getSetting("align_mag_roll").then(function (data) {
                if (data == null) {
                    console.warn("while setting align_mag_roll, data is null or undefined");
                    return Promise.resolve();
                }
                self.alignmentConfig.roll = parseInt(data.value, 10) / 10;
            }).then(callback).catch(err => {
                console.error('Failed to get align_mag_roll:', err);
                callback();
            });
        },
        function (callback) {
            mspHelper.getSetting("align_mag_pitch").then(function (data) {
                if (data == null) {
                    console.warn("while setting align_mag_pitch, data is null or undefined");
                    return Promise.resolve();
                }
                self.alignmentConfig.pitch = parseInt(data.value, 10) / 10;
            }).then(callback).catch(err => {
                console.error('Failed to get align_mag_pitch:', err);
                callback();
            });
        },
        function (callback) {
            mspHelper.getSetting("align_mag_yaw").then(function (data) {
                if (data == null) {
                    console.warn("while setting align_mag_yaw, data is null or undefined");
                    return Promise.resolve();
                }
                self.alignmentConfig.yaw = parseInt(data.value, 10) / 10;
            }).then(callback).catch(err => {
                console.error('Failed to get align_mag_yaw:', err);
                callback();
            });
        },
        mspHelper.loadCalibrationData,
    ];
    if (supportsDronecanConfig) {
        loadChain.push(mspHelper.loadDronecanConfig);
    }
    if (supportsHeadingFusion) {
        loadChain.push(mspHelper.loadFlightCommanderHeadingConfig);
        loadChain.push(mspHelper.loadFlightCommanderHeadingStatus);
    }

    loadChainer.setChain(loadChain);
    loadChainer.setExitPoint(load_html);
    loadChainer.execute();

    function areAnglesZero(config = self.alignmentConfig) {
        return config.pitch === 0 && config.roll === 0 && config.yaw === 0
    }

    function isBoardAlignmentZero() {
        return (self.boardAlignmentConfig.pitch == 0 ) && (self.boardAlignmentConfig.roll == 0 ) && (self.boardAlignmentConfig.yaw == 0);
    }

    //========================
    // Save chain
    // =======================
    var saveChainer = new MSPChainerClass();

    var saveChain = [
        function (callback) {
            commitAllAlignmentTargets();
            FC.BOARD_ALIGNMENT.pitch = self.boardAlignmentConfig.pitch * 10;
            FC.BOARD_ALIGNMENT.roll = self.boardAlignmentConfig.roll * 10;
            FC.BOARD_ALIGNMENT.yaw = self.boardAlignmentConfig.yaw * 10;
            callback();
        },
        mspHelper.saveBoardAlignment,
        // Magnetometer alignment
        function (callback) {
            let orientation_mag_e = $('select.magalign');
            FC.SENSOR_ALIGNMENT.align_mag = parseInt(orientation_mag_e.val());
            callback();
        },
        mspHelper.saveSensorAlignment,
        // Pitch/Roll/Yaw
        // Pitch and roll must be inverted - ???
        function (callback) {
            if (self.legacyIsSavePreset)
                mspHelper.setSetting("align_mag_roll", 0, callback);
            else
                mspHelper.setSetting("align_mag_roll", self.legacyAlignmentConfig.roll * 10, callback);
        },
        function (callback) {
            if (self.legacyIsSavePreset)
                mspHelper.setSetting("align_mag_pitch", 0, callback);
            else
                mspHelper.setSetting("align_mag_pitch", self.legacyAlignmentConfig.pitch * 10, callback);

        },
        function (callback) {
            if (self.legacyIsSavePreset)
                mspHelper.setSetting("align_mag_yaw", 0, callback);
            else {
                var fix = 0;
                if (areAnglesZero(self.legacyAlignmentConfig)) {
                    fix = 1;  //if all angles are 0, then we have to save yaw = 1 (0.1 deg) to enforce usage of angles, not a usage of preset
                }
                mspHelper.setSetting("align_mag_yaw", self.legacyAlignmentConfig.yaw * 10 + fix, callback);
            }
        }
    ];
    if (supportsHeadingFusion) {
        saveChain.push(mspHelper.saveFlightCommanderHeadingConfig);
    }
    saveChain.push(mspHelper.saveToEeprom);

    saveChainer.setChain(saveChain);
    saveChainer.setExitPoint(reboot);

    function reboot() {
        //noinspection JSUnresolvedVariable
        GUI.log(i18n.getMessage('configurationEepromSaved'));

        GUI.tab_switch_cleanup(function () {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
        });
    }

    function reinitialize() {
        GUI.log(i18n.getMessage('deviceRebooting'));
        GUI.handleReconnect($('.tab_magnetometer a'));
    }

    function load_html() {
        import('./magnetometer.html?raw').then(({default: html}) => GUI.load(html, process_html));
    }

    function generateRange(min, max, step) {
        const arr = [];
        for (var i = min; i <= max; i += step) {
            arr.push(i)
        }
        return arr;
    }

    function toUpperRange(input, max) {
        if (!Number.isFinite(input)) return 0;
        while (input > max) input -= 360;
        while (input + 360 <= max) input += 360;
        return input;
    }

    /*
    Returns pitch, roll and yaw in degree by the id of a preset.
    Degree are the ones used in the slider
     */
    function getAxisDegreeWithPreset(selectedPreset) {
        //pitch, roll, yaw
        switch (selectedPreset) {
            case 1: //CW0_DEG = 1
                return [0, 0, 0];
            case 2: //CW90_DEG = 2
                return [0, 0, 90];
            case 3: //CW180_DEG = 3
                return [0, 0, 180];
            case 4: //CW270_DEG = 4
                return [0, 0, 270];
            case 5: //CW0_DEG_FLIP = 5
                return [180, 0, 0];
            case 6: //CW90_DEG_FLIP = 5
                return [180, 0, 90];
            case 7: //CW180_DEG_FLIP = 5
                return [180, 0, 180];
            case 0: //ALIGN_DEFAULT = 0
            case 8: //CW270_DEG_FLIP = 5
            default://If not recognized, returns default
                return [180, 0, 270];
        }
    }

    function getAxisDegreeWithPresetAndBoardOrientation(selectedPreset) {
        var degree = getAxisDegreeWithPreset(selectedPreset);

        if (isBoardAlignmentZero()) {
           return degree;
        } 

        //degree[0] - pitch
        //degree[1] - roll
        //degree[2] - yaw
        //-(pitch-180), -180 - yaw, roll
        var magRotation = new THREE.Euler(-THREE.MathUtils.degToRad(degree[0]-180), THREE.MathUtils.degToRad(-180 - degree[2]), THREE.MathUtils.degToRad(degree[1]), 'YXZ'); 
        var matrix = (new THREE.Matrix4()).makeRotationFromEuler(magRotation);

        var boardRotation = new THREE.Euler( THREE.MathUtils.degToRad( self.boardAlignmentConfig.pitch ), THREE.MathUtils.degToRad( -self.boardAlignmentConfig.yaw ), THREE.MathUtils.degToRad( self.boardAlignmentConfig.roll ), 'YXZ');
        var matrix1 = (new THREE.Matrix4()).makeRotationFromEuler(boardRotation);

        matrix.premultiply(matrix1);  

        var euler = new THREE.Euler();
        euler.setFromRotationMatrix(matrix, 'YXZ');

        var pitch = toUpperRange( Math.round( THREE.MathUtils.radToDeg(-euler.x)) + 180, 180 );
        var yaw = toUpperRange( Math.round( -180 - THREE.MathUtils.radToDeg(euler.y)), 359 );
        var roll = toUpperRange( Math.round( THREE.MathUtils.radToDeg(euler.z)), 180 );

        return [pitch, roll, yaw];
    }

    function updateMagOrientationWithPreset() {
        if (self.isSavePreset) {
            const degrees = getAxisDegreeWithPresetAndBoardOrientation(FC.SENSOR_ALIGNMENT.align_mag);
            presetUpdated(degrees);
        }
    }

    let _settingSlider = false;

    function updateFCCliString() {
        var s = " align_board_roll=" + (self.boardAlignmentConfig.roll * 10) +  
                " align_board_pitch=" + (self.boardAlignmentConfig.pitch * 10) + 
                " align_board_yaw=" + (self.boardAlignmentConfig.yaw * 10);
        self.pageElements.cli_settings_fc.text(s);
    }

    function updateBoardRollAxis(value) {
        if (value == null) {
            console.log("in updateBoardRollAxis, value is null or undefined");
            return;
        }

        self.boardAlignmentConfig.roll = Number(value);
        if (self.pageElements.board_roll_slider[0].noUiSlider && !_settingSlider) { _settingSlider = true; self.pageElements.board_roll_slider[0].noUiSlider.set(self.boardAlignmentConfig.roll); _settingSlider = false; }
        self.pageElements.orientation_board_roll.val(self.boardAlignmentConfig.roll);
        updateMagOrientationWithPreset();
        updateFCCliString();
        self.render3D();
    }

    function updateBoardPitchAxis(value) {
        self.boardAlignmentConfig.pitch = Number(value);
        if (self.pageElements.board_pitch_slider[0].noUiSlider && !_settingSlider) { _settingSlider = true; self.pageElements.board_pitch_slider[0].noUiSlider.set(self.boardAlignmentConfig.pitch); _settingSlider = false; }
        self.pageElements.orientation_board_pitch.val(self.boardAlignmentConfig.pitch);
        updateMagOrientationWithPreset();
        updateFCCliString();
        self.render3D();
    }

    function updateBoardYawAxis(value) {
        self.boardAlignmentConfig.yaw = Number(value);
        if (self.pageElements.board_yaw_slider[0].noUiSlider && !_settingSlider) { _settingSlider = true; self.pageElements.board_yaw_slider[0].noUiSlider.set(self.boardAlignmentConfig.yaw); _settingSlider = false; }
        self.pageElements.orientation_board_yaw.val(self.boardAlignmentConfig.yaw);
        updateMagOrientationWithPreset();
        updateFCCliString();
        self.render3D();
    }
    
    function updateMagCliString() {
        if (self.alignmentTarget !== ALIGNMENT_TARGET_LEGACY_MAG) {
            const target = self.alignmentTargets.find((entry) => entry.id === self.alignmentTarget);
            const axes = target?.axes ?? ['roll', 'pitch', 'yaw'];
            const values = axes.map((axis) => `${axis}=${self.alignmentConfig[axis]}°`).join(' ');
            self.pageElements.cli_settings_mag.text(`${target?.label ?? 'Flight Commander alignment'}: ${values}`);
            self.pageElements.comment_sensor_mag_preset.hide();
            self.pageElements.comment_sensor_mag_angles.hide();
            return;
        }
        var fix = 0;
        if ( areAnglesZero() )  {
            fix = 1;  //if all angles are 0, then we have to save yaw = 1 (0.1 deg) to enforce usage of angles, not a usage of preset
        }
		var names = ['DEFAULT', 'CW0', 'CW90', 'CW180', 'CW270', 'CW0FLIP', 'CW90FLIP', 'CW180FLIP', 'CW270FLIP'];
        var s = "align_mag=" + names[FC.SENSOR_ALIGNMENT.align_mag] +  
                " align_mag_roll=" + (self.isSavePreset ? 0 : self.alignmentConfig.roll * 10) +  
                " align_mag_pitch=" + (self.isSavePreset ? 0 : self.alignmentConfig.pitch * 10) + 
                " align_mag_yaw=" + (self.isSavePreset ? 0 : self.alignmentConfig.yaw * 10 + fix);
        self.pageElements.cli_settings_mag.text(s);
        self.pageElements.comment_sensor_mag_preset.css("display", !self.isSavePreset ? "none" : "");
        self.pageElements.comment_sensor_mag_angles.css("display", self.isSavePreset ? "none" : "");
    }

    function updateCurrentAlignmentDraft() {
        if (self.alignmentDrafts.has(self.alignmentTarget)) {
            updateAlignmentDraft(
                self.alignmentDrafts,
                self.alignmentTarget,
                self.alignmentConfig,
            );
        }
    }

    function renderAlignmentDraftSummary() {
        const $summary = $('#alignmentDraftSummary').empty();
        if (!$summary.length) return;
        for (const target of self.alignmentTargets) {
            if (!self.alignmentDrafts.has(target.id)) continue;
            const angles = readAlignmentDraft(self.alignmentDrafts, target.id);
            const visibleAxes = target.axes
                .map((axis) => `${axis[0].toUpperCase()} ${Number(angles[axis]).toFixed(1)}°`)
                .join(' · ');
            $('<button/>', {
                type: 'button',
                'data-alignment-summary-target': target.id,
                'aria-pressed': target.id === self.alignmentTarget ? 'true' : 'false',
            })
                .toggleClass('is-active', target.id === self.alignmentTarget)
                .append($('<strong/>').text(target.label.replace(/ · .*/, '')))
                .append($('<span/>').text(visibleAxes))
                .append($('<em/>').text(target.id === self.alignmentTarget ? 'Editing' : 'Select'))
                .appendTo($summary);
        }
    }

    function populateAlignmentControls(config) {
        self.isPopulatingAlignmentControls = true;
        self.alignmentConfig = {
            roll: Number(config.roll),
            pitch: Number(config.pitch),
            yaw: Number(config.yaw),
        };
        for (const axis of ['roll', 'pitch', 'yaw']) {
            const slider = self.pageElements[`${axis}_slider`]?.[0]?.noUiSlider;
            if (slider) slider.set(self.alignmentConfig[axis]);
            self.pageElements[`orientation_mag_${axis}`]?.val(self.alignmentConfig[axis]);
        }
        self.isPopulatingAlignmentControls = false;
        renderAlignmentDraftSummary();
        updateMagCliString();
        self.render3D();
    }

    function updateAlignmentAxis(axis, value) {
        if (self.isPopulatingAlignmentControls) return;
        const numericValue = Number(value);
        if (self.alignmentDrafts.has(self.alignmentTarget)) {
            self.alignmentConfig = updateAlignmentDraftAxis(
                self.alignmentDrafts,
                self.alignmentTarget,
                axis,
                numericValue,
            );
        } else {
            self.alignmentConfig = { ...self.alignmentConfig, [axis]: numericValue };
        }

        const slider = self.pageElements[`${axis}_slider`]?.[0]?.noUiSlider;
        if (slider && !_settingSlider) {
            _settingSlider = true;
            slider.set(numericValue);
            _settingSlider = false;
        }
        self.pageElements[`orientation_mag_${axis}`]?.val(numericValue);
        renderAlignmentDraftSummary();
        updateMagCliString();
        self.render3D();
    }

    //Called when roll values change
    function updateRollAxis(value) {
        updateAlignmentAxis('roll', value);
    }

    //Called when pitch values change
    function updatePitchAxis(value) {
        updateAlignmentAxis('pitch', value);
    }

    //Called when yaw values change
    function updateYawAxis(value) {
        updateAlignmentAxis('yaw', value);
    }

    function commitCurrentAlignmentTarget() {
        updateCurrentAlignmentDraft();
        if (self.alignmentTarget === ALIGNMENT_TARGET_LEGACY_MAG) {
            self.legacyAlignmentConfig = { ...self.alignmentConfig };
            self.legacyIsSavePreset = self.isSavePreset;
        }
    }

    function commitAllAlignmentTargets() {
        commitCurrentAlignmentTarget();
        if (FC.HEADING_CONFIG) {
            applyAlignmentDrafts(FC.HEADING_CONFIG, self.alignmentDrafts);
        }
    }

    function setAxisAvailability(target) {
        for (const axis of ['roll', 'pitch', 'yaw']) {
            const enabled = target.editable !== false && target.axes.includes(axis);
            self.pageElements[`orientation_mag_${axis}`].prop('disabled', !enabled);
            const sliderElement = self.pageElements[`${axis}_slider`][0];
            if (sliderElement) {
                if (enabled) sliderElement.removeAttribute('disabled');
                else sliderElement.setAttribute('disabled', 'disabled');
            }
        }
    }

    function renderAlignmentTargetIdentity(target) {
        $('#alignmentSourceName').text(target.previewTitle);
        $('#alignmentPreviewCanvasTitle').text(target.previewTitle);
        $('#alignmentSourceTransport').text(target.transport);
        $('#alignmentSourceBinding').text(target.binding);
        $('#alignmentPreviewCanvasBinding').text(target.binding);
        $('#alignmentSourceSetting').text(target.setting);
        $('#alignmentPreviewDetail').text(target.previewDetail);
        $('#alignmentSourceState')
            .text(target.editable === false ? 'Selection required' : 'Independent source')
            .toggleClass('requires-selection', target.editable === false);
        $('#alignmentSourceWarning')
            .text(target.warning || '')
            .toggleClass('is-hidden', !target.warning);
        $('#align_mag_xxx').text(target.setting);
        $('#canvas_wrapper').attr('data-active-alignment-preview', target.previewKind);
        renderAlignmentDiagnostics();
    }

    function diagnosticVector(values, digits = 0) {
        if (!Array.isArray(values) || values.length !== 3 || values.some((value) => !Number.isFinite(Number(value)))) {
            return '—';
        }
        return ['X', 'Y', 'Z']
            .map((axis, index) => `${axis} ${Number(values[index]).toFixed(digits)}`)
            .join(' · ');
    }

    function objectVector(values) {
        if (!values) return null;
        return [values.X, values.Y, values.Z].map(Number);
    }

    function renderAlignmentDiagnostics() {
        const target = self.alignmentTargets.find((entry) => entry.id === self.alignmentTarget);
        if (!target) return;
        const sourceIndex = Number(target.sourceIndex);
        const source = FC.HEADING_STATUS?.sources?.[sourceIndex];
        const config = FC.HEADING_CONFIG?.sources?.[sourceIndex];
        const angles = self.alignmentDrafts.has(target.id)
            ? readAlignmentDraft(self.alignmentDrafts, target.id)
            : self.alignmentConfig;
        $('#alignmentDiagnosticAngles').text(
            `R ${Number(angles.roll).toFixed(1)}° · P ${Number(angles.pitch).toFixed(1)}° · Y ${Number(angles.yaw).toFixed(1)}°`,
        );

        const unavailable = diagnoseHeadingSourceAvailability(source, {
            timeoutMs: FC.HEADING_CONFIG?.sourceTimeoutMs,
            magnetic: sourceIndex < HEADING_SOURCE_MOVING_BASELINE,
        });
        let state = config?.enabled === false ? 'Disabled' : unavailable.label;
        let stateClass = config?.enabled === false ? 'is-stale' : unavailable.stateClass;
        if (source?.calibrationFailed) {
            state = 'Calibration failed';
            stateClass = 'is-error';
        } else if (source?.rejected) {
            state = 'Rejected by fusion';
            stateClass = 'is-warning';
        } else if (source?.active) {
            if (sourceIndex < HEADING_SOURCE_MOVING_BASELINE && source.quality === 0) {
                state = 'Active in fused heading · field quality low';
                stateClass = 'is-warning';
            } else {
                state = 'Active in fused heading';
                stateClass = 'is-active';
            }
        } else if (source?.healthy) {
            state = 'Healthy standby';
            stateClass = 'is-healthy';
        } else if (!supportsHeadingFusion && sourceIndex === 0) {
            state = 'Onboard compass';
            stateClass = 'is-healthy';
        }
        $('#alignmentDiagnosticState')
            .text(state)
            .removeClass('is-stale is-error is-warning is-active is-healthy')
            .addClass(stateClass);

        const sourceHeading = source && source.ageMs !== 0xffff
            ? `${(Number(source.headingCentidegrees) / 100).toFixed(2)}°`
            : sourceIndex === 0 && Number.isFinite(Number(FC.SENSOR_DATA?.kinematics?.[2]))
                ? `${Number(FC.SENSOR_DATA.kinematics[2]).toFixed(2)}° aircraft`
                : '—';
        $('#alignmentDiagnosticHeading').text(sourceHeading);
        $('#alignmentDiagnosticFused').text(
            FC.HEADING_STATUS?.activeMask
                ? `${(Number(FC.HEADING_STATUS.fusedHeadingCentidegrees) / 100).toFixed(2)}° · primary ${Number(FC.HEADING_STATUS.anchorSource) + 1}`
                : '—',
        );
        $('#alignmentDiagnosticSample').text(
            unavailable.reason === 'no-sample'
                ? 'No current source sample'
                : unavailable.reason === 'stale'
                    ? `${unavailable.ageMs} ms old · stale · quality ${unavailable.quality}%`
                    : unavailable.reason === 'field-quality-low'
                        ? `${unavailable.ageMs} ms old · fresh · field quality 0%`
                        : `${unavailable.ageMs} ms old · quality ${unavailable.quality}%`,
        );

        let calibration = '—';
        if (sourceIndex < 3) {
            if (source?.calibrating) calibration = 'Calibrating';
            else if (source?.calibrationFailed) calibration = 'Failed / rejected';
            else if (source?.calibrated) calibration = 'Calibrated';
            else calibration = 'Calibration required';
        } else {
            calibration = 'Not applicable (GNSS yaw)';
        }
        $('#alignmentDiagnosticCalibration').text(calibration);

        let vector = '—';
        let zero = '—';
        let gain = '—';
        let detail = 'Diagnostics update independently of unsaved alignment edits.';
        if (sourceIndex === 0) {
            vector = diagnosticVector(FC.SENSOR_DATA?.magnetometer, 3);
            zero = diagnosticVector(objectVector(FC.CALIBRATION_DATA?.magZero));
            gain = diagnosticVector(objectVector(FC.CALIBRATION_DATA?.magGain));
            detail = 'Live vector is the standard onboard magnetometer sample. Zero and gain are the saved onboard calibration.';
        } else if (sourceIndex === 1) {
            zero = diagnosticVector(FC.HEADING_CONFIG?.externalMagZero);
            gain = diagnosticVector(FC.HEADING_CONFIG?.externalMagGain);
            vector = sourceHeading === '—' ? '—' : `heading vector → ${sourceHeading}`;
            detail = 'External-I²C heading, sample health, age, quality, calibration zero, and calibration gain are reported independently.';
        } else if (sourceIndex === 2) {
            zero = diagnosticVector(FC.HEADING_CONFIG?.dronecanMagZeroMilliGauss);
            gain = diagnosticVector(FC.HEADING_CONFIG?.dronecanMagGainMilliGauss);
            vector = sourceHeading === '—' ? '—' : `heading vector → ${sourceHeading}`;
            detail = `DroneCAN diagnostic values are bound to ${target.binding}.`;
        } else {
            const status = FC.HEADING_STATUS;
            vector = status
                ? `Base→Rover ${Number(status.baselineHeadingCentidegrees / 100).toFixed(2)}°`
                : '—';
            zero = status
                ? `${Number(status.baselineDistanceCm / 100).toFixed(2)} m baseline`
                : '—';
            gain = status
                ? `${Number(status.baselineAccuracyCentidegrees / 100).toFixed(2)}° accuracy`
                : '—';
            detail = status
                ? `${status.baselineFixed ? 'RTK Fixed' : 'Not RTK Fixed'} · provider ${status.baselineProvider} · node ${status.baselineNodeId || '—'}`
                : 'Waiting for moving-baseline status.';
        }
        $('#alignmentDiagnosticVector').text(vector);
        $('#alignmentDiagnosticZero').text(zero);
        $('#alignmentDiagnosticGain').text(gain);
        $('#alignmentDiagnosticVectorLabel').text(sourceIndex === 3 ? 'Relative heading' : 'Live vector');
        $('#alignmentDiagnosticZeroLabel').text(sourceIndex === 3 ? 'Baseline length' : 'Calibration zero');
        $('#alignmentDiagnosticGainLabel').text(sourceIndex === 3 ? 'Heading accuracy' : 'Calibration gain');
        $('#alignmentDiagnosticDetail').text(detail);
    }

    function switchAlignmentTarget(targetId) {
        const target = self.alignmentTargets.find((entry) => entry.id === targetId);
        if (!target) return;
        commitCurrentAlignmentTarget();
        self.alignmentTarget = target.id;

        if (target.id === ALIGNMENT_TARGET_LEGACY_MAG) {
            self.isSavePreset = self.legacyIsSavePreset;
            $('#legacyMagPresetControl').removeClass('is-hidden').prop('hidden', false);
            $('#legacyHardwarePreviewControl').removeClass('is-hidden').prop('hidden', false);
            if (self.isSavePreset) enableSavePreset();
            else disableSavePreset();
            self.elementToShow = self.legacyPreviewIndex;
            $('#element_to_show').val(String(self.legacyPreviewIndex));
        } else {
            self.isSavePreset = false;
            $('#legacyMagPresetControl').addClass('is-hidden').prop('hidden', true);
            $('#legacyHardwarePreviewControl').addClass('is-hidden').prop('hidden', true);
            self.elementToShow = target.previewIndex;
        }

        setAxisAvailability(target);
        populateAlignmentControls(readAlignmentDraft(self.alignmentDrafts, target.id));
        $('#alignmentTargetDescription').text(target.description);
        renderAlignmentTargetIdentity(target);
        renderAlignmentDraftSummary();
        updateMagCliString();
    }

    function enableSavePreset() {
        self.isSavePreset = true;
        self.pageElements.orientation_mag_e.css("opacity", 1);
        self.pageElements.orientation_mag_e.css("text-decoration", "");
        self.pageElements.align_mag_xxx_e.css("opacity", "0.65");
        self.pageElements.align_mag_xxx_e.css("text-decoration", "line-through");
    }

    function disableSavePreset() {
        self.isSavePreset = false;
        self.pageElements.orientation_mag_e.css("opacity", 0.5);
        self.pageElements.orientation_mag_e.css("text-decoration", "line-through");
        self.pageElements.align_mag_xxx_e.css("opacity", "1");
        self.pageElements.align_mag_xxx_e.css("text-decoration", "");
    }


    //Called when a preset is selected
    function presetUpdated(degrees) {
        enableSavePreset();
        updatePitchAxis(degrees[0]);
        updateRollAxis(degrees[1]);
        updateYawAxis(degrees[2]);
        updateMagCliString();
    }


    function process_html() {

       i18n.localize();;

        // initialize 3D
        self.initialize3D();

        let alignments = FC.getSensorAlignments();

        self.pageElements.orientation_board_roll = $('#boardAlignRoll');
        self.pageElements.orientation_board_pitch = $('#boardAlignPitch');
        self.pageElements.orientation_board_yaw = $('#boardAlignYaw');
        self.pageElements.board_roll_slider = $('#board_roll_slider');
        self.pageElements.board_pitch_slider = $('#board_pitch_slider');
        self.pageElements.board_yaw_slider = $('#board_yaw_slider');

        self.pageElements.orientation_mag_e = $('select.magalign');
        self.pageElements.orientation_mag_roll = $('#alignRoll');
        self.pageElements.orientation_mag_pitch = $('#alignPitch');
        self.pageElements.orientation_mag_yaw = $('#alignYaw');
        self.pageElements.roll_slider = $('#roll_slider');
        self.pageElements.pitch_slider = $('#pitch_slider');
        self.pageElements.yaw_slider = $('#yaw_slider');

        self.pageElements.align_mag_xxx_e = $('#align_mag_xxx');

        self.pageElements.cli_settings_fc = $('#cli_settings_fc');
        self.pageElements.cli_settings_mag = $('#cli_settings_mag');

        self.pageElements.comment_sensor_mag_preset = $('#comment_sensor_mag_preset');
        self.pageElements.comment_sensor_mag_angles = $('#comment_sensor_mag_angles');

        self.roll_e = $('dd.roll'),
        self.pitch_e = $('dd.pitch'),
        self.heading_e = $('dd.heading');

        for (let i = 0; i < alignments.length; i++) {
            self.pageElements.orientation_mag_e.append('<option value="' + (i + 1) + '">' + alignments[i] + '</option>');
        }
        self.pageElements.orientation_mag_e.val(FC.SENSOR_ALIGNMENT.align_mag);

        if (areAnglesZero()) {
            //If using a preset, checking if custom values are equal to 0
            //Update the slider, but don't save the value until they will be not modified.
            const degrees = getAxisDegreeWithPresetAndBoardOrientation(FC.SENSOR_ALIGNMENT.align_mag);
            presetUpdated(degrees);
        }
        else {
            updateRollAxis(self.alignmentConfig.roll);
            updatePitchAxis(self.alignmentConfig.pitch);
            updateYawAxis(self.alignmentConfig.yaw);
            disableSavePreset();
        }

        self.legacyAlignmentConfig = { ...self.alignmentConfig };
        self.legacyIsSavePreset = self.isSavePreset;
        self.alignmentTargets = enumerateAlignmentTargets({
            supportsRtkUart,
            supportsDronecanGps,
            supportsMovingBaseline,
            headingConfig: FC.HEADING_CONFIG,
            dronecanConfig: FC.DRONECAN_CONFIG,
            dronecanStatus: FC.DRONECAN_STATUS,
        });
        self.alignmentDrafts = createAlignmentDrafts({
            targets: self.alignmentTargets,
            headingConfig: FC.HEADING_CONFIG,
            legacyAngles: self.legacyAlignmentConfig,
        });
        const $alignmentTarget = $('#alignmentTarget').empty();
        for (const target of self.alignmentTargets) {
            $('<option/>').val(target.id).text(target.label).appendTo($alignmentTarget);
        }
        $alignmentTarget.val(self.alignmentTarget);
        $('#flightCommanderAlignmentTargets').toggleClass(
            'is-hidden',
            self.alignmentTargets.length === 1,
        );
        $('#alignmentTargetDescription').text(self.alignmentTargets[0].description);
        renderAlignmentTargetIdentity(self.alignmentTargets[0]);


        self.pageElements.orientation_board_roll.on('change', function () {
            updateBoardRollAxis(clamp(this, -180, 360));
        });

        self.pageElements.orientation_board_pitch.on('change', function () {
            updateBoardPitchAxis(clamp(this, -180, 360));
        });

        self.pageElements.orientation_board_yaw.on('change', function () {
            updateBoardYawAxis(clamp(this, -180, 360));
        });

        noUiSlider.create(self.pageElements.board_roll_slider[0], {
            start: [self.boardAlignmentConfig.roll],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
            }
        });

        noUiSlider.create(self.pageElements.board_pitch_slider[0], {
            start: [self.boardAlignmentConfig.pitch],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
            }
        });

        noUiSlider.create(self.pageElements.board_yaw_slider[0], {
            start: [self.boardAlignmentConfig.yaw],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                 mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
            }
        });

        
        self.pageElements.board_pitch_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updateBoardPitchAxis(values[handle]); _settingSlider = false; }
        });
        self.pageElements.board_roll_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updateBoardRollAxis(values[handle]); _settingSlider = false; }
        });
        self.pageElements.board_yaw_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updateBoardYawAxis(values[handle]); _settingSlider = false; }
        });
        

        const elementToShow = $("#element_to_show");
        elementToShow.on('change', function () {
            const value = parseInt($(this).val());
            if (self.alignmentTarget !== ALIGNMENT_TARGET_LEGACY_MAG) return;
            self.elementToShow = value;
            self.legacyPreviewIndex = value;
            self.render3D();
        });

        function clamp(input, min, max) {
            return Math.min(Math.max(parseInt($(input).val()), min), max);
        }

        self.pageElements.orientation_mag_e.on('change', function () {
            if (self.alignmentTarget !== ALIGNMENT_TARGET_LEGACY_MAG) return;
            FC.SENSOR_ALIGNMENT.align_mag = parseInt($(this).val());
            const degrees = getAxisDegreeWithPresetAndBoardOrientation(FC.SENSOR_ALIGNMENT.align_mag);
            presetUpdated(degrees);
        });

        self.pageElements.orientation_mag_e.on('mousedown', function () {
            if (self.alignmentTarget !== ALIGNMENT_TARGET_LEGACY_MAG) return;
            const degrees = getAxisDegreeWithPresetAndBoardOrientation(FC.SENSOR_ALIGNMENT.align_mag);
            presetUpdated(degrees);
        });

        self.pageElements.orientation_mag_roll.on('change', function () {
            disableSavePreset();
            updateRollAxis(clamp(this, -180, 360));
        });

        self.pageElements.orientation_mag_pitch.on('change', function () {
            disableSavePreset();
            updatePitchAxis(clamp(this, -180, 360));
        });

        self.pageElements.orientation_mag_yaw.on('change', function () {
            disableSavePreset();
            updateYawAxis(clamp(this, -180, 360));
        });

        $('a.save').on('click', function () {
            saveChainer.execute()
        });

        noUiSlider.create(self.pageElements.roll_slider[0], {
            start: [self.alignmentConfig.roll],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
                }
        });

        noUiSlider.create(self.pageElements.pitch_slider[0], {
            start: [self.alignmentConfig.pitch],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
            }
        });

        noUiSlider.create(self.pageElements.yaw_slider[0], {
            start: [self.alignmentConfig.yaw],
            range: {
                'min': [-180],
                'max': [360]
            },
            step: 1,
            pips: {
                mode: 'values',
                values: generateRange(-180, 360, 45),
                density: 4,
                stepped: true
            }
        });

        
        self.pageElements.pitch_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updatePitchAxis(values[handle]); _settingSlider = false; }
        });
        self.pageElements.roll_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updateRollAxis(values[handle]); _settingSlider = false; }
        });
        self.pageElements.yaw_slider[0].noUiSlider.on('update', (values, handle) =>  {
            if (!_settingSlider) { _settingSlider = true; updateYawAxis(values[handle]); _settingSlider = false; }
        });

        self.pageElements.pitch_slider[0].noUiSlider.on('slide', () => {
            disableSavePreset();
        });
        self.pageElements.roll_slider[0].noUiSlider.on('slide', () => {
            disableSavePreset();
        });
        self.pageElements.yaw_slider[0].noUiSlider.on('slide', () => {
            disableSavePreset();
        });

        $('#alignmentTarget').on('change.magnetometerTab', function () {
            switchAlignmentTarget($(this).val());
        });
        $('#alignmentDraftSummary').on('click.magnetometerTab', '[data-alignment-summary-target]', function () {
            const targetId = String($(this).attr('data-alignment-summary-target'));
            $('#alignmentTarget').val(targetId);
            switchAlignmentTarget(targetId);
        });
        renderAlignmentDraftSummary();
        setAxisAvailability(self.alignmentTargets[0]);
        

        function get_fast_data() {

            MSP.send_message(MSPCodes.MSP_ATTITUDE, false, false, function () {
	            self.roll_e.text(i18n.getMessage('initialSetupAttitude', [FC.SENSOR_DATA.kinematics[0]]));
	            self.pitch_e.text(i18n.getMessage('initialSetupAttitude', [FC.SENSOR_DATA.kinematics[1]]));
                self.heading_e.text(i18n.getMessage('initialSetupAttitude', [FC.SENSOR_DATA.kinematics[2]]));
                renderAlignmentDiagnostics();
                self.render3D();
            });
        }

        interval.add('setup_data_pull_fast', get_fast_data, 40);

        function get_alignment_diagnostics() {
            MSP.send_message(MSPCodes.MSP_RAW_IMU, false, false, function () {
                if (supportsHeadingFusion) {
                    mspHelper.loadFlightCommanderHeadingStatus(renderAlignmentDiagnostics);
                } else {
                    renderAlignmentDiagnostics();
                }
            });
        }

        interval.add('alignment_diagnostics_pull', get_alignment_diagnostics, 250, true);

        GUI.content_ready(callback);
    }

};


magnetometerTab.initialize3D = function () {

    var self = this,
        canvas,
        renderer,
        wrapper,
        modelWrapper,
        model_file,
        camera,
        scene,
        magModels,
        fc,
        useWebGlRenderer = false;

    canvas = $('.model-and-info #canvas');
    wrapper = $('.model-and-info #canvas_wrapper');

    // Robust WebGL capability detection with fallback
    function tryCreateWebGLContext() {
        if (!window.WebGLRenderingContext) {
            return null;
        }

        const detector_canvas = document.createElement('canvas');
        let gl = null;
        let renderMethod = null;

        // Try 1: Hardware-accelerated WebGL (best performance)
        try {
            gl = detector_canvas.getContext('webgl') || detector_canvas.getContext('experimental-webgl');
            if (gl) {
                renderMethod = 'hardware';
                console.log('[3D Magnetometer] Using hardware-accelerated WebGL');
            }
        } catch (e) {
            console.warn('[3D Magnetometer] Hardware WebGL failed:', e);
        }

        // Try 2: Software-rendered WebGL (slower but more compatible)
        if (!gl) {
            try {
                gl = detector_canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
                     detector_canvas.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: false });
                if (gl) {
                    renderMethod = 'software';
                    console.log('[3D Magnetometer] Using software-rendered WebGL (slower performance)');
                }
            } catch (e) {
                console.warn('[3D Magnetometer] Software WebGL failed:', e);
            }
        }

        return gl ? { context: gl, method: renderMethod } : null;
    }

    const webglResult = tryCreateWebGLContext();

    if (webglResult) {
        try {
            renderer = new THREE.WebGLRenderer({canvas: canvas.get(0), alpha: true, antialias: true});
            useWebGlRenderer = true;

            // Show performance notice if using software rendering
            if (webglResult.method === 'software') {
                GUI_control.prototype.log('<span style="color: orange;">3D view using software rendering (slower). Consider updating graphics drivers or disabling hardware acceleration in Options.</span>');
            }
        } catch (e) {
            console.error('[3D Magnetometer] Failed to create THREE.WebGLRenderer:', e);
            renderer = null;
            useWebGlRenderer = false;
        }
    }

    // Check if WebGL is available
    if (!renderer) {
        // WebGL not supported - show fallback message
        wrapper.html('<div class="webgl-fallback" style="display: flex; align-items: center; justify-content: center; height: 100%; color: #888; text-align: center; padding: 20px;">' +
            '<div>' +
            '<p style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold;">3D view unavailable</p>' +
            '<p style="margin: 0 0 10px 0; font-size: 12px;">WebGL could not be initialized. This may be due to:</p>' +
            '<ul style="text-align: left; margin: 10px 0; padding-left: 20px; font-size: 12px;">' +
            '<li>Graphics drivers need updating</li>' +
            '<li>Hardware acceleration issues</li>' +
            '<li>Browser or system limitations</li>' +
            '</ul>' +
            '<p style="margin: 10px 0 0 0; font-size: 12px; font-style: italic;">Try: Options → Disable 3D Hardware Acceleration, then restart</p>' +
            '</div>' +
            '</div>');

        // Provide no-op functions so the rest of the tab doesn't break
        this.render3D = function () {};
        this.resize3D = function () {};
        return;
    }

    // initialize render size for current canvas size
    renderer.setSize(wrapper.width() * 2, wrapper.height() * 2);


    // modelWrapper adds an extra axis of rotation to avoid gimbal lock with the euler angles
    modelWrapper = new THREE.Object3D();

    // load the model including materials
    if (useWebGlRenderer) {
        if (FC.MIXER_CONFIG.appliedMixerPreset === -1) {
            model_file = 'custom';
            GUI.log("<span style='color: red; font-weight: bolder'><strong>" + i18n.getMessage("mixerNotConfigured") + "</strong></span>");
        }
        else {
            model_file = mixer.getById(FC.MIXER_CONFIG.appliedMixerPreset).model;
        }
    }
    else {
        model_file = 'fallback'
    }

    // Temporary workaround for 'custom' model until akfreak's custom model is merged.
    if (model_file == 'custom') {
        model_file = 'fallback';
    }

    let _renderPending = false;
    this.render3D = function () {
        const previewKind = self.alignmentTargets
            .find((target) => target.id === self.alignmentTarget)?.previewKind;
        $('#moduleFrontArrowGlyph').css(
            'transform',
            `rotate(${Number(self.alignmentConfig.yaw)}deg)`,
        );
        $('#moduleFrontIndicator').toggleClass(
            'is-moving-baseline',
            previewKind === 'moving-baseline',
        );

        if (!magModels || !fc)
            return;

        modelWrapper.visible = true;
        magModels.forEach((model, index) => {
            model.visible = index === self.elementToShow;
        });
        fc.visible = true;

        var magRotation = new THREE.Euler(-THREE.MathUtils.degToRad(self.alignmentConfig.pitch-180), THREE.MathUtils.degToRad(-180 - self.alignmentConfig.yaw), THREE.MathUtils.degToRad(self.alignmentConfig.roll), 'YXZ');
        var matrix = (new THREE.Matrix4()).makeRotationFromEuler(magRotation);

        var boardRotation = new THREE.Euler( THREE.MathUtils.degToRad( self.boardAlignmentConfig.pitch), THREE.MathUtils.degToRad( -self.boardAlignmentConfig.yaw ), THREE.MathUtils.degToRad( self.boardAlignmentConfig.roll ), 'YXZ');
        var matrix1 = (new THREE.Matrix4()).makeRotationFromEuler(boardRotation);

/*
        if ( self.isSavePreset ) {
          matrix.premultiply(matrix1);  //preset specifies orientation relative to FC, align_max_xxx specify absolute orientation
        }
*/
        const selectedModel = magModels[self.elementToShow];
        if (selectedModel) selectedModel.rotation.setFromRotationMatrix(matrix);
        fc.rotation.setFromRotationMatrix(matrix1);

        // draw — throttled to one render per animation frame
        if (camera != null && !_renderPending) {
            _renderPending = true;
            requestAnimationFrame(() => {
                _renderPending = false;
                renderer.render(scene, camera);
            });
        }
    };

    // handle canvas resize
    this.resize3D = function () {
        renderer.setSize(wrapper.width() * 2, wrapper.height() * 2);
        camera.aspect = wrapper.width() / wrapper.height();
        camera.updateProjectionMatrix();

        self.render3D();
    };

    $(window).on('resize', this.resize3D);

    let getDistanceByModelName = function (name) {
        switch (name) {
            case "quad_x":
                return [0, 0, 3];
            case "quad_vtail":
                return [0, 0, 4.5];
            case "quad_atail":
                return [0, 0, 5];
            case "y4":
            case "y6":
            case "tricopter":
                return [0, 1.4, 0];
            case "hex_x":
            case "hex_plus":
                return [0, 2, 0];
            case "flying_wing":
            case "rudderless_plane":
            case "twin_plane":
            case "vtail_plane":
            case "vtail_single_servo_plane":
                return [0, 1.6, 0];
            case "fallback":
            default:
                return [0, 2.5, 0];

        }
    };

    // setup scene
    scene = new THREE.Scene();

    // stationary camera
    camera = new THREE.PerspectiveCamera(50, wrapper.width() / wrapper.height(), 1, 10000);
    camera.position.set(-95, 82, 50);
    let controls = new OrbitControls(camera, renderer.domElement);
    controls.update();
    controls.addEventListener( 'change', this.render3D );

    // some light
    const light = new THREE.AmbientLight(0x808080);
    const light2 = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1);
    const light3 = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1);
    light2.position.set(0, 1, 0);
    light3.position.set(0, -1, 0);

    // add camera, model, light to the foreground scene
    scene.add(light);
    scene.add(light2);
    scene.add(light3);
    scene.add(camera);
    scene.add(modelWrapper);

    //Load the models
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    const legacyMagModelNames = ['xyz', 'ak8963c', 'ak8963n', 'ak8975', 'ak8975c', 'bn_880', 'diatone_mamba_m10_pro', 'flywoo_goku_m10_pro_v3', 'foxeer_m10q_120', 'foxeer_m10q_180', 'foxeer_m10q_250',
        'geprc_gep_m10_dq', 'gy271', 'gy273', 'hglrc_m100', 'qmc5883', 'holybro_m9n_micro', 'holybro_m9n_micro', 'ist8308', 'ist8310', 'lis3mdl',
        'mag3110', 'matek_m8q', 'matek_m9n', 'matek_m10q', 'mlx90393', 'mp9250', 'qmc5883', 'flywoo_goku_m10_pro_v3', 'ws_m181'];
    const targetPreviewModelNames = [
        'matek_m10q',          // UART RTK GPS-module compass
        'holybro_m9n_micro',   // DroneCAN GPS-module compass
        'matek_m10q',          // moving-baseline Base + Rover pair
    ];
    const magModelNames = [...legacyMagModelNames, ...targetPreviewModelNames];
    magModels = [];
    //Load the UAV model
    import(`./../resources/models/model_${model_file}.gltf`).then(({default: model}) => {
    loader.load(model, (obj) => {
            const modelScene = obj.scene;
            const scaleFactor = 15;
            modelScene.scale.set(scaleFactor, scaleFactor, scaleFactor);
            modelWrapper.add(modelScene);

            const gpsOffset = getDistanceByModelName(model_file);

            magModelNames.forEach( (name, i) => 
            {
                import(`./../resources/models/model_${name}.glb`).then(({default: magModel}) => {
                    loader.load(magModel, (obj) => {
                        const moduleGroup = new THREE.Group();
                        const addModule = (moduleScene, xOffset = 0) => {
                            const scaleFactor = i === 0 ? 0.03 : i === 32 ? 0.034 : 0.04;
                            moduleScene.scale.set(scaleFactor, scaleFactor, scaleFactor);
                            moduleScene.position.set(xOffset, 0, 0);
                            moduleScene.rotation.y = 3 * Math.PI / 2;
                            moduleScene.traverse(child => {
                                if (child.material) child.material.metalness = 0;
                            });
                            moduleGroup.add(moduleScene);
                        };
                        if (i === 32) {
                            addModule(obj.scene, -2.2);
                            addModule(obj.scene.clone(true), 2.2);
                        } else {
                            addModule(obj.scene);
                        }
                        moduleGroup.position.set(gpsOffset[0], gpsOffset[1] + 0.5, gpsOffset[2]);
                        modelScene.add(moduleGroup);
                        magModels[i] = moduleGroup;
                        this.resize3D();
                    });
                });
            });

            //Load the FC model
            import('./../resources/models/model_fc.gltf').then(({default: fcModel}) => {
                loader.load(fcModel, (obj) => {
                    fc = obj.scene;
                    const scaleFactor = 0.04;
                    fc.scale.set(scaleFactor, scaleFactor, scaleFactor);
                    fc.position.set(gpsOffset[0], gpsOffset[1] - 0.5, gpsOffset[2]);
                    fc.rotation.y = 3 * Math.PI / 2;
                    modelScene.add(fc);
                    this.render3D();
                });
            });

        });
        this.render3D();
        this.resize3D();
    });
};


magnetometerTab.cleanup = function (callback) {
    $(window).off('resize', this.resize3D);
    $('#alignmentTarget').off('.magnetometerTab');
    $('#alignmentDraftSummary').off('.magnetometerTab');

    if (callback) callback();
};

export default magnetometerTab;
