"use strict";

export const UBX_CLASS_ACK = 0x05;
export const UBX_CLASS_CFG = 0x06;
export const UBX_CLASS_MON = 0x0a;
export const UBX_CLASS_NAV = 0x01;
export const UBX_ID_ACK_NAK = 0x00;
export const UBX_ID_ACK_ACK = 0x01;
export const UBX_ID_CFG_VALSET = 0x8a;
export const UBX_ID_MON_VER = 0x04;
export const UBX_ID_NAV_SVIN = 0x3b;
export const UBX_ID_NAV_PVT = 0x07;

export const UBLOX_F9_CONFIG_KEYS = Object.freeze({
  TMODE_MODE: 0x20030001,
  TMODE_POS_TYPE: 0x20030002,
  TMODE_LAT: 0x40030009,
  TMODE_LON: 0x4003000a,
  TMODE_HEIGHT: 0x4003000b,
  TMODE_LAT_HP: 0x2003000c,
  TMODE_LON_HP: 0x2003000d,
  TMODE_HEIGHT_HP: 0x2003000e,
  TMODE_FIXED_POS_ACC: 0x4003000f,
  TMODE_SVIN_MIN_DUR: 0x40030010,
  TMODE_SVIN_ACC_LIMIT: 0x40030011,
  USB_OUT_UBX: 0x10780001,
  USB_OUT_RTCM3X: 0x10780004,
  USB_IN_RTCM3X: 0x10770004,
  MSGOUT_NAV_PVT_USB: 0x20910009,
  MSGOUT_NAV_SVIN_USB: 0x2091008b,
  MSGOUT_RTCM_1005_USB: 0x209102c0,
  MSGOUT_RTCM_1077_USB: 0x209102cf,
  MSGOUT_RTCM_1087_USB: 0x209102d4,
  MSGOUT_RTCM_1097_USB: 0x2091031b,
  MSGOUT_RTCM_1127_USB: 0x209102d9,
  MSGOUT_RTCM_1230_USB: 0x20910306,
});

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError("UBX data must be a byte array.");
}

export function ubxChecksum(value) {
  let a = 0;
  let b = 0;
  for (const byte of bytes(value)) {
    a = (a + byte) & 0xff;
    b = (b + a) & 0xff;
  }
  return [a, b];
}

export function buildUbxFrame(messageClass, messageId, payload = []) {
  const body = bytes(payload);
  if (body.length > 4096) throw new RangeError("UBX payload is too large.");
  const frame = new Uint8Array(body.length + 8);
  frame[0] = 0xb5;
  frame[1] = 0x62;
  frame[2] = Number(messageClass) & 0xff;
  frame[3] = Number(messageId) & 0xff;
  frame[4] = body.length & 0xff;
  frame[5] = (body.length >> 8) & 0xff;
  frame.set(body, 6);
  const [a, b] = ubxChecksum(frame.subarray(2, frame.length - 2));
  frame[frame.length - 2] = a;
  frame[frame.length - 1] = b;
  return frame;
}

export class UbxParser {
  constructor(options = {}) {
    this.onFrame = options.onFrame ?? (() => {});
    this.onInvalid = options.onInvalid ?? (() => {});
    this.buffer = new Uint8Array(0);
    this.invalidFrames = 0;
  }

  reset() {
    this.buffer = new Uint8Array(0);
    this.invalidFrames = 0;
  }

  push(value) {
    const incoming = bytes(value);
    if (!incoming.length) return [];
    const combined = new Uint8Array(this.buffer.length + incoming.length);
    combined.set(this.buffer);
    combined.set(incoming, this.buffer.length);
    this.buffer = combined;

    const frames = [];
    while (this.buffer.length) {
      let sync = -1;
      for (let index = 0; index + 1 < this.buffer.length; index += 1) {
        if (this.buffer[index] === 0xb5 && this.buffer[index + 1] === 0x62) {
          sync = index;
          break;
        }
      }
      if (sync < 0) {
        this.buffer = this.buffer[this.buffer.length - 1] === 0xb5
          ? this.buffer.slice(-1)
          : new Uint8Array(0);
        break;
      }
      if (sync > 0) this.buffer = this.buffer.subarray(sync);
      if (this.buffer.length < 6) break;
      const payloadLength = this.buffer[4] | (this.buffer[5] << 8);
      if (payloadLength > 4096) {
        this.rejectCandidate("payload exceeds safety limit");
        continue;
      }
      const frameLength = payloadLength + 8;
      if (this.buffer.length < frameLength) break;
      const candidate = this.buffer.slice(0, frameLength);
      const [a, b] = ubxChecksum(candidate.subarray(2, frameLength - 2));
      if (a !== candidate[frameLength - 2] || b !== candidate[frameLength - 1]) {
        this.rejectCandidate("checksum mismatch");
        continue;
      }
      this.buffer = this.buffer.subarray(frameLength);
      const envelope = {
        messageClass: candidate[2],
        messageId: candidate[3],
        payload: candidate.slice(6, frameLength - 2),
        frame: candidate,
      };
      frames.push(envelope);
      this.onFrame(envelope);
    }
    return frames;
  }

  rejectCandidate(reason) {
    this.invalidFrames += 1;
    this.onInvalid({ reason, invalidFrames: this.invalidFrames });
    this.buffer = this.buffer.subarray(1);
  }
}

function integer(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

function finite(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be from ${minimum} through ${maximum}.`);
  }
  return number;
}

function signedParts(value, fineUnitsPerUnit, fineUnitsPerCoarseUnit) {
  const total = Math.round(value * fineUnitsPerUnit);
  const coarse = Math.trunc(total / fineUnitsPerCoarseUnit);
  return { coarse, highPrecision: total - coarse * fineUnitsPerCoarseUnit };
}

function encodeValue(type, value) {
  const size = ["U4", "I4"].includes(type) ? 4 : 1;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  if (type === "U4") view.setUint32(0, value, true);
  else if (type === "I4") view.setInt32(0, value, true);
  else if (type === "I1") view.setInt8(0, value);
  else view.setUint8(0, value);
  return new Uint8Array(buffer);
}

function entry(key, type, value) {
  return { key, type, value };
}

export function normalizeF9BaseSettings(settings = {}) {
  const mode = settings.mode === "fixed" ? "fixed" : "survey-in";
  const constellations = {
    gps: settings.constellations?.gps !== false,
    glonass: settings.constellations?.glonass !== false,
    galileo: settings.constellations?.galileo !== false,
    beidou: settings.constellations?.beidou !== false,
  };
  if (!Object.values(constellations).some(Boolean)) {
    throw new RangeError("At least one RTCM constellation must be enabled.");
  }
  const normalized = {
    mode,
    persist: settings.persist !== false,
    constellations,
    surveyInMinDurationS: integer(
      settings.surveyInMinDurationS ?? 120,
      1,
      86400,
      "Survey-in duration",
    ),
    surveyInAccuracyM: finite(
      settings.surveyInAccuracyM ?? 0.5,
      0.0001,
      100,
      "Survey-in accuracy",
    ),
  };
  if (mode === "fixed") {
    normalized.latitude = finite(settings.latitude, -90, 90, "Latitude");
    normalized.longitude = finite(settings.longitude, -180, 180, "Longitude");
    normalized.ellipsoidHeightM = finite(
      settings.ellipsoidHeightM,
      -1000,
      20000,
      "Ellipsoid height",
    );
    normalized.fixedPositionAccuracyM = finite(
      settings.fixedPositionAccuracyM ?? 0.02,
      0.0001,
      100,
      "Fixed-position accuracy",
    );
  }
  return normalized;
}

export function f9BaseConfigurationEntries(settings = {}) {
  const config = normalizeF9BaseSettings(settings);
  const keys = UBLOX_F9_CONFIG_KEYS;
  const entries = [
    entry(keys.USB_IN_RTCM3X, "L", 0),
    entry(keys.USB_OUT_UBX, "L", 1),
    entry(keys.USB_OUT_RTCM3X, "L", 1),
    entry(keys.MSGOUT_NAV_PVT_USB, "U1", 1),
    entry(keys.MSGOUT_NAV_SVIN_USB, "U1", 1),
    entry(keys.MSGOUT_RTCM_1005_USB, "U1", 5),
    entry(keys.MSGOUT_RTCM_1077_USB, "U1", config.constellations.gps ? 1 : 0),
    entry(keys.MSGOUT_RTCM_1087_USB, "U1", config.constellations.glonass ? 1 : 0),
    entry(keys.MSGOUT_RTCM_1097_USB, "U1", config.constellations.galileo ? 1 : 0),
    entry(keys.MSGOUT_RTCM_1127_USB, "U1", config.constellations.beidou ? 1 : 0),
    entry(keys.MSGOUT_RTCM_1230_USB, "U1", config.constellations.glonass ? 10 : 0),
  ];

  if (config.mode === "survey-in") {
    entries.unshift(
      entry(keys.TMODE_MODE, "E1", 1),
      entry(keys.TMODE_SVIN_MIN_DUR, "U4", config.surveyInMinDurationS),
      entry(
        keys.TMODE_SVIN_ACC_LIMIT,
        "U4",
        Math.round(config.surveyInAccuracyM * 10000),
      ),
    );
  } else {
    const latitude = signedParts(config.latitude, 1e9, 100);
    const longitude = signedParts(config.longitude, 1e9, 100);
    const height = signedParts(config.ellipsoidHeightM, 10000, 100);
    entries.unshift(
      entry(keys.TMODE_MODE, "E1", 2),
      entry(keys.TMODE_POS_TYPE, "E1", 1),
      entry(keys.TMODE_LAT, "I4", latitude.coarse),
      entry(keys.TMODE_LON, "I4", longitude.coarse),
      entry(keys.TMODE_HEIGHT, "I4", height.coarse),
      entry(keys.TMODE_LAT_HP, "I1", latitude.highPrecision),
      entry(keys.TMODE_LON_HP, "I1", longitude.highPrecision),
      entry(keys.TMODE_HEIGHT_HP, "I1", height.highPrecision),
      entry(
        keys.TMODE_FIXED_POS_ACC,
        "U4",
        Math.round(config.fixedPositionAccuracyM * 10000),
      ),
    );
  }
  return { config, entries };
}

export function buildF9BaseValset(settings = {}) {
  const { config, entries } = f9BaseConfigurationEntries(settings);
  return buildValset(entries, config.persist);
}

function buildValset(entries, persist) {
  const payloadLength = 4 + entries.reduce(
    (total, item) => total + 4 + encodeValue(item.type, item.value).length,
    0,
  );
  const payload = new Uint8Array(payloadLength);
  payload.set([0, persist ? 0x07 : 0x01, 0, 0]);
  const view = new DataView(payload.buffer);
  let offset = 4;
  for (const item of entries) {
    view.setUint32(offset, item.key, true);
    offset += 4;
    const value = encodeValue(item.type, item.value);
    payload.set(value, offset);
    offset += value.length;
  }
  return buildUbxFrame(UBX_CLASS_CFG, UBX_ID_CFG_VALSET, payload);
}

export function buildF9NtripPositioningValset(options = {}) {
  const keys = UBLOX_F9_CONFIG_KEYS;
  return buildValset([
    entry(keys.TMODE_MODE, "E1", 0),
    entry(keys.USB_IN_RTCM3X, "L", 1),
    entry(keys.USB_OUT_UBX, "L", 1),
    entry(keys.USB_OUT_RTCM3X, "L", 0),
    entry(keys.MSGOUT_NAV_PVT_USB, "U1", 1),
    entry(keys.MSGOUT_RTCM_1005_USB, "U1", 0),
    entry(keys.MSGOUT_RTCM_1077_USB, "U1", 0),
    entry(keys.MSGOUT_RTCM_1087_USB, "U1", 0),
    entry(keys.MSGOUT_RTCM_1097_USB, "U1", 0),
    entry(keys.MSGOUT_RTCM_1127_USB, "U1", 0),
    entry(keys.MSGOUT_RTCM_1230_USB, "U1", 0),
  ], options.persist === true);
}

function ascii(value) {
  return new TextDecoder("ascii")
    .decode(bytes(value))
    .replace(/\0.*$/s, "")
    .trim();
}

export function parseUbxMonVer(payload) {
  const data = bytes(payload);
  if (data.length < 40) return null;
  const extensions = [];
  for (let offset = 40; offset + 30 <= data.length; offset += 30) {
    const extension = ascii(data.subarray(offset, offset + 30));
    if (extension) extensions.push(extension);
  }
  const model = extensions.find((item) => item.startsWith("MOD="))?.slice(4) ?? null;
  const protocol = extensions.find((item) => item.startsWith("PROTVER="))?.slice(8) ?? null;
  return {
    softwareVersion: ascii(data.subarray(0, 30)),
    hardwareVersion: ascii(data.subarray(30, 40)),
    model,
    protocolVersion: protocol,
    extensions,
  };
}

export function parseUbxNavSvin(payload) {
  const data = bytes(payload);
  if (data.length < 40) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    durationS: view.getUint32(8, true),
    meanEcefCm: [
      view.getInt32(12, true) + view.getInt8(24) * 0.01,
      view.getInt32(16, true) + view.getInt8(25) * 0.01,
      view.getInt32(20, true) + view.getInt8(26) * 0.01,
    ],
    meanAccuracyM: view.getUint32(28, true) / 10000,
    observations: view.getUint32(32, true),
    valid: view.getUint8(36) !== 0,
    active: view.getUint8(37) !== 0,
  };
}

export function parseUbxNavPvt(payload) {
  const data = bytes(payload);
  if (data.length < 92) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = view.getUint8(21);
  const carrierSolution = (flags >> 6) & 0x03;
  return {
    fixType: view.getUint8(20),
    fixOk: (flags & 0x01) !== 0,
    differential: (flags & 0x02) !== 0,
    carrierSolution,
    carrierSolutionName: ["None", "RTK Float", "RTK Fixed", "Reserved"][carrierSolution],
    satellites: view.getUint8(23),
    longitude: view.getInt32(24, true) / 1e7,
    latitude: view.getInt32(28, true) / 1e7,
    ellipsoidHeightM: view.getInt32(32, true) / 1000,
    altitudeMsl: view.getInt32(36, true) / 1000,
    horizontalAccuracyM: view.getUint32(40, true) / 1000,
    verticalAccuracyM: view.getUint32(44, true) / 1000,
    hdop: view.getUint16(76, true) / 100,
  };
}

export function parseUbxAck(envelope) {
  if (envelope?.messageClass !== UBX_CLASS_ACK || envelope.payload?.length < 2) {
    return null;
  }
  return {
    acknowledged: envelope.messageId === UBX_ID_ACK_ACK,
    rejected: envelope.messageId === UBX_ID_ACK_NAK,
    messageClass: envelope.payload[0],
    messageId: envelope.payload[1],
  };
}

export const UBX_POLL_MON_VER = buildUbxFrame(UBX_CLASS_MON, UBX_ID_MON_VER);
export const UBX_POLL_NAV_SVIN = buildUbxFrame(UBX_CLASS_NAV, UBX_ID_NAV_SVIN);
export const UBX_POLL_NAV_PVT = buildUbxFrame(UBX_CLASS_NAV, UBX_ID_NAV_PVT);
