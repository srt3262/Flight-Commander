import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
const landingHtml = readFileSync(
  resolve(projectRoot, "tabs/landing.html"),
  "utf8",
);
const mainProcess = readFileSync(
  resolve(projectRoot, "js/main/main.js"),
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

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
  assert.match(packageVerifier, /flightDataMinorDragHandle/);
  assert.match(packageVerifier, /Reset minor view/);
  assert.match(packageVerifier, /flightCommanderGroundControlUnits/);
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
  assert.match(packageVerifier, /Standard INAV is connected/);
  assert.match(packageVerifier, /Multirotor AutoTune/);
  assert.match(packageVerifier, /Terrain-relative waypoints/);
  assert.match(packageVerifier, /Mission streaming/);
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
    "fc-minor-view-layer",
    "fc-minor-view-window",
    "fc-minor-view-handle",
    "mixer-preview-image-numbers \\.motorNumber",
    "batteryProfileHighlightActive",
    "controlProfileHighlightActive",
  ]) {
    assert.match(packageVerifier, new RegExp(selector));
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
  assert.match(
    firmwareFlasherSource,
    /flightCommanderReleasesData[\s\S]+firmwareFlasherTab\.getTarget\(\)/,
  );
  assert.match(firmwareIdentitySource, /MSP2_FLIGHT_COMMANDER_INFO = 0x2f00/);
  assert.match(firmwareIdentitySource, /FLIGHT_COMMANDER_INFO_SIGNATURE = "FCFW"/);
  assert.match(firmwareIdentitySource, /retryCounter: 0/);
  assert.match(firmwareCatalogSource, /MICOAIR743/);
  assert.match(firmwareCatalogSource, /MICROAIR743/);
  assert.match(firmwareInfoHtml, /Firmware Capabilities/);
  assert.match(firmwareInfoHtml, /data-fc-feature="multirotorAutotune"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="terrainWaypoints"/);
  assert.match(firmwareInfoHtml, /data-fc-feature="missionStreaming"/);
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
  assert.equal(packageManifest.version, "2.0.0");
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
