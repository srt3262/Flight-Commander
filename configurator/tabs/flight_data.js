'use strict';

import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Map from 'ol/Map.js';
import VectorLayer from 'ol/layer/Vector.js';
import { fromLonLat } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import Text from 'ol/style/Text.js';
import View from 'ol/View.js';

import CONFIGURATOR from './../js/data_storage';
import FC from './../js/fc';
import { estimateInavMissionProgress } from './../js/gcs/inavMissionProgress';
import { groundControlGpsFixStatus } from './../js/gcs/gpsFixStatus';
import {
  convertGroundControlValue,
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  GROUND_CONTROL_UNIT_SYSTEMS,
  formatGroundControlValue,
  groundControlDisplayToCanonicalValue,
  groundControlUnitLabel,
  normalizeGroundControlUnitSystem,
  resolveConfiguredUnitSystem,
} from './../js/gcs/groundControlUnits';
import { mavlinkCommandRouter } from './../js/gcs/mavlinkCommandRouterInstance';
import dialog from './../js/dialog';
import { globalSettings } from './../js/globalSettings';
import GUI from './../js/gui';
import interval from './../js/intervals';
import {
  MAP_STYLES,
  createBaseMapLayers,
  mapAttribution,
  normalizeMapStyle,
  setBaseMapStyle,
} from './../js/maps/baseMapLayers';
import {
  mavlinkMissionManager,
} from './../js/mavlink/services';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import { inavMissionAdapter } from './../js/mission/inavMissionAdapter';
import { missionOperationCoordinator } from './../js/mission/missionOperationCoordinator';
import { missionResumeManager } from './../js/mission/missionResumeManager';
import ltmDecoder from './../js/ltmDecoder';
import MSP from './../js/msp';
import MSPCodes from './../js/msp/MSPCodes';
import store from './../js/store';
import normalizeInavTelemetry from './../js/telemetry/inavTelemetry';
import normalizeLtmTelemetry from './../js/telemetry/ltmTelemetry';
import { primaryModeForDisplay } from './../js/telemetry/primaryFlightMode';
import rtkBasePanel from './rtk_base';

const MISSION_STATE_NAMES = {
  0: 'Unknown',
  1: 'No mission',
  2: 'Ready',
  3: 'Active',
  4: 'Paused',
  5: 'Complete',
};

const MAP_COMMANDS = new Set([16, 21, 22]);
const MSP_TELEMETRY_CODES = [
  MSPCodes.MSP_RAW_GPS,
  MSPCodes.MSP_COMP_GPS,
  MSPCodes.MSP_NAV_STATUS,
  MSPCodes.MSP_RC,
  MSPCodes.MSP_ATTITUDE,
  MSPCodes.MSP_ALTITUDE,
  MSPCodes.MSPV2_INAV_AIR_SPEED,
  MSPCodes.MSPV2_INAV_ANALOG,
  MSPCodes.MSPV2_INAV_STATUS,
  MSPCodes.MSP_ACTIVEBOXES,
];

function isSupportedMissionFamily(family) {
  void family;
  return true;
}

function format(value, decimals, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : '--';
}

function formatEditableNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(decimals).replace(/(?:\.0+|(\.\d*?)0+)$/, '$1');
}

function missionCoordinate(item) {
  const latitude = Number(item?.latitude ?? item?.lat);
  const longitude = Number(item?.longitude ?? item?.lon);
  if (!MAP_COMMANDS.has(Number(item?.command)) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (Number(item.command) === 20 || (latitude === 0 && longitude === 0)) {
    return null;
  }
  return fromLonLat([longitude, latitude]);
}

const flightData = {
  map: null,
  baseMapLayers: [],
  vehicleFeature: null,
  routeSource: null,
  activeLegSource: null,
  missionMarkerSource: null,
  unsubscribeState: null,
  unsubscribeText: null,
  unsubscribeDetached: null,
  unsubscribeResume: null,
  hasCentered: false,
  mission: [],
  lastRenderedMissionCurrent: null,
  protocol: null,
  mspPollCount: 0,
  modeSignature: '',
  estimatedMissionCurrent: null,
  hud: null,
  hudLoadToken: 0,
  initializeGeneration: 0,
  globalLogWasOpen: false,
  globalLogGuard: null,
  mavlinkWasConnected: false,
  mavlinkAttachmentGeneration: 0,
  mavlinkMissionAbortController: null,
  unitSystem: DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  takeoffAltitudeM: 10,
};

flightData.suspendGlobalLog = function () {
  // Ground Control must never hide the only live serial/MAVLink
  // diagnostic surface. Preserve the operator's current log state
  // and make the normal Show/Hide Log control available.
  if (this.globalLogGuard) {
    document.querySelector('#showlog')?.removeEventListener(
      'click',
      this.globalLogGuard,
      true,
    );
  }
  this.globalLogWasOpen = false;
  this.globalLogGuard = null;
  $('#showlog')
    .prop('disabled', false)
    .removeClass('fc-ground-control-locked')
    .removeAttr('aria-disabled')
    .removeAttr('title');
};

flightData.restoreGlobalLog = function () {
  this.suspendGlobalLog();
};

flightData.initialize = function (callback) {
  const initializeGeneration = ++this.initializeGeneration;
  const isCurrentInitialization = () => (
    initializeGeneration === this.initializeGeneration &&
    GUI.active_tab === this
  );
  if (GUI.active_tab !== this) {
    GUI.active_tab = this;
  }

  this.protocol = CONFIGURATOR.connectionProtocol;
  this.suspendGlobalLog();
  import('./flight_data.html?raw').then(({ default: html }) => {
    if (!isCurrentInitialization()) return;
    GUI.load(html, () => {
      if (!isCurrentInitialization()) return;
      this.loadStoredMapStyle();
      this.loadStoredUnitSystem();
      this.buildMap();
      this.bindControls();
      this.configureProtocol();
      this.setupHud();
      rtkBasePanel.mount('#flightDataRtkMount', {
        unitSystem: this.unitSystem,
      }).then(() => {
        if (!isCurrentInitialization()) return;
        GUI.content_ready(callback);
        setTimeout(() => this.map?.updateSize(), 0);
        this.loadVehicleMission();
      }).catch((error) => {
        if (!isCurrentInitialization()) return;
        $('#flightDataRtkMount')
          .empty()
          .append($('<div>')
            .addClass('rtk-base-error')
            .text(`RTK correction setup could not load: ${error?.message || error}`));
        GUI.content_ready(callback);
        setTimeout(() => this.map?.updateSize(), 0);
        this.loadVehicleMission();
      });
    });
  }).catch((error) => {
    if (!isCurrentInitialization()) return;
    const message = `Ground Control could not load: ${error?.message || error}`;
    this.restoreGlobalLog();
    GUI.log($('<div>').text(message).html());
    $('#content')
      .empty()
      .append(
        $('<div>')
          .addClass('tab-flight-data fc-ground-control-load-error')
          .append($('<h1>').text('Ground Control unavailable'))
          .append($('<p>').text(message))
          .append($('<p>').text('Disconnect and retry. The serial error remains available in the log.')),
      );
    GUI.content_ready(callback);
  });
};

flightData.loadStoredMapStyle = function () {
  $('#flightDataMapStyle').val(normalizeMapStyle(
    store.get('flightCommanderMapStyle', MAP_STYLES.HYBRID),
  ));
};

flightData.mapStyle = function () {
  return normalizeMapStyle($('#flightDataMapStyle').val() || MAP_STYLES.HYBRID);
};

flightData.applyMapStyle = function () {
  const selected = setBaseMapStyle(this.baseMapLayers, this.mapStyle());
  $('#flightDataMapStyle').val(selected);
  store.set('flightCommanderMapStyle', selected);
  $('#flightDataAttribution').text(mapAttribution(selected));
};

flightData.loadStoredUnitSystem = function () {
  const configuredUnitType = globalSettings.unitType ?? store.get(
    'unit_type',
    DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  );
  this.unitSystem = resolveConfiguredUnitSystem(
    configuredUnitType,
    globalSettings.osdUnits,
  );
  const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  $('#flightDataUnits')
    .prop('checked', imperial)
    .attr('aria-checked', String(imperial));
  this.renderTakeoffAltitudeInput();
};

flightData.applyUnitSystem = function (value, persist = true) {
  this.captureTakeoffAltitudeInput();
  this.unitSystem = normalizeGroundControlUnitSystem(value);
  const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  $('#flightDataUnits')
    .prop('checked', imperial)
    .attr('aria-checked', String(imperial));
  if (persist) {
    globalSettings.unitType = this.unitSystem;
    store.set('unit_type', this.unitSystem);
  }
  this.renderTakeoffAltitudeInput();
  rtkBasePanel.setUnitSystem(this.unitSystem);
  this.hud?.setUnitSystem(this.unitSystem);
  this.render(this.currentState());
};

flightData.captureTakeoffAltitudeInput = function () {
  const altitudeM = groundControlDisplayToCanonicalValue(
    $('#flightDataTakeoffAltitude').val(),
    'altitude',
    this.unitSystem,
  );
  if (Number.isFinite(altitudeM) && altitudeM > 0) {
    this.takeoffAltitudeM = altitudeM;
  }
  return altitudeM;
};

flightData.renderTakeoffAltitudeInput = function () {
  const displayAltitude = convertGroundControlValue(
    this.takeoffAltitudeM,
    'altitude',
    this.unitSystem,
  );
  const minimumAltitude = convertGroundControlValue(
    1,
    'altitude',
    this.unitSystem,
  );
  $('#flightDataTakeoffAltitude')
    .val(formatEditableNumber(displayAltitude, 3))
    .attr('min', formatEditableNumber(minimumAltitude, 3))
    .attr('step', '1');
  $('#flightDataTakeoffAltitudeUnit').text(
    groundControlUnitLabel('altitude', this.unitSystem),
  );
};

flightData.setupHud = function () {
  const loadToken = ++this.hudLoadToken;
  import('./flight_hud-v1.3.5.js')
    .then(({ createGroundControlHud }) => {
      if (loadToken !== this.hudLoadToken || GUI.active_tab !== this) return;
      this.hud?.destroy();
      this.hud = createGroundControlHud({
        getState: () => this.indicatedState(),
        onLayoutChange: () => this.map?.updateSize(),
        unitSystem: this.unitSystem,
      });
      this.hud.render(this.indicatedState());
    })
    .catch((error) => {
      if (loadToken !== this.hudLoadToken || GUI.active_tab !== this) return;
      this.setActionStatus('Live HUD could not start: ' + error.message, true);
    });
};

flightData.buildMap = function () {
  this.baseMapLayers = createBaseMapLayers(this.mapStyle());
  this.routeSource = new VectorSource();
  this.activeLegSource = new VectorSource();
  this.missionMarkerSource = new VectorSource();

  const vehicleSource = new VectorSource();
  this.vehicleFeature = new Feature();
  this.vehicleFeature.setStyle(new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: '#37a8db' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
    }),
  }));
  vehicleSource.addFeature(this.vehicleFeature);

  const markerLayer = new VectorLayer({
    source: this.missionMarkerSource,
    style: (feature) => {
      const active = Boolean(feature.get('active'));
      return new Style({
        image: new CircleStyle({
          radius: active ? 8 : 6,
          fill: new Fill({ color: active ? '#ffb020' : '#243847' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
        text: new Text({
          text: String(feature.get('sequence') ?? ''),
          offsetY: -15,
          fill: new Fill({ color: active ? '#8a4b00' : '#17232c' }),
          stroke: new Stroke({ color: '#fff', width: 3 }),
        }),
      });
    },
  });

  this.map = new Map({
    target: 'flightDataMap',
    layers: [
      ...this.baseMapLayers,
      new VectorLayer({
        source: this.routeSource,
        style: new Style({
          stroke: new Stroke({ color: '#48aede', width: 4 }),
        }),
      }),
      new VectorLayer({
        source: this.activeLegSource,
        style: new Style({
          stroke: new Stroke({ color: '#ffb020', width: 6 }),
        }),
      }),
      markerLayer,
      new VectorLayer({ source: vehicleSource }),
    ],
    view: new View({
      center: fromLonLat([-96, 38]),
      zoom: 4,
    }),
  });

  this.applyMapStyle();
};

flightData.configureProtocol = function () {
  this.unsubscribeState?.();
  this.unsubscribeState = null;
  this.unsubscribeText?.();
  this.unsubscribeText = null;
  this.unsubscribeDetached?.();
  this.unsubscribeDetached = null;
  this.unsubscribeResume?.();
  this.unsubscribeResume = null;
  this.invalidateMavlinkAttachment();
  $('.fc-command-deck').removeClass('is-hidden');

  this.unsubscribeResume = missionResumeManager.subscribe((snapshot, context) => {
    this.renderResumeCheckpoint(snapshot);
    if (context.reason === 'checkpoint-captured') {
      this.appendLocalMessage(snapshot.message);
    }
  });

  // The Ground Control tab opens as soon as a selected MAVLink transport is
  // ready, before the first vehicle heartbeat validates the connection. Keep
  // that tab subscribed so the heartbeat can promote its waiting UI to live
  // telemetry without forcing an operator tab change or reconnect.
  if (
    !this.protocol
    || (this.protocol !== 'mavlink' && !CONFIGURATOR.connectionValid)
  ) {
    this.setCommandButtonsDisabled(true);
    $('#flightDataCommandCapability').text(
      'Connect an aircraft to use vehicle commands. RTK base and NTRIP setup remain available offline.',
    );
    this.appendLocalMessage(
      'Offline setup mode. Scroll to RTK correction setup to configure NTRIP or survey a USB base with the aircraft powered off.',
    );
    this.render(this.currentState());
    return;
  }

  $('.fc-command-deck').removeClass('is-hidden');

  if (this.protocol === 'mavlink') {
    const initialState = mavlinkSession.snapshot();
    this.mavlinkWasConnected = Boolean(initialState.connected);
    this.unsubscribeDetached = mavlinkSession.on('detached', () => {
      this.mavlinkWasConnected = false;
      this.invalidateMavlinkAttachment();
    });
    this.populateModes(initialState);
    this.unsubscribeState = mavlinkSession.on('state', (state) => {
      const vehicleJustConnected = !this.mavlinkWasConnected && state.connected;
      this.mavlinkWasConnected = Boolean(state.connected);
      this.render(state);
      if (vehicleJustConnected) {
        this.appendLocalMessage(
          'MAVLink vehicle heartbeat received; live telemetry is active; '
          + 'Flight Commander controls are available after link and aircraft-profile safety checks.',
        );
        this.loadVehicleMission();
      }
    });
    this.unsubscribeText = mavlinkSession.on('statusText', (entry) => this.appendStatus(entry));
    this.render(initialState);
    for (const entry of mavlinkSession.state.statusText.slice(-25)) {
      this.appendStatus(entry);
    }
    if (initialState.connected) {
      mavlinkSession.requestDataStreams(5).catch((error) => this.setActionStatus(error.message, true));
    } else {
      this.appendLocalMessage(
        'MAVLink serial transport is open; waiting for the first vehicle heartbeat.',
      );
      this.setActionStatus(
        GUI.mavlinkWaitingMessage ||
          'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live.',
        Boolean(GUI.mavlinkWaitingMessage?.startsWith(
          'The MAVLink serial transport is open, but no vehicle heartbeat',
        )),
      );
    }
    return;
  }

  if (this.protocol === 'ltm') {
    this.setCommandButtonsDisabled(true);
    $('#flightDataCommandCapability').text(
      'LTM is telemetry-only. Reconnect through MAVLink for missions and Ground Control commands.',
    );
    this.appendLocalMessage('Flight Commander LTM telemetry-only link detected.');
    interval.add('flight-data-ltm-refresh', () => {
      this.render(normalizeLtmTelemetry(ltmDecoder.get(), ltmDecoder.isReceiving()));
    }, 200, true);
    return;
  }

  this.setCommandButtonsDisabled(true);
  $('#flightDataCommandCapability').text(
    'MSP is the wired Flight Commander setup and persistent mission-storage link. '
    + 'Connect through MAVLink telemetry for airborne commands.',
  );
  this.appendLocalMessage('Flight Commander MSP setup link connected; airborne commands require MAVLink.');
  MSP.send_message(MSPCodes.MSP_MODE_RANGES, false, false);
  interval.add('flight-data-msp-refresh', () => this.pollInavTelemetry(), 400, true);
  this.render(this.currentState());
};

flightData.invalidateMavlinkAttachment = function () {
  this.mavlinkAttachmentGeneration += 1;
  const controller = this.mavlinkMissionAbortController;
  this.mavlinkMissionAbortController = null;
  if (controller && !controller.signal.aborted) controller.abort();
};

flightData.populateModes = function (state = mavlinkSession.snapshot()) {
  if (this.protocol !== 'mavlink') return;
  const names = mavlinkCommandRouter.availableModes();
  const signature = `${state.firmwareFamily}:${names.join('|')}`;
  if (signature === this.modeSignature) return;
  this.modeSignature = signature;
  const select = $('#flightDataMode').empty();
  for (const name of names) {
    $('<option>').val(name).text(name).appendTo(select);
  }
  if (select.find(`option[value="${state.modeName}"]`).length) {
    select.val(state.modeName);
  }
};

flightData.pollInavTelemetry = function () {
  if (CONFIGURATOR.connectionProtocol !== 'msp' || !CONFIGURATOR.connectionValid) {
    return;
  }

  let pending = MSP_TELEMETRY_CODES.length;
  const complete = () => {
    pending -= 1;
    if (pending <= 0) {
      this.render(normalizeInavTelemetry({
        ...FC,
        connected: CONFIGURATOR.connectionValid,
      }));
    }
  };
  for (const code of MSP_TELEMETRY_CODES) {
    MSP.send_message(code, false, false, complete);
  }

  this.mspPollCount += 1;
  if (this.mspPollCount % 10 === 0) {
    MSP.send_message(MSPCodes.MSP_WP_GETINFO, false, false);
  }
};

flightData.bindControls = function () {
  $('#flightDataSetMode').on('click', () => this.runVehicleAction(
    'Changing flight mode',
    () => mavlinkCommandRouter.setMode(String($('#flightDataMode').val())),
    'Flight mode change confirmed by the vehicle.',
    'The native Flight Commander mode request was accepted. Verify the displayed vehicle mode.',
  ));

  $('#flightDataArm').on('click', () => {
    const arm = !this.currentState().armed;
    return this.runVehicleAction(
      arm ? 'Sending arm command' : 'Sending disarm command',
      () => mavlinkCommandRouter.setArmed(arm),
      `${arm ? 'Armed' : 'Disarmed'} state confirmed by the vehicle.`,
      `The native ${arm ? 'arm' : 'disarm'} request was accepted. Verify the displayed vehicle state.`,
    );
  });

  $('#flightDataStartMission').on('click', () => this.runVehicleAction(
    'Starting the stored mission',
    () => mavlinkCommandRouter.startMission(),
    'Mission start confirmed or accepted by the vehicle.',
    'The native mission-start request was accepted. Verify the displayed vehicle mode.',
  ));
  $('#flightDataAbortMission').on('click', () => this.abortActiveMission());
  $('#flightDataTakeoff').on('click', () => this.runVehicleAction(
    'Sending takeoff / launch command',
    () => {
      const altitudeM = this.captureTakeoffAltitudeInput();
      if (!Number.isFinite(altitudeM) || altitudeM <= 0) {
        throw new Error('Enter a takeoff altitude greater than zero.');
      }
      return mavlinkCommandRouter.takeoff(altitudeM);
    },
    'Takeoff / launch confirmed or accepted by the vehicle.',
    'The native takeoff / launch request was accepted. Verify the displayed vehicle mode.',
  ));
  $('#flightDataRtl').on('click', () => this.runVehicleAction(
    'Commanding return to launch',
    () => mavlinkCommandRouter.returnToLaunch(),
    'Return-to-launch mode confirmed by the vehicle.',
    'The native return-to-launch request was accepted. Verify the displayed vehicle mode.',
  ));
  $('#flightDataLand').on('click', () => this.runVehicleAction(
    'Commanding land',
    () => mavlinkCommandRouter.land(),
    'Landing mode confirmed by the vehicle.',
    'The native landing request was accepted. Verify the displayed vehicle mode.',
  ));
  $('#flightDataResumeMission').on('click', () => this.resumeInterruptedMission());
  $('#flightDataClearResume').on('click', () => {
    missionResumeManager.clearCheckpoint(
      'Mission resume checkpoint cleared by the operator.',
      { emitWhenEmpty: true },
    );
  });

  $('#flightDataCenter').on('click', () => this.centerVehicle(true));
  $('#flightDataMapStyle').on('change', () => this.applyMapStyle());
  $('#flightDataUnits').on('change', (event) => this.applyUnitSystem(
    event.currentTarget.checked
      ? GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL
      : GROUND_CONTROL_UNIT_SYSTEMS.METRIC,
  ));
};

flightData.abortActiveMission = async function () {
  if (this.protocol !== 'mavlink' || !CONFIGURATOR.connectionValid) {
    this.setActionStatus(
      'Mission abort requires a validated MAVLink telemetry connection.',
      true,
    );
    return;
  }
  const capabilities = mavlinkCommandRouter.capabilities();
  const safeMode = capabilities.missionAbortMode || 'a safe non-mission mode';
  const confirmed = await dialog.confirm(
    `Abort the active mission? Flight Commander will leave AUTO and command ${safeMode}. `
      + 'The stored mission will not be deleted.',
  );
  if (!confirmed) return;
  return this.runVehicleAction(
    'Aborting the active mission',
    () => mavlinkCommandRouter.abortMission(),
    `Mission abort confirmed; the aircraft entered ${safeMode}.`,
    `The native ${safeMode} request was accepted. Verify the displayed mode and aircraft response.`,
  );
};

flightData.runVehicleAction = async function (
  pendingMessage,
  action,
  successMessage,
  unconfirmedMessage,
) {
  if (
    this.protocol !== 'mavlink'
    || !CONFIGURATOR.connectionValid
  ) {
    this.setActionStatus(
      'Airborne vehicle commands require a validated MAVLink telemetry connection.',
      true,
    );
    return;
  }
  this.setCommandButtonsDisabled(true);
  this.setActionStatus(`${pendingMessage}…`);
  try {
    const result = await action();
    this.setActionStatus(
      result?.confirmed === false
        ? `${unconfirmedMessage ?? 'The native Flight Commander command was accepted.'} ${result.warning ?? 'Verify the displayed mode and aircraft response.'}`
        : successMessage,
    );
  } catch (error) {
    this.setActionStatus(error.message, true);
  } finally {
    this.updateActionAvailability(this.currentState());
  }
};

flightData.setCommandButtonsDisabled = function (disabled) {
  $('#flightDataSetMode, #flightDataArm, #flightDataStartMission, #flightDataAbortMission, #flightDataTakeoff, #flightDataRtl, #flightDataLand')
    .prop('disabled', disabled);
};

flightData.renderResumeCheckpoint = function (
  snapshot = missionResumeManager.snapshot(),
) {
  const checkpoint = snapshot.checkpoint;
  const mavlinkConnected = (
    this.protocol === 'mavlink'
    && CONFIGURATOR.connectionValid
  );
  const activeMissionOperation = missionOperationCoordinator.current();
  const operationBusy = Boolean(activeMissionOperation);
  if (!checkpoint) {
    $('#flightDataResumeStatus').text(
      snapshot.message || 'No interrupted mission checkpoint has been captured.',
    );
    $('#flightDataResumeDetail').text(
      mavlinkConnected
        ? 'Start the onboard mission from Ground Control. If AUTO changes to RTL/RTH before completion, Flight Commander will save the current item while the controller remains powered.'
        : 'Mission resume monitoring requires a MAVLink telemetry connection.',
    );
  } else {
    const total = Number(checkpoint.missionTotal)
      || Number(snapshot.registration?.itemCount)
      || 0;
    const type = 'Estimated navigation checkpoint';
    $('#flightDataResumeStatus').text(
      `${type}: item ${checkpoint.sequence + 1}${total ? ` / ${total}` : ''} saved when ${checkpoint.fromMode} changed to ${checkpoint.returnMode}.`,
    );
    $('#flightDataResumeDetail').text(
      snapshot.canResume
        ? 'Ready to resume on the same powered flight controller. Confirm the replacement battery and aircraft are ready before continuing.'
        : snapshot.unavailableReason,
    );
  }
  $('#flightDataResumeMission')
    .prop(
      'disabled',
      !mavlinkConnected || !snapshot.canResume || snapshot.resuming || operationBusy,
    )
    .text(snapshot.resuming
      ? 'Resuming Mission…'
      : 'Resume Mission')
    .attr(
      'title',
      operationBusy && !snapshot.resuming
        ? `Wait for ${activeMissionOperation.label} to finish.`
        : snapshot.canResume ? '' : snapshot.unavailableReason,
    );
  $('#flightDataClearResume')
    .prop('disabled', !checkpoint || snapshot.resuming || operationBusy);
};

flightData.resumeInterruptedMission = async function () {
  if (
    this.protocol !== 'mavlink'
    || !CONFIGURATOR.connectionValid
  ) {
    this.setActionStatus(
      'Mission resume requires a validated MAVLink telemetry connection to the same powered flight controller.',
      true,
    );
    return;
  }
  this.setActionStatus('Verifying the onboard mission and saved resume item…');
  try {
    const result = await missionResumeManager.resume();
    const registeredMission = missionResumeManager.registeredMission();
    if (registeredMission?.length) {
      this.mission = registeredMission;
      this.lastRenderedMissionCurrent = null;
      this.renderMissionRoute(this.currentState());
    }
    const executionNotice = result.executionPending
      ? ' The aircraft is disarmed; arm and launch it before the selected mission can execute.'
      : '';
    this.setActionStatus(
      `Flight Commander resume selection was confirmed from estimated original item ${result.originalSequence + 1}. `
      + 'The remaining suffix is active for this power cycle; the persistent MSP mission was not changed.'
      + executionNotice,
    );
  } catch (error) {
    this.setActionStatus(error.message, true);
  } finally {
    this.renderResumeCheckpoint();
  }
};

flightData.updateActionAvailability = function (state) {
  const linkReady = (
    CONFIGURATOR.connectionValid
    && state.connected
    && !state.linkLost
  );
  $('#flightDataConfirmSingleInav')
    .hide()
    .prop('disabled', true);
  let capabilities;
  if (this.protocol === 'mavlink') {
    capabilities = linkReady
      ? mavlinkCommandRouter.capabilities()
      : {
        canArm: false,
        canSetMode: false,
        canStartMission: false,
        canAbortMission: false,
        canTakeoff: false,
        canRtl: false,
        canLand: false,
        reason: 'Waiting for a command-capable MAVLink heartbeat.',
      };
  } else if (this.protocol === 'msp') {
    capabilities = {
      canArm: false,
      canSetMode: false,
      canStartMission: false,
      canAbortMission: false,
      canTakeoff: false,
      canRtl: false,
      canLand: false,
      reason: 'MSP is the wired Flight Commander setup and persistent mission-storage link. '
        + 'Connect through MAVLink telemetry for airborne commands.',
    };
  } else if (this.protocol === 'ltm') {
    capabilities = {
      canArm: false,
      canSetMode: false,
      canStartMission: false,
      canAbortMission: false,
      canTakeoff: false,
      canRtl: false,
      canLand: false,
      reason: 'LTM is telemetry-only. Reconnect through MAVLink for missions and Ground Control commands.',
    };
  } else {
    capabilities = {
      canArm: false,
      canSetMode: false,
      canStartMission: false,
      canAbortMission: false,
      canTakeoff: false,
      canRtl: false,
      canLand: false,
      reason: 'Connect an aircraft to use vehicle commands. RTK correction setup is available below while offline.',
    };
  }
  $('#flightDataMode, #flightDataSetMode').prop(
    'disabled',
    !linkReady || !capabilities.canSetMode,
  ).attr(
    'title',
    linkReady && capabilities.canSetMode ? '' : capabilities.reason,
  );
  $('#flightDataArm')
    .prop('disabled', !linkReady || !capabilities.canArm)
    .attr('title', linkReady && capabilities.canArm ? '' : capabilities.reason);
  $('#flightDataTakeoff').prop('disabled', !linkReady || !capabilities.canTakeoff);
  $('#flightDataTakeoffAltitude')
    .prop('disabled', !linkReady || !capabilities.canTakeoff)
    .attr('title', linkReady && capabilities.canTakeoff ? '' : capabilities.reason);
  $('#flightDataAbortMission').prop(
    'disabled',
    !linkReady || !capabilities.canAbortMission,
  );
  $('#flightDataRtl').prop('disabled', !linkReady || !capabilities.canRtl);
  $('#flightDataLand').prop('disabled', !linkReady || !capabilities.canLand);
  $('#flightDataStartMission').prop(
    'disabled',
    !linkReady
      || !capabilities.canStartMission
      || !(Number(state.missionTotal) > 0 || this.mission.length > 0),
  );
  $('#flightDataCommandCapability').text(capabilities.reason);
  const noMission = !(Number(state.missionTotal) > 0 || this.mission.length > 0);
  $('#flightDataStartMission').attr(
    'title',
    !linkReady || !capabilities.canStartMission
      ? capabilities.reason
      : noMission
        ? 'Load a mission before starting it.'
        : '',
  );
  $('#flightDataAbortMission').attr(
    'title',
    linkReady && capabilities.canAbortMission
      ? capabilities.missionAbortReason
      : capabilities.missionAbortReason || capabilities.reason,
  );
  $('#flightDataTakeoff').attr(
    'title',
    linkReady && capabilities.canTakeoff
      ? capabilities.takeoffReason || ''
      : capabilities.takeoffReason || capabilities.reason,
  );
  $('#flightDataRtl').attr(
    'title',
    linkReady && capabilities.canRtl
      ? capabilities.rtlReason || ''
      : capabilities.rtlReason || capabilities.reason,
  );
  $('#flightDataLand').attr(
    'title',
    linkReady && capabilities.canLand
      ? capabilities.landReason || ''
      : capabilities.landReason || capabilities.reason,
  );
};

flightData.currentState = function () {
  if (this.protocol === 'mavlink') {
    return mavlinkSession.snapshot();
  }
  if (this.protocol === 'ltm') {
    return normalizeLtmTelemetry(ltmDecoder.get(), ltmDecoder.isReceiving());
  }
  return normalizeInavTelemetry({
    ...FC,
    connected: CONFIGURATOR.connectionValid,
  });
};

flightData.indicatedState = function (state = this.currentState()) {
  return {
    ...state,
    modeName: primaryModeForDisplay(state, this.protocol) ?? '--',
  };
};

flightData.render = function (state) {
  const indicatedModeName = primaryModeForDisplay(state, this.protocol) ?? '--';
  const offline = !this.protocol || !CONFIGURATOR.connectionValid;
  const flightCommander = Boolean(state.connected);
  const protocolLabel = offline
    ? 'Offline RTK setup'
    : this.protocol === 'mavlink'
      ? 'MAVLink · Flight Commander'
      : this.protocol === 'ltm'
        ? 'Flight Commander · LTM telemetry-only'
        : 'Flight Commander MSP wired';
  $('#flightDataVehicle').text(
    offline
      ? 'Aircraft not connected · RTK setup available below'
      : state.connected
        ? `Flight Commander Firmware · ${state.vehicleTypeName}`
        : 'Waiting for vehicle',
  );
  $('#flightDataProtocol').text(protocolLabel);
  $('#flightDataLink')
    .text(offline ? 'OFFLINE' : state.linkLost || !state.connected ? 'LINK LOST' : 'LINK')
    .toggleClass('fc-pill--alert', !offline && (state.linkLost || !state.connected));
  $('#flightDataArmed')
    .text(state.armed ? 'ARMED' : 'DISARMED')
    .toggleClass('fc-pill--alert', state.armed);
  $('#flightDataArm').text(state.armed ? 'Disarm' : 'Arm');
  if (this.protocol === 'mavlink') {
    this.populateModes(state);
    if ($('#flightDataMode').find(`option[value="${state.modeName}"]`).length) {
      $('#flightDataMode').val(state.modeName);
    }
  } else {
    const modeName = state.modeName ?? 'ACRO';
    if (!$('#flightDataMode').find(`option[value="${modeName}"]`).length) {
      $('<option>').val(modeName).text(modeName).prependTo('#flightDataMode');
    }
    $('#flightDataMode').val(modeName);
  }
  $('#flightDataModeValue').text(indicatedModeName);
  $('#flightDataAltitude').text(formatGroundControlValue(
    state.relativeAltitude,
    'relativeAltitude',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataAltitudeMsl').text(formatGroundControlValue(
    state.altitudeMsl,
    'altitudeMsl',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataGroundSpeed').text(formatGroundControlValue(
    state.groundSpeed,
    'groundSpeed',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataHeading').text(format(state.heading, 0, '°'));
  $('#flightDataClimb').text(formatGroundControlValue(
    state.climbRate,
    'climbRate',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataGps').text(
    `${groundControlGpsFixStatus(state.gpsFix).label} · ${Number.isFinite(state.satellites) ? state.satellites : '--'} sats`,
  );
  $('#flightDataBattery').text(
    `${format(state.voltage, 1, ' V')} · ${format(state.batteryRemaining, 0, '%')}`,
  );
  $('#flightDataRoll').text(format(state.roll, 1, '°'));
  $('#flightDataPitch').text(format(state.pitch, 1, '°'));
  $('#flightDataLatitude').text(format(state.latitude, 7));
  $('#flightDataLongitude').text(format(state.longitude, 7));
  this.hud?.render({ ...state, modeName: indicatedModeName });
  let displayState = state;
  if (this.protocol === 'mavlink' && isSupportedMissionFamily(state.firmwareFamily)) {
    const estimate = estimateInavMissionProgress({
      mission: this.mission,
      latitude: state.latitude,
      longitude: state.longitude,
      modeName: state.modeName,
      previousIndex: this.estimatedMissionCurrent,
    });
    this.estimatedMissionCurrent = estimate.estimated ? estimate.missionCurrent : null;
    displayState = {
      ...state,
      ...estimate,
      missionProgressEstimated: estimate.estimated,
    };
    missionResumeManager.observeInavEstimatedProgress({
      ...state,
      mission: this.mission,
      estimated: estimate.estimated,
      missionCurrent: estimate.missionCurrent,
      missionTotal: estimate.missionTotal,
      source: 'ground-control-readback',
    });
  }
  this.renderMissionProgress(displayState);
  this.updateActionAvailability(displayState);
  this.renderResumeCheckpoint();

  if (
    Number(state.gpsFix) >= 2
    && Number.isFinite(state.latitude)
    && Number.isFinite(state.longitude)
  ) {
    this.vehicleFeature?.setGeometry(new Point(fromLonLat([state.longitude, state.latitude])));
    this.centerVehicle(false, state);
  }

  if (displayState.missionCurrent !== this.lastRenderedMissionCurrent) {
    this.lastRenderedMissionCurrent = displayState.missionCurrent;
    this.renderMissionRoute(displayState);
  }
};

flightData.renderMissionProgress = function (state) {
  const total = Number.isFinite(state.missionTotal)
    ? state.missionTotal
    : this.mission.length || 0;
  let missionState = MISSION_STATE_NAMES[state.missionState];
  if (!missionState) {
    missionState = state.missionActive ? 'Active' : total > 0 ? 'Loaded' : 'No mission';
  }
  if (state.missionProgressEstimated && missionState === 'Active') {
    missionState = 'Active (estimated)';
  }
  $('#flightDataMissionState').text(missionState);

  if (Number.isFinite(state.missionCurrent) && total > 0) {
    const current = Math.min(total, state.missionCurrent + 1);
    const percentage = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
    $('#flightDataMissionProgress').text(
      `${state.missionProgressEstimated ? 'Est. WP' : 'WP'} ${current} / ${total} · ${percentage}%`,
    );
  } else if (this.protocol === 'msp' && total > 0) {
    $('#flightDataMissionProgress').text(
      `${total} items · ${state.missionActive ? 'mission active' : 'ready'}`,
    );
  } else {
    $('#flightDataMissionProgress').text(total > 0 ? `${total} items loaded` : '--');
  }
  $('#flightDataWaypointDistance').text(formatGroundControlValue(
    state.distanceToWaypoint,
    'distanceToWaypoint',
    this.unitSystem,
    { decimals: 0 },
  ));
};

flightData.centerVehicle = function (force, state = this.currentState()) {
  const { latitude, longitude, gpsFix } = state;
  if (
    Number(gpsFix) < 2
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || (!force && this.hasCentered)
  ) {
    return;
  }
  this.hasCentered = true;
  this.map?.getView().animate({
    center: fromLonLat([longitude, latitude]),
    zoom: Math.max(this.map.getView().getZoom(), 16),
    duration: force ? 250 : 0,
  });
};

flightData.loadVehicleMission = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || !['msp', 'mavlink'].includes(this.protocol)
  ) {
    return;
  }
  const isMavlink = this.protocol === 'mavlink';
  const attachmentGeneration = this.mavlinkAttachmentGeneration;
  const abortController = isMavlink ? new AbortController() : null;
  const missionOperation = missionOperationCoordinator.acquire(
    'Ground Control mission download',
    { signal: abortController?.signal },
  );
  if (!missionOperation) {
    this.setActionStatus(
      missionOperationCoordinator.busyMessage('Ground Control mission download'),
      true,
    );
    return;
  }
  if (isMavlink) this.mavlinkMissionAbortController = abortController;
  const attachmentIsCurrent = () => (
    !isMavlink
    || (
      this.protocol === 'mavlink'
      && this.mavlinkAttachmentGeneration === attachmentGeneration
      && this.mavlinkMissionAbortController === abortController
      && !abortController.signal.aborted
    )
  );
  // Reflect the coordinator lease immediately; otherwise a resume button that
  // was already enabled can look available until the download finishes.
  this.renderResumeCheckpoint();
  try {
    this.setActionStatus('Reading the mission from the flight controller…');
    let mission;
    if (isMavlink) {
      const state = mavlinkSession.snapshot();
      if (!attachmentIsCurrent()) return;
      if (!state.connected || state.linkLost) {
        throw new Error('Mission download requires an active Flight Commander MAVLink connection.');
      }
      mission = await mavlinkMissionManager.download(
        {
          legacyOnly: true,
          signal: abortController.signal,
        },
      );
    } else {
      mission = await inavMissionAdapter.download();
    }
    if (!attachmentIsCurrent()) return;
    this.mission = mission;
    if (isMavlink) {
      mavlinkSession.state.missionTotal = this.mission.length;
    }
    if (isMavlink) {
      if (this.mission.length) {
        missionResumeManager.registerMission(this.mission, {
          source: 'ground-control-readback',
        });
      } else {
        missionResumeManager.clearRegisteredMission(
          'The connected flight controller has no onboard mission to resume.',
        );
      }
    }
    const state = this.currentState();
    this.renderMissionRoute(state);
    this.renderMissionProgress(state);
    this.updateActionAvailability(state);
    this.setActionStatus(`${this.mission.length} mission items loaded from the flight controller.`);
  } catch (error) {
    if (isMavlink && (error.name === 'AbortError' || !attachmentIsCurrent())) {
      return;
    }
    this.setActionStatus(`Live telemetry is active; mission route could not be read: ${error.message}`, true);
  } finally {
    const shouldRenderResume = attachmentIsCurrent();
    missionOperation.release();
    if (this.mavlinkMissionAbortController === abortController) {
      this.mavlinkMissionAbortController = null;
    }
    if (shouldRenderResume) this.renderResumeCheckpoint();
  }
};

flightData.renderMissionRoute = function (state = this.currentState()) {
  this.routeSource?.clear();
  this.activeLegSource?.clear();
  this.missionMarkerSource?.clear();
  const coordinates = [];
  const missionIndexes = [];

  this.mission.forEach((item, index) => {
    const coordinate = missionCoordinate(item);
    if (!coordinate) return;
    coordinates.push(coordinate);
    missionIndexes.push(index);
    const feature = new Feature(new Point(coordinate));
    feature.set('sequence', index + 1);
    feature.set('active', index === state.missionCurrent);
    this.missionMarkerSource?.addFeature(feature);
  });

  if (coordinates.length > 1) {
    this.routeSource?.addFeature(new Feature(new LineString(coordinates)));
  }

  const activePosition = missionIndexes.indexOf(state.missionCurrent);
  if (activePosition > 0) {
    this.activeLegSource?.addFeature(new Feature(new LineString([
      coordinates[activePosition - 1],
      coordinates[activePosition],
    ])));
  }
};

flightData.appendStatus = function (entry) {
  const time = new Date(entry.at).toLocaleTimeString();
  $('<div>')
    .addClass(`fc-message fc-message--severity-${entry.severity}`)
    .text(`${time}  ${entry.text}`)
    .prependTo('#flightDataMessages');
  $('#flightDataMessages .fc-message').slice(100).remove();
};

flightData.appendLocalMessage = function (message) {
  this.appendStatus({ severity: 6, text: message, at: Date.now() });
};

flightData.setActionStatus = function (message, isError = false) {
  $('#flightDataActionStatus')
    .text(message)
    .toggleClass('fc-action-status--error', isError);
};

flightData.cleanup = function (callback) {
  this.initializeGeneration += 1;
  this.unsubscribeState?.();
  this.unsubscribeState = null;
  this.unsubscribeText?.();
  this.unsubscribeText = null;
  this.unsubscribeDetached?.();
  this.unsubscribeDetached = null;
  this.unsubscribeResume?.();
  this.unsubscribeResume = null;
  this.invalidateMavlinkAttachment();
  this.hud?.destroy();
  this.hud = null;
  this.hudLoadToken += 1;
  rtkBasePanel.cleanup();
  interval.remove('flight-data-msp-refresh');
  interval.remove('flight-data-ltm-refresh');
  this.map?.setTarget(undefined);
  this.map = null;
  this.baseMapLayers = [];
  this.vehicleFeature = null;
  this.routeSource = null;
  this.activeLegSource = null;
  this.missionMarkerSource = null;
  this.hasCentered = false;
  this.mission = [];
  this.lastRenderedMissionCurrent = null;
  this.protocol = null;
  this.mspPollCount = 0;
  this.modeSignature = '';
  this.estimatedMissionCurrent = null;
  this.mavlinkWasConnected = false;
  this.unitSystem = DEFAULT_GROUND_CONTROL_UNIT_SYSTEM;
  this.takeoffAltitudeM = 10;
  this.restoreGlobalLog();
  if (callback) callback();
};

export default flightData;
