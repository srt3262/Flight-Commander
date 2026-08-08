import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONNECTION_BAUD_PREFERENCES_KEY,
  SUPPORTED_CONNECTION_BAUDS,
  defaultConnectionBaud,
  isSupportedConnectionBaud,
  normalizeSupportedConnectionBaud,
  persistProtocolBaudPreference,
  resolveConnectionBaud,
  serialOptionsForProtocol,
  withProtocolBaudPreference,
} from "../../../js/connection/connectionPreferences.js";

describe("connection baud validation and defaults", () => {
  test("accepts only baud rates exposed by Flight Commander", () => {
    for (const baud of SUPPORTED_CONNECTION_BAUDS) {
      assert.equal(isSupportedConnectionBaud(baud), true);
      assert.equal(normalizeSupportedConnectionBaud(String(baud)), baud);
    }

    for (const baud of [
      null,
      undefined,
      "",
      " ",
      "460800junk",
      true,
      0,
      12345,
      460800.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      assert.equal(isSupportedConnectionBaud(baud), false);
      assert.equal(normalizeSupportedConnectionBaud(baud), null);
    }
  });

  test("uses 460800 for explicit MAVLink and 115200 for MSP and Auto", () => {
    assert.equal(defaultConnectionBaud("mavlink"), 460800);
    assert.equal(defaultConnectionBaud("msp"), 115200);
    assert.equal(defaultConnectionBaud("auto"), 115200);
  });

  test("rejects unknown protocols instead of silently choosing a baud", () => {
    assert.throws(
      () => defaultConnectionBaud("ltm"),
      /Unsupported connection protocol/,
    );
  });
});

describe("protocol-specific baud resolution", () => {
  test("explicit MAVLink ignores a legacy shared baud", () => {
    assert.equal(
      resolveConnectionBaud({
        protocol: "mavlink",
        preferences: {},
        legacyBaud: 115200,
      }),
      460800,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "mavlink",
        preferences: { msp: 57600, auto: 230400 },
        legacyBaud: 921600,
      }),
      460800,
    );
  });

  test("explicit MAVLink restores only its own valid saved value", () => {
    assert.equal(
      resolveConnectionBaud({
        protocol: "mavlink",
        preferences: { mavlink: "230400" },
        legacyBaud: 115200,
      }),
      230400,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "mavlink",
        preferences: { mavlink: 12345 },
        legacyBaud: 115200,
      }),
      460800,
    );
  });

  test("MSP and Auto preserve valid legacy values and otherwise fall back to 115200", () => {
    assert.equal(
      resolveConnectionBaud({
        protocol: "msp",
        preferences: {},
        legacyBaud: 57600,
      }),
      57600,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "auto",
        preferences: {},
        legacyBaud: "230400",
      }),
      230400,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "msp",
        preferences: {},
        legacyBaud: 12345,
      }),
      115200,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "auto",
        preferences: {},
        legacyBaud: null,
      }),
      115200,
    );
  });

  test("a protocol-specific value takes precedence over the legacy value", () => {
    assert.equal(
      resolveConnectionBaud({
        protocol: "msp",
        preferences: { msp: 38400 },
        legacyBaud: 115200,
      }),
      38400,
    );
    assert.equal(
      resolveConnectionBaud({
        protocol: "auto",
        preferences: { auto: 460800 },
        legacyBaud: 115200,
      }),
      460800,
    );
  });
});

describe("validated preference persistence", () => {
  test("returns a new protocol-specific record without mutating the input", () => {
    const original = { msp: 115200 };
    const updated = withProtocolBaudPreference(
      original,
      "mavlink",
      "460800",
    );

    assert.deepEqual(original, { msp: 115200 });
    assert.deepEqual(updated, { msp: 115200, mavlink: 460800 });
  });

  test("rejects unsupported baud rates before persistence", () => {
    assert.throws(
      () => withProtocolBaudPreference({}, "mavlink", 12345),
      /Unsupported connection baud/,
    );
  });

  test("persists only through the dedicated protocol preference key", () => {
    const writes = [];
    const values = new Map([
      [CONNECTION_BAUD_PREFERENCES_KEY, { msp: 115200 }],
      ["last_used_bps", 57600],
    ]);
    const store = {
      get(key, fallback) {
        return values.has(key) ? values.get(key) : fallback;
      },
      set(key, value) {
        writes.push({ key, value });
        values.set(key, value);
      },
    };

    const persisted = persistProtocolBaudPreference(
      store,
      "mavlink",
      460800,
    );

    assert.deepEqual(persisted, { msp: 115200, mavlink: 460800 });
    assert.deepEqual(writes, [
      {
        key: CONNECTION_BAUD_PREFERENCES_KEY,
        value: { msp: 115200, mavlink: 460800 },
      },
    ]);
    assert.equal(values.get("last_used_bps"), 57600);
  });

  test("requires an explicit compatible store", () => {
    assert.throws(
      () => persistProtocolBaudPreference(null, "mavlink", 460800),
      /preference store/,
    );
  });
});

describe("serial connection options", () => {
  test("forces DTR low for explicit MAVLink and Auto discovery", () => {
    assert.deepEqual(serialOptionsForProtocol("mavlink"), {
      bitrate: 460800,
      forceDtrLow: true,
    });
    assert.deepEqual(serialOptionsForProtocol("auto"), {
      bitrate: 115200,
      forceDtrLow: true,
    });
  });

  test("does not force DTR low for explicit MSP", () => {
    assert.deepEqual(serialOptionsForProtocol("msp"), {
      bitrate: 115200,
      forceDtrLow: false,
    });
  });

  test("normalizes a selected baud and rejects unsupported values", () => {
    assert.deepEqual(serialOptionsForProtocol("mavlink", "921600"), {
      bitrate: 921600,
      forceDtrLow: true,
    });
    assert.throws(
      () => serialOptionsForProtocol("mavlink", 12345),
      /Unsupported connection baud/,
    );
  });
});
