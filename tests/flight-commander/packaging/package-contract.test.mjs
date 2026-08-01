import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
const packageVerifier = readFileSync(
  resolve(projectRoot, "scripts/verify-windows-package.mjs"),
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
  assert.match(
    forgeConfig,
    /path\.join\(__dirname,\s*["']\.vite["'],\s*["']build["']\)/,
  );
  assert.match(
    forgeConfig,
    /path\.join\(__dirname,\s*["']\.vite["'],\s*["']renderer["']\)/,
  );
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
  assert.match(packageVerifier, /flightCommanderGroundControlMinorPosition/);
  assert.match(packageVerifier, /miles per hour/);
  assert.match(packageVerifier, /#31523b/);
  assert.match(packageVerifier, /#172a20/);
  for (const selector of [
    "fc-unit-switch",
    "fc-minor-view-layer",
    "fc-minor-view-window",
    "fc-minor-view-handle",
  ]) {
    assert.match(packageVerifier, new RegExp(selector));
  }
});

test("landing page reports the current Flight Commander release", () => {
  assert.match(landingHtml, />Flight Commander 1\.5\.1</);
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

test("welcome branding remains complete and readable on its light map surface", () => {
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
});
