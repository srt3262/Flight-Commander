"use strict";

import {
  VEHICLE_TYPES,
  modeName,
} from "./mavlinkModes.js";
import { field, normalizeMavlinkEnvelope } from "./frameNormalizer.js";
import { bindHostTimer } from "./hostTimers.js";

export const MAV_AUTOPILOT_INVALID = 8;
export const MAV_AUTOPILOT_GENERIC = 0;
export const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
export const MAV_TYPE_GCS = 6;
export const MAV_MODE_FLAG_SAFETY_ARMED = 128;
export const MAV_STATE_ACTIVE = 4;
export const MAV_RESULT_ACCEPTED = 0;
export const MAV_RESULT_IN_PROGRESS = 5;
export const MAV_CMD_SET_MESSAGE_INTERVAL = 511;
export const MAV_CMD_REQUEST_MESSAGE = 512;
export const MAVLINK_MSG_ID_AUTOPILOT_VERSION = 148;
export const MAV_DATA_STREAM_ALL = 0;

export const FIRMWARE_FAMILY_UNKNOWN = "unknown";
export const FIRMWARE_FAMILY_INAV = "inav";
export const FIRMWARE_FAMILY_FLIGHT_COMMANDER = "flight-commander";
export const FIRMWARE_FAMILY_UNSUPPORTED = "unsupported";

const FIRMWARE_FAMILIES = new Set([
  FIRMWARE_FAMILY_INAV,
  FIRMWARE_FAMILY_FLIGHT_COMMANDER,
]);
const FLIGHT_COMMANDER_MAVLINK_SIGNATURE = Object.freeze([70, 67, 70, 87]);
const COMMAND_ACK_NAMES = new Set(["COMMAND_ACK", "CommandAck"]);
const PARAM_VALUE_NAMES = new Set(["PARAM_VALUE", "ParamValue"]);
const MISSION_CURRENT_NAMES = new Set(["MISSION_CURRENT", "MissionCurrent"]);
const AIRBORNE_VEHICLE_TYPES = new Set([
  1, 2, 3, 4, 13, 14, 15, 19, 20, 21, 29,
]);
const MAV_AUTOPILOT_NAMES = Object.freeze({
  0: "Generic",
  3: "ArduPilot-compatible",
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

function sensorVector(data, suffix) {
  return ["x", "y", "z"].map((axis) => numeric(field(
    data,
    `${axis}${suffix}`,
    `${axis}_${suffix}`,
  )));
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
    flightCommanderCapabilities: 0,
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
    sensorsPresent: null,
    sensorsEnabled: null,
    sensorsHealthy: null,
    systemLoad: null,
    communicationDropRate: null,
    communicationErrors: null,
    controllerErrorCounts: [],
    gpsFix: 0,
    satellites: 0,
    hdop: null,
    rssi: null,
    rcChannelCount: 0,
    rcChannels: [],
    servoOutputs: [],
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
    rawSensors: {
      gyro: [null, null, null],
      accel: [null, null, null],
      mag: [null, null, null],
      pressure: null,
      distance: null,
      temperatures: [],
    },
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
    // Chromium's Window timers are receiver-sensitive. Storing an unbound
    // timer here and later invoking it as `this.setIntervalFn(...)` supplies
    // the MavlinkSession as the receiver and throws "Illegal invocation".
    // Bind only the host defaults; injected test schedulers remain unchanged.
    this.setTimeoutFn = options.setTimeoutFn ?? bindHostTimer("setTimeout");
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? bindHostTimer("clearTimeout");
    this.setIntervalFn =
      options.setIntervalFn ?? bindHostTimer("setInterval");
    this.clearIntervalFn =
      options.clearIntervalFn ?? bindHostTimer("clearInterval");
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
    this.receivedByteCount = 0;
    this.decodedFrameCount = 0;
    this.lastSerialByteAt = 0;
    this.lastDecodedFrameAt = 0;
    this.lastDecodedMessageName = null;

    if (this.firmwareFamilyOverride != null) {
      this.validateFirmwareFamily(this.firmwareFamilyOverride);
      this.state.firmwareFamily = this.firmwareFamilyOverride;
      this.state.firmwareFamilySource = "override";
    }
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (typeof this.bridge?.onMavlinkMessage === "function") {
        this.ipcHandler = this.bridge.onMavlinkMessage((envelope) =>
          this.handleMessage(envelope, { requireGeneration: true }),
        );
      }
      this.watchdog = timerUnref(
        this.setIntervalFn(() => this.checkHeartbeat(), 1000),
      );
    } catch (error) {
      if (this.watchdog != null) {
        try {
          this.clearIntervalFn(this.watchdog);
        } catch {
          // Preserve the original initialization error.
        }
      }
      this.watchdog = null;
      if (this.ipcHandler) {
        try {
          if (typeof this.bridge?.offMavlinkMessage === "function") {
            this.bridge.offMavlinkMessage(this.ipcHandler);
          } else if (typeof this.ipcHandler === "function") {
            this.ipcHandler();
          }
        } catch {
          // Preserve the original initialization error.
        }
      }
      this.ipcHandler = null;
      this.initialized = false;
      throw error;
    }
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
    this.receivedByteCount = 0;
    this.decodedFrameCount = 0;
    this.lastSerialByteAt = 0;
    this.lastDecodedFrameAt = 0;
    this.lastDecodedMessageName = null;
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
      const byteLength =
        Number(event.data?.byteLength) ||
        Number(event.data?.length) ||
        0;
      this.receivedByteCount += byteLength;
      this.lastSerialByteAt = this.now();
      if (!this.reportedReceiveBytes) {
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
      servoOutputs: [...this.state.servoOutputs],
      controllerErrorCounts: [...this.state.controllerErrorCounts],
      rawSensors: {
        ...this.state.rawSensors,
        gyro: [...this.state.rawSensors.gyro],
        accel: [...this.state.rawSensors.accel],
        mag: [...this.state.rawSensors.mag],
        temperatures: [...this.state.rawSensors.temperatures],
      },
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
    this.decodedFrameCount += 1;
    this.lastDecodedFrameAt = this.now();
    this.lastDecodedMessageName = messageName;
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
        const fixType = numeric(field(data, "fixType", "fix_type")) ?? 0;
        this.state.gpsFix = fixType;
        const satellites = numeric(
          field(data, "satellitesVisible", "satellites_visible"),
        );
        this.state.satellites =
          satellites == null || satellites === 255 ? null : satellites;
        const eph = numeric(field(data, "eph"));
        this.state.hdop = eph == null || eph === 65535 ? null : eph / 100;
        const altitude = numeric(field(data, "alt"));
        if (fixType >= 3 && altitude != null) {
          this.state.altitudeMsl = altitude / 1000;
        } else if (fixType < 3) {
          this.state.altitudeMsl = null;
        }
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
      case "RawImu":
        this.state.rawSensors.accel = sensorVector(data, "acc");
        this.state.rawSensors.gyro = sensorVector(data, "gyro");
        this.state.rawSensors.mag = sensorVector(data, "mag");
        break;
      case "ScaledImu":
      case "ScaledImu2":
      case "ScaledImu3": {
        const accel = sensorVector(data, "acc");
        const gyro = sensorVector(data, "gyro");
        const mag = sensorVector(data, "mag");
        this.state.rawSensors.accel = accel.map((value) => (
          value == null ? null : value / 1000
        ));
        this.state.rawSensors.gyro = gyro.map((value) => (
          value == null ? null : value / 1000
        ));
        this.state.rawSensors.mag = mag;
        const temperature = numeric(field(data, "temperature"));
        if (temperature != null) {
          this.state.rawSensors.temperatures = [temperature / 100, ...this.state.rawSensors.temperatures.slice(1)];
        }
        break;
      }
      case "HighresImu": {
        this.state.rawSensors.accel = ["xacc", "yacc", "zacc"].map((name) => numeric(field(data, name)));
        this.state.rawSensors.gyro = ["xgyro", "ygyro", "zgyro"].map((name) => numeric(field(data, name)));
        this.state.rawSensors.mag = ["xmag", "ymag", "zmag"].map((name) => numeric(field(data, name)));
        const pressure = numeric(field(data, "absPressure", "abs_pressure"));
        if (pressure != null) this.state.rawSensors.pressure = pressure;
        const temperature = numeric(field(data, "temperature"));
        if (temperature != null) {
          this.state.rawSensors.temperatures = [temperature, ...this.state.rawSensors.temperatures.slice(1)];
        }
        break;
      }
      case "ScaledPressure":
      case "ScaledPressure2":
      case "ScaledPressure3": {
        const pressure = numeric(field(data, "pressAbs", "press_abs"));
        if (pressure != null) this.state.rawSensors.pressure = pressure;
        const temperature = numeric(field(data, "temperature"));
        if (temperature != null) {
          this.state.rawSensors.temperatures = [temperature / 100, ...this.state.rawSensors.temperatures.slice(1)];
        }
        break;
      }
      case "DistanceSensor": {
        const distance = numeric(field(data, "currentDistance", "current_distance"));
        this.state.rawSensors.distance = distance == null ? null : distance / 100;
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
        const sensorMask = (camel, snake) => {
          const value = numeric(field(data, camel, snake));
          return value == null ? null : Math.max(0, Math.floor(value));
        };
        this.state.sensorsPresent = sensorMask(
          "onboardControlSensorsPresent",
          "onboard_control_sensors_present",
        );
        this.state.sensorsEnabled = sensorMask(
          "onboardControlSensorsEnabled",
          "onboard_control_sensors_enabled",
        );
        this.state.sensorsHealthy = sensorMask(
          "onboardControlSensorsHealth",
          "onboard_control_sensors_health",
        );
        const load = numeric(field(data, "load"));
        this.state.systemLoad =
          load == null || load === 65535 ? null : load / 10;
        const dropRate = numeric(
          field(data, "dropRateComm", "drop_rate_comm"),
        );
        this.state.communicationDropRate =
          dropRate == null || dropRate === 65535 ? null : dropRate / 100;
        const errorsComm = numeric(
          field(data, "errorsComm", "errors_comm"),
        );
        this.state.communicationErrors =
          errorsComm == null || errorsComm === 65535 ? null : errorsComm;
        this.state.controllerErrorCounts = Array.from(
          { length: 4 },
          (_unused, index) => numeric(
            field(
              data,
              `errorsCount${index + 1}`,
              `errors_count${index + 1}`,
            ),
          ),
        );
        break;
      }
      case "VfrHud": {
        this.state.airSpeed = numeric(field(data, "airspeed"));
        this.state.groundSpeed = numeric(field(data, "groundspeed"));
        this.state.climbRate = numeric(field(data, "climb"));
        this.state.heading = numeric(field(data, "heading"));
        const altitude = numeric(field(data, "alt"));
        const inavRelativeAltitude =
          this.state.firmwareFamily === FIRMWARE_FAMILY_INAV ||
          this.state.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER ||
          this.state.autopilot === MAV_AUTOPILOT_GENERIC;
        if (altitude != null && inavRelativeAltitude) {
          // INAV fills VFR_HUD.alt from getEstimatedActualPosition(Z), which
          // is its barometer/INS relative-altitude estimate. Preserve those
          // semantics instead of labelling the value as MSL.
          this.state.relativeAltitude = altitude;
        } else if (
          altitude != null &&
          this.state.firmwareFamily === FIRMWARE_FAMILY_UNSUPPORTED
        ) {
          this.state.altitudeMsl = altitude;
        }
        break;
      }
      case "RadioStatus":
        this.state.rssi = numeric(field(data, "rssi"));
        break;
      case "RcChannels":
        this.handleRcChannels(data);
        break;
      case "RcChannelsRaw":
        this.handleRcChannelsRaw(data);
        break;
      case "ServoOutputRaw": {
        const outputs = Array.from({ length: 16 }, (_unused, index) => (
          numeric(field(data, `servo${index + 1}Raw`, `servo${index + 1}_raw`))
        ));
        const lastOutput = outputs.reduce(
          (last, value, index) => (value == null ? last : index),
          -1,
        );
        this.state.servoOutputs = lastOutput >= 0 ? outputs.slice(0, lastOutput + 1) : [];
        break;
      }
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
    const linkWasLost = this.state.linkLost;
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

    if (linkWasLost) {
      this.emit("transportDiagnostic", {
        stage: "vehicle-heartbeat-restored",
        generation: this.attachmentGeneration,
        receivedByteCount: this.receivedByteCount,
        decodedFrameCount: this.decodedFrameCount,
        lastMessageName: this.lastDecodedMessageName,
      });
    }

    if (firstConnection) {
      // Publish the validated vehicle attachment before firmware detection can
      // synchronously emit state. The serial backend uses this event to mark
      // the transport valid, so Ground Control's first connected-state render
      // can safely begin its mission read exactly once.
      this.emit("connected", this.snapshot());
      this.startFirmwareDetection();
      this.requestDataStreams(5).catch(() => {});
      if (
        this.state.autopilot === MAV_AUTOPILOT_GENERIC ||
        this.state.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA
      ) {
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
        this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "probe-timeout");
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
      this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "parameter-stream");
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

    const isFlightCommander = FLIGHT_COMMANDER_MAVLINK_SIGNATURE.every(
      (byte, index) => flightCustomVersion[index] === byte,
    );
    if (isFlightCommander && flightCustomVersion.length >= 8) {
      this.state.flightCommanderCapabilities = (
        flightCustomVersion[4] |
        (flightCustomVersion[5] << 8) |
        (flightCustomVersion[6] << 16) |
        (flightCustomVersion[7] << 24)
      ) >>> 0;
      this.stopFirmwareDetection();
      this.setFirmwareFamily(
        FIRMWARE_FAMILY_FLIGHT_COMMANDER,
        "autopilot-version",
      );
    }
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
    const now = this.now();
    if (
      now - this.state.lastHeartbeatAt <= this.heartbeatTimeoutMs ||
      this.state.linkLost
    )
      return;
    this.state.linkLost = true;
    this.emit("transportDiagnostic", {
      stage: "vehicle-heartbeat-timeout",
      generation: this.attachmentGeneration,
      millisecondsSinceHeartbeat: now - this.state.lastHeartbeatAt,
      millisecondsSinceSerialByte:
        this.lastSerialByteAt > 0 ? now - this.lastSerialByteAt : null,
      millisecondsSinceValidFrame:
        this.lastDecodedFrameAt > 0 ? now - this.lastDecodedFrameAt : null,
      receivedByteCount: this.receivedByteCount,
      decodedFrameCount: this.decodedFrameCount,
      lastMessageName: this.lastDecodedMessageName,
    });
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
