"use strict";

import GUI from "./../js/gui";
import FC from "./../js/fc";
import {
  FLIGHT_COMMANDER_FEATURES,
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
  const identity = FC.CONFIG.firmwareIdentity;
  const supported = identity?.family === "flight-commander"
    && identity.protocolSupported === true;
  const displayedVersion = supported
    ? identity.firmwareVersion ?? "unknown"
    : FC.CONFIG.reportedFirmwareVersion || FC.CONFIG.flightControllerVersion || "--";

  $("#firmwareInfoFamily").text(
    supported ? "Flight Commander Firmware" : "Unsupported firmware",
  );
  $("#firmwareInfoVersion").text(displayedVersion);
  $("#firmwareInfoCompatibility").text(
    supported ? `Protocol baseline ${identity.compatibleInavVersion}` : "Not available",
  );
  $("#firmwareInfoTarget").text(FC.CONFIG.target || FC.CONFIG.boardIdentifier || "Unknown");
  $("#firmwareInfoSchema").text(
    identity?.schemaVersion == null ? "Not advertised" : String(identity.schemaVersion),
  );
  $("#firmwareInfoCapabilities").text(
    `0x${Number(identity?.capabilities ?? 0).toString(16).padStart(8, "0")}`,
  );

  $("#firmwareInfoSummary")
    .text(
      supported
        ? `Flight Commander Firmware ${displayedVersion} is verified through the versioned FCFW identity. Only explicitly advertised capabilities are enabled.`
        : "Only Flight Commander Firmware is supported. Reflash this controller with a valid Flight Commander image before using configuration, planning, or Ground Control.",
    )
    .toggleClass("fc-action-status--error", !supported);

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
