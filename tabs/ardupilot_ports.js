'use strict';

import GUI from './../js/gui';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import { discoverArduPilotSerialPorts } from './../js/ardupilot/setupModel';
import {
  bindArduPilotTabLinks,
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

const ardupilotPorts = {
  ports: [],
  staged: new Map(),
  loading: false,
  writing: false,
  rebootPending: false,
};

function selectedBitmaskLabels(definition) {
  const value = Math.max(0, Math.floor(Number(definition.parameter.value) || 0));
  const labels = (definition.metadata.bitmask ?? [])
    .filter((choice) => Math.floor(value / (2 ** Number(choice.value))) % 2 === 1)
    .map((choice) => choice.label);
  return labels.length ? labels.join(', ') : (value ? `Bitmask ${value}` : 'Default');
}

ardupilotPorts.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_ports.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.staged.clear();
      renderArduPilotTabIdentity('apPorts');
      bindArduPilotTabLinks($('.tab-ardupilot-ports'));
      $('#apPortsRefresh').on('click', () => this.load(true));
      $('#apPortsSave').on('click', () => this.save());
      $('#apPortsSaveReboot').on('click', () => this.save(true));
      $('#apPortsRows').on(
        'change',
        '[data-ardupilot-parameter]',
        (event) => this.stage(event.currentTarget),
      );
      finishArduPilotTab(callback);
      this.load(false);
    });
  });
};

ardupilotPorts.load = async function (force) {
  if (this.loading || this.writing) return;
  this.loading = true;
  this.updateControls();
  setArduPilotTabStatus('#apPortsStatus', 'Downloading serial-port settings…');
  try {
    const result = await loadArduPilotSetup({
      force,
      onProgress: ({ received, total }) => {
        $('#apPortsProgress').text(`${received} / ${total || '?'} parameters`);
      },
    });
    this.staged.clear();
    this.ports = discoverArduPilotSerialPorts(
      ardupilotSetupService.parameterManager.parameters,
      result.metadata,
    );
    $('#apPortsMetadata').text(metadataSourceLabel(result.metadataResult));
    $('#apPortsProgress').text(`${this.ports.length} serial interfaces detected`);
    this.render();
    setArduPilotTabStatus(
      '#apPortsStatus',
      result.metadataResult.warning
        ? `Ports loaded. ${result.metadataResult.warning}`
        : 'Port assignments are ready. Select a function and matching baud, then save.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apPortsStatus', error.message, true);
  } finally {
    this.loading = false;
    this.updateControls();
  }
};

ardupilotPorts.render = function () {
  const body = $('#apPortsRows').empty();
  for (const port of this.ports) {
    const protocol = parameterDefinition(port.protocol.id);
    const baud = port.baud ? parameterDefinition(port.baud.id) : null;
    const options = port.options ? parameterDefinition(port.options.id) : null;
    if (!protocol) continue;

    const row = $('<tr>').attr('data-port-number', port.number);
    $('<td>')
      .addClass('fc-ap-port-name')
      .append($('<strong>').text(port.label))
      .append($('<code>').text(protocol.id))
      .appendTo(row);
    $('<td>')
      .append(createArduPilotParameterEditor(protocol, {
        value: this.staged.get(protocol.id) ?? protocol.parameter.value,
        ariaLabel: `${port.label} function or protocol`,
      }))
      .appendTo(row);
    const baudCell = $('<td>');
    if (baud) {
      baudCell.append(createArduPilotParameterEditor(baud, {
        value: this.staged.get(baud.id) ?? baud.parameter.value,
        ariaLabel: `${port.label} baud rate`,
      }));
    } else {
      baudCell.text('Firmware managed');
    }
    baudCell.appendTo(row);
    $('<td>')
      .append(
        options
          ? $('<span>')
              .addClass('fc-ap-option-summary')
              .attr('title', `${options.id}: ${options.metadata.description || 'UART electrical and driver options'}`)
              .text(selectedBitmaskLabels(options))
          : $('<span>').addClass('fc-ap-muted').text('Not exposed'),
      )
      .appendTo(row);
    $('<td>')
      .addClass('fc-ap-explanation')
      .append($('<p>').text(protocol.metadata.description || port.description))
      .append(
        baud
          ? $('<small>').text(
              `${baud.id}: ${baud.metadata.description || 'Sets this port’s serial wire speed.'}`,
            )
          : null,
      )
      .appendTo(row);
    body.append(row);
  }
  if (!body.children().length) {
    body.append(
      $('<tr>').append(
        $('<td>').attr('colspan', 5).addClass('fc-ap-empty').text(
          'This controller did not report any SERIALx_PROTOCOL parameters.',
        ),
      ),
    );
  }
};

ardupilotPorts.stage = function (element) {
  const id = String($(element).data('ardupilot-parameter'));
  const definition = parameterDefinition(id);
  if (!definition) return;
  try {
    stageArduPilotParameter(this.staged, definition, $(element).val());
    setArduPilotTabStatus(
      '#apPortsStatus',
      this.staged.size
        ? `${this.staged.size} port change(s) staged. They take effect after reboot.`
        : 'No port changes staged.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apPortsStatus', error.message, true);
  }
  this.updateControls();
};

ardupilotPorts.save = async function (reboot = false) {
  if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
  if (!window.confirm(
    `Write these ArduPilot serial-port settings${reboot ? ' and reboot the flight controller' : ''}? An incorrect protocol or baud can disconnect telemetry after reboot.`,
  )) return;
  this.writing = true;
  this.updateControls();
  try {
    const count = this.staged.size;
    if (count) {
      await writeArduPilotSetupChanges(this.staged, {
        onProgress: ({ index, total, id }) => setArduPilotTabStatus(
          '#apPortsStatus',
          `Writing ${index + 1} / ${total}: ${id}`,
        ),
      });
      this.rebootPending = true;
    }
    this.render();
    if (reboot) {
      setArduPilotTabStatus('#apPortsStatus', 'Port settings confirmed. Sending normal ArduPilot reboot…');
      await rebootArduPilotController();
      this.rebootPending = false;
      setArduPilotTabStatus('#apPortsStatus', 'Reboot command sent. Reconnect at the configured baud when the controller returns.');
    } else {
      setArduPilotTabStatus(
        '#apPortsStatus',
        `${count} port setting(s) confirmed. Use Save & reboot to apply them.`,
      );
    }
  } catch (error) {
    setArduPilotTabStatus(
      '#apPortsStatus',
      `${error.message} Unwritten changes remain staged.`,
      true,
    );
  } finally {
    this.writing = false;
    this.updateControls();
  }
};

ardupilotPorts.updateControls = function () {
  $('#apPortsRefresh').prop('disabled', this.loading || this.writing);
  $('#apPortsSave').prop(
    'disabled',
    this.loading || this.writing || !this.staged.size,
  );
  $('#apPortsSaveReboot').prop(
    'disabled',
    this.loading || this.writing || (!this.staged.size && !this.rebootPending),
  );
  setArduPilotEditorsBusy(
    '#apPortsRows [data-ardupilot-parameter]',
    this.loading || this.writing,
  );
};

ardupilotPorts.cleanup = function (callback) {
  if (callback) callback();
};

export default ardupilotPorts;
