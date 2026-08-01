'use strict';

import GUI from './../js/gui';
import {
  ARDUPILOT_FEATURE_DEFINITIONS,
  discoverArduPilotFeatureParameters,
} from './../js/ardupilot/featureDefinitions';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import {
  matchesSearch,
  parameterView,
  validateParameterValue,
} from './../js/parameters/ardupilotParameterModel';
import {
  arduPilotDisplayMetadata,
  formatArduPilotDisplayNumber,
  fromArduPilotDisplayValue,
  toArduPilotDisplayValue,
} from './../js/parameters/ardupilotParameterUnits';
import {
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  GROUND_CONTROL_UNIT_SYSTEMS,
  normalizeGroundControlUnitSystem,
} from './../js/gcs/groundControlUnits';
import store from './../js/store';
import {
  ardupilotParameterExplanation,
  finishArduPilotTab,
  loadArduPilotSetup,
  metadataSourceLabel,
  parameterDefinition,
  rebootArduPilotController,
  renderArduPilotTabIdentity,
  sameParameterValue,
  setArduPilotTabStatus,
  stageArduPilotParameter,
  writeArduPilotSetupChanges,
} from './ardupilot_setup_common';

function createFeatureTab(definition) {
  const tab = {
    definition,
    parameters: [],
    staged: new Map(),
    loading: false,
    writing: false,
    rebootPending: false,
    viewMode: 'standard',
    unitSystem: DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  };

  tab.initialize = function (callback) {
    if (GUI.active_tab !== this) GUI.active_tab = this;
    import('./ardupilot_feature.html?raw').then(({ default: html }) => {
      GUI.load(html, () => {
        this.staged.clear();
        this.unitSystem = normalizeGroundControlUnitSystem(
          store.get(
            'flightCommanderGroundControlUnits',
            DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
          ),
        );
        renderArduPilotTabIdentity('apFeature');
        $('#apFeatureTitle, #apFeaturePanelTitle').text(definition.title);
        $('#apFeatureSummary').text(definition.summary);
        $('#apFeatureGuidance').text(definition.guidance);
        $('#apFeatureCaution').text(definition.caution);
        $('#apFeatureRefresh').on('click', () => this.load(true));
        $('#apFeatureSave').on('click', () => this.save(false));
        $('#apFeatureSaveReboot').on('click', () => this.save(true));
        $('#apFeatureSearch').on('input', () => this.render());
        $('#apFeatureUnits').on('change', (event) => {
          this.unitSystem = $(event.currentTarget).prop('checked')
            ? GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
            : GROUND_CONTROL_UNIT_SYSTEMS.METRIC;
          store.set('flightCommanderGroundControlUnits', this.unitSystem);
          this.render();
        });
        $('[data-ap-feature-view]').on('click', (event) => {
          this.viewMode = String($(event.currentTarget).data('ap-feature-view'));
          this.render();
        });
        $('#apFeatureGroups').on(
          'change',
          '[data-ap-feature-value]',
          (event) => this.stageControl(event.currentTarget),
        );
        $('#apFeatureGroups').on(
          'change',
          'input[data-ap-feature-bit]',
          (event) => this.stageBitmask(event.currentTarget),
        );
        finishArduPilotTab(callback);
        this.load(false);
      });
    });
  };

  tab.load = async function (force) {
    if (this.loading || this.writing) return;
    this.loading = true;
    this.updateControls();
    setArduPilotTabStatus('#apFeatureStatus', `Downloading ${definition.title.toLowerCase()} settings…`);
    try {
      const result = await loadArduPilotSetup({
        force,
        onProgress: ({ received, total }) => {
          $('#apFeatureProgress').text(`${received} / ${total || '?'} parameters`);
        },
      });
      this.staged.clear();
      this.parameters = discoverArduPilotFeatureParameters(
        ardupilotSetupService.parameterManager.values(),
        definition,
      );
      $('#apFeatureMetadata').text(metadataSourceLabel(result.metadataResult));
      this.render();
      setArduPilotTabStatus(
        '#apFeatureStatus',
        result.metadataResult.warning
          ? `${definition.title} loaded. ${result.metadataResult.warning}`
          : `${definition.title} is ready. Explanations and choices match the connected firmware.`,
      );
    } catch (error) {
      setArduPilotTabStatus('#apFeatureStatus', error.message, true);
    } finally {
      this.loading = false;
      this.updateControls();
    }
  };

  tab.views = function () {
    const metadata = ardupilotSetupService.metadata;
    const query = String($('#apFeatureSearch').val() ?? '');
    let views = this.parameters
      .map((parameter) => parameterView(parameter, metadata))
      .filter((view) => (
        matchesSearch(view, query)
        || matchesSearch({
          ...view,
          metadata: arduPilotDisplayMetadata(view.metadata, this.unitSystem),
        }, query)
      ));
    if (this.viewMode === 'standard' && metadata.size) {
      const standard = views.filter((view) => view.metadata.user === 'standard');
      if (standard.length) views = standard;
    }
    return views;
  };

  tab.render = function () {
    const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
    $('#apFeatureUnits')
      .prop('checked', imperial)
      .attr('aria-checked', String(imperial));
    $('[data-ap-feature-view]').each((_index, element) => {
      $(element).toggleClass(
        'active',
        $(element).data('ap-feature-view') === this.viewMode,
      );
    });

    const views = this.views();
    const groups = new Map();
    for (const view of views) {
      if (!groups.has(view.group.id)) {
        groups.set(view.group.id, { ...view.group, parameters: [] });
      }
      groups.get(view.group.id).parameters.push(view);
    }
    const container = $('#apFeatureGroups').empty();
    for (const group of [...groups.values()].sort(
      (left, right) => left.label.localeCompare(right.label),
    )) {
      const card = $('<section>').addClass('fc-ap-feature-group');
      card.append(
        $('<header>')
          .append($('<h3>').text(group.label))
          .append($('<span>').text(`${group.parameters.length} settings`)),
      );
      const settings = $('<div>').addClass('fc-ap-feature-settings');
      for (const view of group.parameters.sort(
        (left, right) => left.id.localeCompare(right.id),
      )) {
        settings.append(this.renderSetting(view));
      }
      card.append(settings);
      container.append(card);
    }
    if (!container.children().length) {
      container.append(
        $('<p>').addClass('fc-ap-empty').text(
          this.parameters.length
            ? 'No settings match this search and detail level.'
            : `The connected firmware does not expose parameters for ${definition.title}.`,
        ),
      );
    }
    $('#apFeatureProgress').text(
      `${views.length} shown · ${this.parameters.length} available · ${this.staged.size} changed`,
    );
    this.updateControls();
  };

  tab.renderSetting = function (view) {
    const displayMetadata = arduPilotDisplayMetadata(view.metadata, this.unitSystem);
    const changed = this.staged.has(view.id);
    const setting = $('<article>')
      .addClass('fc-ap-feature-setting')
      .toggleClass('fc-ap-feature-setting--changed', changed)
      .attr('data-ap-feature-setting', view.id);
    const details = $('<div>').addClass('fc-ap-feature-setting__details');
    const title = $('<div>').addClass('fc-ap-feature-setting__title')
      .append($('<strong>').text(view.metadata.displayName || view.id))
      .append($('<code>').text(view.id));
    if (view.metadata.rebootRequired) {
      title.append($('<span>').addClass('fc-parameter-badge').text('Reboot required'));
    }
    if (view.metadata.readOnly) {
      title.append($('<span>').addClass('fc-parameter-badge fc-parameter-badge--muted').text('Read only'));
    }
    details
      .append(title)
      .append($('<p>').text(ardupilotParameterExplanation(
        { id: view.id, metadata: view.metadata },
        definition.context,
      )));
    const constraints = [];
    if (displayMetadata.min != null || displayMetadata.max != null) {
      constraints.push(`${displayMetadata.min ?? '−∞'} to ${displayMetadata.max ?? '∞'}`);
    }
    if (displayMetadata.increment != null) constraints.push(`step ${displayMetadata.increment}`);
    if (displayMetadata.units) constraints.push(displayMetadata.units);
    if (constraints.length) details.append($('<small>').text(constraints.join(' · ')));
    setting.append(
      details,
      $('<div>')
        .addClass('fc-ap-feature-setting__editor')
        .append(this.renderControl(view)),
    );
    return setting;
  };

  tab.currentValue = function (view) {
    return this.staged.get(view.id) ?? view.value;
  };

  tab.renderControl = function (view) {
    const value = this.currentValue(view);
    const disabled = view.metadata.readOnly || this.loading || this.writing;
    if (view.controlKind === 'bitmask') {
      const fieldset = $('<fieldset>')
        .addClass('fc-ap-feature-bitmask')
        .attr('data-ap-feature-bitmask', view.id)
        .prop('disabled', disabled);
      for (const choice of view.metadata.bitmask) {
        const mask = 2 ** Number(choice.value);
        fieldset.append(
          $('<label>')
            .append($('<input>').attr({
              type: 'checkbox',
              'data-ap-feature-bit': choice.value,
              'data-ap-feature-id': view.id,
              'data-ardupilot-read-only': view.metadata.readOnly ? 'true' : 'false',
            }).prop('checked', Math.floor(Number(value) / mask) % 2 === 1))
            .append($('<span>').text(choice.label)),
        );
      }
      return fieldset;
    }
    if (view.controlKind === 'boolean') {
      return $('<label>')
        .addClass('fc-ap-feature-toggle')
        .append($('<input>').attr({
          type: 'checkbox',
          'data-ap-feature-value': view.id,
          'data-ardupilot-read-only': view.metadata.readOnly ? 'true' : 'false',
        }).prop({ checked: Number(value) === 1, disabled }))
        .append($('<span>').text(Number(value) === 1 ? 'Enabled' : 'Disabled'));
    }
    if (view.controlKind === 'enum') {
      const select = $('<select>')
        .attr({
          'data-ap-feature-value': view.id,
          'data-ardupilot-read-only': view.metadata.readOnly ? 'true' : 'false',
        })
        .prop('disabled', disabled);
      let matched = false;
      for (const choice of view.metadata.values) {
        const selected = sameParameterValue(choice.value, value);
        matched ||= selected;
        select.append($('<option>')
          .val(choice.value)
          .prop('selected', selected)
          .text(`${choice.value}: ${choice.label}`));
      }
      if (!matched) {
        select.prepend($('<option>')
          .val(value)
          .prop('selected', true)
          .text(`${value}: controller value`));
      }
      return select;
    }
    const displayMetadata = arduPilotDisplayMetadata(view.metadata, this.unitSystem);
    const displayValue = toArduPilotDisplayValue(
      value,
      view.metadata.units,
      this.unitSystem,
    );
    const input = $('<input>').attr({
      type: 'number',
      step: displayMetadata.increment ?? 'any',
      'data-ap-feature-value': view.id,
      'data-ardupilot-read-only': view.metadata.readOnly ? 'true' : 'false',
    }).prop('disabled', disabled).val(formatArduPilotDisplayNumber(displayValue));
    if (displayMetadata.min != null) input.attr('min', displayMetadata.min);
    if (displayMetadata.max != null) input.attr('max', displayMetadata.max);
    return $('<label>').addClass('fc-ap-feature-number')
      .append(input)
      .append(displayMetadata.units ? $('<span>').text(displayMetadata.units) : null);
  };

  tab.stageControl = function (element) {
    const input = $(element);
    const id = String(input.data('ap-feature-value'));
    const definitionForParameter = parameterDefinition(id);
    if (!definitionForParameter) return;
    let value;
    if (input.attr('type') === 'checkbox') {
      value = input.prop('checked') ? 1 : 0;
    } else if (definitionForParameter.parameter.controlKind === 'number') {
      value = fromArduPilotDisplayValue(
        input.val(),
        definitionForParameter.metadata.units,
        this.unitSystem,
      );
    } else {
      value = Number(input.val());
    }
    this.stageValue(definitionForParameter, value);
  };

  tab.stageBitmask = function (element) {
    const id = String($(element).data('ap-feature-id'));
    const definitionForParameter = parameterDefinition(id);
    if (!definitionForParameter) return;
    let value = 0;
    $(`[data-ap-feature-bitmask="${id}"] input[data-ap-feature-bit]:checked`)
      .each((_index, input) => {
        value += 2 ** Number($(input).data('ap-feature-bit'));
      });
    this.stageValue(definitionForParameter, value);
  };

  tab.stageValue = function (definitionForParameter, value) {
    const validation = validateParameterValue(
      definitionForParameter.parameter,
      value,
    );
    if (!validation.valid) {
      setArduPilotTabStatus('#apFeatureStatus', validation.message, true);
      this.render();
      return;
    }
    try {
      stageArduPilotParameter(
        this.staged,
        definitionForParameter,
        validation.value,
      );
      setArduPilotTabStatus(
        '#apFeatureStatus',
        this.staged.size
          ? `${this.staged.size} ${definition.title.toLowerCase()} change(s) staged. Read each explanation before saving.`
          : 'No changes staged.',
      );
    } catch (error) {
      setArduPilotTabStatus('#apFeatureStatus', error.message, true);
    }
    this.render();
  };

  tab.save = async function (reboot) {
    if ((!this.staged.size && !this.rebootPending) || this.loading || this.writing) return;
    if (!window.confirm(
      `Write ${this.staged.size} ${definition.title.toLowerCase()} change(s)${reboot ? ' and reboot the flight controller' : ''}? ${definition.caution}`,
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
            '#apFeatureStatus',
            `Writing ${index + 1} / ${total}: ${id}`,
          ),
        });
        this.rebootPending ||= requiresReboot;
      }
      this.render();
      if (reboot) {
        setArduPilotTabStatus('#apFeatureStatus', 'Settings confirmed. Sending normal ArduPilot reboot…');
        await rebootArduPilotController();
        this.rebootPending = false;
        setArduPilotTabStatus('#apFeatureStatus', `Reboot command sent. Reconnect and verify ${definition.context}.`);
      } else {
        setArduPilotTabStatus(
          '#apFeatureStatus',
          `${count} setting(s) confirmed by the controller.`
            + `${this.rebootPending ? ' Save & reboot is available for settings that require restart.' : ''}`,
        );
      }
    } catch (error) {
      setArduPilotTabStatus(
        '#apFeatureStatus',
        `${error.message} Unwritten changes remain staged and the controller was not rebooted.`,
        true,
      );
    } finally {
      this.writing = false;
      this.render();
    }
  };

  tab.updateControls = function () {
    const busy = this.loading || this.writing;
    $('#apFeatureRefresh, #apFeatureSearch, #apFeatureUnits, [data-ap-feature-view]')
      .prop('disabled', busy);
    $('#apFeatureSave').prop('disabled', busy || !this.staged.size);
    $('#apFeatureSaveReboot').prop(
      'disabled',
      busy || (!this.staged.size && !this.rebootPending),
    );
    $('#apFeatureGroups :input').each((_index, element) => {
      $(element).prop(
        'disabled',
        busy || $(element).attr('data-ardupilot-read-only') === 'true',
      );
    });
  };

  tab.cleanup = function (callback) {
    if (callback) callback();
  };

  return tab;
}

const featureTabs = Object.fromEntries(
  ARDUPILOT_FEATURE_DEFINITIONS.map((definition) => [
    definition.id,
    createFeatureTab(definition),
  ]),
);

export const ardupilotConfigurationTab = featureTabs.configuration;
export const ardupilotOutputsTab = featureTabs.outputs;
export const ardupilotFailsafeTab = featureTabs.failsafe;
export const ardupilotSensorsTab = featureTabs.sensors;
export const ardupilotGpsNavigationTab = featureTabs.gps_navigation;
export const ardupilotPowerTab = featureTabs.power;
export const ardupilotOsdTab = featureTabs.osd;
export const ardupilotLoggingTab = featureTabs.logging;
