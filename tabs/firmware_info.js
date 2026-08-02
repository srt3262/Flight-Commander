"use strict";

import GUI from "./../js/gui";
import FC from "./../js/fc";
import {
  FLIGHT_COMMANDER_FEATURES,
  createInavFirmwareIdentity,
  firmwareFeatureSupport,
} from "./../js/flightCommander/firmwareIdentity";

const firmwareInfo = {};

firmwareInfo.initialize = function (callback) {
  if (GUI.active_tab !== this) GUI.active_tab = this;
  import("./firmware_info.html?raw").then(({ default: html }) => {
    GUI.load(html, () => {
      this.render();
      GUI.content_ready(callback);
    });
  });
};

firmwareInfo.render = function () {
  const identity =
    FC.CONFIG.firmwareIdentity ??
    createInavFirmwareIdentity(FC.CONFIG.flightControllerVersion);
  const isFork = identity.family === "flight-commander";
  const displayedVersion = isFork
    ? identity.firmwareVersion ?? "unsupported identity schema"
    : FC.CONFIG.flightControllerVersion;

  $("#firmwareInfoFamily").text(identity.displayName);
  $("#firmwareInfoVersion").text(displayedVersion);
  $("#firmwareInfoCompatibility").text(
    isFork
      ? `INAV ${identity.compatibleInavVersion} compatibility`
      : `INAV ${FC.CONFIG.flightControllerVersion}`,
  );
  $("#firmwareInfoTarget").text(FC.CONFIG.target || FC.CONFIG.boardIdentifier || "Unknown");
  $("#firmwareInfoSchema").text(
    identity.schemaVersion == null ? "Not advertised" : String(identity.schemaVersion),
  );
  $("#firmwareInfoCapabilities").text(
    `0x${Number(identity.capabilities ?? 0).toString(16).padStart(8, "0")}`,
  );

  const summary = isFork
    ? identity.protocolSupported
      ? `Flight Commander Firmware ${displayedVersion} is identified through the versioned FCFW extension. Only explicitly advertised capabilities are enabled.`
      : identity.probeError
    : "Standard INAV is connected. All INAV configuration and Ground Control functions remain available; Flight Commander Firmware-only capabilities are locked.";
  $("#firmwareInfoSummary")
    .text(summary)
    .toggleClass("fc-action-status--error", isFork && !identity.protocolSupported);

  for (const featureKey of Object.keys(FLIGHT_COMMANDER_FEATURES)) {
    const support = firmwareFeatureSupport(identity, featureKey);
    const card = $(`[data-fc-feature="${featureKey}"]`);
    card
      .toggleClass("fc-firmware-feature--enabled", support.enabled)
      .toggleClass("fc-firmware-feature--locked", !support.enabled);
    card.find(".fc-firmware-feature__state")
      .text(support.enabled ? "Advertised" : "Disabled")
      .toggleClass("fc-pill--ready", support.enabled)
      .toggleClass("fc-pill--locked", !support.enabled);
    card.find(".fc-firmware-feature__reason").text(support.reason);
  }
};

firmwareInfo.cleanup = function (callback) {
  if (callback) callback();
};

export default firmwareInfo;
