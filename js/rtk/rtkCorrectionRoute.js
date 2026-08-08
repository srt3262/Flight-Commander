"use strict";

import {
  FLIGHT_COMMANDER_CAPABILITIES,
  FIRMWARE_FAMILY_FLIGHT_COMMANDER,
} from "../flightCommander/firmwareIdentity.js";

const CAPABILITY = FLIGHT_COMMANDER_CAPABILITIES.GCS_RTK_BASE;

function capabilityEnabled(mask) {
  return (Number(mask) & CAPABILITY) === CAPABILITY;
}

export function resolveRtkCorrectionRoute(context = {}) {
  const mavlinkState = context.mavlinkState ?? {};
  if (
    mavlinkState.connected === true &&
    mavlinkState.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER &&
    capabilityEnabled(mavlinkState.flightCommanderCapabilities)
  ) {
    return { available: true, transport: "MAVLink" };
  }

  const identity = context.firmwareIdentity;
  if (
    context.connectionValid === true &&
    context.connectionProtocol === "msp" &&
    identity?.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER &&
    identity?.protocolSupported === true &&
    capabilityEnabled(identity.capabilities)
  ) {
    return { available: true, transport: "MSP" };
  }

  const unsupportedConnection =
    mavlinkState.connected === true || context.connectionValid === true;
  return {
    available: false,
    transport: null,
    reason: unsupportedConnection
      ? "USB RTK base corrections require supported Flight Commander Firmware with the advertised GCS_RTK_BASE capability."
      : "Connect Flight Commander Firmware over MSP or MAVLink to forward corrections.",
  };
}

export default resolveRtkCorrectionRoute;
