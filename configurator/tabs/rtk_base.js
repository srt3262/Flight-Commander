"use strict";

import GUI from "../js/gui.js";
import store from "../js/store.js";
import {
  DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  convertGroundControlValue,
  formatGroundControlLongDistance,
  formatGroundControlValue,
  groundControlDisplayToCanonicalValue,
  groundControlUnitLabel,
  normalizeGroundControlUnitSystem,
} from "../js/gcs/groundControlUnits.js";
import rtkBaseStation from "../js/rtk/rtkBaseStation.js";
import {
  f9pMountpointCompatibility,
  mountpointDistanceKm,
  sortNtripMountpoints,
} from "../js/rtk/ntripSourcetable.js";
import {
  NTRIP_PROVIDER_PRESETS,
  NTRIP_PROVIDER_RTK2GO,
} from "../js/rtk/ntripProviders.js";
import {
  RTK_WORKFLOW_DETAILS,
  RTK_WORKFLOWS,
  normalizeRtkWorkflow,
  rtkWorkflowGuidance,
  settingsForRtkWorkflow,
} from "../js/rtk/rtkWorkflow.js";

const STORAGE_KEY = "flightCommander.rtkBase.v1";
const RTK_DISTANCE_FIELDS = Object.freeze([
  Object.freeze({
    selector: "#rtkBaseSurveyAccuracy",
    quantity: "distance",
    minM: 0.0001,
    maxM: 100,
    stepM: 0.01,
    decimals: 6,
  }),
  Object.freeze({
    selector: "#rtkBaseHeight",
    quantity: "altitude",
    minM: -1000,
    maxM: 20000,
    stepM: 0.0001,
    decimals: 6,
  }),
  Object.freeze({
    selector: "#rtkBaseFixedAccuracy",
    quantity: "distance",
    minM: 0.0001,
    maxM: 100,
    stepM: 0.0001,
    decimals: 6,
  }),
  Object.freeze({
    selector: "#rtkNtripAltitude",
    quantity: "altitude",
    minM: -1000,
    maxM: 20000,
    stepM: 0.1,
    decimals: 4,
  }),
]);
const DEFAULTS = Object.freeze({
  workflow: RTK_WORKFLOWS.DIRECT_NTRIP,
  path: "",
  bitrate: 115200,
  profile: "ublox-f9",
  mode: "survey-in",
  surveyInMinDurationS: 120,
  surveyInAccuracyM: 0.5,
  latitude: "",
  longitude: "",
  ellipsoidHeightM: "",
  fixedPositionAccuracyM: 0.02,
  persist: true,
  forwarding: true,
  correctionSource: "ntrip",
  constellations: {
    gps: true,
    glonass: true,
    galileo: true,
    beidou: true,
  },
  ntrip: {
    provider: NTRIP_PROVIDER_RTK2GO,
    host: NTRIP_PROVIDER_PRESETS[NTRIP_PROVIDER_RTK2GO].host,
    port: 2101,
    mountpoint: "",
    username: "",
    tls: false,
    destination: "aircraft",
    ggaSource: "none",
    ggaLatitude: "",
    ggaLongitude: "",
    ggaAltitudeMsl: 0,
    freeOnly: true,
  },
});

function storedSettings() {
  const value = store.get(STORAGE_KEY, {});
  const inferredWorkflow = value?.workflow ?? (
    value?.ntrip?.destination === "usb-base"
      ? RTK_WORKFLOWS.REFINED_BASE
      : value?.correctionSource === "ntrip"
        ? RTK_WORKFLOWS.DIRECT_NTRIP
        : RTK_WORKFLOWS.SURVEY_BASE
  );
  return settingsForRtkWorkflow({
    ...DEFAULTS,
    ...(value && typeof value === "object" ? value : {}),
    constellations: {
      ...DEFAULTS.constellations,
      ...(value?.constellations ?? {}),
    },
    ntrip: {
      ...DEFAULTS.ntrip,
      ...(value?.ntrip ?? {}),
    },
  }, inferredWorkflow);
}

function numberInput(selector) {
  const raw = String($(selector).val() ?? "").trim();
  return raw === "" ? Number.NaN : Number(raw);
}

function editableNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
}

function distanceField(selector) {
  return RTK_DISTANCE_FIELDS.find((field) => field.selector === selector);
}

function setCanonicalDistanceInput(selector, meters) {
  const element = document.querySelector(selector);
  if (!element) return;
  const value = meters === "" || meters == null ? null : Number(meters);
  element.dataset.canonicalMeters = Number.isFinite(value) ? String(value) : "";
}

function canonicalDistanceInput(selector, unitSystem) {
  const field = distanceField(selector);
  if (!field) return Number.NaN;
  const meters = groundControlDisplayToCanonicalValue(
    $(selector).val(),
    field.quantity,
    unitSystem,
  );
  return Number.isFinite(meters) ? meters : Number.NaN;
}

function captureDistanceInputs(unitSystem) {
  for (const field of RTK_DISTANCE_FIELDS) {
    setCanonicalDistanceInput(
      field.selector,
      canonicalDistanceInput(field.selector, unitSystem),
    );
  }
}

function renderDistanceInputs(unitSystem) {
  for (const field of RTK_DISTANCE_FIELDS) {
    const element = document.querySelector(field.selector);
    if (!element) continue;
    const canonical = String(element.dataset.canonicalMeters ?? "").trim();
    const meters = canonical === "" ? null : Number(canonical);
    const converted = Number.isFinite(meters)
      ? convertGroundControlValue(meters, field.quantity, unitSystem)
      : null;
    $(element)
      .val(editableNumber(converted, field.decimals))
      .attr(
        "min",
        editableNumber(
          convertGroundControlValue(field.minM, field.quantity, unitSystem),
          6,
        ),
      )
      .attr(
        "max",
        editableNumber(
          convertGroundControlValue(field.maxM, field.quantity, unitSystem),
          6,
        ),
      )
      .attr(
        "step",
        editableNumber(
          convertGroundControlValue(field.stepM, field.quantity, unitSystem),
          6,
        ),
      );
  }
  $("[data-ground-control-distance-unit]").text(
    groundControlUnitLabel("distance", unitSystem),
  );
}

function escapeHtml(value) {
  return $("<div>").text(String(value ?? "")).html();
}

const REFINEMENT_PHASE_LABELS = Object.freeze({
  idle: "Idle",
  surveying: "Survey-in running",
  "survey-ready": "Survey-in ready",
  "ntrip-connecting": "Verifying NTRIP",
  collecting: "Collecting stable RTK Fixed samples",
  "refined-ready": "NTRIP-refined position ready",
  finalizing: "Returning receiver to fixed-base mode",
  "base-ready": "Local base ready; aircraft may connect",
  failed: "Attention required",
});

const rtkBaseTab = {
  unsubscribe: null,
  renderTimer: null,
  pollTicks: 0,
  mountpoints: [],
  workflow: RTK_WORKFLOWS.DIRECT_NTRIP,
  mountToken: 0,
  unitSystem: DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
  renderCurrent: null,
  renderMountpointsCurrent: null,
};

rtkBaseTab.mount = async function mount(
  container = "#flightDataRtkMount",
  options = {},
  callback,
) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  this.cleanup();
  this.unitSystem = normalizeGroundControlUnitSystem(options.unitSystem);
  const token = ++this.mountToken;
  const { default: html } = await import("./rtk_base.html?raw");
  if (token !== this.mountToken || !$(container).length) return false;
  $(container).html(html);
  await this.processHtml(callback, token);
  return token === this.mountToken;
};

rtkBaseTab.processHtml = async function processHtml(callback, mountToken = this.mountToken) {
  const settings = storedSettings();
  this.workflow = normalizeRtkWorkflow(settings.workflow);
  const activeState = rtkBaseStation.snapshot();
  const initialCorrectionSource = activeState.ntrip.connected
    ? activeState.correctionSource
    : settings.correctionSource;
  const initialNtripDestination = activeState.ntrip.connected
    ? activeState.ntrip.destination
    : settings.ntrip.destination;

  $("#rtkBaseBaud").val(String(settings.bitrate));
  $("#rtkBaseProfile").val(settings.profile);
  $("#rtkBaseMode").val(settings.mode);
  $("#rtkBaseSurveyDuration").val(settings.surveyInMinDurationS);
  setCanonicalDistanceInput("#rtkBaseSurveyAccuracy", settings.surveyInAccuracyM);
  $("#rtkBaseLatitude").val(settings.latitude);
  $("#rtkBaseLongitude").val(settings.longitude);
  setCanonicalDistanceInput("#rtkBaseHeight", settings.ellipsoidHeightM);
  setCanonicalDistanceInput("#rtkBaseFixedAccuracy", settings.fixedPositionAccuracyM);
  $("#rtkBasePersist").prop("checked", settings.persist);
  $("#rtkBaseForward").prop("checked", settings.forwarding);
  $("#rtkBaseGps").prop("checked", settings.constellations.gps);
  $("#rtkBaseGlonass").prop("checked", settings.constellations.glonass);
  $("#rtkBaseGalileo").prop("checked", settings.constellations.galileo);
  $("#rtkBaseBeidou").prop("checked", settings.constellations.beidou);
  $("#rtkCorrectionSource").val(initialCorrectionSource);
  $("#rtkNtripHost").val(settings.ntrip.host);
  $("#rtkNtripProvider").val(settings.ntrip.provider);
  $("#rtkNtripPort").val(settings.ntrip.port);
  $("#rtkNtripMountpoint").val(settings.ntrip.mountpoint);
  $("#rtkNtripUsername").val(settings.ntrip.username);
  $("#rtkNtripTls").prop("checked", settings.ntrip.tls);
  $("#rtkNtripDestination").val(initialNtripDestination);
  $("#rtkNtripGgaSource").val(settings.ntrip.ggaSource);
  $("#rtkNtripLatitude").val(settings.ntrip.ggaLatitude);
  $("#rtkNtripLongitude").val(settings.ntrip.ggaLongitude);
  setCanonicalDistanceInput("#rtkNtripAltitude", settings.ntrip.ggaAltitudeMsl);
  renderDistanceInputs(this.unitSystem);
  $("#rtkNtripFreeOnly").prop("checked", settings.ntrip.freeOnly !== false);
  rtkBaseStation.setForwarding(settings.forwarding);
  if (!activeState.ntrip.connected) {
    rtkBaseStation.setCorrectionSource(settings.correctionSource);
    rtkBaseStation.setNtripDestination(settings.ntrip.destination);
  }

  const collectSettings = () => ({
    workflow: this.workflow,
    path: String($("#rtkBasePort").val() ?? ""),
    bitrate: Number($("#rtkBaseBaud").val()),
    profile: $("#rtkBaseProfile").val(),
    mode: $("#rtkBaseMode").val(),
    surveyInMinDurationS: numberInput("#rtkBaseSurveyDuration"),
    surveyInAccuracyM: canonicalDistanceInput("#rtkBaseSurveyAccuracy", this.unitSystem),
    latitude: numberInput("#rtkBaseLatitude"),
    longitude: numberInput("#rtkBaseLongitude"),
    ellipsoidHeightM: canonicalDistanceInput("#rtkBaseHeight", this.unitSystem),
    fixedPositionAccuracyM: canonicalDistanceInput("#rtkBaseFixedAccuracy", this.unitSystem),
    persist: $("#rtkBasePersist").is(":checked"),
    forwarding: $("#rtkBaseForward").is(":checked"),
    correctionSource: $("#rtkCorrectionSource").val(),
    constellations: {
      gps: $("#rtkBaseGps").is(":checked"),
      glonass: $("#rtkBaseGlonass").is(":checked"),
      galileo: $("#rtkBaseGalileo").is(":checked"),
      beidou: $("#rtkBaseBeidou").is(":checked"),
    },
    ntrip: {
      provider: $("#rtkNtripProvider").val(),
      host: String($("#rtkNtripHost").val() ?? "").trim(),
      port: Number($("#rtkNtripPort").val()),
      mountpoint: String($("#rtkNtripMountpoint").val() ?? "").trim(),
      username: String($("#rtkNtripUsername").val() ?? ""),
      tls: $("#rtkNtripTls").is(":checked"),
      destination: $("#rtkNtripDestination").val(),
      ggaSource: $("#rtkNtripGgaSource").val(),
      ggaLatitude: numberInput("#rtkNtripLatitude"),
      ggaLongitude: numberInput("#rtkNtripLongitude"),
      ggaAltitudeMsl: canonicalDistanceInput("#rtkNtripAltitude", this.unitSystem),
      freeOnly: $("#rtkNtripFreeOnly").is(":checked"),
    },
  });

  const collectNtripSettings = () => {
    const current = collectSettings();
    return {
      ...current.ntrip,
      password: String($("#rtkNtripPassword").val() ?? ""),
    };
  };

  const collectRefinementSettings = () => {
    const current = collectSettings();
    return {
      ...current,
      ...current.ntrip,
      password: String($("#rtkNtripPassword").val() ?? ""),
    };
  };

  const saveSettings = () => {
    const current = collectSettings();
    store.set(STORAGE_KEY, {
      ...current,
      latitude: Number.isFinite(current.latitude) ? current.latitude : "",
      longitude: Number.isFinite(current.longitude) ? current.longitude : "",
      ellipsoidHeightM: Number.isFinite(current.ellipsoidHeightM)
        ? current.ellipsoidHeightM
        : "",
      ntrip: {
        ...current.ntrip,
        ggaLatitude: Number.isFinite(current.ntrip.ggaLatitude)
          ? current.ntrip.ggaLatitude
          : "",
        ggaLongitude: Number.isFinite(current.ntrip.ggaLongitude)
          ? current.ntrip.ggaLongitude
          : "",
        ggaAltitudeMsl: Number.isFinite(current.ntrip.ggaAltitudeMsl)
          ? current.ntrip.ggaAltitudeMsl
          : 0,
      },
    });
    return current;
  };

  const updateModeVisibility = () => {
    const raw = $("#rtkBaseProfile").val() === "raw-rtcm";
    const fixed = $("#rtkBaseMode").val() === "fixed";
    $("#rtkBaseUbloxSetup").toggleClass("is-hidden", raw);
    $("#rtkBaseSurveyFields").toggleClass("is-hidden", fixed);
    $("#rtkBaseFixedFields").toggleClass("is-hidden", !fixed);
    $("#rtkNtripManualGga").toggleClass(
      "is-hidden",
      $("#rtkNtripGgaSource").val() !== "manual",
    );
  };

  const updateWorkflowVisibility = () => {
    const workflow = normalizeRtkWorkflow(this.workflow);
    this.workflow = workflow;
    $(".tab-rtk-base").attr("data-rtk-workflow", workflow);
    $("[data-rtk-workflow-choice]").each((_, element) => {
      const selected = element.dataset.rtkWorkflowChoice === workflow;
      $(element)
        .attr("aria-pressed", String(selected))
        .toggleClass("is-active", selected);
    });
    $("[data-rtk-workflows]").each((_, element) => {
      const workflows = String(element.dataset.rtkWorkflows ?? "")
        .split(/\s+/)
        .filter(Boolean);
      $(element).toggleClass("is-hidden", !workflows.includes(workflow));
    });
    const details = RTK_WORKFLOW_DETAILS[workflow];
    $("#rtkWorkflowTitle").text(details.title);
    $("#rtkWorkflowSummary").text(details.summary);
    const $steps = $("#rtkWorkflowSteps").empty();
    for (const step of details.steps) $("<li>").text(step).appendTo($steps);
    $("#rtkNtripConnect").text(
      workflow === RTK_WORKFLOWS.REFINED_BASE
        ? "Start NTRIP refinement"
        : "Connect NTRIP to aircraft",
    );
  };

  const applyWorkflowRecommendation = (workflow) => {
    const recommended = settingsForRtkWorkflow(collectSettings(), workflow);
    this.workflow = recommended.workflow;
    $("#rtkBaseProfile").val(recommended.profile);
    $("#rtkBaseMode").val(recommended.mode);
    $("#rtkBaseForward").prop("checked", recommended.forwarding);
    $("#rtkCorrectionSource").val(recommended.correctionSource);
    $("#rtkNtripDestination").val(recommended.ntrip.destination);
    $("#rtkNtripGgaSource").val(recommended.ntrip.ggaSource);
    rtkBaseStation.setForwarding(recommended.forwarding);
    rtkBaseStation.setCorrectionSource(recommended.correctionSource);
    rtkBaseStation.setNtripDestination(recommended.ntrip.destination);
    updateModeVisibility();
    updateWorkflowVisibility();
    saveSettings();
  };

  const refreshPorts = async () => {
    const $port = $("#rtkBasePort");
    const selected = rtkBaseStation.snapshot().path || $port.val() || settings.path;
    $port.empty();
    try {
      const devices = await rtkBaseStation.listDevices();
      for (const device of devices) {
        const name = device.friendlyName || device.manufacturer || device.path;
        $("<option>").val(device.path).text(`${name} — ${device.path}`).appendTo($port);
      }
      if (selected && !devices.some((device) => device.path === selected)) {
        $("<option>").val(selected).text(`${selected} — not currently detected`).appendTo($port);
      }
      if (!$port.children().length) {
        $("<option>").val("").text("No serial devices detected").appendTo($port);
      }
      $port.val(selected || $port.children().first().val());
    } catch (error) {
      $port.append($("<option>").val(selected || "").text(error.message));
    }
  };

  const render = (state = rtkBaseStation.snapshot()) => {
    const route = rtkBaseStation.routeStatus();
    updateWorkflowVisibility();
    const guidance = rtkWorkflowGuidance(this.workflow, state, route);
    $("#rtkWorkflowNext")
      .attr("data-tone", guidance.tone);
    $("#rtkWorkflowNextTitle").text(guidance.title);
    $("#rtkWorkflowNextDetail").text(guidance.detail);
    const workflowBusy = state.connected || state.ntrip.connected;
    $("[data-rtk-workflow-choice]").each((_, element) => {
      $(element).prop(
        "disabled",
        workflowBusy && element.dataset.rtkWorkflowChoice !== this.workflow,
      );
    });
    $("#rtkBaseConnectionStatus").text(
      state.connected
        ? `Connected to ${state.path} at ${state.bitrate} baud`
        : state.lastError || "Not connected",
    );
    $("#rtkBaseConnect").prop("disabled", state.connected);
    $("#rtkBaseDisconnect").prop("disabled", !state.connected);
    $("#rtkBasePort, #rtkBaseBaud, #rtkBaseProfile").prop("disabled", state.connected);
    $("#rtkBaseApply").prop(
      "disabled",
      !state.connected || state.profile !== "ublox-f9",
    ).text($("#rtkBaseMode").val() === "fixed"
      ? "Apply fixed-base configuration"
      : "Apply survey-in configuration");

    const ntripToBase = state.correctionSource === "ntrip" && state.ntrip.destination === "usb-base";
    $("#rtkBaseRoute").text(
      ntripToBase
        ? "NTRIP → USB F9 positioning receiver"
        : route.available
          ? `${state.correctionSource === "ntrip" ? "NTRIP" : "Local USB base"} → ${route.transport} aircraft injection`
          : `Aircraft standby — ${route.reason} Base setup and RTCM monitoring remain active.`,
    );
    $("#rtkBaseFrames").text(state.stats.activeRtcmFrames);
    $("#rtkBaseMessageType").text(state.stats.lastActiveMessageType ?? "--");
    $("#rtkBaseForwarded").text(
      `${state.stats.forwardedFrames} / ${state.stats.forwardedPackets}`,
    );
    $("#rtkBaseForwardedBytes").text(state.stats.forwardedBytes);
    $("#rtkBaseDropped").text(
      `${state.stats.droppedFrames} / ${state.stats.oversizedFrames}`,
    );
    $("#rtkBaseQueued").text(state.stats.queuedFrames);
    $("#rtkBaseStandby").text(state.stats.standbyFrames);
    $("#rtkBaseParserErrors").text(
      `${state.stats.invalidRtcmFrames} / ${state.stats.invalidUbxFrames}`,
    );
    $("#rtkBaseForwardError")
      .text(state.stats.lastError || "")
      .toggleClass("is-hidden", !state.stats.lastError);

    const receiver = state.receiver;
    $("#rtkBaseReceiver").text(
      receiver.model || receiver.hardwareVersion || "Not identified",
    );
    $("#rtkBaseVersion").text(
      [receiver.softwareVersion, receiver.protocolVersion && `protocol ${receiver.protocolVersion}`]
        .filter(Boolean)
        .join(" · ") || "--",
    );
    const survey = state.surveyIn;
    const configuredFixed = state.lastConfiguration?.mode === "fixed";
    $("#rtkBaseSurveyState").text(
      survey?.valid
        ? "Complete and valid"
        : survey?.active
          ? "Survey-in active"
          : configuredFixed
            ? "Fixed position configured"
            : "Inactive",
    );
    $("#rtkBaseSurveyElapsed").text(survey ? `${survey.durationS} s` : "--");
    $("#rtkBaseSurveyMeanAccuracy").text(
      survey
        ? formatGroundControlValue(
          survey.meanAccuracyM,
          "distance",
          this.unitSystem,
          { decimals: 4 },
        )
        : "--",
    );
    $("#rtkBaseSurveyObservations").text(survey?.observations ?? "--");
    $("#rtkBaseSerialBytes").text(state.stats.serialBytes);
    const position = state.receiverPosition;
    $("#rtkBaseReceiverPosition").text(
      position?.fixOk
        ? `${position.carrierSolutionName} · ${position.latitude.toFixed(8)}, ${position.longitude.toFixed(8)} · ${formatGroundControlValue(position.ellipsoidHeightM, "altitude", this.unitSystem, { decimals: 3 })} ellipsoid`
        : "No valid receiver position",
    );
    $("#rtkNtripStreamStats").text(`${state.ntrip.bytes} bytes / ${state.ntrip.frames} RTCM frames`);
    $("#rtkNtripBaseStats").text(
      `${state.ntrip.injectedToBaseFrames} frames / ${state.ntrip.injectionDrops} drops`,
    );
    $("#rtkNtripStatus").text(
      state.ntrip.connected
        ? `Connected to ${state.ntrip.host}:${state.ntrip.port}/${state.ntrip.mountpoint}${state.ntrip.lastGgaError ? ` · GGA error: ${state.ntrip.lastGgaError}` : ""}`
        : state.ntrip.lastError || "Not connected",
    );
    const refinement = state.refinement;
    $("#rtkRefinementPhase").text(
      refinement.lastError
        ? `${REFINEMENT_PHASE_LABELS[refinement.phase] ?? refinement.phase} · ${refinement.lastError}`
        : REFINEMENT_PHASE_LABELS[refinement.phase] ?? refinement.phase,
    );
    $("#rtkRefinementSamples").text(
      `${refinement.fixedSamples} / ${refinement.requiredSamples}`,
    );
    $("#rtkRefinementStability").text(
      Number.isFinite(refinement.stabilityM)
        ? `${formatGroundControlValue(refinement.stabilityM, "distance", this.unitSystem, { decimals: 4 })} RMS`
        : "--",
    );
    const positioningMode = state.lastConfiguration?.mode === "ntrip-positioning";
    $("#rtkNtripConnect").prop("disabled", state.ntrip.connected || positioningMode);
    $("#rtkNtripDisconnect")
      .prop("disabled", !state.ntrip.connected && !positioningMode)
      .text(positioningMode && !state.ntrip.connected ? "Restore surveyed base" : "Disconnect");
    $("#rtkNtripProvider, #rtkNtripHost, #rtkNtripPort, #rtkNtripMountpoint, #rtkNtripMountpointList, #rtkNtripLoadMountpoints, #rtkNtripFreeOnly, #rtkNtripUsername, #rtkNtripPassword, #rtkNtripTls, #rtkNtripDestination, #rtkNtripGgaSource, #rtkNtripLatitude, #rtkNtripLongitude, #rtkNtripAltitude")
      .prop("disabled", state.ntrip.connected);
    $("#rtkNtripMountpointList").prop(
      "disabled",
      state.ntrip.connected || !this.mountpoints.length,
    );
    const presetLocked = $("#rtkNtripProvider").val() !== "custom";
    $("#rtkNtripHost, #rtkNtripPort, #rtkNtripTls").prop(
      "disabled",
      state.ntrip.connected || presetLocked,
    );
    $("#rtkBaseCaptureFixed").prop(
      "disabled",
      refinement.phase !== "refined-ready",
    );
    $("#rtkBaseLastConfiguration").text(
      state.lastConfiguration
        ? `${state.lastConfiguration.mode} · ${new Date(state.lastConfiguration.appliedAt).toLocaleTimeString()}`
        : "None this session",
    );
  };

  const applyProviderPreset = (overwrite = true) => {
    const provider = $("#rtkNtripProvider").val();
    if (provider === NTRIP_PROVIDER_RTK2GO) {
      const preset = NTRIP_PROVIDER_PRESETS[NTRIP_PROVIDER_RTK2GO];
      $("#rtkNtripHost").val(preset.host);
      $("#rtkNtripPort").val(String(preset.port));
      $("#rtkNtripTls").prop("checked", preset.tls);
      if (overwrite) $("#rtkNtripFreeOnly").prop("checked", true);
      $("#rtkNtripUsername").attr("placeholder", "valid-email@example.com");
      $("#rtkNtripProviderHelp").text(
        "RTK2go is a free public caster. Enter a valid email address as the username, leave the password blank, load its live sourcetable, and choose a nearby compatible RTCM3 stream.",
      );
    } else {
      $("#rtkNtripUsername").attr("placeholder", "optional");
      $("#rtkNtripProviderHelp").text(
        "Flight Commander connects natively to NTRIP v1/v2 casters. Anonymous and free-account services are supported; caster availability, coverage, and account rules are provider-specific.",
      );
    }
  };

  const renderMountpoints = () => {
    const $list = $("#rtkNtripMountpointList").empty();
    const freeOnly = $("#rtkNtripFreeOnly").is(":checked");
    const position = rtkBaseStation.mountpointReferencePosition();
    const candidates = sortNtripMountpoints(
      this.mountpoints.filter((record) => !freeOnly || !record.fee),
      position,
    );
    if (!candidates.length) {
      $("<option>")
        .val("")
        .text(`No ${freeOnly ? "no-fee " : ""}streams found`)
        .appendTo($list);
      $list.prop("disabled", true);
      return;
    }
    for (const record of candidates) {
      const distance = mountpointDistanceKm(record, position);
      const compatibility = f9pMountpointCompatibility(record);
      const details = [
        compatibility.label,
        record.format,
        record.navigationSystems,
        record.country,
        distance == null
          ? "distance unavailable"
          : formatGroundControlLongDistance(distance * 1000, this.unitSystem),
        record.requiresNmea ? "GGA required" : null,
        record.authentication && record.authentication !== "N"
          ? `auth ${record.authentication}`
          : "anonymous",
        record.fee ? "fee" : "no fee",
        compatibility.reason,
      ].filter(Boolean).join(" · ");
      $("<option>")
        .val(record.mountpoint)
        .text(`${record.mountpoint} — ${details}`)
        .data("summary", record)
        .appendTo($list);
    }
    const current = String($("#rtkNtripMountpoint").val() ?? "").trim();
    if (candidates.some((record) => record.mountpoint === current)) $list.val(current);
    else {
      $list.prop("selectedIndex", 0);
      $("#rtkNtripMountpoint").val($list.val());
    }
    $list.prop("disabled", false);
  };

  this.renderCurrent = render;
  this.renderMountpointsCurrent = renderMountpoints;

  applyProviderPreset(false);

  $("[data-rtk-workflow-choice]").on("click.rtkBase", (event) => {
    event.preventDefault();
    applyWorkflowRecommendation(event.currentTarget.dataset.rtkWorkflowChoice);
    render();
  });

  $("#rtkNtripProvider").on("change.rtkBase", () => {
    applyProviderPreset(true);
    this.mountpoints = [];
    renderMountpoints();
    saveSettings();
    render();
  });
  $("#rtkNtripFreeOnly").on("change.rtkBase", () => {
    renderMountpoints();
    saveSettings();
  });
  $("#rtkNtripLoadMountpoints").on("click.rtkBase", async (event) => {
    event.preventDefault();
    const $button = $(event.currentTarget).prop("disabled", true);
    try {
      const settingsForCaster = collectNtripSettings();
      this.mountpoints = await rtkBaseStation.listNtripMountpoints(settingsForCaster);
      renderMountpoints();
      GUI.log(`Loaded ${this.mountpoints.length} live NTRIP mountpoints from ${escapeHtml(settingsForCaster.host)}.`);
    } catch (error) {
      this.mountpoints = [];
      renderMountpoints();
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    } finally {
      $button.prop("disabled", false);
    }
  });
  $("#rtkNtripMountpointList").on("change.rtkBase", () => {
    const $selected = $("#rtkNtripMountpointList option:selected");
    const record = $selected.data("summary");
    $("#rtkNtripMountpoint").val($selected.val());
    if (record?.requiresNmea && $("#rtkNtripGgaSource").val() === "none") {
      $("#rtkNtripGgaSource").val(
        $("#rtkNtripDestination").val() === "usb-base" ? "usb-base" : "aircraft",
      );
      updateModeVisibility();
    }
    saveSettings();
  });

  $("#rtkBaseRefreshPorts").on("click.rtkBase", (event) => {
    event.preventDefault();
    refreshPorts();
  });
  $("#rtkBaseProfile, #rtkBaseMode").on("change.rtkBase", () => {
    updateModeVisibility();
    saveSettings();
  });
  $("#rtkNtripGgaSource").on("change.rtkBase", () => {
    updateModeVisibility();
    saveSettings();
  });
  $("#rtkCorrectionSource").on("change.rtkBase", () => {
    rtkBaseStation.setCorrectionSource($("#rtkCorrectionSource").val());
    saveSettings();
    render();
  });
  $("#rtkNtripDestination").on("change.rtkBase", () => {
    rtkBaseStation.setNtripDestination($("#rtkNtripDestination").val());
    saveSettings();
    render();
  });
  $("#rtkBaseForward").on("change.rtkBase", () => {
    const enabled = $("#rtkBaseForward").is(":checked");
    rtkBaseStation.setForwarding(enabled);
    saveSettings();
  });
  $("#rtkBaseConnect").on("click.rtkBase", async (event) => {
    event.preventDefault();
    const current = saveSettings();
    const $button = $(event.currentTarget).prop("disabled", true);
    try {
      await rtkBaseStation.connect(current);
      GUI.log(`USB RTK base connected on ${escapeHtml(current.path)}.`);
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    } finally {
      $button.prop("disabled", rtkBaseStation.snapshot().connected);
      render();
    }
  });
  $("#rtkBaseDisconnect").on("click.rtkBase", async (event) => {
    event.preventDefault();
    try {
      await rtkBaseStation.disconnect();
      GUI.log("USB RTK base disconnected.");
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    }
  });
  $("#rtkBaseApply").on("click.rtkBase", async (event) => {
    event.preventDefault();
    const current = saveSettings();
    const $button = $(event.currentTarget).prop("disabled", true);
    try {
      await rtkBaseStation.configureF9Base(current);
      GUI.log(`u-blox F9 RTK base configured in ${escapeHtml(current.mode)} mode.`);
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    } finally {
      $button.prop("disabled", !rtkBaseStation.snapshot().connected);
      render();
    }
  });
  $("#rtkNtripConnect").on("click.rtkBase", async (event) => {
    event.preventDefault();
    saveSettings();
    const current = $("#rtkNtripDestination").val() === "usb-base"
      ? collectRefinementSettings()
      : collectNtripSettings();
    const $button = $(event.currentTarget).prop("disabled", true);
    try {
      if (current.destination === "usb-base") {
        await rtkBaseStation.beginNtripSurveyRefinement(current);
        $("#rtkNtripGgaSource").val("usb-base");
        GUI.log("NTRIP is refining the completed USB-base survey. Keep the antenna motionless until the fixed-sample window is ready.");
      } else {
        await rtkBaseStation.connectNtrip(current);
      }
      $("#rtkCorrectionSource").val("ntrip");
      saveSettings();
      GUI.log(`NTRIP correction stream connected at ${escapeHtml(current.host)}/${escapeHtml(current.mountpoint)}.`);
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    } finally {
      $button.prop("disabled", rtkBaseStation.snapshot().ntrip.connected);
      render();
    }
  });
  $("#rtkNtripDisconnect").on("click.rtkBase", async (event) => {
    event.preventDefault();
    try {
      const state = rtkBaseStation.snapshot();
      if (state.lastConfiguration?.mode === "ntrip-positioning") {
        await rtkBaseStation.cancelNtripSurveyRefinement(saveSettings());
        $("#rtkCorrectionSource").val("usb-base");
        saveSettings();
        GUI.log("NTRIP refinement cancelled. The completed survey-in position was restored as the local fixed base.");
      } else {
        await rtkBaseStation.disconnectNtrip();
        GUI.log("NTRIP correction stream disconnected.");
      }
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    }
  });
  $("#rtkBaseCaptureFixed").on("click.rtkBase", async (event) => {
    event.preventDefault();
    const $button = $(event.currentTarget).prop("disabled", true);
    try {
      const result = await rtkBaseStation.finalizeNtripRefinedBase(saveSettings());
      const fixed = result.fixed;
      $("#rtkBaseMode").val("fixed");
      $("#rtkBaseLatitude").val(fixed.latitude.toFixed(9));
      $("#rtkBaseLongitude").val(fixed.longitude.toFixed(9));
      setCanonicalDistanceInput("#rtkBaseHeight", fixed.ellipsoidHeightM);
      setCanonicalDistanceInput("#rtkBaseFixedAccuracy", fixed.fixedPositionAccuracyM);
      renderDistanceInputs(this.unitSystem);
      $("#rtkCorrectionSource").val("usb-base");
      updateModeVisibility();
      saveSettings();
      GUI.log(`Finalized the NTRIP-refined fixed base from ${fixed.samples} stable RTK Fixed samples. Fresh local RTCM will forward when the aircraft connects.`);
    } catch (error) {
      GUI.log(`<span class="error">${escapeHtml(error.message)}</span>`);
    } finally {
      $button.prop("disabled", rtkBaseStation.snapshot().refinement.phase !== "refined-ready");
      render();
    }
  });

  updateModeVisibility();
  updateWorkflowVisibility();
  await refreshPorts();
  if (mountToken !== this.mountToken || !$("#flightDataRtk").length) return;
  this.unsubscribe = rtkBaseStation.subscribe(render);
  this.pollTicks = 0;
  this.renderTimer = setInterval(() => {
    render();
    this.pollTicks += 1;
    if (this.pollTicks % 5 === 0) rtkBaseStation.pollStatus().catch(() => {});
  }, 1000);
  this.renderTimer.unref?.();
  if (callback) callback();
};

rtkBaseTab.setUnitSystem = function setUnitSystem(value) {
  captureDistanceInputs(this.unitSystem);
  this.unitSystem = normalizeGroundControlUnitSystem(value);
  renderDistanceInputs(this.unitSystem);
  this.renderCurrent?.();
  this.renderMountpointsCurrent?.();
};

rtkBaseTab.cleanup = function cleanup(callback) {
  this.mountToken += 1;
  $(".tab-rtk-base").off(".rtkBase");
  $("#rtkBaseRefreshPorts, #rtkBaseProfile, #rtkBaseMode, #rtkBaseForward, #rtkBaseConnect, #rtkBaseDisconnect, #rtkBaseApply, #rtkNtripProvider, #rtkNtripFreeOnly, #rtkNtripLoadMountpoints, #rtkNtripMountpointList, #rtkNtripGgaSource, #rtkCorrectionSource, #rtkNtripDestination, #rtkNtripConnect, #rtkNtripDisconnect, #rtkBaseCaptureFixed, [data-rtk-workflow-choice]")
    .off(".rtkBase");
  $("#rtkNtripPassword").val("");
  this.mountpoints = [];
  if (this.unsubscribe) this.unsubscribe();
  this.unsubscribe = null;
  if (this.renderTimer) clearInterval(this.renderTimer);
  this.renderTimer = null;
  this.renderCurrent = null;
  this.renderMountpointsCurrent = null;
  this.unitSystem = DEFAULT_GROUND_CONTROL_UNIT_SYSTEM;
  if (callback) callback();
};

export default rtkBaseTab;
