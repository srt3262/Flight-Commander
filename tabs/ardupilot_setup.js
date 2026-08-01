'use strict';

import GUI from './../js/gui';
import {
  bindArduPilotTabLinks,
  createArduPilotParameterEditor,
  finishArduPilotTab,
  loadArduPilotSetup,
  metadataSourceLabel,
  ardupilotParameterExplanation,
  parameterDefinition,
  rebootArduPilotController,
  renderArduPilotTabIdentity,
  setArduPilotTabStatus,
  setArduPilotEditorsBusy,
  stageArduPilotParameter,
  writeArduPilotSetupChanges,
} from './ardupilot_setup_common';

const BASIC_PARAMETER_CANDIDATES = Object.freeze([
  Object.freeze({ ids: ['FRAME_CLASS'], label: 'Frame class' }),
  Object.freeze({ ids: ['FRAME_TYPE'], label: 'Frame type' }),
  Object.freeze({ ids: ['MAV_SYSID', 'SYSID_THISMAV'], label: 'Vehicle system ID' }),
]);

const ardupilotSetup = {
  staged: new Map(),
  loading: false,
  writing: false,
  rebootPending: false,
};

ardupilotSetup.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_setup.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.staged.clear();
      renderArduPilotTabIdentity('apSetup');
      bindArduPilotTabLinks($('.tab-ardupilot-setup'));
      $('#apSetupRefresh').on('click', () => this.load(true));
      $('#apSetupSave').on('click', () => this.save());
      $('#apSetupSaveReboot').on('click', () => this.save(true));
      $('#apSetupBasicFields').on(
        'change',
        '[data-ardupilot-parameter]',
        (event) => this.stage(event.currentTarget),
      );
      finishArduPilotTab(callback);
      this.load(false);
    });
  });
};

ardupilotSetup.load = async function (force) {
  if (this.loading || this.writing) return;
  this.loading = true;
  this.updateControls();
  setArduPilotTabStatus('#apSetupStatus', 'Downloading parameters and matching metadata…');
  try {
    const result = await loadArduPilotSetup({
      force,
      onProgress: ({ received, total }) => {
        $('#apSetupProgress').text(`${received} / ${total || '?'} parameters`);
      },
    });
    this.staged.clear();
    $('#apSetupProgress').text(`${result.parameters.length} controller parameters`);
    $('#apSetupMetadata').text(metadataSourceLabel(result.metadataResult));
    this.renderFields();
    setArduPilotTabStatus(
      '#apSetupStatus',
      result.metadataResult.warning
        ? `Setup loaded. ${result.metadataResult.warning}`
        : 'ArduPilot setup is ready.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apSetupStatus', error.message, true);
  } finally {
    this.loading = false;
    this.updateControls();
  }
};

ardupilotSetup.renderFields = function () {
  const container = $('#apSetupBasicFields').empty();
  for (const field of BASIC_PARAMETER_CANDIDATES) {
    const definition = field.ids.map(parameterDefinition).find(Boolean);
    if (!definition) continue;
    const wrapper = $('<label>').addClass('fc-ap-field');
    wrapper
      .append($('<span>').text(field.label))
      .append(createArduPilotParameterEditor(definition))
      .append($('<small>').text(
        `${definition.id} — ${ardupilotParameterExplanation(definition, 'airframe setup')}`,
      ));
    container.append(wrapper);
  }
  if (!container.children().length) {
    container.append(
      $('<p>').addClass('fc-ap-empty').text(
        'This vehicle does not expose the common airframe identity parameters. Use All Parameters for its firmware-specific setup.',
      ),
    );
  }
};

ardupilotSetup.stage = function (element) {
  const id = String($(element).data('ardupilot-parameter'));
  const definition = parameterDefinition(id);
  if (!definition) return;
  try {
    stageArduPilotParameter(this.staged, definition, $(element).val());
    setArduPilotTabStatus(
      '#apSetupStatus',
      this.staged.size ? `${this.staged.size} airframe change(s) staged.` : 'No airframe changes staged.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apSetupStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotSetup.save = async function (reboot = false) {
  if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
  if (!window.confirm(
    `Write these ArduPilot airframe settings${reboot ? ' and reboot the flight controller' : ''}? Remove propellers and verify the airframe, output order, directions, and failsafe before flight.`,
  )) return;
  this.writing = true;
  this.updateControls();
  try {
    const count = this.staged.size;
    if (count) {
      const requiresReboot = [...this.staged.keys()].some(
        (id) => parameterDefinition(id)?.metadata?.rebootRequired,
      );
      await writeArduPilotSetupChanges(this.staged, {
        onProgress: ({ index, total, id }) => setArduPilotTabStatus(
          '#apSetupStatus',
          `Writing ${index + 1} / ${total}: ${id}`,
        ),
      });
      this.rebootPending ||= requiresReboot;
    }
    this.renderFields();
    if (reboot) {
      setArduPilotTabStatus('#apSetupStatus', 'Settings confirmed. Sending normal ArduPilot reboot…');
      await rebootArduPilotController();
      this.rebootPending = false;
      setArduPilotTabStatus('#apSetupStatus', 'Reboot command sent. Wait for the controller to restart, then reconnect if needed.');
    } else {
      setArduPilotTabStatus(
        '#apSetupStatus',
        `${count} airframe setting(s) confirmed by the controller.`
          + `${this.rebootPending ? ' Save & reboot is available for settings that require restart.' : ''}`,
      );
    }
  } catch (error) {
    setArduPilotTabStatus(
      '#apSetupStatus',
      `${error.message} Unwritten changes remain staged.`,
      true,
    );
  } finally {
    this.writing = false;
    this.updateControls();
  }
};

ardupilotSetup.updateControls = function () {
  $('#apSetupRefresh').prop('disabled', this.loading || this.writing);
  $('#apSetupSave').prop(
    'disabled',
    this.loading || this.writing || !this.staged.size,
  );
  $('#apSetupSaveReboot').prop(
    'disabled',
    this.loading || this.writing || (!this.staged.size && !this.rebootPending),
  );
  setArduPilotEditorsBusy(
    '#apSetupBasicFields [data-ardupilot-parameter]',
    this.loading || this.writing,
  );
};

ardupilotSetup.cleanup = function (callback) {
  if (callback) callback();
};

export default ardupilotSetup;
