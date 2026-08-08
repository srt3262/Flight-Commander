"use strict";

export function resolveRtkCorrectionRoute(context = {}) {
  const mavlinkState = context.mavlinkState ?? {};
  if (mavlinkState.connected === true) {
    return { available: true, transport: "MAVLink" };
  }

  if (
    context.connectionValid === true &&
    context.connectionProtocol === "msp"
  ) {
    return { available: true, transport: "MSP" };
  }

  const unsupportedConnection =
    mavlinkState.connected === true || context.connectionValid === true;
  return {
    available: false,
    transport: null,
    reason: unsupportedConnection
      ? "RTK correction forwarding requires an active Flight Commander MSP or MAVLink transport."
      : "Connect Flight Commander Firmware over MSP or MAVLink to forward corrections.",
  };
}

export default resolveRtkCorrectionRoute;
