#!/usr/bin/env python3
"""Assemble the verified Flight Commander 4.1.0 Configurator-only release."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.1.0"
FIRMWARE_VERSION = "4.0.8"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str, label: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one {label} block, found {count}")
    write(path, text.replace(old, new, 1))


def patch_altitude_routing() -> None:
    path = "js/mavlink/mavlinkSession.js"
    replace_once(
        path,
        '''      case "GpsRawInt": {
        this.state.gpsFix = numeric(field(data, "fixType", "fix_type")) ?? 0;
        const satellites = numeric(
          field(data, "satellitesVisible", "satellites_visible"),
        );
        this.state.satellites =
          satellites == null || satellites === 255 ? null : satellites;
        const eph = numeric(field(data, "eph"));
        this.state.hdop = eph == null || eph === 65535 ? null : eph / 100;
        break;
      }''',
        '''      case "GpsRawInt": {
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
      }''',
        "GPS_RAW_INT altitude routing",
    )
    replace_once(
        path,
        '''      case "VfrHud":
        this.state.airSpeed = numeric(field(data, "airspeed"));
        this.state.groundSpeed = numeric(field(data, "groundspeed"));
        this.state.climbRate = numeric(field(data, "climb"));
        this.state.heading = numeric(field(data, "heading"));
        break;''',
        '''      case "VfrHud": {
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
      }''',
        "VFR_HUD altitude routing",
    )


def patch_serial_recovery() -> None:
    path = "js/serial_backend.js"
    replace_once(
        path,
        '''var SerialBackend = (function () {

    var publicScope = {},''',
        '''var SerialBackend = (function () {

    const MAVLINK_WAITING_REFRESH_DELAY_MS = 12000;
    const MAVLINK_WAITING_REOPEN_SETTLE_MS = 750;

    const mavlinkWaitingTransportIsRecoverable = function (options = {}) {
        return Boolean(
            options.protocol === 'mavlink' &&
            options.activeProtocol === 'mavlink' &&
            options.connectionProtocol === 'mavlink' &&
            options.serialTransport === true &&
            options.hasPort === true &&
            options.connectionValid !== true &&
            options.vehicleConnected !== true &&
            options.refreshInProgress !== true &&
            options.disconnectInProgress !== true
        );
    };

    var publicScope = {},''',
        "waiting-recovery policy",
    )
    replace_once(
        path,
        '''    privateScope.unexpectedTerminalOperatorGuardUntil = 0;
    privateScope.sitlDemoConnectTimer = null;
''',
        '''    privateScope.unexpectedTerminalOperatorGuardUntil = 0;
    privateScope.sitlDemoConnectTimer = null;
    privateScope.mavlinkWaitingRefreshTimer = null;
    privateScope.mavlinkWaitingRefreshGeneration = 0;
    privateScope.mavlinkWaitingRefreshInProgress = false;
    privateScope.mavlinkWaitingRefreshAttempt = 0;
''',
        "waiting-recovery state",
    )

    marker = '''    privateScope.cancelUnexpectedSerialRecovery = function () {
        privateScope.unexpectedSerialRecoveryGeneration += 1;
        if (privateScope.unexpectedSerialRecoveryTimer != null) {
            clearTimeout(privateScope.unexpectedSerialRecoveryTimer);
            privateScope.unexpectedSerialRecoveryTimer = null;
            return true;
        }
        return false;
    };
'''
    helpers = marker + '''
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
        return mavlinkWaitingTransportIsRecoverable({
            protocol: privateScope.activeOpenAttempt?.protocol,
            activeProtocol: privateScope.activeProtocol,
            connectionProtocol: CONFIGURATOR.connectionProtocol,
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
            `radio USB MAVLink bridge (attempt ${attempt}). ` +
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
'''
    replace_once(path, marker, helpers, "waiting-recovery helpers")

    substitutions = [
        (
            '''        privateScope.$protocol.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();''',
            '''        privateScope.$protocol.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();''',
            "protocol-change recovery cancellation",
        ),
        (
            '''        privateScope.$baud.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();''',
            '''        privateScope.$baud.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();''',
            "baud-change recovery cancellation",
        ),
        (
            '''        publicScope.$portOverride.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();''',
            '''        publicScope.$portOverride.on('change', function () {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();''',
            "manual-port recovery cancellation",
        ),
        (
            '''        privateScope.$port.on('change', function (target) {
            privateScope.cancelUnexpectedSerialRecovery();''',
            '''        privateScope.$port.on('change', function (target) {
            privateScope.cancelUnexpectedSerialRecovery();
            privateScope.cancelMavlinkWaitingRefresh();''',
            "port recovery cancellation",
        ),
        (
            '''                if (isIdle && !requestedAttempt) {
                    privateScope.cancelUnexpectedSerialRecovery();
                }''',
            '''                if (isIdle && !requestedAttempt) {
                    privateScope.cancelUnexpectedSerialRecovery();
                    privateScope.cancelMavlinkWaitingRefresh();
                }''',
            "operator-connect recovery reset",
        ),
        (
            '''                        privateScope.disconnectInProgress = true;
                        const operatorRequested = !forceDisconnect;''',
            '''                        privateScope.cancelMavlinkWaitingRefresh();
                        privateScope.disconnectInProgress = true;
                        const operatorRequested = !forceDisconnect;''',
            "operator-disconnect recovery cancellation",
        ),
        (
            '''        privateScope.activeMavlinkHeartbeatReceived = true;
        privateScope.cancelUnexpectedSerialRecovery();
        GUI.mavlinkWaitingMessage = null;''',
            '''        privateScope.activeMavlinkHeartbeatReceived = true;
        privateScope.cancelUnexpectedSerialRecovery();
        privateScope.cancelMavlinkWaitingRefresh();
        GUI.mavlinkWaitingMessage = null;''',
            "heartbeat recovery cancellation",
        ),
        (
            '''        GUI.mavlinkWaitingMessage =
            'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live.';''',
            '''        GUI.mavlinkWaitingMessage =
            'Waiting for a MAVLink vehicle heartbeat. Telemetry and commands remain disabled until the aircraft link is live. If startup order left the radio bridge idle, Flight Commander will refresh only its COM port automatically.';''',
            "waiting status guidance",
        ),
        (
            '''        privateScope.requestGroundControlOpen();
    };

    privateScope.onLtmConnected''',
            '''        privateScope.requestGroundControlOpen();
        privateScope.scheduleMavlinkWaitingRefresh();
    };

    privateScope.onLtmConnected''',
            "waiting recovery schedule",
        ),
        (
            '''    privateScope.clearProtocolSession = function ({
        preserveStatusMessage = false,
    } = {}) {
        mavlinkCommandRouter.stop();''',
            '''    privateScope.clearProtocolSession = function ({
        preserveStatusMessage = false,
    } = {}) {
        privateScope.cancelMavlinkWaitingRefresh();
        mavlinkCommandRouter.stop();''',
            "protocol cleanup recovery cancellation",
        ),
        (
            '''                            const message =
                                'The MAVLink serial transport is open, but no vehicle heartbeat was received. ' +
                                'Flight Commander will keep listening; verify the aircraft/radio link and use ' +
                                '460800 baud for ExpressLRS USB MAVLink.';''',
            '''                            const message =
                                'The MAVLink serial transport is open, but no vehicle heartbeat was received. ' +
                                'Flight Commander will keep listening and periodically refresh only the selected ' +
                                'radio COM port; verify the aircraft/radio link and use 460800 baud for ExpressLRS USB MAVLink. ' +
                                'Any independent USB RTK base survey remains connected.';''',
            "no-heartbeat recovery guidance",
        ),
    ]
    for old, new, label in substitutions:
        replace_once(path, old, new, label)


def patch_rtk_guidance() -> None:
    replace_once(
        "tabs/rtk_base.html",
        '''            <p>Choose what equipment and correction source you have. Flight Commander will show only the settings and next action needed for that path.</p>''',
        '''            <p>Choose what equipment and correction source you have. Flight Commander will show only the settings and next action needed for that path.</p>
            <p class="rtk-base-note">The USB base can survey while the aircraft is off. Connect the aircraft radio later in any order; automatic vehicle COM-port recovery does not close or reset this independent base session.</p>''',
        "aircraft-off RTK guidance",
    )


def patch_release_metadata() -> None:
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    package["flightCommander"]["firmwareChangedInRelease"] = False
    package["flightCommander"]["firmwareReleaseVersion"] = FIRMWARE_VERSION
    package["flightCommander"]["firmwareSourceVersion"] = FIRMWARE_VERSION
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    landing = read("tabs/landing.html")
    start = landing.index('          <h2>Flight Commander 4.0.8</h2>')
    end = landing.index('          <h2 style="margin-top: 1em">Open-source foundations</h2>', start)
    release_copy = '''          <h2>Flight Commander 4.1.0</h2>
          <p>
            Flight Commander 4.1.0 removes the MAVLink startup-order dependency.
            Ground Control now keeps listening and automatically refreshes only
            the selected radio COM port until a valid aircraft heartbeat arrives.
          </p>
          <p>
            The independent USB RTK base connection remains open during radio
            recovery, so survey-in can begin with the aircraft powered off and
            the aircraft link can be added later without restarting the survey.
          </p>
          <p>
            INAV barometer/INS altitude from VFR_HUD is shown as relative
            altitude, while valid GPS altitude remains the MSL source. Live GCS
            diagnostics and the 4.0.8 compass, IMU and ground-speed fixes remain.
          </p>
          <p>
            This is a Configurator-only beta. It reuses the verified Flight
            Commander Firmware 4.0.8 image and exact 4.0.8 firmware source; no
            flight-controller reflash is required when upgrading from 4.0.8.
          </p>
'''
    write("tabs/landing.html", landing[:start] + release_copy + landing[end:])

    write(
        "release/notes/v4.1.0-beta.md",
        '''# Flight Commander 4.1.0 Beta

Flight Commander 4.1.0 is a Configurator-only reliability release for Ground Control and RTK survey workflows.

## Ground Control connection recovery

- Removes the requirement to power and connect the radio controller, aircraft, PC and application in one exact order.
- While a selected serial MAVLink link is open but no aircraft heartbeat arrives, Flight Commander periodically closes and reopens only that vehicle-radio COM port.
- Recovery stops immediately after a heartbeat, an operator disconnect, or a port/protocol change.
- Existing live MAVLink diagnostics remain available in Ground Control.

## Aircraft-off RTK survey-in

- The USB RTK base receiver remains an independent serial session.
- Base survey-in and RTCM monitoring continue while the aircraft is powered off.
- Connecting the aircraft radio later, or recovering its COM port, does not close or reset the base survey.

## Altitude telemetry

- INAV `VFR_HUD.alt` is displayed as relative barometer/INS altitude.
- GPS altitude is retained as MSL altitude after a valid 3D fix.
- Existing `GLOBAL_POSITION_INT` altitude behavior remains compatible.

## Firmware

This release reuses the verified **Flight Commander Firmware 4.0.8** MICOAIR743 image and its exact published source archive. The firmware did not change, so aircraft already running Firmware 4.0.8 do not need to be reflashed.

Use propellers-off bench testing for the first connection-order and RTK workflow checks.
''',
    )


def patch_beta_publisher() -> None:
    path = ".github/workflows/publish-flight-commander-beta.yml"
    text = read(path)

    old_outputs = '''      version: ${{ steps.metadata.outputs.version }}
      tag: ${{ steps.metadata.outputs.tag }}'''
    new_outputs = '''      version: ${{ steps.metadata.outputs.version }}
      firmware_version: ${{ steps.metadata.outputs.firmware_version }}
      firmware_changed_in_release: ${{ steps.metadata.outputs.firmware_changed_in_release }}
      tag: ${{ steps.metadata.outputs.tag }}'''
    if text.count(old_outputs) != 1:
        raise SystemExit("beta publisher: output anchor is missing")
    text = text.replace(old_outputs, new_outputs, 1)

    start_marker = "          package = json.loads(Path('package.json').read_text(encoding='utf-8'))\n"
    end_marker = "          PY\n          node scripts/check-flight-commander-version.mjs"
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    validation = '''          package = json.loads(Path('package.json').read_text(encoding='utf-8'))
          manifest = json.loads(Path('manifest.json').read_text(encoding='utf-8'))
          version = package['version']
          assert manifest['version'] == version, (manifest['version'], version)

          fc = package['flightCommander']
          firmware_version = fc['firmwareReleaseVersion']
          firmware_changed = fc['firmwareChangedInRelease']
          assert isinstance(firmware_changed, bool)
          assert fc['firmwareSourceAvailable'] is True
          assert fc['firmwareSourceVersion'] == firmware_version
          assert fc['firmwareMajor'] == int(version.split('.', 1)[0])
          assert int(firmware_version.split('.', 1)[0]) == fc['firmwareMajor']
          if firmware_changed:
              assert firmware_version == version

          firmware_name = f'Flight-Commander-Firmware-{firmware_version}-MICOAIR743.hex'
          source_name = f'Flight-Commander-Firmware-Source-v{firmware_version}.zip'
          firmware = Path('release/firmware') / firmware_name
          source = Path('release/firmware') / source_name
          assert firmware.is_file(), firmware
          assert source.is_file(), source
          assert firmware.stat().st_size > 1024 * 1024
          assert source.stat().st_size > 1024 * 1024

          firmware_hash = hashlib.sha256(firmware.read_bytes()).hexdigest()
          source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
          assert firmware_hash == fc['firmwareReleaseSha256']
          assert source_hash == fc['firmwareSourceSha256']
          assert fc['firmwareSourceArchive'] == source.as_posix()

          with zipfile.ZipFile(source) as archive:
              assert archive.testzip() is None
              roots = {name.split('/', 1)[0] for name in archive.namelist() if name}
              assert roots == {f'Flight-Commander-Firmware-Source-v{firmware_version}'}
              manifest_name = next(
                  name for name in archive.namelist()
                  if name.endswith('/RELEASE-MANIFEST.json')
              )
              source_manifest = json.loads(archive.read(manifest_name))
          assert source_manifest['version'] == firmware_version
          assert source_manifest['target'] == 'MICOAIR743'
          assert source_manifest['artifact']['sha256'] == firmware_hash
          assert source_manifest['source_revision'] == fc['firmwareSourceRevision']
          assert source_manifest['source_tree'] == fc['firmwareSourceTree']

          notes = Path('release/notes') / f'v{version}-beta.md'
          assert notes.is_file(), notes

          output = Path(os.environ['GITHUB_OUTPUT'])
          with output.open('a', encoding='utf-8') as stream:
              stream.write(f'version={version}\\n')
              stream.write(f'firmware_version={firmware_version}\\n')
              stream.write(f'firmware_changed_in_release={str(firmware_changed).lower()}\\n')
              stream.write(f'tag=v{version}-beta\\n')
              stream.write(f'release_sha={os.environ["GITHUB_SHA"]}\\n')
              stream.write(f'firmware_file={firmware_name}\\n')
              stream.write(f'firmware_source_file={source_name}\\n')
              stream.write(f'notes_file={notes.as_posix()}\\n')

          release_kind = 'firmware-changing' if firmware_changed else 'Configurator-only'
          print(f'Flight Commander {version} {release_kind} retained inputs: PASS')
          print(f'Published firmware version: {firmware_version}')
          print(f'Firmware SHA-256: {firmware_hash}')
          print(f'Source SHA-256:   {source_hash}')
'''
    text = text[:start] + validation + text[end:]

    old_env = '''          VERSION: ${{ needs.validate-release.outputs.version }}
          RELEASE_SHA: ${{ needs.validate-release.outputs.release_sha }}
          FIRMWARE_FILE: ${{ needs.validate-release.outputs.firmware_file }}'''
    new_env = '''          VERSION: ${{ needs.validate-release.outputs.version }}
          FIRMWARE_VERSION: ${{ needs.validate-release.outputs.firmware_version }}
          FIRMWARE_CHANGED_IN_RELEASE: ${{ needs.validate-release.outputs.firmware_changed_in_release }}
          RELEASE_SHA: ${{ needs.validate-release.outputs.release_sha }}
          FIRMWARE_FILE: ${{ needs.validate-release.outputs.firmware_file }}'''
    if text.count(old_env) != 1:
        raise SystemExit("beta publisher: packaging environment anchor is missing")
    text = text.replace(old_env, new_env, 1)

    replacements = [
        (
            '''          $firmwareComponent = Join-Path $components "FC-Firmware-v$env:VERSION-MICOAIR743.hex"
          $firmwareSourceComponent = Join-Path $components "FC-Firmware-Source-v$env:VERSION.zip"''',
            '''          $firmwareComponent = Join-Path $components "FC-Firmware-v$env:FIRMWARE_VERSION-MICOAIR743.hex"
          $firmwareSourceComponent = Join-Path $components "FC-Firmware-Source-v$env:FIRMWARE_VERSION.zip"''',
            "firmware component identity",
        ),
        (
            '''            "FC-Firmware-Source-v$env:VERSION.zip",
            "FC-Firmware-v$env:VERSION-MICOAIR743.hex",''',
            '''            "FC-Firmware-Source-v$env:FIRMWARE_VERSION.zip",
            "FC-Firmware-v$env:FIRMWARE_VERSION-MICOAIR743.hex",''',
            "expected firmware component identity",
        ),
        (
            '''            completeBundle = [IO.Path]::GetFileName($completeZip)
          }''',
            '''            completeBundle = [IO.Path]::GetFileName($completeZip)
            firmwareVersion = $env:FIRMWARE_VERSION
            firmwareChangedInRelease = [System.Convert]::ToBoolean($env:FIRMWARE_CHANGED_IN_RELEASE)
          }''',
            "release manifest firmware identity",
        ),
    ]
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"beta publisher: expected one {label}, found {count}")
        text = text.replace(old, new, 1)

    write(path, text)


def write_tests() -> None:
    write(
        "tests/flight-commander/gcs/mavlink-altitude-telemetry.test.mjs",
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

test("GLOBAL_POSITION_INT keeps existing MSL and relative altitude behavior", () => {
  const session = sessionForTelemetry({ gpsFix: 0 });
  session.handleMessage(frame("GlobalPositionInt", {
    lat: 334455667,
    lon: -881122334,
    alt: 123450,
    relativeAlt: 6789,
    vx: 0,
    vy: 0,
    hdg: 9000,
  }));
  assert.equal(session.state.altitudeMsl, 123.45);
  assert.equal(session.state.relativeAltitude, 6.789);
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
    )

    write(
        "tests/flight-commander/gcs/mavlink-waiting-recovery.test.mjs",
        '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const backend = readFileSync(resolve(root, "js/serial_backend.js"), "utf8");

test("waiting serial MAVLink links use a bounded COM refresh loop", () => {
  assert.match(backend, /MAVLINK_WAITING_REFRESH_DELAY_MS = 12000/);
  assert.match(backend, /MAVLINK_WAITING_REOPEN_SETTLE_MS = 750/);
  assert.match(
    backend,
    /privateScope\.onMavlinkTransportOpen[\s\S]*privateScope\.scheduleMavlinkWaitingRefresh\(\)/,
  );
  assert.match(
    backend,
    /privateScope\.onMavlinkConnected[\s\S]*privateScope\.cancelMavlinkWaitingRefresh\(\)/,
  );
});

test("radio recovery cycles only the vehicle serial transport", () => {
  const start = backend.indexOf(
    "privateScope.refreshMavlinkWaitingTransport = function () {",
  );
  const end = backend.indexOf("    publicScope.init = function() {", start);
  assert.ok(start >= 0 && end > start);
  const block = backend.slice(start, end);
  assert.match(block, /connection\.disconnect/);
  assert.match(block, /connection\.connect/);
  assert.match(block, /mavlinkSession\.detach/);
  assert.doesNotMatch(block, /privateScope\.reConnect/);
  assert.doesNotMatch(block, /tab_switch_cleanup/);
  assert.doesNotMatch(block, /rtkBaseStation/);
});

test("RTK base cleanup does not disconnect the independent USB base", () => {
  const rtk = readFileSync(resolve(root, "tabs/rtk_base.js"), "utf8");
  const cleanupStart = rtk.indexOf("rtkBaseTab.cleanup = function cleanup");
  const cleanupEnd = rtk.indexOf("export default rtkBaseTab", cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.doesNotMatch(
    rtk.slice(cleanupStart, cleanupEnd),
    /rtkBaseStation\.disconnect/,
  );

  const html = readFileSync(resolve(root, "tabs/rtk_base.html"), "utf8");
  assert.match(html, /survey while the aircraft is off/i);
  assert.match(html, /does not close or reset this independent base session/i);
});
''',
    )

    write(
        "tests/flight-commander/release/software-only-beta-publisher.test.mjs",
        '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(
  resolve(root, ".github/workflows/publish-flight-commander-beta.yml"),
  "utf8",
);

test("4.1.0 is declared as a Configurator-only release reusing verified 4.0.8 firmware", () => {
  assert.equal(packageJson.version, "4.1.0");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, false);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.0.8");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.0.8");
});

test("beta publisher keeps Configurator and firmware versions distinct", () => {
  assert.match(publisher, /firmware_version=\$\{\{ steps\.metadata\.outputs\.firmware_version \}\}/);
  assert.match(publisher, /FIRMWARE_VERSION: \$\{\{ needs\.validate-release\.outputs\.firmware_version \}\}/);
  assert.match(publisher, /FC-Firmware-v\$env:FIRMWARE_VERSION-MICOAIR743\.hex/);
  assert.match(publisher, /FC-Firmware-Source-v\$env:FIRMWARE_VERSION\.zip/);
  assert.doesNotMatch(publisher, /assert fc\['firmwareChangedInRelease'\] is True/);
});
''',
    )


def main() -> int:
    patch_altitude_routing()
    patch_serial_recovery()
    patch_rtk_guidance()
    patch_release_metadata()
    patch_beta_publisher()
    write_tests()
    print("Applied Flight Commander 4.1.0 GCS recovery and release assembly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
