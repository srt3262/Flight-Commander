'use strict';

import GUI from './../js/gui';
import FC from './fc';
import MSP from './msp';
import MSPCodes from './../js/msp/MSPCodes';
import mspHelper from './msp/MSPHelper';
import features from './feature_framework';
import periodicStatusUpdater from './periodicStatusUpdater';
import { mixer } from './model';
import jBox from 'jbox';
import i18n from './localization';
import defaultsDialogData from './defaults_dialog_entries.js';
import Settings from './settings.js';
import wizardUiBindings from './wizard_ui_bindings';
import wizardSaveFramework from './wizard_save_framework';
import {
    buildDefaultControlProfilePresetSteps,
    partitionDefaultPresetSettings,
    preflightDefaultPresetSettings,
    runDefaultPresetCallbackStep,
    runDefaultPresetTransaction,
    verifyAppliedDefaultsValue,
} from './presets/defaultPresetTransaction';

var savingDefaultsModal;

var defaultsDialog = (function () {

    let publicScope = {},
        privateScope = {};

    let $container;

    privateScope.wizardSettings = [];
    privateScope.needsShow = false;
    privateScope.inProgress = false;
    privateScope.activePreset = null;

    privateScope.closeSavingModal = function () {
        if (savingDefaultsModal) {
            savingDefaultsModal.close();
        }
    };

    privateScope.openSavingModal = function (message = '') {
        privateScope.closeSavingModal();
        $('#modal-saving-defaults-progress').text(message);
        savingDefaultsModal = new jBox('Modal', {
            width: 420,
            minHeight: 120,
            animation: false,
            closeOnClick: false,
            closeOnEsc: false,
            content: $('#modal-saving-defaults')
        }).open();
    };

    privateScope.setProgress = function ({ index, total, label }) {
        $('#modal-saving-defaults-progress').text(
            `${index + 1} / ${total}: ${label}`
        );
    };

    privateScope.fail = function (error) {
        console.error('[Defaults] Preset application failed', error);
        privateScope.inProgress = false;
        privateScope.activePreset = null;
        periodicStatusUpdater.resume();
        privateScope.closeSavingModal();
        privateScope.render();
        $container
            .find('.defaults-dialog__error')
            .text(
                `Preset application stopped: ${error?.message ?? String(error)}. `
                + (error?.settingsMayBeStaged === false
                    ? 'No preset values were written to the controller.'
                    : 'Some earlier values may already be staged on the controller; reconnect or retry before flying.')
            )
            .show();
        $container.show();
        GUI.log(`Preset application failed: ${error?.message ?? String(error)}`);
    };

    privateScope.finishSuccess = function () {
        privateScope.inProgress = false;
        privateScope.activePreset = null;
        periodicStatusUpdater.resume();
        privateScope.closeSavingModal();
        $container.hide();
    };

    // Ensure we're waiting until the setting is loaded.
    publicScope.init = async function () {
        let setting;
        try {
            setting = await mspHelper.getSetting("applied_defaults");
        } catch (error) {
            GUI.log(`Could not check first-run presets: ${error?.message ?? String(error)}`);
            return;
        }
        if (!setting) return;
        if (setting.value > 0) {
            return; //Defaults were applied, we can just ignore
        }
        
        $container = $("#defaults-wrapper");
        privateScope.render();
        $container.show();
    };


    privateScope.setFeaturesBits = async function (selectedDefaultPreset) {

        if (selectedDefaultPreset.features && selectedDefaultPreset.features.length > 0) {
            features.reset();

            for (const feature of selectedDefaultPreset.features) {
                if (feature.state) {
                    features.set(feature.bit);
                } else {
                    features.unset(feature.bit);
                }
            }

            await runDefaultPresetCallbackStep('Applying feature selections', (done) => {
                features.execute(done);
            });
        }
    };

    privateScope.saveAndVerify = async function (selectedDefaultPreset) {
        await runDefaultPresetCallbackStep('Saving settings to EEPROM', (done) => {
            mspHelper.saveToEeprom(done);
        });
        const marker = await runDefaultPresetCallbackStep('Reading preset confirmation', (done) => {
            mspHelper.getSetting('applied_defaults').then(done).catch(() => done(false));
        });
        verifyAppliedDefaultsValue(selectedDefaultPreset, marker);
        GUI.log(i18n.getMessage('configurationEepromSaved'));
    };

    privateScope.saveWizardStep = function (selectedDefaultPreset, wizardStep) {
        const steps = selectedDefaultPreset.wizardPages;
        const stepName = steps[wizardStep];

        if (stepName == "receiver") {
            let $receiverPort = $container.find('#wizard-receiver-port');
            let receiverPort = $receiverPort.val();

            if (receiverPort != "-1") {
                privateScope.wizardSettings.push({
                    name: "receiverPort",
                    value: receiverPort
                });
            }

            privateScope.wizardSettings.push({
                name: "receiverProtocol",
                value: $container.find('#wizard-receiver-protocol option:selected').text()
            });
        } else if (stepName == "gps") {
            let port = $container.find('#wizard-gps-port').val();
            let baud = $container.find('#wizard-gps-baud').val();
            let protocol = $container.find('#wizard-gps-protocol option:selected').text();

            privateScope.wizardSettings.push({
                name: "gpsPort",
                value: {
                    port: port,
                    baud: baud
                }
            });

            privateScope.wizardSettings.push({
                name: "gpsProtocol",
                value: protocol
            });
        }

        privateScope.wizard(selectedDefaultPreset, wizardStep + 1);
    };

    privateScope.wizard = function (selectedDefaultPreset, wizardStep) {

        const steps = selectedDefaultPreset.wizardPages;
        const stepsCount = selectedDefaultPreset.wizardPages.length;
        const stepName = steps[wizardStep];

        if (wizardStep >= stepsCount) {
            //This is the last step, time to finalize
            $container.hide();
            privateScope.openSavingModal('Saving receiver and GPS selections…');
            (async () => {
                await runDefaultPresetCallbackStep('Saving setup-wizard selections', (done) => {
                    wizardSaveFramework.persist(privateScope.wizardSettings, done);
                });
                await privateScope.saveAndVerify(selectedDefaultPreset);
                if (selectedDefaultPreset.reboot) {
                    privateScope.reboot();
                } else {
                    privateScope.finishSuccess();
                }
            })().catch(privateScope.fail);
        } else {
            const $content = $container.find('.defaults-dialog__wizard');

            $content.unbind();

            import(`./../wizard/step-${stepName}.html?raw`).then(({default: data}) => {
                $content.html("");
                $(data).appendTo($content);

                import('./../wizard/step-buttons.html?raw').then(({default: data}) => {
                    $(data).appendTo($content);

                    $content.on('click', '#wizard-next', function () {
                        privateScope.saveWizardStep(selectedDefaultPreset, wizardStep);
                    });

                    $content.on('click', '#wizard-skip', function () {
                        privateScope.wizard(selectedDefaultPreset, wizardStep + 1);
                    });

                    if (stepName == "receiver") {
                        /**
                         * Bindings executed when the receiver wizard tab is loaded
                         */
                        wizardUiBindings.receiver($content);
                    } else if (stepName == "gps") {
                        /**
                         * Bindings executed when the GPS wizard tab is loaded
                         * 
                         */
                        wizardUiBindings.gps($content);
                    }

                    Settings.configureInputs().then(
                        function () {
                            console.log('configure done');
                            $container.find('.defaults-dialog__content').hide();
                            $container.find('.defaults-dialog__wizard').show();

                            savingDefaultsModal.close();
                            $container.show();
                        }
                    ).catch(privateScope.fail);
                });
            }).catch(privateScope.fail);
        }

    };

    privateScope.reboot = function () {
        periodicStatusUpdater.resume();
        privateScope.inProgress = false;
        privateScope.activePreset = null;
        privateScope.closeSavingModal();
        $container.hide();

        GUI.tab_switch_cleanup(function () {
            let reconnectStarted = false;
            const reconnect = function () {
                if (reconnectStarted) return;
                reconnectStarted = true;
                GUI.log(i18n.getMessage('deviceRebooting'));
                GUI.handleReconnect(false);
            };
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reconnect);
            // A reboot commonly removes USB before INAV can acknowledge it.
            // Treat that disconnect as expected and never leave the preset
            // modal waiting for an acknowledgement that cannot arrive.
            setTimeout(reconnect, 1500);
        });
    };

    privateScope.finalize = async function (selectedDefaultPreset) {
        if (selectedDefaultPreset.wizardPages) {
            privateScope.wizard(selectedDefaultPreset, 0);
        } else {
            await privateScope.saveAndVerify(selectedDefaultPreset);
            if (selectedDefaultPreset.reboot) {
                privateScope.reboot();
            } else {
                privateScope.finishSuccess();
            }
        }
    };

    privateScope.preflightPreset = async function (selectedDefaultPreset) {
        const result = await preflightDefaultPresetSettings(
            selectedDefaultPreset.settings,
            {
                inspectSetting: (name) => mspHelper.getSetting(name),
                encodeSetting: (name, value) => mspHelper.encodeSetting(name, value),
                onProgress: privateScope.setProgress,
            },
        );
        if (result.skipped.length > 0) {
            GUI.log(
                `Preset compatibility: skipped optional settings not compiled for this target: ${result.skipped.map((entry) => entry.key).join(', ')}`
            );
        }
        return {
            ...selectedDefaultPreset,
            settings: result.settings,
        };
    };

    privateScope.setSettings = async function (selectedDefaultPreset) {
        if(selectedDefaultPreset.reboot) {
            periodicStatusUpdater.stop();
        }
        
        var currentBatteryProfile = parseInt($("#batteryprofilechange").val());
        if (!Number.isInteger(currentBatteryProfile)) currentBatteryProfile = 0;

        const partitionedSettings = partitionDefaultPresetSettings(
            selectedDefaultPreset.settings,
            {
                isControlProfileParameter: (key) => FC.isControlProfileParameter(key),
                isBatteryProfileParameter: (key) => FC.isBatteryProfileParameter(key),
            },
        );
        const controlProfileSettings = partitionedSettings.control;
        const batterySettings = partitionedSettings.battery;
        const miscSettings = partitionedSettings.common;
        
        const steps = Array.from(buildDefaultControlProfilePresetSteps(
            selectedDefaultPreset,
            {
                commonSettings: miscSettings,
                controlProfileSettings,
            },
            {
                selectControlProfile: function (profileIdx, callback) {
                    MSP.send_message(MSPCodes.MSP_SELECT_SETTING, [profileIdx], false, callback);
                },
                setSetting: function (key, value, callback) {
                    mspHelper.setSetting(key, value, callback);
                },
            },
        ));

        // Battery-profile values are independent of the control profile. Only
        // presets that explicitly contain them enter the battery-profile loop.
        for (let profileIdx = 0; profileIdx < 3; profileIdx++){
            if (batterySettings.length > 0) {
                steps.push({
                    label: `Selecting battery profile ${profileIdx + 1}`,
                    run: function (callback) {
                        MSP.send_message(MSPCodes.MSP2_INAV_SELECT_BATTERY_PROFILE, [profileIdx], false, callback);
                    }
                });
                batterySettings.forEach(input => {
                    steps.push({
                        label: `Battery profile ${profileIdx + 1}: ${input.key}`,
                        run: function (callback) {
                            mspHelper.setSetting(input.key, input.value, callback);
                        }
                    });
                });
            }
        }
        
        // Set Mixers
        if (selectedDefaultPreset.mixerToApply) {
            let currentMixerPreset = mixer.getById(selectedDefaultPreset.mixerToApply);

            mixer.loadServoRules(FC, currentMixerPreset);
            mixer.loadMotorRules(FC, currentMixerPreset);
            
            FC.MIXER_CONFIG.platformType = currentMixerPreset.platform;
            FC.MIXER_CONFIG.appliedMixerPreset = selectedDefaultPreset.mixerToApply;
            FC.MIXER_CONFIG.motorStopOnLow = (currentMixerPreset.motorStopOnLow === true) ? true : false;
            FC.MIXER_CONFIG.hasFlaps = (currentMixerPreset.hasFlaps === true) ? true : false;

            FC.SERVO_RULES.cleanup();
            FC.SERVO_RULES.inflate();
            FC.MOTOR_RULES.cleanup();
            FC.MOTOR_RULES.inflate();
            
            steps.push(
                { label: 'Saving mixer configuration', run: mspHelper.saveMixerConfig },
                { label: 'Saving servo mixer', run: mspHelper.sendServoMixer },
                { label: 'Saving motor mixer', run: mspHelper.sendMotorMixer }
            );
        }
            
        if (batterySettings.length > 0) {
            steps.push({
                label: 'Restoring the selected battery profile',
                run: function (callback) {
                    MSP.send_message(MSPCodes.MSP2_INAV_SELECT_BATTERY_PROFILE, [currentBatteryProfile], false, callback);
                }
            });
        }
        await runDefaultPresetTransaction(steps, {
            onProgress: privateScope.setProgress,
        });
        await privateScope.finalize(selectedDefaultPreset);
    }

    privateScope.onPresetClick = function (event) {
        event.preventDefault();
        if (privateScope.inProgress) return;
        privateScope.inProgress = true;
        privateScope.wizardSettings = [];
        $container.find('.defaults-dialog__error').hide().text('');
        privateScope.openSavingModal('Preparing preset…');

        $container.hide();

        let selectedDefaultPreset = defaultsDialogData[$(event.currentTarget).data("index")];
        privateScope.activePreset = selectedDefaultPreset;
        if (selectedDefaultPreset && selectedDefaultPreset.settings) {

            (async () => {
                const compatiblePreset = await privateScope.preflightPreset(selectedDefaultPreset);
                await privateScope.setFeaturesBits(compatiblePreset);
                await privateScope.setSettings(compatiblePreset);
            })().catch(privateScope.fail);
        } else {
            privateScope.fail(new Error('The selected preset has no settings to apply.'));
        }
    };

    privateScope.render = function () {
        $container.find('.defaults-dialog__content').show();
        $container.find('.defaults-dialog__wizard').hide();
        $container.find('.defaults-dialog__error').hide().text('');
        let $place = $container.find('.defaults-dialog__options');
        $place.html("");
        for (let i in defaultsDialogData) {
            if (defaultsDialogData.hasOwnProperty(i)) {
                let preset = defaultsDialogData[i];
                let $element = $("<div class='default_btn defaults_btn'>\
                        <a class='confirm' href='#'></a>\
                    </div>")

                if (preset.notRecommended) {
                    $element.addClass("defaults_btn--not-recommended");
                }

                let $link = $element.find("a").text(preset.title);
                if (preset.description) {
                    $link.append(
                        $("<span>")
                            .addClass("defaults-preset-description")
                            .text(preset.description)
                    );
                }
                $element.data("index", i).on('click', privateScope.onPresetClick)
                $element.appendTo($place);
            }
        }
    }

    return publicScope;
})();

export default defaultsDialog;
