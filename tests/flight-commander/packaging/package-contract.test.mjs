import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const forgeConfig = readFileSync(
  resolve(projectRoot, "forge.config.js"),
  "utf8",
);
const cleanViteOutput = readFileSync(
  resolve(projectRoot, "scripts/clean-vite-output.mjs"),
  "utf8",
);
const rendererConfigs = [
  "vite.main-renderer.config.js",
  "vite.bt-dc-renderer.config.js",
].map((path) => readFileSync(resolve(projectRoot, path), "utf8"));
const packageVerifier = readFileSync(
  resolve(projectRoot, "scripts/verify-windows-package.mjs"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  resolve(projectRoot, ".github/workflows/release.yml"),
  "utf8",
);
const firmwareRebuildScript = readFileSync(
  resolve(projectRoot, "scripts/rebuild-firmware-source-archive.sh"),
  "utf8",
);
const landingHtml = readFileSync(
  resolve(projectRoot, "tabs/landing.html"),
  "utf8",
);
const mainProcess = readFileSync(
  resolve(projectRoot, "js/main/main.js"),
  "utf8",
);
const preloadProcess = readFileSync(
  resolve(projectRoot, "js/main/preload.js"),
  "utf8",
);
const ntripClientSource = readFileSync(
  resolve(projectRoot, "js/main/ntripClient.js"),
  "utf8",
);
const rtkBaseHtml = readFileSync(
  resolve(projectRoot, "tabs/rtk_base.html"),
  "utf8",
);
const rtkBaseSource = readFileSync(
  resolve(projectRoot, "tabs/rtk_base.js"),
  "utf8",
);
const gpsHtml = readFileSync(
  resolve(projectRoot, "tabs/gps.html"),
  "utf8",
);
const gpsSource = readFileSync(
  resolve(projectRoot, "tabs/gps.js"),
  "utf8",
);
const magnetometerHtml = readFileSync(
  resolve(projectRoot, "tabs/magnetometer.html"),
  "utf8",
);
const magnetometerSource = readFileSync(
  resolve(projectRoot, "tabs/magnetometer.js"),
  "utf8",
);
const alignmentTargetsSource = readFileSync(
  resolve(projectRoot, "js/flightCommander/alignmentTargets.js"),
  "utf8",
);
const calibrationHtml = readFileSync(
  resolve(projectRoot, "tabs/calibration.html"),
  "utf8",
);
const calibrationSource = readFileSync(
  resolve(projectRoot, "tabs/calibration.js"),
  "utf8",
);
const compassCalibrationSource = readFileSync(
  resolve(projectRoot, "js/flightCommander/compassCalibration.js"),
  "utf8",
);
const groundControlHtml = readFileSync(
  resolve(projectRoot, "tabs/flight_data.html"),
  "utf8",
);
const groundControlSource = readFileSync(
  resolve(projectRoot, "tabs/flight_data.js"),
  "utf8",
);
const headingFusionSource = readFileSync(
  resolve(projectRoot, "js/flightCommander/headingFusion.js"),
  "utf8",
);
const portsHtml = readFileSync(
  resolve(projectRoot, "tabs/ports.html"),
  "utf8",
);
const portsSource = readFileSync(
  resolve(projectRoot, "tabs/ports.js"),
  "utf8",
);
const mainCss = readFileSync(
  resolve(projectRoot, "src/css/main.css"),
  "utf8",
);
const landingCss = readFileSync(
  resolve(projectRoot, "src/css/tabs/landing.css"),
  "utf8",
);
const themeCss = readFileSync(
  resolve(projectRoot, "src/css/theme.css"),
  "utf8",
);
const rendererEntry = readFileSync(
  resolve(projectRoot, "index.html"),
  "utf8",
);
const guiSource = readFileSync(
  resolve(projectRoot, "js/gui.js"),
  "utf8",
);
const documentationHub = readFileSync(
  resolve(projectRoot, "docs/README.md"),
  "utf8",
);
const documentationRouter = readFileSync(
  resolve(projectRoot, "js/flightCommander/documentation.js"),
  "utf8",
);
const settingsReference = readFileSync(
  resolve(projectRoot, "docs/SETTINGS_REFERENCE.md"),
  "utf8",
);
const sitlHtml = readFileSync(
  resolve(projectRoot, "tabs/sitl.html"),
  "utf8",
);
const sitlSource = readFileSync(
  resolve(projectRoot, "js/sitl.js"),
  "utf8",
);
const firmwareFlasherHtml = readFileSync(
  resolve(projectRoot, "tabs/firmware_flasher.html"),
  "utf8",
);
const firmwareFlasherSource = readFileSync(
  resolve(projectRoot, "tabs/firmware_flasher.js"),
  "utf8",
);
const firmwareInfoHtml = readFileSync(
  resolve(projectRoot, "tabs/firmware_info.html"),
  "utf8",
);
const firmwareIdentitySource = readFileSync(
  resolve(projectRoot, "js/flightCommander/firmwareIdentity.js"),
  "utf8",
);
const firmwareCatalogSource = readFileSync(
  resolve(projectRoot, "js/flightCommander/firmwareCatalog.js"),
  "utf8",
);
const presetSource = readFileSync(
  resolve(projectRoot, "js/presets/inavMultirotorPresets.js"),
  "utf8",
);
const welcomeWordmark = readFileSync(
  resolve(projectRoot, "images/flight-commander-wordmark-on-light.svg"),
  "utf8",
);
const cliCss = readFileSync(
  resolve(projectRoot, "src/css/tabs/cli.css"),
  "utf8",
);
const pidTuningCss = readFileSync(
  resolve(projectRoot, "src/css/tabs/pid_tuning.css"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(resolve(projectRoot, "manifest.json"), "utf8"),
);
const packageManifest = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);
const linuxDesktop = readFileSync(
  resolve(projectRoot, "assets/linux/flight-commander.desktop"),
  "utf8",
);
const bundledFirmwarePath = resolve(
  projectRoot,
  `resources/firmware/Flight-Commander-Firmware-${packageManifest.flightCommander.bundledFirmwareVersion}-MICOAIR743.hex`,
);
const bundledFirmwareSourcePath = resolve(
  projectRoot,
  packageManifest.flightCommander.bundledFirmwareSourceArchive,
);

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFiles(directory, extensions) {
  return readdirSync(resolve(projectRoot, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(relativePath, extensions);
      return extensions.some((extension) => entry.name.endsWith(extension))
        ? [relativePath]
        : [];
    });
}

function relativeLuminance(hexColor) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hexColor.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastAgainstWhite(hexColor) {
  return 1.05 / (relativeLuminance(hexColor) + 0.05);
}

test("packaging starts from clean Vite output roots", () => {
  assert.match(forgeConfig, /prePackage:\s*async\s*\(\)\s*=>/);
  assert.match(forgeConfig, /cleanViteOutput\(__dirname\)/);
  assert.match(forgeConfig, /overwrite:\s*true/);
  assert.match(cleanViteOutput, /["']\.vite\/build["']/);
  assert.match(cleanViteOutput, /["']\.vite\/renderer["']/);
  assert.match(
    packageManifest.scripts["package:windows"],
    /^node scripts\/clean-vite-output\.mjs && electron-forge package/,
  );
  for (const rendererConfig of rendererConfigs) {
    assert.match(rendererConfig, /emptyOutDir:\s*true/);
  }
});

test("Windows verification follows the active renderer graph and rejects leftovers", () => {
  assert.match(packageVerifier, /function activeRendererFiles\(/);
  assert.match(packageVerifier, /renderer output contains.*unreferenced/s);
  assert.match(packageVerifier, /Flight-Commander\//);
  assert.match(packageVerifier, /INAV-Configurator\//);
  assert.match(packageVerifier, /function peIconImages\(/);
  assert.match(packageVerifier, /function activeRendererStylesheets\(/);
  assert.match(packageVerifier, /Flight Commander wordmark/);
  assert.match(packageVerifier, /embedded executable icon/);
  assert.match(packageVerifier, /exactly one group-icon resource/);
  assert.match(packageVerifier, /Windows MAVLink DTR\/RTS-low open setup/);
  assert.match(packageVerifier, /connectionBaudPreferencesByProtocol/);
  assert.match(packageVerifier, /Waiting for vehicle heartbeat/);
  assert.match(packageVerifier, /discovery-heartbeat-write-accepted/);
  assert.match(packageVerifier, /serial-bytes-received/);
  assert.match(packageVerifier, /valid-frame-decoded/);
  assert.match(packageVerifier, /MAVLink transport startup failed/);
  assert.match(
    packageVerifier,
    /A vehicle heartbeat was decoded, but Ground Control could not finish connecting/,
  );
  assert.match(packageVerifier, /Serial port open timed out/);
  assert.match(packageVerifier, /Serial port open was superseded/);
  assert.match(packageVerifier, /configuring-control-lines/);
  assert.match(packageVerifier, /USB device may have reset or briefly re-enumerated/);
  assert.match(packageVerifier, /serial link ended during MAVLink startup/);
  assert.match(packageVerifier, /Serial link interrupted/);
  assert.match(packageVerifier, /Unable to enumerate serial ports/);
  assert.match(packageVerifier, /handleConnectionAbort/);
  assert.match(packageVerifier, /hadVehicleHeartbeat/);
  assert.match(packageVerifier, /pendingReconnectRequest/);
  assert.match(packageVerifier, /unexpectedTerminalOperatorGuardUntil/);
  assert.match(packageVerifier, /commandBlockReason/);
  assert.match(packageVerifier, /validated MAVLink telemetry connection/);
  assert.match(packageVerifier, /MAVLINK_SESSION_DETACHED/);
  assert.match(packageVerifier, /MAVLink host timer/);
  assert.match(packageVerifier, /Auto protocol \(selected baud\)/);
  assert.match(packageVerifier, /flightDataMapPane/);
  assert.match(packageVerifier, /Make HUD major/);
  assert.match(
    packageVerifier,
    /Switch Flight Commander's global display units between metric and imperial/,
  );
  assert.match(packageVerifier, /flightCommanderTheme/);
  assert.match(packageVerifier, /flight-commander-theme-change/);
  assert.match(packageVerifier, /dark-only/);
  assert.match(packageVerifier, /Flight Commander Firmware/);
  assert.match(packageVerifier, /Official INAV Firmware/);
  assert.match(packageVerifier, /Flight-Commander-Firmware-/);
  assert.match(packageVerifier, /FCFW/);
  assert.match(packageVerifier, /MICOAIR743/);
  assert.match(packageVerifier, /MICROAIR743/);
  assert.match(packageVerifier, /Firmware Capabilities/);
  assert.match(packageVerifier, /Official INAV is connected in compatibility mode/);
  assert.match(packageVerifier, /Multirotor AutoTune/);
  assert.match(packageVerifier, /Terrain-relative waypoints/);
  assert.match(packageVerifier, /Mission streaming/);
  assert.match(packageVerifier, /RTK2go public caster/);
  assert.match(packageVerifier, /Start NTRIP refinement/);
  assert.match(packageVerifier, /ntripListMountpoints/);
  assert.match(
    packageVerifier,
    /NTRIP FlightCommander\/\$\{sourcePackage\.version\}/,
  );
  assert.match(packageVerifier, /ArduPilot support has been removed/);
  for (const propInches of [10, 12, 15, 17]) {
    assert.match(
      packageVerifier,
      new RegExp(`Multirotor with ${propInches}.*propellers`),
    );
  }
  assert.match(packageVerifier, /generated roll P\/I\/D\/FF/);
  assert.match(packageVerifier, /ez_snappiness/);
  assert.match(packageVerifier, /flightCommanderGroundControlMinorPosition/);
  assert.match(packageVerifier, /miles per hour/);
  assert.match(packageVerifier, /#31523b/);
  assert.match(packageVerifier, /#172a20/);
  assert.match(packageVerifier, /data-motor-number-layout/);
  assert.match(packageVerifier, /data-motor-prop-configuration/);
  assert.match(packageVerifier, /quad_x_reverse/);
  assert.match(packageVerifier, /quad_p_reverse/);
  assert.match(packageVerifier, /data-motor-rotations/);
  assert.match(packageVerifier, /wrong INAV motor rotation order/);
  assert.match(packageVerifier, /Keep every current value and save only the first-run acknowledgement/);
  assert.match(packageVerifier, /Selecting default control profile 1/);
  assert.match(packageVerifier, /Control profile 1:/);
  assert.match(packageVerifier, /INAV is not responding after reboot/);
  assert.match(packageVerifier, /INAV did not respond after three post-reboot/);
  assert.match(packageVerifier, /Restoring the selected control profile/);
  assert.match(packageVerifier, /Control profile 2:/);
  assert.match(packageVerifier, /batteryProfileHighlightActive/);
  assert.match(packageVerifier, /controlProfileHighlightActive/);
  for (const selector of [
    "fc-flight-visuals",
    "fc-live-pane",
    "compass-calibration-card",
    "rtk-workflow-option",
    "mixer-preview-image-numbers \\.motorNumber",
    "batteryProfileHighlightActive",
    "controlProfileHighlightActive",
  ]) {
    assert.match(packageVerifier, new RegExp(selector));
  }
});

test("native NTRIP and drone-off RTK base setup are release surfaces", () => {
  assert.doesNotMatch(rendererEntry, /tab_rtk_base/);
  assert.match(groundControlHtml, /id="flightDataRtkMount"/);
  assert.match(groundControlSource, /rtkBasePanel\.mount/);
  assert.match(rtkBaseHtml, /Direct NTRIP → Aircraft/);
  assert.match(rtkBaseHtml, /Survey-in USB Base → Aircraft/);
  assert.match(rtkBaseHtml, /NTRIP-refined USB Base → Aircraft/);
  assert.match(rtkBaseHtml, /RTK2go public caster/);
  assert.match(rtkBaseHtml, /Load streams/);
  assert.match(rtkBaseHtml, /aircraft may remain powered off/i);
  assert.match(rtkBaseHtml, /Finalize refined fixed base/);
  assert.match(rtkBaseSource, /beginNtripSurveyRefinement/);
  assert.match(rtkBaseSource, /finalizeNtripRefinedBase/);
  assert.match(mainProcess, /ntripListMountpoints/);
  assert.match(preloadProcess, /ntripListMountpoints/);
  assert.match(
    ntripClientSource,
    new RegExp(
      `NTRIP FlightCommander/${packageManifest.version.replaceAll(".", "\\.")}`,
    ),
  );
  assert.match(ntripClientSource, /SOURCETABLE/);
});

test("documentation and support stay on Flight Commander-owned resources", () => {
  const documentationUrl =
    "https://github.com/srt3262/Flight-Commander/tree/main/docs";
  const retiredDocumentationUrl =
    "https://github.com/iNavFlight/inav/wiki";
  const userFacingSources = [
    "index.html",
    ...sourceFiles("tabs", [".html", ".js"]),
    ...sourceFiles("locale", [".json"]),
    ...sourceFiles("js/flightCommander", [".js"]),
  ].map((path) => readFileSync(resolve(projectRoot, path), "utf8")).join("\n");

  assert.match(rendererEntry, new RegExp(documentationUrl));
  assert.match(guiSource, /documentationUrlForTab/);
  assert.match(documentationRouter, new RegExp(documentationUrl));
  assert.doesNotMatch(
    rendererEntry,
    new RegExp(`href=["']${retiredDocumentationUrl}["']`),
  );
  assert.doesNotMatch(
    guiSource,
    new RegExp(`["']${retiredDocumentationUrl}["']`),
  );
  assert.match(
    documentationHub,
    /https:\/\/github\.com\/srt3262\/Flight-Commander\/issues/,
  );
  assert.match(documentationHub, /USB RTK base and NTRIP workflows/);
  assert.match(documentationHub, /Heading fusion, compass sources, calibration/);
  assert.match(documentationRouter, /cli: documentUrl\('CLI\.md'\)/);
  assert.match(documentationRouter, /settings: documentUrl\('SETTINGS_REFERENCE\.md'\)/);
  assert.doesNotMatch(
    userFacingSources,
    /https:\/\/github\.com\/iNavFlight/,
    "a user-facing product link still routes to upstream INAV documentation or support",
  );

  for (const match of documentationHub.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)) {
    assert.equal(
      existsSync(resolve(projectRoot, "docs", match[1])),
      true,
      `documentation hub target is missing: ${match[1]}`,
    );
  }

  const graphicalSettingNames = new Set(
    sourceFiles("tabs", [".html"])
      .flatMap((path) => [
        ...readFileSync(resolve(projectRoot, path), "utf8")
          .matchAll(/\bdata-setting=["']([^"']+)["']/g),
      ])
      .map((match) => match[1]),
  );
  assert.equal(graphicalSettingNames.size, 246);
  for (const settingName of graphicalSettingNames) {
    const anchor = settingName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    assert.match(settingsReference, new RegExp(`<a id=["']${anchor}["']></a>`));
    assert.ok(settingsReference.includes(`### \`${settingName}\``));
  }
});

test("weighted heading fusion and moving-baseline setup are release surfaces", () => {
  for (const sourceIndex of [0, 1, 2, 3]) {
    assert.match(gpsHtml, new RegExp(`headingSourceEnabled${sourceIndex}`));
    assert.match(gpsHtml, new RegExp(`headingSourcePriority${sourceIndex}`));
    assert.match(gpsHtml, new RegExp(`headingSourceWeight${sourceIndex}`));
  }
  assert.match(gpsHtml, /UART GPS-module compass/);
  assert.match(gpsHtml, /DroneCAN GPS-module compass/);
  assert.match(gpsHtml, /Moving-baseline GNSS yaw/);
  assert.doesNotMatch(gpsHtml, /id="headingCalibrateMag"/);
  assert.match(gpsHtml, /Calibration tab after reboot/);
  assert.match(calibrationHtml, /id="compassCalibrationList"/);
  assert.match(calibrationSource, /MSP_MAG_CALIBRATION/);
  assert.match(calibrationSource, /loadFlightCommanderHeadingConfig/);
  assert.match(calibrationSource, /loadFlightCommanderHeadingStatus/);
  assert.match(compassCalibrationSource, /HEADING_SOURCE_DRONECAN_MAG/);
  assert.match(compassCalibrationSource, /External \/ UART GPS-module compass/);
  assert.match(headingFusionSource, /calibrationFailedMask/);
  assert.match(headingFusionSource, /HEADING_CONFIG_SCHEMA = 2/);
  assert.match(headingFusionSource, /dronecanMagCalibrationNodeId/);
  assert.match(gpsHtml, /does not infer yaw from two ordinary latitude\/longitude fixes/);
  assert.match(gpsSource, /loadFlightCommanderHeadingStatus/);
  assert.match(gpsSource, /encodeHeadingConfig/);
  assert.match(portsHtml, /id="dronecanMagNode"/);
  assert.match(portsSource, /RELATIVE_HEADING:\s*1 << 4/);
  assert.match(firmwareInfoHtml, /data-fc-feature="headingFusion"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="movingBaselineYaw"/);
});

test("UART RTK rover selection and per-module alignment ship in the release UI", () => {
  assert.match(gpsHtml, /value="f9-rtk-rover"/);
  assert.match(gpsHtml, /u-blox F9P \/ F9-series \(RTK Rover\)/);
  assert.match(gpsHtml, /id="gpsRtkRoverGuidance"/);
  assert.match(gpsSource, /UART_GPS_PRESETS/);
  assert.match(gpsSource, /uartRtkRoverNextAction/);

  assert.match(magnetometerHtml, /id="alignmentTarget"/);
  assert.match(magnetometerHtml, /Generic u-blox F9P \/ F9-series RTK \(UART\)/);
  assert.match(magnetometerHtml, /Generic DroneCAN RTK GPS module/);
  assert.match(magnetometerHtml, /Dual RTK GPS moving-baseline pair/);
  assert.match(magnetometerSource, /enumerateAlignmentTargets/);
  assert.match(magnetometerSource, /writeFlightCommanderAlignmentAngles/);
  assert.match(magnetometerSource, /saveFlightCommanderHeadingConfig/);
  assert.match(magnetometerSource, /createGenericRtkModel/);
  assert.match(alignmentTargetsSource, /label: 'Onboard compass'/);
  assert.match(alignmentTargetsSource, /board-correct CW90 orientation/);
  assert.doesNotMatch(alignmentTargetsSource, /Onboard \/ standard external compass/);
});

test("SITL presents a Flight Commander-owned operator surface", () => {
  assert.match(sitlHtml, /Flight Commander SITL/);
  assert.match(sitlHtml, /Flight Commander Output/);
  assert.match(sitlSource, /Flight Commander SITL/);
  assert.doesNotMatch(sitlHtml, /run INAV|INAV Output/);

  for (const localePath of sourceFiles("locale", [".json"])) {
    const messages = JSON.parse(readFileSync(resolve(projectRoot, localePath), "utf8"));
    for (const key of [
      "sitlInavOutput",
      "sitlHelp",
      "sitlProfilesHelp",
      "sitlEnableSimulatorHelp",
    ]) {
      assert.doesNotMatch(messages[key]?.message ?? "", /\bINAV\b/);
    }
  }
});

test("application remains dark-only", () => {
  assert.match(rendererEntry, /<html[^>]+data-theme="dark"/);
  assert.doesNotMatch(rendererEntry, /id="applicationTheme"/);
  assert.doesNotMatch(rendererEntry, /fc-theme-switch/);
  assert.match(themeCss, /:root\s*\{[^}]*color-scheme:\s*dark;/s);
  assert.doesNotMatch(themeCss, /data-theme="light"/);
  assert.doesNotMatch(themeCss, /\.fc-theme-switch/);
  assert.match(themeCss, /\.tab-ports table tbody tr:nth-child\(even\)/);
  assert.match(themeCss, /input:disabled/);
  assert.match(themeCss, /\.tab-pid_tuning \.pid-sliders-axis/);
  assert.match(themeCss, /\.tab-landing \.flightCommanderLogo/);
});

test("firmware selection, identity, and feature gates are packaged together", () => {
  assert.equal(packageManifest.flightCommander.bundledFirmwareVersion, "2.0.6");
  assert.equal(packageManifest.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageManifest.flightCommander.bundledFirmwareSourceAvailable, true);
  assert.equal(packageManifest.flightCommander.bundledFirmwareSourceVersion, "2.0.6");
  assert.equal(
    packageManifest.flightCommander.bundledFirmwareSourceArchive,
    "resources/firmware-source/Flight-Commander-Firmware-Source-v2.0.6.zip",
  );
  assert.equal(
    packageManifest.flightCommander.bundledFirmwareSourceSha256,
    "15e082ae28731e3f530635ec826e58f0375257e8671ae3ccf024a1acfffe1bec",
  );
  assert.equal(
    packageManifest.flightCommander.bundledFirmwareSourceRevision,
    "e92bca368b2b9b53aaf79103da3237dec77320b1",
  );
  assert.equal(
    packageManifest.flightCommander.bundledFirmwareSourceTree,
    "6c3f6e5da4978a7c2ce3825ce3d498403c7b81ee",
  );
  assert.equal(existsSync(bundledFirmwarePath), true);
  assert.ok(readFileSync(bundledFirmwarePath).length > 1024 * 1024);
  assert.equal(
    fileSha256(bundledFirmwarePath),
    "db370ff20fefe2f80c768eea63aff9b368ba1b0d49beb4668ed693f391684df0",
  );
  assert.equal(
    packageManifest.flightCommander.bundledFirmwareSha256,
    fileSha256(bundledFirmwarePath),
  );
  assert.equal(existsSync(bundledFirmwareSourcePath), true);
  assert.ok(readFileSync(bundledFirmwareSourcePath).length > 1024 * 1024);
  assert.deepEqual(
    [...readFileSync(bundledFirmwareSourcePath).subarray(0, 4)],
    [0x50, 0x4b, 0x03, 0x04],
  );
  assert.equal(
    fileSha256(bundledFirmwareSourcePath),
    packageManifest.flightCommander.bundledFirmwareSourceSha256,
  );
  assert.deepEqual(
    [...firmwareFlasherHtml.matchAll(/<option value="([^"]+)">(?:Flight Commander Firmware|Official INAV Firmware)<\/option>/g)]
      .map((match) => match[1]),
    ["flight-commander", "inav"],
  );
  assert.match(firmwareFlasherHtml, /value="flight-commander">Flight Commander Firmware/);
  assert.match(firmwareFlasherHtml, /value="inav">Official INAV Firmware/);
  assert.doesNotMatch(firmwareFlasherHtml, /value="ardupilot"/i);
  assert.match(firmwareFlasherSource, /parsedHexContainsFlightCommanderIdentity/);
  assert.match(firmwareFlasherSource, /loadedFirmwareFamily !== firmwareBackend/);
  assert.match(firmwareFlasherSource, /isInavCompatibleFirmwareVariant\(reportedVariant\)/);
  assert.match(firmwareFlasherSource, /flightCommanderCatalogIsReady\(\)/);
  assert.match(firmwareFlasherSource, /Latest compatible online firmware/);
  assert.match(firmwareFlasherSource, /versions\.val\(latest\.version\)\.trigger\('change'\)/);
  assert.match(firmwareFlasherSource, /Select Local Firmware File/);
  assert.match(firmwareFlasherSource, /Download Online Firmware/);
  assert.match(firmwareFlasherSource, /Flash Selected Firmware/);
  assert.match(firmwareFlasherSource, /Use Offline Firmware Copy/);
  assert.match(firmwareFlasherSource, /Online download failed\. Loading the verified offline firmware copy\./);
  assert.doesNotMatch(firmwareFlasherSource, /Load included Flight Commander Firmware/);
  assert.match(
    firmwareFlasherSource,
    /flightCommanderReleasesData[\s\S]+firmwareFlasherTab\.getTarget\(\)/,
  );
  assert.match(firmwareIdentitySource, /MSP2_FLIGHT_COMMANDER_INFO = 0x2f00/);
  assert.match(firmwareIdentitySource, /FLIGHT_COMMANDER_INFO_SIGNATURE = "FCFW"/);
  assert.match(firmwareIdentitySource, /retryCounter: 0/);
  assert.match(firmwareCatalogSource, /MICOAIR743/);
  assert.match(firmwareCatalogSource, /MICROAIR743/);
  assert.match(packageVerifier, /intelHexPayload/);
  assert.match(packageVerifier, /the packaged firmware differs from the verified source firmware image/);
  assert.match(packageVerifier, /Latest compatible online firmware/);
  assert.match(packageVerifier, /Select Local Firmware File/);
  assert.match(packageVerifier, /Download Online Firmware/);
  assert.match(packageVerifier, /Flash Selected Firmware/);
  assert.match(packageVerifier, /Load included Flight Commander Firmware/);
  assert.match(firmwareInfoHtml, /Firmware Capabilities/);
  assert.match(firmwareInfoHtml, /data-fc-feature="multirotorAutotune"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="terrainWaypoints"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="missionStreaming"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="gcsRtkBase"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="headingFusion"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="movingBaselineYaw"/);
});

test("retired ArduPilot implementation files are absent", () => {
  for (const path of [
    "tabs/ardupilot_firmware_flasher.js",
    "tabs/mavlink_parameters.js",
    "tabs/autotune.js",
    "js/ardupilot/setupService.js",
    "js/firmware/apj.js",
    "js/firmware/px4BootloaderUploader.js",
    "js/parameters/ardupilotParameterModel.js",
  ]) {
    assert.equal(existsSync(resolve(projectRoot, path)), false, path);
  }
  assert.doesNotMatch(
    readFileSync(resolve(projectRoot, "js/mavlink/services.js"), "utf8"),
    /MavlinkParameterManager|ParamSet/,
  );
});

test("all requested large-prop INAV presets are wired into the release source", () => {
  for (const propInches of [10, 12, 15, 17]) {
    assert.match(presetSource, new RegExp(`propInches:\\s*${propInches}`));
  }
  assert.match(presetSource, /Mirrors INAV 9\.1's flight\/ez_tune\.c generator/);
  assert.match(presetSource, /setting\("ez_enabled", "ON"\)/);
  assert.match(presetSource, /setting\("ez_snappiness", profile\.snappiness\)/);
});

test("landing page reports the current Flight Commander release", () => {
  assert.equal(packageManifest.version, "2.0.6");
  assert.equal(manifest.version, packageManifest.version);
  assert.match(
    landingHtml,
    new RegExp(`>Flight Commander ${packageManifest.version.replaceAll(".", "\\.")}<`),
  );
});

test("guarded push publication is tied to the current release version", () => {
  assert.match(
    releaseWorkflow,
    new RegExp(
      `github\\.event\\.head_commit\\.message == 'Publish Flight Commander ${packageManifest.version.replaceAll(".", "\\.")} release'`,
    ),
  );
});

test("release policy distinguishes software-only updates from firmware rebuilds", () => {
  assert.equal(
    typeof packageManifest.flightCommander.firmwareChangedInRelease,
    "boolean",
  );
  assert.match(releaseWorkflow, /firmwareChangedInRelease/);
  assert.match(
    releaseWorkflow,
    /A firmware-changing release must rebuild firmware at the exact Configurator version/,
  );
  assert.match(
    releaseWorkflow,
    /Configurator and firmware major versions must match/,
  );
  assert.match(
    releaseWorkflow,
    /Every release after the one-time Configurator 2\.0\.5 legacy exception must publish exact firmware source/,
  );
  assert.match(releaseWorkflow, /bundledFirmwareSourceAvailable/);
  assert.match(releaseWorkflow, /bundledFirmwareSourceVersion/);
  assert.match(releaseWorkflow, /bundledFirmwareSourceArchive/);
  assert.match(releaseWorkflow, /bundledFirmwareSourceSha256/);
  assert.match(releaseWorkflow, /bundledFirmwareSourceRevision/);
  assert.match(releaseWorkflow, /bundledFirmwareSourceTree/);
  assert.match(releaseWorkflow, /Rebuild firmware from retained source ZIP/);
  assert.match(releaseWorkflow, /rebuild-firmware-source-archive\.sh/);
  assert.match(firmwareRebuildScript, /arm-gnu-toolchain-13\.2\.rel1/);
  assert.match(
    firmwareRebuildScript,
    /6cd1bbc1d9ae57312bcd169ae283153a9572bd6a8e4eeae2fedfbc33b115fdbb/,
  );
  assert.match(firmwareRebuildScript, /cmp --silent/);
  assert.match(firmwareRebuildScript, /target_directories/);
  assert.match(firmwareRebuildScript, /MICOAIR743_EXTMAG/);
});

test("source-backed releases publish Configurator and firmware binaries plus both sources", () => {
  assert.match(
    releaseWorkflow,
    /Flight-Commander-Configurator-Windows-x64-v\$version\.zip/,
  );
  assert.match(
    releaseWorkflow,
    /Flight-Commander-Configurator-Source-v\$version\.zip/,
  );
  assert.match(
    releaseWorkflow,
    /Flight-Commander-Firmware-\$firmwareVersion-MICOAIR743\.hex/,
  );
  assert.match(
    releaseWorkflow,
    /Flight-Commander-Firmware-Source-v\$firmwareVersion\.zip/,
  );
  assert.match(releaseWorkflow, /git archive --format=zip/);
  assert.match(releaseWorkflow, /Copy-Item[\s\S]+\$firmwareSourceRepositoryPath[\s\S]+\$firmwareSourceArchivePath/);
  assert.match(releaseWorkflow, /schemaVersion = 7/);
  assert.match(releaseWorkflow, /assets\.firmware/);
  assert.match(releaseWorkflow, /firmwareSourceAvailable = \$firmwareSourceAvailable/);
  assert.match(releaseWorkflow, /\$releaseAssets\['firmwareSource'\]/);
  assert.match(releaseWorkflow, /\$expectedCandidateFileCount = if \(\$firmwareSourceAvailable\) \{ 5 \} else \{ 4 \}/);
  assert.match(
    releaseWorkflow,
    /gh release create \$tag @releaseAssetPaths/,
  );
  assert.match(
    releaseWorkflow,
    /\$expectedPublishedAssetCount = if \(\$firmwareSourceAvailable\) \{ 4 \} else \{ 3 \}/,
  );
  assert.doesNotMatch(releaseWorkflow, /Firmware-Package|firmwarePackageDirectory/);
});

test("canonical Flight Commander visual assets match the verified 1.3.5 identity", () => {
  assert.equal(
    fileSha256(resolve(projectRoot, "images/flight-commander-wordmark.svg")),
    "cc9d64ac8af17e25ce88a0209499e770ffd71df9932f8253ccf419cc2d5241d5",
  );
  assert.equal(
    fileSha256(resolve(projectRoot, "images/flight-commander.ico")),
    "0cd605edccc41fd9054c73c8ef93ad10c402a9939059d8acb8b21a25f4c21d08",
  );
  assert.equal(
    fileSha256(resolve(projectRoot, "images/flight_commander_256.png")),
    "ab0f3f2d15a58a02871a7dc11591780efd142821457de231beac971624f4b568",
  );
});

test("every active product identity path selects Flight Commander artwork", () => {
  assert.match(forgeConfig, /icon:\s*["']images\/flight-commander["']/);
  assert.match(forgeConfig, /images\/flight-commander\.ico/);
  assert.match(forgeConfig, /images\/flight-commander\.icns/);
  assert.match(forgeConfig, /images\/flight_commander_128\.png/g);
  assert.doesNotMatch(
    forgeConfig,
    /images\/inav|inav_installer_icon|inav_icon_128/,
  );

  assert.match(mainProcess, /flight_commander_256\.png/);
  assert.match(mainProcess, /nativeImage\.createFromDataURL/);
  assert.match(mainProcess, /app\.setName\(['"]Flight Commander['"]\)/);
  assert.doesNotMatch(mainProcess, /inav_icon_128/);

  assert.match(mainCss, /flight-commander-wordmark\.svg/);
  assert.match(landingCss, /\.flightCommanderLogo/);
  assert.match(landingCss, /\.flightCommanderTagline/);
  assert.match(
    landingCss,
    /flight-commander-wordmark-on-light\.svg/,
  );
  assert.doesNotMatch(landingCss, /\.inavLogo/);
  assert.match(cliCss, /flight-commander-wordmark\.svg/);
  assert.match(pidTuningCss, /flight-commander-wordmark\.svg/);

  assert.equal(
    manifest.icons["128"],
    "images/flight_commander_128.png",
  );
  assert.match(linuxDesktop, /^Name=Flight Commander$/m);
  assert.match(linuxDesktop, /^Exec=flight-commander %U$/m);
  assert.match(linuxDesktop, /^Icon=flight-commander$/m);
  assert.doesNotMatch(linuxDesktop, /INAV Configurator|\/opt\/|\/usr\/lib\//);
});

test("legacy welcome art remains intact while the active theme selects dark branding", () => {
  assert.match(welcomeWordmark, /data-wordmark-surface="light"/);
  assert.match(
    welcomeWordmark,
    /<text[^>]+fill="#104156"[^>]*>FLIGHT<\/text>/,
  );
  assert.match(
    welcomeWordmark,
    /<text[^>]+fill="#2186b5"[^>]*>COMMANDER<\/text>/,
  );
  assert.match(
    welcomeWordmark,
    /<path[^>]+fill="#104156"[^>]+stroke="#104156"/,
  );
  assert.match(
    welcomeWordmark,
    /<circle[^>]+stroke="#104156"/,
  );
  assert.doesNotMatch(
    welcomeWordmark,
    /(?:fill|stroke)="#(?:fff|ffffff)"/i,
  );
  assert.match(
    landingCss,
    /\.flightCommanderTagline\s*\{[^}]*color:\s*#104156;/s,
  );
  assert.ok(contrastAgainstWhite("#2186b5") >= 4);
  assert.ok(contrastAgainstWhite("#104156") >= 7);
  assert.match(
    themeCss,
    /\.tab-landing \.flightCommanderLogo\s*\{[^}]*flight-commander-wordmark\.svg/s,
  );
  assert.match(
    themeCss,
    /\.tab-landing \.content_top\s*\{[^}]*background-color:\s*#17242b/s,
  );
});
