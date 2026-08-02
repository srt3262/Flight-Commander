'use strict';

// Keep the OpenLayers class distinct from JavaScript's native Map. This module
// uses native Map instances for staged parameters, lookup tables, and sensor
// history; shadowing Map here makes every mirrored tab fail during initialize.
import OpenLayersMap from 'ol/Map.js';
import View from 'ol/View.js';
import { fromLonLat } from 'ol/proj.js';

import GUI from './../js/gui';
import dialog from './../js/dialog';
import i18n from './../js/localization';
import { mavlinkFtpClient } from './../js/mavlink/ftpClient';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import { mavlinkLogManager } from './../js/mavlink/logManager';
import { ardupilotSetupService } from './../js/ardupilot/setupService';
import {
  ARDUPILOT_INAV_PAGE_SCHEMAS,
  fromInavUiValue,
  resolveInavUiBinding,
  toInavUiValue,
} from './../js/ardupilot/inavUiParity';
import {
  ARDUPILOT_FLIGHT_COMMANDER_PARITY,
  groupsForVehicle,
  resolveParityControl,
} from './../js/ardupilot/flightCommanderParity';
import { ARDUPILOT_QUAD_MOTOR_RULES } from './../js/ardupilot/motorLayout';
import {
  discoverArduPilotAuxiliaryChannels,
  discoverArduPilotModeConfiguration,
  discoverArduPilotPidGroups,
  discoverArduPilotReceiverChannels,
  discoverArduPilotSerialPorts,
} from './../js/ardupilot/setupModel';
import { createBaseMapLayers, MAP_STYLES } from './../js/maps/baseMapLayers';
import { selectMavlinkMapPosition } from './../js/maps/mapPosition';
import { renderMotorNumberLabels } from './../js/motorPreview';
import { validateParameterValue } from './../js/parameters/ardupilotParameterModel';
import {
  finishArduPilotTab,
  loadArduPilotSetup,
  parameterDefinition,
  rebootArduPilotController,
  sameParameterValue,
  stageArduPilotParameter,
  writeArduPilotSetupChanges,
} from './ardupilot_setup_common';

import advancedTuningHtml from './advanced_tuning.html?raw';
import adjustmentsHtml from './adjustments.html?raw';
import auxiliaryHtml from './auxiliary.html?raw';
import calibrationHtml from './calibration.html?raw';
import cliHtml from './cli.html?raw';
import configurationHtml from './configuration.html?raw';
import failsafeHtml from './failsafe.html?raw';
import gpsHtml from './gps.html?raw';
import ledStripHtml from './led_strip.html?raw';
import javascriptProgrammingHtml from './javascript_programming.html?raw';
import loggingHtml from './logging.html?raw';
import magnetometerHtml from './magnetometer.html?raw';
import mixerHtml from './mixer.html?raw';
import onboardLoggingHtml from './onboard_logging.html?raw';
import osdHtml from './osd.html?raw';
import outputsHtml from './outputs.html?raw';
import pidTuningHtml from './pid_tuning.html?raw';
import portsHtml from './ports.html?raw';
import programmingHtml from './programming.html?raw';
import receiverHtml from './receiver.html?raw';
import searchHtml from './search.html?raw';
import sensorsHtml from './sensors.html?raw';
import setupHtml from './setup.html?raw';

const TEMPLATES = Object.freeze({
  advanced_tuning: advancedTuningHtml,
  adjustments: adjustmentsHtml,
  auxiliary: auxiliaryHtml,
  calibration: calibrationHtml,
  cli: cliHtml,
  configuration: configurationHtml,
  failsafe: failsafeHtml,
  gps: gpsHtml,
  led_strip: ledStripHtml,
  javascript_programming: javascriptProgrammingHtml,
  logging: loggingHtml,
  magnetometer: magnetometerHtml,
  mixer: mixerHtml,
  onboard_logging: onboardLoggingHtml,
  osd: osdHtml,
  outputs: outputsHtml,
  pid_tuning: pidTuningHtml,
  ports: portsHtml,
  programming: programmingHtml,
  receiver: receiverHtml,
  search: searchHtml,
  sensors: sensorsHtml,
  setup: setupHtml,
});

const SAVE_LINK_SELECTOR = [
  '.content_toolbar a.save',
  '.content_toolbar a.update',
  '.content_toolbar a.save-settings',
].join(', ');

const FAILSAFE_ACTION_IDS = Object.freeze({
  nothing: [/disabled|disable|none|continue/i, 0],
  rth: [/rtl|return/i, 1],
  land: [/land/i, 3],
  drop: [/terminate|disarm/i, null],
});

const MAV_CMD_PREFLIGHT_CALIBRATION = 241;
const MAV_CMD_DO_START_MAG_CAL = 42424;
const MAV_CMD_DO_MOTOR_TEST = 209;
const MAV_CMD_DO_SET_SERVO = 183;
const ARDUPILOT_SCRIPT_PATH = '/APM/scripts/flight_commander.lua';

const LUA_EXAMPLES = Object.freeze({
  heartbeat: Object.freeze({
    label: 'Status heartbeat',
    source: `-- Send a status message once per second.\nlocal count = 0\n\nfunction update()\n  count = count + 1\n  gcs:send_text(6, string.format("Flight Commander Lua %d", count))\n  return update, 1000\nend\n\nreturn update()\n`,
  }),
  user_parameter: Object.freeze({
    label: 'Script user parameter',
    source: `-- Read SCR_USER1 as a persistent Flight Commander variable.\nlocal user_value = Parameter()\nassert(user_value:init('SCR_USER1'), 'SCR_USER1 is unavailable')\n\nfunction update()\n  gcs:send_named_float('FC_USER1', user_value:get())\n  return update, 500\nend\n\nreturn update()\n`,
  }),
  rc_switch: Object.freeze({
    label: 'RC switch notification',
    source: `-- Announce RC channel 7 switch changes.\nlocal previous_high = false\n\nfunction update()\n  local pwm = rc:get_pwm(7)\n  local high = pwm and pwm > 1700\n  if high ~= previous_high then\n    gcs:send_text(6, high and 'RC7 high' or 'RC7 low')\n    previous_high = high\n  end\n  return update, 100\nend\n\nreturn update()\n`,
  }),
});

function commandAction(tab, selector, options) {
  const action = tab.root.find(selector);
  if (!action.length) return;
  action
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('disabled')
    .off('.fcArduPilotCommand')
    .on('click.fcArduPilotCommand', async (event) => {
      event.preventDefault();
      if (tab.loading || tab.writing) return;
      const state = mavlinkSession.snapshot();
      if (state.armed) {
        tab.setStatus(`${options.label} requires a disarmed vehicle.`, true);
        return;
      }
      if (options.confirm && !window.confirm(options.confirm)) return;
      action.addClass('disabled');
      tab.setStatus(`${options.label} command sent; follow the controller prompts…`);
      try {
        await mavlinkSession.sendCommandLong(options.command, options.parameters ?? {}, {
          timeoutMs: options.timeoutMs ?? 120000,
        });
        tab.setStatus(`${options.label} accepted by the controller. Follow any remaining status-message prompts.`);
      } catch (error) {
        tab.setStatus(`${options.label} failed: ${error.message}`, true);
      } finally {
        action.removeClass('disabled');
      }
    });
}

function canonicalRoot() {
  return $('#content > div').filter((_index, element) => (
    [...element.classList].some((className) => className.startsWith('tab-'))
  )).first();
}

function closestSetting(element) {
  return $(element).closest([
    '.number',
    '.select',
    '.checkbox',
    '.radioarea',
    '.line',
    'td',
    'label',
  ].join(', '));
}

function displayPrecision(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return Number(numeric.toFixed(7));
}

function definitionValue(tab, definition) {
  return tab.staged.has(definition.id)
    ? tab.staged.get(definition.id)
    : definition.parameter.value;
}

function choiceForValue(metadata, value) {
  return (metadata?.values ?? []).find((choice) => (
    sameParameterValue(choice.value, value)
  ));
}

function failsafeActionValue(definition, inputId) {
  const [labelPattern, fallback] = FAILSAFE_ACTION_IDS[inputId] ?? [];
  const choice = (definition.metadata.values ?? []).find((item) => (
    labelPattern?.test(String(item.label ?? ''))
  ));
  return choice?.value ?? fallback;
}

function parameterTooltip(definition) {
  const description = String(definition.metadata.description ?? '').trim();
  return `${definition.id}${description ? ` — ${description}` : ''}`;
}

function rootInputs(root) {
  return root.find('input, select, textarea');
}

function parameterSaveLinks(tab) {
  if (!tab.root) return $();
  if (tab.pageKey === 'cli') return tab.root.find('.content_toolbar a.savecmd');
  if (tab.pageKey === 'search') return tab.root.find('.fc-ap-search-save');
  if (tab.pageKey === 'javascript_programming') return $();
  return tab.root.find(SAVE_LINK_SELECTOR);
}

function setMappedState(elements, mapped, title = '') {
  elements.each((_index, element) => {
    const setting = closestSetting(element);
    $(element)
      .toggleClass('fc-ap-inav-control--mapped', mapped)
      .toggleClass('fc-ap-inav-original-pending', !mapped);
    setting
      .toggleClass('fc-ap-inav-setting--mapped', mapped);
    if (title) $(element).attr('title', title);
  });
}

function transformedBounds(binding, metadata) {
  const values = [metadata.min, metadata.max]
    .filter((value) => value != null)
    .map((value) => Number(toInavUiValue(binding, value)))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    min: values.length ? values[0] : null,
    max: values.length > 1 ? values[values.length - 1] : values[0] ?? null,
  };
}

function initializeSelect(element, definition, binding, nativeValue) {
  const select = $(element).empty();
  const choices = definition.metadata.values ?? [];
  for (const choice of choices) {
    select.append(
      $('<option>')
        .val(displayPrecision(toInavUiValue(binding, choice.value)))
        .text(choice.label),
    );
  }
  const displayValue = displayPrecision(toInavUiValue(binding, nativeValue));
  if (!choices.length || !choiceForValue(definition.metadata, nativeValue)) {
    select.prepend(
      $('<option>').val(displayValue).text(
        choices.length ? `${displayValue}: controller value` : String(displayValue),
      ),
    );
  }
  select.val(String(displayValue));
}

function initializeStandardElement(element, definition, binding, nativeValue) {
  const input = $(element);
  const displayValue = displayPrecision(toInavUiValue(binding, nativeValue));
  if (input.is('select')) {
    initializeSelect(input, definition, binding, nativeValue);
  } else if (input.is(':checkbox')) {
    input.prop('checked', Boolean(Number(nativeValue)));
  } else {
    input.val(displayValue);
    const bounds = transformedBounds(binding, definition.metadata);
    if (bounds.min != null) input.attr('min', bounds.min);
    if (bounds.max != null) input.attr('max', bounds.max);
    if (definition.metadata.increment != null && !binding.presentation) {
      input.attr('step', definition.metadata.increment);
    } else if (binding.presentation) {
      input.attr('step', 'any');
    }
  }
}

function syncParameterElements(tab, id) {
  const definition = parameterDefinition(id);
  if (!definition) return;
  const nativeValue = definitionValue(tab, definition);
  tab.root.find(`[data-ardupilot-parameter="${id}"]`).each((_index, element) => {
    const binding = $(element).data('fcArduPilotBinding') ?? {};
    initializeStandardElement(element, definition, binding, nativeValue);
  });
}

function stageStandardElement(tab, element, definition, binding) {
  const input = $(element);
  const displayValue = input.is(':checkbox') ? (input.prop('checked') ? 1 : 0) : input.val();
  const nativeValue = fromInavUiValue(binding, displayValue);
  const validation = validateParameterValue(definition.parameter, nativeValue);
  if (!validation.valid) throw new Error(validation.message);
  stageArduPilotParameter(tab.staged, definition, validation.value);
  syncParameterElements(tab, definition.id);
}

function mountStandardBinding(tab, element, definition, binding) {
  const input = $(element);
  input
    .attr({
      'data-ardupilot-parameter': definition.id,
      'data-ardupilot-read-only': definition.metadata.readOnly ? 'true' : 'false',
    })
    .data('fcArduPilotBinding', binding)
    .off('.fcArduPilotParity')
    .on('change.fcArduPilotParity input.fcArduPilotParity', () => {
      try {
        stageStandardElement(tab, input, definition, binding);
        tab.setStatus(
          tab.staged.size
            ? `${tab.staged.size} setting(s) changed. Select Save to write and verify them.`
            : 'No unsaved changes.',
        );
      } catch (error) {
        tab.setStatus(error.message, true);
      }
      tab.updateControls();
    });
  initializeStandardElement(input, definition, binding, definitionValue(tab, definition));
  input.prop('disabled', Boolean(definition.metadata.readOnly));
  setMappedState(input, true, parameterTooltip(definition));
}

function mountFailsafeAction(tab, elements, definition, binding) {
  elements.each((_index, element) => {
    const input = $(element);
    const actionValue = failsafeActionValue(definition, String(input.attr('id')));
    input
      .attr({
        'data-ardupilot-parameter': definition.id,
        'data-ardupilot-read-only': definition.metadata.readOnly ? 'true' : 'false',
      })
      .data('fcArduPilotBinding', binding)
      .data('fcArduPilotActionValue', actionValue)
      .off('.fcArduPilotParity');
    if (actionValue == null) {
      closestSetting(input)
        .attr('data-fc-parity-replaced-by', 'receiver-failsafe-action')
        .hide();
      return;
    }
    input
      .prop('checked', sameParameterValue(definitionValue(tab, definition), actionValue))
      .prop('disabled', Boolean(definition.metadata.readOnly))
      .on('change.fcArduPilotParity', () => {
        if (!input.prop('checked')) return;
        try {
          stageArduPilotParameter(tab.staged, definition, actionValue);
          tab.setStatus(`${tab.staged.size} setting(s) changed. Select Save to write and verify them.`);
        } catch (error) {
          tab.setStatus(error.message, true);
        }
        tab.updateControls();
      });
    setMappedState(input, true, parameterTooltip(definition));
  });
}

function bindSubtabs(root) {
  root.find('.subtab__header_label').off('.fcArduPilotParity').on(
    'click.fcArduPilotParity',
    (event) => {
      const target = String($(event.currentTarget).attr('for') ?? '');
      if (!target) return;
      root.find('.subtab__header_label').removeClass('subtab__header_label--current');
      $(event.currentTarget).addClass('subtab__header_label--current');
      root.find('.subtab__content').removeClass('subtab__content--current');
      root.find(`#${target}`).addClass('subtab__content--current');
    },
  );
}

function prepareCanonicalTemplate(tab) {
  tab.root = canonicalRoot();
  tab.root
    .addClass('fc-ap-editor-page fc-ardupilot-inav-parity')
    .attr('data-ardupilot-inav-template', tab.schema.template);
  tab.root.find('> .content_toolbar')
    .addClass('fc-ap-toolbar fc-ardupilot-inav-toolbar')
    .removeClass('hide')
    .show();
  tab.root.find('.supported').removeClass('hide').show();
  tab.root.find('.unsupported, .require-upgrade').hide();
  tab.status = $('<div>')
    .addClass('fc-action-status fc-ap-inav-status')
    .attr({ role: 'status', 'aria-live': 'polite' })
    .appendTo(tab.root);
  rootInputs(tab.root)
    .addClass('fc-ap-inav-original-pending')
    .prop('disabled', true);
  parameterSaveLinks(tab)
    .attr('aria-disabled', 'true')
    .addClass('disabled')
    .off('.fcArduPilotParity')
    .on('click.fcArduPilotParity', (event) => {
      event.preventDefault();
      void tab.save();
    });
  tab.root.find('.content_toolbar a.refresh')
    .off('.fcArduPilotParity')
    .on('click.fcArduPilotParity', (event) => {
      event.preventDefault();
      void tab.load(true);
    });
  bindSubtabs(tab.root);
  i18n.localize();
}

function attachNativeElement(tab, element, id, options = {}) {
  const definition = parameterDefinition(id);
  if (!definition || !$(element).length) return false;
  const binding = Object.freeze({
    key: options.key ?? id.toLowerCase(),
    selector: '',
    candidates: Object.freeze([id]),
    presentation: options.presentation,
  });
  mountStandardBinding(tab, element, definition, binding);
  return true;
}

function generatedEditorFor(definition, compatibility) {
  const metadata = definition.metadata ?? {};
  if ((metadata.values ?? []).length) return $('<select>');
  const binary = Number(metadata.min) === 0
    && Number(metadata.max) === 1
    && Number(metadata.increment ?? 1) === 1;
  return binary || compatibility.input === 'checkbox'
    ? $('<input type="checkbox">')
    : $('<input type="number">');
}

function humanizeParityIntent(intent) {
  return String(intent ?? '')
    .replace(/^feature-/, 'feature ')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function elementIntentKeys(element) {
  const input = $(element);
  return [...new Set([
    input.attr('data-setting'),
    input.attr('data-setting-placeholder'),
    input.attr('name'),
    input.attr('id'),
  ].filter(Boolean).map(String))];
}

function sourceElementForIntent(tab, intent) {
  return rootInputs(tab.root).filter((_index, element) => (
    elementIntentKeys(element).includes(intent)
  )).first();
}

function sourceLabelForIntent(tab, intent) {
  const input = sourceElementForIntent(tab, intent);
  if (!input.length) return humanizeParityIntent(intent);
  const setting = closestSetting(input);
  const label = setting.find('label').first().text().replace(/\s+/g, ' ').trim();
  return label || input.attr('aria-label') || input.attr('title') || humanizeParityIntent(intent);
}

function appendIntentCoverage(tab, host, intentsToCover, translation, title) {
  if (!intentsToCover.length) return;
  const detail = $('<details>')
    .addClass('fc-ap-parity-coverage')
    .attr('data-fc-parity-covered-count', intentsToCover.length)
    .appendTo(host);
  $('<summary>')
    .text(`Flight Commander functions translated here (${intentsToCover.length})`)
    .appendTo(detail);
  const list = $('<ul>').appendTo(detail);
  const outcome = translation === 'direct'
    ? `writes the direct ArduPilot setting in ${title}`
    : translation === 'composite'
      ? `is combined into the ArduPilot controls in ${title}`
      : translation === 'workflow'
        ? `is performed by the Flight Commander ArduPilot workflow in ${title}`
        : `uses the ArduPilot-equivalent behavior explained in ${title}`;
  for (const intent of intentsToCover) {
    $('<li>')
      .attr('data-fc-parity-intent', intent)
      .append($('<strong>').text(sourceLabelForIntent(tab, intent)))
      .append(document.createTextNode(` — ${outcome}.`))
      .appendTo(list);
  }
}

function contractSourceBox(tab, contract) {
  for (const intent of contract.covers) {
    const box = sourceElementForIntent(tab, intent).closest('.gui_box');
    if (!box.length) continue;
    const hiddenByLayout = box.parents().addBack().filter((_index, element) => (
      $(element).css('display') === 'none'
    )).length > 0;
    if (!hiddenByLayout) return box.first();
  }
  return $();
}

function renderParityContractGroups(tab) {
  tab.root.find('.fc-ap-parity-contracts').remove();
  const state = mavlinkSession.snapshot();
  const groups = groupsForVehicle(tab.pageKey, state.vehicleType);
  if (!groups.length) return;

  const wrapper = tab.root.find('.content_wrapper').first();
  const host = wrapper.length ? wrapper : tab.root;
  const contracts = $('<div>')
    .addClass('fc-ap-parity-contracts')
    .attr('data-fc-parity-page', tab.pageKey);
  const title = host.children('.tab_title').first();
  if (title.length) contracts.insertAfter(title);
  else host.prepend(contracts);
  const anchorTails = new Map();

  for (const contract of groups) {
    const section = $('<section>')
      .addClass('gui_box grey config-section fc-ap-parity-contract')
      .attr({
        id: `fc-ap-contract-${tab.pageKey}-${contract.key}`,
        'data-fc-parity-contract': contract.key,
        'data-fc-parity-translation': contract.translation,
        'data-fc-parity-intents': contract.covers.join(' '),
      });
    const header = $('<div>').addClass('gui_box_titlebar').appendTo(section);
    $('<div>').addClass('spacer_box_title').text(contract.title).appendTo(header);
    $('<span>')
      .addClass('fc-ap-parity-kind')
      .text(contract.translation === 'direct'
        ? 'Direct translation'
        : contract.translation === 'composite'
          ? 'Combined translation'
          : contract.translation === 'workflow'
            ? 'Flight Commander workflow'
            : 'ArduPilot equivalent')
      .appendTo(header);
    const body = $('<div>').addClass('spacer_box settings fc-ap-parity-contract__body')
      .appendTo(section);
    $('<p>').addClass('fc-ap-parity-description').text(contract.description).appendTo(body);
    const controls = $('<div>').addClass('fc-ap-parity-controls').appendTo(body);

    for (const compatibility of contract.controls) {
      const parameter = resolveParityControl(
        ardupilotSetupService.parameterManager.parameters,
        compatibility,
      );
      const definition = parameter ? parameterDefinition(parameter.id) : null;
      if (!definition) {
        const row = $('<div>')
          .addClass('fc-ap-parity-control fc-ap-parity-control--equivalent')
          .attr('data-fc-parity-control', compatibility.key)
          .appendTo(controls);
        $('<label>')
          .append($('<strong>').text(compatibility.label))
          .append($('<small>').text(compatibility.description))
          .appendTo(row);
        $('<span>')
          .addClass('fc-ap-parity-equivalent-state')
          .text('Equivalent behavior — this firmware exposes no separate setting')
          .appendTo(row);
        $('<code>').text(compatibility.candidates.join(' / ')).appendTo(row);
        continue;
      }
      const row = $('<div>')
        .addClass('fc-ap-parity-control')
        .attr('data-fc-parity-control', compatibility.key)
        .appendTo(controls);
      const editor = generatedEditorFor(definition, compatibility);
      $('<label>')
        .attr('for', `fc-ap-${tab.pageKey}-${contract.key}-${compatibility.key}`)
        .append($('<strong>').text(compatibility.label))
        .append($('<small>').text(compatibility.description))
        .appendTo(row);
      editor
        .attr('id', `fc-ap-${tab.pageKey}-${contract.key}-${compatibility.key}`)
        .appendTo(row);
      $('<code>').text(definition.id).appendTo(row);
      attachNativeElement(tab, editor, definition.id, {
        key: compatibility.key,
        presentation: compatibility.presentation,
      });
    }

    if (!contract.controls.length) {
      $('<div>')
        .addClass('fc-ap-parity-managed')
        .text('This familiar Flight Commander function is performed by the translated workflow described above; it does not require a separate controller parameter.')
        .appendTo(controls);
    }
    appendIntentCoverage(tab, body, contract.covers, contract.translation, contract.title);
    const sourceBox = contractSourceBox(tab, contract);
    if (sourceBox.length) {
      section.addClass('fc-ap-parity-contract--anchored');
      const anchor = anchorTails.get(sourceBox[0]) ?? sourceBox;
      section.insertAfter(anchor);
      anchorTails.set(sourceBox[0], section);
    } else {
      contracts.append(section);
    }
  }

  appendIntentCoverage(
    tab,
    contracts,
    tab.schema.workflowCovers ?? [],
    'workflow',
    `${tab.pageKey.replaceAll('_', ' ')} tab`,
  );
  if (!contracts.children().length) contracts.remove();
}

function parityContractForElement(tab, element) {
  const keys = elementIntentKeys(element);
  return groupsForVehicle(tab.pageKey, mavlinkSession.snapshot().vehicleType).find(
    (contract) => contract.covers.some((intent) => keys.includes(intent)),
  ) ?? null;
}

function describeReplacedInavControls(tab) {
  tab.root.find('.fc-ap-inav-original-pending').each((_index, element) => {
    const input = $(element);
    if (input.attr('data-fc-parity-workflow') === 'true') return;
    const setting = closestSetting(input);
    if (!setting.length || setting.attr('data-fc-parity-explained') === 'true') return;
    const contract = parityContractForElement(tab, input);
    const contractId = contract ? `fc-ap-contract-${tab.pageKey}-${contract.key}` : '';
    setting
      .attr({
        'data-fc-parity-explained': 'true',
        ...(contract ? { 'data-fc-parity-equivalent': contract.key } : {}),
      })
      .addClass('fc-ap-inav-setting--equivalent');
    input.attr({ 'aria-hidden': 'true', tabindex: '-1' }).hide();
    const explanation = $('<div>').addClass('fc-ap-inav-equivalent-note');
    if (contract) {
      $('<a>')
        .attr('href', `#${contractId}`)
        .text(contract.translation === 'direct' ? 'Direct ArduPilot translation' : `${contract.title} equivalent`)
        .appendTo(explanation);
      $('<span>').text(contract.description).appendTo(explanation);
    } else {
      $('<strong>').text('Flight Commander ArduPilot workflow').appendTo(explanation);
      $('<span>').text(
        'This original Flight Commander control remains represented by the active workflow on this tab; ArduPilot does not expose it as an independent parameter.',
      ).appendTo(explanation);
    }
    setting.append(explanation);
  });
}

function renderSchemaBindings(tab) {
  for (const binding of tab.schema.bindings) {
    const elements = tab.root.find(binding.selector);
    if (!elements.length) continue;
    const parameter = resolveInavUiBinding(
      ardupilotSetupService.parameterManager.parameters,
      binding,
    );
    const definition = parameter ? parameterDefinition(parameter.id) : null;
    if (!definition) continue;
    if (binding.kind === 'failsafe-action') {
      mountFailsafeAction(tab, elements, definition, binding);
    } else {
      elements.each((_index, element) => mountStandardBinding(
        tab,
        element,
        definition,
        binding,
      ));
    }
  }
}

function renderPorts(tab) {
  tab.root.find('.require-support').show();
  const body = tab.root.find('table.ports tbody').first().empty();
  const ports = discoverArduPilotSerialPorts(
    ardupilotSetupService.parameterManager.parameters,
    ardupilotSetupService.metadata,
  );
  for (const port of ports) {
    const row = $('<tr>').addClass('portConfiguration');
    $('<td>').addClass('identifierCell').append(
      $('<div>').addClass('identifier').text(port.label),
    ).appendTo(row);
    const protocolCell = $('<td>').addClass('functionsCell-data').appendTo(row);
    const protocolSelect = $('<select>').appendTo(protocolCell);
    attachNativeElement(tab, protocolSelect, port.protocol.id);
    const baudCell = $('<td>').addClass('functionsCell-telemetry').appendTo(row);
    if (port.baud) {
      attachNativeElement(tab, $('<select>').appendTo(baudCell), port.baud.id);
    } else {
      baudCell.text('Firmware managed');
    }
    $('<td>').addClass('functionsCell-rx').text(
      /rcin|receiver/i.test(String(port.protocol.metadata?.description ?? '')) ? 'Receiver' : '—',
    ).appendTo(row);
    $('<td>').addClass('functionsCell-sensors').text('—').appendTo(row);
    const optionsCell = $('<td>').addClass('functionsCell-peripherals').appendTo(row);
    if (port.options) {
      attachNativeElement(tab, $('<input type="number">').appendTo(optionsCell), port.options.id);
    } else {
      optionsCell.text('Firmware managed');
    }
    body.append(row);
  }
  if (!ports.length) {
    body.append($('<tr>').append(
      $('<td>').attr('colspan', 6).text('This controller did not report serial-port parameters.'),
    ));
  }
}

function receiverMapString() {
  const names = [
    ['RCMAP_ROLL', 'A'],
    ['RCMAP_PITCH', 'E'],
    ['RCMAP_THROTTLE', 'T'],
    ['RCMAP_YAW', 'R'],
  ];
  const positions = new Array(4).fill(null);
  for (const [id, letter] of names) {
    const definition = parameterDefinition(id);
    const index = Number(definition?.parameter?.value) - 1;
    if (index >= 0 && index < positions.length) positions[index] = letter;
  }
  return positions.every(Boolean) ? positions.join('') : 'AETR';
}

function renderReceiver(tab) {
  const channels = discoverArduPilotReceiverChannels(
    ardupilotSetupService.parameterManager.parameters,
    ardupilotSetupService.metadata,
  );
  const bars = tab.root.find('.bars');
  bars.find('ul').remove();
  for (const channel of channels) {
    bars.append(
      $('<ul>').attr('data-rc-channel', channel.channel)
        .append($('<li>').addClass('name').text(`CH${channel.channel}`))
        .append(
          $('<li>').addClass('meter').append(
            $('<div>').addClass('meter-bar')
              .append($('<div>').addClass('label'))
              .append($('<div>').addClass('fill').append($('<div>').addClass('label'))),
          ),
        ),
    );
  }
  const map = tab.root.find('input[name="rcmap"]')
    .val(receiverMapString())
    .attr('data-fc-parity-workflow', 'true')
    .prop('disabled', false)
    .off('.fcArduPilotRcMap')
    .on('change.fcArduPilotRcMap', () => {
      const order = String(map.val() ?? '').trim().toUpperCase();
      if (!/^[AETR]{4}$/.test(order) || new Set(order).size !== 4) {
        tab.setStatus('Channel map must contain A, E, T, and R exactly once.', true);
        map.val(receiverMapString());
        return;
      }
      const ids = Object.freeze({
        A: 'RCMAP_ROLL',
        E: 'RCMAP_PITCH',
        T: 'RCMAP_THROTTLE',
        R: 'RCMAP_YAW',
      });
      try {
        [...order].forEach((letter, index) => {
          const definition = parameterDefinition(ids[letter]);
          if (definition) stageArduPilotParameter(tab.staged, definition, index + 1);
        });
        tab.setStatus(`${tab.staged.size} translated setting(s) changed. Select Save to write and verify them.`);
        tab.updateControls();
      } catch (error) {
        tab.setStatus(error.message, true);
      }
    });
  setMappedState(map, true, 'ArduPilot RCMAP_ROLL / PITCH / THROTTLE / YAW');
  tab.root.find('select[name="rcmap_helper"]')
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false)
    .off('.fcArduPilotRcMap')
    .on('change.fcArduPilotRcMap', (event) => {
      map.val($(event.currentTarget).val()).trigger('change');
    });
  attachNativeElement(tab, tab.root.find('select[name="rssi_source"]'), 'RSSI_TYPE');
  attachNativeElement(tab, tab.root.find('.deadband input[name="deadband"]'), 'RC1_DZ');
  attachNativeElement(tab, tab.root.find('.deadband input[name="yaw_deadband"]'), 'RC4_DZ');
  tab.renderReceiverState = (state = mavlinkSession.snapshot()) => {
    tab.root.find('.bars ul[data-rc-channel]').each((_index, element) => {
      const channel = Number($(element).data('rc-channel'));
      const value = Number(state.rcChannels?.[channel - 1]);
      const valid = Number.isFinite(value);
      const percent = valid ? Math.max(0, Math.min(100, ((value - 800) / 1400) * 100)) : 0;
      $(element).find('.meter .fill').css('width', `${percent}%`);
      $(element).find('.meter .label').text(valid ? Math.round(value) : '--');
    });
  };
  tab.renderReceiverState();
  tab.stateUnsubscribe = mavlinkSession.on('state', (state) => tab.renderReceiverState(state));
}

function appendModeRow(tab, body, name, definition, detail) {
  const row = $('<tr>').addClass('mode');
  $('<td>').addClass('info').append($('<p>').addClass('name').text(name)).appendTo(row);
  const ranges = $('<td>').addClass('ranges').appendTo(row);
  const range = $('<div>').addClass('range').appendTo(ranges);
  $('<div>').addClass('channelInfo')
    .append($('<strong>').text(detail))
    .appendTo(range);
  attachNativeElement(tab, $('<select>').appendTo(range), definition.id);
  body.append(row);
}

function renderModes(tab) {
  const parameters = ardupilotSetupService.parameterManager.parameters;
  const metadata = ardupilotSetupService.metadata;
  const configuration = discoverArduPilotModeConfiguration(parameters, metadata);
  const auxiliary = discoverArduPilotAuxiliaryChannels(parameters, metadata);
  const body = tab.root.find('table.modes tbody').first().empty();
  if (configuration) {
    for (const slot of configuration.slots) {
      appendModeRow(
        tab,
        body,
        `Flight mode position ${slot.slot}`,
        slot,
        `${configuration.channel.id} · PWM ${slot.label}`,
      );
    }
  }
  for (const channel of auxiliary) {
    appendModeRow(
      tab,
      body,
      `Channel ${channel.channel} auxiliary function`,
      channel,
      `RC${channel.channel}`,
    );
  }
  tab.root.find('#switch-toggle-unused')
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false)
    .off('.fcArduPilotModes')
    .on('change.fcArduPilotModes', (event) => {
      const hideUnused = $(event.currentTarget).prop('checked');
      body.find('tr').each((_index, row) => {
        $(row).toggle(!hideUnused || Number($(row).find('select').val()) !== 0);
      });
    });
  if (!body.children().length) {
    body.append($('<tr>').append(
      $('<td>').attr('colspan', 2).text('This controller did not report flight-mode assignments.'),
    ));
  }
}

function renderAdjustments(tab) {
  const channels = discoverArduPilotAuxiliaryChannels(
    ardupilotSetupService.parameterManager.parameters,
    ardupilotSetupService.metadata,
  );
  const body = tab.root.find('table.adjustments tbody').first().empty();
  for (const channel of channels) {
    const row = $('<tr>')
      .addClass('adjustment fc-ap-adjustment-row')
      .attr('data-rc-channel', channel.channel);
    const enabled = $('<input type="checkbox">')
      .attr('data-fc-parity-workflow', 'true')
      .prop('checked', Number(channel.parameter.value) !== 0)
      .appendTo($('<td>').addClass('column-enable').appendTo(row));
    $('<td>').text(`RC${channel.channel}`).appendTo(row);
    $('<td>').append(
      $('<div>').addClass('fc-ap-adjustment-position').text('Live PWM: --'),
    ).appendTo(row);
    const functionCell = $('<td>').appendTo(row);
    const functionSelect = $('<select>').appendTo(functionCell);
    attachNativeElement(tab, functionSelect, channel.id);
    $('<td>').text('ArduPilot auxiliary function').appendTo(row);
    $('<td>').text(`RC${channel.channel}_OPTION`).appendTo(row);
    enabled.on('change.fcArduPilotAdjustments', () => {
      if (enabled.prop('checked')) {
        if (Number(functionSelect.val()) === 0) functionSelect.trigger('focus');
      } else {
        functionSelect.val('0').trigger('change');
      }
    });
    body.append(row);
  }
  if (!channels.length) {
    body.append($('<tr>').append(
      $('<td>').attr('colspan', 6).text('ArduPilot did not report any RC auxiliary-function parameters.'),
    ));
  }
  const render = (state = mavlinkSession.snapshot()) => {
    body.find('tr[data-rc-channel]').each((_index, row) => {
      const channel = Number($(row).attr('data-rc-channel'));
      const pwm = Number(state.rcChannels?.[channel - 1]);
      $(row).find('.fc-ap-adjustment-position').text(
        `Live PWM: ${Number.isFinite(pwm) ? Math.round(pwm) : '--'}`,
      );
    });
  };
  render();
  tab.stateUnsubscribe = mavlinkSession.on('state', render);
}

function renderConfiguration(tab) {
  tab.root.find('.content_wrapper > .leftWrapper, .content_wrapper > .rightWrapper')
    .attr('data-fc-parity-canonical-layout', 'configuration')
    .show();
}

function renderAdvancedTuning(tab) {
  const family = String(mavlinkSession.snapshot().vehicleTypeName ?? '').toLowerCase();
  const fixedWing = /plane|vtol/.test(family);
  tab.root.find('.airplaneTuning').toggle(fixedWing);
  tab.root.find('.multirotorTuning').toggle(!fixedWing);
  tab.root.find('.airplaneTuningTitle').toggle(fixedWing);
  tab.root.find('.multirotorTuningTitle').toggle(!fixedWing);
}

function renderFailsafe(tab) {
  tab.root.find('.content_wrapper > .gui_box')
    .attr('data-fc-parity-canonical-layout', 'failsafe')
    .show();
}

function renderLedStrip(tab) {
  tab.root.find([
    '.quick-layouts',
    '.gridColumn',
    '.colorDefineSliders',
    '.colorControls',
    '.mode_colors',
    '.special_colors',
  ].join(', '))
    .attr('data-fc-parity-replaced-by', 'notification-led-contracts')
    .hide();
}

function renderOutputRows(tab) {
  tab.root.find('.content_wrapper > .gui_box.config-section').first()
    .attr('data-fc-parity-canonical-layout', 'outputs')
    .show();
  const parameters = ardupilotSetupService.parameterManager.parameters;
  const byId = parameters instanceof Map ? parameters : new Map(
    Array.from(parameters ?? [], (parameter) => [parameter.id, parameter]),
  );
  const channels = [...byId.keys()]
    .map((id) => /^SERVO(\d+)_FUNCTION$/.exec(id)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((left, right) => left - right);
  const table = tab.root.find('#servo-config-table');
  table.find('tr').not('.main').remove();
  for (const channel of channels) {
    const row = $('<tr>').attr('data-servo-channel', channel);
    $('<td>').text(`Output ${channel}`).appendTo(row);
    for (const suffix of ['TRIM', 'MIN', 'MAX']) {
      const cell = $('<td>').appendTo(row);
      const id = `SERVO${channel}_${suffix}`;
      if (byId.has(id)) attachNativeElement(tab, $('<input type="number">').appendTo(cell), id);
      else cell.text('—');
    }
    $('<td>').text('—').appendTo(row);
    const reversedCell = $('<td>').appendTo(row);
    const reversedId = `SERVO${channel}_REVERSED`;
    if (byId.has(reversedId)) {
      attachNativeElement(tab, $('<input type="checkbox">').appendTo(reversedCell), reversedId);
    } else {
      reversedCell.text('—');
    }
    const functionCell = $('<td>').appendTo(row);
    attachNativeElement(
      tab,
      $('<select>').appendTo(functionCell),
      `SERVO${channel}_FUNCTION`,
    );
    table.append(row);
  }
  const motorFunctions = channels.map((channel) => {
    const definition = parameterDefinition(`SERVO${channel}_FUNCTION`);
    const value = Number(definition ? definitionValue(tab, definition) : NaN);
    const label = choiceForValue(definition?.metadata, value)?.label ?? '';
    const labeled = /motor\s*(\d+)/i.exec(String(label));
    const motor = labeled ? Number(labeled[1]) : (value >= 33 && value <= 64 ? value - 32 : null);
    return motor ? { motor, channel } : null;
  }).filter(Boolean).sort((left, right) => left.motor - right.motor);
  const titles = tab.root.find('.motor-titles').empty();
  const sliders = tab.root.find('.motor-sliders').empty();
  const values = tab.root.find('.motor-values').empty();
  for (const { motor, channel } of motorFunctions) {
    $('<li>').attr('title', `Motor ${motor} · output ${channel}`).text(motor).appendTo(titles);
    $('<input type="range">')
      .attr({ min: 0, max: 100, step: 1, value: 0, 'data-motor': motor })
      .prop('disabled', true)
      .appendTo(sliders);
    $('<li>').attr('data-motor-value', motor).text('0%').appendTo(values);
  }
  const frameType = Number(parameterDefinition('FRAME_TYPE')?.parameter?.value
    ?? parameterDefinition('Q_FRAME_TYPE')?.parameter?.value ?? -1);
  const imageName = frameType === 0 ? 'quad_p' : 'quad_x';
  const image = tab.root.find('#motor-mixer-preview-img')
    .attr('src', `./resources/motor_order/${imageName}.svg`);
  renderMotorNumberLabels(
    image.closest('.mixer-preview-image-numbers'),
    imageName,
    ARDUPILOT_QUAD_MOTOR_RULES[imageName],
  );

  const testToggle = tab.root.find('#motorsEnableTestMode')
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', mavlinkSession.snapshot().armed)
    .off('.fcArduPilotMotorTest')
    .on('change.fcArduPilotMotorTest', () => {
      if (testToggle.prop('checked') && !window.confirm(
        'Enable motor testing? REMOVE ALL PROPELLERS, secure the vehicle, keep it disarmed, and be ready to disconnect power.',
      )) {
        testToggle.prop('checked', false);
      }
      sliders.find('input').prop('disabled', !testToggle.prop('checked'));
    });
  sliders.find('input')
    .on('input.fcArduPilotMotorTest', (event) => {
      const input = $(event.currentTarget);
      tab.root.find(`[data-motor-value="${input.data('motor')}"]`).text(`${input.val()}%`);
    })
    .on('change.fcArduPilotMotorTest', async (event) => {
      const input = $(event.currentTarget);
      if (!testToggle.prop('checked')) return;
      if (mavlinkSession.snapshot().armed) {
        testToggle.prop('checked', false).trigger('change');
        tab.setStatus('Motor testing stopped because the vehicle is armed.', true);
        return;
      }
      try {
        await mavlinkSession.sendCommandLong(MAV_CMD_DO_MOTOR_TEST, {
          param1: Number(input.data('motor')),
          param2: 0,
          param3: Number(input.val()),
          param4: 2,
          param5: 1,
          param6: 0,
        }, { timeoutMs: 5000 });
        tab.setStatus(`Motor ${input.data('motor')} test accepted at ${input.val()}% for two seconds.`);
      } catch (error) {
        input.val(0).trigger('input');
        tab.setStatus(`Motor test failed: ${error.message}`, true);
      }
    });
  tab.root.find('.servos .live input')
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false)
    .attr('title', 'When enabled, changing an output trim sends a short disarmed actuator test as well as staging the value.');
  table.find('[data-ardupilot-parameter$="_TRIM"]')
    .off('.fcArduPilotServoTest')
    .on('change.fcArduPilotServoTest', async (event) => {
      if (!tab.root.find('.servos .live input').prop('checked')) return;
      const input = $(event.currentTarget);
      const channel = Number(/^SERVO(\d+)_TRIM$/.exec(
        String(input.attr('data-ardupilot-parameter')),
      )?.[1]);
      if (!channel || mavlinkSession.snapshot().armed) {
        tab.root.find('.servos .live input').prop('checked', false);
        tab.setStatus('Live servo testing requires a disarmed vehicle.', true);
        return;
      }
      try {
        await mavlinkSession.sendCommandLong(MAV_CMD_DO_SET_SERVO, {
          param1: channel,
          param2: Number(input.val()),
        }, { timeoutMs: 5000 });
        tab.setStatus(`Output ${channel} test command accepted at ${input.val()} µs.`);
      } catch (error) {
        tab.setStatus(`Output test failed: ${error.message}`, true);
      }
    });
}

function renderMixer(tab) {
  tab.root.find('.motor-mixer, #mixer-wizard-gui_box').hide();
  const parameters = ardupilotSetupService.parameterManager.parameters;
  const byId = parameters instanceof Map ? parameters : new Map(
    Array.from(parameters ?? [], (parameter) => [parameter.id, parameter]),
  );
  const outputRow = tab.root.find('#output-row').empty();
  const functionRow = tab.root.find('#function-row').empty();
  [...byId.keys()]
    .map((id) => ({ id, match: /^SERVO(\d+)_FUNCTION$/.exec(id) }))
    .filter(({ match }) => match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
    .forEach(({ id, match }) => {
      $('<th>').text(`S${match[1]}`).appendTo(outputRow);
      const definition = parameterDefinition(id);
      const current = definitionValue(tab, definition);
      const label = choiceForValue(definition.metadata, current)?.label ?? current;
      $('<td>').attr('title', id).text(label).appendTo(functionRow);
    });
  const updatePreview = () => {
    const typeDefinition = parameterDefinition('FRAME_TYPE') ?? parameterDefinition('Q_FRAME_TYPE');
    const frameType = Number(typeDefinition ? definitionValue(tab, typeDefinition) : -1);
    const imageName = frameType === 0 ? 'quad_p' : 'quad_x';
    const image = tab.root.find('#motor-mixer-preview-img')
      .attr('src', `./resources/motor_order/${imageName}.svg`);
    renderMotorNumberLabels(
      image.closest('.mixer-preview-image-numbers'),
      imageName,
      ARDUPILOT_QUAD_MOTOR_RULES[imageName],
    );
  };
  tab.root.find('#platform-type, #mixer-preset').on('change.fcArduPilotPreview', updatePreview);
  updatePreview();
}

function renderPid(tab) {
  tab.root.find('.for-ez-tune').hide();
  tab.root.find('.not-for-ez-tune').show();
  const groups = discoverArduPilotPidGroups(
    ardupilotSetupService.parameterManager.parameters,
    ardupilotSetupService.metadata,
  );
  const byId = new Map(groups.map((group) => [group.id, group]));
  const axes = [
    ['roll', 'ATC_RAT_RLL'],
    ['pitch', 'ATC_RAT_PIT'],
    ['yaw', 'ATC_RAT_YAW'],
  ];
  const gainNames = ['p', 'i', 'd', 'ff'];
  for (const [axis, groupId] of axes) {
    const group = byId.get(groupId);
    const rows = tab.root.find(`#pid-sliders .pid-sliders-axis[data-axis="${axis}"] .pid-slider-row`);
    rows.each((index, row) => {
      const gain = group?.gains?.[gainNames[index]];
      if (!gain) return;
      $(row).find('input').each((_inputIndex, input) => attachNativeElement(tab, input, gain.id));
    });
  }
  const secondary = [
    ['#pid_baro tr.ALT input[name="p"]', 'PSC_POSZ_P'],
    ['#pid_baro tr.Vario input[name="p"]', 'PSC_VELZ_P'],
    ['#pid_baro tr.Vario input[name="i"]', 'PSC_VELZ_I'],
    ['#pid_gps tr.Pos input[name="p"]', 'PSC_POSXY_P'],
    ['#pid_gps tr.PosR input[name="p"]', 'PSC_VELXY_P'],
    ['#pid_gps tr.PosR input[name="i"]', 'PSC_VELXY_I'],
    ['#gyroLPFHz', 'INS_GYRO_FILTER'],
    ['#dTermLPFHz', 'INS_ACCEL_FILTER'],
  ];
  for (const [selector, id] of secondary) {
    attachNativeElement(tab, tab.root.find(selector), id);
  }
  tab.root.find('.action-resetDefaults, .action-resetPIDs').closest('.default_btn').hide();
}

function renderCalibration(tab) {
  commandAction(tab, '#calibrate-start-button', {
    label: 'Accelerometer calibration',
    command: MAV_CMD_PREFLIGHT_CALIBRATION,
    parameters: { param5: 1 },
    confirm: 'Start ArduPilot accelerometer calibration? Keep the propellers removed and follow each orientation prompt shown by the controller.',
  });
  commandAction(tab, '#mag_btn a.calibratemag', {
    label: 'Compass calibration',
    command: MAV_CMD_DO_START_MAG_CAL,
    parameters: {
      param1: 0,
      param2: 1,
      param3: 1,
      param4: 0,
      param5: 0,
    },
    confirm: 'Start ArduPilot onboard compass calibration? Move the vehicle through every orientation until the controller reports completion.',
  });
  tab.root.find('#opflow_btn a.calibrateopflow')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotCommand')
    .on('click.fcArduPilotCommand', (event) => {
      event.preventDefault();
      const scaler = tab.root.find('[data-fc-parity-control="flow-scale"] input');
      scaler.trigger('focus');
      tab.setStatus('Adjust Optical-flow scale in the translated control above, then select Save. ArduPilot applies FLOW_FXSCALER directly.');
    });
  tab.stateUnsubscribe = mavlinkSession.on('statusText', (entry) => {
    if (entry?.text) tab.setStatus(`Controller: ${entry.text}`);
  });
}

function renderMagnetometer(tab) {
  const render = (state = mavlinkSession.snapshot()) => {
    tab.root.find('.attitude_info .heading').text(
      Number.isFinite(Number(state.heading)) ? `${Number(state.heading).toFixed(1)}°` : '--',
    );
    tab.root.find('.attitude_info .pitch').text(
      Number.isFinite(Number(state.pitch)) ? `${Number(state.pitch).toFixed(1)}°` : '--',
    );
    tab.root.find('.attitude_info .roll').text(
      Number.isFinite(Number(state.roll)) ? `${Number(state.roll).toFixed(1)}°` : '--',
    );
  };
  render();
  tab.stateUnsubscribe = mavlinkSession.on('state', render);
}

function renderSetup(tab) {
  const render = (state = mavlinkSession.snapshot()) => {
    tab.root.find('.heading').text(
      Number.isFinite(Number(state.heading)) ? `${Number(state.heading).toFixed(1)}°` : '--',
    );
    tab.root.find('.bat-voltage').text(
      Number.isFinite(Number(state.voltage)) ? `${Number(state.voltage).toFixed(2)} V` : '--',
    );
    tab.root.find('.bat-current-draw').text(
      Number.isFinite(Number(state.current)) ? `${Number(state.current).toFixed(2)} A` : '--',
    );
    tab.root.find('.bat-power-draw').text(
      Number.isFinite(Number(state.voltage)) && Number.isFinite(Number(state.current))
        ? `${(Number(state.voltage) * Number(state.current)).toFixed(1)} W`
        : '--',
    );
    tab.root.find('.bat-percent').text(
      Number.isFinite(Number(state.batteryRemaining)) ? `${Math.round(state.batteryRemaining)} %` : '--',
    );
    tab.root.find('.rssi').text(
      Number.isFinite(Number(state.rssi)) ? `${Math.round(state.rssi)} %` : '--',
    );
    tab.root.find('.gpsFixType').text(`Fix ${state.gpsFix ?? 0}`);
    tab.root.find('.gpsSats').text(state.satellites ?? '--');
    tab.root.find('.gpsLat').text(
      Number.isFinite(Number(state.latitude)) ? Number(state.latitude).toFixed(7) : '--',
    );
    tab.root.find('.gpsLon').text(
      Number.isFinite(Number(state.longitude)) ? Number(state.longitude).toFixed(7) : '--',
    );
    tab.root.find('#attitude').text(
      `Roll ${Number.isFinite(Number(state.roll)) ? Number(state.roll).toFixed(1) : '--'}° · `
      + `Pitch ${Number.isFinite(Number(state.pitch)) ? Number(state.pitch).toFixed(1) : '--'}°`,
    );
    tab.root.find('#heading').text(
      `Yaw ${Number.isFinite(Number(state.yaw)) ? Number(state.yaw).toFixed(1) : '--'}°`,
    );
  };
  render();
  tab.stateUnsubscribe = mavlinkSession.on('state', render);
}

function sensorText(value, precision = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(precision) : '--';
}

function renderSensorPlot(tab, key, selector, values, scale) {
  if (!tab.sensorHistory) tab.sensorHistory = new Map();
  const history = tab.sensorHistory.get(key) ?? [];
  history.push(values.map((value) => Number(value)));
  if (history.length > 120) history.shift();
  tab.sensorHistory.set(key, history);
  const svg = tab.root.find(selector);
  if (!svg.length) return;
  svg.attr('viewBox', '0 0 400 130');
  const colors = ['#5bc0eb', '#f4d35e', '#ee6c4d'];
  values.forEach((_value, axis) => {
    const points = history.map((sample, index) => {
      const numeric = Number(sample[axis]);
      const bounded = Number.isFinite(numeric) ? Math.max(-scale, Math.min(scale, numeric)) : 0;
      const x = history.length > 1 ? (index / (history.length - 1)) * 400 : 0;
      const y = 65 - ((bounded / Math.max(scale, 0.0001)) * 55);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    let line = svg.find(`polyline[data-fc-sensor-axis="${axis}"]`);
    if (!line.length) {
      line = $(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'))
        .attr({
          'data-fc-sensor-axis': axis,
          fill: 'none',
          stroke: colors[axis],
          'stroke-width': 1.5,
        })
        .appendTo(svg);
    }
    line.attr('points', points);
  });
}

function renderSensors(tab) {
  const inputs = rootInputs(tab.root)
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false);
  const checkboxes = tab.root.find('.checkboxes input[type="checkbox"]');
  checkboxes.filter('[name="gyro_on"], [name="accel_on"], [name="baro_on"]')
    .prop('checked', true);
  const visibility = Object.freeze({
    gyro_on: '.wrapper.gyro',
    accel_on: '.wrapper.accel',
    mag_on: '.wrapper.mag',
    baro_on: '.wrapper.altitude',
    sonar_on: '.wrapper.sonar',
    airspeed_on: '.wrapper.airspeed',
    temperature_on: '.wrapper.temperature',
    debug_on: '.wrapper.debug',
  });
  const updateVisibility = () => {
    for (const [name, selector] of Object.entries(visibility)) {
      tab.root.find(selector).toggle(tab.root.find(`input[name="${name}"]`).prop('checked'));
    }
  };
  checkboxes.on('change.fcArduPilotSensors', updateVisibility);
  updateVisibility();

  const updateRate = () => {
    const milliseconds = Math.min(...tab.root.find('select[name$="refresh_rate"]')
      .map((_index, element) => Number($(element).val()) || 1000).get());
    mavlinkSession.requestDataStreams(Math.max(1, Math.min(20, 1000 / milliseconds))).catch(() => {});
  };
  inputs.filter('select[name$="refresh_rate"]').on('change.fcArduPilotSensors', updateRate);
  updateRate();

  const render = (state = mavlinkSession.snapshot()) => {
    const raw = state.rawSensors ?? {};
    const assignVector = (wrapper, values = []) => {
      ['x', 'y', 'z'].forEach((axis, index) => {
        tab.root.find(`${wrapper} dd.${axis}`).text(sensorText(values[index]));
      });
    };
    assignVector('.wrapper.gyro', raw.gyro);
    assignVector('.wrapper.accel', raw.accel);
    assignVector('.wrapper.mag', raw.mag);
    tab.root.find('.wrapper.altitude dd.x').text(sensorText(state.relativeAltitude));
    tab.root.find('.wrapper.altitude dd.y').text(sensorText(raw.pressure));
    tab.root.find('.wrapper.sonar dd.x').text(sensorText(raw.distance));
    tab.root.find('.wrapper.airspeed dd.x').text(sensorText(state.airSpeed));
    tab.root.find('.wrapper.temperature .plot_control dd.x').each((index, element) => {
      $(element).text(sensorText(raw.temperatures?.[index]));
    });
    renderSensorPlot(tab, 'gyro', 'svg#gyro', raw.gyro ?? [], Number(tab.root.find('[name="gyro_scale"]').val()) || 2000);
    renderSensorPlot(tab, 'accel', 'svg#accel', raw.accel ?? [], Number(tab.root.find('[name="accel_scale"]').val()) || 2);
    renderSensorPlot(tab, 'mag', 'svg#mag', raw.mag ?? [], Number(tab.root.find('[name="mag_scale"]').val()) || 1);
    renderSensorPlot(tab, 'altitude', 'svg#altitude', [state.relativeAltitude, raw.pressure], 100);
    renderSensorPlot(tab, 'sonar', 'svg#sonar', [raw.distance], 20);
    renderSensorPlot(tab, 'airspeed', 'svg#airspeed', [state.airSpeed], 50);
  };
  render();
  tab.stateUnsubscribe = mavlinkSession.on('state', render);
}

function renderGps(tab) {
  tab.root.find('.content_wrapper .config-section').first()
    .attr('data-fc-parity-canonical-layout', 'gps-navigation')
    .show();
  const render = (state = mavlinkSession.snapshot()) => {
    tab.root.find('.fix').text(state.gpsFix ?? 0);
    tab.root.find('.sats').text(state.satellites ?? '--');
    tab.root.find('.lat, .latitude').text(
      Number.isFinite(Number(state.latitude)) ? Number(state.latitude).toFixed(7) : '--',
    );
    tab.root.find('.lon, .longitude').text(
      Number.isFinite(Number(state.longitude)) ? Number(state.longitude).toFixed(7) : '--',
    );
    tab.root.find('.GPS_info .alt').text(
      Number.isFinite(Number(state.altitudeMsl)) ? `${Number(state.altitudeMsl).toFixed(1)} m` : '--',
    );
    tab.root.find('.GPS_info .speed').text(
      Number.isFinite(Number(state.groundSpeed)) ? `${Number(state.groundSpeed).toFixed(1)} m/s` : '--',
    );
    tab.root.find('.GPS_stat .hdop').text(
      Number.isFinite(Number(state.hdop)) ? Number(state.hdop).toFixed(2) : '--',
    );
  };
  render();
  tab.stateUnsubscribe = mavlinkSession.on('state', render);
  const position = selectMavlinkMapPosition(mavlinkSession.snapshot());
  tab.map = new OpenLayersMap({
    target: 'gps-map',
    layers: createBaseMapLayers(MAP_STYLES.HYBRID),
    view: new View({
      center: fromLonLat(position
        ? [position.longitude, position.latitude]
        : [-96, 38]),
      zoom: position ? 16 : 4,
    }),
  });
  tab.root.find('#center_button').prop('disabled', false).on(
    'click.fcArduPilotParity',
    (event) => {
      event.preventDefault();
      const current = selectMavlinkMapPosition(mavlinkSession.snapshot());
      if (!current) {
        tab.setStatus('A valid GPS fix or home position is required before centering the map.', true);
        return;
      }
      tab.map.getView().animate({
        center: fromLonLat([current.longitude, current.latitude]),
        zoom: Math.max(16, tab.map.getView().getZoom() ?? 16),
      });
    },
  );
  setTimeout(() => tab.map?.updateSize(), 0);
}

function humanizeOsdElement(id) {
  return String(id).replace(/^OSD1_/, '').replace(/_EN$/, '').replaceAll('_', ' ').toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function renderOsd(tab) {
  tab.root.find('.supported').removeClass('hide').show();
  tab.root.find('.unsupported').hide();
  const parameters = ardupilotSetupService.parameterManager.parameters;
  const byId = parameters instanceof Map ? parameters : new Map(
    Array.from(parameters ?? [], (parameter) => [parameter.id, parameter]),
  );
  const enabledIds = [...byId.keys()].filter((id) => /^OSD1_.+_EN$/.test(id)).sort();
  const fields = tab.root.find('.display-fields').empty();
  const preview = tab.root.find('.display-layout .preview').empty().css('position', 'relative');
  for (const id of enabledIds) {
    const base = id.slice(0, -3);
    const xId = `${base}_X`;
    const yId = `${base}_Y`;
    const row = $('<label>').addClass('fc-ap-osd-field')
      .append($('<span>').text(humanizeOsdElement(id)));
    const checkbox = $('<input type="checkbox">').prependTo(row);
    attachNativeElement(tab, checkbox, id);
    fields.append(row);
    const enabled = Number(parameterDefinition(id)?.parameter?.value) !== 0;
    if (!enabled || !byId.has(xId) || !byId.has(yId)) continue;
    const x = Number(parameterDefinition(xId)?.parameter?.value) || 0;
    const y = Number(parameterDefinition(yId)?.parameter?.value) || 0;
    $('<span>')
      .addClass('fc-ap-osd-preview-element')
      .attr('title', `${id} · ${xId}=${x} · ${yId}=${y}`)
      .text(humanizeOsdElement(id).slice(0, 8))
      .css({
        position: 'absolute',
        left: `${Math.max(0, Math.min(100, (x / 29) * 100))}%`,
        top: `${Math.max(0, Math.min(100, (y / 15) * 100))}%`,
      })
      .appendTo(preview);
  }
  tab.root.find('.osd_layouts').empty().append('<option value="1">Layout 1</option>').prop('disabled', false);
}

function renderLogging(tab) {
  tab.root.find('.require-blackbox-supported').show();
  tab.root.find('.require-blackbox-unsupported').hide();
  const backend = parameterDefinition('LOG_BACKEND_TYPE');
  const enabled = Number(backend?.parameter?.value) !== 0;
  tab.root.find('input.feature[name="BLACKBOX"]')
    .prop('checked', enabled)
    .prop('disabled', true);
  tab.root.find('select[name="blackbox_rate"]').empty()
    .append('<option>Controller managed</option>')
    .prop('disabled', true);
  const storage = tab.root.find('.require-dataflash-supported .spacer_box').first();
  const selector = $('<select>')
    .addClass('fc-ap-log-select')
    .attr('aria-label', 'ArduPilot onboard log')
    .prependTo(storage);
  const refresh = $('<a href="#">')
    .addClass('regular-button fc-ap-log-refresh')
    .text('Refresh log list')
    .prependTo(storage);
  const loadLogs = async () => {
    refresh.addClass('disabled');
    selector.empty().append('<option>Reading ArduPilot logs…</option>').prop('disabled', true);
    try {
      const logs = await mavlinkLogManager.list({
        onProgress: ({ received, total }) => tab.setStatus(`Reading onboard logs: ${received} / ${total || '?'}`),
      });
      tab.onboardLogs = logs;
      selector.empty();
      for (const entry of [...logs].reverse()) {
        const time = entry.timeUtc > 0
          ? new Date(entry.timeUtc * 1000).toLocaleString()
          : 'time unavailable';
        selector.append(
          $('<option>').val(entry.id).text(
            `Log ${entry.id} · ${(entry.size / (1024 * 1024)).toFixed(2)} MB · ${time}`,
          ),
        );
      }
      if (!logs.length) selector.append('<option>No onboard logs reported</option>');
      selector.prop('disabled', !logs.length);
      tab.root.find('.dataflash-used .legend').text(`${logs.length} ArduPilot log(s)`);
      tab.setStatus(logs.length ? `Found ${logs.length} onboard log(s).` : 'No onboard logs are stored.');
    } catch (error) {
      selector.empty().append('<option>Log list unavailable</option>');
      tab.setStatus(error.message, true);
    } finally {
      refresh.removeClass('disabled');
    }
  };
  refresh.attr('data-fc-parity-workflow', 'true')
    .on('click.fcArduPilotLogs', (event) => {
      event.preventDefault();
      void loadLogs();
    });
  tab.root.find('a.save-flash')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotLogs')
    .on('click.fcArduPilotLogs', async (event) => {
      event.preventDefault();
      const id = Number(selector.val());
      const entry = tab.onboardLogs?.find((item) => item.id === id);
      if (!entry) {
        tab.setStatus('Select an onboard log to download.', true);
        return;
      }
      const result = await dialog.showSaveDialog({
        defaultPath: `ardupilot-log-${entry.id}.bin`,
        filters: [{ name: 'ArduPilot DataFlash log', extensions: ['bin'] }],
      });
      if (result.canceled) return;
      try {
        const bytes = await mavlinkLogManager.download(entry, {
          onProgress: ({ received, total }) => tab.setStatus(
            `Downloading log ${entry.id}: ${Math.floor((received / total) * 100)}%`,
          ),
        });
        const error = await window.electronAPI.writeFile(result.filePath, bytes);
        if (error) throw new Error(String(error));
        tab.setStatus(`Log ${entry.id} saved (${bytes.length.toLocaleString()} bytes).`);
      } catch (error) {
        tab.setStatus(`Log download failed: ${error.message}`, true);
      }
    });
  tab.root.find('a.erase-flash')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotLogs')
    .on('click.fcArduPilotLogs', async (event) => {
      event.preventDefault();
      if (mavlinkSession.snapshot().armed) {
        tab.setStatus('Disarm the vehicle before erasing onboard logs.', true);
        return;
      }
      if (!window.confirm('Erase every onboard ArduPilot log? This cannot be undone.')) return;
      try {
        await mavlinkLogManager.erase();
        tab.setStatus('Log erase request sent. Refreshing the log list…');
        await loadLogs();
      } catch (error) {
        tab.setStatus(`Log erase failed: ${error.message}`, true);
      }
    });
  void loadLogs();
}

function selectedTelemetryGroups(tab) {
  return tab.root.find('.properties input[type="checkbox"]:checked')
    .map((_index, element) => String($(element).attr('name'))).get();
}

function telemetryLogColumns(groups, state) {
  const columns = ['timestamp'];
  for (const group of groups) {
    if (group === 'MSP_RAW_IMU') {
      columns.push('gyroX', 'gyroY', 'gyroZ', 'accelX', 'accelY', 'accelZ', 'magX', 'magY', 'magZ');
    } else if (group === 'MSP_ATTITUDE') {
      columns.push('roll', 'pitch', 'yaw');
    } else if (group === 'MSP_ALTITUDE') {
      columns.push('altitudeMsl', 'relativeAltitude', 'climbRate');
    } else if (group === 'MSP_RAW_GPS') {
      columns.push('gpsFix', 'satellites', 'latitude', 'longitude', 'altitudeMsl', 'groundSpeed', 'heading');
    } else if (group === 'MSP_ANALOG') {
      columns.push('voltage', 'current', 'batteryRemaining', 'rssi');
    } else if (group === 'MSP_RC') {
      columns.push(...state.rcChannels.map((_value, index) => `RC${index + 1}`));
    } else if (group === 'MSP_MOTOR') {
      columns.push(...state.servoOutputs.map((_value, index) => `Output${index + 1}`));
    } else if (group === 'MSP_DEBUG') {
      columns.push('systemLoad', 'communicationDropRate', 'communicationErrors',
        ...state.controllerErrorCounts.map((_value, index) => `controllerError${index + 1}`));
    }
  }
  return columns;
}

function telemetryLogRow(groups, state, timestamp = Date.now()) {
  const values = [timestamp];
  for (const group of groups) {
    if (group === 'MSP_RAW_IMU') {
      values.push(...state.rawSensors.gyro, ...state.rawSensors.accel, ...state.rawSensors.mag);
    } else if (group === 'MSP_ATTITUDE') {
      values.push(state.roll, state.pitch, state.yaw);
    } else if (group === 'MSP_ALTITUDE') {
      values.push(state.altitudeMsl, state.relativeAltitude, state.climbRate);
    } else if (group === 'MSP_RAW_GPS') {
      values.push(state.gpsFix, state.satellites, state.latitude, state.longitude,
        state.altitudeMsl, state.groundSpeed, state.heading);
    } else if (group === 'MSP_ANALOG') {
      values.push(state.voltage, state.current, state.batteryRemaining, state.rssi);
    } else if (group === 'MSP_RC') {
      values.push(...state.rcChannels);
    } else if (group === 'MSP_MOTOR') {
      values.push(...state.servoOutputs);
    } else if (group === 'MSP_DEBUG') {
      values.push(state.systemLoad, state.communicationDropRate, state.communicationErrors,
        ...state.controllerErrorCounts);
    }
  }
  return values.map((value) => value == null ? '' : value).join(',');
}

function renderTetheredLogging(tab) {
  rootInputs(tab.root)
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false);
  const log = {
    filePath: null,
    running: false,
    groups: [],
    samples: 0,
    bytes: 0,
    lastSampleAt: 0,
    writeQueue: Promise.resolve(),
  };
  tab.telemetryLog = log;
  const fileButton = tab.root.find('a.log_file')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotLogging')
    .on('click.fcArduPilotLogging', async (event) => {
      event.preventDefault();
      const date = new Date().toISOString().replace(/[:.]/g, '-');
      const result = await dialog.showSaveDialog({
        defaultPath: `flight_commander_mavlink_${date}.csv`,
        filters: [{ name: 'CSV telemetry log', extensions: ['csv'] }],
      });
      if (result.canceled) return;
      log.filePath = result.filePath;
      fileButton.text(`Log file: ${String(result.filePath).split(/[\\/]/).pop()}`);
      tab.setStatus('Telemetry log file selected. Choose data groups, then select Start logging.');
    });
  const loggingButton = tab.root.find('a.logging')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotLogging')
    .on('click.fcArduPilotLogging', async (event) => {
      event.preventDefault();
      if (log.running) {
        log.running = false;
        loggingButton.text('Start logging');
        tab.root.find('select.speed').prop('disabled', false);
        tab.setStatus(`Telemetry logging stopped after ${log.samples} samples.`);
        return;
      }
      if (!log.filePath) {
        tab.setStatus('Choose a telemetry log file before starting.', true);
        return;
      }
      log.groups = selectedTelemetryGroups(tab);
      if (!log.groups.length) {
        tab.setStatus('Select at least one telemetry group before starting.', true);
        return;
      }
      const state = mavlinkSession.snapshot();
      const header = `${telemetryLogColumns(log.groups, state).join(',')}\n`;
      const error = await window.electronAPI.writeFile(log.filePath, header);
      if (error) {
        tab.setStatus(`Unable to create telemetry log: ${error}`, true);
        return;
      }
      log.running = true;
      log.samples = 0;
      log.bytes = header.length;
      log.lastSampleAt = 0;
      loggingButton.text('Stop logging');
      tab.root.find('select.speed').prop('disabled', true);
      tab.setStatus('Recording selected MAVLink telemetry groups…');
    });
  tab.root.find('a.back')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotLogging')
    .on('click.fcArduPilotLogging', (event) => {
      event.preventDefault();
      if (log.running) loggingButton.trigger('click');
    });

  const record = (state) => {
    if (!log.running || !log.filePath) return;
    const now = Date.now();
    const period = Number(tab.root.find('select.speed').val()) || 100;
    if (now - log.lastSampleAt < period) return;
    log.lastSampleAt = now;
    const line = `${telemetryLogRow(log.groups, state, now)}\n`;
    log.writeQueue = log.writeQueue.then(() => window.electronAPI.appendFile(log.filePath, line));
    log.samples += 1;
    log.bytes += line.length;
    tab.root.find('.samples').text(log.samples);
    tab.root.find('.size').text(`${log.bytes.toLocaleString()} Bytes`);
  };
  tab.stateUnsubscribe = mavlinkSession.on('state', record);
  tab.beforeCleanup = () => { log.running = false; };
}

function renderProgramming(tab) {
  tab.root.find('.gvar__container, .subtab__header, .subtab__content').hide();
  const host = tab.root.find('.content_wrapper').first();
  if (!host.find('.fc-ap-programming-launcher').length) {
    const launcher = $('<section>')
      .addClass('gui_box grey config-section fc-ap-programming-launcher')
      .append(
        $('<div>').addClass('gui_box_titlebar').append(
          $('<div>').addClass('spacer_box_title').text('Flight Commander programming workflow'),
        ),
        $('<div>').addClass('spacer_box settings').append(
          $('<p>').text(
            'ArduPilot uses onboard Lua for Flight Commander logic conditions, programmable controllers, and persistent variables. Configure the runtime below, then edit and transfer the script in the Programming Editor.',
          ),
          $('<div>').addClass('default_btn').append(
            $('<a href="#">')
              .addClass('fc-ap-open-script-editor')
              .text('Open Programming Editor')
              .on('click.fcArduPilotProgramming', (event) => {
                event.preventDefault();
                tab.root.closest('body').find('#tabs .tab_ardupilot_javascript_programming a').first().trigger('click');
              }),
          ),
        ),
      );
    host.prepend(launcher);
  }
}

function luaPreflight(source) {
  const text = String(source ?? '');
  if (!text.trim()) throw new Error('Enter an ArduPilot Lua script first.');
  if (text.includes('\0')) throw new Error('The script contains a null byte and cannot be uploaded.');
  if (/\b(?:const|let|var)\b|=>|\binav\./.test(text)) {
    throw new Error('This editor accepts ArduPilot Lua, not INAV JavaScript. Load an ArduPilot example or translate the script first.');
  }
  const opening = (text.match(/[([{]/g) ?? []).length;
  const closing = (text.match(/[)\]}]/g) ?? []).length;
  if (opening !== closing) throw new Error('Delimiter check failed: parentheses, brackets, or braces are unbalanced.');
  return Object.freeze({
    bytes: new TextEncoder().encode(text).length,
    lines: text.split(/\r?\n/).length,
  });
}

function editorText(tab) {
  return String(tab.root.find('.fc-ap-lua-editor').val() ?? '');
}

function showProgrammingOutput(tab, message, error = false) {
  tab.root.find('#transpiler-output').val(message);
  tab.root.find('#transpiler-warnings')
    .toggle(Boolean(error))
    .empty()
    .append(
      $('<div>').addClass(`note${error ? ' error' : ''}`).append(
        $('<div>').addClass('note_spacer').text(message),
      ),
    );
  tab.setStatus(message, error);
}

function renderJavascriptProgramming(tab) {
  tab.root.find('.note_spacer').first().empty().append(
    $('<p>').text(
      'This is Flight Commander’s programming editor translated to ArduPilot Lua. Scripts run on the flight controller and can read vehicle state, RC channels, parameters, and control approved outputs through ArduPilot’s sandboxed scripting API.',
    ),
    $('<p>').text(
      `Load and save transfer ${ARDUPILOT_SCRIPT_PATH} through MAVLink FTP. The controller performs the authoritative Lua compile after a reboot; status messages report any runtime error.`,
    ),
  );

  const editorHost = tab.root.find('#monaco-editor').empty();
  $('<textarea>')
    .addClass('fc-ap-lua-editor')
    .attr({
      spellcheck: 'false',
      'aria-label': 'ArduPilot Lua script editor',
    })
    .val(LUA_EXAMPLES.heartbeat.source)
    .appendTo(editorHost);

  const exampleSelect = tab.root.find('#examples-select').empty()
    .append($('<option>').val('').text('Select an ArduPilot Lua example'));
  for (const [key, example] of Object.entries(LUA_EXAMPLES)) {
    exampleSelect.append($('<option>').val(key).text(example.label));
  }
  exampleSelect
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false)
    .off('.fcArduPilotProgramming')
    .on('change.fcArduPilotProgramming', () => {
      const example = LUA_EXAMPLES[exampleSelect.val()];
      if (example) tab.root.find('.fc-ap-lua-editor').val(example.source);
    });
  tab.root.find('#js-example-select label').text('Load example');

  const checkButton = tab.root.find('a.transpile')
    .text('Check ArduPilot Lua')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotProgramming')
    .on('click.fcArduPilotProgramming', (event) => {
      event.preventDefault();
      try {
        const result = luaPreflight(editorText(tab));
        showProgrammingOutput(
          tab,
          `Flight Commander preflight passed: ${result.lines} lines, ${result.bytes} UTF-8 bytes. Upload, reboot, and inspect ArduPilot status messages for the controller's authoritative compile result.`,
        );
      } catch (error) {
        showProgrammingOutput(tab, error.message, true);
      }
    });

  tab.root.find('a.load')
    .text('Load from Controller')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotProgramming')
    .on('click.fcArduPilotProgramming', async (event) => {
      event.preventDefault();
      showProgrammingOutput(tab, `Downloading ${ARDUPILOT_SCRIPT_PATH}…`);
      try {
        const data = await mavlinkFtpClient.download(ARDUPILOT_SCRIPT_PATH, {
          onProgress: ({ received, total }) => tab.setStatus(`Downloading script: ${received} / ${total} bytes`),
        });
        tab.root.find('.fc-ap-lua-editor').val(new TextDecoder().decode(data));
        showProgrammingOutput(tab, `Loaded ${data.length} bytes from ${ARDUPILOT_SCRIPT_PATH}.`);
      } catch (error) {
        showProgrammingOutput(tab, `Script download failed: ${error.message}`, true);
      }
    });

  tab.root.find('a.save')
    .text('Save to Controller')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotProgramming')
    .on('click.fcArduPilotProgramming', async (event) => {
      event.preventDefault();
      const state = mavlinkSession.snapshot();
      if (state.armed) {
        showProgrammingOutput(tab, 'Disarm the vehicle before transferring a script.', true);
        return;
      }
      let result;
      try {
        result = luaPreflight(editorText(tab));
      } catch (error) {
        showProgrammingOutput(tab, error.message, true);
        return;
      }
      if (!window.confirm(
        `Upload ${result.bytes} bytes to ${ARDUPILOT_SCRIPT_PATH}? The vehicle must be rebooted before the new Lua script is guaranteed to run.`,
      )) return;
      showProgrammingOutput(tab, `Uploading ${ARDUPILOT_SCRIPT_PATH}…`);
      try {
        await mavlinkFtpClient.upload(ARDUPILOT_SCRIPT_PATH, editorText(tab), {
          onProgress: ({ received, total }) => tab.setStatus(`Uploading script: ${received} / ${total} bytes`),
        });
        showProgrammingOutput(
          tab,
          `Uploaded and closed ${ARDUPILOT_SCRIPT_PATH}. Reboot the controller, then watch StatusText for the ArduPilot Lua compile result.`,
        );
      } catch (error) {
        showProgrammingOutput(tab, `Script upload failed: ${error.message}`, true);
      }
    });

  tab.root.find('a.clear')
    .text('Clear')
    .attr('data-fc-parity-workflow', 'true')
    .off('.fcArduPilotProgramming')
    .on('click.fcArduPilotProgramming', (event) => {
      event.preventDefault();
      if (window.confirm('Clear the editor? This does not delete the controller copy.')) {
        tab.root.find('.fc-ap-lua-editor').val('');
        showProgrammingOutput(tab, 'Editor cleared. The controller copy is unchanged.');
      }
    });

  tab.root.find('#transpiler-output').val(
    'Ready. Flight Commander performs a local preflight; ArduPilot performs the authoritative Lua compile after upload and reboot.',
  ).attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false);
  tab.root.find('#lc-count').text('ArduPilot Lua');
  tab.root.find('#optimization-stats').hide();
  tab.root.find('#api-reference-toggle').off('.fcArduPilotProgramming')
    .on('click.fcArduPilotProgramming', (event) => {
      event.preventDefault();
      tab.root.find('#api-reference-content').toggle();
    });
  tab.root.find('#api-reference-content .note_spacer').html(
    '<h4>ArduPilot Lua quick reference</h4>'
      + '<h5>Vehicle state</h5><pre>arming:is_armed()\nvehicle:get_mode()\nahrs:get_position()\nbattery:voltage(0)</pre>'
      + '<h5>RC and parameters</h5><pre>rc:get_pwm(7)\nparam:get("SCR_USER1")\nparam:set("SCR_USER1", 10)</pre>'
      + '<h5>Status and scheduling</h5><pre>gcs:send_text(6, "message")\nreturn update, 1000</pre>'
      + '<p>Only APIs provided by the installed ArduPilot firmware are available. Runtime errors appear in MAVLink status messages.</p>',
  );
  tab.root.find('.fc-ap-lua-editor, a.transpile, a.load, a.save, a.clear')
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false);
}

function consoleAppend(tab, text, kind = 'output') {
  const line = String(text ?? '');
  tab.consoleHistory.push(line);
  $('<div>').addClass(`fc-ap-console-line fc-ap-console-line--${kind}`).text(line)
    .appendTo(tab.root.find('.backdrop .window .wrapper'));
  const windowElement = tab.root.find('.backdrop .window').get(0);
  if (windowElement) windowElement.scrollTop = windowElement.scrollHeight;
}

function matchingParameters(pattern) {
  const query = String(pattern ?? '').trim().toLowerCase();
  return ardupilotSetupService.snapshot().parameters
    .map((parameter) => parameterDefinition(parameter.id))
    .filter(Boolean)
    .filter((definition) => {
      if (!query || query === '*') return true;
      return [
        definition.id,
        definition.metadata.displayName,
        definition.metadata.description,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function executeConsoleCommand(tab, rawCommand) {
  const command = String(rawCommand ?? '').trim();
  if (!command) return;
  consoleAppend(tab, `> ${command}`, 'command');
  const [verbRaw, ...parts] = command.split(/\s+/);
  const verb = verbRaw.toLowerCase();
  if (verb === 'help') {
    consoleAppend(tab, 'Commands: help, status, get <name>, set <PARAM> <value>, diff, save, reboot, clear');
  } else if (verb === 'status') {
    const state = mavlinkSession.snapshot();
    consoleAppend(tab, `${state.vehicleTypeName} · ${state.modeName} · ${state.armed ? 'ARMED' : 'disarmed'} · system ${state.systemId ?? '?'}`);
  } else if (verb === 'get') {
    const matches = matchingParameters(parts.join(' ')).slice(0, 200);
    if (!matches.length) consoleAppend(tab, 'No matching parameters.');
    for (const definition of matches) {
      consoleAppend(tab, `${definition.id} = ${definitionValue(tab, definition)}${definition.metadata.units ? ` ${definition.metadata.units}` : ''}`);
    }
    if (matchingParameters(parts.join(' ')).length > matches.length) {
      consoleAppend(tab, 'Showing the first 200 matches; narrow the search pattern.');
    }
  } else if (verb === 'set') {
    const id = String(parts[0] ?? '').toUpperCase();
    const definition = parameterDefinition(id);
    if (!definition) throw new Error(`${id || 'Parameter'} is not reported by this controller.`);
    const validation = validateParameterValue(definition.parameter, parts[1]);
    if (!validation.valid) throw new Error(validation.message);
    stageArduPilotParameter(tab.staged, definition, validation.value);
    consoleAppend(tab, `${id} staged as ${validation.value}; use save to write and verify it.`);
    tab.updateControls();
  } else if (verb === 'diff') {
    if (!tab.staged.size) consoleAppend(tab, 'No staged changes.');
    for (const [id, value] of tab.staged) {
      consoleAppend(tab, `${id}: ${parameterDefinition(id)?.parameter.value} -> ${value}`);
    }
  } else if (verb === 'save') {
    await tab.save();
    consoleAppend(tab, tab.staged.size ? 'Save did not complete; staged changes remain.' : 'Staged changes saved and verified.');
  } else if (verb === 'reboot') {
    if (mavlinkSession.snapshot().armed) throw new Error('Disarm the vehicle before rebooting.');
    if (window.confirm('Reboot the connected ArduPilot controller?')) {
      await rebootArduPilotController();
      consoleAppend(tab, 'Reboot command sent. Reconnect when the controller returns.');
    }
  } else if (verb === 'clear') {
    tab.root.find('.backdrop .window .wrapper').empty();
    tab.consoleHistory = [];
  } else {
    throw new Error(`Unknown command: ${verb}. Enter help for the supported Flight Commander console commands.`);
  }
}

function renderCli(tab) {
  tab.consoleHistory = [];
  tab.root.find('.note_spacer').first().text(
    'ArduPilot does not expose INAV’s firmware CLI. Flight Commander keeps the same console workflow and translates it into parameter reads, staged writes with read-back verification, status, and safe reboot commands.',
  );
  const input = tab.root.find('textarea[name="commands"]')
    .attr({
      placeholder: 'Enter help, get, set, diff, save, status, or reboot',
      'data-fc-parity-workflow': 'true',
    })
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false)
    .off('.fcArduPilotCli')
    .on('keydown.fcArduPilotCli', async (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      const command = input.val();
      input.val('');
      try {
        await executeConsoleCommand(tab, command);
      } catch (error) {
        consoleAppend(tab, `Error: ${error.message}`, 'error');
        tab.setStatus(error.message, true);
      }
    });
  tab.root.find('.helpiconLink').attr('href', 'https://ardupilot.org/copter/docs/parameters.html');
  tab.root.find('a.msc').hide();
  tab.root.find('a.savecmd')
    .text('Save staged settings')
    .off('.fcArduPilotParity .fcArduPilotCli')
    .on('click.fcArduPilotCli', (event) => {
      event.preventDefault();
      void executeConsoleCommand(tab, 'save').catch((error) => consoleAppend(tab, `Error: ${error.message}`, 'error'));
    });
  tab.root.find('a.exit')
    .text('Reboot')
    .off('.fcArduPilotCli')
    .on('click.fcArduPilotCli', (event) => {
      event.preventDefault();
      void executeConsoleCommand(tab, 'reboot').catch((error) => consoleAppend(tab, `Error: ${error.message}`, 'error'));
    });
  tab.root.find('a.diffall')
    .text('Diff')
    .off('.fcArduPilotCli')
    .on('click.fcArduPilotCli', (event) => {
      event.preventDefault();
      void executeConsoleCommand(tab, 'diff');
    });
  tab.root.find('a.clear')
    .text('Clear output')
    .off('.fcArduPilotCli')
    .on('click.fcArduPilotCli', (event) => {
      event.preventDefault();
      void executeConsoleCommand(tab, 'clear');
    });
  tab.root.find('a.copy')
    .text('Copy output')
    .off('.fcArduPilotCli')
    .on('click.fcArduPilotCli', async (event) => {
      event.preventDefault();
      await navigator.clipboard.writeText(tab.consoleHistory.join('\n'));
      tab.setStatus('Console output copied to the clipboard.');
    });
  tab.root.find('a.load')
    .text('Load commands')
    .off('.fcArduPilotCli')
    .on('click.fcArduPilotCli', async (event) => {
      event.preventDefault();
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Flight Commander parameter commands', extensions: ['txt', 'param'] }],
      });
      if (result.canceled) return;
      const response = await window.electronAPI.readFile(result.filePaths[0]);
      if (response?.error) throw new Error(response.error);
      const text = typeof response === 'string' ? response : response?.data ?? '';
      const commands = String(text).split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      const invalid = commands.filter((line) => !/^set\s+[A-Za-z0-9_]+\s+[-+]?\d/i.test(line));
      if (invalid.length) {
        consoleAppend(tab, 'Loaded files may contain only set PARAM value lines; no commands were staged.', 'error');
        return;
      }
      if (!window.confirm(`Stage ${commands.length} parameter command(s) from this file? Nothing is written until Save.`)) return;
      for (const command of commands) await executeConsoleCommand(tab, command);
    });
  tab.root.find('a.save')
    .text('Save output')
    .off('.fcArduPilotParity .fcArduPilotCli')
    .on('click.fcArduPilotCli', async (event) => {
      event.preventDefault();
      const result = await dialog.showSaveDialog({
        defaultPath: 'flight_commander_ardupilot_console.txt',
        filters: [{ name: 'Text file', extensions: ['txt'] }],
      });
      if (result.canceled) return;
      const error = await window.electronAPI.writeFile(result.filePath, tab.consoleHistory.join('\n'));
      tab.setStatus(error ? `Unable to save console output: ${error}` : 'Console output saved.', Boolean(error));
    });
  tab.root.find('a.cliDocsBtn')
    .text('ArduPilot parameter reference')
    .attr('href', 'https://ardupilot.org/copter/docs/parameters.html');
  tab.root.find('.content_toolbar a')
    .attr('data-fc-parity-workflow', 'true')
    .removeClass('fc-ap-inav-original-pending');
  consoleAppend(tab, 'Flight Commander ArduPilot console ready. Enter help for commands.');
}

function translatedSearchIndex(vehicleType) {
  const results = [];
  for (const [pageKey, page] of Object.entries(ARDUPILOT_FLIGHT_COMMANDER_PARITY)) {
    for (const contract of groupsForVehicle(pageKey, vehicleType)) {
      results.push(Object.freeze({
        pageKey,
        template: page.template,
        contract,
        text: [contract.title, contract.description, ...contract.covers,
          ...contract.controls.flatMap((control) => [control.label, control.description, ...control.candidates])]
          .join(' ').toLowerCase(),
      }));
    }
  }
  return results;
}

function renderSearch(tab) {
  const input = tab.root.find('#search-keyword')
    .attr({
      placeholder: 'Search Flight Commander functions or ArduPilot parameters',
      'data-fc-parity-workflow': 'true',
    })
    .removeClass('fc-ap-inav-original-pending')
    .prop('disabled', false);
  const results = tab.root.find('#search-results');
  tab.root.find('.fc-ap-search-toolbar').remove();
  const toolbar = $('<div>').addClass('content_toolbar fc-ap-toolbar fc-ardupilot-inav-toolbar fc-ap-search-toolbar')
    .append(
      $('<div>').addClass('btn save_btn').append(
        $('<a href="#">').addClass('fc-ap-search-save').text('Save'),
        $('<a href="#">').addClass('fc-ap-search-refresh').text('Refresh'),
      ),
    )
    .appendTo(tab.root);
  toolbar.find('.fc-ap-search-save').on('click.fcArduPilotSearch', (event) => {
    event.preventDefault();
    void tab.save();
  });
  toolbar.find('.fc-ap-search-refresh').on('click.fcArduPilotSearch', (event) => {
    event.preventDefault();
    void tab.load(true);
  });
  const conceptIndex = translatedSearchIndex(mavlinkSession.snapshot().vehicleType);
  const nativeIndex = matchingParameters('');

  const update = () => {
    const query = String(input.val() ?? '').trim().toLowerCase();
    results.empty();
    if (!query) {
      $('<p>').addClass('fc-ap-search-hint').text(
        `Search ${conceptIndex.length} translated Flight Commander feature groups and ${nativeIndex.length} parameters reported by this controller.`,
      ).appendTo(results);
      return;
    }
    const concepts = conceptIndex.filter((entry) => entry.text.includes(query));
    const parameters = nativeIndex.filter((definition) => [
      definition.id,
      definition.metadata.displayName,
      definition.metadata.description,
    ].some((value) => String(value ?? '').toLowerCase().includes(query)));
    $('<h3>').text(`Flight Commander functions (${concepts.length})`).appendTo(results);
    for (const entry of concepts.slice(0, 50)) {
      const card = $('<div>').addClass('fc-ap-search-result fc-ap-search-result--concept').appendTo(results);
      $('<strong>').text(entry.contract.title).appendTo(card);
      $('<span>').text(` · ${entry.contract.translation}`).appendTo(card);
      $('<p>').text(entry.contract.description).appendTo(card);
      $('<a href="#">').text('Open tab').on('click.fcArduPilotSearch', (event) => {
        event.preventDefault();
        tab.root.closest('body').find(`#tabs .tab_ardupilot_${entry.pageKey} a`).first().trigger('click');
      }).appendTo(card);
    }
    $('<h3>').text(`ArduPilot parameters (${parameters.length})`).appendTo(results);
    for (const definition of parameters.slice(0, 100)) {
      const row = $('<div>')
        .addClass('fc-ap-search-result fc-ap-search-result--parameter')
        .attr('data-fc-search-parameter', definition.id)
        .appendTo(results);
      $('<label>')
        .append($('<strong>').text(definition.metadata.displayName ?? definition.id))
        .append($('<small>').text(definition.metadata.description ?? 'Controller-reported ArduPilot parameter.'))
        .appendTo(row);
      const editor = generatedEditorFor(definition, {}).appendTo(row);
      $('<code>').text(definition.id).appendTo(row);
      attachNativeElement(tab, editor, definition.id);
    }
    if (!concepts.length && !parameters.length) {
      $('<p>').text('No translated function or controller parameter matches this search.').appendTo(results);
    }
  };
  input.off('.fcArduPilotSearch').on('input.fcArduPilotSearch', update);
  update();
  tab.updateControls();
}

const RENDERERS = Object.freeze({
  adjustments: renderAdjustments,
  advanced_tuning: renderAdvancedTuning,
  calibration: renderCalibration,
  cli: renderCli,
  configuration: renderConfiguration,
  failsafe: renderFailsafe,
  gps_navigation: renderGps,
  logging: renderLogging,
  led_strip: renderLedStrip,
  javascript_programming: renderJavascriptProgramming,
  magnetometer: renderMagnetometer,
  mixer: renderMixer,
  modes: renderModes,
  osd: renderOsd,
  outputs: renderOutputRows,
  pid_tuning: renderPid,
  ports: renderPorts,
  programming: renderProgramming,
  receiver: renderReceiver,
  search: renderSearch,
  sensors: renderSensors,
  setup: renderSetup,
  tethered_logging: renderTetheredLogging,
});

function createCanonicalArduPilotPage(pageKey) {
  const schema = ARDUPILOT_INAV_PAGE_SCHEMAS[pageKey];
  if (!schema || !TEMPLATES[schema.template]) {
    throw new Error(`Missing canonical INAV template for ArduPilot page ${pageKey}.`);
  }
  const tab = {
    pageKey,
    schema,
    root: null,
    status: null,
    staged: new Map(),
    loading: false,
    writing: false,
    stateUnsubscribe: null,
    map: null,
  };

  tab.initialize = function (callback) {
    if (GUI.active_tab !== this) GUI.active_tab = this;
    GUI.load(TEMPLATES[this.schema.template], () => {
      try {
        this.staged.clear();
        prepareCanonicalTemplate(this);
      } catch (error) {
        const message = `Unable to initialize ${this.pageKey.replaceAll('_', ' ')}: ${error.message}`;
        GUI.log(message);
        $('<div>')
          .addClass('fc-action-status fc-action-status--error fc-ap-inav-initialization-error')
          .attr({ role: 'alert', 'data-fc-ardupilot-page': this.pageKey })
          .text(message)
          .appendTo('#content');
        // Always release the shared tab-switch lock. A renderer defect should
        // remain isolated to this page rather than making every tab look hung.
        finishArduPilotTab(callback);
        return;
      }
      finishArduPilotTab(callback);
      void this.load(false);
    });
  };

  tab.setStatus = function (message, error = false) {
    this.status
      ?.text(message)
      .toggleClass('fc-action-status--error', Boolean(error));
  };

  tab.load = async function (force = false) {
    if (this.loading || this.writing) return;
    this.loading = true;
    this.updateControls();
    this.setStatus('Reading settings from the connected ArduPilot controller…');
    try {
      await loadArduPilotSetup({
        force,
        onProgress: ({ received, total }) => this.setStatus(
          `Reading controller settings: ${received} / ${total || '?'}`,
        ),
      });
      this.staged.clear();
      renderSchemaBindings(this);
      RENDERERS[this.pageKey]?.(this);
      renderParityContractGroups(this);
      describeReplacedInavControls(this);
      this.setStatus(
        'Ready. Every function from Flight Commander\'s own INAV-side tab remains represented here and is translated to the connected vehicle\'s ArduPilot parameters or equivalent workflow.',
      );
    } catch (error) {
      this.setStatus(error.message, true);
    } finally {
      this.loading = false;
      this.updateControls();
    }
  };

  tab.save = async function () {
    if (!this.staged.size || this.loading || this.writing) return;
    const changedIds = [...this.staged.keys()];
    if (!window.confirm(
      `Save ${changedIds.length} setting(s) to ArduPilot? Flight Commander will write and read back every translated parameter before reporting success.`,
    )) return;
    this.writing = true;
    this.updateControls();
    try {
      const rebootRequired = changedIds.some(
        (id) => parameterDefinition(id)?.metadata?.rebootRequired,
      );
      await writeArduPilotSetupChanges(this.staged, {
        onProgress: ({ index, total, id }) => this.setStatus(
          `Saving ${index + 1} / ${total}: ${id}`,
        ),
      });
      if (rebootRequired) {
        this.setStatus('Settings verified. Rebooting because one or more changes require restart…');
        await rebootArduPilotController();
        this.setStatus('Settings verified and reboot command sent. Reconnect when the controller returns.');
      } else {
        this.setStatus(`${changedIds.length} setting(s) saved and verified by the controller.`);
      }
    } catch (error) {
      this.setStatus(`${error.message} Unwritten changes remain staged.`, true);
    } finally {
      this.writing = false;
      this.updateControls();
    }
  };

  tab.updateControls = function () {
    if (!this.root) return;
    const busy = this.loading || this.writing;
    this.root.find('[data-ardupilot-parameter]').each((_index, element) => {
      $(element).prop(
        'disabled',
        busy || $(element).attr('data-ardupilot-read-only') === 'true',
      );
    });
    parameterSaveLinks(this)
      .toggleClass('disabled', busy || !this.staged.size)
      .attr('aria-disabled', String(busy || !this.staged.size));
  };

  tab.cleanup = function (callback) {
    this.beforeCleanup?.();
    this.beforeCleanup = null;
    this.stateUnsubscribe?.();
    this.stateUnsubscribe = null;
    this.map?.setTarget(undefined);
    this.map = null;
    if (callback) callback();
  };

  return tab;
}

export const ardupilotInavSetupTab = createCanonicalArduPilotPage('setup');
export const ardupilotInavPortsTab = createCanonicalArduPilotPage('ports');
export const ardupilotInavConfigurationTab = createCanonicalArduPilotPage('configuration');
export const ardupilotInavMixerTab = createCanonicalArduPilotPage('mixer');
export const ardupilotInavOutputsTab = createCanonicalArduPilotPage('outputs');
export const ardupilotInavReceiverTab = createCanonicalArduPilotPage('receiver');
export const ardupilotInavModesTab = createCanonicalArduPilotPage('modes');
export const ardupilotInavFailsafeTab = createCanonicalArduPilotPage('failsafe');
export const ardupilotInavPidTuningTab = createCanonicalArduPilotPage('pid_tuning');
export const ardupilotInavAdvancedTuningTab = createCanonicalArduPilotPage('advanced_tuning');
export const ardupilotInavAdjustmentsTab = createCanonicalArduPilotPage('adjustments');
export const ardupilotInavSensorsTab = createCanonicalArduPilotPage('sensors');
export const ardupilotInavCalibrationTab = createCanonicalArduPilotPage('calibration');
export const ardupilotInavMagnetometerTab = createCanonicalArduPilotPage('magnetometer');
export const ardupilotInavGpsTab = createCanonicalArduPilotPage('gps_navigation');
export const ardupilotInavOsdTab = createCanonicalArduPilotPage('osd');
export const ardupilotInavLedStripTab = createCanonicalArduPilotPage('led_strip');
export const ardupilotInavLoggingTab = createCanonicalArduPilotPage('logging');
export const ardupilotInavTetheredLoggingTab = createCanonicalArduPilotPage('tethered_logging');
export const ardupilotInavProgrammingTab = createCanonicalArduPilotPage('programming');
export const ardupilotInavJavascriptProgrammingTab = createCanonicalArduPilotPage('javascript_programming');
export const ardupilotInavCliTab = createCanonicalArduPilotPage('cli');
export const ardupilotInavSearchTab = createCanonicalArduPilotPage('search');

export { createCanonicalArduPilotPage };
