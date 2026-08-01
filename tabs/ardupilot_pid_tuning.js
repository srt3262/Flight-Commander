'use strict';

import GUI from './../js/gui';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import { discoverArduPilotPidGroups } from './../js/ardupilot/setupModel';
import {
  matchesSearch,
  parameterView,
  validateParameterValue,
} from './../js/parameters/ardupilotParameterModel';
import {
  ardupilotParameterExplanation,
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

const TUNING_PARAMETER_PATTERN = /^(?:ATC_|PSC_|RATE_|PID|AUTOTUNE|Q_A_|TECS_|AROT_|ACRO_|TUNE|RLL2SRV|PTCH2SRV|YAW2SRV)/;
const GAIN_ORDER = Object.freeze(['p', 'i', 'd', 'ff']);

const ardupilotPidTuning = {
  groups: [],
  related: [],
  staged: new Map(),
  loading: false,
  writing: false,
  rebootPending: false,
  sectionMode: 'gains',
};

function currentValue(definition, staged) {
  return staged.get(definition.id) ?? definition.parameter.value;
}

function createPidEditor(definition, options = {}) {
  const editor = createArduPilotParameterEditor(definition, options);
  if (!editor.is('input[type="number"]')) return editor;
  const min = Number(definition.metadata.min);
  const max = Number(definition.metadata.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return editor;
  }
  const increment = Number(definition.metadata.increment);
  const step = Number.isFinite(increment) && increment > 0
    ? increment
    : (max - min) / 200;
  const slider = $('<input>').attr({
    type: 'range',
    min,
    max,
    step,
    value: options.value ?? definition.parameter.value,
    'data-ardupilot-parameter': definition.id,
    'data-ardupilot-read-only': definition.metadata.readOnly ? 'true' : 'false',
    'data-ap-pid-slider': 'true',
    'aria-label': `${options.ariaLabel ?? definition.metadata.displayName ?? definition.id} slider`,
  }).prop('disabled', Boolean(definition.metadata.readOnly));
  return $('<div>')
    .addClass('fc-ap-pid-editor')
    .append(editor.addClass('fc-ap-pid-editor__number'), slider);
}

ardupilotPidTuning.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_pid_tuning.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.staged.clear();
      renderArduPilotTabIdentity('apPid');
      bindArduPilotTabLinks($('.tab-ardupilot-pid-tuning'));
      $('#apPidRefresh').on('click', () => this.load(true));
      $('#apPidSave').on('click', () => this.save(false));
      $('#apPidSaveReboot').on('click', () => this.save(true));
      $('#apPidSearch').on('input', () => this.render());
      $('[data-ap-pid-section]').on('click', (event) => {
        this.sectionMode = String($(event.currentTarget).data('ap-pid-section'));
        this.render();
      });
      $('.tab-ardupilot-pid-tuning').on(
        'input',
        'input[data-ap-pid-slider]',
        (event) => {
          $(event.currentTarget)
            .siblings('input[type="number"]')
            .val($(event.currentTarget).val());
        },
      );
      $('.tab-ardupilot-pid-tuning').on(
        'input',
        '.fc-ap-pid-editor__number',
        (event) => {
          $(event.currentTarget)
            .siblings('input[type="range"]')
            .val($(event.currentTarget).val());
        },
      );
      $('.tab-ardupilot-pid-tuning').on(
        'change',
        '[data-ardupilot-parameter]',
        (event) => this.stage(event.currentTarget),
      );
      finishArduPilotTab(callback);
      this.load(false);
    });
  });
};

ardupilotPidTuning.load = async function (force) {
  if (this.loading || this.writing) return;
  this.loading = true;
  this.updateControls();
  setArduPilotTabStatus('#apPidStatus', 'Downloading PID, filter, and control-limit parameters…');
  try {
    const result = await loadArduPilotSetup({
      force,
      onProgress: ({ received, total }) => {
        $('#apPidProgress').text(`${received} / ${total || '?'} parameters`);
      },
    });
    this.staged.clear();
    const parameters = ardupilotSetupService.parameterManager.parameters;
    this.groups = discoverArduPilotPidGroups(parameters, result.metadata);
    const gainIds = new Set(
      this.groups.flatMap((group) => Object.values(group.gains).map((gain) => gain.id)),
    );
    this.related = ardupilotSetupService.parameterManager.values()
      .filter((parameter) => (
        TUNING_PARAMETER_PATTERN.test(parameter.id)
        && !gainIds.has(parameter.id)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    $('#apPidMetadata').text(metadataSourceLabel(result.metadataResult));
    this.render();
    setArduPilotTabStatus(
      '#apPidStatus',
      result.metadataResult.warning
        ? `Tuning setup loaded. ${result.metadataResult.warning}`
        : 'Tuning setup is ready. Change one behavior at a time and retain a parameter backup.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apPidStatus', error.message, true);
  } finally {
    this.loading = false;
    this.updateControls();
  }
};

ardupilotPidTuning.visibleGroups = function () {
  const query = String($('#apPidSearch').val() ?? '').trim().toLowerCase();
  let groups = this.groups.filter((group) => {
    if (!query) return true;
    return [group.id, group.label, ...Object.values(group.gains).flatMap((gain) => [
      gain.id,
      gain.metadata?.displayName,
      gain.metadata?.description,
    ])].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
  return groups;
};

ardupilotPidTuning.visibleRelated = function () {
  const query = String($('#apPidSearch').val() ?? '');
  let views = this.related
    .map((parameter) => parameterView(parameter, ardupilotSetupService.metadata))
    .filter((view) => matchesSearch(view, query));
  return views;
};

ardupilotPidTuning.render = function () {
  $('[data-ap-pid-section]').each((_index, element) => {
    $(element).toggleClass(
      'active',
      $(element).data('ap-pid-section') === this.sectionMode,
    );
    $(element).attr(
      'aria-selected',
      String($(element).data('ap-pid-section') === this.sectionMode),
    );
  });
  $('#apPidGainPanel').prop('hidden', this.sectionMode !== 'gains');
  $('#apPidRelatedPanel').prop('hidden', this.sectionMode !== 'filters');
  const groups = this.visibleGroups();
  const body = $('#apPidRows').empty();
  for (const group of groups) {
    const row = $('<tr>');
    $('<td>')
      .addClass('fc-ap-pid-loop')
      .append($('<strong>').text(group.label))
      .append($('<code>').text(group.id))
      .appendTo(row);
    for (const gainName of GAIN_ORDER) {
      const gain = group.gains[gainName];
      const cell = $('<td>').addClass('fc-ap-pid-gain');
      if (gain) {
        const definition = parameterDefinition(gain.id);
        cell
          .append(createPidEditor(definition, {
            value: currentValue(definition, this.staged),
            ariaLabel: `${group.label} ${gainName.toUpperCase()} gain`,
          }).attr('title', `${gain.id}: ${ardupilotParameterExplanation(definition, 'PID tuning')}`))
          .append($('<code>').text(gain.id));
      } else {
        cell.append($('<span>').addClass('fc-ap-muted').text('Not used'));
      }
      cell.appendTo(row);
    }
    const help = $('<details>')
      .append($('<summary>').text('What these settings do'));
    const list = $('<dl>');
    for (const gainName of GAIN_ORDER) {
      const gain = group.gains[gainName];
      if (!gain) continue;
      const definition = parameterDefinition(gain.id);
      list
        .append($('<dt>').text(gain.id))
        .append($('<dd>').text(ardupilotParameterExplanation(definition, `${group.label} tuning`)));
    }
    help.append(list);
    $('<td>').addClass('fc-ap-pid-help').append(help).appendTo(row);
    body.append(row);
  }
  if (!body.children().length) {
    body.append($('<tr>').append(
      $('<td>').attr('colspan', 6).addClass('fc-ap-empty').text(
        this.groups.length
          ? 'No PID loops match this search and detail level.'
          : 'This firmware did not report paired P/I/D/FF control-loop parameters.',
      ),
    ));
  }
  this.renderRelated();
  $('#apPidProgress').text(
    `${groups.length} control loops · ${this.visibleRelated().length} related settings · ${this.staged.size} changed`,
  );
  this.updateControls();
};

ardupilotPidTuning.renderRelated = function () {
  const views = this.visibleRelated();
  const container = $('#apPidRelated').empty();
  const settings = $('<div>').addClass('fc-ap-feature-settings fc-ap-pid-related-settings');
  for (const view of views) {
    const definition = parameterDefinition(view.id);
    const card = $('<article>')
      .addClass('fc-ap-feature-setting')
      .toggleClass('fc-ap-feature-setting--changed', this.staged.has(view.id));
    const title = $('<div>').addClass('fc-ap-feature-setting__title')
      .append($('<strong>').text(view.metadata.displayName || view.id))
      .append($('<code>').text(view.id));
    if (view.metadata.rebootRequired) {
      title.append($('<span>').addClass('fc-parameter-badge').text('Reboot required'));
    }
    card
      .append($('<div>').addClass('fc-ap-feature-setting__details')
        .append(title)
        .append($('<p>').text(ardupilotParameterExplanation(definition, 'PID and filter tuning'))))
      .append($('<div>').addClass('fc-ap-feature-setting__editor')
        .append(createPidEditor(definition, {
          value: currentValue(definition, this.staged),
          ariaLabel: view.metadata.displayName || view.id,
        })));
    settings.append(card);
  }
  if (views.length) {
    container.append(settings);
  } else {
    container.append($('<p>').addClass('fc-ap-empty').text(
      this.related.length
        ? 'No related tuning settings match this search and detail level.'
        : 'No additional tuning parameters were reported by this firmware.',
    ));
  }
  $('#apPidRelatedCount').text(`${views.length} settings`);
};

ardupilotPidTuning.stage = function (element) {
  const id = String($(element).data('ardupilot-parameter'));
  const definition = parameterDefinition(id);
  if (!definition) return;
  const validation = validateParameterValue(definition.parameter, $(element).val());
  if (!validation.valid) {
    setArduPilotTabStatus('#apPidStatus', validation.message, true);
    this.render();
    return;
  }
  try {
    stageArduPilotParameter(this.staged, definition, validation.value);
    setArduPilotTabStatus(
      '#apPidStatus',
      this.staged.size
        ? `${this.staged.size} tuning change(s) staged. Make small changes and review every explanation.`
        : 'No tuning changes staged.',
    );
  } catch (error) {
    setArduPilotTabStatus('#apPidStatus', error.message, true);
  }
  this.render();
};

ardupilotPidTuning.save = async function (reboot) {
  if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
  if (!window.confirm(
    `Write ${this.staged.size} ArduPilot tuning change(s)${reboot ? ' and reboot the flight controller' : ''}? Large or mismatched gains can cause immediate oscillation. Remove propellers and retain a parameter backup.`,
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
          '#apPidStatus',
          `Writing ${index + 1} / ${total}: ${id}`,
        ),
      });
      this.rebootPending ||= requiresReboot;
    }
    this.render();
    if (reboot) {
      setArduPilotTabStatus('#apPidStatus', 'Tuning settings confirmed. Sending normal ArduPilot reboot…');
      await rebootArduPilotController();
      this.rebootPending = false;
      setArduPilotTabStatus('#apPidStatus', 'Reboot command sent. Reconnect, verify sensor health, and perform a cautious test flight.');
    } else {
      setArduPilotTabStatus(
        '#apPidStatus',
        `${count} tuning setting(s) confirmed.`
          + `${this.rebootPending ? ' Save & reboot is available for settings that require restart.' : ''}`,
      );
    }
  } catch (error) {
    setArduPilotTabStatus(
      '#apPidStatus',
      `${error.message} Unwritten changes remain staged and the controller was not rebooted.`,
      true,
    );
  } finally {
    this.writing = false;
    this.render();
  }
};

ardupilotPidTuning.updateControls = function () {
  const busy = this.loading || this.writing;
  $('#apPidRefresh, #apPidSearch, [data-ap-pid-section]').prop('disabled', busy);
  $('#apPidSave').prop('disabled', busy || !this.staged.size);
  $('#apPidSaveReboot').prop(
    'disabled',
    busy || (!this.staged.size && !this.rebootPending),
  );
  setArduPilotEditorsBusy(
    '.tab-ardupilot-pid-tuning [data-ardupilot-parameter]',
    busy,
  );
};

ardupilotPidTuning.cleanup = function (callback) {
  if (callback) callback();
};

export default ardupilotPidTuning;
