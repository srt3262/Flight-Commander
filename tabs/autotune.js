'use strict';

import GUI from './../js/gui';
import { mavlinkCommandRouter } from './../js/gcs/mavlinkCommandRouterInstance';
import {
  AUTOTUNE_MODE_NAMES,
  autotuneModes,
  vehicleFamily,
} from './../js/mavlink/ardupilotModes';
import mavlinkSession from './../js/mavlink/mavlinkSession';

const autotune = {
  unsubscribeState: null,
  unsubscribeText: null,
  modeSignature: '',
};

autotune.initialize = function (callback) {
  if (GUI.active_tab !== this) {
    GUI.active_tab = this;
  }
  import('./autotune.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.bindControls();
      this.populateModes();
      this.unsubscribeState = mavlinkSession.on('state', (state) => this.render(state));
      this.unsubscribeText = mavlinkSession.on('statusText', (entry) => this.appendStatus(entry));
      this.render(mavlinkSession.snapshot());
      for (const entry of mavlinkSession.state.statusText.slice(-50)) {
        this.appendStatus(entry);
      }
      GUI.content_ready(callback);
    });
  });
};

autotune.populateModes = function (state = mavlinkSession.snapshot()) {
  const family = state.firmwareFamily;
  const routerModes = mavlinkCommandRouter.availableModes();
  const availableAutotuneModes = family === 'inav'
    ? routerModes.filter((name) => name === 'AUTO TUNE')
    : family === 'ardupilot'
      ? autotuneModes(state.vehicleType)
      : [];
  const guardAcknowledged = mavlinkCommandRouter.hasSingleInavAircraftAcknowledgement();
  const signature = `${family}:${state.vehicleType}:${guardAcknowledged}:${routerModes.join('|')}`;
  if (signature === this.modeSignature) return;
  this.modeSignature = signature;

  const autotuneSelect = $('#autotuneMode').empty();
  for (const name of availableAutotuneModes) {
    $('<option>').val(name).text(name).appendTo(autotuneSelect);
  }

  const exitSelect = $('#autotuneExitMode').empty();
  if (family === 'inav') {
    for (const name of routerModes) {
      if (name !== 'AUTO TUNE') {
        $('<option>').val(name).text(name).appendTo(exitSelect);
      }
    }
    const preferred = ['ANGLE', 'MANUAL', 'NAV POSHOLD']
      .find((name) => routerModes.includes(name));
    if (preferred) {
      exitSelect.val(preferred);
    }
  } else {
    for (const mode of mavlinkSession.availableModes()) {
      if (!AUTOTUNE_MODE_NAMES.has(mode.name)) {
        $('<option>').val(mode.name).text(mode.name).appendTo(exitSelect);
      }
    }
    const preferredExit = vehicleFamily(state.vehicleType) === 'plane'
      ? ['FLY_BY_WIRE_A', 'MANUAL']
      : ['LOITER', 'ALT_HOLD', 'STABILIZE'];
    const preferred = mavlinkSession.availableModes()
      .find(({ name }) => preferredExit.includes(name));
    if (preferred) {
      exitSelect.val(preferred.name);
    }
  }

  const capabilities = mavlinkCommandRouter.capabilities();
  $('#autotuneConfirmSingleInav')
    .toggle(family === 'inav')
    .prop('disabled', guardAcknowledged)
    .text(
      guardAcknowledged
        ? 'Single-aircraft INAV link confirmed'
        : 'Confirm exactly one INAV aircraft on this link',
    );
  const supported = availableAutotuneModes.length > 0 && capabilities.canSetMode;
  $('#autotuneStart').prop('disabled', !supported);
  $('#autotuneStop').prop('disabled', !capabilities.canSetMode || exitSelect.children().length === 0);
  if (!supported) {
    const reason = family === 'inav' && availableAutotuneModes.length
      ? capabilities.reason
      : family === 'inav'
        ? 'Configure an INAV AUTO TUNE AUX range over USB before using MAVLink Autotune.'
        : family === 'ardupilot'
          ? 'This ArduPilot vehicle family does not advertise an AUTOTUNE flight mode.'
          : 'Waiting for MAVLink firmware identification.';
    this.setStatus(reason, true);
  }
};

autotune.commandOutcome = function (result, modeName) {
  if (result?.confirmed === false) {
    return `${modeName} AUX request is being transmitted continuously. `
      + `${result.warning ?? 'INAV heartbeat cannot uniquely confirm this AUX-backed mode; verify the displayed mode and aircraft response.'}`;
  }
  return `${modeName} confirmed.`;
};

autotune.bindControls = function () {
  $('<button>')
    .attr({
      id: 'autotuneConfirmSingleInav',
      type: 'button',
    })
    .text('Confirm exactly one INAV aircraft on this link')
    .hide()
    .on('click', () => {
      try {
        mavlinkCommandRouter.acknowledgeSingleInavAircraft(true);
        this.modeSignature = '';
        this.populateModes();
        this.setStatus(
          'Single-aircraft INAV link confirmed for this connection. Stock INAV ignores target_system; do not share this MAVLink transport with another INAV aircraft.',
        );
      } catch (error) {
        this.setStatus(error.message, true);
      }
    })
    .insertBefore('#autotuneStart');

  $('#autotuneStart').on('click', async () => {
    const name = $('#autotuneMode').val();
    try {
      this.setStatus(`Commanding ${name}…`);
      const result = await mavlinkCommandRouter.setMode(name);
      this.setStatus(`${this.commandOutcome(result, name)} Live progress will appear below.`);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  });

  $('#autotuneStop').on('click', async () => {
    const mode = $('#autotuneExitMode').val();
    const name = $('#autotuneExitMode option:selected').text();
    try {
      this.setStatus(`Commanding ${name}…`);
      const result = await mavlinkCommandRouter.setMode(mode);
      this.setStatus(this.commandOutcome(result, name));
    } catch (error) {
      this.setStatus(error.message, true);
    }
  });
};

autotune.render = function (state) {
  this.populateModes(state);
  const firmwareName = state.firmwareFamily === 'inav'
    ? 'INAV'
    : state.firmwareFamily === 'ardupilot'
      ? 'ArduPilot'
      : state.autopilotName;
  $('#autotuneVehicle').text(`${firmwareName} ${state.vehicleTypeName}`);
  $('.fc-autotune-hero p').text(
    state.firmwareFamily === 'inav'
      ? 'Flight Commander asserts the configured INAV AUTO TUNE AUX mode through the connection-scoped MAVLink receiver stream.'
      : 'Flight Commander commands the connected ArduPilot vehicle’s native AUTOTUNE or QAUTOTUNE mode and reports autopilot messages live.',
  );
  $('#autotuneCurrentMode').text(state.modeName);
  $('#autotuneArmState')
    .text(state.armed ? 'ARMED' : 'DISARMED')
    .toggleClass('fc-pill--alert', state.armed);
};

autotune.appendStatus = function (entry) {
  const time = new Date(entry.at).toLocaleTimeString();
  $('<div>')
    .addClass(`fc-message fc-message--severity-${entry.severity}`)
    .text(`${time}  ${entry.text}`)
    .prependTo('#autotuneMessages');
  $('#autotuneMessages .fc-message').slice(150).remove();
};

autotune.setStatus = function (message, error = false) {
  $('#autotuneStatus')
    .text(message)
    .toggleClass('fc-action-status--error', error);
};

autotune.cleanup = function (callback) {
  this.unsubscribeState?.();
  this.unsubscribeState = null;
  this.unsubscribeText?.();
  this.unsubscribeText = null;
  this.modeSignature = '';
  if (callback) callback();
};

export default autotune;
