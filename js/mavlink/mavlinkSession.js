"use strict";

import {
  VEHICLE_TYPES,
  modeMapForVehicle,
  modeName,
  modeNumber,
  vehicleFamily,
} from "./ardupilotModes.js";
import { field, normalizeMavlinkEnvelope } from "./frameNormalizer.js";

export const MAV_AUTOPILOT_INVALID = 8;
export const MAV_AUTOPILOT_GENERIC = 0;
export const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
export const MAV_TYPE_GCS = 6;
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1;
export const MAV_MODE_FLAG_SAFETY_ARMED = 128;
export const MAV_STATE_ACTIVE = 4;
export const MAV_RESULT_ACCEPTED = 0;
export const MAV_RESULT_IN_PROGRESS = 5;
export const MAV_CMD_NAV_TAKEOFF = 22;
export const MAV_CMD_DO_SET_MISSION_CURRENT = 224;
export const MAV_CMD_MISSION_START = 300;
export const MAV_CMD_COMPONENT_ARM_DISARM = 400;
export const MAV_CMD_SET_MESSAGE_INTERVAL = 511;
export const MAV_CMD_REQUEST_MESSAGE = 512;
export const MAVLINK_MSG_ID_AUTOPILOT_VERSION = 148;
export const MAV_DATA_STREAM_ALL = 0;

export const FIRMWARE_FAMILY_UNKNOWN = "unknown";
export const FIRMWARE_FAMILY_INAV = "inav";
export const FIRMWARE_FAMILY_ARDUPILOT = "ardupilot";

const FIRMWARE_FAMILIES = new Set([
  FIRMWARE_FAMILY_INAV,
  FIRMWARE_FAMILY_ARDUPILOT,
]);
const COMMAND_ACK_NAMES = new Set(["COMMAND_ACK", "CommandAck"]);
const PARAM_VALUE_NAMES = new Set(["PARAM_VALUE", "ParamValue"]);
const MISSION_CURRENT_NAMES = new Set(["MISSION_CURRENT", "MissionCurrent"]);
const AIRBORNE_VEHICLE_TYPES = new Set([
  1, 2, 3, 4, 13, 14, 15, 19, 20, 21, 29,
]);
const MAV_AUTOPILOT_NAMES = Object.freeze({
  0: "Generic",
  3: "ArduPilot",
  12: "PX4",
  13: "SMACCMPilot",
});
const MAV_RESULT_NAMES = Object.freeze({
  0: "accepted",
  1: "temporarily rejected",
  2: "denied",
  3: "unsupported",
  4: "failed",
  5: "in progress",
  6: "cancelled",
  7: "command cancelled",
});
const FIRMWARE_VERSION_TYPE_NAMES = new Map([
  [0, "development"],
  [64, "alpha"],
  [128, "beta"],
  [192, "release candidate"],
  [255, "official"],
]);
const FIRMWARE_VERSION_TYPE_SUFFIXES = new Map([
  [0, "-dev"],
  [64, "-alpha"],
  [128, "-beta"],
  [192, "-rc"],
  [255, ""],
]);
const MISSION_CURRENT_FIELD_LENGTHS = Object.freeze({
  total: 4,
  missionState: 5,
  missionMode: 6,
  missionId: 10,
});
const BOOT_TIME_REORDER_TOLERANCE_MS = 2000;
const DEFAULT_DISCOVERY_DELAY_MS = 1000;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mavlinkUint8(value, { allowZero = true } = {}) {
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(value) && value >= minimum && value <= 255
    ? value
    : null;
}

export function normalizeUnsignedInteger(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) &&
    Number.isInteger(number) &&
    number >= 0 &&
    number <= maximum
    ? number
    : null;
}

function normalizeUint64Decimal(value) {
  if (value == null || value === "") return null;
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    const number = BigInt(value);
    return number >= 0n && number <= 0xffffffffffffffffn
      ? number.toString(10)
      : null;
  } catch {
    return null;
  }
}

function normalizeByteArray(value) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) return [];
  return Array.from(value)
    .map((byte) => normalizeUnsignedInteger(byte, 255))
    .filter((byte) => byte != null);
}

function bytesToHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeMavlinkFirmwareVersion(value) {
  const raw = normalizeUnsignedInteger(value, 0xffffffff);
  if (raw == null) return null;
  const major = Math.floor(raw / 0x1000000) & 0xff;
  const minor = Math.floor(raw / 0x10000) & 0xff;
  const patch = Math.floor(raw / 0x100) & 0xff;
  const releaseType = raw & 0xff;
  const releaseTypeName =
    FIRMWARE_VERSION_TYPE_NAMES.get(releaseType) ?? `unknown (${releaseType})`;
  const suffix =
    FIRMWARE_VERSION_TYPE_SUFFIXES.get(releaseType) ?? `-type-${releaseType}`;
  return {
    raw,
    major,
    minor,
    patch,
    releaseType,
    releaseTypeName,
    formatted: `${major}.${minor}.${patch}${suffix}`,
  };
}

function cloneAutopilotVersion(version) {
  if (!version) return null;
  return {
    ...version,
    flight: version.flight ? { ...version.flight } : null,
    middleware: version.middleware ? { ...version.middleware } : null,
    os: version.os ? { ...version.os } : null,
    flightCustomVersion: [...version.flightCustomVersion],
    middlewareCustomVersion: [...version.middlewareCustomVersion],
    osCustomVersion: [...version.osCustomVersion],
    uid2: [...version.uid2],
  };
}

export function createInitialMavlinkState() {
  return {
    connected: false,
    linkLost: false,
    protocolVersion: null,
    systemId: null,
    componentId: null,
    autopilot: null,
    autopilotName: "Unknown",
    firmwareFamily: FIRMWARE_FAMILY_UNKNOWN,
    firmwareFamilySource: "unresolved",
    vehicleType: null,
    vehicleTypeName: "Unknown",
    armed: false,
    baseMode: 0,
    customMode: 0,
    modeName: "Unknown",
    systemStatus: 0,
    autopilotVersion: null,
    latitude: null,
    longitude: null,
    homeLatitude: null,
    homeLongitude: null,
    homeAltitudeMsl: null,
    altitudeMsl: null,
    relativeAltitude: null,
    groundSpeed: null,
    airSpeed: null,
    climbRate: null,
    heading: null,
    roll: null,
    pitch: null,
    yaw: null,
    voltage: null,
    current: null,
    batteryRemaining: null,
    gpsFix: 0,
    satellites: 0,
    hdop: null,
    rssi: null,
    rcChannelCount: 0,
    rcChannels: [],
    timeBootMs: null,
    bootGeneration: 0,
    missionCurrent: null,
    missionTotal: null,
    missionReached: null,
    missionState: null,
    missionMode: null,
    missionId: null,
    distanceToWaypoint: null,
    lastHeartbeatAt: 0,
    statusText: [],
  };
}

function missionCurrentFieldPresent(envelope, name) {
  const minimumLength = MISSION_CURRENT_FIELD_LENGTHS[name];
  const payloadLength = normalizeUnsignedInteger(
    envelope?.header?.payloadLength,
    255,
  );
  if (payloadLength != null) return payloadLength >= minimumLength;
  return (
    Object.prototype.hasOwnProperty.call(envelope?.data ?? {}, name) ||
    Object.prototype.hasOwnProperty.call(
      envelope?.data ?? {},
      name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    )
  );
}

export function createMissionResumeError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  if (options.clearCheckpoint) error.clearCheckpoint = true;
  return error;
}

export function createMavlinkAttachmentError(
  description = "the MAVLink operation",
) {
  const error = new Error(
    `The MAVLink transport detached before ${description} completed.`,
  );
  error.code = "MAVLINK_SESSION_DETACHED";
  return error;
}

function timerUnref(timer) {
  timer?.unref?.();
  return timer;
}

export class MavlinkSession {
  constructor(options = {}) {
    this.connection = null;
    this.attachmentGeneration = 0;
    this.listeners = new Map();
    this.state = createInitialMavlinkState();
    this.initialized = false;
    this.ipcHandler = null;
    this.watchdog = null;
    this.gcsHeartbeat = null;
    this.gcsHeartbeatStartTimer = null;
    this.firmwareDetectionTimer = null;
    this.firmwareDetectionTimeoutMs =
      options.firmwareDetectionTimeoutMs ?? 1500;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5000;
    this.discoveryDelayMs =
      options.discoveryDelayMs ?? DEFAULT_DISCOVERY_DELAY_MS;
    this.firmwareFamilyOverride = options.firmwareFamilyOverride ?? null;
    this.bridge = options.bridge ?? globalThis.window?.electronAPI ?? null;
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.listenerErrorHandler =
      options.listenerErrorHandler ??
      ((error, eventName) => {
        console.error(
          `MAVLink ${eventName} listener failed:`,
          error,
        );
      });
    this.readHandler = null;
    this.reportedDiscoveryVersions = new Set();
    this.reportedReceiveBytes = false;
    this.reportedValidFrame = false;
    this.lastDiscoveryErrors = new Map();
    this.discoveryHeartbeatInFlight = false;

    if (this.firmwareFamilyOverride != null) {
      this.validateFirmwareFamily(this.firmwareFamilyOverride);
      this.state.firmwareFamily = this.firmwareFamilyOverride;
      this.state.firmwareFamilySource = "override";
    }
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof this.bridge?.onMavlinkMessage === "function") {
      this.ipcHandler = this.bridge.onMavlinkMessage((envelope) =>
        this.handleMessage(envelope, { requireGeneration: true }),
      );
    }
    this.watchdog = timerUnref(
      this.setIntervalFn(() => this.checkHeartbeat(), 1000),
    );
  }

  attach(connection) {
    if (
      !connection ||
      typeof connection.addOnReceiveListener !== "function" ||
      typeof connection.removeOnReceiveCallback !== "function" ||
      typeof connection.send !== "function"
    ) {
      throw new TypeError(
        "A MAVLink-compatible serial connection is required.",
      );
    }
    this.init();
    this.detach();
    this.connection = connection;
    this.state = createInitialMavlinkState();
    this.applyFirmwareFamilyOverride();
    this.reportedDiscoveryVersions.clear();
    this.reportedReceiveBytes = false;
    this.reportedValidFrame = false;
    this.lastDiscoveryErrors.clear();
    this.discoveryHeartbeatInFlight = false;
    const attachment = this.activeAttachment("receiving MAVLink data");
    this.readHandler = (event) => this.read(event, attachment);
    try {
      connection.addOnReceiveListener(this.readHandler);
      // A number of MAVLink radio transports (including ExpressLRS standalone
      // mode) wait for traffic from the GCS before they start forwarding the
      // vehicle link. Mission Planner allows the USB device to settle, then
      // probes with MAVLink v1 until it observes the vehicle. Match that
      // startup sequence, then lock outbound traffic to the detected protocol.
      this.startGcsHeartbeat();
      this.emit("state", this.snapshot());
    } catch (error) {
      this.stopGcsHeartbeat();
      connection.removeOnReceiveCallback(this.readHandler);
      this.readHandler = null;
      this.connection = null;
      this.attachmentGeneration += 1;
      this.state = createInitialMavlinkState();
      this.applyFirmwareFamilyOverride();
      this.bridge?.mavlinkReset?.(this.attachmentGeneration);
      throw error;
    }
  }

  detach() {
    this.stopGcsHeartbeat();
    this.stopFirmwareDetection();
    if (this.connection) {
      this.emit("detached", this.snapshot());
      if (this.readHandler) {
        this.connection.removeOnReceiveCallback(this.readHandler);
      }
    }
    this.readHandler = null;
    this.connection = null;
    this.attachmentGeneration += 1;
    this.state = createInitialMavlinkState();
    this.applyFirmwareFamilyOverride();
    this.bridge?.mavlinkReset?.(this.attachmentGeneration);
  }

  destroy() {
    this.detach();
    if (this.watchdog != null) {
      this.clearIntervalFn(this.watchdog);
      this.watchdog = null;
    }
    if (this.ipcHandler) {
      if (typeof this.bridge?.offMavlinkMessage === "function") {
        this.bridge.offMavlinkMessage(this.ipcHandler);
      } else if (typeof this.ipcHandler === "function") {
        // Compatibility for injected test bridges which return an unsubscribe
        // closure instead of the Electron preload's raw listener token.
        this.ipcHandler();
      }
    }
    this.ipcHandler = null;
    this.listeners.clear();
    this.initialized = false;
  }

  read(event, attachment = null) {
    const activeAttachment =
      attachment ??
      (this.connection
        ? {
            connection: this.connection,
            generation: this.attachmentGeneration,
          }
        : null);
    if (event?.data != null && this.attachmentIsCurrent(activeAttachment)) {
      if (!this.reportedReceiveBytes) {
        const byteLength =
          Number(event.data?.byteLength) ||
          Number(event.data?.length) ||
          0;
        this.reportedReceiveBytes = true;
        this.emit("transportDiagnostic", {
          stage: "serial-bytes-received",
          byteLength,
          generation: activeAttachment.generation,
        });
      }
      this.bridge?.mavlinkFeed?.(event.data, activeAttachment.generation);
    }
  }

  on(eventName, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("MAVLink event listener must be a function.");
    }
    if (!this.listeners.has(eventName))
      this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(listener);
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    const listeners = this.listeners.get(eventName);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.listeners.delete(eventName);
  }

  emit(eventName, value) {
    for (const listener of [...(this.listeners.get(eventName) ?? [])]) {
      try {
        listener(value);
      } catch (error) {
        try {
          this.listenerErrorHandler(error, eventName);
        } catch {
          // Diagnostics must never be able to interrupt the transport.
        }
      }
    }
  }

  snapshot() {
    return {
      ...this.state,
      statusText: this.state.statusText.map((entry) => ({ ...entry })),
      rcChannels: [...this.state.rcChannels],
      autopilotVersion: cloneAutopilotVersion(this.state.autopilotVersion),
    };
  }

  activeAttachment(description = "the MAVLink operation") {
    if (!this.connection) {
      throw createMavlinkAttachmentError(description);
    }
    return {
      connection: this.connection,
      generation: this.attachmentGeneration,
      description,
    };
  }

  attachmentIsCurrent(attachment) {
    return Boolean(
      attachment &&
      this.connection === attachment.connection &&
      this.attachmentGeneration === attachment.generation,
    );
  }

  trackTimeBootMs(value) {
    const timeBootMs = normalizeUnsignedInteger(value, 0xffffffff);
    if (timeBootMs == null) return;
    const previous = this.state.timeBootMs;
    if (previous == null || timeBootMs >= previous) {
      this.state.timeBootMs = timeBootMs;
      return;
    }
    if (previous - timeBootMs <= BOOT_TIME_REORDER_TOLERANCE_MS) return;

    this.state.timeBootMs = timeBootMs;
    this.state.bootGeneration += 1;
    const event = {
      error: createMissionResumeError(
        "VEHICLE_REBOOTED",
        "The flight controller boot clock restarted; saved mission-resume checkpoints are no longer valid.",
        { clearCheckpoint: true },
      ),
      previousTimeBootMs: previous,
      timeBootMs,
      bootGeneration: this.state.bootGeneration,
    };
    this.emit("vehicleRebootDetected", event);
    this.emit("missionCheckpointInvalid", event);
  }

  handleMessage(frame, { requireGeneration = false } = {}) {
    if (!this.connection) return false;
    if (
      (requireGeneration || frame?.generation != null) &&
      frame?.generation !== this.attachmentGeneration
    ) {
      return false;
    }
    const envelope = normalizeMavlinkEnvelope(frame);
    const { messageName, data, header } = envelope;
    if (!this.reportedValidFrame) {
      this.reportedValidFrame = true;
      this.emit("transportDiagnostic", {
        stage: "valid-frame-decoded",
        messageName,
        protocol: envelope.protocol,
        generation: this.attachmentGeneration,
      });
    }

    if (
      messageName === "Heartbeat" &&
      !this.handleHeartbeat(data, header, envelope.protocol)
    ) {
      return false;
    }
    if (
      this.state.systemId != null &&
      header.sysid != null &&
      header.sysid !== this.state.systemId
    ) {
      this.emit("systemDiscovered", envelope);
      return;
    }

    if (
      this.state.componentId == null ||
      header.compid == null ||
      header.compid === this.state.componentId
    ) {
      this.trackTimeBootMs(field(data, "timeBootMs", "time_boot_ms"));
    }

    switch (messageName) {
      case "GlobalPositionInt": {
        const lat = numeric(field(data, "lat"));
        const lon = numeric(field(data, "lon"));
        const altitude = numeric(field(data, "alt"));
        const relativeAltitude = numeric(
          field(data, "relativeAlt", "relative_alt"),
        );
        const vx = numeric(field(data, "vx"));
        const vy = numeric(field(data, "vy"));
        const heading = numeric(field(data, "hdg"));
        this.state.latitude = lat == null ? null : lat / 1e7;
        this.state.longitude = lon == null ? null : lon / 1e7;
        this.state.altitudeMsl = altitude == null ? null : altitude / 1000;
        this.state.relativeAltitude =
          relativeAltitude == null ? null : relativeAltitude / 1000;
        this.state.groundSpeed =
          vx == null || vy == null ? null : Math.hypot(vx, vy) / 100;
        this.state.heading =
          heading == null || heading === 65535 ? null : heading / 100;
        this.emit("telemetry", this.snapshot());
        break;
      }
      case "HomePosition": {
        const latitude = numeric(field(data, "latitude"));
        const longitude = numeric(field(data, "longitude"));
        const altitude = numeric(field(data, "altitude"));
        this.state.homeLatitude = latitude == null ? null : latitude / 1e7;
        this.state.homeLongitude = longitude == null ? null : longitude / 1e7;
        this.state.homeAltitudeMsl = altitude == null ? null : altitude / 1000;
        break;
      }
      case "GpsRawInt": {
        this.state.gpsFix = numeric(field(data, "fixType", "fix_type")) ?? 0;
        const satellites = numeric(
          field(data, "satellitesVisible", "satellites_visible"),
        );
        this.state.satellites =
          satellites == null || satellites === 255 ? null : satellites;
        const eph = numeric(field(data, "eph"));
        this.state.hdop = eph == null || eph === 65535 ? null : eph / 100;
        break;
      }
      case "Attitude": {
        const toDegrees = (value) => {
          const number = numeric(value);
          return number == null ? null : (number * 180) / Math.PI;
        };
        this.state.roll = toDegrees(field(data, "roll"));
        this.state.pitch = toDegrees(field(data, "pitch"));
        this.state.yaw = toDegrees(field(data, "yaw"));
        break;
      }
      case "SysStatus": {
        const voltage = numeric(
          field(data, "voltageBattery", "voltage_battery"),
        );
        const current = numeric(
          field(data, "currentBattery", "current_battery"),
        );
        const remaining = numeric(
          field(data, "batteryRemaining", "battery_remaining"),
        );
        this.state.voltage =
          voltage == null || voltage === 65535 ? null : voltage / 1000;
        this.state.current =
          current == null || current === -1 ? null : current / 100;
        this.state.batteryRemaining =
          remaining == null || remaining === -1 ? null : remaining;
        break;
      }
      case "VfrHud":
        this.state.airSpeed = numeric(field(data, "airspeed"));
        this.state.groundSpeed = numeric(field(data, "groundspeed"));
        this.state.climbRate = numeric(field(data, "climb"));
        this.state.heading = numeric(field(data, "heading"));
        break;
      case "RadioStatus":
        this.state.rssi = numeric(field(data, "rssi"));
        break;
      case "RcChannels":
        this.handleRcChannels(data);
        break;
      case "RcChannelsRaw":
        this.handleRcChannelsRaw(data);
        break;
      case "ParamValue":
        this.handleFirmwareFingerprint(envelope);
        break;
      case "AutopilotVersion":
        this.handleAutopilotVersion(data);
        break;
      case "MissionCurrent":
        this.state.missionCurrent = normalizeUnsignedInteger(
          field(data, "seq"),
          65535,
        );
        if (missionCurrentFieldPresent(envelope, "total")) {
          const total = normalizeUnsignedInteger(field(data, "total"), 65535);
          if (total != null && total !== 0)
            this.state.missionTotal = total === 65535 ? 0 : total;
        }
        if (missionCurrentFieldPresent(envelope, "missionState")) {
          const missionState = normalizeUnsignedInteger(
            field(data, "missionState", "mission_state"),
            255,
          );
          if (missionState != null) this.state.missionState = missionState;
        }
        if (missionCurrentFieldPresent(envelope, "missionMode")) {
          const missionMode = normalizeUnsignedInteger(
            field(data, "missionMode", "mission_mode"),
            255,
          );
          if (missionMode != null) this.state.missionMode = missionMode;
        }
        if (missionCurrentFieldPresent(envelope, "missionId")) {
          const missionId = normalizeUnsignedInteger(
            field(data, "missionId", "mission_id"),
            0xffffffff,
          );
          if (missionId != null && missionId !== 0)
            this.state.missionId = missionId;
        }
        break;
      case "MissionItemReached":
        this.state.missionReached = normalizeUnsignedInteger(
          field(data, "seq"),
          65535,
        );
        break;
      case "NavControllerOutput":
        this.state.distanceToWaypoint = numeric(
          field(data, "wpDist", "wp_dist"),
        );
        break;
      case "StatusText": {
        const rawText = field(data, "text");
        const text =
          typeof rawText === "string"
            ? rawText.replace(/\0+$/, "")
            : String.fromCharCode(...(rawText ?? [])).replace(/\0+$/, "");
        const entry = {
          severity: numeric(field(data, "severity")),
          text,
          at: this.now(),
        };
        this.state.statusText = [...this.state.statusText.slice(-99), entry];
        this.emit("statusText", entry);
        break;
      }
      default:
        break;
    }

    this.emit(`message:${messageName}`, envelope);
    this.emit("message", envelope);
    this.emit("state", this.snapshot());
    return true;
  }

  handleHeartbeat(data, header, protocol) {
    const systemId = mavlinkUint8(header.sysid, { allowZero: false });
    const componentId = mavlinkUint8(header.compid, { allowZero: false });
    const type = mavlinkUint8(field(data, "type"));
    const autopilot = mavlinkUint8(field(data, "autopilot"));
    if (
      systemId == null ||
      componentId == null ||
      type == null ||
      autopilot == null ||
      type === MAV_TYPE_GCS ||
      autopilot === MAV_AUTOPILOT_INVALID
    ) {
      return false;
    }

    const firstConnection = !this.state.connected;
    if (firstConnection) {
      this.state.systemId = systemId;
      this.state.componentId = componentId;
      this.state.protocolVersion = protocol === "MAV_V1" ? 1 : 2;
      this.state.autopilot = autopilot;
      this.state.autopilotName =
        MAV_AUTOPILOT_NAMES[autopilot] ?? `Autopilot ${autopilot}`;
      this.state.vehicleType = type;
      this.state.vehicleTypeName = VEHICLE_TYPES[type] ?? `Vehicle ${type}`;
    }
    if (systemId !== this.state.systemId) return true;

    const baseMode = numeric(field(data, "baseMode", "base_mode")) ?? 0;
    const customMode = numeric(field(data, "customMode", "custom_mode")) ?? 0;
    this.state.connected = true;
    this.state.linkLost = false;
    this.state.lastHeartbeatAt = this.now();
    this.state.armed = Boolean(baseMode & MAV_MODE_FLAG_SAFETY_ARMED);
    this.state.baseMode = baseMode;
    this.state.customMode = customMode;
    this.state.modeName = modeName(this.state.vehicleType, customMode);
    this.state.systemStatus =
      numeric(field(data, "systemStatus", "system_status")) ?? 0;

    if (firstConnection) {
      // Publish the validated vehicle attachment before firmware detection can
      // synchronously emit state. The serial backend uses this event to mark
      // the transport valid, so Ground Control's first connected-state render
      // can safely begin its mission read exactly once.
      this.emit("connected", this.snapshot());
      this.startFirmwareDetection();
      this.requestDataStreams(5).catch(() => {});
      if (this.state.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
        this.requestAutopilotVersion().catch(() => {});
      }
      this.requestMessageInterval(242, 1).catch(() => {});
    }
    this.emit("heartbeat", this.snapshot());
    return true;
  }

  validateFirmwareFamily(family) {
    if (!FIRMWARE_FAMILIES.has(family)) {
      throw new Error(`Unsupported firmware family override: ${family}.`);
    }
  }

  applyFirmwareFamilyOverride() {
    if (this.firmwareFamilyOverride == null) return false;
    this.state.firmwareFamily = this.firmwareFamilyOverride;
    this.state.firmwareFamilySource = "override";
    return true;
  }

  setFirmwareFamily(family, source) {
    if (this.firmwareFamilyOverride != null) {
      family = this.firmwareFamilyOverride;
      source = "override";
    }
    if (
      this.state.firmwareFamily === family &&
      this.state.firmwareFamilySource === source
    )
      return;
    this.state.firmwareFamily = family;
    this.state.firmwareFamilySource = source;
    const state = this.snapshot();
    this.emit("firmwareFamily", state);
    this.emit("state", state);
  }

  stopFirmwareDetection() {
    if (this.firmwareDetectionTimer != null) {
      this.clearTimeoutFn(this.firmwareDetectionTimer);
      this.firmwareDetectionTimer = null;
    }
  }

  startFirmwareDetection() {
    this.stopFirmwareDetection();
    if (this.applyFirmwareFamilyOverride()) return;
    if (this.state.autopilot === MAV_AUTOPILOT_GENERIC) {
      this.setFirmwareFamily(FIRMWARE_FAMILY_INAV, "heartbeat");
      return;
    }
    if (this.state.autopilot !== MAV_AUTOPILOT_ARDUPILOTMEGA) {
      this.setFirmwareFamily(FIRMWARE_FAMILY_UNKNOWN, "unresolved");
      return;
    }
    this.setFirmwareFamily(FIRMWARE_FAMILY_UNKNOWN, "probing");
    this.send("ParamRequestList", this.target()).catch(() => {});
    const attachment = this.activeAttachment("firmware detection");
    this.firmwareDetectionTimer = timerUnref(
      this.setTimeoutFn(() => {
        this.firmwareDetectionTimer = null;
        if (!this.attachmentIsCurrent(attachment)) return;
        this.setFirmwareFamily(FIRMWARE_FAMILY_ARDUPILOT, "probe-timeout");
      }, this.firmwareDetectionTimeoutMs),
    );
  }

  handleFirmwareFingerprint(envelope) {
    if (
      this.firmwareFamilyOverride != null ||
      this.state.autopilot !== MAV_AUTOPILOT_ARDUPILOTMEGA ||
      !PARAM_VALUE_NAMES.has(envelope.messageName)
    )
      return;
    const count = numeric(field(envelope.data, "paramCount", "param_count"));
    if (count == null) return;
    this.stopFirmwareDetection();
    if (count === 0) {
      this.setFirmwareFamily(FIRMWARE_FAMILY_INAV, "parameter-fingerprint");
    } else if (count > 0) {
      this.setFirmwareFamily(FIRMWARE_FAMILY_ARDUPILOT, "parameter-stream");
    }
  }

  handleAutopilotVersion(data) {
    const flightCustomVersion = normalizeByteArray(
      field(data, "flightCustomVersion", "flight_custom_version"),
    );
    const middlewareCustomVersion = normalizeByteArray(
      field(data, "middlewareCustomVersion", "middleware_custom_version"),
    );
    const osCustomVersion = normalizeByteArray(
      field(data, "osCustomVersion", "os_custom_version"),
    );
    const uid2 = normalizeByteArray(field(data, "uid2"));
    const flightSwVersion = field(data, "flightSwVersion", "flight_sw_version");
    const middlewareSwVersion = field(
      data,
      "middlewareSwVersion",
      "middleware_sw_version",
    );
    const osSwVersion = field(data, "osSwVersion", "os_sw_version");
    this.state.autopilotVersion = {
      capabilities: normalizeUint64Decimal(field(data, "capabilities")),
      flightSwVersion: normalizeUnsignedInteger(flightSwVersion, 0xffffffff),
      middlewareSwVersion: normalizeUnsignedInteger(
        middlewareSwVersion,
        0xffffffff,
      ),
      osSwVersion: normalizeUnsignedInteger(osSwVersion, 0xffffffff),
      boardVersion: normalizeUnsignedInteger(
        field(data, "boardVersion", "board_version"),
        0xffffffff,
      ),
      vendorId: normalizeUnsignedInteger(
        field(data, "vendorId", "vendor_id"),
        65535,
      ),
      productId: normalizeUnsignedInteger(
        field(data, "productId", "product_id"),
        65535,
      ),
      uid: normalizeUint64Decimal(field(data, "uid")),
      uid2,
      uid2Hex: bytesToHex(uid2),
      flight: decodeMavlinkFirmwareVersion(flightSwVersion),
      middleware: decodeMavlinkFirmwareVersion(middlewareSwVersion),
      os: decodeMavlinkFirmwareVersion(osSwVersion),
      flightCustomVersion,
      flightCustomVersionHex: bytesToHex(flightCustomVersion),
      middlewareCustomVersion,
      middlewareCustomVersionHex: bytesToHex(middlewareCustomVersion),
      osCustomVersion,
      osCustomVersionHex: bytesToHex(osCustomVersion),
      receivedAt: this.now(),
    };
  }

  setFirmwareFamilyOverride(family) {
    this.validateFirmwareFamily(family);
    this.firmwareFamilyOverride = family;
    this.stopFirmwareDetection();
    this.setFirmwareFamily(family, "override");
    return this.snapshot();
  }

  clearFirmwareFamilyOverride() {
    this.firmwareFamilyOverride = null;
    if (this.state.connected) this.startFirmwareDetection();
    else this.setFirmwareFamily(FIRMWARE_FAMILY_UNKNOWN, "unresolved");
    return this.snapshot();
  }

  waitForFirmwareFamily(options = {}) {
    return this.waitForState(
      (state) => state.firmwareFamily !== FIRMWARE_FAMILY_UNKNOWN,
      options.timeoutMs ?? this.firmwareDetectionTimeoutMs + 1000,
      "firmware-family detection",
    );
  }

  normalizeRcChannel(value) {
    const channel = numeric(value);
    return channel == null || channel === 65535 ? null : channel;
  }

  normalizeRcRssi(value) {
    const rssi = numeric(value);
    return rssi == null || rssi === 255 ? null : rssi;
  }

  handleRcChannels(data) {
    const reportedCount = numeric(
      field(data, "chancount", "chanCount", "chan_count"),
    );
    const channelCount =
      reportedCount == null ? 18 : Math.max(0, Math.floor(reportedCount));
    this.state.rcChannelCount = channelCount;
    this.state.rcChannels = Array.from(
      { length: Math.min(channelCount, 18) },
      (_unused, index) =>
        this.normalizeRcChannel(
          field(data, `chan${index + 1}Raw`, `chan${index + 1}_raw`),
        ),
    );
    this.state.rssi = this.normalizeRcRssi(field(data, "rssi"));
    this.emit("telemetry", this.snapshot());
  }

  handleRcChannelsRaw(data) {
    const port = Math.max(0, Math.floor(numeric(field(data, "port")) ?? 0));
    const offset = port * 8;
    const channels = [...this.state.rcChannels];
    for (let index = 0; index < 8; index += 1) {
      channels[offset + index] = this.normalizeRcChannel(
        field(data, `chan${index + 1}Raw`, `chan${index + 1}_raw`),
      );
    }
    this.state.rcChannelCount = Math.max(this.state.rcChannelCount, offset + 8);
    this.state.rcChannels = channels;
    this.state.rssi = this.normalizeRcRssi(field(data, "rssi"));
    this.emit("telemetry", this.snapshot());
  }

  checkHeartbeat() {
    if (!this.state.connected || !this.state.lastHeartbeatAt) return;
    if (
      this.now() - this.state.lastHeartbeatAt <= this.heartbeatTimeoutMs ||
      this.state.linkLost
    )
      return;
    this.state.linkLost = true;
    this.emit("linkLost", this.snapshot());
    this.emit("state", this.snapshot());
  }

  target() {
    if (this.state.systemId == null) {
      throw new Error("No MAVLink autopilot is connected.");
    }
    return {
      targetSystem: this.state.systemId,
      targetComponent: this.state.componentId ?? 1,
    };
  }

  async send(messageName, payload, options = {}) {
    const attachment = this.activeAttachment(`sending MAVLink ${messageName}`);
    if (typeof this.bridge?.mavlinkEncode !== "function") {
      throw new Error("MAVLink encoder bridge is unavailable.");
    }
    const encoded = await this.bridge.mavlinkEncode(messageName, payload, {
      version: options.version ?? this.state.protocolVersion ?? 2,
      systemId: options.systemId ?? 255,
      componentId: options.componentId ?? 190,
    });
    if (!this.attachmentIsCurrent(attachment)) {
      throw createMavlinkAttachmentError(attachment.description);
    }
    const bytes =
      encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);

    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribeDetached = () => {};
      const cleanup = () => {
        unsubscribeDetached();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finish = (result) => {
        if (settled) return;
        if (!this.attachmentIsCurrent(attachment)) {
          fail(createMavlinkAttachmentError(attachment.description));
          return;
        }
        settled = true;
        cleanup();
        if (!result || result.resultCode !== 0) {
          reject(new Error("MAVLink transport write failed."));
        } else {
          resolve(result.bytesSent);
        }
      };
      unsubscribeDetached = this.on("detached", () => {
        fail(createMavlinkAttachmentError(attachment.description));
      });
      try {
        const returned = attachment.connection.send(bytes, finish);
        if (returned?.then) returned.then(finish, fail);
        else if (attachment.connection.send.length < 2 && returned != null) {
          finish(
            typeof returned === "number"
              ? { resultCode: 0, bytesSent: returned }
              : returned,
          );
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  sendGcsHeartbeat(options = {}) {
    return this.send("Heartbeat", {
      type: MAV_TYPE_GCS,
      autopilot: MAV_AUTOPILOT_INVALID,
      baseMode: 0,
      customMode: 0,
      systemStatus: MAV_STATE_ACTIVE,
      mavlinkVersion: 3,
    }, options);
  }

  startGcsHeartbeat() {
    this.stopGcsHeartbeat();
    const heartbeatGeneration = this.attachmentGeneration;
    const sendProbe = () => {
      if (this.discoveryHeartbeatInFlight) return;
      const probeGeneration = this.attachmentGeneration;
      const version = this.state.protocolVersion ?? 1;
      this.discoveryHeartbeatInFlight = true;
      this.sendGcsHeartbeat({ version })
        .then((bytesSent) => {
          if (
            probeGeneration !== this.attachmentGeneration ||
            !this.connection
          ) {
            return;
          }
          this.lastDiscoveryErrors.delete(version);
          if (this.reportedDiscoveryVersions.has(version)) return;
          this.reportedDiscoveryVersions.add(version);
          this.emit("transportDiagnostic", {
            stage: "discovery-heartbeat-write-accepted",
            version,
            bytesSent,
            generation: this.attachmentGeneration,
          });
        })
        .catch((error) => {
          if (
            probeGeneration !== this.attachmentGeneration ||
            !this.connection
          ) {
            return;
          }
          const message = error?.message || String(error);
          if (message === this.lastDiscoveryErrors.get(version)) return;
          this.lastDiscoveryErrors.set(version, message);
          this.emit("transportDiagnostic", {
            stage: "discovery-heartbeat-failed",
            version,
            error: message,
            generation: this.attachmentGeneration,
          });
        })
        .finally(() => {
          if (probeGeneration === this.attachmentGeneration) {
            this.discoveryHeartbeatInFlight = false;
          }
        });
    };
    const beginProbes = () => {
      if (
        heartbeatGeneration !== this.attachmentGeneration ||
        !this.connection
      ) {
        return;
      }
      this.gcsHeartbeatStartTimer = null;
      sendProbe();
      this.gcsHeartbeat = timerUnref(
        this.setIntervalFn(() => {
          if (
            heartbeatGeneration !== this.attachmentGeneration ||
            !this.connection
          ) {
            return;
          }
          sendProbe();
        }, 1000),
      );
    };
    if (this.discoveryDelayMs > 0) {
      this.gcsHeartbeatStartTimer = timerUnref(
        this.setTimeoutFn(beginProbes, this.discoveryDelayMs),
      );
    } else {
      beginProbes();
    }
  }

  stopGcsHeartbeat() {
    if (this.gcsHeartbeatStartTimer != null) {
      this.clearTimeoutFn(this.gcsHeartbeatStartTimer);
      this.gcsHeartbeatStartTimer = null;
    }
    if (this.gcsHeartbeat != null) {
      this.clearIntervalFn(this.gcsHeartbeat);
      this.gcsHeartbeat = null;
    }
    this.discoveryHeartbeatInFlight = false;
  }

  availableModes() {
    return Object.entries(modeMapForVehicle(this.state.vehicleType)).map(
      ([number, name]) => ({ number: Number(number), name }),
    );
  }

  waitForState(
    predicate,
    timeoutMs = 6000,
    description = "vehicle state change",
  ) {
    let attachment;
    try {
      attachment = this.activeAttachment(description);
    } catch (error) {
      return Promise.reject(error);
    }
    const current = this.snapshot();
    if (predicate(current)) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      let unsubscribeState = () => {};
      let unsubscribeDetached = () => {};
      const cleanup = () => {
        this.clearTimeoutFn(timer);
        unsubscribeState();
        unsubscribeDetached();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      unsubscribeState = this.on("state", (state) => {
        if (!this.attachmentIsCurrent(attachment)) {
          fail(createMavlinkAttachmentError(description));
          return;
        }
        if (!predicate(state)) return;
        settled = true;
        cleanup();
        resolve(state);
      });
      unsubscribeDetached = this.on("detached", () => {
        fail(createMavlinkAttachmentError(description));
      });
      timer = timerUnref(
        this.setTimeoutFn(() => {
          fail(new Error(`Timed out waiting for ${description}.`));
        }, timeoutMs),
      );
    });
  }

  async setMode(mode, options = {}) {
    const customMode =
      typeof mode === "number"
        ? mode
        : modeNumber(this.state.vehicleType, mode);
    if (customMode == null) {
      throw new Error(`Mode ${mode} is not available for this vehicle.`);
    }
    await this.send("SetMode", {
      targetSystem: this.target().targetSystem,
      baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
      customMode,
    });
    return this.waitForState(
      (state) => state.customMode === customMode,
      options.timeoutMs,
      `flight mode ${modeName(this.state.vehicleType, customMode)}`,
    );
  }

  async setArmed(armed, options = {}) {
    const target = this.target();
    await this.send("CommandLong", {
      ...target,
      command: MAV_CMD_COMPONENT_ARM_DISARM,
      confirmation: 0,
      param1: armed ? 1 : 0,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
    return this.waitForState(
      (state) => state.armed === Boolean(armed),
      options.timeoutMs,
      armed ? "armed state" : "disarmed state",
    );
  }

  createCommandAckWaiter(command, options = {}) {
    const timeoutMs = options.timeoutMs ?? 6000;
    const systemId = options.systemId ?? this.state.systemId;
    const attachment = this.activeAttachment(
      `waiting for COMMAND_ACK for command ${command}`,
    );
    let timer = null;
    let settled = false;
    let unsubscribeMessage = () => {};
    let unsubscribeDetached = () => {};
    let rejectPromise = () => {};

    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      const cleanup = () => {
        this.clearTimeoutFn(timer);
        unsubscribeMessage();
        unsubscribeDetached();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const resetTimeout = () => {
        this.clearTimeoutFn(timer);
        timer = timerUnref(
          this.setTimeoutFn(() => {
            fail(
              new Error(
                `Timed out waiting for COMMAND_ACK for command ${command}.`,
              ),
            );
          }, timeoutMs),
        );
      };

      unsubscribeMessage = this.on("message", (envelope) => {
        if (!this.attachmentIsCurrent(attachment)) {
          fail(createMavlinkAttachmentError(attachment.description));
          return;
        }
        if (
          !COMMAND_ACK_NAMES.has(envelope.messageName) ||
          Number(field(envelope.data, "command")) !== Number(command) ||
          (systemId != null &&
            envelope.header?.sysid != null &&
            envelope.header.sysid !== systemId)
        )
          return;

        const result = Number(field(envelope.data, "result"));
        if (result === MAV_RESULT_IN_PROGRESS) {
          options.onProgress?.(envelope.data);
          resetTimeout();
          return;
        }
        if (result !== MAV_RESULT_ACCEPTED) {
          fail(
            new Error(
              `Command ${command} was ${MAV_RESULT_NAMES[result] ?? `result ${result}`}.`,
            ),
          );
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(envelope.data);
      });
      unsubscribeDetached = this.on("detached", () => {
        fail(createMavlinkAttachmentError(attachment.description));
      });
      resetTimeout();
    });
    promise.catch(() => {});

    return {
      promise,
      cancel: (reason = null) => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        unsubscribeMessage();
        unsubscribeDetached();
        if (reason) rejectPromise(reason);
      },
    };
  }

  waitForCommandAck(command, options = {}) {
    return this.createCommandAckWaiter(command, options).promise;
  }

  async sendCommandLong(command, parameters = {}, options = {}) {
    const target = this.target();
    const waiter = this.createCommandAckWaiter(command, {
      ...options,
      systemId: target.targetSystem,
    });
    try {
      await this.send("CommandLong", {
        ...target,
        command,
        confirmation: options.confirmation ?? 0,
        param1: Number(parameters.param1 ?? 0),
        param2: Number(parameters.param2 ?? 0),
        param3: Number(parameters.param3 ?? 0),
        param4: Number(parameters.param4 ?? 0),
        param5: Number(parameters.param5 ?? 0),
        param6: Number(parameters.param6 ?? 0),
        param7: Number(parameters.param7 ?? 0),
      });
    } catch (error) {
      waiter.cancel();
      throw error;
    }
    return waiter.promise;
  }

  requireArduPilotAction(action) {
    if (this.state.firmwareFamily === FIRMWARE_FAMILY_UNKNOWN) {
      throw new Error(
        `${action} is unavailable until firmware detection completes.`,
      );
    }
    if (this.state.firmwareFamily !== FIRMWARE_FAMILY_ARDUPILOT) {
      throw new Error(`${action} is supported only for an ArduPilot vehicle.`);
    }
  }

  requireActiveArduPilotLink(action) {
    this.requireArduPilotAction(action);
    if (!this.state.connected) {
      throw new Error(
        `${action} requires an active MAVLink vehicle connection.`,
      );
    }
    if (this.state.linkLost) {
      throw new Error(
        `${action} was not sent because the MAVLink vehicle link is lost.`,
      );
    }
    return this.target();
  }

  invalidateMissionCheckpoint(error, details = {}) {
    this.emit("missionCheckpointInvalid", {
      error,
      ...details,
      state: this.snapshot(),
    });
    return error;
  }

  validateMissionResumeContext(sequence, options = {}) {
    this.requireActiveArduPilotLink("Mission resume");
    const normalizedSequence = normalizeUnsignedInteger(sequence, 65534);
    const missionTotal = normalizeUnsignedInteger(
      this.state.missionTotal,
      65534,
    );
    if (normalizedSequence == null) {
      throw createMissionResumeError(
        "MISSION_SEQUENCE_INVALID",
        "Mission resume sequence must be an integer from 0 through 65534.",
      );
    }
    if (missionTotal == null || missionTotal <= 0) {
      throw createMissionResumeError(
        "MISSION_SEQUENCE_INVALID",
        "Mission resume is unavailable until the vehicle reports a non-empty mission total.",
      );
    }
    if (normalizedSequence >= missionTotal) {
      throw createMissionResumeError(
        "MISSION_SEQUENCE_INVALID",
        `Mission sequence ${normalizedSequence} is outside the loaded mission range 0-${missionTotal - 1}.`,
      );
    }

    const checkpoint = options.checkpoint ?? {};
    if (
      !checkpoint ||
      typeof checkpoint !== "object" ||
      Array.isArray(checkpoint)
    ) {
      throw createMissionResumeError(
        "MISSION_PLAN_MISMATCH",
        "Mission resume checkpoint must be an object.",
      );
    }
    if (
      checkpoint.sequence != null &&
      normalizeUnsignedInteger(checkpoint.sequence, 65534) !==
        normalizedSequence
    ) {
      throw this.invalidateMissionCheckpoint(
        createMissionResumeError(
          "MISSION_PLAN_MISMATCH",
          "The saved mission-resume sequence does not match the requested mission item.",
          { clearCheckpoint: true },
        ),
        { checkpoint },
      );
    }
    if (
      checkpoint.missionTotal != null &&
      normalizeUnsignedInteger(checkpoint.missionTotal, 65534) !== missionTotal
    ) {
      throw this.invalidateMissionCheckpoint(
        createMissionResumeError(
          "MISSION_PLAN_MISMATCH",
          "The mission loaded on the flight controller is not the mission saved in the resume checkpoint.",
          { clearCheckpoint: true },
        ),
        { checkpoint },
      );
    }
    if (checkpoint.missionId != null) {
      const expectedId = normalizeUnsignedInteger(
        checkpoint.missionId,
        0xffffffff,
      );
      if (
        expectedId == null ||
        expectedId === 0 ||
        this.state.missionId == null ||
        expectedId !== this.state.missionId
      ) {
        throw this.invalidateMissionCheckpoint(
          createMissionResumeError(
            "MISSION_PLAN_MISMATCH",
            "The flight controller mission ID no longer matches the saved resume checkpoint.",
            { clearCheckpoint: true },
          ),
          { checkpoint },
        );
      }
    }
    if (checkpoint.timeBootMs != null) {
      const checkpointBootTime = normalizeUnsignedInteger(
        checkpoint.timeBootMs,
        0xffffffff,
      );
      if (checkpointBootTime == null) {
        throw createMissionResumeError(
          "MISSION_PLAN_MISMATCH",
          "The mission-resume checkpoint contains an invalid flight-controller boot time.",
        );
      }
      if (this.state.timeBootMs == null) {
        throw createMissionResumeError(
          "MISSION_PLAN_MISMATCH",
          "Mission resume is unavailable until flight-controller boot-time telemetry is received.",
        );
      }
      if (this.state.timeBootMs < checkpointBootTime) {
        throw this.invalidateMissionCheckpoint(
          createMissionResumeError(
            "VEHICLE_REBOOTED",
            "The flight controller restarted after the mission checkpoint was saved.",
            { clearCheckpoint: true },
          ),
          { checkpoint },
        );
      }
    }
    if (
      checkpoint.bootGeneration != null &&
      normalizeUnsignedInteger(
        checkpoint.bootGeneration,
        Number.MAX_SAFE_INTEGER,
      ) !== this.state.bootGeneration
    ) {
      throw this.invalidateMissionCheckpoint(
        createMissionResumeError(
          "VEHICLE_REBOOTED",
          "The flight controller restarted after the mission checkpoint was saved.",
          { clearCheckpoint: true },
        ),
        { checkpoint },
      );
    }

    return {
      sequence: normalizedSequence,
      expectedMissionTotal: missionTotal,
      expectedMissionId:
        checkpoint.missionId == null
          ? this.state.missionId
          : normalizeUnsignedInteger(checkpoint.missionId, 0xffffffff),
      expectedTimeBootMs: this.state.timeBootMs,
      expectedBootGeneration: this.state.bootGeneration,
      checkpoint,
    };
  }

  validateActiveMissionContext(context) {
    this.requireActiveArduPilotLink("Mission resume");
    if (
      this.state.missionTotal !== context.expectedMissionTotal ||
      (context.expectedMissionId != null &&
        this.state.missionId !== context.expectedMissionId)
    ) {
      throw this.invalidateMissionCheckpoint(
        createMissionResumeError(
          "MISSION_PLAN_MISMATCH",
          "The vehicle mission changed while the resume item was being selected.",
          { clearCheckpoint: true },
        ),
        { checkpoint: context.checkpoint },
      );
    }
    if (
      this.state.bootGeneration !== context.expectedBootGeneration ||
      (context.expectedTimeBootMs != null &&
        this.state.timeBootMs != null &&
        this.state.timeBootMs < context.expectedTimeBootMs)
    ) {
      throw this.invalidateMissionCheckpoint(
        createMissionResumeError(
          "VEHICLE_REBOOTED",
          "The flight controller restarted while the mission resume command was in progress.",
          { clearCheckpoint: true },
        ),
        { checkpoint: context.checkpoint },
      );
    }
  }

  createMissionCurrentWaiter(context, options = {}) {
    const timeoutMs = options.timeoutMs ?? 6000;
    const systemId = this.state.systemId;
    const watchCommandAck = options.watchCommandAck !== false;
    const attachment = this.activeAttachment(
      `confirming mission sequence ${context.sequence}`,
    );
    let timer = null;
    let settled = false;
    let unsubscribeMessage = () => {};
    let unsubscribeDetached = () => {};
    let rejectPromise = () => {};

    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      const cleanup = () => {
        this.clearTimeoutFn(timer);
        unsubscribeMessage();
        unsubscribeDetached();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const resetTimeout = () => {
        this.clearTimeoutFn(timer);
        timer = timerUnref(
          this.setTimeoutFn(() => {
            fail(
              createMissionResumeError(
                "MISSION_CURRENT_TIMEOUT",
                `Timed out waiting for the flight controller to confirm mission sequence ${context.sequence}.`,
              ),
            );
          }, timeoutMs),
        );
      };
      unsubscribeMessage = this.on("message", (envelope) => {
        if (!this.attachmentIsCurrent(attachment)) {
          fail(createMavlinkAttachmentError(attachment.description));
          return;
        }
        if (
          systemId != null &&
          envelope.header?.sysid != null &&
          envelope.header.sysid !== systemId
        )
          return;

        if (MISSION_CURRENT_NAMES.has(envelope.messageName)) {
          if (
            normalizeUnsignedInteger(field(envelope.data, "seq"), 65535) !==
            context.sequence
          ) {
            return;
          }
          try {
            this.validateActiveMissionContext(context);
            this.validateMissionResumeContext(context.sequence, {
              checkpoint: context.checkpoint,
            });
          } catch (error) {
            fail(error);
            return;
          }
          if (settled) return;
          settled = true;
          cleanup();
          resolve(envelope);
          return;
        }

        if (
          !watchCommandAck ||
          !COMMAND_ACK_NAMES.has(envelope.messageName) ||
          Number(field(envelope.data, "command")) !==
            MAV_CMD_DO_SET_MISSION_CURRENT
        )
          return;
        const result = Number(field(envelope.data, "result"));
        if (result === MAV_RESULT_IN_PROGRESS) {
          resetTimeout();
          return;
        }
        if (result === MAV_RESULT_ACCEPTED) return;
        const error = createMissionResumeError(
          "MISSION_CURRENT_REJECTED",
          `The flight controller ${MAV_RESULT_NAMES[result] ?? `returned result ${result} for`} mission sequence ${context.sequence}.`,
        );
        error.mavResult = result;
        error.legacyFallbackAllowed = result === 3;
        fail(error);
      });
      unsubscribeDetached = this.on("detached", () => {
        fail(createMavlinkAttachmentError(attachment.description));
      });
      resetTimeout();
    });
    promise.catch(() => {});

    return {
      promise,
      cancel: (reason = null) => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        unsubscribeMessage();
        unsubscribeDetached();
        if (reason) rejectPromise(reason);
      },
    };
  }

  missionCurrentResult(method, context, envelope) {
    return {
      sequence: context.sequence,
      missionTotal: this.state.missionTotal,
      missionId: this.state.missionId,
      timeBootMs: this.state.timeBootMs,
      bootGeneration: this.state.bootGeneration,
      method,
      confirmation: { ...envelope.data },
    };
  }

  async setMissionCurrent(sequence, options = {}) {
    const context = this.validateMissionResumeContext(sequence, options);
    const target = this.target();
    const commandWaiter = this.createMissionCurrentWaiter(context, options);
    try {
      await this.send("CommandLong", {
        ...target,
        command: MAV_CMD_DO_SET_MISSION_CURRENT,
        confirmation: 0,
        param1: context.sequence,
        param2: 0,
        param3: 0,
        param4: 0,
        param5: 0,
        param6: 0,
        param7: 0,
      });
    } catch (error) {
      commandWaiter.cancel();
      throw error;
    }

    try {
      const confirmation = await commandWaiter.promise;
      return this.missionCurrentResult(
        "MAV_CMD_DO_SET_MISSION_CURRENT",
        context,
        confirmation,
      );
    } catch (error) {
      const fallbackAllowed =
        error.code === "MISSION_CURRENT_TIMEOUT" ||
        error.legacyFallbackAllowed === true;
      if (!fallbackAllowed || options.allowLegacyFallback === false)
        throw error;
    }

    this.validateActiveMissionContext(context);
    this.validateMissionResumeContext(sequence, options);
    const legacyWaiter = this.createMissionCurrentWaiter(context, {
      ...options,
      watchCommandAck: false,
    });
    try {
      await this.send("MissionSetCurrent", {
        ...target,
        seq: context.sequence,
      });
    } catch (error) {
      legacyWaiter.cancel();
      throw error;
    }
    return this.missionCurrentResult(
      "MISSION_SET_CURRENT",
      context,
      await legacyWaiter.promise,
    );
  }

  async resumeMissionFrom(sequence, options = {}) {
    const selected = await this.setMissionCurrent(sequence, options);
    this.validateMissionResumeContext(sequence, {
      checkpoint: {
        sequence: selected.sequence,
        missionTotal: selected.missionTotal,
        missionId: selected.missionId,
        timeBootMs: selected.timeBootMs,
        bootGeneration: selected.bootGeneration,
      },
    });
    const mode = this.selectActionMode("Mission resume", ["AUTO"]);
    const state =
      this.state.modeName === mode
        ? this.snapshot()
        : await this.setMode(mode, options);
    return { ...selected, state };
  }

  selectActionMode(action, choices) {
    this.requireArduPilotAction(action);
    const available = new Set(this.availableModes().map(({ name }) => name));
    const selected = choices.find((choice) => available.has(choice));
    if (!selected) {
      throw new Error(
        `${action} is not supported for ${this.state.vehicleTypeName}.`,
      );
    }
    return selected;
  }

  async startMission(options = {}) {
    const mode = this.selectActionMode("Mission start", ["AUTO"]);
    if (this.state.modeName !== mode) await this.setMode(mode, options);
    return this.sendCommandLong(
      MAV_CMD_MISSION_START,
      {
        param1: options.firstItem ?? 0,
        param2: options.lastItem ?? 0,
      },
      options,
    );
  }

  returnToLaunch(options = {}) {
    const mode = this.selectActionMode("Return to launch", [
      "RTL",
      "QRTL",
      "SMART_RTL",
      "AUTO_RTL",
    ]);
    return this.setMode(mode, options);
  }

  land(options = {}) {
    const family = vehicleFamily(this.state.vehicleType);
    let choices = [];
    if (family === "plane") {
      choices = [19, 20, 21].includes(Number(this.state.vehicleType))
        ? ["QLAND", "AUTOLAND"]
        : ["AUTOLAND"];
    } else if (family === "copter") {
      choices = ["LAND"];
    }
    return this.setMode(this.selectActionMode("Land", choices), options);
  }

  async takeoff(altitude = 10, options = {}) {
    this.requireArduPilotAction("Takeoff");
    if (!AIRBORNE_VEHICLE_TYPES.has(Number(this.state.vehicleType))) {
      throw new Error(
        `Takeoff is not supported for ${this.state.vehicleTypeName}.`,
      );
    }
    const altitudeM = Number(altitude);
    if (!Number.isFinite(altitudeM) || altitudeM <= 0) {
      throw new Error("Takeoff altitude must be a positive number of metres.");
    }
    if (vehicleFamily(this.state.vehicleType) === "plane") {
      return this.setMode(
        this.selectActionMode("Takeoff", ["TAKEOFF"]),
        options,
      );
    }
    if (
      modeNumber(this.state.vehicleType, "GUIDED") != null &&
      this.state.modeName !== "GUIDED"
    ) {
      await this.setMode("GUIDED", options);
    }
    return this.sendCommandLong(
      MAV_CMD_NAV_TAKEOFF,
      { param7: altitudeM },
      options,
    );
  }

  requestDataStreams(rateHz = 4) {
    return this.send("RequestDataStream", {
      ...this.target(),
      reqStreamId: MAV_DATA_STREAM_ALL,
      reqMessageRate: Math.max(1, Math.round(rateHz)),
      startStop: 1,
    });
  }

  requestMessageInterval(messageId, rateHz) {
    return this.send("CommandLong", {
      ...this.target(),
      command: MAV_CMD_SET_MESSAGE_INTERVAL,
      confirmation: 0,
      param1: messageId,
      param2: rateHz > 0 ? Math.round(1e6 / rateHz) : -1,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  requestAutopilotVersion() {
    return this.send("CommandLong", {
      ...this.target(),
      command: MAV_CMD_REQUEST_MESSAGE,
      confirmation: 0,
      param1: MAVLINK_MSG_ID_AUTOPILOT_VERSION,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  waitFor(messageNames, predicate = () => true, timeoutMs = 3000) {
    const names = new Set(
      Array.isArray(messageNames) ? messageNames : [messageNames],
    );
    let attachment;
    try {
      attachment = this.activeAttachment(
        `waiting for ${[...names].join(" or ")}`,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      let unsubscribeMessage = () => {};
      let unsubscribeDetached = () => {};
      const cleanup = () => {
        this.clearTimeoutFn(timer);
        unsubscribeMessage();
        unsubscribeDetached();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      unsubscribeMessage = this.on("message", (envelope) => {
        if (!this.attachmentIsCurrent(attachment)) {
          fail(createMavlinkAttachmentError(attachment.description));
          return;
        }
        if (!names.has(envelope.messageName) || !predicate(envelope)) return;
        settled = true;
        cleanup();
        resolve(envelope);
      });
      unsubscribeDetached = this.on("detached", () => {
        fail(createMavlinkAttachmentError(attachment.description));
      });
      timer = timerUnref(
        this.setTimeoutFn(() => {
          fail(new Error(`Timed out waiting for ${[...names].join(" or ")}.`));
        }, timeoutMs),
      );
    });
  }
}

const mavlinkSession = new MavlinkSession();

export default mavlinkSession;
