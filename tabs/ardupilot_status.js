'use strict';

import GUI from './../js/gui';
import {
  ardupilotGpsFixName,
  ardupilotRssiPercent,
  ardupilotSensorStatusRows,
  ardupilotSystemStatusName,
  formatArduPilotBootTime,
  recentArduPilotReadinessMessages,
} from './../js/ardupilot/statusModel';
import {
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  GROUND_CONTROL_UNIT_SYSTEMS,
  formatGroundControlValue,
  normalizeGroundControlUnitSystem,
} from './../js/gcs/groundControlUnits';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import store from './../js/store';
import {
  finishArduPilotTab,
  renderArduPilotTabIdentity,
  setArduPilotTabStatus,
} from './ardupilot_setup_common';

const STATUS_STREAMS = Object.freeze([
  Object.freeze({ id: 1, rate: 2, restoreRate: 1 }),
  Object.freeze({ id: 24, rate: 2, restoreRate: 1 }),
  Object.freeze({ id: 30, rate: 10, restoreRate: 5 }),
  Object.freeze({ id: 65, rate: 5, restoreRate: 5 }),
  Object.freeze({ id: 74, rate: 5, restoreRate: 5 }),
  Object.freeze({ id: 109, rate: 2, restoreRate: 1 }),
]);

const ardupilotStatus = {
  unsubscribeState: null,
  unitSystem: DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  headingOffset: 0,
  lastState: null,
};

function finite(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function format(value, decimals = 1, suffix = '') {
  const number = finite(value);
  return number == null ? '--' : `${number.toFixed(decimals)}${suffix}`;
}

function normalizeHeading(value) {
  const number = finite(value);
  if (number == null) return null;
  return ((number % 360) + 360) % 360;
}

ardupilotStatus.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import('./ardupilot_status.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.unitSystem = normalizeGroundControlUnitSystem(
        store.get(
          'flightCommanderGroundControlUnits',
          DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
        ),
      );
      this.headingOffset = 0;
      this.lastState = mavlinkSession.snapshot();
      renderArduPilotTabIdentity('apStatus');
      $('#apStatusRefreshStreams').on('click', () => this.requestStreams(true));
      $('#apStatusZeroHeading').on('click', () => {
        this.headingOffset = normalizeHeading(
          this.lastState?.heading ?? this.lastState?.yaw,
        ) ?? 0;
        this.render(this.lastState);
        setArduPilotTabStatus(
          '#apStatusActionStatus',
          'Displayed heading zeroed locally. No flight-controller setting was changed.',
        );
      });
      $('#apStatusUnits').on('change', (event) => {
        this.unitSystem = $(event.currentTarget).prop('checked')
          ? GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
          : GROUND_CONTROL_UNIT_SYSTEMS.METRIC;
        store.set('flightCommanderGroundControlUnits', this.unitSystem);
        this.render(this.lastState);
      });
      $(window).on('resize.ardupilotStatus', () => this.drawAttitude(this.lastState));
      this.unsubscribeState = mavlinkSession.on('state', (state) => this.render(state));
      this.render(this.lastState);
      this.requestStreams(false);
      finishArduPilotTab(callback);
    });
  });
};

ardupilotStatus.requestStreams = async function (announce) {
  const results = await Promise.allSettled(
    STATUS_STREAMS.map((stream) => (
      mavlinkSession.requestMessageInterval(stream.id, stream.rate)
    )),
  );
  const failed = results.filter((result) => result.status === 'rejected');
  if (announce || failed.length) {
    setArduPilotTabStatus(
      '#apStatusActionStatus',
      failed.length
        ? `${STATUS_STREAMS.length - failed.length} telemetry streams refreshed; ${failed.length} request(s) were rejected. Existing stream data remains visible.`
        : 'Live attitude, system, GPS, receiver, and power streams refreshed.',
      failed.length > 0,
    );
  }
};

ardupilotStatus.render = function (state = mavlinkSession.snapshot()) {
  this.lastState = state;
  renderArduPilotTabIdentity('apStatus');
  const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  $('#apStatusUnits')
    .prop('checked', imperial)
    .attr('aria-checked', String(imperial));

  const rawHeading = normalizeHeading(state.heading ?? state.yaw);
  const displayHeading = rawHeading == null
    ? null
    : normalizeHeading(rawHeading - this.headingOffset);
  $('#apStatusRoll').text(format(state.roll, 1, '°'));
  $('#apStatusPitch').text(format(state.pitch, 1, '°'));
  $('#apStatusHeading').text(
    displayHeading == null ? '--' : `${displayHeading.toFixed(0).padStart(3, '0')}°`,
  );
  $('#apStatusAttitudeFreshness').text(
    finite(state.roll) == null || finite(state.pitch) == null
      ? 'Waiting for ATTITUDE'
      : 'Live MAVLink attitude',
  );
  this.drawAttitude(state, displayHeading);

  $('#apStatusArmState')
    .text(state.armed ? 'ARMED' : 'DISARMED')
    .toggleClass('fc-ap-status-pill--danger', Boolean(state.armed))
    .toggleClass('fc-ap-status-pill--good', !state.armed);
  $('#apStatusMode').text(state.modeName || '--');
  $('#apStatusSystemState').text(ardupilotSystemStatusName(state.systemStatus));
  const linkLive = Boolean(state.connected && !state.linkLost);
  $('#apStatusLinkState')
    .text(linkLive ? 'LIVE' : state.linkLost ? 'LOST' : 'WAITING')
    .toggleClass('fc-ap-status-pill--good', linkLive)
    .toggleClass('fc-ap-status-pill--danger', Boolean(state.linkLost));

  $('#apStatusVoltage').text(format(state.voltage, 2, ' V'));
  $('#apStatusCurrent').text(format(state.current, 2, ' A'));
  const power = finite(state.voltage) == null || finite(state.current) == null
    ? null
    : Number(state.voltage) * Number(state.current);
  $('#apStatusPower').text(format(power, 1, ' W'));
  $('#apStatusBatteryRemaining').text(format(state.batteryRemaining, 0, '%'));

  $('#apStatusGpsFix').text(ardupilotGpsFixName(state.gpsFix));
  $('#apStatusSatellites').text(finite(state.satellites) == null ? '--' : String(state.satellites));
  $('#apStatusHdop').text(format(state.hdop, 2));
  $('#apStatusPosition').text(
    finite(state.latitude) == null || finite(state.longitude) == null
      ? '--'
      : `${Number(state.latitude).toFixed(6)}, ${Number(state.longitude).toFixed(6)}`,
  );
  $('#apStatusAltitude').text(formatGroundControlValue(
    state.relativeAltitude,
    'relativeAltitude',
    this.unitSystem,
  ));

  const rssi = ardupilotRssiPercent(state.rssi);
  $('#apStatusRssi').text(rssi == null ? '--' : `${rssi}%`);
  $('#apStatusChannelCount').text(
    `${(state.rcChannels ?? []).filter((value) => finite(value) != null).length} / ${state.rcChannelCount || '--'}`,
  );
  $('#apStatusGroundSpeed').text(formatGroundControlValue(
    state.groundSpeed,
    'groundSpeed',
    this.unitSystem,
  ));
  this.renderReceiverBars(state.rcChannels ?? []);

  $('#apStatusUptime').text(formatArduPilotBootTime(state.timeBootMs));
  $('#apStatusLoad').text(format(state.systemLoad, 1, '%'));
  $('#apStatusDropRate').text(format(state.communicationDropRate, 2, '%'));
  $('#apStatusCommErrors').text(
    finite(state.communicationErrors) == null ? '--' : String(state.communicationErrors),
  );
  $('#apStatusBootGeneration').text(String(state.bootGeneration ?? 0));
  this.renderSensors(state);
  this.renderMessages(state);
};

ardupilotStatus.renderReceiverBars = function (channels) {
  const container = $('#apStatusReceiverBars').empty();
  for (let index = 0; index < Math.min(8, channels.length); index += 1) {
    const pwm = finite(channels[index]);
    const percent = pwm == null
      ? 0
      : Math.max(0, Math.min(100, ((pwm - 800) / 1400) * 100));
    container.append(
      $('<div>')
        .append($('<span>').text(`CH${index + 1}`))
        .append($('<div>').addClass('fc-ap-status-receiver-track')
          .append($('<i>').css('width', `${percent}%`)))
        .append($('<strong>').text(pwm == null ? '--' : Math.round(pwm))),
    );
  }
  if (!container.children().length) {
    container.append($('<p>').addClass('fc-ap-muted').text('Waiting for RC_CHANNELS'));
  }
};

ardupilotStatus.renderSensors = function (state) {
  const rows = ardupilotSensorStatusRows(state);
  const container = $('#apStatusSensors').empty();
  for (const row of rows) {
    container.append(
      $('<article>')
        .addClass(`fc-ap-status-sensor fc-ap-status-sensor--${row.status}`)
        .append($('<strong>').text(row.label))
        .append($('<span>').text(row.statusLabel)),
    );
  }
  const active = rows.filter((row) => row.present).length;
  const unhealthy = rows.filter((row) => row.status === 'unhealthy').length;
  $('#apStatusSensorSummary').text(
    state.sensorsPresent == null
      ? 'Waiting for sensor health'
      : `${active} reported · ${unhealthy ? `${unhealthy} need attention` : 'all enabled sensors healthy'}`,
  );
};

ardupilotStatus.renderMessages = function (state) {
  const readiness = recentArduPilotReadinessMessages(state.statusText);
  const readinessList = $('#apStatusReadinessMessages').empty();
  if (readiness.length) {
    for (const entry of readiness) readinessList.append($('<li>').text(entry.text));
  } else {
    readinessList.append($('<li>').text(
      state.armed
        ? 'Vehicle is armed. Keep clear of motors and control surfaces.'
        : 'No recent pre-arm warning has been received. This is not a substitute for ArduPilot’s complete arming checks.',
    ));
  }

  const entries = [...(state.statusText ?? [])].slice(-12).reverse();
  const log = $('#apStatusMessages').empty();
  for (const entry of entries) {
    const time = new Date(entry.at).toLocaleTimeString();
    log.append(
      $('<div>')
        .addClass(`fc-ap-status-message fc-ap-status-message--severity-${entry.severity ?? 6}`)
        .append($('<time>').text(time))
        .append($('<span>').text(entry.text)),
    );
  }
  if (!entries.length) log.append($('<p>').addClass('fc-ap-muted').text('No STATUSTEXT messages received yet.'));
  $('#apStatusMessageCount').text(`${state.statusText?.length ?? 0} messages`);
};

ardupilotStatus.drawAttitude = function (state, heading = null) {
  const canvas = document.getElementById('apStatusAttitudeCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const roll = finite(state?.roll) ?? 0;
  const pitch = finite(state?.pitch) ?? 0;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const radius = Math.hypot(rect.width, rect.height);

  context.clearRect(0, 0, rect.width, rect.height);
  context.save();
  context.translate(centerX, centerY);
  context.rotate((-roll * Math.PI) / 180);
  context.translate(0, pitch * 3);
  context.fillStyle = dark ? '#234e6b' : '#77bce3';
  context.fillRect(-radius, -radius * 2, radius * 2, radius * 2);
  context.fillStyle = dark ? '#604b31' : '#8b6b42';
  context.fillRect(-radius, 0, radius * 2, radius * 2);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-radius, 0);
  context.lineTo(radius, 0);
  context.stroke();
  context.font = '10px sans-serif';
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  for (let degrees = -30; degrees <= 30; degrees += 10) {
    if (degrees === 0) continue;
    const y = -degrees * 3;
    const halfWidth = degrees % 20 === 0 ? 42 : 25;
    context.beginPath();
    context.moveTo(-halfWidth, y);
    context.lineTo(halfWidth, y);
    context.stroke();
    context.fillText(String(Math.abs(degrees)), halfWidth + 12, y + 3);
  }
  context.restore();

  context.strokeStyle = dark ? '#f6d365' : '#17232c';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(centerX - 55, centerY);
  context.lineTo(centerX - 12, centerY);
  context.lineTo(centerX, centerY + 10);
  context.lineTo(centerX + 12, centerY);
  context.lineTo(centerX + 55, centerY);
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, 4, 0, Math.PI * 2);
  context.fillStyle = dark ? '#f6d365' : '#17232c';
  context.fill();

  const displayHeading = heading ?? normalizeHeading(
    (state?.heading ?? state?.yaw) - this.headingOffset,
  );
  context.fillStyle = 'rgba(0, 0, 0, 0.55)';
  context.fillRect(centerX - 33, 8, 66, 24);
  context.fillStyle = '#ffffff';
  context.font = 'bold 13px monospace';
  context.textAlign = 'center';
  context.fillText(
    displayHeading == null ? '---°' : `${displayHeading.toFixed(0).padStart(3, '0')}°`,
    centerX,
    25,
  );
};

ardupilotStatus.cleanup = function (callback) {
  this.unsubscribeState?.();
  this.unsubscribeState = null;
  $(window).off('resize.ardupilotStatus');
  Promise.allSettled(
    STATUS_STREAMS.map((stream) => (
      mavlinkSession.requestMessageInterval(stream.id, stream.restoreRate)
    )),
  );
  if (callback) callback();
};

export default ardupilotStatus;
