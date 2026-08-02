'use strict';

import Feature from 'ol/Feature.js';
import Map from 'ol/Map.js';
import LineString from 'ol/geom/LineString.js';
import Circle from 'ol/geom/Circle.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import VectorLayer from 'ol/layer/Vector.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import Text from 'ol/style/Text.js';
import View from 'ol/View.js';

import CONFIGURATOR from './../js/data_storage';
import FC from './../js/fc';
import { globalSettings } from './../js/globalSettings';
import {
  FLIGHT_COMMANDER_CAPABILITIES,
  firmwareFeatureSupport,
} from './../js/flightCommander/firmwareIdentity';
import GUI from './../js/gui';
import mspHelper from './../js/msp/MSPHelper';
import {
  MAP_STYLES,
  createBaseMapLayers,
  mapAttribution,
  normalizeMapStyle,
  setBaseMapStyle,
} from './../js/maps/baseMapLayers';
import { selectMavlinkMapPosition } from './../js/maps/mapPosition';
import {
  DEFAULT_ELEVATION_SOURCE,
  GisPointElevationProvider,
  GoogleElevationProvider,
  OpenTopoDataElevationProvider,
  applyTerrainFollowing,
  isTerrainWaypoint,
  localDistance,
} from './../js/mission/elevationProviders';
import {
  parseFlightPlan,
  serializeFlightPlan,
  serializeQgcWpl,
} from './../js/mission/flightPlanFiles';
import {
  callMspHelper,
  inavPlanningAdapter,
} from './../js/mission/inavPlanningAdapter';
import {
  GEOZONE_ACTIONS,
  GEOZONE_SHAPES,
  GEOZONE_TYPES,
  INAV_MAX_GEOZONES,
  INAV_MAX_GEOZONE_VERTICES,
  INAV_MAX_MISSION_APPROACHES,
  INAV_MAX_SAFEHOMES,
  approachIsConfigured,
  collectGeozoneErrors,
  collectSafehomeAndApproachErrors,
  createEmptyInavPlanningData,
  geozoneVertexUsage,
  hasInavPlanningData,
  missionSegmentCount,
  normalizeInavPlanningData,
} from './../js/mission/inavPlanningModel';
import {
  DEFAULT_MISSION_BEHAVIOR,
  INAV_SPEED_M_S_MAX,
  compileInavMavlinkMission,
  compileInavMspMission,
  normalizeMissionBehavior,
} from './../js/mission/missionBehavior';
import { inavMissionAdapter } from './../js/mission/inavMissionAdapter';
import { deriveInavMissionBehavior } from './../js/mission/inavMissionBehavior';
import {
  INAV_MSP_COMMAND_NAMES,
  MAV_CMD_NAV_LAND,
  MAV_CMD_NAV_LOITER_TIME,
  MAV_CMD_NAV_LOITER_UNLIM,
  hasInavMissionMetadata,
  reindexInavMissionItems,
} from './../js/mission/inavMissionCodec';
import {
  INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED,
} from './../js/mission/inavMissionModel';
import {
  assertMissionReadback,
  filterExpectedMissionForProtocol,
} from './../js/mission/missionVerification';
import {
  assertSurveyCameraCommandsCompatible,
  assertTerrainMissionCompatible,
} from './../js/mission/flightCommanderMissionPolicy';
import { missionOperationCoordinator } from './../js/mission/missionOperationCoordinator';
import { missionResumeManager } from './../js/mission/missionResumeManager';
import {
  insertMissionItem,
  removeMissionItem,
} from './../js/mission/missionTopology';
import {
  MAV_CMD_DO_SET_CAM_TRIGG_DIST,
  MAV_CMD_NAV_WAYPOINT,
  generateSurveyGrid,
  normalizeCoordinate,
  surveyGridToMission,
} from './../js/mission/surveyGrid';
import { mavlinkMissionManager } from './../js/mavlink/services';
import mavlinkSession from './../js/mavlink/mavlinkSession';
import ltmDecoder from './../js/ltmDecoder';
import store from './../js/store';
import dialog from './../js/dialog';
import { calculate_new_cooridatnes } from './../js/helpers';
import {
  distanceFromPlannerDisplay,
  distanceToPlannerDisplay,
  formatPlannerArea,
  formatPlannerDistance,
  plannerUnitLabels,
  resolvePlannerUnitSystem,
  speedFromPlannerDisplay,
  speedToPlannerDisplay,
} from './../js/mission/plannerUnits';

const NAVIGATION_COMMANDS = new Set([
  MAV_CMD_NAV_WAYPOINT,
  MAV_CMD_NAV_LOITER_UNLIM,
  MAV_CMD_NAV_LOITER_TIME,
  MAV_CMD_NAV_LAND,
  22,
]);
const COMMAND_NAMES = {
  ...INAV_MSP_COMMAND_NAMES,
  20: 'RTL',
  22: 'TAKEOFF',
};
const INAV_MISSION_RESTART_SETTING = 'nav_wp_mission_restart';
const INAV_MISSION_RESTART_ENUM = Object.freeze([
  { value: 0, name: 'START', detail: 'restart from the first waypoint' },
  { value: 1, name: 'RESUME', detail: 'continue from the last active waypoint' },
  { value: 2, name: 'SWITCH', detail: 'alternate START and RESUME' },
]);
const SURVEY_CAMERA_MODES = Object.freeze({
  AUTO: 'auto',
  FLIGHT_COMMANDER: 'flight-commander',
  NAVIGATION_ONLY: 'navigation-only',
});
const PLANNER_DEFAULTS_SI = Object.freeze({
  angleDeg: 0,
  lineSpacingM: 25,
  altitudeM: 60,
  overshootM: 5,
  turnaroundM: 10,
  triggerDistanceM: 0,
  cruiseSpeedMps: 0,
  clearanceM: 60,
  terrainSampleSpacingM: 30,
});
const PLANNER_DISTANCE_FIELDS = new Set([
  'lineSpacingM',
  'altitudeM',
  'overshootM',
  'turnaroundM',
  'triggerDistanceM',
  'clearanceM',
  'terrainSampleSpacingM',
]);

function normalizeSurveyCameraMode(value) {
  return Object.values(SURVEY_CAMERA_MODES).includes(value)
    ? value
    : SURVEY_CAMERA_MODES.AUTO;
}

function missionTargetForConnection(protocol, firmwareFamily) {
  if (protocol === 'msp') {
    return FC.CONFIG?.firmwareIdentity?.family === 'flight-commander'
      ? 'flight-commander'
      : 'inav';
  }
  if (protocol === 'ltm') return 'unknown';
  if (protocol !== 'mavlink') return 'unknown';
  const family = String(firmwareFamily ?? '').toLowerCase();
  return ['flight-commander', 'inav'].includes(family) ? family : 'unknown';
}

function connectedFlightCommanderFeature(featureKey) {
  const protocol = CONFIGURATOR.connectionProtocol;
  if (protocol === 'msp') {
    return firmwareFeatureSupport(FC.CONFIG?.firmwareIdentity, featureKey).enabled;
  }
  if (protocol !== 'mavlink' || mavlinkSession.state.firmwareFamily !== 'flight-commander') {
    return false;
  }
  const capability = FLIGHT_COMMANDER_CAPABILITIES[
    featureKey === 'photoTriggers' ? 'PHOTO_TRIGGERS' : 'TERRAIN_WAYPOINTS'
  ];
  const mask = Number(mavlinkSession.state.flightCommanderCapabilities ?? 0) >>> 0;
  return (mask & capability) === capability;
}

function resolveSurveyCameraPolicy({
  mode = SURVEY_CAMERA_MODES.AUTO,
  protocol = null,
  firmwareFamily = null,
  triggerDistanceM = 0,
  photoTriggersSupported = false,
} = {}) {
  const normalizedMode = normalizeSurveyCameraMode(mode);
  const target = missionTargetForConnection(protocol, firmwareFamily);
  const hasPhotoSpacing = Number.isFinite(Number(triggerDistanceM))
    && Number(triggerDistanceM) > 0;

  if (!hasPhotoSpacing) {
    return {
      mode: normalizedMode,
      target,
      includeCameraCommands: false,
      incompatible: false,
      notice: '',
    };
  }

  if (normalizedMode === SURVEY_CAMERA_MODES.NAVIGATION_ONLY) {
    return {
      mode: normalizedMode,
      target,
      includeCameraCommands: false,
      incompatible: false,
      notice: 'Navigation-only survey: photo spacing is used for the estimate, but no camera command is inserted.',
    };
  }

  if (normalizedMode === SURVEY_CAMERA_MODES.FLIGHT_COMMANDER) {
    if (target === 'inav') {
      return {
        mode: normalizedMode,
        target,
        includeCameraCommands: false,
        incompatible: true,
        notice: 'Official INAV does not support Flight Commander camera-trigger missions. Select Navigation only or connect Flight Commander Firmware.',
      };
    }
    if (target === 'flight-commander' && !photoTriggersSupported) {
      return {
        mode: normalizedMode,
        target,
        includeCameraCommands: false,
        incompatible: true,
        notice: 'The connected Flight Commander Firmware does not advertise MAVLink photo triggers.',
      };
    }
    return {
      mode: normalizedMode,
      target,
      includeCameraCommands: true,
      incompatible: false,
      notice: target === 'flight-commander'
        ? 'Flight Commander MAVLink photo triggering is enabled for mission command 206.'
        : 'Offline Flight Commander photo plan: command 206 will be verified against firmware capability before upload.',
    };
  }

  if (target === 'flight-commander' && photoTriggersSupported) {
    return {
      mode: normalizedMode,
      target,
      includeCameraCommands: true,
      incompatible: false,
      notice: 'Flight Commander MAVLink photo triggering is enabled; mission command 206 will trigger compatible cameras or companions.',
    };
  }

  if (target === 'inav' || target === 'flight-commander') {
    return {
      mode: normalizedMode,
      target,
      includeCameraCommands: false,
      incompatible: false,
      notice: target === 'inav'
        ? 'Official INAV is navigation-only in Flight Commander; photo spacing estimates images but no shutter command is sent.'
        : 'The connected Flight Commander Firmware does not advertise photo triggers; photo spacing estimates images only.',
    };
  }

  return {
    mode: normalizedMode,
    target,
    includeCameraCommands: false,
    incompatible: false,
    notice: 'Automatic camera target: no supported controller is identified, so this survey is navigation only.',
  };
}

const flightPlanner = {
  map: null,
  polygonSource: null,
  routeSource: null,
  markerSource: null,
  inavPlanningSource: null,
  baseMapLayers: [],
  drawInteraction: null,
  polygon: null,
  grid: null,
  mission: [],
  gisProvider: null,
  openTopoProvider: null,
  terrainAttribution: '',
  mavlinkStateUnsubscribe: null,
  resumeStateUnsubscribe: null,
  inavPlanning: createEmptyInavPlanningData(),
  fwApproachLengthCm: 0,
  inavMissionRestartLoaded: false,
  inavMissionRestartBusy: false,
  missionBehaviorWarnings: [],
};

function numberValue(selector) {
  return Number($(selector).val());
}

function currentPlannerUnitSystem() {
  return resolvePlannerUnitSystem(globalSettings.unitType, globalSettings.osdUnits);
}

function isCoordinateItem(item) {
  const latitude = Number(item.latitude ?? item.lat);
  const longitude = Number(item.longitude ?? item.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || item.command === 20) {
    return false;
  }
  return item.command === MAV_CMD_NAV_WAYPOINT || latitude !== 0 || longitude !== 0;
}

function planningNumberInput(className, value, attributes = {}) {
  return $('<input>').addClass(className).attr({
    type: 'number',
    ...attributes,
  }).val(value);
}

function planningCheckbox(className, checked) {
  return $('<input>').addClass(className).attr({ type: 'checkbox' }).prop('checked', checked);
}

function planningSelect(className, value, options) {
  const select = $('<select>').addClass(className);
  for (const [optionValue, label] of options) {
    $('<option>').val(optionValue).text(label).appendTo(select);
  }
  return select.val(String(value));
}

function planningField(grid, label, control) {
  $('<label>').text(label).append(control).appendTo(grid);
}

flightPlanner.initialize = function (callback) {
  if (GUI.active_tab !== this) {
    GUI.active_tab = this;
  }
  this.inavMissionRestartLoaded = false;
  this.inavMissionRestartBusy = false;
  this.missionBehaviorWarnings = [];
  import('./flight_planner.html?raw').then(({ default: html }) => {
    GUI.load(html, () => {
      this.updateUnitUi();
      this.loadStoredSettings();
      this.buildMap();
      this.bindControls();
      this.resumeStateUnsubscribe = missionResumeManager.subscribe((snapshot) => {
        this.renderResumeCheckpoint(snapshot);
        this.updateVehicleTransferState();
      });
      if (CONFIGURATOR.connectionProtocol === 'mavlink') {
        this.mavlinkStateUnsubscribe = mavlinkSession.on('state', () => {
          this.updateVehicleTransferState();
        });
      }
      this.restorePolygonLayer();
      this.renderMission();
      GUI.content_ready(callback);
      setTimeout(() => this.map?.updateSize(), 0);
    });
  });
};

flightPlanner.updateUnitUi = function () {
  const unitSystem = currentPlannerUnitSystem();
  const labels = plannerUnitLabels(unitSystem);
  $('.planner-distance-unit').text(labels.distance);
  $('.planner-speed-unit').text(labels.speed);
  $('#plannerTriggerDistance').attr({
    max: distanceToPlannerDisplay(327.67, unitSystem).toFixed(2),
    step: unitSystem === 'imperial' ? '0.1' : '0.01',
  });
  $('#plannerSpacing').attr('min', distanceToPlannerDisplay(0.1, unitSystem).toFixed(2));
  $('#plannerTerrainSpacing').attr('min', distanceToPlannerDisplay(1, unitSystem).toFixed(2));
  $('#plannerCruiseSpeed').attr({
    max: speedToPlannerDisplay(INAV_SPEED_M_S_MAX, unitSystem).toFixed(2),
    step: '0.1',
  });
};

flightPlanner.buildMap = function () {
  this.polygonSource = new VectorSource();
  this.routeSource = new VectorSource();
  this.markerSource = new VectorSource();
  this.inavPlanningSource = new VectorSource();
  this.baseMapLayers = createBaseMapLayers(this.mapStyle());

  const polygonLayer = new VectorLayer({
    source: this.polygonSource,
    style: new Style({
      fill: new Fill({ color: 'rgba(55, 168, 219, 0.18)' }),
      stroke: new Stroke({ color: '#2489b6', width: 3 }),
    }),
  });
  const routeLayer = new VectorLayer({
    source: this.routeSource,
    style: new Style({
      stroke: new Stroke({ color: '#1f78a7', width: 3 }),
    }),
  });
  const markerLayer = new VectorLayer({
    source: this.markerSource,
    style: (feature) => new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: '#243847' }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
      text: new Text({
        text: String(feature.get('sequence') ?? ''),
        offsetY: -16,
        fill: new Fill({ color: '#17232c' }),
        stroke: new Stroke({ color: '#fff', width: 3 }),
      }),
    }),
  });
  const inavPlanningLayer = new VectorLayer({
    source: this.inavPlanningSource,
    style: (feature) => this.inavPlanningFeatureStyle(feature),
  });

  const position = this.vehiclePosition();
  const center = position
    ? fromLonLat([position.longitude, position.latitude])
    : fromLonLat([-96, 38]);
  const zoom = position ? 16 : 4;

  this.map = new Map({
    target: 'flightPlannerMap',
    layers: [
      ...this.baseMapLayers,
      polygonLayer,
      inavPlanningLayer,
      routeLayer,
      markerLayer,
    ],
    view: new View({ center, zoom }),
  });

  const polygonModify = new Modify({ source: this.polygonSource });
  polygonModify.on('modifyend', () => {
    this.readPolygonLayer();
    this.setStatus('Survey polygon updated. Generate the grid to apply the change.');
  });
  this.map.addInteraction(polygonModify);

  const markerModify = new Modify({ source: this.markerSource });
  markerModify.on('modifyend', () => {
    for (const feature of this.markerSource.getFeatures()) {
      const index = feature.get('missionIndex');
      const coordinate = toLonLat(feature.getGeometry().getCoordinates());
      if (this.mission[index]) {
        this.mission[index].longitude = coordinate[0];
        this.mission[index].latitude = coordinate[1];
      }
    }
    this.renderMission();
    this.setStatus('Mission waypoint positions updated.');
  });
  this.map.addInteraction(markerModify);
  this.updateMapAttribution();
};

flightPlanner.bindControls = function () {
  $('#plannerDrawPolygon').on('click', () => this.startPolygonDraw());
  $('#plannerClearPolygon').on('click', () => {
    this.polygon = null;
    this.grid = null;
    this.polygonSource.clear();
    this.renderSummary();
    this.setStatus('Survey polygon cleared.');
  });
  $('#plannerAddWaypoint').on('click', () => this.addWaypoint());
  $('#plannerGenerate').on('click', () => this.generateGrid());
  $('#plannerApplyTerrain').on('click', () => this.applyTerrain());
  $('#plannerLoadGis').on('click', () => this.loadGis());
  $('#plannerElevationSource').on('change', () => this.updateElevationControls());
  $('#plannerGoogleKey').on('change', () => {
    store.set('googleElevationApiKey', $('#plannerGoogleKey').val());
  });
  $('#plannerUpload').on('click', () => this.upload());
  $('#plannerDownload').on('click', () => this.download());
  $('#plannerClearVehicle').on('click', () => this.clearVehicleMission());
  $('#plannerResumeMission').on('click', () => this.resumeMissionFromCheckpoint());
  $('#plannerClearResume').on('click', () => {
    missionResumeManager.clearCheckpoint(
      'Mission resume checkpoint cleared by the operator.',
      { emitWhenEmpty: true },
    );
  });
  $('#plannerReadInavPlanning').on('click', () => this.readInavPlanningData());
  $('#plannerWriteSafehomes').on('click', () => this.writeSafehomesAndApproaches());
  $('#plannerReadInavMissionRestart').on('click', () => this.readInavMissionRestartPolicy());
  $('#plannerWriteInavMissionRestart').on('click', () => this.writeInavMissionRestartPolicy());
  $('#plannerInavMissionRestart').on('change', () => {
    if (this.inavMissionRestartLoaded) {
      this.setInavMissionRestartStatus(
        'Policy changed locally. Save it to INAV to make the selection persistent.',
      );
    }
  });
  $('#plannerWriteGeozones').on('click', () => this.writeGeozones());
  $('#plannerAddSafehome').on('click', () => this.addSafehome());
  $('#plannerAddCircularGeozone').on('click', () => this.addGeozone(GEOZONE_SHAPES.CIRCULAR));
  $('#plannerAddPolygonGeozone').on('click', () => this.addGeozone(GEOZONE_SHAPES.POLYGON));
  $('#plannerSave').on('click', () => this.savePlan());
  $('#plannerOpen').on('click', () => this.openPlan());
  $('#plannerMapStyle').on('change', () => this.applyMapStyle());
  $('.fc-form-grid input, .fc-form-grid select').on('change', () => this.storeSettings());
  $('#plannerCameraCommandMode, #plannerTriggerDistance')
    .on('change', () => this.updateSurveyCameraAvailability());
  $('#plannerCruiseSpeed, #plannerCompletionAction')
    .on('change', () => this.updateMissionBehaviorAvailability());

  $('#plannerMissionRows').on('change', 'input[data-mission-field]', (event) => {
    const input = $(event.currentTarget);
    const index = Number(input.data('mission-index'));
    const field = input.data('mission-field');
    const rawValue = Number(input.val());
    const value = field === 'altitude'
      ? distanceFromPlannerDisplay(rawValue, currentPlannerUnitSystem())
      : rawValue;
    if (this.mission[index] && Number.isFinite(value)) {
      this.mission[index][field] = value;
      this.renderMission();
      this.setStatus(`Mission item ${index + 1} updated.`);
    }
  });
  $('#plannerMissionRows').on('click', 'button[data-delete-mission]', (event) => {
    const index = Number($(event.currentTarget).data('delete-mission'));
    try {
      const inavMission = hasInavMissionMetadata(this.mission);
      if (inavMission) {
        const segmentIndex = Number(
          this.mission[index]?.metadata?.inavMultiMissionIndex,
        );
        const segmentItemCount = this.mission.filter((item) => (
          Number(item?.metadata?.inavMultiMissionIndex) === segmentIndex
        )).length;
        const configuredApproachAtOrAfterSegment = (
          this.inavPlanning?.approaches ?? []
        ).slice(INAV_MAX_SAFEHOMES + segmentIndex).some(approachIsConfigured);
        if (
          Number.isInteger(segmentIndex)
          && segmentItemCount === 1
          && configuredApproachAtOrAfterSegment
        ) {
          throw new Error(
            `Mission ${segmentIndex + 1} or a later mission has a configured landing approach. `
            + 'Clear or move those approaches before deleting this mission’s final item so '
            + 'approach slots cannot shift to the wrong mission.',
          );
        }
      } else if (
        this.mission.length === 1
        && (this.inavPlanning?.approaches ?? [])
          .slice(INAV_MAX_SAFEHOMES)
          .some(approachIsConfigured)
      ) {
        throw new Error(
          'One or more INAV mission landing approaches are configured. Clear or move those '
          + 'approaches before deleting the final mission item.',
        );
      }
      this.mission = inavMission
        ? reindexInavMissionItems(
          this.mission.filter((_, itemIndex) => itemIndex !== index),
        )
        : removeMissionItem(this.mission, index);
      this.grid = null;
      this.rederiveMissionBehaviorAfterTopologyEdit();
      this.renderMission();
      this.setStatus(`Mission item ${index + 1} removed.`);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  });
  $('#plannerSafehomeList').on('change', 'input, select', (event) => {
    this.captureSafehomeCard($(event.currentTarget).closest('[data-safehome-index]'));
  });
  $('#plannerSafehomeList').on('click', '[data-delete-safehome]', (event) => {
    this.deleteSafehome(Number($(event.currentTarget).data('delete-safehome')));
  });
  $('#plannerMissionApproachRows').on('change', 'input, select', (event) => {
    this.captureMissionApproachRow($(event.currentTarget).closest('[data-mission-approach-index]'));
  });
  $('#plannerGeozoneList').on('change', 'input, select, textarea', (event) => {
    this.captureGeozoneCard(
      $(event.currentTarget).closest('[data-geozone-index]'),
      $(event.currentTarget).data('geozone-field') === 'shape',
    );
  });
  $('#plannerGeozoneList').on('click', '[data-delete-geozone]', (event) => {
    this.deleteGeozone(Number($(event.currentTarget).data('delete-geozone')));
  });

  this.updateElevationControls();
  this.updateVehicleTransferState();
  this.renderInavPlanning();
  if (this.hasWiredInavSetupLink()) {
    void this.readInavMissionRestartPolicy({ quiet: true });
  }
};

flightPlanner.mapStyle = function () {
  return normalizeMapStyle($('#plannerMapStyle').val() || MAP_STYLES.HYBRID);
};

flightPlanner.applyMapStyle = function () {
  const selected = setBaseMapStyle(this.baseMapLayers, this.mapStyle());
  $('#plannerMapStyle').val(selected);
  store.set('flightCommanderMapStyle', selected);
  this.updateMapAttribution();
};

flightPlanner.updateMapAttribution = function () {
  const parts = [mapAttribution(this.mapStyle())];
  if (this.terrainAttribution) parts.push(this.terrainAttribution);
  $('#plannerMapAttribution').text(parts.join(' · '));
};

flightPlanner.vehiclePosition = function () {
  if (CONFIGURATOR.connectionProtocol === 'mavlink') {
    return selectMavlinkMapPosition(mavlinkSession.state);
  }
  if (CONFIGURATOR.connectionProtocol === 'ltm') {
    const telemetry = ltmDecoder.get();
    return telemetry.gpsFix >= 2
      && Number.isFinite(telemetry.latitude)
      && Number.isFinite(telemetry.longitude)
      ? {
        latitude: telemetry.latitude / 1e7,
        longitude: telemetry.longitude / 1e7,
      }
      : null;
  }
  if (
    CONFIGURATOR.connectionProtocol === 'msp'
    && FC.GPS_DATA?.fix >= 2
    && Number.isFinite(FC.GPS_DATA.lat)
    && Number.isFinite(FC.GPS_DATA.lon)
  ) {
    return {
      latitude: FC.GPS_DATA.lat / 1e7,
      longitude: FC.GPS_DATA.lon / 1e7,
    };
  }
  return null;
};

flightPlanner.updateVehicleTransferState = function () {
  const connected = Boolean(
    CONFIGURATOR.connectionValid
    && ['msp', 'mavlink'].includes(CONFIGURATOR.connectionProtocol),
  );
  const telemetryOnly = CONFIGURATOR.connectionProtocol === 'ltm';
  const isMavlink = CONFIGURATOR.connectionProtocol === 'mavlink';
  const firmwareFamily = isMavlink ? mavlinkSession.state.firmwareFamily : null;
  const firmwareReady = !isMavlink
    || ['inav', 'flight-commander'].includes(firmwareFamily);
  const inavMavlink = isMavlink && firmwareFamily === 'inav';
  const flightCommanderMavlink = isMavlink && firmwareFamily === 'flight-commander';
  const missionOperationBusy = missionOperationCoordinator.isBusy();
  const vehicleName = isMavlink
    ? `${flightCommanderMavlink ? 'Flight Commander' : inavMavlink ? 'Official INAV' : mavlinkSession.state.autopilotName} ${mavlinkSession.state.vehicleTypeName}`
    : FC.CONFIG?.firmwareIdentity?.family === 'flight-commander'
      ? 'Flight Commander Firmware'
      : FC.CONFIG?.name || FC.CONFIG?.flightControllerIdentifier || 'Official INAV';

  $('#plannerVehicleStatus').text(connected
    ? firmwareReady
      ? `Connected: ${vehicleName}`
      : 'Connected: detecting MAVLink firmware'
    : telemetryOnly ? 'Connected: INAV LTM telemetry' : 'Offline planning');
  $('#plannerVehicleStatusDetail').text(connected
    ? CONFIGURATOR.connectionProtocol === 'msp'
      ? `${FC.CONFIG?.firmwareIdentity?.family === 'flight-commander' ? 'Flight Commander' : 'Official INAV'} / MSP wired · persistent mission read/write; empty erase is unsupported · ${this.mission.length} planned mission items`
      : inavMavlink
        ? `MAVLink · Official INAV active mission is retained only for this power cycle · ${this.mission.length} planned mission items`
        : flightCommanderMavlink
          ? `MAVLink · Flight Commander active mission is retained only for this power cycle · ${this.mission.length} planned mission items`
        : firmwareFamily === 'unsupported'
          ? 'Unsupported MAVLink firmware. Mission transfer is disabled.'
          : 'MAVLink is connected; mission controls will unlock after Flight Commander or Official INAV detection.'
    : telemetryOnly
      ? 'LTM is read-only. Reconnect through MAVLink for active missions and commands.'
      : 'Connect a flight controller to transfer this mission.');

  $('#plannerUpload').text((inavMavlink || flightCommanderMavlink)
    ? 'Write active mission (current power cycle)'
    : 'Write & save mission to flight controller');
  $('#plannerClearVehicle').text((inavMavlink || flightCommanderMavlink)
    ? 'Clear active mission (current power cycle)'
    : CONFIGURATOR.connectionProtocol === 'msp'
      ? 'Stored-mission erase limitation'
      : 'Erase mission from flight controller');
  $('#plannerDownload').prop(
    'disabled',
    !connected || !firmwareReady || missionOperationBusy,
  );
  $('#plannerUpload').prop(
    'disabled',
    !connected || !firmwareReady || !this.mission.length || missionOperationBusy,
  );
  $('#plannerClearVehicle')
    .prop('disabled', !connected || !firmwareReady || missionOperationBusy)
    .attr(
      'title',
      inavMavlink || flightCommanderMavlink
        ? 'Clear and verify the active RAM mission for this power cycle; persistent storage is unchanged'
        : CONFIGURATOR.connectionProtocol === 'msp'
          ? 'Stock INAV cannot save an empty mission to persistent storage; select this for details'
          : 'Erase and verify the mission stored on the connected flight controller',
    );
  this.updateMissionBehaviorAvailability();
  this.updateSurveyCameraAvailability();
  this.updateInavPlanningAvailability();
};

flightPlanner.updateSurveyCameraAvailability = function () {
  const protocol = CONFIGURATOR.connectionProtocol;
  const firmwareFamily = protocol === 'mavlink'
    ? mavlinkSession.state.firmwareFamily
    : null;
  const policy = resolveSurveyCameraPolicy({
    mode: $('#plannerCameraCommandMode').val(),
    protocol,
    firmwareFamily,
    triggerDistanceM: this.settings().triggerDistanceM,
    photoTriggersSupported: connectedFlightCommanderFeature('photoTriggers'),
  });
  const connectedTarget = missionTargetForConnection(protocol, firmwareFamily);
  const incompatibleCameraItems = (
    connectedTarget === 'inav'
    || (
      connectedTarget === 'flight-commander'
      && !connectedFlightCommanderFeature('photoTriggers')
    )
  )
    ? this.mission
      .map((item, index) => (
        Number(item?.command) === MAV_CMD_DO_SET_CAM_TRIGG_DIST ? index + 1 : null
      ))
      .filter(Number.isInteger)
    : [];
  const existingPlanWarning = incompatibleCameraItems.length
    ? `Current plan still contains removed camera command 206 at mission item`
      + `${incompatibleCameraItems.length === 1 ? '' : 's'} ${incompatibleCameraItems.join(', ')}. `
      + 'It cannot be written to the connected firmware. Select Automatic or Navigation only and regenerate the survey.'
    : '';
  $('#plannerCameraCommandHelp')
    .text(
      existingPlanWarning
      || policy.notice
      || 'Set Photo spacing above zero to estimate images and enable the selected camera-command policy.',
    )
    .toggleClass(
      'fc-action-status--error',
      policy.incompatible || incompatibleCameraItems.length > 0,
    );
};

flightPlanner.updateInavPlanningAvailability = function () {
  const wiredInav = this.hasWiredInavSetupLink();
  const geozoneEnabled = wiredInav && FC.isFeatureEnabled('GEOZONE');

  $('#plannerReadInavPlanning, #plannerWriteSafehomes').prop('disabled', !wiredInav);
  $('#plannerWriteGeozones')
    .prop('disabled', !geozoneEnabled)
    .attr(
      'title',
      geozoneEnabled
        ? 'Write all geozones, verify controller readback, save to EEPROM, and reboot INAV'
        : 'Requires a wired INAV/MSP connection with the GEOZONE feature enabled',
    );

  const message = wiredInav
    ? geozoneEnabled
      ? 'Wired INAV/MSP connected. Safe homes, all 17 landing-approach slots, and geozones can be read and saved.'
      : 'Wired INAV/MSP connected. Safe homes and landing approaches are available; GEOZONE is disabled in this INAV configuration.'
    : 'Offline editing is available. Controller transfer requires the wired INAV/MSP setup link; MAVLink telemetry does not expose these INAV configuration records.';
  $('#plannerInavPlanningAvailability').text(message);
  this.updateInavMissionRestartAvailability();
};

flightPlanner.hasWiredInavSetupLink = function () {
  return Boolean(
    CONFIGURATOR.connectionValid
    && CONFIGURATOR.connectionProtocol === 'msp',
  );
};

flightPlanner.updateInavMissionRestartAvailability = function () {
  const wiredInav = this.hasWiredInavSetupLink();
  const canEdit = wiredInav
    && this.inavMissionRestartLoaded
    && !this.inavMissionRestartBusy;

  $('#plannerInavMissionRestart').prop('disabled', !canEdit);
  $('#plannerReadInavMissionRestart').prop(
    'disabled',
    !wiredInav || this.inavMissionRestartBusy,
  );
  $('#plannerWriteInavMissionRestart').prop('disabled', !canEdit);

  if (!wiredInav) {
    this.inavMissionRestartLoaded = false;
    this.setInavMissionRestartStatus(
      'Connect through the wired INAV/MSP setup link to read this controller setting.',
    );
  }
};

flightPlanner.setInavMissionRestartStatus = function (message, error = false) {
  $('#plannerInavMissionRestartStatus')
    .text(message)
    .toggleClass('fc-action-status--error', error);
};

flightPlanner.validateInavMissionRestartSetting = function (result) {
  if (!result?.setting || !Number.isInteger(Number(result.value))) {
    throw new Error(
      'The connected controller does not expose nav_wp_mission_restart through INAV/MSP.',
    );
  }
  const setting = result.setting;
  const values = setting.table?.values;
  const nativeValuesMatch = INAV_MISSION_RESTART_ENUM.every(
    ({ value, name }) => String(values?.[value] ?? '').toUpperCase() === name,
  );
  if (
    Number(setting.min) !== 0
    || Number(setting.max) !== 2
    || !nativeValuesMatch
  ) {
    throw new Error(
      'The connected firmware returned an unsupported nav_wp_mission_restart enum. '
      + 'No value was changed.',
    );
  }
  const value = Number(result.value);
  if (!INAV_MISSION_RESTART_ENUM.some((entry) => entry.value === value)) {
    throw new Error(
      `INAV returned invalid nav_wp_mission_restart value ${result.value}. No value was changed.`,
    );
  }
  return {
    value,
    options: INAV_MISSION_RESTART_ENUM.map((entry) => ({
      ...entry,
      name: String(values[entry.value]),
    })),
  };
};

flightPlanner.renderInavMissionRestartSetting = function (setting) {
  const select = $('#plannerInavMissionRestart').empty();
  for (const option of setting.options) {
    $('<option>')
      .val(option.value)
      .text(`${option.name} — ${option.detail}`)
      .appendTo(select);
  }
  select.val(String(setting.value));
};

flightPlanner.readInavMissionRestartPolicy = async function (options = {}) {
  if (!this.hasWiredInavSetupLink()) {
    this.inavMissionRestartLoaded = false;
    this.updateInavMissionRestartAvailability();
    if (!options.quiet) {
      this.setInavMissionRestartStatus(
        'Connect through the wired INAV/MSP setup link to read the INAV interruption policy.',
        true,
      );
    }
    return null;
  }

  this.inavMissionRestartBusy = true;
  this.updateInavMissionRestartAvailability();
  if (!options.quiet) {
    this.setInavMissionRestartStatus('Reading nav_wp_mission_restart from INAV…');
  }
  try {
    const result = await mspHelper.getSetting(INAV_MISSION_RESTART_SETTING);
    const setting = this.validateInavMissionRestartSetting(result);
    this.renderInavMissionRestartSetting(setting);
    this.inavMissionRestartLoaded = true;
    this.setInavMissionRestartStatus(
      `Controller policy: ${setting.options[setting.value].name}. `
      + 'The displayed value was read directly from INAV.',
    );
    return setting.value;
  } catch (error) {
    this.inavMissionRestartLoaded = false;
    this.setInavMissionRestartStatus(error.message, true);
    return null;
  } finally {
    this.inavMissionRestartBusy = false;
    this.updateInavMissionRestartAvailability();
  }
};

flightPlanner.writeInavMissionRestartPolicy = async function () {
  if (!this.hasWiredInavSetupLink() || !this.inavMissionRestartLoaded) {
    this.setInavMissionRestartStatus(
      'Read the current policy through the wired INAV/MSP setup link before saving.',
      true,
    );
    return;
  }
  const expected = Number($('#plannerInavMissionRestart').val());
  if (!INAV_MISSION_RESTART_ENUM.some((entry) => entry.value === expected)) {
    this.setInavMissionRestartStatus('Select a valid INAV mission restart policy.', true);
    return;
  }

  this.inavMissionRestartBusy = true;
  this.updateInavMissionRestartAvailability();
  this.setInavMissionRestartStatus(
    `Writing ${INAV_MISSION_RESTART_ENUM[expected].name} to INAV…`,
  );
  try {
    const before = this.validateInavMissionRestartSetting(
      await mspHelper.getSetting(INAV_MISSION_RESTART_SETTING),
    );
    if (!before.options.some((entry) => entry.value === expected)) {
      throw new Error('The selected policy is not supported by the connected INAV firmware.');
    }

    await mspHelper.setSetting(INAV_MISSION_RESTART_SETTING, expected);
    await callMspHelper(
      mspHelper.saveToEeprom,
      'saving the INAV mission restart policy to EEPROM',
    );

    const readback = this.validateInavMissionRestartSetting(
      await mspHelper.getSetting(INAV_MISSION_RESTART_SETTING),
    );
    if (readback.value !== expected) {
      throw new Error(
        `INAV mission restart policy verification failed: requested `
        + `${INAV_MISSION_RESTART_ENUM[expected].name}, but the controller returned `
        + `${readback.options[readback.value].name}.`,
      );
    }

    this.renderInavMissionRestartSetting(readback);
    this.inavMissionRestartLoaded = true;
    this.setInavMissionRestartStatus(
      `${readback.options[readback.value].name} saved to INAV EEPROM and verified by readback.`,
    );
  } catch (error) {
    this.inavMissionRestartLoaded = false;
    this.setInavMissionRestartStatus(error.message, true);
  } finally {
    this.inavMissionRestartBusy = false;
    this.updateInavMissionRestartAvailability();
  }
};

flightPlanner.inavPlanningFeatureStyle = function (feature) {
  const kind = feature.get('kind');
  const label = String(feature.get('label') ?? '');
  if (kind === 'approach') {
    return new Style({
      stroke: new Stroke({
        color: '#ef8600',
        width: 3,
        lineDash: feature.get('exclusive') ? [7, 5] : undefined,
      }),
    });
  }
  if (kind === 'safehome') {
    return new Style({
      image: new CircleStyle({
        radius: 9,
        fill: new Fill({ color: '#2b9b4b' }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
      text: new Text({
        text: label,
        offsetY: -18,
        fill: new Fill({ color: '#174923' }),
        stroke: new Stroke({ color: '#fff', width: 3 }),
      }),
    });
  }
  const inclusive = feature.get('zoneType') === GEOZONE_TYPES.INCLUSIVE;
  const color = inclusive ? '#1f9c45' : '#d83d3d';
  return new Style({
    fill: new Fill({ color: inclusive ? 'rgba(31,156,69,0.14)' : 'rgba(216,61,61,0.14)' }),
    stroke: new Stroke({ color, width: 3 }),
    text: new Text({
      text: label,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
    }),
  });
};

flightPlanner.addApproachMapFeatures = function (latitude, longitude, approach, label) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const lengthCm = this.fwApproachLengthCm > 0 ? this.fwApproachLengthCm : 30000;
  for (const heading of [approach.heading1Deg, approach.heading2Deg]) {
    if (!Number.isFinite(heading) || heading === 0) continue;
    const start = calculate_new_cooridatnes(
      { lat: latitude, lon: longitude },
      (Math.abs(heading) + 180) % 360,
      lengthCm,
    );
    const feature = new Feature(new LineString([
      fromLonLat([start.lon, start.lat]),
      fromLonLat([longitude, latitude]),
    ]));
    feature.set('kind', 'approach');
    feature.set('label', label);
    feature.set('exclusive', heading < 0);
    this.inavPlanningSource?.addFeature(feature);
  }
};

flightPlanner.missionApproachCoordinate = function (missionIndex) {
  const hasSegmentMetadata = this.mission.some(
    (item) => Number.isInteger(Number(item?.metadata?.inavMultiMissionIndex)),
  );
  const items = this.mission.filter((item) => (
    !hasSegmentMetadata
      ? missionIndex === 0
      : Number(item?.metadata?.inavMultiMissionIndex) === missionIndex
  ));
  const reversed = [...items].reverse();
  const landing = reversed.find((item) => item.command === MAV_CMD_NAV_LAND && isCoordinateItem(item));
  const fallback = reversed.find(isCoordinateItem);
  const item = landing ?? fallback;
  if (!item) return null;
  return {
    latitude: Number(item.latitude ?? item.lat),
    longitude: Number(item.longitude ?? item.lon),
  };
};

flightPlanner.renderInavPlanningMap = function () {
  this.inavPlanningSource?.clear();
  const data = normalizeInavPlanningData(this.inavPlanning);

  data.safehomes.forEach((safehome, index) => {
    if (!Number.isFinite(safehome.latitude) || !Number.isFinite(safehome.longitude)) return;
    const feature = new Feature(new Point(fromLonLat([safehome.longitude, safehome.latitude])));
    feature.set('kind', 'safehome');
    feature.set('label', `S${index + 1}`);
    this.inavPlanningSource?.addFeature(feature);
    this.addApproachMapFeatures(
      safehome.latitude,
      safehome.longitude,
      data.approaches[index],
      `S${index + 1}`,
    );
  });

  data.geozones.forEach((zone, index) => {
    if (!zone.vertices.length) return;
    let geometry;
    if (zone.shape === GEOZONE_SHAPES.CIRCULAR) {
      const center = zone.vertices[0];
      if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;
      geometry = new Circle(
        fromLonLat([center.longitude, center.latitude]),
        Math.max(0, Number(zone.radiusCm) / 100),
      );
    } else {
      const ring = zone.vertices
        .filter((vertex) => Number.isFinite(vertex.latitude) && Number.isFinite(vertex.longitude))
        .map((vertex) => fromLonLat([vertex.longitude, vertex.latitude]));
      if (ring.length < 3) return;
      ring.push([...ring[0]]);
      geometry = new Polygon([ring]);
    }
    const feature = new Feature(geometry);
    feature.set('kind', 'geozone');
    feature.set('label', `G${index + 1}`);
    feature.set('zoneType', zone.type);
    this.inavPlanningSource?.addFeature(feature);
  });

  for (let index = 0; index < INAV_MAX_MISSION_APPROACHES; index += 1) {
    const approach = data.approaches[INAV_MAX_SAFEHOMES + index];
    if (!approachIsConfigured(approach)) continue;
    const coordinate = this.missionApproachCoordinate(index);
    if (coordinate) {
      this.addApproachMapFeatures(
        coordinate.latitude,
        coordinate.longitude,
        approach,
        `M${index + 1}`,
      );
    }
  }
};

flightPlanner.renderSafehomes = function () {
  const data = normalizeInavPlanningData(this.inavPlanning);
  const list = $('#plannerSafehomeList').empty();
  data.safehomes.forEach((safehome, index) => {
    const approach = data.approaches[index];
    const card = $('<div>').addClass('fc-planning-card').attr('data-safehome-index', index);
    const heading = $('<div>').addClass('fc-planning-card__heading').appendTo(card);
    $('<h4>').text(`Safe home ${index + 1}`).appendTo(heading);
    $('<button>').attr({
      type: 'button',
      'data-delete-safehome': index,
    }).text('Delete').appendTo(heading);
    const grid = $('<div>').addClass('fc-form-grid').appendTo(card);
    planningField(
      grid,
      'Latitude',
      planningNumberInput('fc-safehome-latitude', safehome.latitude, {
        min: -90,
        max: 90,
        step: 0.0000001,
      }),
    );
    planningField(
      grid,
      'Longitude',
      planningNumberInput('fc-safehome-longitude', safehome.longitude, {
        min: -180,
        max: 180,
        step: 0.0000001,
      }),
    );
    planningField(
      grid,
      'Approach altitude (cm)',
      planningNumberInput('fc-approach-altitude', approach.approachAltitudeCm, { step: 1 }),
    );
    planningField(
      grid,
      'Landing altitude (cm)',
      planningNumberInput('fc-landing-altitude', approach.landingAltitudeCm, { step: 1 }),
    );
    planningField(
      grid,
      'Approach direction',
      planningSelect('fc-approach-direction', approach.direction, [[0, 'Left'], [1, 'Right']]),
    );
    planningField(
      grid,
      'AMSL / sea-level reference',
      planningCheckbox('fc-approach-amsl', approach.seaLevelReference),
    );
    planningField(
      grid,
      'Landing heading 1 (°)',
      planningNumberInput('fc-heading-1', Math.abs(approach.heading1Deg), {
        min: 0,
        max: 360,
        step: 1,
      }),
    );
    planningField(
      grid,
      'Heading 1 exclusive',
      planningCheckbox('fc-heading-1-exclusive', approach.heading1Deg < 0),
    );
    planningField(
      grid,
      'Landing heading 2 (°)',
      planningNumberInput('fc-heading-2', Math.abs(approach.heading2Deg), {
        min: 0,
        max: 360,
        step: 1,
      }),
    );
    planningField(
      grid,
      'Heading 2 exclusive',
      planningCheckbox('fc-heading-2-exclusive', approach.heading2Deg < 0),
    );
    card.appendTo(list);
  });
  $('#plannerSafehomeCapacity').text(
    `${data.safehomes.length} / ${INAV_MAX_SAFEHOMES} safe homes used`,
  );
  $('#plannerAddSafehome').prop('disabled', data.safehomes.length >= INAV_MAX_SAFEHOMES);
};

flightPlanner.renderMissionApproaches = function () {
  const data = normalizeInavPlanningData(this.inavPlanning);
  const body = $('#plannerMissionApproachRows').empty();
  const segmentCount = missionSegmentCount(this.mission);
  for (let index = 0; index < INAV_MAX_MISSION_APPROACHES; index += 1) {
    const approach = data.approaches[INAV_MAX_SAFEHOMES + index];
    const row = $('<tr>').attr('data-mission-approach-index', index);
    $('<td>').text(index < segmentCount ? `${index + 1} (in plan)` : index + 1).appendTo(row);
    const addCell = (control) => $('<td>').append(control).appendTo(row);
    addCell(planningNumberInput('fc-approach-altitude', approach.approachAltitudeCm, { step: 1 }));
    addCell(planningNumberInput('fc-landing-altitude', approach.landingAltitudeCm, { step: 1 }));
    addCell(planningSelect('fc-approach-direction', approach.direction, [[0, 'Left'], [1, 'Right']]));
    addCell(planningNumberInput('fc-heading-1', Math.abs(approach.heading1Deg), {
      min: 0,
      max: 360,
      step: 1,
    }));
    addCell(planningCheckbox('fc-heading-1-exclusive', approach.heading1Deg < 0));
    addCell(planningNumberInput('fc-heading-2', Math.abs(approach.heading2Deg), {
      min: 0,
      max: 360,
      step: 1,
    }));
    addCell(planningCheckbox('fc-heading-2-exclusive', approach.heading2Deg < 0));
    addCell(planningCheckbox('fc-approach-amsl', approach.seaLevelReference));
    body.append(row);
  }
};

flightPlanner.geozoneVerticesText = function (zone) {
  return zone.vertices
    .map((vertex) => `${vertex.latitude.toFixed(7)}, ${vertex.longitude.toFixed(7)}`)
    .join('\n');
};

flightPlanner.renderGeozones = function () {
  const data = normalizeInavPlanningData(this.inavPlanning);
  const errors = collectGeozoneErrors(data);
  const list = $('#plannerGeozoneList').empty();
  data.geozones.forEach((zone, index) => {
    const cardErrors = errors.filter((message) => message.startsWith(`Geozone ${index + 1} `));
    const card = $('<div>')
      .addClass('fc-planning-card')
      .toggleClass('fc-planning-card--invalid', cardErrors.length > 0)
      .attr('data-geozone-index', index);
    const heading = $('<div>').addClass('fc-planning-card__heading').appendTo(card);
    $('<h4>').text(`Geozone ${index + 1}`).appendTo(heading);
    $('<button>').attr({
      type: 'button',
      'data-delete-geozone': index,
    }).text('Delete').appendTo(heading);
    const grid = $('<div>').addClass('fc-form-grid').appendTo(card);
    planningField(
      grid,
      'Shape',
      planningSelect('fc-geozone-shape', zone.shape, [
        [GEOZONE_SHAPES.CIRCULAR, 'Circular'],
        [GEOZONE_SHAPES.POLYGON, 'Polygon'],
      ]).attr('data-geozone-field', 'shape'),
    );
    planningField(
      grid,
      'Type',
      planningSelect('fc-geozone-type', zone.type, [
        [GEOZONE_TYPES.EXCLUSIVE, 'Exclusive'],
        [GEOZONE_TYPES.INCLUSIVE, 'Inclusive'],
      ]),
    );
    planningField(
      grid,
      'Action',
      planningSelect('fc-geozone-action', zone.action, [
        [GEOZONE_ACTIONS.NONE, 'None'],
        [GEOZONE_ACTIONS.AVOID, 'Avoid'],
        [GEOZONE_ACTIONS.POSHOLD, 'Position hold'],
        [GEOZONE_ACTIONS.RTH, 'Return to home'],
      ]),
    );
    planningField(
      grid,
      'Minimum altitude (cm)',
      planningNumberInput('fc-geozone-min-altitude', zone.minAltitudeCm, { step: 1 }),
    );
    planningField(
      grid,
      'Maximum altitude (cm; 0 = unlimited)',
      planningNumberInput('fc-geozone-max-altitude', zone.maxAltitudeCm, { step: 1 }),
    );
    planningField(
      grid,
      'AMSL / sea-level reference',
      planningCheckbox('fc-geozone-amsl', zone.seaLevelReference),
    );
    const radius = planningNumberInput('fc-geozone-radius', zone.radiusCm, {
      min: 1,
      step: 1,
    }).prop('disabled', zone.shape !== GEOZONE_SHAPES.CIRCULAR);
    planningField(grid, 'Radius (cm)', radius);
    const verticesLabel = $('<label>').text(
      zone.shape === GEOZONE_SHAPES.CIRCULAR
        ? 'Center — latitude, longitude'
        : 'Vertices — one latitude, longitude pair per line',
    );
    $('<textarea>')
      .addClass('fc-geozone-vertices')
      .val(this.geozoneVerticesText(zone))
      .appendTo(verticesLabel);
    verticesLabel.appendTo(card);
    if (cardErrors.length) {
      $('<div>').addClass('fc-planning-card__error').text(cardErrors.join(' ')).appendTo(card);
    }
    card.appendTo(list);
  });
  const usedVertices = data.geozones.reduce(
    (total, zone) => total + geozoneVertexUsage(zone),
    0,
  );
  $('#plannerGeozoneCapacity').text(
    `${data.geozones.length} / ${INAV_MAX_GEOZONES} zones · `
    + `${usedVertices} / ${INAV_MAX_GEOZONE_VERTICES} vertex slots`,
  );
  $('#plannerAddCircularGeozone, #plannerAddPolygonGeozone').prop(
    'disabled',
    data.geozones.length >= INAV_MAX_GEOZONES,
  );
};

flightPlanner.renderInavPlanningValidation = function () {
  const safehomeErrors = collectSafehomeAndApproachErrors(this.inavPlanning);
  $('#plannerSafehomeValidation')
    .text(safehomeErrors.length
      ? safehomeErrors.join(' ')
      : 'Safe-home and landing-approach values are valid for INAV.')
    .toggleClass('fc-action-status--error', safehomeErrors.length > 0);
  const geozoneErrors = collectGeozoneErrors(this.inavPlanning);
  $('#plannerGeozoneValidation')
    .text(geozoneErrors.length
      ? geozoneErrors.join(' ')
      : 'Geozone geometry and controller limits are valid.')
    .toggleClass('fc-action-status--error', geozoneErrors.length > 0);
};

flightPlanner.renderInavPlanning = function () {
  this.inavPlanning = normalizeInavPlanningData(this.inavPlanning);
  this.renderSafehomes();
  this.renderMissionApproaches();
  this.renderGeozones();
  this.renderInavPlanningValidation();
  this.renderInavPlanningMap();
  this.updateInavPlanningAvailability();
};

flightPlanner.captureApproach = function (container, slot) {
  const approachAltitudeCm = Number(container.find('.fc-approach-altitude').val());
  const landingAltitudeCm = Number(container.find('.fc-landing-altitude').val());
  const direction = Number(container.find('.fc-approach-direction').val());
  const heading1Magnitude = Math.abs(Number(container.find('.fc-heading-1').val()));
  const heading2Magnitude = Math.abs(Number(container.find('.fc-heading-2').val()));
  this.inavPlanning.approaches[slot] = {
    slot,
    approachAltitudeCm,
    landingAltitudeCm,
    direction,
    heading1Deg: container.find('.fc-heading-1-exclusive').prop('checked')
      ? -heading1Magnitude
      : heading1Magnitude,
    heading2Deg: container.find('.fc-heading-2-exclusive').prop('checked')
      ? -heading2Magnitude
      : heading2Magnitude,
    seaLevelReference: container.find('.fc-approach-amsl').prop('checked'),
  };
};

flightPlanner.captureSafehomeCard = function (card) {
  const index = Number(card.data('safehome-index'));
  const safehome = this.inavPlanning.safehomes[index];
  if (!safehome) return;
  safehome.latitude = Number(card.find('.fc-safehome-latitude').val());
  safehome.longitude = Number(card.find('.fc-safehome-longitude').val());
  this.captureApproach(card, index);
  this.renderInavPlanningValidation();
  this.renderInavPlanningMap();
};

flightPlanner.captureMissionApproachRow = function (row) {
  const index = Number(row.data('mission-approach-index'));
  if (!Number.isInteger(index) || index < 0 || index >= INAV_MAX_MISSION_APPROACHES) return;
  this.captureApproach(row, INAV_MAX_SAFEHOMES + index);
  this.renderInavPlanningValidation();
  this.renderInavPlanningMap();
};

flightPlanner.addSafehome = function () {
  if (this.inavPlanning.safehomes.length >= INAV_MAX_SAFEHOMES) {
    this.setStatus(`INAV supports at most ${INAV_MAX_SAFEHOMES} safe homes.`, true);
    return;
  }
  const [longitude, latitude] = toLonLat(this.map.getView().getCenter());
  const index = this.inavPlanning.safehomes.length;
  this.inavPlanning.safehomes.push({ number: index, latitude, longitude });
  this.inavPlanning.approaches[index] = {
    ...createEmptyInavPlanningData().approaches[index],
  };
  this.renderInavPlanning();
  this.setStatus(`Safe home ${index + 1} added at map center.`);
};

flightPlanner.deleteSafehome = function (index) {
  if (!this.inavPlanning.safehomes[index]) return;
  this.inavPlanning.safehomes.splice(index, 1);
  for (let slot = index; slot < INAV_MAX_SAFEHOMES - 1; slot += 1) {
    this.inavPlanning.approaches[slot] = {
      ...this.inavPlanning.approaches[slot + 1],
      slot,
    };
  }
  this.inavPlanning.approaches[INAV_MAX_SAFEHOMES - 1] = {
    ...createEmptyInavPlanningData().approaches[INAV_MAX_SAFEHOMES - 1],
  };
  this.renderInavPlanning();
  this.setStatus(`Safe home ${index + 1} removed from the local plan.`);
};

flightPlanner.defaultGeozoneVertices = function (shape) {
  const [longitude, latitude] = toLonLat(this.map.getView().getCenter());
  if (shape === GEOZONE_SHAPES.CIRCULAR) {
    return [{ number: 0, latitude, longitude }];
  }
  const offset = 0.0025;
  return [
    { number: 0, latitude: latitude - offset, longitude: longitude - offset },
    { number: 1, latitude: latitude - offset, longitude: longitude + offset },
    { number: 2, latitude: latitude + offset, longitude: longitude + offset },
    { number: 3, latitude: latitude + offset, longitude: longitude - offset },
  ];
};

flightPlanner.addGeozone = function (shape) {
  if (this.inavPlanning.geozones.length >= INAV_MAX_GEOZONES) {
    this.setStatus(`INAV supports at most ${INAV_MAX_GEOZONES} geozones.`, true);
    return;
  }
  const index = this.inavPlanning.geozones.length;
  this.inavPlanning.geozones.push({
    number: index,
    type: GEOZONE_TYPES.INCLUSIVE,
    shape,
    minAltitudeCm: 0,
    maxAltitudeCm: 10000,
    seaLevelReference: false,
    radiusCm: 20000,
    action: GEOZONE_ACTIONS.NONE,
    vertices: this.defaultGeozoneVertices(shape),
  });
  this.renderInavPlanning();
  this.setStatus(`Geozone ${index + 1} added at map center.`);
};

flightPlanner.parseGeozoneVertices = function (text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const values = line.split(/[\s,;]+/).filter(Boolean);
      return {
        number: index,
        latitude: Number(values[0]),
        longitude: Number(values[1]),
      };
    });
};

flightPlanner.captureGeozoneCard = function (card, shapeChanged = false) {
  const index = Number(card.data('geozone-index'));
  const zone = this.inavPlanning.geozones[index];
  if (!zone) return;
  const previousShape = zone.shape;
  zone.shape = Number(card.find('.fc-geozone-shape').val());
  zone.type = Number(card.find('.fc-geozone-type').val());
  zone.action = Number(card.find('.fc-geozone-action').val());
  zone.minAltitudeCm = Number(card.find('.fc-geozone-min-altitude').val());
  zone.maxAltitudeCm = Number(card.find('.fc-geozone-max-altitude').val());
  zone.seaLevelReference = card.find('.fc-geozone-amsl').prop('checked');
  zone.radiusCm = Number(card.find('.fc-geozone-radius').val());
  zone.vertices = this.parseGeozoneVertices(card.find('.fc-geozone-vertices').val());

  if (shapeChanged && zone.shape !== previousShape) {
    if (zone.shape === GEOZONE_SHAPES.CIRCULAR) {
      zone.vertices = zone.vertices.length
        ? [{ ...zone.vertices[0], number: 0 }]
        : this.defaultGeozoneVertices(GEOZONE_SHAPES.CIRCULAR);
      if (!(zone.radiusCm > 0)) zone.radiusCm = 20000;
    } else if (zone.vertices.length < 3) {
      const center = zone.vertices[0];
      if (center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude)) {
        const offset = 0.0025;
        zone.vertices = [
          { number: 0, latitude: center.latitude - offset, longitude: center.longitude - offset },
          { number: 1, latitude: center.latitude - offset, longitude: center.longitude + offset },
          { number: 2, latitude: center.latitude + offset, longitude: center.longitude + offset },
          { number: 3, latitude: center.latitude + offset, longitude: center.longitude - offset },
        ];
      } else {
        zone.vertices = this.defaultGeozoneVertices(GEOZONE_SHAPES.POLYGON);
      }
    }
    this.renderInavPlanning();
    return;
  }
  this.renderGeozones();
  this.renderInavPlanningValidation();
  this.renderInavPlanningMap();
};

flightPlanner.deleteGeozone = function (index) {
  if (!this.inavPlanning.geozones[index]) return;
  this.inavPlanning.geozones.splice(index, 1);
  this.renderInavPlanning();
  this.setStatus(`Geozone ${index + 1} removed from the local plan.`);
};

flightPlanner.readInavPlanningData = async function () {
  if (!CONFIGURATOR.connectionValid || CONFIGURATOR.connectionProtocol !== 'msp') {
    this.setStatus('Connect through the wired INAV/MSP setup link to read planning data.', true);
    return;
  }
  $('#plannerReadInavPlanning').prop('disabled', true);
  try {
    const includeGeozones = FC.isFeatureEnabled('GEOZONE');
    this.setStatus('Reading INAV safe homes and fixed-wing landing approaches…');
    const downloaded = await inavPlanningAdapter.download({ includeGeozones });
    this.fwApproachLengthCm = await inavPlanningAdapter.approachLengthCm();
    this.inavPlanning = normalizeInavPlanningData({
      ...downloaded,
      geozones: includeGeozones
        ? downloaded.geozones
        : this.inavPlanning.geozones,
    });
    this.renderInavPlanning();
    this.setStatus(
      `Read ${this.inavPlanning.safehomes.length} safe homes, `
      + `${INAV_MAX_FW_APPROACHES} landing-approach slots`
      + `${includeGeozones ? `, and ${this.inavPlanning.geozones.length} geozones` : ''}.`,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.updateInavPlanningAvailability();
  }
};

flightPlanner.writeSafehomesAndApproaches = async function () {
  if (!CONFIGURATOR.connectionValid || CONFIGURATOR.connectionProtocol !== 'msp') {
    this.setStatus('Connect through the wired INAV/MSP setup link to save safe homes.', true);
    return;
  }
  const errors = collectSafehomeAndApproachErrors(this.inavPlanning);
  if (errors.length) {
    this.setStatus(errors.join(' '), true);
    return;
  }
  $('#plannerWriteSafehomes').prop('disabled', true);
  try {
    this.setStatus('Writing safe homes and all fixed-wing approach slots to INAV…');
    const readback = await inavPlanningAdapter.uploadSafehomesAndApproaches(this.inavPlanning);
    this.inavPlanning = normalizeInavPlanningData({
      ...this.inavPlanning,
      safehomes: readback.safehomes,
      approaches: readback.approaches,
    });
    this.renderInavPlanning();
    this.setStatus(
      `${this.inavPlanning.safehomes.length} safe homes and `
      + `${INAV_MAX_FW_APPROACHES} fixed-wing approach slots saved to EEPROM and verified.`,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.updateInavPlanningAvailability();
  }
};

flightPlanner.writeGeozones = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || CONFIGURATOR.connectionProtocol !== 'msp'
    || !FC.isFeatureEnabled('GEOZONE')
  ) {
    this.setStatus(
      'Geozone transfer requires wired INAV/MSP with the GEOZONE feature enabled.',
      true,
    );
    return;
  }
  const errors = collectGeozoneErrors(this.inavPlanning);
  if (errors.length) {
    this.setStatus(errors.join(' '), true);
    return;
  }
  if (!await dialog.confirm(
    'Write all geozones, verify them, save to EEPROM, and reboot the INAV controller now?',
  )) {
    return;
  }
  $('#plannerWriteGeozones').prop('disabled', true);
  try {
    this.setStatus('Writing INAV geozones…');
    const readback = await inavPlanningAdapter.uploadGeozones(this.inavPlanning);
    this.inavPlanning = normalizeInavPlanningData({
      ...this.inavPlanning,
      geozones: readback.geozones,
    });
    this.renderInavPlanning();
    this.setStatus(
      `${this.inavPlanning.geozones.length} geozones saved and verified. Rebooting INAV…`,
    );
    await inavPlanningAdapter.reboot();
    GUI.handleReconnect($('.tab_flight_planner a'));
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.updateInavPlanningAvailability();
  }
};

flightPlanner.missionBehavior = function () {
  return normalizeMissionBehavior(this.settings());
};

flightPlanner.applyDerivedMissionBehavior = function (derived, options = {}) {
  if (!derived?.behavior || !Array.isArray(derived.mission)) {
    throw new TypeError('Derived mission behavior must include a mission and behavior.');
  }
  const behavior = normalizeMissionBehavior(derived.behavior);
  this.mission = derived.mission;
  $('#plannerCruiseSpeed').val(
    speedToPlannerDisplay(behavior.cruiseSpeedMps, currentPlannerUnitSystem()).toFixed(2),
  );
  $('#plannerCompletionAction').val(behavior.completionAction);
  this.missionBehaviorWarnings = [
    ...(derived.conflicts ?? []),
    ...(derived.warnings ?? []),
  ]
    .map((entry) => String(entry?.message ?? entry).trim())
    .filter(Boolean);
  if (options.persist !== false) {
    this.storeSettings();
  }
  this.updateMissionBehaviorAvailability();
  return behavior;
};

flightPlanner.rederiveMissionBehaviorAfterTopologyEdit = function () {
  const cruiseSpeedMps = this.missionBehavior().cruiseSpeedMps;
  const derived = deriveInavMissionBehavior(this.mission, {
    fixedWing: FC.isAirplane(),
  });
  derived.behavior = {
    ...derived.behavior,
    cruiseSpeedMps,
  };
  this.applyDerivedMissionBehavior(derived);
};

flightPlanner.clearMissionBehaviorWarnings = function () {
  this.missionBehaviorWarnings = [];
};

flightPlanner.updateMissionBehaviorAvailability = function () {
  const protocol = CONFIGURATOR.connectionProtocol;
  const firmwareFamily = protocol === 'mavlink'
    ? String(mavlinkSession.state.firmwareFamily ?? 'unknown').toLowerCase()
    : null;
  const inavMavlink = protocol === 'mavlink'
    && ['inav', 'flight-commander'].includes(firmwareFamily);
  const inavSegments = new Set(
    this.mission
      .map((item) => Number(item?.metadata?.inavMultiMissionIndex))
      .filter((index) => Number.isInteger(index) && index >= 0),
  );
  const inavMultiSegment = inavSegments.size > 1;

  $('#plannerCruiseSpeed')
    .prop('disabled', inavMavlink)
    .attr(
      'title',
      inavMavlink
        ? 'The Flight Commander/INAV-compatible MAVLink mission transport does not support a mission speed command; use MSP or controller defaults.'
        : `0 preserves the mission/controller default; maximum ${speedToPlannerDisplay(
          INAV_SPEED_M_S_MAX,
          currentPlannerUnitSystem(),
        ).toFixed(2)} ${plannerUnitLabels(currentPlannerUnitSystem()).speed}.`,
    );
  for (const action of [
    'hold',
    'land',
  ]) {
    $('#plannerCompletionAction')
      .find(`option[value="${action}"]`)
      .prop('disabled', inavMavlink);
  }
  $('#plannerCompletionAction')
    .prop('disabled', inavMultiSegment)
    .attr(
      'title',
      inavMultiSegment
        ? 'INAV multi-mission terminals are preserved per segment and cannot be replaced by one global action.'
        : '',
    );

  const missionHelp = inavMultiSegment
    ? 'This INAV plan contains multiple mission segments. Each existing segment terminal '
      + 'is preserved; one global completion selector cannot safely replace them.'
    : inavMavlink
    ? 'The Flight Commander/INAV-compatible MAVLink transport supports no added terminal action or RTL. '
      + 'Mission cruise speed, terminal hold, and terminal land require the wired MSP mission link.'
    : protocol === 'msp'
      ? 'INAV/MSP stores cruise speed in waypoint P1 (cm/s) and maps terminal hold, RTL, or land to native mission actions.'
      : `Cruise speed is entered in ${plannerUnitLabels(currentPlannerUnitSystem()).speed}; `
        + '0 preserves the INAV/controller default. '
        + 'Terminal behavior is compiled for the INAV-compatible controller during upload.';
  const warningText = this.missionBehaviorWarnings.length
    ? ` ${this.missionBehaviorWarnings.join(' ')}`
    : '';
  $('#plannerMissionBehaviorHelp')
    .text(`${missionHelp}${warningText}`)
    .toggleClass('fc-action-status--error', this.missionBehaviorWarnings.length > 0);
  this.renderResumeCheckpoint();
};

flightPlanner.renderResumeCheckpoint = function (
  snapshot = missionResumeManager.snapshot(),
) {
  const checkpoint = snapshot.checkpoint;
  const mavlinkConnected = Boolean(
    CONFIGURATOR.connectionValid
    && CONFIGURATOR.connectionProtocol === 'mavlink',
  );
  const activeMissionOperation = missionOperationCoordinator.current();
  const operationBusy = Boolean(activeMissionOperation);
  if (!checkpoint) {
    $('#plannerResumeStatus').text(
      snapshot.message || 'No interrupted mission checkpoint has been captured.',
    );
  } else {
    const total = Number(checkpoint.missionTotal)
      || Number(snapshot.registration?.itemCount)
      || 0;
    const type = 'Estimated INAV';
    const availability = snapshot.canResume
      ? 'Ready on this powered controller.'
      : snapshot.unavailableReason;
    $('#plannerResumeStatus').text(
      `${type} checkpoint at item ${checkpoint.sequence + 1}`
      + `${total ? ` / ${total}` : ''} (${checkpoint.fromMode} → ${checkpoint.returnMode}). `
      + availability,
    );
  }
  $('#plannerResumeMission')
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
  $('#plannerClearResume')
    .prop('disabled', !checkpoint || snapshot.resuming || operationBusy);
};

flightPlanner.resumeMissionFromCheckpoint = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || CONFIGURATOR.connectionProtocol !== 'mavlink'
  ) {
    this.setStatus(
      'Mission resume requires a MAVLink telemetry connection to the same powered flight controller.',
      true,
    );
    return;
  }
  this.setStatus('Verifying the onboard mission and saved resume item…');
  try {
    const result = await missionResumeManager.resume();
    const registeredMission = missionResumeManager.registeredMission();
    if (registeredMission?.length) {
      this.mission = registeredMission;
      this.grid = null;
      this.renderMission();
      this.zoomToPlan();
    }
    const executionNotice = result.executionPending
      ? ' The aircraft is disarmed; arm and launch it before the selected mission can execute.'
      : '';
    this.setStatus(
      `INAV resume selection was confirmed from estimated original item ${result.originalSequence + 1}. `
      + 'Only the remaining suffix was written to active RAM; the persistent MSP mission was not changed.'
      + executionNotice,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    this.renderResumeCheckpoint();
    this.updateVehicleTransferState();
  }
};

flightPlanner.resolveMavlinkFirmwareFamily = async function () {
  const state = mavlinkSession.state.firmwareFamily === 'unknown'
    ? await mavlinkSession.waitForFirmwareFamily()
    : mavlinkSession.snapshot();
  if (!['inav', 'flight-commander'].includes(state.firmwareFamily)) {
    throw new Error(
      state.firmwareFamily === 'unsupported'
        ? 'ArduPilot mission transfer has been removed. Connect Flight Commander Firmware or Official INAV.'
        : 'This MAVLink firmware is not supported for mission transfer.',
    );
  }
  return state.firmwareFamily;
};

flightPlanner.startPolygonDraw = function () {
  if (this.drawInteraction) {
    this.map.removeInteraction(this.drawInteraction);
  }
  this.drawInteraction = new Draw({
    source: this.polygonSource,
    type: 'Polygon',
  });
  this.drawInteraction.on('drawstart', () => this.polygonSource.clear());
  this.drawInteraction.on('drawend', () => {
    setTimeout(() => this.readPolygonLayer(), 0);
    this.map.removeInteraction(this.drawInteraction);
    this.drawInteraction = null;
    $('#plannerDrawPolygon').prop('disabled', false);
    this.setStatus('Polygon captured. Set grid values and generate the survey.');
  });
  this.map.addInteraction(this.drawInteraction);
  $('#plannerDrawPolygon').prop('disabled', true);
  this.setStatus('Click map vertices; double-click the final vertex to close the polygon.');
};

flightPlanner.readPolygonLayer = function () {
  const feature = this.polygonSource.getFeatures()[0];
  const ring = feature?.getGeometry()?.getCoordinates()?.[0] ?? [];
  const coordinates = ring.map((coordinate) => toLonLat(coordinate));
  if (
    coordinates.length > 1
    && coordinates[0][0] === coordinates.at(-1)[0]
    && coordinates[0][1] === coordinates.at(-1)[1]
  ) {
    coordinates.pop();
  }
  this.polygon = coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
};

flightPlanner.restorePolygonLayer = function () {
  this.polygonSource?.clear();
  if (!this.polygon || this.polygon.length < 3) return;
  const ring = this.polygon.map((point) => {
    const coordinate = normalizeCoordinate(point);
    return fromLonLat([coordinate.longitude, coordinate.latitude]);
  });
  ring.push([...ring[0]]);
  this.polygonSource.addFeature(new Feature(new Polygon([ring])));
};

flightPlanner.settings = function () {
  const unitSystem = currentPlannerUnitSystem();
  return {
    angleDeg: numberValue('#plannerAngle'),
    lineSpacingM: distanceFromPlannerDisplay(numberValue('#plannerSpacing'), unitSystem),
    altitudeM: distanceFromPlannerDisplay(numberValue('#plannerAltitude'), unitSystem),
    overshootM: distanceFromPlannerDisplay(numberValue('#plannerOvershoot'), unitSystem),
    turnaroundM: distanceFromPlannerDisplay(numberValue('#plannerTurnaround'), unitSystem),
    triggerDistanceM: distanceFromPlannerDisplay(numberValue('#plannerTriggerDistance'), unitSystem),
    cameraCommandMode: normalizeSurveyCameraMode($('#plannerCameraCommandMode').val()),
    cruiseSpeedMps: speedFromPlannerDisplay(numberValue('#plannerCruiseSpeed'), unitSystem),
    completionAction: $('#plannerCompletionAction').val(),
    clearanceM: distanceFromPlannerDisplay(numberValue('#plannerClearance'), unitSystem),
    terrainSampleSpacingM: distanceFromPlannerDisplay(numberValue('#plannerTerrainSpacing'), unitSystem),
    elevationSource: $('#plannerElevationSource').val(),
    altitudeReference: $('#plannerAltitudeReference').val(),
  };
};

flightPlanner.loadStoredSettings = function () {
  const settings = store.get('flightPlannerSettings', {});
  const unitSystem = currentPlannerUnitSystem();
  const selectors = {
    angleDeg: '#plannerAngle',
    lineSpacingM: '#plannerSpacing',
    altitudeM: '#plannerAltitude',
    overshootM: '#plannerOvershoot',
    turnaroundM: '#plannerTurnaround',
    triggerDistanceM: '#plannerTriggerDistance',
    cameraCommandMode: '#plannerCameraCommandMode',
    cruiseSpeedMps: '#plannerCruiseSpeed',
    completionAction: '#plannerCompletionAction',
    clearanceM: '#plannerClearance',
    terrainSampleSpacingM: '#plannerTerrainSpacing',
    elevationSource: '#plannerElevationSource',
    altitudeReference: '#plannerAltitudeReference',
  };
  let missionBehavior = DEFAULT_MISSION_BEHAVIOR;
  try {
    missionBehavior = normalizeMissionBehavior(settings);
  } catch {
    missionBehavior = DEFAULT_MISSION_BEHAVIOR;
  }
  const normalizedSettings = {
    ...PLANNER_DEFAULTS_SI,
    ...settings,
    ...missionBehavior,
  };
  for (const [key, selector] of Object.entries(selectors)) {
    if (key === 'elevationSource' || key === 'cameraCommandMode') continue;
    if (normalizedSettings[key] == null) continue;
    let value = normalizedSettings[key];
    if (PLANNER_DISTANCE_FIELDS.has(key)) {
      value = distanceToPlannerDisplay(value, unitSystem);
    } else if (key === 'cruiseSpeedMps') {
      value = speedToPlannerDisplay(value, unitSystem);
    }
    $(selector).val(Number.isFinite(Number(value)) ? Number(value).toFixed(2) : value);
  }
  $('#plannerCameraCommandMode').val(
    normalizeSurveyCameraMode(settings.cameraCommandMode),
  );
  const elevationSource = ['opentopo', 'google', 'gis'].includes(settings.elevationSource)
    ? settings.elevationSource
    : DEFAULT_ELEVATION_SOURCE;
  $('#plannerElevationSource').val(elevationSource);
  $('#plannerGoogleKey').val(store.get('googleElevationApiKey', ''));
  $('#plannerMapStyle').val(normalizeMapStyle(
    store.get('flightCommanderMapStyle', MAP_STYLES.HYBRID),
  ));
};

flightPlanner.storeSettings = function () {
  store.set('flightPlannerSettings', this.settings());
  store.set('flightCommanderMapStyle', this.mapStyle());
};

flightPlanner.generateGrid = function () {
  try {
    this.readPolygonLayer();
    if (!this.polygon || this.polygon.length < 3) {
      throw new Error('Draw a survey polygon first.');
    }
    const hasConfiguredMissionApproach = (
      this.inavPlanning?.approaches ?? []
    ).slice(INAV_MAX_SAFEHOMES).some(approachIsConfigured);
    if (hasConfiguredMissionApproach) {
      throw new Error(
        'One or more INAV mission landing approaches are configured. Clear or move those '
        + 'approaches before replacing the current mission with a new survey grid.',
      );
    }
    const settings = this.settings();
    const cameraPolicy = resolveSurveyCameraPolicy({
      mode: settings.cameraCommandMode,
      protocol: CONFIGURATOR.connectionProtocol,
      firmwareFamily: CONFIGURATOR.connectionProtocol === 'mavlink'
        ? mavlinkSession.state.firmwareFamily
        : null,
      triggerDistanceM: settings.triggerDistanceM,
      photoTriggersSupported: connectedFlightCommanderFeature('photoTriggers'),
    });
    if (cameraPolicy.incompatible) {
      throw new Error(cameraPolicy.notice);
    }
    this.grid = generateSurveyGrid(this.polygon, settings);
    this.mission = surveyGridToMission(this.grid, {
      altitudeM: settings.altitudeM,
      triggerDistanceM: settings.triggerDistanceM,
      includeCameraCommands: cameraPolicy.includeCameraCommands,
    });
    this.clearMissionBehaviorWarnings();
    this.storeSettings();
    this.renderMission();
    this.zoomToPlan();
    this.setStatus(
      `Generated ${this.grid.statistics.segmentCount} survey legs and ${this.mission.length} mission items.`
      + (cameraPolicy.notice ? ` ${cameraPolicy.notice}` : ''),
    );
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

flightPlanner.addWaypoint = function () {
  const [longitude, latitude] = toLonLat(this.map.getView().getCenter());
  try {
    const waypoint = {
      frame: 6,
      command: MAV_CMD_NAV_WAYPOINT,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: Number.NaN,
      latitude,
      longitude,
      altitude: this.settings().altitudeM,
    };
    const finalCommand = Number(this.mission.at(-1)?.command);
    const insertionIndex = [17, 20, 21].includes(finalCommand)
      ? this.mission.length - 1
      : this.mission.length;
    this.mission = hasInavMissionMetadata(this.mission)
      ? reindexInavMissionItems([
        ...this.mission.slice(0, insertionIndex),
        waypoint,
        ...this.mission.slice(insertionIndex),
      ])
      : insertMissionItem(this.mission, insertionIndex, waypoint);
    this.grid = null;
    this.rederiveMissionBehaviorAfterTopologyEdit();
    this.renderMission();
    this.setStatus(`Waypoint ${insertionIndex + 1} added at map center.`);
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

flightPlanner.renderMission = function () {
  this.routeSource?.clear();
  this.markerSource?.clear();
  const routeCoordinates = [];

  this.mission.forEach((item, index) => {
    if (!NAVIGATION_COMMANDS.has(item.command) || !isCoordinateItem(item)) {
      return;
    }
    const coordinate = fromLonLat([
      Number(item.longitude ?? item.lon),
      Number(item.latitude ?? item.lat),
    ]);
    routeCoordinates.push(coordinate);
    const feature = new Feature(new Point(coordinate));
    feature.set('missionIndex', index);
    feature.set('sequence', index + 1);
    this.markerSource?.addFeature(feature);
  });

  if (routeCoordinates.length > 1) {
    this.routeSource?.addFeature(new Feature(new LineString(routeCoordinates)));
  }
  this.renderMissionTable();
  this.renderSummary();
  this.renderMissionApproaches();
  this.renderInavPlanningMap();
};

flightPlanner.renderMissionTable = function () {
  const body = $('#plannerMissionRows').empty();
  this.mission.forEach((item, index) => {
    const row = $('<tr>');
    $('<td>').text(index + 1).appendTo(row);
    $('<td>').text(COMMAND_NAMES[item.command] ?? `CMD ${item.command}`).appendTo(row);
    for (const [field, decimals] of [['latitude', 7], ['longitude', 7], ['altitude', 2]]) {
      const canonicalValue = Number(item[field] ?? item[field === 'latitude' ? 'lat' : field === 'longitude' ? 'lon' : 'alt']);
      const value = field === 'altitude'
        ? distanceToPlannerDisplay(canonicalValue, currentPlannerUnitSystem())
        : canonicalValue;
      $('<td>').append(
        $('<input>').attr({
          type: 'number',
          step: field === 'altitude' ? '0.1' : '0.0000001',
          'data-mission-index': index,
          'data-mission-field': field,
        }).val(Number.isFinite(value) ? value.toFixed(decimals) : 0),
      ).appendTo(row);
    }
    const metadata = item.metadata ?? {};
    const protocolDetails = metadata.inavAction != null
      ? `P1 ${metadata.inavP1} · P2 ${metadata.inavP2} · P3 ${metadata.inavP3}`
        + ` · End 0x${Number(metadata.inavEndMission).toString(16).padStart(2, '0').toUpperCase()}`
        + ` · Mission ${Number(metadata.inavMultiMissionIndex) + 1}`
      : `P1 ${item.param1 ?? 0} · P2 ${item.param2 ?? 0} · P3 ${item.param3 ?? 0}`;
    $('<td>').addClass('fc-mission-protocol-details').text(protocolDetails).appendTo(row);
    $('<td>').append(
      $('<button>')
        .attr({ type: 'button', 'data-delete-mission': index })
        .text('Delete'),
    ).appendTo(row);
    body.append(row);
  });
};

flightPlanner.renderSummary = function () {
  const navigational = this.mission.filter((item) => (
    NAVIGATION_COMMANDS.has(item.command) && isCoordinateItem(item)
  ));
  let routeDistance = 0;
  for (let index = 1; index < navigational.length; index += 1) {
    routeDistance += localDistance(
      normalizeCoordinate(navigational[index - 1]),
      normalizeCoordinate(navigational[index]),
    );
  }

  $('#plannerItemCount').text(this.mission.length);
  $('#plannerLineCount').text(this.grid?.statistics.segmentCount ?? 0);
  $('#plannerRouteDistance').text(
    formatPlannerDistance(routeDistance, currentPlannerUnitSystem()),
  );
  const area = this.grid?.statistics.areaM2 ?? 0;
  $('#plannerArea').text(formatPlannerArea(area, currentPlannerUnitSystem()));
  $('#plannerPhotoCount').text(this.grid?.statistics.estimatedPhotos ?? 0);
  this.updateVehicleTransferState();
};

flightPlanner.zoomToPlan = function () {
  const extents = [
    this.polygonSource?.getExtent(),
    this.routeSource?.getExtent(),
    this.markerSource?.getExtent(),
  ];
  const extent = extents.find((candidate) => candidate?.every(Number.isFinite));
  if (extent) {
    this.map.getView().fit(extent, {
      padding: [30, 30, 30, 30],
      maxZoom: 18,
      duration: 250,
    });
  }
};

flightPlanner.updateElevationControls = function () {
  const selected = $('#plannerElevationSource').val();
  const source = ['opentopo', 'google', 'gis'].includes(selected)
    ? selected
    : DEFAULT_ELEVATION_SOURCE;
  $('#plannerElevationSource').val(source);
  $('#plannerGoogleKeyRow').toggle(source === 'google');
  $('#plannerLoadGis').toggle(source === 'gis');
  const help = {
    opentopo: 'Built in and ready to use without an account or API key. Requires internet. '
      + 'Uses the public OpenTopoData ASTER global dataset (~30 m) and observes its per-request '
      + 'and request-rate limits. The public usage quota can still be reached during busy periods.',
    google: 'Optional Google Maps Platform source. Requires your own Elevation API key.',
    gis: 'Offline source. Load GeoJSON, JSON, CSV, or TSV elevation points from this computer.',
  };
  $('#plannerElevationSourceHelp').text(help[source]);
};

flightPlanner.createElevationProvider = function () {
  switch ($('#plannerElevationSource').val()) {
    case 'google':
      return new GoogleElevationProvider({ apiKey: $('#plannerGoogleKey').val() });
    case 'gis':
      if (!this.gisProvider) {
        throw new Error('Load a GeoJSON or CSV elevation dataset first.');
      }
      return this.gisProvider;
    case 'opentopo':
    default:
      this.openTopoProvider ??= new OpenTopoDataElevationProvider();
      return this.openTopoProvider;
  }
};

flightPlanner.loadGis = async function () {
  try {
    const result = await window.electronAPI.showOpenDialog({
      filters: [
        { name: 'GIS elevation points', extensions: ['geojson', 'json', 'csv', 'tsv'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.length) return;
    const filePath = result.filePaths[0];
    const file = await window.electronAPI.readFile(filePath);
    if (file.error) throw new Error(String(file.error));
    this.gisProvider = /\.(csv|tsv)$/i.test(filePath)
      ? GisPointElevationProvider.fromCsv(file.data, { name: filePath.split(/[\\/]/).pop() })
      : GisPointElevationProvider.fromGeoJson(file.data, { name: filePath.split(/[\\/]/).pop() });
    $('#plannerElevationAttribution').text(this.gisProvider.attribution);
    this.setStatus(`Loaded ${this.gisProvider.points.length} local GIS elevation points.`);
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

flightPlanner.applyTerrain = async function () {
  if (!this.mission.length) {
    this.setStatus('Generate or load a mission before applying terrain.', true);
    return;
  }
  const firstCoordinateItem = this.mission.find(isTerrainWaypoint);
  if (!firstCoordinateItem) {
    this.setStatus('Terrain following requires at least one geographic mission waypoint.', true);
    return;
  }
  $('#plannerApplyTerrain').prop('disabled', true);
  try {
    const provider = this.createElevationProvider();
    const settings = this.settings();
    const state = mavlinkSession.state;
    const home = Number.isFinite(state.homeLatitude) && Number.isFinite(state.homeLongitude)
      ? {
        latitude: state.homeLatitude,
        longitude: state.homeLongitude,
        elevation: state.homeAltitudeMsl,
      }
      : Number.isFinite(state.latitude) && Number.isFinite(state.longitude)
        ? { latitude: state.latitude, longitude: state.longitude }
        : normalizeCoordinate(firstCoordinateItem);
    this.setStatus(`Requesting terrain from ${provider.name}…`);
    const result = await applyTerrainFollowing(this.mission, provider, {
      clearanceM: settings.clearanceM,
      home,
      altitudeReference: settings.altitudeReference,
      sampleSpacingM: settings.terrainSampleSpacingM,
      onProgress: ({ completed, total }) => {
        this.setStatus(`Terrain samples ${completed} / ${total}`);
      },
    });
    this.mission = result.mission;
    this.grid = null;
    this.terrainAttribution = result.attribution;
    $('#plannerElevationAttribution').text(result.attribution);
    this.updateMapAttribution();
    this.renderMission();
    this.setStatus(
      `Terrain following applied at ${formatPlannerDistance(settings.clearanceM, currentPlannerUnitSystem())} AGL; `
      + `home elevation ${formatPlannerDistance(result.homeElevationM, currentPlannerUnitSystem())}.`,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    $('#plannerApplyTerrain').prop('disabled', false);
  }
};

flightPlanner.upload = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || !['msp', 'mavlink'].includes(CONFIGURATOR.connectionProtocol)
  ) {
    this.setStatus('Connect through MSP or MAVLink before uploading.', true);
    return;
  }
  if (!this.mission.length) {
    this.setStatus('There is no mission to upload.', true);
    return;
  }
  const missionOperation = missionOperationCoordinator.acquire('mission upload and readback');
  if (!missionOperation) {
    this.setStatus(
      missionOperationCoordinator.busyMessage('mission upload'),
      true,
    );
    return;
  }
  this.updateVehicleTransferState();
  $('#plannerUpload').prop('disabled', true);
  try {
    const behavior = this.missionBehavior();
    let savedMission;
    if (CONFIGURATOR.connectionProtocol === 'mavlink') {
      const firmwareFamily = await this.resolveMavlinkFirmwareFamily();
      const photoTriggersSupported = connectedFlightCommanderFeature('photoTriggers');
      const terrainSupported = connectedFlightCommanderFeature('terrainWaypoints');
      assertSurveyCameraCommandsCompatible(
        this.mission,
        firmwareFamily,
        photoTriggersSupported,
      );
      assertTerrainMissionCompatible(this.mission, firmwareFamily, terrainSupported);
      missionResumeManager.clearRegisteredMission(
        'The previous mission-resume checkpoint was cleared because a new mission transfer started.',
      );
      const compiledMission = compileInavMavlinkMission(this.mission, behavior);
      const missionToUpload = filterExpectedMissionForProtocol(
        compiledMission,
        'mavlink',
        { firmwareProfile: firmwareFamily },
      );
      if (!missionToUpload.length) {
        throw new Error(
          'This plan has no INAV MAVLink-compatible waypoint or RTL items.',
        );
      }
      await mavlinkMissionManager.upload(missionToUpload, {
        onProgress: ({ completed, total }) => this.setStatus(`Uploading ${completed} / ${total}`),
        firmwareProfile: firmwareFamily,
      });
      this.setStatus('Mission accepted. Reading it back from the flight controller for verification…');
      savedMission = await mavlinkMissionManager.download({
        onProgress: ({ completed, total }) => this.setStatus(`Verifying ${completed} / ${total}`),
        legacyOnly: true,
      });
      assertMissionReadback(
        missionToUpload,
        savedMission,
        { compareProtocolFields: true },
      );
      mavlinkSession.state.missionTotal = savedMission.length;
      missionResumeManager.registerMission(savedMission, {
        source: 'flight-planner-upload-readback',
      });
      this.setStatus(
        `${missionToUpload.length} ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'Official INAV'} mission items written to active memory and verified.`
        + ' This active mission is not stored across a power cycle.',
      );
    } else {
      const firmwareFamily = missionTargetForConnection('msp');
      const photoTriggersSupported = connectedFlightCommanderFeature('photoTriggers');
      const terrainSupported = connectedFlightCommanderFeature('terrainWaypoints');
      assertSurveyCameraCommandsCompatible(
        this.mission,
        firmwareFamily,
        photoTriggersSupported,
      );
      assertTerrainMissionCompatible(this.mission, firmwareFamily, terrainSupported);
      const extensionOptions = {
        allowFlightCommanderPhotoTriggers:
          firmwareFamily === 'flight-commander' && photoTriggersSupported,
      };
      const compiled = compileInavMspMission(
        this.mission,
        behavior,
        extensionOptions,
      );
      const missionToUpload = filterExpectedMissionForProtocol(
        compiled.mission,
        'msp',
        { firmwareProfile: firmwareFamily },
      );
      const result = await inavMissionAdapter.upload(missionToUpload, {
        saveToEeprom: true,
        speedCmS: compiled.speedCmS,
        ...extensionOptions,
      });
      this.setStatus(
        `Mission saved to ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'Official INAV'} EEPROM. Reading it back for verification…`,
      );
      savedMission = await inavMissionAdapter.download({ loadFromEeprom: true });
      assertMissionReadback(
        result.normalizedMission,
        savedMission,
        { compareInavFields: true },
      );
      const suffix = result.omitted
        ? ` ${result.omitted} MAVLink-only command items were omitted.`
        : '';
      this.setStatus(
        `${result.uploaded} ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'Official INAV'} mission items written to EEPROM and verified.${suffix}`,
      );
    }
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    missionOperation.release();
    this.updateVehicleTransferState();
  }
};

flightPlanner.download = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || !['msp', 'mavlink'].includes(CONFIGURATOR.connectionProtocol)
  ) {
    this.setStatus('Connect through MSP or MAVLink before downloading.', true);
    return;
  }
  const missionOperation = missionOperationCoordinator.acquire('mission download');
  if (!missionOperation) {
    this.setStatus(
      missionOperationCoordinator.busyMessage('mission download'),
      true,
    );
    return;
  }
  this.updateVehicleTransferState();
  $('#plannerDownload').prop('disabled', true);
  try {
    let derived;
    if (CONFIGURATOR.connectionProtocol === 'mavlink') {
      await this.resolveMavlinkFirmwareFamily();
      const downloadedMission = await mavlinkMissionManager.download({
        onProgress: ({ completed, total }) => this.setStatus(`Downloading ${completed} / ${total}`),
        legacyOnly: true,
      });
      derived = deriveInavMissionBehavior(downloadedMission, {
        fixedWing: FC.isAirplane(),
      });
      this.applyDerivedMissionBehavior(derived);
      mavlinkSession.state.missionTotal = this.mission.length;
      if (this.mission.length) {
        missionResumeManager.registerMission(this.mission, {
          source: 'flight-planner-download',
        });
      } else {
        missionResumeManager.clearRegisteredMission(
          'The connected flight controller has no onboard mission to resume.',
        );
      }
    } else {
      const downloadedMission = await inavMissionAdapter.download({ loadFromEeprom: true });
      derived = deriveInavMissionBehavior(downloadedMission, {
        fixedWing: FC.isAirplane(),
      });
      this.applyDerivedMissionBehavior(derived);
    }
    this.grid = null;
    this.renderMission();
    this.zoomToPlan();
    const warningSuffix = this.missionBehaviorWarnings.length
      ? ` ${this.missionBehaviorWarnings.join(' ')}`
      : '';
    this.setStatus(`${this.mission.length} mission items downloaded.${warningSuffix}`);
  } catch (error) {
    this.setStatus(error.message, true);
  } finally {
    missionOperation.release();
    this.updateVehicleTransferState();
  }
};

flightPlanner.clearVehicleMission = async function () {
  if (
    !CONFIGURATOR.connectionValid
    || !['msp', 'mavlink'].includes(CONFIGURATOR.connectionProtocol)
  ) {
    this.setStatus('Connect through MSP or MAVLink before erasing a mission.', true);
    return;
  }
  const missionOperation = missionOperationCoordinator.acquire('mission erase');
  if (!missionOperation) {
    this.setStatus(
      missionOperationCoordinator.busyMessage('mission erase'),
      true,
    );
    return;
  }
  this.updateVehicleTransferState();
  $('#plannerClearVehicle').prop('disabled', true);
  try {
    if (CONFIGURATOR.connectionProtocol === 'mavlink') {
      const firmwareFamily = await this.resolveMavlinkFirmwareFamily();
      missionResumeManager.clearRegisteredMission(
        'The mission-resume checkpoint was cleared because controller mission erase started.',
      );
      await mavlinkMissionManager.clear({ legacyOnly: true, volatile: true });
      mavlinkSession.state.missionTotal = 0;
      this.setStatus(
        `Active ${firmwareFamily === 'flight-commander' ? 'Flight Commander' : 'Official INAV'} RAM mission cleared and verified for this power cycle. `
        + 'The stored mission is unchanged; this MAVLink mission transport cannot persist an empty mission, '
        + 'so replace it with another valid mission if it must not return after reboot.',
      );
      return;
    } else {
      await inavMissionAdapter.clear();
    }
    this.setStatus('Flight-controller mission erased and verified. Your local plan is unchanged.');
  } catch (error) {
    if (error?.code === INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED) {
      this.setStatus(
        `${error.message} The stored mission and your local plan are unchanged. `
        + `[${INAV_PERSISTENT_MISSION_ERASE_UNSUPPORTED}]`,
        true,
      );
    } else {
      this.setStatus(error.message, true);
    }
  } finally {
    missionOperation.release();
    this.updateVehicleTransferState();
  }
};

flightPlanner.savePlan = async function () {
  try {
    const result = await window.electronAPI.showSaveDialog({
      defaultPath: 'flight-plan.flightplan.json',
      filters: [
        { name: 'Flight Commander Plan', extensions: ['flightplan.json', 'json'] },
        { name: 'QGC WPL 110', extensions: ['waypoints'] },
      ],
    });
    if (result.canceled) return;
    const settings = {
      ...this.settings(),
      ...this.missionBehavior(),
    };
    const text = /\.waypoints$/i.test(result.filePath)
      ? hasInavPlanningData(this.inavPlanning)
        ? (() => {
          throw new Error(
            'QGC WPL cannot preserve INAV safe homes, geozones, or landing approaches. '
            + 'Save as a Flight Commander Plan (.flightplan.json) instead.',
          );
        })()
        : serializeQgcWpl(this.mission)
      : serializeFlightPlan({
        mission: this.mission,
        polygon: this.polygon,
        settings,
        inavPlanning: normalizeInavPlanningData(this.inavPlanning),
      });
    const error = await window.electronAPI.writeFile(result.filePath, text);
    if (error) throw new Error(String(error));
    this.setStatus(`Flight plan saved to ${result.filePath}.`);
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

flightPlanner.openPlan = async function () {
  try {
    const result = await window.electronAPI.showOpenDialog({
      filters: [
        { name: 'Flight plans', extensions: ['json', 'waypoints'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.length) return;
    const file = await window.electronAPI.readFile(result.filePaths[0]);
    if (file.error) throw new Error(String(file.error));
    const plan = parseFlightPlan(file.data);
    this.mission = plan.mission;
    this.polygon = plan.polygon;
    this.inavPlanning = normalizeInavPlanningData(plan.inavPlanning ?? {});
    this.grid = null;
    if (plan.format === 'qgc-wpl-110') {
      this.applyDerivedMissionBehavior(
        deriveInavMissionBehavior(plan.mission, {
          fixedWing: FC.isAirplane(),
        }),
      );
    } else if (plan.settings) {
      const missionBehavior = normalizeMissionBehavior(plan.settings);
      store.set('flightPlannerSettings', {
        ...this.settings(),
        ...plan.settings,
        ...missionBehavior,
      });
      this.loadStoredSettings();
      this.updateElevationControls();
      this.clearMissionBehaviorWarnings();
      this.updateMissionBehaviorAvailability();
    }
    this.restorePolygonLayer();
    this.renderMission();
    this.renderInavPlanning();
    this.zoomToPlan();
    this.setStatus(
      `${this.mission.length} mission items, ${this.inavPlanning.safehomes.length} safe homes, `
      + `and ${this.inavPlanning.geozones.length} geozones loaded from file.`,
    );
  } catch (error) {
    this.setStatus(error.message, true);
  }
};

flightPlanner.setStatus = function (message, error = false) {
  $('#plannerStatus')
    .text(message)
    .toggleClass('fc-action-status--error', error);
};

flightPlanner.cleanup = function (callback) {
  this.mavlinkStateUnsubscribe?.();
  this.mavlinkStateUnsubscribe = null;
  this.resumeStateUnsubscribe?.();
  this.resumeStateUnsubscribe = null;
  if (this.drawInteraction && this.map) {
    this.map.removeInteraction(this.drawInteraction);
  }
  this.drawInteraction = null;
  this.map?.setTarget(undefined);
  this.map = null;
  this.baseMapLayers = [];
  this.polygonSource = null;
  this.routeSource = null;
  this.markerSource = null;
  this.inavPlanningSource = null;
  this.terrainAttribution = '';
  if (callback) callback();
};

export default flightPlanner;
