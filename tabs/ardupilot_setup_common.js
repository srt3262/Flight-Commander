'use strict';

import GUI from './../js/gui';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import { ardupilotSetupService } from './../js/ardupilot/setupService';

export function sameParameterValue(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-7);
}

export function setArduPilotTabStatus(selector, message, error = false) {
  $(selector)
    .text(message)
    .toggleClass('fc-action-status--error', error);
}

export function renderArduPilotTabIdentity(prefix) {
  const state = mavlinkSession.snapshot();
  const version = state.autopilotVersion?.flight?.formatted;
  $(`#${prefix}Firmware`).text(
    `${state.autopilotName || 'ArduPilot'}${version ? ` ${version}` : ''}`,
  );
  $(`#${prefix}Vehicle`).text(state.vehicleTypeName || 'Unknown vehicle');
  $(`#${prefix}Endpoint`).text(
    state.systemId == null
      ? 'Waiting for vehicle'
      : `System ${state.systemId} · component ${state.componentId ?? 'unknown'}`,
  );
}

export function metadataSourceLabel(result) {
  if (!result) return 'metadata not loaded';
  if (result.source === 'official') return 'official ArduPilot metadata';
  if (result.source === 'cache') {
    return result.stale ? 'cached metadata (offline copy)' : 'cached official metadata';
  }
  return 'controller values with inferred labels';
}

export function parameterDefinition(id) {
  const view = ardupilotSetupService.view(id);
  return view
    ? Object.freeze({
        id: view.id,
        parameter: view,
        metadata: view.metadata,
      })
    : null;
}

export function humanizeArduPilotParameterId(id) {
  return String(id ?? '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\bRLL\b/g, 'roll')
    .replace(/\bPIT\b/g, 'pitch')
    .replace(/\bYAW\b/g, 'yaw')
    .replace(/\bMIN\b/g, 'minimum')
    .replace(/\bMAX\b/g, 'maximum')
    .replace(/\bTRIM\b/g, 'trim')
    .replace(/\bDZ\b/g, 'dead zone')
    .replace(/\bFF\b/g, 'feed-forward')
    .toLowerCase();
}

export function ardupilotParameterExplanation(definition, context = 'this feature') {
  const description = String(definition?.metadata?.description ?? '').trim();
  if (description) return description;
  const displayName = String(definition?.metadata?.displayName ?? '').trim();
  if (displayName && displayName !== definition?.id) {
    return `Controls ${displayName.toLowerCase()} for ${context}.`;
  }
  return `Controls the ${humanizeArduPilotParameterId(definition?.id)} setting for ${context}. Official metadata is unavailable, so verify this advanced value against the documentation for the installed firmware before changing it.`;
}

export function createArduPilotParameterEditor(definition, options = {}) {
  const { id, parameter, metadata } = definition;
  const value = options.value ?? parameter.value;
  const attributes = {
    'data-ardupilot-parameter': id,
    'data-ardupilot-read-only': metadata.readOnly ? 'true' : 'false',
    'aria-label': options.ariaLabel ?? metadata.displayName ?? id,
  };
  if (metadata.values?.length) {
    const select = $('<select>').attr(attributes);
    let matched = false;
    for (const choice of metadata.values) {
      const selected = sameParameterValue(choice.value, value);
      matched ||= selected;
      select.append(
        $('<option>')
          .val(choice.value)
          .prop('selected', selected)
          .text(choice.label),
      );
    }
    if (!matched) {
      select.prepend(
        $('<option>')
          .val(value)
          .prop('selected', true)
          .text(`${value}: controller value`),
      );
    }
    return select.prop('disabled', Boolean(metadata.readOnly));
  }
  const input = $('<input>').attr({
    ...attributes,
    type: 'number',
    step: metadata.increment ?? 'any',
  }).val(value);
  if (metadata.min != null) input.attr('min', metadata.min);
  if (metadata.max != null) input.attr('max', metadata.max);
  return input.prop('disabled', Boolean(metadata.readOnly));
}

export function setArduPilotEditorsBusy(selector, busy) {
  $(selector).each((_index, element) => {
    $(element).prop(
      'disabled',
      Boolean(busy) || $(element).attr('data-ardupilot-read-only') === 'true',
    );
  });
}

export function stageArduPilotParameter(staged, definition, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${definition.id} must contain a numeric value.`);
  }
  if (sameParameterValue(value, definition.parameter.value)) {
    staged.delete(definition.id);
  } else {
    staged.set(definition.id, value);
  }
  return value;
}

export async function loadArduPilotSetup({ force = false, onProgress } = {}) {
  return ardupilotSetupService.ensureLoaded({ force, onProgress });
}

export async function writeArduPilotSetupChanges(staged, options = {}) {
  try {
    const confirmations = await ardupilotSetupService.writeChanges(staged, options);
    staged.clear();
    return confirmations;
  } catch (error) {
    for (const id of error.confirmedParameterIds ?? []) staged.delete(id);
    throw error;
  }
}

export async function rebootArduPilotController() {
  return ardupilotSetupService.rebootAutopilot();
}

export function openArduPilotTab(tabName) {
  const link = $(`#tabs ul.mode-mavlink .tab_${tabName} a`).first();
  if (!link.length) throw new Error(`ArduPilot setup tab ${tabName} is unavailable.`);
  link.trigger('click');
}

export function bindArduPilotTabLinks(container = document) {
  $(container).on('click', '[data-open-ardupilot-tab]', (event) => {
    event.preventDefault();
    openArduPilotTab(String($(event.currentTarget).data('open-ardupilot-tab')));
  });
}

export function finishArduPilotTab(callback) {
  GUI.content_ready(callback);
}
