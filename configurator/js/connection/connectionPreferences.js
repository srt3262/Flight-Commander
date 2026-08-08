"use strict";

export const CONNECTION_PROTOCOL_AUTO = "auto";
export const CONNECTION_PROTOCOL_MSP = "msp";
export const CONNECTION_PROTOCOL_MAVLINK = "mavlink";

export const CONNECTION_BAUD_PREFERENCES_KEY =
  "connectionBaudPreferencesByProtocol";

export const SUPPORTED_CONNECTION_BAUDS = Object.freeze([
  1200,
  2400,
  4800,
  9600,
  14400,
  19200,
  28800,
  38400,
  57600,
  115200,
  230400,
  460800,
  921600,
]);

const SUPPORTED_CONNECTION_BAUD_SET = new Set(SUPPORTED_CONNECTION_BAUDS);
const SUPPORTED_PROTOCOLS = new Set([
  CONNECTION_PROTOCOL_AUTO,
  CONNECTION_PROTOCOL_MSP,
  CONNECTION_PROTOCOL_MAVLINK,
]);
const DEFAULT_BAUD_BY_PROTOCOL = Object.freeze({
  [CONNECTION_PROTOCOL_AUTO]: 115200,
  [CONNECTION_PROTOCOL_MSP]: 115200,
  [CONNECTION_PROTOCOL_MAVLINK]: 460800,
});

export function normalizeConnectionProtocol(protocol) {
  const normalized = String(protocol ?? "").trim().toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(normalized)) {
    throw new RangeError(`Unsupported connection protocol: ${protocol}.`);
  }
  return normalized;
}

export function normalizeSupportedConnectionBaud(baud) {
  if (
    typeof baud !== "number" &&
    (typeof baud !== "string" || baud.trim() === "")
  ) {
    return null;
  }

  const normalized = Number(baud);
  return Number.isInteger(normalized) &&
    SUPPORTED_CONNECTION_BAUD_SET.has(normalized)
    ? normalized
    : null;
}

export function isSupportedConnectionBaud(baud) {
  return normalizeSupportedConnectionBaud(baud) != null;
}

export function defaultConnectionBaud(protocol) {
  return DEFAULT_BAUD_BY_PROTOCOL[normalizeConnectionProtocol(protocol)];
}

function normalizedPreferences(preferences) {
  return preferences &&
    typeof preferences === "object" &&
    !Array.isArray(preferences)
    ? preferences
    : {};
}

/**
 * Resolves a baud without allowing the old shared `last_used_bps` setting to
 * poison an explicit MAVLink connection. ExpressLRS USB MAVLink is fixed at
 * 460800, so MAVLink uses only its own validated preference or that default.
 *
 * The legacy value remains a migration fallback for MSP and Auto. Those modes
 * otherwise retain the historical 115200 default.
 */
export function resolveConnectionBaud({
  protocol,
  preferences = {},
  legacyBaud = null,
} = {}) {
  const normalizedProtocol = normalizeConnectionProtocol(protocol);
  const savedBaud = normalizeSupportedConnectionBaud(
    normalizedPreferences(preferences)[normalizedProtocol],
  );
  if (savedBaud != null) return savedBaud;

  if (normalizedProtocol !== CONNECTION_PROTOCOL_MAVLINK) {
    const normalizedLegacyBaud =
      normalizeSupportedConnectionBaud(legacyBaud);
    if (normalizedLegacyBaud != null) return normalizedLegacyBaud;
  }

  return defaultConnectionBaud(normalizedProtocol);
}

/**
 * Returns a new preference record for an explicit operator selection or a
 * protocol-validated connection, suitable for persistence under
 * CONNECTION_BAUD_PREFERENCES_KEY.
 */
export function withProtocolBaudPreference(
  preferences,
  protocol,
  baud,
) {
  const normalizedProtocol = normalizeConnectionProtocol(protocol);
  const normalizedBaud = normalizeSupportedConnectionBaud(baud);
  if (normalizedBaud == null) {
    throw new RangeError(`Unsupported connection baud: ${baud}.`);
  }

  return {
    ...normalizedPreferences(preferences),
    [normalizedProtocol]: normalizedBaud,
  };
}

/**
 * Explicit persistence boundary for protocol-specific baud rates.
 */
export function persistProtocolBaudPreference(
  store,
  protocol,
  baud,
  key = CONNECTION_BAUD_PREFERENCES_KEY,
) {
  if (
    !store ||
    typeof store.get !== "function" ||
    typeof store.set !== "function"
  ) {
    throw new TypeError(
      "A preference store with get and set functions is required.",
    );
  }

  const nextPreferences = withProtocolBaudPreference(
    store.get(key, {}),
    protocol,
    baud,
  );
  store.set(key, nextPreferences);
  return nextPreferences;
}

/**
 * Auto forces DTR low because it may be probing an ExpressLRS MAVLink module.
 * ExpressLRS requires DTR low on Windows; the main-process serial transport is
 * responsible for applying this flag only on platforms where it is needed.
 */
export function serialOptionsForProtocol(protocol, baud = null) {
  const normalizedProtocol = normalizeConnectionProtocol(protocol);
  const bitrate =
    baud == null
      ? defaultConnectionBaud(normalizedProtocol)
      : normalizeSupportedConnectionBaud(baud);
  if (bitrate == null) {
    throw new RangeError(`Unsupported connection baud: ${baud}.`);
  }

  return {
    bitrate,
    forceDtrLow:
      normalizedProtocol === CONNECTION_PROTOCOL_MAVLINK ||
      normalizedProtocol === CONNECTION_PROTOCOL_AUTO,
  };
}
