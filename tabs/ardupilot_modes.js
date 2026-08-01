'use strict';

import GUI from './../js/gui';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import {
  activeArduPilotModeSlot,
  detectMovedRcChannel,
  discoverArduPilotAuxiliaryChannels,
  discoverArduPilotModeConfiguration,
} from './../js/ardupilot/setupModel';
import {
  createArduPilotParameterEditor,
  finishArduPilotTab,
  loadArduPilotSetup,
  metadataSourceLabel,
  parameterDefinition,
  rebootArduPilotController,
  renderArduPilotTabIdentity,
  setArduPilotTabStatus,
  setArduPilotEditorsBusy,
  stageArduPilotParameter,
  writeArduPilotSetupChanges,
} from './ardupilot_setup_common';

const RC_CHANNELS_MESSAGE_ID = 65;
const DETECTION_TIMEOUT_MS = 12000;

const ardupilotModes = {
  modeConfiguration: null,
  auxiliaryChannels: [],
  staged: new Map(),
  currentChannels: [],
  loading: false,
  writing: false,
  detecting: null,
  detectionBaseline: [],
  detectionTimer: null,
  unsubscribeTelemetry: null,
  rebootPending: false,
};

ardupilotModes.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_modes.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.staged.clear();
      this.currentChannels = [...mavlinkSession.snapshot().rcChannels];
      renderArduPilotTabIdentity('apModes');
      $('#apModesRefresh').on('click', () => this.load(true));
      $('#apModesSave').on('click', () => this.save(false));
      $('#apModesSaveReboot').on('click', () => this.save(true));
      $('#apModeDetect').on('click', () => this.startDetection('mode'));
      $('#apAuxDetect').on('click', () => this.startDetection('auxiliary'));
      $('.tab-ardupilot-modes').on(
        'change',
        '[data-ardupilot-parameter]',
        (event) => this.stage(event.currentTarget),
      );
      this.unsubscribeTelemetry = mavlinkSession.on(
        'telemetry',
        (state) => this.handleTelemetry(state),
      );
      mavlinkSession.requestMessageInterval(RC_CHANNELS_MESSAGE_ID, 10).catch(() => {});
      finishArduPilotTab(callback);
      this.load(false);
    });
  });
};

ardupilotModes.load = async function (force) {
  if (this.loading || this.writing) return;
  this.loading = true;
  this.updateControls();
  setArduPilotTabStatus('#apModesStatus', 'Downloading mode and receiver assignments…');
  try {
    const result = await loadArduPilotSetup({
      force,
      onProgress: ({ received, total }) => {
        $('#apModesProgress').text(`${received} / ${total || '?'} parameters`);
      },
    });
    this.staged.clear();
    const parameters = ardupilotSetupService.parameterManager.parameters;
    this.modeConfiguration = discoverArduPilotModeConfiguration(
      parameters,
      result.metadata,
    );
    this.auxiliaryChannels = discoverArduPilotAuxiliaryChannels(
      parameters,
      result.metadata,
    );
    $('#apModesMetadata').text(metadataSourceLabel(result.metadataResult));
    $('#apModesProgress').text(
      `${this.modeConfiguration?.slots.length ?? 0} mode slots · `
        + `${this.auxiliaryChannels.length} auxiliary channels`,
    );
    this.render();
    setArduPilotTabStatus(
      '#apModesStatus',
      result.metadataResult.warning
        ? `Modes loaded. ${result.metadataResult.warning}`
        : 'Mode assignments are ready. Move a switch to verify the live slot before saving.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apModesStatus', error.message, true);
  } finally {
    this.loading = false;
    this.updateControls();
  }
};

ardupilotModes.render = function () {
  const channelEditor = $('#apModeChannelEditor').empty();
  const slots = $('#apModeSlots').empty();
  if (this.modeConfiguration) {
    const channel = parameterDefinition(this.modeConfiguration.channel.id);
    channelEditor.append(createArduPilotParameterEditor(channel, {
      value: this.staged.get(channel.id) ?? channel.parameter.value,
      ariaLabel: 'Primary flight-mode RC channel',
    }));
    $('#apModeChannelParameter').text(
      `${channel.id} — ${channel.metadata.description || 'Selects the RC channel used for the six flight-mode slots.'}`,
    );
    for (const slot of this.modeConfiguration.slots) {
      const definition = parameterDefinition(slot.id);
      const card = $('<article>')
        .addClass('fc-ap-mode-slot')
        .attr({
          id: `apModeSlot${slot.slot}`,
          'data-mode-slot': slot.slot,
        });
      card
        .append(
          $('<header>')
            .append($('<strong>').text(`Position ${slot.slot}`))
            .append($('<span>').text(`${slot.label} PWM`)),
        )
        .append(createArduPilotParameterEditor(definition, {
          value: this.staged.get(definition.id) ?? definition.parameter.value,
          ariaLabel: `Mode switch position ${slot.slot}`,
        }))
        .append($('<code>').text(definition.id))
        .append(
          $('<p>').text(
            definition.metadata.description
              || `Selects the flight mode used while the mode-channel input is ${slot.label} PWM.`,
          ),
        );
      slots.append(card);
    }
  } else {
    channelEditor.append($('<span>').addClass('fc-ap-muted').text('Unavailable'));
    $('#apModeChannelParameter').text(
      'This firmware does not expose FLTMODE_CH/FLTMODEn or MODE_CH/MODEn.',
    );
    slots.append(
      $('<p>').addClass('fc-ap-empty').text(
        'Primary six-position mode assignment is unavailable for this vehicle type.',
      ),
    );
  }

  const auxBody = $('#apAuxRows').empty();
  for (const auxiliary of this.auxiliaryChannels) {
    const definition = parameterDefinition(auxiliary.id);
    const row = $('<tr>').attr({
      id: `apAuxChannel${auxiliary.channel}`,
      'data-aux-channel': auxiliary.channel,
    });
    $('<td>')
      .append($('<strong>').text(`CH${auxiliary.channel}`))
      .append($('<code>').text(definition.id))
      .appendTo(row);
    $('<td>')
      .append(
        $('<strong>')
          .addClass('fc-ap-channel-pwm')
          .attr('data-live-channel', auxiliary.channel)
          .text('--'),
      )
      .appendTo(row);
    $('<td>')
      .append(createArduPilotParameterEditor(definition, {
        value: this.staged.get(definition.id) ?? definition.parameter.value,
        ariaLabel: `RC channel ${auxiliary.channel} auxiliary function`,
      }))
      .appendTo(row);
    $('<td>')
      .addClass('fc-ap-explanation')
      .text(
        definition.metadata.description
          || 'Assigns the ArduPilot auxiliary function controlled by this RC channel.',
      )
      .appendTo(row);
    auxBody.append(row);
  }
  if (!auxBody.children().length) {
    auxBody.append(
      $('<tr>').append(
        $('<td>').attr('colspan', 4).addClass('fc-ap-empty').text(
          'This firmware did not report any RCx_OPTION parameters.',
        ),
      ),
    );
  }
  this.updateLiveDisplay();
};

ardupilotModes.stage = function (element) {
  const id = String($(element).data('ardupilot-parameter'));
  const definition = parameterDefinition(id);
  if (!definition) return;
  try {
    stageArduPilotParameter(this.staged, definition, $(element).val());
    setArduPilotTabStatus(
      '#apModesStatus',
      this.staged.size ? `${this.staged.size} mode change(s) staged.` : 'No mode changes staged.',
    );
    this.updateLiveDisplay();
  } catch (error) {
    setArduPilotTabStatus('#apModesStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotModes.startDetection = function (kind) {
  if (!this.currentChannels.some(Number.isFinite)) {
    setArduPilotTabStatus(
      '#apModesStatus',
      'No live RC_CHANNELS data is available. Verify the receiver link and telemetry stream.',
      true,
    );
    return;
  }
  this.clearDetection();
  this.detecting = kind;
  this.detectionBaseline = [...this.currentChannels];
  this.detectionTimer = window.setTimeout(() => {
    this.clearDetection();
    setArduPilotTabStatus(
      '#apModesStatus',
      'No channel moved far enough to detect. Move one switch through its full range and retry.',
      true,
    );
  }, DETECTION_TIMEOUT_MS);
  setArduPilotTabStatus(
    '#apModesStatus',
    kind === 'mode'
      ? 'Move the primary flight-mode switch through its full range…'
      : 'Move one auxiliary switch through its full range…',
  );
};

ardupilotModes.clearDetection = function () {
  if (this.detectionTimer != null) window.clearTimeout(this.detectionTimer);
  this.detectionTimer = null;
  this.detecting = null;
  this.detectionBaseline = [];
};

ardupilotModes.handleTelemetry = function (state) {
  this.currentChannels = [...(state.rcChannels ?? [])];
  if (this.detecting) {
    const allowedChannels = this.detecting === 'mode'
      ? (
          this.modeConfiguration?.channel.metadata?.values
            ?.map((choice) => Number(choice.value))
            .filter((value) => value > 0)
          ?? Array.from({ length: 18 }, (_unused, index) => index + 1)
        )
      : this.auxiliaryChannels.map((entry) => entry.channel);
    const detected = detectMovedRcChannel(
      this.detectionBaseline,
      this.currentChannels,
      { allowedChannels, threshold: 150 },
    );
    if (detected) {
      const kind = this.detecting;
      this.clearDetection();
      if (kind === 'mode') {
        const editor = $('#apModeChannelEditor [data-ardupilot-parameter]');
        editor.val(detected.channel).trigger('change');
        setArduPilotTabStatus(
          '#apModesStatus',
          `Detected CH${detected.channel} from a ${detected.delta} PWM movement and staged it as the primary mode channel.`,
        );
      } else {
        $('.fc-ap-aux-table tr').removeClass('fc-ap-detected-channel');
        const row = $(`#apAuxChannel${detected.channel}`)
          .addClass('fc-ap-detected-channel');
        row[0]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        setArduPilotTabStatus(
          '#apModesStatus',
          `Detected auxiliary CH${detected.channel} from a ${detected.delta} PWM movement. Choose its function in the highlighted row.`,
        );
      }
    }
  }
  this.updateLiveDisplay();
};

ardupilotModes.updateLiveDisplay = function () {
  $('[data-live-channel]').each((_index, element) => {
    const channel = Number($(element).data('live-channel'));
    const pwm = this.currentChannels[channel - 1];
    $(element).text(Number.isFinite(pwm) ? `${Math.round(pwm)} PWM` : '--');
  });
  let channel = null;
  if (this.modeConfiguration) {
    const id = this.modeConfiguration.channel.id;
    channel = Number(this.staged.get(id) ?? this.modeConfiguration.channel.parameter.value);
  }
  const pwm = channel > 0 ? this.currentChannels[channel - 1] : null;
  $('#apModeLivePwm').text(Number.isFinite(pwm) ? `${Math.round(pwm)} PWM · CH${channel}` : '-- PWM');
  const activeSlot = activeArduPilotModeSlot(pwm);
  $('.fc-ap-mode-slot').each((_index, element) => {
    $(element).toggleClass(
      'fc-ap-mode-slot--active',
      Number($(element).data('mode-slot')) === activeSlot,
    );
  });
};

ardupilotModes.save = async function (reboot) {
  if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
  if (!window.confirm(
    `Write these ArduPilot mode assignments${reboot ? ' and reboot the flight controller' : ''}? Verify every switch position before flight.`,
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
          '#apModesStatus',
          `Writing ${index + 1} / ${total}: ${id}`,
        ),
      });
      this.rebootPending ||= requiresReboot;
    }
    this.render();
    if (reboot) {
      setArduPilotTabStatus('#apModesStatus', 'Mode settings confirmed. Sending normal ArduPilot reboot…');
      await rebootArduPilotController();
      this.rebootPending = false;
      setArduPilotTabStatus('#apModesStatus', 'Reboot command sent. Reconnect and verify every mode switch position.');
    } else {
      setArduPilotTabStatus(
        '#apModesStatus',
        `${count} mode setting(s) confirmed.`
          + `${this.rebootPending ? ' Save & reboot is available for settings that require restart.' : ''}`,
      );
    }
  } catch (error) {
    setArduPilotTabStatus(
      '#apModesStatus',
      `${error.message} Unwritten changes remain staged and the controller was not rebooted.`,
      true,
    );
  } finally {
    this.writing = false;
    this.updateControls();
  }
};

ardupilotModes.updateControls = function () {
  const busy = this.loading || this.writing;
  $('#apModesRefresh, #apModeDetect, #apAuxDetect').prop('disabled', busy);
  $('#apModesSave').prop('disabled', busy || !this.staged.size);
  $('#apModesSaveReboot').prop(
    'disabled',
    busy || (!this.staged.size && !this.rebootPending),
  );
  setArduPilotEditorsBusy(
    '.tab-ardupilot-modes [data-ardupilot-parameter]',
    busy,
  );
};

ardupilotModes.cleanup = function (callback) {
  this.clearDetection();
  this.unsubscribeTelemetry?.();
  this.unsubscribeTelemetry = null;
  mavlinkSession.requestMessageInterval(RC_CHANNELS_MESSAGE_ID, 5).catch(() => {});
  if (callback) callback();
};

export default ardupilotModes;
