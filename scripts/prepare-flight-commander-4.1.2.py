#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path.cwd()
CHANGED: list[str] = []


def path_for(relative: str) -> Path:
    return ROOT / relative


def read(relative: str) -> str:
    return path_for(relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = path_for(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == content:
        return
    path.write_text(content, encoding="utf-8", newline="\n")
    CHANGED.append(relative)


def replace_literal(relative: str, old: str, new: str, *, required: bool = False) -> None:
    content = read(relative)
    if old not in content:
        if required and new not in content:
            raise RuntimeError(f"{relative}: required text was not found: {old[:100]!r}")
        return
    write(relative, content.replace(old, new))


def replace_regex(
    relative: str,
    pattern: str,
    replacement: str,
    *,
    count: int = 0,
    flags: int = re.MULTILINE | re.DOTALL,
    required: bool = False,
) -> None:
    content = read(relative)
    updated, matches = re.subn(pattern, replacement, content, count=count, flags=flags)
    if matches == 0:
        if required and replacement not in content:
            raise RuntimeError(f"{relative}: required pattern was not found: {pattern[:120]!r}")
        return
    write(relative, updated)


def update_json(relative: str, mutate) -> None:
    data = json.loads(read(relative))
    mutate(data)
    write(relative, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def replace_user_facing_inav_terms(relative: str) -> None:
    content = read(relative)
    replacements = [
        ("Official INAV Firmware", "unsupported firmware"),
        ("Official INAV firmware", "unsupported firmware"),
        ("Official INAV", "unsupported firmware"),
        ("official INAV", "unsupported firmware"),
        ("INAV compatibility mode", "unsupported-firmware state"),
        ("INAV-compatible MAVLink", "Flight Commander MAVLink"),
        ("Flight Commander/INAV-compatible", "Flight Commander"),
        ("INAV-compatible controller", "Flight Commander controller"),
        ("INAV controller", "Flight Commander controller"),
        ("wired INAV/MSP", "wired Flight Commander MSP"),
        ("Wired INAV/MSP", "Wired Flight Commander MSP"),
        ("INAV/MSP", "Flight Commander MSP"),
        ("INAV LTM telemetry", "unsupported LTM telemetry"),
        ("INAV mission", "Flight Commander mission"),
        ("INAV MAVLink", "Flight Commander MAVLink"),
        ("from INAV", "from Flight Commander Firmware"),
        ("to INAV", "to Flight Commander Firmware"),
        ("reboot INAV", "reboot Flight Commander Firmware"),
        ("INAV progress", "Flight Commander progress"),
    ]
    for old, new in replacements:
        content = content.replace(old, new)
    write(relative, content)


# ---------------------------------------------------------------------------
# Release identity and metadata
# ---------------------------------------------------------------------------
update_json("package.json", lambda data: data.__setitem__("version", "4.1.2"))
update_json("manifest.json", lambda data: data.__setitem__("version", "4.1.2"))
replace_regex(
    "js/main/ntripClient.js",
    r"NTRIP FlightCommander/\d+\.\d+\.\d+",
    "NTRIP FlightCommander/4.1.2",
    required=True,
)

write(
    "release/notes/v4.1.2.md",
    """# Flight Commander 4.1.2 Release

Flight Commander 4.1.2 removes the retired stock-INAV compatibility product path and makes Flight Commander Firmware the only supported controller firmware.

## Flight Commander Firmware only

- The Firmware Flasher now exposes only Flight Commander Firmware and rejects every HEX that does not contain the required `FCFW` identity.
- Wired MSP connections must complete the versioned Flight Commander identity probe before configuration tabs are unlocked.
- MAVLink no longer classifies a generic heartbeat as stock INAV while waiting for `AUTOPILOT_VERSION`; controls remain locked until the `FCFW` signature and advertised capabilities are verified.
- Ground Control, Flight Planner, firmware capability reporting, RTK correction routing, documentation, warnings, and connection status no longer provide an official-INAV compatibility mode or reduced-functionality path.
- Inherited MSP setting names, mission records, and protocol internals remain where Flight Commander Firmware still uses those formats; they are implementation details rather than stock-firmware support.

## Firmware

This is a Configurator-only release. It reuses the verified **Flight Commander Firmware 4.0.8** MICOAIR743 image and its exact published firmware source archive. Aircraft already running Firmware 4.0.8 do not need to be reflashed merely to install Configurator 4.1.2.

Use propellers-off bench testing for the first connection and Ground Control command check.
""",
)

# Release workflow: accept the 4.1.2 publication commit and remove stale
# compatibility wording from the generated release body.
replace_literal(
    ".github/workflows/release.yml",
    "Publish Flight Commander 3.0.3 release",
    "Publish Flight Commander 4.1.2 release",
    required=True,
)
replace_literal(
    ".github/workflows/release.yml",
    "Flight Commander $version is a coordinated Configurator and Firmware\n          release. Firmware is built from the official INAV 9.1.0 MICOAIR743\n          target and protects its target, compass drivers, bus, and calibration\n          baseline. Flight Commander heading fusion plus UART and DroneCAN\n          moving-baseline yaw enter through the AHRS yaw-reference stage.",
    "Flight Commander $version is a Flight Commander Firmware-only Configurator\n          release. The unchanged verified MICOAIR743 firmware image remains\n          truthfully versioned $firmwareVersion, with its exact retained source\n          archive and reproducibility contract preserved.",
)
replace_literal(
    ".github/workflows/release.yml",
    "and normal editable INAV alignment without a forced compass override.",
    "and normal editable compass alignment without a forced override.",
)

# ---------------------------------------------------------------------------
# Firmware identity: retain inherited transport identifiers internally, but a
# missing FCFW response is now an unsupported identity, never a product mode.
# ---------------------------------------------------------------------------
identity_path = "js/flightCommander/firmwareIdentity.js"
replace_regex(
    identity_path,
    r"export function createInavFirmwareIdentity\(\n  compatibleInavVersion = \"0\.0\.0\",\n  probe = \{\},\n\) \{.*?\n\}\n\nexport function inspectFlightCommanderInfo",
    '''export function createInavFirmwareIdentity(
  compatibleInavVersion = "0.0.0",
  probe = {},
) {
  return immutableIdentity({
    // The inherited INAV family token is retained only as a low-level
    // discovery result. It is not a supported Flight Commander product mode.
    family: FIRMWARE_FAMILY_INAV,
    displayName: "Unsupported firmware",
    detected: false,
    protocolSupported: false,
    schemaVersion: null,
    firmwareVersion: null,
    compatibleInavVersion,
    capabilities: 0,
    capabilityNames: [],
    unknownCapabilities: 0,
    probeStatus: probe.probeStatus ?? "not-advertised",
    probeError:
      probe.probeError ??
      "The controller did not advertise the required Flight Commander FCFW identity.",
  });
}

export function inspectFlightCommanderInfo''',
    count=1,
    required=True,
)
replace_literal(
    identity_path,
    "Standard INAV remains supported, but this fork-only feature is disabled.",
    "Only Flight Commander Firmware is supported; this feature is disabled.",
)
replace_literal(
    identity_path,
    "Fork-only features are disabled.",
    "This firmware identity schema is unsupported.",
)

# The default disconnected state must not claim that stock INAV is active.
replace_literal("js/fc.js", "firmwareFamily: 'inav',", "firmwareFamily: 'unknown',", required=True)

# Generic MAVLink heartbeats are no longer promoted to INAV before the FCFW
# signature arrives. ArduPilot-compatible parameter probing remains only as an
# internal discriminator and is rejected by all product surfaces.
replace_regex(
    "js/mavlink/mavlinkSession.js",
    r"  startFirmwareDetection\(\) \{.*?\n  \}\n\n  handleFirmwareFingerprint",
    '''  startFirmwareDetection() {
    this.stopFirmwareDetection();
    if (this.applyFirmwareFamilyOverride()) return;

    if (
      this.state.autopilot !== MAV_AUTOPILOT_GENERIC &&
      this.state.autopilot !== MAV_AUTOPILOT_ARDUPILOTMEGA
    ) {
      this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "autopilot-family");
      return;
    }

    this.setFirmwareFamily(FIRMWARE_FAMILY_UNKNOWN, "probing");
    this.requestAutopilotVersion().catch(() => {});
    if (this.state.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
      this.send("ParamRequestList", this.target()).catch(() => {});
    }
    const attachment = this.activeAttachment("firmware detection");
    this.firmwareDetectionTimer = timerUnref(
      this.setTimeoutFn(() => {
        this.firmwareDetectionTimer = null;
        if (!this.attachmentIsCurrent(attachment)) return;
        this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "probe-timeout");
      }, this.firmwareDetectionTimeoutMs),
    );
  }

  handleFirmwareFingerprint''',
    count=1,
    required=True,
)
replace_literal(
    "js/mavlink/mavlinkSession.js",
    "this.state.firmwareFamily === FIRMWARE_FAMILY_INAV ||\n          this.state.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER ||",
    "this.state.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER ||",
)

# ---------------------------------------------------------------------------
# Wired/MAVLink connection gating
# ---------------------------------------------------------------------------
serial_path = "js/serial_backend.js"
replace_literal(serial_path, "const allowInavProtocols = requestedProtocol !== 'mavlink';", "const allowMsp = requestedProtocol !== 'mavlink';", required=True)
replace_literal(serial_path, "allowInavProtocols", "allowMsp")
replace_literal(serial_path, "                CONFIGURATOR.connection.addOnReceiveListener(ltmDecoder.read);\n", "")
replace_regex(
    serial_path,
    r"\n            if \(allowMsp\) \{\n                interval\.add\('ltm-connection-check'.*?\n            \}\n",
    "\n",
    count=1,
)
replace_literal(serial_path, "fc-controller-inav-mavlink", "fc-controller-flight-commander-mavlink")
replace_literal(serial_path, "fc-firmware-inav", "fc-firmware-unsupported")
replace_literal(serial_path, "INAV is not responding after reboot", "Flight Commander Firmware is not responding after reboot")
replace_literal(serial_path, "INAV did not respond after three post-reboot", "Flight Commander Firmware did not respond after three post-reboot")
replace_literal(serial_path, "INAV MAVLink command profile", "Flight Commander MAVLink command profile")
replace_literal(serial_path, "This vehicle is not running INAV or Flight Commander Firmware. ", "This vehicle is not running supported Flight Commander Firmware. ")
replace_literal(serial_path, "INAV / LTM telemetry", "Unsupported LTM telemetry")
replace_literal(serial_path, "INAV LTM telemetry connected (read-only link).", "LTM telemetry is unsupported because it cannot verify the Flight Commander FCFW identity.")
replace_literal(
    serial_path,
    "reportedVariant === 'FCFW'\n                                    && (",
    "(",
    required=True,
)
replace_literal(
    serial_path,
    "Flight Commander Firmware did not provide a supported FCFW identity contract.",
    "The controller did not provide a supported Flight Commander FCFW identity. Only Flight Commander Firmware is supported.",
)
replace_regex(
    serial_path,
    r"\s+if \(identity\.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER\) \{\n\s+GUI\.log\(\n\s+`Flight Commander Firmware.*?\n\s+\}\n\s+mspHelper\.getCraftName",
    '''
                                GUI.log(
                                    `Flight Commander Firmware ${identity.firmwareVersion ?? 'unknown'} ` +
                                    `(protocol baseline ${identity.compatibleInavVersion}, ` +
                                    `capabilities 0x${identity.capabilities.toString(16).padStart(8, '0')}).`,
                                );
                                mspHelper.getCraftName''',
    count=1,
)
replace_regex(
    serial_path,
    r"\s+\.toggleClass\(\n\s+'fc-firmware-flight-commander',\n\s+FC\.CONFIG\.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER,\n\s+\)\n\s+\.toggleClass\(\n\s+'fc-firmware-unsupported',\n\s+FC\.CONFIG\.firmwareFamily !== FIRMWARE_FAMILY_FLIGHT_COMMANDER,\n\s+\);",
    "\n                    .addClass('fc-firmware-flight-commander')\n                    .removeClass('fc-firmware-unsupported fc-controller-unsupported');",
    count=1,
)
replace_regex(
    serial_path,
    r"    privateScope\.onInvalidFirmwareVariant = function \(\)\n    \{.*?\n    \}\n\n    privateScope\.onInvalidFirmwareVersion",
    '''    privateScope.onInvalidFirmwareVariant = function ()
    {
        if (!privateScope.selectProtocol('msp')) {
            return;
        }
        GUI.log(
            '<span style="color: red">Unsupported controller firmware detected. ' +
            'Only Flight Commander Firmware with a valid FCFW identity is supported. ' +
            'CLI recovery remains available so the controller can be reflashed.</span>',
        );
        CONFIGURATOR.connectionValid = true;
        GUI.allowedTabs = ['cli'];
        privateScope.onConnect();
        $('#tabs .tab_cli a').trigger('click');
    }

    privateScope.onInvalidFirmwareVersion''',
    count=1,
    required=True,
)
replace_regex(
    serial_path,
    r"            const firmwareName = nextState\.firmwareFamily === 'inav'.*?;\n",
    '''            const firmwareName = nextState.firmwareFamily === 'flight-commander'
                ? 'Flight Commander Firmware'
                : nextState.firmwareFamily === 'unsupported'
                    ? 'Unsupported firmware'
                    : 'Detecting Flight Commander Firmware';
''',
    count=1,
    required=True,
)
replace_literal(serial_path, "if (nextState.firmwareFamily === 'inav') {", "if (nextState.firmwareFamily === 'flight-commander') {", required=True)
replace_literal(
    serial_path,
    "This vehicle is not running supported Flight Commander Firmware. ArduPilot support has been removed; configuration, missions, and commands are disabled.",
    "This vehicle did not provide a supported Flight Commander FCFW identity; configuration, missions, and commands are disabled.",
)

# The top-bar firmware label never exposes a stock compatibility mode.
write(
    "js/globalUpdates.js",
    """'use strict'\n\nimport CONFIGURATOR from './data_storage';\nimport FC from './fc';\nimport { globalSettings } from './globalSettings';\nimport i18n from './localization';\nimport {\n    FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL,\n    FLIGHT_COMMANDER_REPOSITORY_URL,\n} from './flightCommander/documentation';\n\nvar update = {\n\n    activatedTab: function() {\n        var activeTab = $('#tabs > ul li.active');\n        activeTab.removeClass('active');\n        $('a', activeTab).trigger('click');\n    },\n\n    firmwareVersion: function() {\n        globalSettings.docsTreeLocation = FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL;\n        globalSettings.configuratorTreeLocation = `${FLIGHT_COMMANDER_REPOSITORY_URL}/blob/main/`;\n\n        if (CONFIGURATOR.connectionValid) {\n            const identity = FC.CONFIG.flightCommanderFirmware;\n            const label = identity\n                ? `Flight Commander Firmware ${identity.firmwareVersion ?? 'unknown'}`\n                : 'Unsupported firmware';\n            $('#logo .firmware_version').text(`${label} [${FC.CONFIG.target || 'unknown target'}]`);\n        } else {\n            $('#logo .firmware_version').text(i18n.getMessage('fcNotConnected'));\n        }\n    }\n};\n\nexport default update;\n""",
)

# Command routing has no stock-INAV reduced-functionality branch.
router_path = "js/gcs/mavlinkCommandRouter.js"
replace_literal(
    router_path,
    '"Stock INAV ignores target_system in MAVLink RC_CHANNELS_OVERRIDE. " +\n  "Connect exactly one INAV aircraft to this MAVLink transport, then confirm the single-aircraft link.";',
    '"Flight Commander commands require a validated, target-isolated FCFW vehicle link.";',
)
replace_regex(
    router_path,
    r"    return unavailable\(\n      family === \"inav\".*?\n    \);",
    '''    return unavailable(
      family === "unsupported" || family === "inav"
        ? "This MAVLink vehicle is not running supported Flight Commander Firmware."
        : "Command controls are disabled until Flight Commander Firmware is identified.",
    );''',
    count=1,
    required=True,
)
replace_regex(
    router_path,
    r"    throw new Error\(\n      family === \"inav\".*?\n    \);",
    '''    throw new Error(
      family === "unsupported" || family === "inav"
        ? "Commands require supported Flight Commander Firmware."
        : "Cannot send a command until Flight Commander Firmware is identified.",
    );''',
    count=1,
    required=True,
)

# ---------------------------------------------------------------------------
# Ground Control
# ---------------------------------------------------------------------------
ground_path = "tabs/flight_data.js"
replace_literal(
    ground_path,
    "return family === 'flight-commander' || family === 'inav';",
    "return family === 'flight-commander';",
    required=True,
)
replace_literal(
    ground_path,
    "LTM provides live telemetry only. Reconnect to Flight Commander Firmware through MAVLink to send commands.",
    "LTM is unsupported because it cannot verify the Flight Commander FCFW identity. Reconnect through MAVLink.",
)
replace_literal(ground_path, "LTM telemetry connected in read-only compatibility mode.", "Unsupported LTM telemetry detected.")
replace_regex(
    ground_path,
    r"  const protocolLabel = offline.*?  \$\('#flightDataProtocol'\)\.text\(protocolLabel\);",
    '''  const flightCommander = state.firmwareFamily === 'flight-commander';
  const protocolLabel = offline
    ? 'Offline RTK setup'
    : this.protocol === 'mavlink'
      ? flightCommander
        ? 'MAVLink · Flight Commander'
        : state.firmwareFamily === 'unsupported' || state.firmwareFamily === 'inav'
          ? 'MAVLink · unsupported firmware'
          : 'MAVLink · detecting Flight Commander Firmware'
      : this.protocol === 'ltm'
        ? 'Unsupported LTM telemetry'
        : 'Flight Commander MSP wired';
  $('#flightDataVehicle').text(
    offline
      ? 'Aircraft not connected · RTK setup available below'
      : state.connected
        ? `${flightCommander ? 'Flight Commander Firmware' : 'Unsupported firmware'} · ${state.vehicleTypeName}`
        : 'Waiting for vehicle',
  );
  $('#flightDataProtocol').text(protocolLabel);''',
    count=1,
    required=True,
)
replace_literal(
    ground_path,
    "ArduPilot mission download has been removed. Connect Flight Commander Firmware or official INAV.",
    "Mission download requires supported Flight Commander Firmware.",
)
replace_user_facing_inav_terms(ground_path)

# ---------------------------------------------------------------------------
# Flight Planner
# ---------------------------------------------------------------------------
planner_path = "tabs/flight_planner.js"
replace_regex(
    planner_path,
    r"function missionTargetForConnection\(protocol, firmwareFamily\) \{.*?\n\}",
    '''function missionTargetForConnection(protocol, firmwareFamily) {
  if (protocol === 'msp') {
    return FC.CONFIG?.firmwareIdentity?.family === 'flight-commander'
      ? 'flight-commander'
      : 'unknown';
  }
  if (protocol !== 'mavlink') return 'unknown';
  return String(firmwareFamily ?? '').toLowerCase() === 'flight-commander'
    ? 'flight-commander'
    : 'unknown';
}''',
    count=1,
    required=True,
)
replace_regex(
    planner_path,
    r"flightPlanner\.updateVehicleTransferState = function \(\) \{.*?\n\};\n\nflightPlanner\.updateSurveyCameraAvailability",
    '''flightPlanner.updateVehicleTransferState = function () {
  const protocol = CONFIGURATOR.connectionProtocol;
  const transportConnected = Boolean(
    CONFIGURATOR.connectionValid && ['msp', 'mavlink'].includes(protocol),
  );
  const isMavlink = protocol === 'mavlink';
  const firmwareFamily = isMavlink ? mavlinkSession.state.firmwareFamily : null;
  const mspSupported = protocol === 'msp'
    && FC.CONFIG?.firmwareIdentity?.family === 'flight-commander';
  const flightCommanderMavlink = isMavlink
    && firmwareFamily === 'flight-commander';
  const connected = transportConnected && (mspSupported || flightCommanderMavlink);
  const unsupportedConnected = transportConnected && !connected;
  const missionOperationBusy = missionOperationCoordinator.isBusy();
  const vehicleName = isMavlink
    ? `Flight Commander ${mavlinkSession.state.vehicleTypeName}`
    : 'Flight Commander Firmware';

  $('#plannerVehicleStatus').text(
    connected
      ? `Connected: ${vehicleName}`
      : unsupportedConnected
        ? 'Connected: unsupported firmware'
        : 'Offline planning',
  );
  $('#plannerVehicleStatusDetail').text(
    connected
      ? protocol === 'msp'
        ? `Flight Commander / MSP wired · persistent mission read/write · ${this.mission.length} planned mission items`
        : `MAVLink · Flight Commander active mission is retained only for this power cycle · ${this.mission.length} planned mission items`
      : unsupportedConnected
        ? 'Only Flight Commander Firmware is supported. Mission transfer is disabled.'
        : 'Connect Flight Commander Firmware to transfer this mission.',
  );

  $('#plannerUpload').text(flightCommanderMavlink
    ? 'Write active mission (current power cycle)'
    : 'Write & save mission to flight controller');
  $('#plannerClearVehicle').text(flightCommanderMavlink
    ? 'Clear active mission (current power cycle)'
    : protocol === 'msp'
      ? 'Stored-mission erase limitation'
      : 'Erase mission from flight controller');
  $('#plannerDownload').prop('disabled', !connected || missionOperationBusy);
  $('#plannerUpload').prop(
    'disabled',
    !connected || !this.mission.length || missionOperationBusy,
  );
  $('#plannerClearVehicle')
    .prop('disabled', !connected || missionOperationBusy)
    .attr(
      'title',
      flightCommanderMavlink
        ? 'Clear and verify the active RAM mission for this power cycle; persistent storage is unchanged'
        : protocol === 'msp'
          ? 'Flight Commander Firmware cannot save an empty persistent mission; select this for details'
          : 'Erase and verify the mission stored on the connected flight controller',
    );
  this.updateMissionBehaviorAvailability();
  this.updateSurveyCameraAvailability();
  this.updateInavPlanningAvailability();
};

flightPlanner.updateSurveyCameraAvailability''',
    count=1,
    required=True,
)
replace_literal(planner_path, "['flight-commander', 'inav'].includes(family) ? family : 'unknown'", "family === 'flight-commander' ? family : 'unknown'")
replace_literal(planner_path, "['inav', 'flight-commander'].includes(firmwareFamily)", "firmwareFamily === 'flight-commander'")
replace_literal(planner_path, "connectedTarget === 'inav'\n    || (\n      connectedTarget === 'flight-commander'", "connectedTarget === 'flight-commander'")
replace_literal(planner_path, "    )\n  )\n    ? this.mission", "  )\n    ? this.mission")
replace_literal(
    planner_path,
    "CONFIGURATOR.connectionValid\n    && CONFIGURATOR.connectionProtocol === 'msp',",
    "CONFIGURATOR.connectionValid\n    && CONFIGURATOR.connectionProtocol === 'msp'\n    && FC.CONFIG?.firmwareIdentity?.family === 'flight-commander',",
)
replace_user_facing_inav_terms(planner_path)
replace_user_facing_inav_terms("tabs/flight_planner.html")
replace_literal(
    "tabs/flight_planner.html",
    "Flight Commander Firmware can execute distance-camera command 206 through a\n                        MAVLink camera or companion. unsupported firmware missions remain navigation only.",
    "Flight Commander Firmware can execute distance-camera command 206 through a\n                        MAVLink camera or companion when the capability is advertised.",
)

# ---------------------------------------------------------------------------
# Firmware capability tab and RTK routing
# ---------------------------------------------------------------------------
write(
    "tabs/firmware_info.js",
    """\"use strict\";\n\nimport GUI from \"./../js/gui\";\nimport FC from \"./../js/fc\";\nimport {\n  FLIGHT_COMMANDER_FEATURES,\n  firmwareFeatureSupport,\n} from \"./../js/flightCommander/firmwareIdentity\";\n\nconst firmwareInfo = {};\n\nfirmwareInfo.initialize = function (callback) {\n  if (GUI.active_tab !== this) GUI.active_tab = this;\n  import(\"./firmware_info.html?raw\").then(({ default: html }) => {\n    GUI.load(html, () => {\n      this.render();\n      GUI.content_ready(callback);\n    });\n  });\n};\n\nfirmwareInfo.render = function () {\n  const identity = FC.CONFIG.firmwareIdentity;\n  const supported = identity?.family === \"flight-commander\"\n    && identity.protocolSupported === true;\n  const displayedVersion = supported\n    ? identity.firmwareVersion ?? \"unknown\"\n    : FC.CONFIG.reportedFirmwareVersion || FC.CONFIG.flightControllerVersion || \"--\";\n\n  $(\"#firmwareInfoFamily\").text(\n    supported ? \"Flight Commander Firmware\" : \"Unsupported firmware\",\n  );\n  $(\"#firmwareInfoVersion\").text(displayedVersion);\n  $(\"#firmwareInfoCompatibility\").text(\n    supported ? `Protocol baseline ${identity.compatibleInavVersion}` : \"Not available\",\n  );\n  $(\"#firmwareInfoTarget\").text(FC.CONFIG.target || FC.CONFIG.boardIdentifier || \"Unknown\");\n  $(\"#firmwareInfoSchema\").text(\n    identity?.schemaVersion == null ? \"Not advertised\" : String(identity.schemaVersion),\n  );\n  $(\"#firmwareInfoCapabilities\").text(\n    `0x${Number(identity?.capabilities ?? 0).toString(16).padStart(8, \"0\")}`,\n  );\n\n  $(\"#firmwareInfoSummary\")\n    .text(\n      supported\n        ? `Flight Commander Firmware ${displayedVersion} is verified through the versioned FCFW identity. Only explicitly advertised capabilities are enabled.`\n        : \"Only Flight Commander Firmware is supported. Reflash this controller with a valid Flight Commander image before using configuration, planning, or Ground Control.\",\n    )\n    .toggleClass(\"fc-action-status--error\", !supported);\n\n  for (const featureKey of Object.keys(FLIGHT_COMMANDER_FEATURES)) {\n    const support = firmwareFeatureSupport(identity, featureKey);\n    const card = $(`[data-fc-feature=\"${featureKey}\"]`);\n    card\n      .toggleClass(\"fc-firmware-feature--enabled\", support.enabled)\n      .toggleClass(\"fc-firmware-feature--locked\", !support.enabled);\n    card.find(\".fc-firmware-feature__state\")\n      .text(support.enabled ? \"Advertised\" : \"Disabled\")\n      .toggleClass(\"fc-pill--ready\", support.enabled)\n      .toggleClass(\"fc-pill--locked\", !support.enabled);\n    card.find(\".fc-firmware-feature__reason\").text(support.reason);\n  }\n};\n\nfirmwareInfo.cleanup = function (callback) {\n  if (callback) callback();\n};\n\nexport default firmwareInfo;\n""",
)
replace_literal("tabs/firmware_info.html", "<dt>Compatibility</dt>", "<dt>Protocol baseline</dt>")
write(
    "js/rtk/rtkCorrectionRoute.js",
    """\"use strict\";\n\nimport {\n  FLIGHT_COMMANDER_CAPABILITIES,\n  FIRMWARE_FAMILY_FLIGHT_COMMANDER,\n} from \"../flightCommander/firmwareIdentity.js\";\n\nconst CAPABILITY = FLIGHT_COMMANDER_CAPABILITIES.GCS_RTK_BASE;\n\nfunction capabilityEnabled(mask) {\n  return (Number(mask) & CAPABILITY) === CAPABILITY;\n}\n\nexport function resolveRtkCorrectionRoute(context = {}) {\n  const mavlinkState = context.mavlinkState ?? {};\n  if (\n    mavlinkState.connected === true &&\n    mavlinkState.firmwareFamily === FIRMWARE_FAMILY_FLIGHT_COMMANDER &&\n    capabilityEnabled(mavlinkState.flightCommanderCapabilities)\n  ) {\n    return { available: true, transport: \"MAVLink\" };\n  }\n\n  const identity = context.firmwareIdentity;\n  if (\n    context.connectionValid === true &&\n    context.connectionProtocol === \"msp\" &&\n    identity?.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER &&\n    identity?.protocolSupported === true &&\n    capabilityEnabled(identity.capabilities)\n  ) {\n    return { available: true, transport: \"MSP\" };\n  }\n\n  const unsupportedConnection =\n    mavlinkState.connected === true || context.connectionValid === true;\n  return {\n    available: false,\n    transport: null,\n    reason: unsupportedConnection\n      ? \"USB RTK base corrections require supported Flight Commander Firmware with the advertised GCS_RTK_BASE capability.\"\n      : \"Connect Flight Commander Firmware over MSP or MAVLink to forward corrections.\",\n  };\n}\n\nexport default resolveRtkCorrectionRoute;\n""",
)

# ---------------------------------------------------------------------------
# Firmware Flasher: one family, one catalog, mandatory FCFW identity.
# ---------------------------------------------------------------------------
flasher_html = "tabs/firmware_flasher.html"
replace_regex(
    flasher_html,
    r"                    <tr>\n                        <td>\n                            <label for=\"firmware_backend\">.*?                    </tr>",
    '''                    <tr>
                        <td>
                            <input id="firmware_backend" type="hidden" value="flight-commander">
                            <strong>Flight Commander Firmware only</strong>
                        </td>
                        <td>
                            <span id="firmware_backend_description" class="description">
                                Automatic target discovery and guarded STM32/DFU flashing for Flight Commander Firmware.
                            </span>
                        </td>
                    </tr>''',
    count=1,
    required=True,
)
flasher_js = "tabs/firmware_flasher.js"
replace_literal(flasher_js, 'fileName = "inav.hex";', 'fileName = "flight-commander.hex";', required=True)
replace_literal(flasher_js, "var firmwareBackend = 'inav';", "var firmwareBackend = 'flight-commander';", required=True)
replace_literal(
    flasher_js,
    "firmwareBackend = backend === 'flight-commander' ? 'flight-commander' : 'inav';",
    "firmwareBackend = 'flight-commander';",
    required=True,
)
replace_literal(flasher_js, "setFirmwareBackend(store.get('firmware_backend', 'inav'));", "setFirmwareBackend('flight-commander');", required=True)
replace_literal(
    flasher_js,
    "'Official INAV target discovery and STM32/DFU flashing.'",
    "'Only Flight Commander Firmware is supported. Load a published or local FCFW HEX, then flash it.'",
)
replace_regex(
    flasher_js,
    r"\n        \$\.get\('https://api\.github\.com/repos/iNavFlight/inav-nightly/releases\?per_page=50'.*?\n        \$\.get\(FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL",
    "\n        firmwareFlasherTab.inavDevReleasesData = [];\n        firmwareFlasherTab.inavReleasesData = [];\n\n        $.get(FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL",
    count=1,
    required=True,
)
replace_literal(
    flasher_js,
    "`Local ${firmwareBackend === 'flight-commander' ? 'Flight Commander Firmware' : 'INAV'} file selected (${data.bytes_total} bytes). Click ${flashAction}.`,",
    "`Local Flight Commander Firmware file selected (${data.bytes_total} bytes). Click ${flashAction}.`,",
)
replace_literal(
    flasher_js,
    "reportedVariant === 'FCFW'\n                                && (",
    "(",
    required=True,
)
replace_literal(
    flasher_js,
    "Cannot prefetch target: Flight Commander Firmware did not provide a supported FCFW identity contract.",
    "Cannot prefetch target: the controller did not provide a supported Flight Commander FCFW identity.",
)
replace_regex(
    flasher_js,
    r"\s+if \(identity\.family === FIRMWARE_FAMILY_FLIGHT_COMMANDER\) \{\n\s+GUI\.log\(.*?\n\s+\}\n\s+mspHelper\.getCraftName",
    '''
                            GUI.log(
                                `Detected Flight Commander Firmware ${identity.firmwareVersion || 'unknown'} ` +
                                `(protocol baseline ${identity.compatibleInavVersion}).`,
                            );
                            mspHelper.getCraftName''',
    count=1,
)
replace_user_facing_inav_terms(flasher_js)

# English and translated flasher/unsupported-firmware messages are normalized
# so no active locale directs an operator to stock INAV.
for locale_file in sorted((ROOT / "locale").glob("*/messages.json")):
    try:
        messages = json.loads(locale_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        continue
    updates = {
        "firmwareVariantNotSupported": "This controller firmware is not supported. Flash Flight Commander Firmware before using this application.",
        "firmwareFlasherWarningText": "Flash only Flight Commander Firmware built for the detected controller target. The selected HEX must contain the FCFW identity and match this exact board. Do not disconnect the controller or turn off the computer while flashing. Make a configuration backup before upgrades or downgrades.",
        "firmwareFlasherOnlineSelectBoardDescription": "Select the exact Flight Commander hardware target or use automatic target discovery from a supported controller.",
        "targetPrefetchFailOld": "Cannot prefetch target: the Flight Commander identity is unsupported",
        "targetPrefetchFailNonINAV": "Cannot prefetch target: Flight Commander Firmware identity was not verified",
        "firmwareFlasherRecoveryText": "Use the Flight Commander USB flashing guide for BOOT/DFU recovery. Select the exact controller target, enable full-chip erase when required, and flash a valid Flight Commander FCFW image.",
    }
    changed = False
    for key, message in updates.items():
        if key in messages and isinstance(messages[key], dict):
            if messages[key].get("message") != message:
                messages[key]["message"] = message
                changed = True
    if changed:
        write(str(locale_file.relative_to(ROOT)), json.dumps(messages, indent=2, ensure_ascii=False) + "\n")

# ---------------------------------------------------------------------------
# Landing page, navigation, documentation and support boundary
# ---------------------------------------------------------------------------
replace_literal(
    "index.html",
    "Ground Control — live INAV-compatible telemetry and vehicle commands",
    "Ground Control — live Flight Commander telemetry and vehicle commands",
)
replace_regex(
    "index.html",
    r"\n                <ul class=\"mode-telemetry\".*?</ul>",
    "",
    count=1,
)
replace_regex(
    "tabs/landing.html",
    r"          <h2>Flight Commander 4\.1\.1</h2>.*?          <h2 style=\"margin-top: 1em\">Open-source foundations</h2>",
    '''          <h2>Flight Commander 4.1.2</h2>
          <p>
            Flight Commander 4.1.2 makes Flight Commander Firmware the only
            supported controller firmware. The retired stock-firmware
            compatibility path and every reduced-functionality product mode
            have been removed.
          </p>
          <p>
            Wired setup now requires the versioned FCFW identity before
            configuration tabs unlock. MAVLink remains in a detecting state
            until the Flight Commander signature and capability bitmap arrive,
            so a generic heartbeat can no longer be misidentified.
          </p>
          <p>
            The Firmware Flasher now offers Flight Commander Firmware only and
            rejects any local or online HEX without the required FCFW identity
            or exact target match.
          </p>
          <p>
            This Configurator-only release reuses verified Flight Commander
            Firmware 4.0.8 and its exact firmware source archive.
          </p>
          <h2 style="margin-top: 1em">Open-source foundations</h2>''',
    count=1,
    required=True,
)
replace_literal(
    "tabs/landing.html",
    "without changing applications. Official INAV remains available as\n            an explicitly identified compatibility mode.",
    "through one Flight Commander Firmware-only application and release contract.",
)

# README: remove the advertised dual-firmware product contract while retaining
# source provenance and inherited protocol terminology where technically useful.
replace_literal(
    "README.md",
    "It retains an explicit official-INAV compatibility mode while Flight Commander\nown the product identity, release contract, capability protocol, and new\nfeature development.",
    "Flight Commander Firmware is the only supported controller firmware; inherited\nprotocol names remain solely where the firmware still uses those wire formats.",
)
replace_literal("README.md", "Full inherited INAV configuration over the wired MSP setup link.", "Full Flight Commander configuration over the wired MSP setup link.")
replace_literal("README.md", "One Flight Planner for INAV-compatible firmware", "One Flight Planner for Flight Commander Firmware")
replace_literal(
    "README.md",
    "- Capability-gated terrain-following mission upload and distance-based MAVLink\n  camera triggering for Flight Commander Firmware. Official INAV remains\n  navigation-only for those fork extensions.",
    "- Capability-gated terrain-following mission upload and distance-based MAVLink\n  camera triggering for Flight Commander Firmware.",
)
replace_literal(
    "README.md",
    "- INAV and Flight Commander Firmware flashing through the same proven\n  STM32/DFU path. The app automatically detects the target, validates the\n  selected firmware family, and prevents cross-family or target-mismatched HEX\n  images from being written.",
    "- Flight Commander Firmware-only flashing through the proven STM32/DFU path.\n  The app detects the target, requires the FCFW identity, and prevents\n  target-mismatched or foreign firmware images from being written.",
)
replace_regex(
    "README.md",
    r"ArduPilot firmware is unsupported\..*?fails closed whenever an INAV\nmission or command cannot be represented losslessly\.",
    "Every controller firmware other than Flight Commander Firmware is unsupported. A vehicle without the versioned FCFW identity is blocked from configuration, mission transfer, Ground Control commands, and RTK correction routing.",
    count=1,
)
replace_regex(
    "README.md",
    r"\| Controller and link \| Configuration \| Missions and planning \| Live Ground Control \|.*?\n\nINAV-compatible interruption checkpoints",
    '''| Controller and link | Configuration | Missions and planning | Live Ground Control |
| --- | --- | --- | --- |
| **Flight Commander Firmware over MSP** | Full persistent configuration, including UART GPS, DroneCAN nodes, primary-GPS selection, and advertised capability status | Native mission and planning-data read/write, including safe homes, approaches, geozones, terrain profiles, and supported photo actions | Wired telemetry is available; airborne commands require a MAVLink link |
| **Flight Commander Firmware over MAVLink** | Not a replacement for the wired MSP setup link | Active mission transfer plus advertised terrain and photo extensions | Telemetry and native Ground Control commands after FCFW identity and capability verification |
| **Other firmware or unidentified MAVLink vehicles** | Unsupported | Disabled | Connection remains locked or is shown as unsupported |

Flight Commander interruption checkpoints''',
    count=1,
    required=True,
)
replace_regex(
    "README.md",
    r"Firmware flashing is a separate bootloader operation.*?Always verify\nthe detected identity, selected family, target, and firmware before writing\.",
    "Firmware flashing is a separate bootloader operation, not an airborne MAVLink command. Flight Commander Firmware HEX files must contain the compiled `FCFW` identity marker and match the selected target. Raw STM32 DFU cannot report a board model and still requires manual target confirmation. Always verify the detected identity, target, and firmware before writing.",
    count=1,
)
replace_literal(
    "README.md",
    "INAV references are retained only where an inherited compatibility\nfeature specifically requires upstream INAV behavior.",
    "INAV references are retained only for source provenance or inherited protocol and setting names used by Flight Commander Firmware.",
)

for doc in [
    "docs/README.md",
    "docs/CONNECTIONS.md",
    "docs/FIRMWARE_FLASHING.md",
    "docs/FLIGHT_PLANNER.md",
    "docs/GROUND_CONTROL.md",
    "docs/RTK_BASE_NTRIP.md",
    "docs/TROUBLESHOOTING.md",
    "docs/CONFIGURATION_REFERENCE.md",
    "docs/RECONSTRUCTION.md",
    "CLAUDE.md",
]:
    if path_for(doc).exists():
        replace_user_facing_inav_terms(doc)

# ---------------------------------------------------------------------------
# Tests and packaged-app policy verification
# ---------------------------------------------------------------------------
identity_test = "tests/flight-commander/firmware/flight-commander-identity.test.mjs"
replace_literal(identity_test, 'test("accepts both official INAV and the Flight Commander FCFW variant"', 'test("recognizes inherited transport variants but authorizes only the FCFW identity"')
replace_literal(identity_test, 'test("treats an unsupported empty response as normal stock INAV"', 'test("treats a missing FCFW response as unsupported firmware"')
replace_literal(identity_test, 'assert.equal(identity.capabilities, 0);', 'assert.equal(identity.capabilities, 0);\n    assert.equal(identity.displayName, "Unsupported firmware");', required=True)
replace_literal(identity_test, 'test("applies identity without replacing the inherited INAV version"', 'test("applies Flight Commander identity without replacing the inherited protocol version"')

session_test = "tests/flight-commander/mavlink/session.test.mjs"
replace_regex(
    session_test,
    r"  test\(\"identifies generic-autopilot heartbeat as INAV\", \(\) => \{.*?\n  \}\);",
    '''  test("keeps a generic-autopilot heartbeat locked while FCFW identity is pending", () => {
    const { session } = createAttachedSession();
    session.handleMessage(heartbeat({ autopilot: 0 }));
    assert.equal(session.state.firmwareFamily, "unknown");
    assert.equal(session.state.firmwareFamilySource, "probing");
  });''',
    count=1,
    required=True,
)
replace_literal(
    session_test,
    "assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_INAV);\n\n    const capabilities =",
    "assert.equal(session.state.firmwareFamily, \"unknown\");\n    assert.equal(session.state.firmwareFamilySource, \"probing\");\n\n    const capabilities =",
    required=True,
)

router_test = "tests/flight-commander/mavlink/command-router.test.mjs"
replace_literal(router_test, 'test("keeps all command controls disabled for official INAV"', 'test("rejects an inherited stock-firmware family as unsupported"')
replace_literal(router_test, "/disabled for official INAV/", "/not running supported Flight Commander Firmware/")
replace_literal(router_test, "/support has been removed/", "/supported Flight Commander Firmware/")

rtk_test = "tests/flight-commander/rtk/correction-route.test.mjs"
replace_literal(rtk_test, 'test("Official INAV cannot receive Flight Commander GCS base corrections"', 'test("unidentified firmware cannot receive Flight Commander GCS base corrections"')
replace_literal(rtk_test, "/disabled for Official INAV/", "/require supported Flight Commander Firmware/")

release_test = "tests/flight-commander/release/software-only-beta-publisher.test.mjs"
replace_literal(release_test, "4.1.1", "4.1.2")

package_test = "tests/flight-commander/packaging/package-contract.test.mjs"
replace_literal(package_test, 'assert.equal(packageManifest.version, "4.1.1");', 'assert.equal(packageManifest.version, "4.1.2");')
replace_literal(package_test, "assert.match(packageVerifier, /Official INAV Firmware/);", "assert.doesNotMatch(packageVerifier, /Official INAV Firmware/);")
replace_literal(package_test, "assert.match(packageVerifier, /Official INAV is connected in compatibility mode/);", "assert.doesNotMatch(packageVerifier, /Official INAV is connected in compatibility mode/);")
replace_regex(
    package_test,
    r"  assert\.deepEqual\(\n    \[\.\.\.firmwareFlasherHtml\.matchAll\(.*?\n  assert\.match\(firmwareFlasherHtml, /value=\\\"inav\\\">Official INAV Firmware/\);",
    '''  assert.deepEqual(
    [...firmwareFlasherHtml.matchAll(/value="([^"]+)">Flight Commander Firmware<\\/option>/g)]
      .map((match) => match[1]),
    [],
  );
  assert.match(firmwareFlasherHtml, /Flight Commander Firmware only/);
  assert.doesNotMatch(firmwareFlasherHtml, /value="inav"|Official INAV Firmware/);''',
    count=1,
)
replace_literal(
    package_test,
    "assert.match(flasherWarning, /Flight Commander Firmware and official INAV Firmware/);",
    "assert.doesNotMatch(flasherWarning, /official INAV|Official INAV/);",
)
replace_literal(package_test, "assert.match(packageVerifier, /Official INAV Firmware/);", "assert.doesNotMatch(packageVerifier, /Official INAV Firmware/);")
replace_literal(package_test, "assert.match(packageVerifier, /Official INAV is connected in compatibility mode/);", "assert.doesNotMatch(packageVerifier, /Official INAV is connected in compatibility mode/);")

verifier = "scripts/verify-windows-package.mjs"
replace_literal(verifier, '  "Official INAV Firmware",\n', '')
replace_literal(verifier, '  "Official INAV is connected in compatibility mode",\n', '')
replace_literal(
    verifier,
    '  "Flight Commander Firmware",\n',
    '  "Flight Commander Firmware",\n  "Flight Commander Firmware only",\n  "Only Flight Commander Firmware is supported",\n',
)
replace_literal(verifier, '  "INAV is not responding after reboot",\n', '  "Flight Commander Firmware is not responding after reboot",\n')
replace_literal(verifier, '  "INAV did not respond after three post-reboot",\n', '  "Flight Commander Firmware did not respond after three post-reboot",\n')
replace_literal(verifier, '  "Select Flight Commander Firmware before flashing it",\n', '  "The HEX does not contain the required FCFW firmware identity",\n')
replace_literal(verifier, '  "Active INAV target magnetometer alignment and diagnostics",\n', '  "Active Flight Commander target magnetometer alignment and diagnostics",\n')

write(
    "tests/flight-commander/firmware/flight-commander-only-policy.test.mjs",
    """import assert from \"node:assert/strict\";\nimport { readFileSync } from \"node:fs\";\nimport { resolve } from \"node:path\";\nimport test from \"node:test\";\n\nconst root = resolve(import.meta.dirname, \"../../..\");\nconst text = (path) => readFileSync(resolve(root, path), \"utf8\");\n\ntest(\"Flight Commander 4.1.2 exposes no stock-INAV product mode\", () => {\n  const packageJson = JSON.parse(text(\"package.json\"));\n  const flasherHtml = text(\"tabs/firmware_flasher.html\");\n  const flasherSource = text(\"tabs/firmware_flasher.js\");\n  const serial = text(\"js/serial_backend.js\");\n  const session = text(\"js/mavlink/mavlinkSession.js\");\n  const ground = text(\"tabs/flight_data.js\");\n  const planner = text(\"tabs/flight_planner.js\");\n  const landing = text(\"tabs/landing.html\");\n\n  assert.equal(packageJson.version, \"4.1.2\");\n  assert.match(flasherHtml, /Flight Commander Firmware only/);\n  assert.doesNotMatch(flasherHtml, /value=\"inav\"|Official INAV/);\n  assert.doesNotMatch(flasherSource, /repos\\/iNavFlight\\/inav(?:-nightly)?\\/releases/);\n  assert.match(flasherSource, /parsedHexContainsFlightCommanderIdentity/);\n  assert.match(serial, /identity\\.family !== FIRMWARE_FAMILY_FLIGHT_COMMANDER/);\n  assert.doesNotMatch(serial, /Official INAV|compatibility mode/);\n  assert.doesNotMatch(session, /setFirmwareFamily\\(FIRMWARE_FAMILY_INAV, \"heartbeat\"\\)/);\n  assert.match(session, /FIRMWARE_FAMILY_UNKNOWN, \"probing\"/);\n  assert.match(ground, /return family === 'flight-commander'/);\n  assert.doesNotMatch(ground, /MAVLink · Official INAV|commands disabled for official INAV/i);\n  assert.doesNotMatch(planner, /Official INAV|Flight Commander\\/INAV-compatible/);\n  assert.match(landing, /Flight Commander Firmware the only/);\n});\n""",
)

# Any remaining exact stock-support phrases in active product files are errors.
active_files = [
    "index.html",
    "tabs/landing.html",
    "tabs/firmware_flasher.html",
    "tabs/firmware_flasher.js",
    "tabs/firmware_info.js",
    "tabs/flight_data.js",
    "tabs/flight_planner.html",
    "tabs/flight_planner.js",
    "js/globalUpdates.js",
    "js/serial_backend.js",
    "js/gcs/mavlinkCommandRouter.js",
    "js/rtk/rtkCorrectionRoute.js",
]
for relative in active_files:
    content = read(relative)
    banned = [
        "Official INAV",
        "official INAV",
        "INAV compatibility mode",
        "commands disabled for official INAV",
    ]
    found = [phrase for phrase in banned if phrase in content]
    if found:
        raise RuntimeError(f"{relative}: retired product wording remains: {found}")

# Delete the one-time transformer and workflow from the release branch. They
# remain available in the triggering main commit until this result is merged.
for relative in [
    ".github/workflows/one-time-prepare-flight-commander-4.1.2.yml",
    "scripts/prepare-flight-commander-4.1.2.py",
]:
    path = path_for(relative)
    if path.exists():
        path.unlink()
        CHANGED.append(relative)

print(f"Prepared Flight Commander 4.1.2; changed {len(CHANGED)} files.")
for relative in CHANGED:
    print(relative)
