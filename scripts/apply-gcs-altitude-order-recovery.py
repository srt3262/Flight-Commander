#!/usr/bin/env python3
"""Apply and verify the Flight Commander GCS altitude/order-recovery patch."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one {label} block, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_altitude() -> None:
    path = ROOT / "js/mavlink/mavlinkSession.js"
    replace_once(
        path,
        """        this.state.altitudeMsl = altitude == null ? null : altitude / 1000;
        this.state.relativeAltitude =
          relativeAltitude == null ? null : relativeAltitude / 1000;""",
        """        this.state.altitudeMsl =
          altitude == null || this.state.gpsFix < 3
            ? null
            : altitude / 1000;
        this.state.relativeAltitude =
          relativeAltitude == null ? null : relativeAltitude / 1000;""",
        "GLOBAL_POSITION_INT altitude validity",
    )
    replace_once(
        path,
        """      case \"GpsRawInt\": {
        this.state.gpsFix = numeric(field(data, \"fixType\", \"fix_type\")) ?? 0;
        const satellites = numeric(
          field(data, \"satellitesVisible\", \"satellites_visible\"),
        );
        this.state.satellites =
          satellites == null || satellites === 255 ? null : satellites;
        const eph = numeric(field(data, \"eph\"));
        this.state.hdop = eph == null || eph === 65535 ? null : eph / 100;
        break;
      }""",
        """      case \"GpsRawInt\": {
        const fixType = numeric(field(data, \"fixType\", \"fix_type\")) ?? 0;
        this.state.gpsFix = fixType;
        const satellites = numeric(
          field(data, \"satellitesVisible\", \"satellites_visible\"),
        );
        this.state.satellites =
          satellites == null || satellites === 255 ? null : satellites;
        const eph = numeric(field(data, \"eph\"));
        this.state.hdop = eph == null || eph === 65535 ? null : eph / 100;
        const altitude = numeric(field(data, \"alt\"));
        this.state.altitudeMsl =
          fixType >= 3 && altitude != null ? altitude / 1000 : null;
        break;
      }""",
        "GPS_RAW_INT MSL altitude",
    )
    replace_once(
        path,
        """      case \"VfrHud\":
        this.state.airSpeed = numeric(field(data, \"airspeed\"));
        this.state.groundSpeed = numeric(field(data, \"groundspeed\"));
        this.state.climbRate = numeric(field(data, \"climb\"));
        this.state.heading = numeric(field(data, \"heading\"));
        break;""",
        """      case \"VfrHud\": {
        this.state.airSpeed = numeric(field(data, \"airspeed\"));
        this.state.groundSpeed = numeric(field(data, \"groundspeed\"));
        this.state.climbRate = numeric(field(data, \"climb\"));
        this.state.heading = numeric(field(data, \"heading\"));
        const altitude = numeric(field(data, \"alt\"));
        const inavRelativeAltitude =
          this.state.firmwareFamily === FIRMWARE_FAMILY_INAV ||
          this.state.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER ||
          this.state.autopilot === MAV_AUTOPILOT_GENERIC;
        if (altitude != null && inavRelativeAltitude) {
          // INAV fills VFR_HUD.alt from getEstimatedActualPosition(Z),
          // its barometer/INS relative-altitude estimate. Do not label
          // that value as MSL merely because generic MAVLink says MSL.
          this.state.relativeAltitude = altitude;
        } else if (
          altitude != null &&
          this.state.firmwareFamily === FIRMWARE_FAMILY_UNSUPPORTED
        ) {
          this.state.altitudeMsl = altitude;
        }
        break;
      }""",
        "VFR_HUD altitude routing",
    )


def write_policy() -> None:
    path = ROOT / "js/connection/mavlinkWaitingRecovery.js"
    path.write_text(
        '''"use strict";

export const MAVLINK_WAITING_REFRESH_DELAY_MS = 12000;
export const MAVLINK_WAITING_REOPEN_SETTLE_MS = 750;

export function shouldRefreshWaitingMavlinkTransport(options = {}) {
  return Boolean(
    options.protocol === "mavlink" &&
    options.serialTransport === true &&
    options.hasPort === true &&
    options.connectionValid !== true &&
    options.vehicleConnected !== true &&
    options.refreshInProgress !== true &&
    options.disconnectInProgress !== true
  );
}
''',
        encoding="utf-8",
    )


def patch_serial_backend() -> None:
    path = ROOT / "js/serial_backend.js"
    replace_once(
        path,
        """import {
    SERIAL_STARTUP_RECOVERY_DELAY_MS,
    SERIAL_TERMINAL_OPERATOR_GUARD_MS,
    shouldAttemptMavlinkStartupRecovery,
    unexpectedSerialTerminationMessage,
} from './connection/serialRecoveryPolicy';""",
        """import {
    SERIAL_STARTUP_RECOVERY_DELAY_MS,
    SERIAL_TERMINAL_OPERATOR_GUARD_MS,
    shouldAttemptMavlinkStartupRecovery,
    unexpectedSerialTerminationMessage,
} from './connection/serialRecoveryPolicy';
import {
    MAVLINK_WAITING_REFRESH_DELAY_MS,
    MAVLINK_WAITING_REOPEN_SETTLE_MS,
    shouldRefreshWaitingMavlinkTransport,
} from './connection/mavlinkWaitingRecovery';""",
        "waiting-recovery import",
    )
    replace_once(
        path,
        """    privateScope.unexpectedTerminalOperatorGuardUntil = 0;
    privateScope.sitlDemoConnectTimer = null;""",
        """    privateScope.unexpectedTerminalOperatorGuardUntil = 0;
    privateScope.sitlDemoConnectTimer = null;
    privateScope.mavlinkWaitingRefreshTimer = null;
    privateScope.mavlinkWaitingRefreshGeneration = 0;
    privateScope.mavlinkWaitingRefreshInProgress = false;
    privateScope.mavlinkWaitingRefreshAttempt = 0;""",
        "waiting-recovery state",
    )

    marker = """    privateScope.cancelUnexpectedSerialRecovery = function () {
        privateScope.unexpectedSerialRecoveryGeneration += 1;
        if (privateScope.unexpectedSerialRecoveryTimer != null) {
            clearTimeout(privateScope.unexpectedSerialRecoveryTimer);
            privateScope.unexpectedSerialRecoveryTimer = null;
            return true;
        }
        return false;
    };
"""
    helpers = marker + """
    privateScope.clearMavlinkWaitingRefreshTimer = function () {
        if (privateScope.mavlinkWaitingRefreshTimer == null) {
            return false;
        }
        clearTimeout(privateScope.mavlinkWaitingRefreshTimer);
        privateScope.mavlinkWaitingRefreshTimer = null;
        return true;
    };

    privateScope.cancelMavlinkWaitingRefresh = function ({
        resetAttempts = true,
    } = {}) {
        privateScope.mavlinkWaitingRefreshGeneration += 1;
        privateScope.clearMavlinkWaitingRefreshTimer();
        privateScope.mavlinkWaitingRefreshInProgress = false;
        if (resetAttempts) {
            privateScope.mavlinkWaitingRefreshAttempt = 0;
        }
    };

    privateScope.canRefreshMavlinkWaitingTransport = function () {
        return shouldRefreshWaitingMavlinkTransport({
            protocol: privateScope.activeOpenAttempt?.protocol,
            serialTransport:
                CONFIGURATOR.connection?.type === ConnectionType.Serial,
            hasPort: Boolean(
                privateScope.activeOpenAttempt?.port && GUI.connected_to,
            ),
            connectionValid: CONFIGURATOR.connectionValid,
            vehicleConnected: mavlinkSession.state.connected,
            refreshInProgress:
                privateScope.mavlinkWaitingRefreshInProgress,
            disconnectInProgress: privateScope.disconnectInProgress,
        });
    };

    privateScope.scheduleMavlinkWaitingRefresh = function (
        delayMs = MAVLINK_WAITING_REFRESH_DELAY_MS,
    ) {
        privateScope.clearMavlinkWaitingRefreshTimer();
        if (!privateScope.canRefreshMavlinkWaitingTransport()) {
            return false;
        }
        const generation = privateScope.mavlinkWaitingRefreshGeneration;
        privateScope.mavlinkWaitingRefreshTimer = setTimeout(() => {
            privateScope.mavlinkWaitingRefreshTimer = null;
            if (
                generation !== privateScope.mavlinkWaitingRefreshGeneration
            ) {
                return;
            }
            privateScope.refreshMavlinkWaitingTransport();
        }, delayMs);
        return true;
    };

    privateScope.refreshMavlinkWaitingTransport = function () {
        if (!privateScope.canRefreshMavlinkWaitingTransport()) {
            return false;
        }

        const generation = privateScope.mavlinkWaitingRefreshGeneration;
        const openAttempt = privateScope.activeOpenAttempt;
        const connection = CONFIGURATOR.connection;
        const attempt = ++privateScope.mavlinkWaitingRefreshAttempt;
        const safePort = $('<div>').text(openAttempt.port).html();
        privateScope.mavlinkWaitingRefreshInProgress = true;
        privateScope.clearMavlinkWaitingRefreshTimer();

        GUI.log(
            `<span style="color: #d98f00">No vehicle heartbeat has arrived. ` +
            `Flight Commander is refreshing ${safePort} to re-arm the ` +
            `ExpressLRS USB MAVLink bridge (attempt ${attempt}). ` +
            `The independent USB RTK base connection and survey continue.</span>`,
        );

        mavlinkSession.detach();
        connection.emptyOutputBuffer?.();

        const scheduleAnotherAttempt = () => {
            if (
                generation !== privateScope.mavlinkWaitingRefreshGeneration
            ) {
                return;
            }
            privateScope.mavlinkWaitingRefreshInProgress = false;
            privateScope.scheduleMavlinkWaitingRefresh();
        };

        const reopen = () => {
            setTimeout(() => {
                if (
                    generation !== privateScope.mavlinkWaitingRefreshGeneration ||
                    GUI.connected_to === false ||
                    privateScope.disconnectInProgress
                ) {
                    privateScope.mavlinkWaitingRefreshInProgress = false;
                    return;
                }

                connection.connect(
                    openAttempt.port,
                    serialOptionsForProtocol('mavlink', openAttempt.bitrate),
                    openInfo => {
                        if (
                            generation !== privateScope.mavlinkWaitingRefreshGeneration ||
                            GUI.connected_to === false ||
                            privateScope.disconnectInProgress
                        ) {
                            privateScope.mavlinkWaitingRefreshInProgress = false;
                            if (openInfo && connection.connectionId) {
                                connection.disconnect();
                            }
                            return;
                        }

                        privateScope.mavlinkWaitingRefreshInProgress = false;
                        if (!openInfo) {
                            GUI.log(
                                `<span style="color: #d98f00">${safePort} ` +
                                `did not reopen during MAVLink recovery; ` +
                                `Flight Commander will keep retrying.</span>`,
                            );
                            privateScope.scheduleMavlinkWaitingRefresh();
                            return;
                        }

                        privateScope.activeOpenedAt = Date.now();
                        privateScope.activeMavlinkHeartbeatReceived = false;
                        GUI.log(
                            `MAVLink radio transport refreshed on ${safePort}; ` +
                            `waiting for the aircraft heartbeat.`,
                        );
                        try {
                            privateScope.onMavlinkTransportOpen();
                            mavlinkSession.attach(connection);
                        } catch (error) {
                            privateScope.onMavlinkTransportStartupFailure(error);
                            privateScope.scheduleMavlinkWaitingRefresh();
                        }
                    },
                );
            }, MAVLINK_WAITING_REOPEN_SETTLE_MS);
        };

        try {
            if (connection.connectionId) {
                connection.disconnect(() => reopen());
            } else {
                reopen();
            }
        } catch (error) {
            GUI.log(
                `<span style="color: #d42133">Unable to refresh ${safePort}: ` +
                `${$('<div>').text(error?.message || error).html()}</span>`,
            );
            scheduleAnotherAttempt();
        }
        return true;
    };
"""
    replace_once(path, marker, helpers, "waiting-recovery helpers")

    replace_once(
        path,
        """                if (isIdle && !requestedAttempt) {
                    privateScope.cancelUnexpectedSerialRecovery();
                }""",
        """                if (isIdle && !requestedAttempt) {
                    privateScope.cancelUnexpectedSerialRecovery();
                    privateScope.cancelMavlinkWaitingRefresh();
                }""",
        "operator-connect reset",
    )
    replace_once(
        path,
        """                        privateScope.disconnectInProgress = true;
                        const operatorRequested = !forceDisconnect;""",
        """                        privateScope.cancelMavlinkWaitingRefresh();
                        privateScope.disconnectInProgress = true;
                        const operatorRequested = !forceDisconnect;""",
        "operator-disconnect cancel",
    )
    replace_once(
        path,
        """        privateScope.activeMavlinkHeartbeatReceived = true;
        privateScope.cancelUnexpectedSerialRecovery();
        GUI.mavlinkWaitingMessage = null;""",
        """        privateScope.activeMavlinkHeartbeatReceived = true;
        privateScope.cancelUnexpectedSerialRecovery();
        privateScope.cancelMavlinkWaitingRefresh();
        GUI.mavlinkWaitingMessage = null;""",
        "connected recovery cancel",
    )
    replace_once(
        path,
        """        GUI.mavlinkWaitingMessage =
            'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live.';""",
        """        GUI.mavlinkWaitingMessage =
            'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live. If the radio was attached too early, Flight Commander will refresh only its COM port automatically.';""",
        "waiting message",
    )
    replace_once(
        path,
        """        privateScope.requestGroundControlOpen();
    };

    privateScope.onLtmConnected""",
        """        privateScope.requestGroundControlOpen();
        privateScope.scheduleMavlinkWaitingRefresh();
    };

    privateScope.onLtmConnected""",
        "waiting recovery schedule",
    )
    replace_once(
        path,
        """    privateScope.clearProtocolSession = function ({
        preserveStatusMessage = false,
    } = {}) {
        mavlinkCommandRouter.stop();""",
        """    privateScope.clearProtocolSession = function ({
        preserveStatusMessage = false,
    } = {}) {
        privateScope.cancelMavlinkWaitingRefresh();
        mavlinkCommandRouter.stop();""",
        "protocol cleanup cancel",
    )
    replace_once(
        path,
        """                            const message =
                                'The MAVLink serial transport is open, but no vehicle heartbeat was received. ' +
                                'Flight Commander will keep listening; verify the aircraft/radio link and use ' +
                                '460800 baud for ExpressLRS USB MAVLink.';""",
        """                            const message =
                                'The MAVLink serial transport is open, but no vehicle heartbeat was received. ' +
                                'Flight Commander will keep listening and periodically refresh only the selected ' +
                                'radio COM port; verify the aircraft/radio link and use 460800 baud for ExpressLRS USB MAVLink. ' +
                                'Any USB RTK base survey remains connected independently.';""",
        "no-heartbeat guidance",
    )


def patch_rtk_guidance() -> None:
    path = ROOT / "tabs/rtk_base.html"
    replace_once(
        path,
        """            <p>Choose what equipment and correction source you have. Flight Commander will show only the settings and next action needed for that path.</p>""",
        """            <p>Choose what equipment and correction source you have. Flight Commander will show only the settings and next action needed for that path.</p>
            <p class="rtk-base-note">Keep Flight Commander open while the base surveys with the aircraft off. The aircraft radio may be attached later; vehicle COM-port recovery does not close or reset this independent USB-base session.</p>""",
        "offline base guidance",
    )


def write_tests() -> None:
    altitude = ROOT / "tests/flight-commander/gcs/mavlink-altitude-telemetry.test.mjs"
    altitude.write_text(
        '''import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRMWARE_FAMILY_INAV,
  FIRMWARE_FAMILY_UNSUPPORTED,
  MAV_AUTOPILOT_GENERIC,
  MavlinkSession,
} from "../../../js/mavlink/mavlinkSession.js";

function sessionForTelemetry(overrides = {}) {
  const session = new MavlinkSession({
    bridge: {},
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  session.connection = {};
  Object.assign(session.state, overrides);
  return session;
}

function frame(messageName, data) {
  return {
    messageName,
    data,
    header: { sysid: 1, compid: 1 },
    protocol: "MAV_V2",
  };
}

test("INAV VFR_HUD altitude feeds relative altitude without GPS", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_INAV,
    autopilot: MAV_AUTOPILOT_GENERIC,
  });
  session.handleMessage(frame("VfrHud", {
    alt: 12.75,
    airspeed: 0,
    groundspeed: 0,
    climb: -0.2,
    heading: 275,
  }));
  assert.equal(session.state.relativeAltitude, 12.75);
  assert.equal(session.state.altitudeMsl, null);
});

test("GPS_RAW_INT supplies MSL altitude only with a 3D fix", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_INAV,
    autopilot: MAV_AUTOPILOT_GENERIC,
  });
  session.handleMessage(frame("GpsRawInt", {
    fixType: 1,
    alt: 123450,
    satellitesVisible: 0,
    eph: 65535,
  }));
  assert.equal(session.state.altitudeMsl, null);

  session.handleMessage(frame("GpsRawInt", {
    fixType: 3,
    alt: 123450,
    satellitesVisible: 12,
    eph: 95,
  }));
  assert.equal(session.state.altitudeMsl, 123.45);
});

test("non-INAV VFR_HUD keeps standard MSL semantics", () => {
  const session = sessionForTelemetry({
    firmwareFamily: FIRMWARE_FAMILY_UNSUPPORTED,
    autopilot: 12,
  });
  session.handleMessage(frame("VfrHud", {
    alt: 85.5,
    airspeed: 0,
    groundspeed: 0,
    climb: 0,
    heading: 0,
  }));
  assert.equal(session.state.altitudeMsl, 85.5);
  assert.equal(session.state.relativeAltitude, null);
});
''',
        encoding="utf-8",
    )

    recovery = ROOT / "tests/flight-commander/gcs/mavlink-waiting-recovery.test.mjs"
    recovery.write_text(
        '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAVLINK_WAITING_REFRESH_DELAY_MS,
  MAVLINK_WAITING_REOPEN_SETTLE_MS,
  shouldRefreshWaitingMavlinkTransport,
} from "../../../js/connection/mavlinkWaitingRecovery.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("waiting MAVLink serial links remain eligible until heartbeat", () => {
  const waiting = {
    protocol: "mavlink",
    serialTransport: true,
    hasPort: true,
    connectionValid: false,
    vehicleConnected: false,
    refreshInProgress: false,
    disconnectInProgress: false,
  };
  assert.equal(shouldRefreshWaitingMavlinkTransport(waiting), true);
  for (const override of [
    { protocol: "msp" },
    { serialTransport: false },
    { hasPort: false },
    { connectionValid: true },
    { vehicleConnected: true },
    { refreshInProgress: true },
    { disconnectInProgress: true },
  ]) {
    assert.equal(
      shouldRefreshWaitingMavlinkTransport({ ...waiting, ...override }),
      false,
    );
  }
  assert.ok(MAVLINK_WAITING_REFRESH_DELAY_MS >= 5000);
  assert.ok(MAVLINK_WAITING_REOPEN_SETTLE_MS >= 250);
});

test("radio recovery cycles only vehicle serial, not RTK base", () => {
  const backend = readFileSync(resolve(root, "js/serial_backend.js"), "utf8");
  const start = backend.indexOf(
    "privateScope.refreshMavlinkWaitingTransport = function () {",
  );
  const end = backend.indexOf(
    "/*\n     * Handle \"Wireless\" mode",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const block = backend.slice(start, end);
  assert.match(block, /connection\.disconnect/);
  assert.match(block, /connection\.connect/);
  assert.doesNotMatch(block, /privateScope\.reConnect/);
  assert.doesNotMatch(block, /tab_switch_cleanup/);
  assert.doesNotMatch(block, /rtkBaseStation/);

  const rtk = readFileSync(resolve(root, "tabs/rtk_base.js"), "utf8");
  const cleanupStart = rtk.indexOf("rtkBaseTab.cleanup = function cleanup");
  const cleanupEnd = rtk.indexOf("export default rtkBaseTab", cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.doesNotMatch(
    rtk.slice(cleanupStart, cleanupEnd),
    /rtkBaseStation\.disconnect/,
  );
});
''',
        encoding="utf-8",
    )


def main() -> int:
    patch_altitude()
    write_policy()
    patch_serial_backend()
    patch_rtk_guidance()
    write_tests()
    print("Applied MAVLink altitude and connection-order recovery patch.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
