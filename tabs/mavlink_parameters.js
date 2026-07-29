'use strict';

import GUI from './../js/gui';
import { mavlinkParameterManager } from './../js/mavlink/services';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import {
  ArduPilotParameterMetadataProvider,
} from './../js/parameters/ardupilotParameterMetadata';
import {
  buildParameterCatalog,
  matchesSearch,
  parameterView,
  validateParameterValue,
} from './../js/parameters/ardupilotParameterModel';

const metadataProvider = new ArduPilotParameterMetadataProvider();
const FLIGHT_PLANNER_OWNED_PARAMETERS = new Set(['MIS_RESTART']);

function isFlightPlannerOwnedParameter(id) {
  return FLIGHT_PLANNER_OWNED_PARAMETERS.has(
    String(id ?? '').trim().toUpperCase(),
  );
}

function sameNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-7);
}

function hexadecimalId(value, width) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0
    ? `0x${numeric.toString(16).padStart(width, '0').toUpperCase()}`
    : null;
}

const mavlinkParameters = {
  changed: new Map(),
  loading: false,
  writing: false,
  metadata: new Map(),
  metadataResult: null,
  viewMode: 'standard',
  activeCategory: null,
  unsubscribeState: null,
};

mavlinkParameters.initialize = function (callback) {
  if (GUI.active_tab !== this) {
    GUI.active_tab = this;
  }
  import('./mavlink_parameters.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.bindControls();
      this.unsubscribeState = mavlinkSession.on('state', () => this.renderIdentity());
      this.render();
      GUI.content_ready(callback);
    });
  });
};

mavlinkParameters.bindControls = function () {
  $('#parameterLoad').on('click', () => this.load());
  $('#parameterFilter').on('input', () => this.renderViews());
  $('#parameterWriteChanged').on('click', () => this.writeChanged());
  $('#parameterExport').on('click', () => this.exportJson());
  $('#parameterImport').on('click', () => this.importJson());

  $('[data-parameter-view]').on('click', (event) => {
    this.viewMode = String($(event.currentTarget).data('parameter-view'));
    this.activeCategory = null;
    this.renderViews();
  });

  $('#parameterCategories').on('click', 'button[data-parameter-category]', (event) => {
    this.activeCategory = String($(event.currentTarget).data('parameter-category'));
    this.renderGuidedView();
  });

  $('#parameterCards, #parameterRows').on('change', '[data-parameter-value]', (event) => {
    const input = $(event.currentTarget);
    const id = String(input.data('parameter-value'));
    const value = input.attr('type') === 'checkbox'
      ? (input.prop('checked') ? 1 : 0)
      : Number(input.val());
    this.stageValue(id, value);
  });

  $('#parameterCards').on('change', 'input[data-parameter-bit]', (event) => {
    const input = $(event.currentTarget);
    const id = String(input.data('parameter-id'));
    const bitmask = input.closest('[data-parameter-bitmask]');
    let value = 0;
    bitmask.find('input[data-parameter-bit]:checked').each((_index, element) => {
      value += 2 ** Number($(element).data('parameter-bit'));
    });
    this.stageValue(id, value);
  });

  $('#parameterCards, #parameterRows').on('click', 'button[data-write-parameter]', async (event) => {
    const id = String($(event.currentTarget).data('write-parameter'));
    const parameter = mavlinkParameterManager.parameters.get(id);
    await this.writeOne(id, this.changed.get(id) ?? parameter?.value);
  });
};

mavlinkParameters.load = async function () {
  if (this.loading) return;
  const state = mavlinkSession.snapshot();
  if (state.firmwareFamily !== 'ardupilot') {
    this.setStatus(
      state.firmwareFamily === 'inav'
        ? 'INAV setup parameters require a wired USB/MSP connection.'
        : 'Connect an ArduPilot vehicle over MAVLink before downloading parameters.',
      true,
    );
    return;
  }

  this.loading = true;
  this.changed.clear();
  this.updateControlState();
  this.setStatus('Downloading the complete parameter list and matching ArduPilot metadata…');
  $('#parameterProgress').text('Requesting parameters…');
  $('#parameterMetadataStatus').text('Loading official metadata…');

  try {
    const [parameters, metadataResult] = await Promise.all([
      mavlinkParameterManager.loadAll({
        onProgress: ({ received, total }) => {
          $('#parameterProgress').text(`${received} / ${total || '?'} parameters`);
        },
      }),
      metadataProvider.load(state.vehicleType, {
        firmwareVersion: state.autopilotVersion?.flight,
      }),
    ]);

    this.metadataResult = metadataResult;
    this.metadata = metadataResult.metadata;
    this.activeCategory = null;
    $('#parameterProgress').text(`${parameters.length} parameters downloaded`);
    this.renderMetadataStatus();
    this.renderViews();
    this.setStatus(
      metadataResult.warning
        ? `Parameter download complete. ${metadataResult.warning}`
        : 'Parameter download and metadata matching complete.',
    );
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.loading = false;
    this.updateControlState();
  }
};

mavlinkParameters.render = function () {
  this.renderIdentity();
  const count = mavlinkParameterManager.parameters.size;
  $('#parameterProgress').text(count ? `${count} cached controller parameters` : 'No parameters loaded.');
  this.renderMetadataStatus();
  this.renderViews();
  this.updateControlState();
};

mavlinkParameters.renderIdentity = function () {
  const state = mavlinkSession.snapshot();
  const isArduPilot = state.firmwareFamily === 'ardupilot';
  const isInav = state.firmwareFamily === 'inav';
  const version = state.autopilotVersion;
  const firmwareVersion = version?.flight?.formatted;
  const hardwareIdentity = [
    version?.vendorId != null ? `VID ${hexadecimalId(version.vendorId, 4)}` : null,
    version?.productId != null ? `PID ${hexadecimalId(version.productId, 4)}` : null,
    version?.boardVersion != null ? `board version ${hexadecimalId(version.boardVersion, 8)}` : null,
  ].filter(Boolean);

  $('#parameterFirmwareIdentity').text(
    isArduPilot
      ? `${state.autopilotName || 'ArduPilot'}${firmwareVersion ? ` ${firmwareVersion}` : ''} · MAVLink`
      : isInav
        ? 'INAV · MAVLink telemetry link'
        : 'Not identified',
  );
  $('#parameterVehicleIdentity').text(state.vehicleTypeName || 'Unknown');
  $('#parameterSystemIdentity').text(
    state.systemId == null
      ? 'Waiting for heartbeat'
      : `System ${state.systemId} · component ${state.componentId ?? 'unknown'}`,
  );
  $('#parameterBoardIdentity').text(
    isArduPilot
      ? (
        hardwareIdentity.length
          ? `${hardwareIdentity.join(' · ')} · model checked by Firmware Flasher`
          : 'Exact model requires bootloader identification'
      )
      : 'Checked by Firmware Flasher',
  );

  $('#parameterConfigurator').prop('hidden', !isArduPilot);
  $('#parameterInavNotice').prop('hidden', !isInav);
  $('#parameterUnknownNotice').prop('hidden', isArduPilot || isInav);
  this.updateControlState();
};

mavlinkParameters.renderMetadataStatus = function () {
  if (!this.metadataResult) {
    $('#parameterMetadataStatus').text('Metadata not loaded.');
    return;
  }
  const {
    profile,
    source,
    stale,
    firmwareSeries,
    versionMatched,
  } = this.metadataResult;
  const sourceLabel = source === 'official'
    ? 'official live metadata'
    : source === 'cache'
      ? (stale ? 'cached metadata (offline copy)' : 'cached official metadata')
      : 'name-based fallback';
  $('#parameterMetadataStatus').text(
    `${profile.label}${firmwareSeries && versionMatched ? ` ${firmwareSeries}` : ''}: ${this.metadata.size} definitions · ${sourceLabel}`,
  );
};

mavlinkParameters.parameterView = function (id) {
  if (isFlightPlannerOwnedParameter(id)) return null;
  const parameter = mavlinkParameterManager.parameters.get(id);
  return parameter ? parameterView(parameter, this.metadata) : null;
};

mavlinkParameters.currentValue = function (id) {
  return this.changed.get(id) ?? mavlinkParameterManager.parameters.get(id)?.value;
};

mavlinkParameters.stageValue = function (id, value) {
  if (isFlightPlannerOwnedParameter(id)) {
    this.changed.delete(id);
    this.setStatus(
      `${String(id).toUpperCase()} is managed only in Flight Planner mission behavior.`,
      true,
    );
    this.renderViews();
    return false;
  }
  const view = this.parameterView(id);
  if (!view || view.metadata.readOnly) {
    this.setStatus(`${id} is read-only and cannot be staged.`, true);
    this.renderViews();
    return false;
  }
  const validation = validateParameterValue(view, value);
  if (!validation.valid) {
    this.setStatus(validation.message, true);
    this.renderViews();
    return false;
  }

  if (sameNumber(validation.value, view.value)) {
    this.changed.delete(id);
  } else {
    this.changed.set(id, validation.value);
  }
  this.renderViews();
  this.updateControlState();
  return true;
};

mavlinkParameters.filteredParameterViews = function () {
  const query = String($('#parameterFilter').val() ?? '');
  return mavlinkParameterManager.values()
    .filter((parameter) => !isFlightPlannerOwnedParameter(parameter.id))
    .map((parameter) => parameterView(parameter, this.metadata))
    .filter((view) => matchesSearch(view, query));
};

mavlinkParameters.renderViews = function () {
  const raw = this.viewMode === 'raw';
  $('[data-parameter-view]').each((_index, element) => {
    $(element).toggleClass('active', $(element).data('parameter-view') === this.viewMode);
  });
  $('#parameterGuidedView').prop('hidden', raw);
  $('#parameterRawView').prop('hidden', !raw);

  if (raw) {
    this.renderRawRows();
  } else {
    this.renderGuidedView();
  }
  this.updateControlState();
};

mavlinkParameters.renderGuidedView = function () {
  const catalog = buildParameterCatalog(
    mavlinkParameterManager.values()
      .filter((parameter) => !isFlightPlannerOwnedParameter(parameter.id)),
    this.metadata,
    {
      level: this.viewMode,
      query: String($('#parameterFilter').val() ?? ''),
    },
  );
  const categoryNav = $('#parameterCategories').empty();
  const cards = $('#parameterCards').empty();

  if (!catalog.length) {
    this.activeCategory = null;
    cards.append(
      $('<div>')
        .addClass('fc-parameter-empty')
        .text(mavlinkParameterManager.parameters.size
          ? 'No settings match this view and search.'
          : 'Download parameters from the controller to begin configuration.'),
    );
    return;
  }

  if (!catalog.some((category) => category.id === this.activeCategory)) {
    this.activeCategory = catalog[0].id;
  }

  for (const category of catalog) {
    categoryNav.append(
      $('<button>')
        .attr({
          type: 'button',
          'data-parameter-category': category.id,
          'aria-current': category.id === this.activeCategory ? 'page' : null,
        })
        .toggleClass('active', category.id === this.activeCategory)
        .append($('<span>').text(category.label))
        .append($('<strong>').text(category.count)),
    );
  }

  const active = catalog.find((category) => category.id === this.activeCategory);
  cards.append(
    $('<div>')
      .addClass('fc-parameter-category-heading')
      .append($('<h2>').text(active.label))
      .append($('<span>').text(`${active.count} settings`)),
  );

  for (const group of active.groups) {
    const groupCard = $('<section>').addClass('fc-parameter-group');
    groupCard.append(
      $('<header>')
        .append($('<h3>').text(group.label))
        .append($('<span>').text(`${group.parameters.length} settings`)),
    );
    const settings = $('<div>').addClass('fc-parameter-settings');
    for (const view of group.parameters) {
      settings.append(this.renderParameterSetting(view));
    }
    groupCard.append(settings);
    cards.append(groupCard);
  }
};

mavlinkParameters.renderParameterSetting = function (view) {
  const currentValue = this.currentValue(view.id);
  const changed = this.changed.has(view.id);
  const setting = $('<article>')
    .addClass('fc-parameter-setting')
    .toggleClass('fc-parameter-setting--changed', changed)
    .attr('data-parameter-container', view.id);
  const details = $('<div>').addClass('fc-parameter-setting__details');
  const title = $('<div>').addClass('fc-parameter-setting__title');
  title
    .append($('<strong>').text(view.metadata.displayName || view.id))
    .append($('<code>').text(view.id));
  if (view.metadata.rebootRequired) {
    title.append($('<span>').addClass('fc-parameter-badge').text('Reboot required'));
  }
  if (view.metadata.readOnly) {
    title.append($('<span>').addClass('fc-parameter-badge fc-parameter-badge--muted').text('Read only'));
  }
  details.append(title);
  if (view.metadata.description) {
    details.append($('<p>').text(view.metadata.description));
  }

  const constraints = [];
  if (view.metadata.min != null || view.metadata.max != null) {
    constraints.push(
      `${view.metadata.min ?? '−∞'} to ${view.metadata.max ?? '∞'}`,
    );
  }
  if (view.metadata.increment != null) constraints.push(`step ${view.metadata.increment}`);
  if (view.metadata.units) constraints.push(view.metadata.units);
  if (constraints.length) {
    details.append($('<small>').text(constraints.join(' · ')));
  }

  const editor = $('<div>').addClass('fc-parameter-setting__editor');
  editor.append(this.renderTypedControl(view, currentValue));
  editor.append(
    $('<button>')
      .attr({
        type: 'button',
        'data-write-parameter': view.id,
      })
      .prop('disabled', !changed || view.metadata.readOnly)
      .text(changed ? 'Write change' : 'Confirmed'),
  );

  setting.append(details, editor);
  return setting;
};

mavlinkParameters.renderTypedControl = function (view, currentValue) {
  const disabled = Boolean(view.metadata.readOnly);
  if (view.controlKind === 'bitmask') {
    const wrapper = $('<fieldset>')
      .addClass('fc-parameter-bitmask')
      .attr('data-parameter-bitmask', view.id)
      .prop('disabled', disabled);
    for (const option of view.metadata.bitmask) {
      const mask = 2 ** option.value;
      wrapper.append(
        $('<label>')
          .append(
            $('<input>')
              .attr({
                type: 'checkbox',
                'data-parameter-bit': option.value,
                'data-parameter-id': view.id,
              })
              .prop('checked', Math.floor(Number(currentValue) / mask) % 2 === 1),
          )
          .append($('<span>').text(option.label)),
      );
    }
    return wrapper;
  }

  if (view.controlKind === 'boolean') {
    const enabled = Number(currentValue) === 1;
    const selected = view.metadata.values.find((entry) => entry.value === Number(currentValue));
    return $('<label>')
      .addClass('fc-parameter-toggle')
      .append(
        $('<input>')
          .attr({
            type: 'checkbox',
            'data-parameter-value': view.id,
          })
          .prop({ checked: enabled, disabled }),
      )
      .append($('<span>').text(selected?.label ?? (enabled ? 'Enabled' : 'Disabled')));
  }

  if (view.controlKind === 'enum') {
    const select = $('<select>')
      .attr('data-parameter-value', view.id)
      .prop('disabled', disabled);
    let matched = false;
    for (const option of view.metadata.values) {
      const selected = sameNumber(option.value, currentValue);
      matched ||= selected;
      select.append(
        $('<option>')
          .val(option.value)
          .prop('selected', selected)
          .text(`${option.value}: ${option.label}`),
      );
    }
    if (!matched) {
      select.prepend(
        $('<option>')
          .val(currentValue)
          .prop('selected', true)
          .text(`${currentValue}: controller value`),
      );
    }
    return select;
  }

  const input = $('<input>')
    .attr({
      type: 'number',
      step: view.metadata.increment ?? 'any',
      'data-parameter-value': view.id,
    })
    .prop('disabled', disabled)
    .val(currentValue);
  if (view.metadata.min != null) input.attr('min', view.metadata.min);
  if (view.metadata.max != null) input.attr('max', view.metadata.max);
  return $('<label>')
    .addClass('fc-parameter-number')
    .append(input)
    .append(view.metadata.units ? $('<span>').text(view.metadata.units) : null);
};

mavlinkParameters.renderRawRows = function () {
  const body = $('#parameterRows').empty();
  for (const view of this.filteredParameterViews()) {
    const currentValue = this.currentValue(view.id);
    const changed = this.changed.has(view.id);
    const row = $('<tr>')
      .toggleClass('fc-parameter-row--changed', changed)
      .attr('data-parameter-container', view.id);
    const name = $('<td>').addClass('fc-parameter-name');
    name.append($('<code>').text(view.id));
    if (view.metadata.displayName && view.metadata.displayName !== view.id) {
      name.append($('<small>').text(view.metadata.displayName));
    }
    row.append(name);

    const input = $('<input>')
      .attr({
        type: 'number',
        step: view.metadata.increment ?? 'any',
        'data-parameter-value': view.id,
      })
      .prop('disabled', view.metadata.readOnly)
      .val(currentValue);
    if (view.metadata.min != null) input.attr('min', view.metadata.min);
    if (view.metadata.max != null) input.attr('max', view.metadata.max);

    $('<td>')
      .append(input)
      .append(view.metadata.units ? $('<span>').addClass('fc-parameter-unit').text(view.metadata.units) : null)
      .appendTo(row);
    $('<td>').text(view.type).appendTo(row);
    $('<td>').text(view.index).appendTo(row);
    $('<td>').append(
      $('<button>')
        .attr({ type: 'button', 'data-write-parameter': view.id })
        .prop('disabled', !changed || view.metadata.readOnly)
        .text('Write'),
    ).appendTo(row);
    body.append(row);
  }
};

mavlinkParameters.writeOne = async function (id, value) {
  if (this.loading || this.writing) return;
  if (isFlightPlannerOwnedParameter(id)) {
    this.changed.delete(id);
    this.setStatus(
      `${String(id).toUpperCase()} is managed only in Flight Planner and was not written.`,
      true,
    );
    this.renderViews();
    return;
  }
  const view = this.parameterView(id);
  if (!view) {
    this.setStatus(`${id} is not present in the downloaded parameter list.`, true);
    return;
  }
  const validation = validateParameterValue(view, value);
  if (!validation.valid) {
    this.setStatus(validation.message, true);
    return;
  }
  this.writing = true;
  this.updateControlState();
  try {
    this.setStatus(`Writing ${id} and waiting for controller confirmation…`);
    const confirmed = await mavlinkParameterManager.set(id, validation.value, {
      type: view.type,
    });
    this.changed.delete(id);
    this.setStatus(`${id} confirmed by the controller at ${confirmed.value}.`);
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.writing = false;
    this.renderViews();
    this.updateControlState();
  }
};

mavlinkParameters.writeChanged = async function () {
  if (this.loading || this.writing) return;
  const plannerOwned = [...this.changed.keys()]
    .filter((id) => isFlightPlannerOwnedParameter(id));
  for (const id of plannerOwned) {
    this.changed.delete(id);
  }
  const changes = [...this.changed.entries()];
  if (!changes.length) {
    this.setStatus(
      plannerOwned.length
        ? 'MIS_RESTART is managed only in Flight Planner and was not written.'
        : 'No parameter values have changed.',
      plannerOwned.length > 0,
    );
    return;
  }
  this.writing = true;
  this.updateControlState();
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const [id, value] = changes[index];
      const view = this.parameterView(id);
      if (!view || view.metadata.readOnly) continue;
      this.setStatus(`Writing ${index + 1} / ${changes.length}: ${id}`);
      await mavlinkParameterManager.set(id, value, { type: view.type });
      this.changed.delete(id);
      this.updateControlState();
    }
    this.setStatus(`${changes.length} parameter changes were confirmed by the controller.`);
  } catch (error) {
    this.setStatus(`${error.message} Unwritten changes remain staged.`, true);
  } finally {
    this.writing = false;
    this.renderViews();
    this.updateControlState();
  }
};

mavlinkParameters.exportJson = async function () {
  try {
    const result = await window.electronAPI.showSaveDialog({
      defaultPath: 'flight-commander-ardupilot-parameters.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return;
    const state = mavlinkSession.snapshot();
    const data = {
      format: 'flight-commander-parameters',
      version: 2,
      exportedAt: new Date().toISOString(),
      firmwareFamily: state.firmwareFamily,
      vehicleType: state.vehicleType,
      vehicleTypeName: state.vehicleTypeName,
      mavlinkSystemId: state.systemId,
      parameters: mavlinkParameterManager.values(),
    };
    const error = await window.electronAPI.writeFile(result.filePath, JSON.stringify(data, null, 2));
    if (error) throw new Error(String(error));
    this.setStatus(`Parameters exported to ${result.filePath}.`);
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

mavlinkParameters.importJson = async function () {
  try {
    const result = await window.electronAPI.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.length) return;
    const file = await window.electronAPI.readFile(result.filePaths[0]);
    if (file.error) throw new Error(String(file.error));
    const parsed = JSON.parse(file.data);
    const imported = Array.isArray(parsed) ? parsed : parsed.parameters;
    if (!Array.isArray(imported)) {
      throw new Error('The selected file does not contain a parameter array.');
    }

    let staged = 0;
    let skipped = 0;
    let plannerOwnedSkipped = 0;
    for (const entry of imported) {
      const id = String(entry.id ?? entry.name ?? '').trim();
      if (isFlightPlannerOwnedParameter(id)) {
        this.changed.delete(id);
        plannerOwnedSkipped += 1;
        continue;
      }
      const view = this.parameterView(id);
      const validation = view ? validateParameterValue(view, entry.value) : { valid: false };
      if (!view || view.metadata.readOnly || !validation.valid) {
        skipped += 1;
        continue;
      }
      if (sameNumber(validation.value, view.value)) {
        this.changed.delete(id);
      } else {
        this.changed.set(id, validation.value);
        staged += 1;
      }
    }
    this.renderViews();
    this.setStatus(
      `${staged} imported values are ready to write`
      + `${skipped ? `; ${skipped} unavailable or invalid entries were skipped` : ''}`
      + `${plannerOwnedSkipped ? '; MIS_RESTART was left unchanged because it is managed in Flight Planner' : ''}.`,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

mavlinkParameters.updateControlState = function () {
  const isArduPilot = mavlinkSession.state.firmwareFamily === 'ardupilot';
  $('#parameterLoad, #parameterImport').prop(
    'disabled',
    !isArduPilot || this.loading || this.writing,
  );
  $('#parameterExport').prop(
    'disabled',
    !isArduPilot || !mavlinkParameterManager.parameters.size,
  );
  $('#parameterWriteChanged').prop(
    'disabled',
    !isArduPilot || this.loading || this.writing || !this.changed.size,
  );
  if (this.loading || this.writing) {
    $('#parameterCards button[data-write-parameter], #parameterRows button[data-write-parameter]')
      .prop('disabled', true);
  }
  $('#parameterChanged')
    .text(`${this.changed.size} changed`)
    .toggleClass('fc-parameter-changed--active', this.changed.size > 0);
};

mavlinkParameters.setStatus = function (message, error = false) {
  $('#parameterStatus')
    .text(message)
    .toggleClass('fc-action-status--error', error);
};

mavlinkParameters.cleanup = function (callback) {
  this.unsubscribeState?.();
  this.unsubscribeState = null;
  if (callback) callback();
};

export default mavlinkParameters;
