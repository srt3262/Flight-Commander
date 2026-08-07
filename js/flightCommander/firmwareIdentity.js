"use strict";

export const MSP2_FLIGHT_COMMANDER_INFO = 0x2f00;
export const FLIGHT_COMMANDER_INFO_SIGNATURE = "FCFW";
export const FLIGHT_COMMANDER_INFO_SCHEMA_VERSION = 1;
export const FLIGHT_COMMANDER_INFO_PAYLOAD_SIZE = 15;

export const FIRMWARE_FAMILY_INAV = "inav";
export const FIRMWARE_FAMILY_FLIGHT_COMMANDER = "flight-commander";

export function isInavCompatibleFirmwareVariant(value) {
  return value === "INAV" || value === FLIGHT_COMMANDER_INFO_SIGNATURE;
}

export const FLIGHT_COMMANDER_CAPABILITIES = Object.freeze({
  MULTIROTOR_AUTOTUNE: 1 << 0,
  TERRAIN_WAYPOINTS: 1 << 1,
  MISSION_STREAMING: 1 << 2,
  RTK_GPS_UART: 1 << 3,
  DRONECAN: 1 << 4,
  DRONECAN_GPS: 1 << 5,
  NATIVE_GCS_COMMANDS: 1 << 6,
  PHOTO_TRIGGERS: 1 << 7,
  DRONECAN_NODE_CONFIG: 1 << 8,
  MISSION_RESUME: 1 << 9,
  GCS_RTK_BASE: 1 << 10,
  HEADING_FUSION: 1 << 11,
  MOVING_BASELINE_YAW: 1 << 12,
  DRONECAN_MOVING_BASELINE_MANAGER: 1 << 13,
  COMPASS_ORIENTATION_LEARNING: 1 << 14,
  INDIVIDUAL_COMPASS_CALIBRATION: 1 << 15,
});

export const FLIGHT_COMMANDER_FEATURES = Object.freeze({
  multirotorAutotune: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MULTIROTOR_AUTOTUNE,
    capabilityName: "MULTIROTOR_AUTOTUNE",
    label: "Multirotor AutoTune",
  }),
  terrainWaypoints: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.TERRAIN_WAYPOINTS,
    capabilityName: "TERRAIN_WAYPOINTS",
    label: "Terrain-relative waypoints",
  }),
  missionStreaming: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MISSION_STREAMING,
    capabilityName: "MISSION_STREAMING",
    label: "Mission streaming",
  }),
  rtkGpsUart: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.RTK_GPS_UART,
    capabilityName: "RTK_GPS_UART",
    label: "UART RTK corrections",
  }),
  dronecan: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.DRONECAN,
    capabilityName: "DRONECAN",
    label: "DroneCAN bus",
  }),
  dronecanGps: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.DRONECAN_GPS,
    capabilityName: "DRONECAN_GPS",
    label: "Concurrent selectable-primary DroneCAN GPS and RTK",
  }),
  nativeGcsCommands: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS,
    capabilityName: "NATIVE_GCS_COMMANDS",
    label: "Native Ground Control commands",
  }),
  photoTriggers: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.PHOTO_TRIGGERS,
    capabilityName: "PHOTO_TRIGGERS",
    label: "MAVLink mission photo triggers",
  }),
  dronecanNodeConfig: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.DRONECAN_NODE_CONFIG,
    capabilityName: "DRONECAN_NODE_CONFIG",
    label: "DroneCAN node configuration",
  }),
  missionResume: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MISSION_RESUME,
    capabilityName: "MISSION_RESUME",
    label: "Mission resume",
  }),
  gcsRtkBase: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.GCS_RTK_BASE,
    capabilityName: "GCS_RTK_BASE",
    label: "USB RTK base-station bridge",
  }),
  headingFusion: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.HEADING_FUSION,
    capabilityName: "HEADING_FUSION",
    label: "Weighted compass and heading-source fusion",
  }),
  movingBaselineYaw: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.MOVING_BASELINE_YAW,
    capabilityName: "MOVING_BASELINE_YAW",
    label: "Dual-GNSS moving-baseline yaw",
  }),
  dronecanMovingBaselineManager: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.DRONECAN_MOVING_BASELINE_MANAGER,
    capabilityName: "DRONECAN_MOVING_BASELINE_MANAGER",
    label: "Two-node DroneCAN moving-baseline setup manager",
  }),
  compassOrientationLearning: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.COMPASS_ORIENTATION_LEARNING,
    capabilityName: "COMPASS_ORIENTATION_LEARNING",
    label: "Persistent learned compass-to-board orientation",
  }),
  individualCompassCalibration: Object.freeze({
    capability: FLIGHT_COMMANDER_CAPABILITIES.INDIVIDUAL_COMPASS_CALIBRATION,
    capabilityName: "INDIVIDUAL_COMPASS_CALIBRATION",
    label: "Per-source compass orientation and field calibration",
  }),
});

const KNOWN_CAPABILITY_MASK = Object.values(FLIGHT_COMMANDER_CAPABILITIES)
  .reduce((mask, capability) => mask | capability, 0) >>> 0;

export class FlightCommanderIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FlightCommanderIdentityError";
    this.code = code;
  }
}
function payloadView(response) {
  const payload = response?.data ?? response;
  if (payload instanceof DataView) return payload;
  if (payload instanceof ArrayBuffer) return new DataView(payload);
  if (ArrayBuffer.isView(payload)) {
    return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (Array.isArray(payload)) {
    const bytes = Uint8Array.from(payload);
    return new DataView(bytes.buffer);
  }
  return new DataView(new ArrayBuffer(0));
}

function ascii(view, offset, length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function version(view, offset) {
  return `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}`;
}

function capabilityNames(mask) {
  return Object.entries(FLIGHT_COMMANDER_CAPABILITIES)
    .filter(([, capability]) => (mask & capability) === capability)
    .map(([name]) => name);
}

function immutableIdentity(identity) {
  return Object.freeze({
    ...identity,
    capabilityNames: Object.freeze([...(identity.capabilityNames ?? [])]),
  });
}

export function createInavFirmwareIdentity(
  compatibleInavVersion = "0.0.0",
  probe = {},
) {
  return immutableIdentity({
    family: FIRMWARE_FAMILY_INAV,
    displayName: "Official INAV",
    detected: false,
    protocolSupported: false,
    schemaVersion: null,
    firmwareVersion: null,
    compatibleInavVersion,
    capabilities: 0,
    capabilityNames: [],
    unknownCapabilities: 0,
    probeStatus: probe.probeStatus ?? "not-advertised",
    probeError: probe.probeError ?? null,
  });
}

export function inspectFlightCommanderInfo(
  response,
  compatibleInavVersion = "0.0.0",
) {
  const view = payloadView(response);
  if (view.byteLength === 0) {
    return createInavFirmwareIdentity(compatibleInavVersion);
  }
  if (view.byteLength < 5) {
    throw new FlightCommanderIdentityError(
      "INVALID_LENGTH",
      `Flight Commander identity payload must contain at least 5 bytes; received ${view.byteLength}.`,
    );
  }
  const signature = ascii(view, 0, 4);
  if (signature !== FLIGHT_COMMANDER_INFO_SIGNATURE) {
    throw new FlightCommanderIdentityError(
      "INVALID_SIGNATURE",
      `Flight Commander identity signature is ${JSON.stringify(signature)}, not ${FLIGHT_COMMANDER_INFO_SIGNATURE}.`,
    );
  }

  const schemaVersion = view.getUint8(4);
  if (schemaVersion !== FLIGHT_COMMANDER_INFO_SCHEMA_VERSION) {
    return immutableIdentity({
      family: FIRMWARE_FAMILY_FLIGHT_COMMANDER,
      displayName: "Flight Commander Firmware",
      detected: true,
      protocolSupported: false,
      schemaVersion,
      firmwareVersion: null,
      compatibleInavVersion,
      capabilities: 0,
      capabilityNames: [],
      unknownCapabilities: 0,
      probeStatus: "unsupported-schema",
      probeError:
        `Flight Commander identity schema ${schemaVersion} is newer than the supported schema ${FLIGHT_COMMANDER_INFO_SCHEMA_VERSION}. Fork-only features are disabled.`,
    });
  }
  if (view.byteLength !== FLIGHT_COMMANDER_INFO_PAYLOAD_SIZE) {
    throw new FlightCommanderIdentityError(
      "INVALID_LENGTH",
      `Flight Commander identity schema ${schemaVersion} requires exactly ${FLIGHT_COMMANDER_INFO_PAYLOAD_SIZE} bytes; received ${view.byteLength}.`,
    );
  }

  const capabilities = view.getUint32(11, true) >>> 0;
  return immutableIdentity({
    family: FIRMWARE_FAMILY_FLIGHT_COMMANDER,
    displayName: "Flight Commander Firmware",
    detected: true,
    protocolSupported: true,
    schemaVersion,
    firmwareVersion: version(view, 5),
    compatibleInavVersion: version(view, 8),
    capabilities,
    capabilityNames: capabilityNames(capabilities),
    unknownCapabilities: (capabilities & ~KNOWN_CAPABILITY_MASK) >>> 0,
    probeStatus: "identified",
    probeError: null,
  });
}

export function firmwareFeatureSupport(identity, featureKey) {
  const feature = FLIGHT_COMMANDER_FEATURES[featureKey];
  if (!feature) {
    throw new FlightCommanderIdentityError(
      "UNKNOWN_FEATURE",
      `Unknown Flight Commander firmware feature ${JSON.stringify(featureKey)}.`,
    );
  }
  if (identity?.family !== FIRMWARE_FAMILY_FLIGHT_COMMANDER) {
    return Object.freeze({
      featureKey,
      ...feature,
      enabled: false,
      reason: `${feature.label} requires Flight Commander Firmware. Standard INAV remains supported, but this fork-only feature is disabled.`,
    });
  }
  if (identity.protocolSupported !== true) {
    return Object.freeze({
      featureKey,
      ...feature,
      enabled: false,
      reason:
        identity.probeError ??
        `${feature.label} is disabled because the firmware identity schema is not supported.`,
    });
  }
  const enabled =
    (Number(identity.capabilities) & feature.capability) === feature.capability;
  return Object.freeze({
    featureKey,
    ...feature,
    enabled,
    reason: enabled
      ? `${feature.label} is advertised by Flight Commander Firmware ${identity.firmwareVersion}.`
      : `Flight Commander Firmware ${identity.firmwareVersion ?? "unknown"} does not advertise ${feature.capabilityName}; the feature is disabled.`,
  });
}

export function applyFirmwareIdentity(FC, identity) {
  if (!FC?.CONFIG) {
    throw new TypeError("Flight-controller state is required to apply firmware identity.");
  }
  FC.CONFIG.firmwareFamily = identity.family;
  FC.CONFIG.firmwareIdentity = identity;
  FC.CONFIG.flightCommanderFirmware =
    identity.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER ? identity : null;
  if (identity.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER) {
    FC.CONFIG.reportedFirmwareVersion = FC.CONFIG.flightControllerVersion;
    FC.CONFIG.flightControllerVersion = identity.compatibleInavVersion;
  } else {
    FC.CONFIG.reportedFirmwareVersion = FC.CONFIG.flightControllerVersion;
  }
  return identity;
}

export async function probeFlightCommanderFirmware({
  MSP,
  MSPCodes,
  compatibleInavVersion = "0.0.0",
}) {
  if (!MSP || typeof MSP.send_message !== "function") {
    throw new TypeError("An MSP transport is required for Flight Commander identity discovery.");
  }
  const command =
    MSPCodes?.MSP2_FLIGHT_COMMANDER_INFO ?? MSP2_FLIGHT_COMMANDER_INFO;
  const protocolVersion = MSP.constants?.PROTOCOL_V2 ?? 2;

  let response;
  try {
    response = await new Promise((resolve) => {
      const queued = MSP.send_message(
        command,
        false,
        false,
        resolve,
        protocolVersion,
        { retryCounter: 0 },
      );
      if (queued === false) resolve(false);
    });
  } catch (error) {
    return createInavFirmwareIdentity(compatibleInavVersion, {
      probeStatus: "probe-error",
      probeError: error?.message ?? String(error),
    });
  }

  if (!response) {
    return createInavFirmwareIdentity(compatibleInavVersion, {
      probeStatus: "no-response",
    });
  }
  try {
    return inspectFlightCommanderInfo(response, compatibleInavVersion);
  } catch (error) {
    return createInavFirmwareIdentity(compatibleInavVersion, {
      probeStatus: "invalid-response",
      probeError: error?.message ?? String(error),
    });
  }
}
