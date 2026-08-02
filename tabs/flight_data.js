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
import {
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  GROUND_CONTROL_UNIT_SYSTEMS,
  formatGroundControlValue,
  normalizeGroundControlUnitSystem,
} from './../js/gcs/groundControlUnits';
import { mavlinkCommandRouter } from './../js/gcs/mavlinkCommandRouterInstance';
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
  withAbortSignal,
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

const GPS_FIX_NAMES = {
  0: 'No GPS',
  1: 'No fix',
  2: '2D',
  3: '3D',
  4: 'DGPS',
  5: 'RTK float',
  6: 'RTK fixed',
  7: 'Static',
  8: 'PPP',
};

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

function format(value, decimals, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : '--';
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
};

flightData.suspendGlobalLog = function () {
  this.globalLogWasOpen = $('#content').hasClass('logopen');
  if (this.globalLogWasOpen) {
    $('#showlog').trigger('click');
    store.set('logopen', true);
  }
  this.globalLogGuard = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.querySelector('#showlog')?.addEventListener('click', this.globalLogGuard, true);
  $('#showlog')
    .prop('disabled', true)
    .addClass('fc-ground-control-locked')
    .attr('aria-disabled', 'true')
    .attr('title', 'The diagnostics log is collapsed while Ground Control is active.');
};

flightData.restoreGlobalLog = function () {
  const shouldRestore = this.globalLogWasOpen;
  this.globalLogWasOpen = false;
  document.querySelector('#showlog')?.removeEventListener('click', this.globalLogGuard, true);
  this.globalLogGuard = null;
  $('#showlog')
    .prop('disabled', false)
    .removeClass('fc-ground-control-locked')
    .removeAttr('aria-disabled')
    .removeAttr('title');
  if (shouldRestore && !$('#content').hasClass('logopen')) {
    $('#showlog').trigger('click');
  }
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
      GUI.content_ready(callback);
      setTimeout(() => this.map?.updateSize(), 0);
      this.loadVehicleMission();
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
  this.unitSystem = normalizeGroundControlUnitSystem(
    store.get(
      'flightCommanderGroundControlUnits',
      DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
    ),
  );
  const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  $('#flightDataUnits')
    .prop('checked', imperial)
    .attr('aria-checked', String(imperial));
};

flightData.applyUnitSystem = function (value, persist = true) {
  this.unitSystem = normalizeGroundControlUnitSystem(value);
  const imperial = this.unitSystem === GROUND_CONTROL_UNIT_SYSTEMS.IMPERIAL;
  $('#flightDataUnits')
    .prop('checked', imperial)
    .attr('aria-checked', String(imperial));
  if (persist) {
    store.set('flightCommanderGroundControlUnits', this.unitSystem);
  }
  this.hud?.setUnitSystem(this.unitSystem);
  this.render(this.currentState());
};

flightData.setupHud = function () {
  const loadToken = ++this.hudLoadToken;
  import('./flight_hud-v1.3.5.js')
    .then(({ createGroundControlHud }) => {
      if (loadToken !== this.hudLoadToken || GUI.active_tab !== this) return;
      this.hud?.destroy();
      this.hud = createGroundControlHud({
        getState: () => this.currentState(),
        onLayoutChange: () => this.map?.updateSize(),
        unitSystem: this.unitSystem,
      });
      this.hud.render(this.currentState());
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

  this.unsubscribeResume = missionResumeManager.subscribe((snapshot, context) => {
    this.renderResumeCheckpoint(snapshot);
    if (context.reason === 'checkpoint-captured') {
      this.appendLocalMessage(snapshot.message);
    }
  });

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
          + 'supported controls unlock after identification and safety checks.',
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
      'LTM provides live telemetry only. Reconnect through MAVLink to send INAV commands.',
    );
    this.appendLocalMessage('INAV LTM telemetry connected in read-only mode.');
    interval.add('flight-data-ltm-refresh', () => {
      this.render(normalizeLtmTelemetry(ltmDecoder.get(), ltmDecoder.isReceiving()));
    }, 200, true);
    return;
  }

  this.setCommandButtonsDisabled(true);
  $('#flightDataCommandCapability').text(
    'MSP is the wired INAV setup and persistent mission-storage link. '
    + 'Connect through MAVLink telemetry for airborne commands.',
  );
  this.appendLocalMessage('INAV/MSP wired setup link connected; airborne commands require MAVLink.');
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
  $('<button>')
    .attr({
      id: 'flightDataConfirmSingleInav',
      type: 'button',
      'aria-describedby': 'flightDataCommandCapability',
    })
    .text('Confirm exactly one INAV aircraft on this link')
    .hide()
    .on('click', () => {
      try {
        mavlinkCommandRouter.acknowledgeSingleInavAircraft(true);
        this.setActionStatus(
          'Single-aircraft INAV link confirmed for this connection. Do not connect another INAV aircraft to the same MAVLink transport.',
        );
        this.updateActionAvailability(this.currentState());
      } catch (error) {
        this.setActionStatus(error.message, true);
      }
    })
    .insertAfter('#flightDataCommandCapability');

  $('#flightDataSetMode').on('click', () => this.runVehicleAction(
    'Changing flight mode',
    () => mavlinkCommandRouter.setMode(String($('#flightDataMode').val())),
    'Flight mode change confirmed by the vehicle.',
    'The selected INAV AUX flight-mode request is now being transmitted continuously.',
  ));

  $('#flightDataArm').on('click', () => {
    const arm = !this.currentState().armed;
    return this.runVehicleAction(
      arm ? 'Sending arm command' : 'Sending disarm command',
      () => mavlinkCommandRouter.setArmed(arm),
      `${arm ? 'Armed' : 'Disarmed'} state confirmed by the vehicle.`,
      `${arm ? 'Arm' : 'Disarm'} AUX request is now being transmitted continuously.`,
    );
  });

  $('#flightDataStartMission').on('click', () => this.runVehicleAction(
    'Starting the stored mission',
    () => mavlinkCommandRouter.startMission(),
    'Mission start confirmed or accepted by the vehicle.',
    'The INAV NAV WP AUX request is now being transmitted continuously.',
  ));
  $('#flightDataTakeoff').on('click', () => this.runVehicleAction(
    'Sending takeoff / launch command',
    () => mavlinkCommandRouter.takeoff(Number($('#flightDataTakeoffAltitude').val())),
    'Takeoff / launch confirmed or accepted by the vehicle.',
    'The INAV NAV LAUNCH AUX request is now being transmitted continuously.',
  ));
  $('#flightDataRtl').on('click', () => this.runVehicleAction(
    'Commanding return to launch',
    () => mavlinkCommandRouter.returnToLaunch(),
    'Return-to-launch mode confirmed by the vehicle.',
    'The INAV NAV RTH AUX request is now being transmitted continuously.',
  ));
  $('#flightDataLand').on('click', () => this.runVehicleAction(
    'Commanding land',
    () => mavlinkCommandRouter.land(),
    'Landing mode confirmed by the vehicle.',
    'The landing request is now being transmitted continuously.',
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
        ? `${unconfirmedMessage ?? 'The INAV AUX request is being transmitted.'} ${result.warning ?? 'Verify the displayed mode and aircraft response.'}`
        : successMessage,
    );
  } catch (error) {
    this.setActionStatus(error.message, true);
  } finally {
    this.updateActionAvailability(this.currentState());
  }
};

flightData.setCommandButtonsDisabled = function (disabled) {
  $('#flightDataSetMode, #flightDataArm, #flightDataStartMission, #flightDataTakeoff, #flightDataRtl, #flightDataLand')
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
    const type = 'Estimated INAV checkpoint';
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
      ? 'Resuming mission…'
      : 'Resume mission from saved item')
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
      `INAV resume selection was confirmed from estimated original item ${result.originalSequence + 1}. `
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
  const isInavMavlink = this.protocol === 'mavlink' && state.firmwareFamily === 'inav';
  const guardAcknowledged = mavlinkCommandRouter.hasSingleInavAircraftAcknowledgement();
  $('#flightDataConfirmSingleInav')
    .toggle(isInavMavlink)
    .prop('disabled', guardAcknowledged)
    .text(
      guardAcknowledged
        ? 'Single-aircraft INAV link confirmed'
        : 'Confirm exactly one INAV aircraft on this link',
    );
  let capabilities;
  if (this.protocol === 'mavlink') {
    capabilities = linkReady
      ? mavlinkCommandRouter.capabilities()
      : {
        canArm: false,
        canSetMode: false,
        canStartMission: false,
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
      canTakeoff: false,
      canRtl: false,
      canLand: false,
      reason: 'MSP is the wired INAV setup and persistent mission-storage link. '
        + 'Connect through MAVLink telemetry for airborne commands.',
    };
  } else {
    capabilities = {
      canArm: false,
      canSetMode: false,
      canStartMission: false,
      canTakeoff: false,
      canRtl: false,
      canLand: false,
      reason: 'LTM provides live telemetry only. Reconnect through MAVLink to send INAV commands.',
    };
  }
  $('#flightDataMode, #flightDataSetMode').prop(
    'disabled',
    !linkReady || !capabilities.canSetMode,
  );
  $('#flightDataArm').prop('disabled', !linkReady || !capabilities.canArm);
  $('#flightDataTakeoff').prop('disabled', !linkReady || !capabilities.canTakeoff);
  $('#flightDataRtl').prop('disabled', !linkReady || !capabilities.canRtl);
  $('#flightDataLand').prop('disabled', !linkReady || !capabilities.canLand);
  $('#flightDataStartMission').prop(
    'disabled',
    !linkReady
      || !capabilities.canStartMission
      || !(Number(state.missionTotal) > 0 || this.mission.length > 0),
  );
  $('#flightDataCommandCapability').text(capabilities.reason);
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

flightData.render = function (state) {
  const protocolLabel = this.protocol === 'mavlink'
    ? state.firmwareFamily === 'inav'
      ? 'MAVLink · INAV'
      : state.firmwareFamily === 'unsupported'
        ? 'MAVLink · unsupported firmware'
        : 'MAVLink · detecting INAV-compatible firmware'
    : this.protocol === 'ltm'
      ? 'INAV / LTM'
      : 'INAV / MSP wired';
  $('#flightDataVehicle').text(
    state.connected
      ? `${state.firmwareFamily === 'inav' ? 'INAV' : 'Unsupported firmware'} · ${state.vehicleTypeName}`
      : 'Waiting for vehicle',
  );
  $('#flightDataProtocol').text(protocolLabel);
  $('#flightDataLink')
    .text(state.linkLost || !state.connected ? 'LINK LOST' : 'LINK')
    .toggleClass('fc-pill--alert', state.linkLost || !state.connected);
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
  $('#flightDataModeValue').text(state.modeName ?? '--');
  $('#flightDataAltitude').text(formatGroundControlValue(
    state.relativeAltitude,
    'relativeAltitude',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataGroundSpeed').text(formatGroundControlValue(
    state.groundSpeed,
    'groundSpeed',
    this.unitSystem,
    { decimals: 1 },
  ));
  $('#flightDataAirSpeed').text(formatGroundControlValue(
    state.airSpeed,
    'airSpeed',
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
    `${GPS_FIX_NAMES[state.gpsFix] ?? `Fix ${state.gpsFix}`} · ${Number.isFinite(state.satellites) ? state.satellites : '--'} sats`,
  );
  $('#flightDataBattery').text(
    `${format(state.voltage, 1, ' V')} · ${format(state.batteryRemaining, 0, '%')}`,
  );
  $('#flightDataRoll').text(format(state.roll, 1, '°'));
  $('#flightDataPitch').text(format(state.pitch, 1, '°'));
  $('#flightDataLatitude').text(format(state.latitude, 7));
  $('#flightDataLongitude').text(format(state.longitude, 7));
  this.hud?.render(state);
  let displayState = state;
  if (this.protocol === 'mavlink' && state.firmwareFamily === 'inav') {
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
      const state = mavlinkSession.state.firmwareFamily === 'unknown'
        ? await withAbortSignal(
          mavlinkSession.waitForFirmwareFamily(),
          abortController.signal,
        )
        : mavlinkSession.snapshot();
      if (!attachmentIsCurrent()) return;
      if (state.firmwareFamily !== 'inav') {
        throw new Error(
          state.firmwareFamily === 'unsupported'
            ? 'ArduPilot mission download has been removed. Connect an INAV-compatible controller.'
            : 'Mission download is waiting for INAV-compatible firmware identification.',
        );
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
  this.restoreGlobalLog();
  if (callback) callback();
};

export default flightData;
