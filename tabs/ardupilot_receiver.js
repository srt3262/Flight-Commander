'use strict';

import GUI from './../js/gui';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import {
  bitmaskValueFromBits,
  discoverArduPilotReceiverChannels,
  discoverArduPilotSerialPorts,
  selectedBitsFromBitmask,
  serialReceiverProtocolValue,
} from './../js/ardupilot/setupModel';
import {
  createArduPilotParameterEditor,
  bindArduPilotTabLinks,
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
const MINIMUM_CAPTURE_SPAN = 200;

const ardupilotReceiver = {
  staged: new Map(),
  serialPorts: [],
  receiverChannels: [],
  currentChannels: [],
  observedMinimums: [],
  observedMaximums: [],
  capturing: false,
  loading: false,
  writing: false,
  unsubscribeTelemetry: null,
  receiverPortStageId: null,
  receiverPortAvailable: false,
  rebootPending: false,
};

function currentValue(definition, staged) {
  return staged.get(definition.id) ?? definition.parameter.value;
}

function editorWithExplanation(definition, options = {}) {
  return createArduPilotParameterEditor(definition, options).attr(
    'title',
    `${definition.id}: ${definition.metadata.description || 'ArduPilot receiver setting'}`,
  );
}

ardupilotReceiver.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_receiver.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.staged.clear();
      this.currentChannels = [...mavlinkSession.snapshot().rcChannels];
      renderArduPilotTabIdentity('apReceiver');
      bindArduPilotTabLinks($('.tab-ardupilot-receiver'));
      $('#apReceiverRefresh').on('click', () => this.load(true));
      $('#apReceiverSave').on('click', () => this.save(false));
      $('#apReceiverSaveReboot').on('click', () => this.save(true));
      $('#apReceiverCapture').on('click', () => this.toggleCapture());
      $('#apReceiverApplyCapture').on('click', () => this.applyCapture());
      $('#apReceiverPort').on('change', () => this.stageReceiverPort());
      $('#apReceiverProtocolOptions').on(
        'change',
        'input[data-protocol-bit]',
        (event) => this.stageProtocolBits(event.currentTarget),
      );
      $('.tab-ardupilot-receiver').on(
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

ardupilotReceiver.load = async function (force) {
  if (this.loading || this.writing) return;
  this.loading = true;
  this.updateControls();
  setArduPilotTabStatus('#apReceiverStatus', 'Downloading receiver settings…');
  try {
    const result = await loadArduPilotSetup({
      force,
      onProgress: ({ received, total }) => {
        $('#apReceiverProgress').text(`${received} / ${total || '?'} parameters`);
      },
    });
    this.staged.clear();
    this.receiverPortStageId = null;
    const parameters = ardupilotSetupService.parameterManager.parameters;
    this.serialPorts = discoverArduPilotSerialPorts(parameters, result.metadata);
    this.receiverChannels = discoverArduPilotReceiverChannels(parameters, result.metadata);
    $('#apReceiverMetadata').text(metadataSourceLabel(result.metadataResult));
    $('#apReceiverProgress').text(
      `${this.receiverChannels.length} configurable channels · ${this.serialPorts.length} serial ports`,
    );
    this.render();
    setArduPilotTabStatus(
      '#apReceiverStatus',
      result.metadataResult.warning
        ? `Receiver loaded. ${result.metadataResult.warning}`
        : 'Receiver setup is ready. Move the controls and verify every live channel.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apReceiverStatus', error.message, true);
  } finally {
    this.loading = false;
    this.updateControls();
  }
};

ardupilotReceiver.render = function () {
  this.renderProtocols();
  this.renderReceiverPort();
  this.renderRssi();
  this.renderChannels();
  this.updateLiveDisplay();
};

ardupilotReceiver.renderProtocols = function () {
  const container = $('#apReceiverProtocolOptions').empty();
  const definition = parameterDefinition('RC_PROTOCOLS');
  if (!definition?.metadata.bitmask?.length) {
    container.append(
      $('<span>').addClass('fc-ap-muted').text(
        'RC_PROTOCOLS is not exposed by this firmware. Receiver protocol detection remains firmware-managed.',
      ),
    );
    $('#apReceiverProtocolsHelp').text('');
    return;
  }
  const selected = new Set(selectedBitsFromBitmask(
    currentValue(definition, this.staged),
    definition.metadata.bitmask,
  ));
  for (const choice of definition.metadata.bitmask) {
    container.append(
      $('<label>')
        .append(
          $('<input>').attr({
            type: 'checkbox',
            'data-protocol-bit': choice.value,
          }).prop('checked', selected.has(Number(choice.value))),
        )
        .append($('<span>').text(choice.label)),
    );
  }
  $('#apReceiverProtocolsHelp').text(
    `${definition.id}: ${definition.metadata.description || 'Selects which RC receiver protocols ArduPilot may auto-detect.'}`,
  );
};

ardupilotReceiver.renderReceiverPort = function () {
  const select = $('#apReceiverPort').empty();
  select.append($('<option>').val(-1).text('Do not change UART assignment'));
  const assignedPorts = [];
  for (const port of this.serialPorts) {
    const receiverValue = serialReceiverProtocolValue(port);
    if (receiverValue == null) continue;
    select.append(
      $('<option>')
        .val(port.number)
        .attr('data-receiver-protocol', receiverValue)
        .text(`${port.label} — set ${port.protocol.id} to RCIN`),
    );
    if (Number(port.protocol.parameter.value) === Number(receiverValue)) {
      assignedPorts.push(port.number);
    }
  }
  this.receiverPortAvailable = select.children().length > 1;
  select.val(assignedPorts.length === 1 ? assignedPorts[0] : -1);
  if (!this.receiverPortAvailable) {
    select.prop('disabled', true);
    $('#apReceiverPortHelp').text(
      'No SERIAL port metadata on this firmware advertises the RCIN protocol. Use Ports or All Parameters.',
    );
  } else if (assignedPorts.length > 1) {
    $('#apReceiverPortHelp').text(
      `Multiple receiver UARTs are active (${assignedPorts.map((number) => `SERIAL${number}`).join(', ')}). Select a port only to stage an additional RCIN assignment; existing assignments are not cleared automatically.`,
    );
  } else {
    $('#apReceiverPortHelp').text(
      'Assigns RCIN to the selected SERIAL port without clearing other receiver ports.',
    );
  }
};

ardupilotReceiver.renderRssi = function () {
  const type = parameterDefinition('RSSI_TYPE');
  const channel = parameterDefinition('RSSI_CHANNEL');
  const typeContainer = $('#apReceiverRssiType').empty();
  if (type) {
    typeContainer.append(editorWithExplanation(type, {
      value: currentValue(type, this.staged),
      ariaLabel: 'ArduPilot receiver RSSI source',
    }));
    $('#apReceiverRssiTypeHelp').text(
      `${type.id}: ${type.metadata.description || 'Selects where ArduPilot obtains receiver signal strength.'}`,
    );
  } else {
    typeContainer.append($('<span>').addClass('fc-ap-muted').text('Firmware managed'));
    $('#apReceiverRssiTypeHelp').text('RSSI_TYPE is not exposed by this firmware.');
  }
  $('#apReceiverRssiChannelField').prop('hidden', !channel);
  if (channel) {
    $('#apReceiverRssiChannel')
      .empty()
      .append(editorWithExplanation(channel, {
        value: currentValue(channel, this.staged),
        ariaLabel: 'RC channel carrying RSSI',
      }));
    $('#apReceiverRssiChannelHelp').text(
      `${channel.id}: ${channel.metadata.description || 'Selects the RC channel carrying PWM RSSI.'}`,
    );
  }
};

ardupilotReceiver.renderChannels = function () {
  const body = $('#apReceiverRows').empty();
  for (const channel of this.receiverChannels) {
    const row = $('<tr>').attr('data-receiver-channel', channel.channel);
    $('<td>').append($('<strong>').text(`CH${channel.channel}`)).appendTo(row);
    $('<td>')
      .append(
        $('<div>').addClass('fc-ap-channel-meter')
          .append($('<div>').addClass('fc-ap-channel-meter__fill'))
          .append($('<span>').addClass('fc-ap-channel-meter__label').text('--')),
      )
      .appendTo(row);
    for (const fieldName of ['min', 'trim', 'max', 'dz', 'reversed']) {
      const field = channel[fieldName];
      const cell = $('<td>');
      if (field) {
        const definition = parameterDefinition(field.id);
        cell.append(editorWithExplanation(definition, {
          value: currentValue(definition, this.staged),
          ariaLabel: `RC channel ${channel.channel} ${fieldName}`,
        }));
      } else {
        cell.append($('<span>').addClass('fc-ap-muted').text('—'));
      }
      row.append(cell);
    }
    const ids = ['min', 'trim', 'max', 'dz', 'reversed']
      .map((name) => channel[name]?.id)
      .filter(Boolean);
    $('<td>')
      .addClass('fc-ap-explanation')
      .append($('<code>').text(ids.join(' · ')))
      .append($('<p>').text(
        'The live bar should reach both endpoints without exceeding them; centered controls should settle near TRIM inside the dead zone.',
      ))
      .appendTo(row);
    body.append(row);
  }
  if (!body.children().length) {
    body.append(
      $('<tr>').append(
        $('<td>').attr('colspan', 8).addClass('fc-ap-empty').text(
          'This firmware did not report RCn_MIN/MAX/TRIM calibration parameters.',
        ),
      ),
    );
  }
};

ardupilotReceiver.stage = function (element) {
  const id = String($(element).data('ardupilot-parameter'));
  const definition = parameterDefinition(id);
  if (!definition) return;
  try {
    stageArduPilotParameter(this.staged, definition, $(element).val());
    setArduPilotTabStatus(
      '#apReceiverStatus',
      this.staged.size
        ? `${this.staged.size} receiver change(s) staged.`
        : 'No receiver changes staged.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apReceiverStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotReceiver.stageProtocolBits = function (changedElement) {
  const changed = $(changedElement);
  const bit = Number(changed.data('protocol-bit'));
  if (changed.prop('checked') && bit === 0) {
    $('#apReceiverProtocolOptions input[data-protocol-bit]').not(changed).prop('checked', false);
  } else if (changed.prop('checked')) {
    $('#apReceiverProtocolOptions input[data-protocol-bit="0"]').prop('checked', false);
  }
  const bits = $('#apReceiverProtocolOptions input[data-protocol-bit]:checked')
    .map((_index, element) => Number($(element).data('protocol-bit')))
    .get();
  const definition = parameterDefinition('RC_PROTOCOLS');
  if (!definition) return;
  try {
    stageArduPilotParameter(this.staged, definition, bitmaskValueFromBits(bits));
    setArduPilotTabStatus(
      '#apReceiverStatus',
      bits.length
        ? `${this.staged.size} receiver change(s) staged.`
        : 'No receiver protocol is enabled. ArduPilot will not detect a physical receiver unless another input source is configured.',
      !bits.length,
    );
  } catch (error) {
    setArduPilotTabStatus('#apReceiverStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotReceiver.stageReceiverPort = function () {
  if (this.receiverPortStageId) this.staged.delete(this.receiverPortStageId);
  this.receiverPortStageId = null;
  const selected = Number($('#apReceiverPort').val());
  if (selected < 0) {
    this.updateControls();
    return;
  }
  const port = this.serialPorts.find((candidate) => candidate.number === selected);
  const receiverValue = serialReceiverProtocolValue(port);
  const definition = port ? parameterDefinition(port.protocol.id) : null;
  if (!definition || receiverValue == null) return;
  try {
    stageArduPilotParameter(this.staged, definition, receiverValue);
    if (this.staged.has(definition.id)) this.receiverPortStageId = definition.id;
    setArduPilotTabStatus(
      '#apReceiverStatus',
      `${port.label} will use RCIN after save and reboot. Existing receiver UART assignments are not cleared automatically.`,
    );
  } catch (error) {
    setArduPilotTabStatus('#apReceiverStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotReceiver.toggleCapture = function () {
  this.capturing = !this.capturing;
  if (this.capturing) {
    this.observedMinimums = [...this.currentChannels];
    this.observedMaximums = [...this.currentChannels];
    setArduPilotTabStatus(
      '#apReceiverStatus',
      'Endpoint capture is running. Move every stick and switch through its full travel.',
    );
  } else {
    setArduPilotTabStatus(
      '#apReceiverStatus',
      'Endpoint capture stopped. Review the live values, then apply captured endpoints.',
    );
  }
  $('#apReceiverCapture').text(
    this.capturing ? 'Stop endpoint capture' : 'Start endpoint capture',
  );
  $('#apReceiverApplyCapture').prop('disabled', !this.observedMinimums.length);
};

ardupilotReceiver.applyCapture = function () {
  let stagedChannels = 0;
  for (const channel of this.receiverChannels) {
    const minimum = this.observedMinimums[channel.channel - 1];
    const maximum = this.observedMaximums[channel.channel - 1];
    if (
      !Number.isFinite(minimum)
      || !Number.isFinite(maximum)
      || maximum - minimum < MINIMUM_CAPTURE_SPAN
    ) continue;
    for (const [field, value] of [['min', Math.round(minimum)], ['max', Math.round(maximum)]]) {
      const id = channel[field]?.id;
      const input = id
        ? $(`#apReceiverRows [data-ardupilot-parameter="${id}"]`)
        : $();
      if (input.length) input.val(value).trigger('change');
    }
    stagedChannels += 1;
  }
  setArduPilotTabStatus(
    '#apReceiverStatus',
    stagedChannels
      ? `Captured MIN/MAX endpoints were staged for ${stagedChannels} channel(s). Review every value before saving.`
      : `No channel moved at least ${MINIMUM_CAPTURE_SPAN} PWM; no endpoints were staged.`,
    stagedChannels === 0,
  );
};

ardupilotReceiver.handleTelemetry = function (state) {
  this.currentChannels = [...(state.rcChannels ?? [])];
  if (this.capturing) {
    for (let index = 0; index < this.currentChannels.length; index += 1) {
      const value = this.currentChannels[index];
      if (!Number.isFinite(value)) continue;
      const previousMin = this.observedMinimums[index];
      const previousMax = this.observedMaximums[index];
      this.observedMinimums[index] = Number.isFinite(previousMin)
        ? Math.min(previousMin, value)
        : value;
      this.observedMaximums[index] = Number.isFinite(previousMax)
        ? Math.max(previousMax, value)
        : value;
    }
  }
  this.updateLiveDisplay(state);
};

ardupilotReceiver.updateLiveDisplay = function (state = mavlinkSession.snapshot()) {
  $('#apReceiverChannelCount').text(
    `${this.currentChannels.filter(Number.isFinite).length} live channels`,
  );
  $('#apReceiverLiveRssi').text(
    Number.isFinite(state.rssi) ? `${Math.round(state.rssi)} / 255` : '--',
  );
  $('#apReceiverRows tr[data-receiver-channel]').each((_index, element) => {
    const channel = Number($(element).data('receiver-channel'));
    const pwm = this.currentChannels[channel - 1];
    const available = Number.isFinite(pwm);
    const percent = available
      ? Math.max(0, Math.min(100, ((pwm - 800) / 1400) * 100))
      : 0;
    $(element).find('.fc-ap-channel-meter__fill').css('width', `${percent}%`);
    $(element).find('.fc-ap-channel-meter__label').text(
      available ? `${Math.round(pwm)} PWM` : '--',
    );
  });
};

ardupilotReceiver.save = async function (reboot) {
  if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
  if (!window.confirm(
    `Write these ArduPilot receiver settings${reboot ? ' and reboot the flight controller' : ''}? Remove propellers and re-check directions, modes, and failsafe afterward.`,
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
          '#apReceiverStatus',
          `Writing ${index + 1} / ${total}: ${id}`,
        ),
      });
      this.rebootPending ||= requiresReboot;
      this.receiverPortStageId = null;
    }
    this.render();
    if (reboot) {
      setArduPilotTabStatus('#apReceiverStatus', 'Receiver settings confirmed. Sending normal ArduPilot reboot…');
      await rebootArduPilotController();
      this.rebootPending = false;
      setArduPilotTabStatus('#apReceiverStatus', 'Reboot command sent. Reconnect and verify receiver direction, endpoints, modes, RSSI, and failsafe.');
    } else {
      setArduPilotTabStatus(
        '#apReceiverStatus',
        `${count} receiver setting(s) confirmed.`
          + `${this.rebootPending ? ' Save & reboot is available for settings that require restart.' : ''}`,
      );
    }
  } catch (error) {
    setArduPilotTabStatus(
      '#apReceiverStatus',
      `${error.message} Unwritten changes remain staged and the controller was not rebooted.`,
      true,
    );
  } finally {
    this.writing = false;
    this.updateControls();
  }
};

ardupilotReceiver.updateControls = function () {
  const busy = this.loading || this.writing;
  $('#apReceiverRefresh, #apReceiverCapture').prop('disabled', busy);
  $('#apReceiverApplyCapture').prop(
    'disabled',
    busy || !this.observedMinimums.length,
  );
  $('#apReceiverSave').prop('disabled', busy || !this.staged.size);
  $('#apReceiverSaveReboot').prop(
    'disabled',
    busy || (!this.staged.size && !this.rebootPending),
  );
  setArduPilotEditorsBusy(
    '.tab-ardupilot-receiver [data-ardupilot-parameter]',
    busy,
  );
  $('#apReceiverProtocolOptions input').prop('disabled', busy);
  $('#apReceiverPort').prop('disabled', busy || !this.receiverPortAvailable);
};

ardupilotReceiver.cleanup = function (callback) {
  this.capturing = false;
  this.unsubscribeTelemetry?.();
  this.unsubscribeTelemetry = null;
  mavlinkSession.requestMessageInterval(RC_CHANNELS_MESSAGE_ID, 5).catch(() => {});
  if (callback) callback();
};

export default ardupilotReceiver;
