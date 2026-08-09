import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePackage = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
);

function fail(message) {
  throw new Error(`Windows package verification failed: ${message}`);
}

function requireMarkers(source, markers, bundleDescription) {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    fail(
      `${bundleDescription} is missing required marker(s): ${missing.join(", ")}`,
    );
  }
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function isBelow(directory, path) {
  const resolvedDirectory = resolve(directory);
  const resolvedPath = resolve(path);
  return (
    resolvedPath === resolvedDirectory ||
    resolvedPath.startsWith(`${resolvedDirectory}${sep}`)
  );
}

function rendererReferenceCandidates(source) {
  return [...source.matchAll(/["']([^"'?#]+\.js)(?:[?#][^"']*)?["']/g)].map(
    (match) => match[1],
  );
}

function activeRendererFiles(rendererDirectory) {
  const entryHtmlPath = join(rendererDirectory, "index.html");
  if (!existsSync(entryHtmlPath)) {
    fail(`the renderer entry HTML is missing: ${entryHtmlPath}`);
  }

  const entryHtml = readFileSync(entryHtmlPath, "utf8");
  const entryReferences = [
    ...entryHtml.matchAll(
      /<(?:script|link)\b[^>]*(?:src|href)=["']([^"'?#]+\.js)(?:[?#][^"']*)?["'][^>]*>/g,
    ),
  ].map((match) => match[1]);
  if (entryReferences.length === 0) {
    fail("the renderer entry HTML does not reference a JavaScript entry point");
  }

  const queue = entryReferences.map((reference) =>
    resolve(rendererDirectory, reference),
  );
  const active = new Set();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!isBelow(rendererDirectory, candidate)) {
      fail(`renderer reference escapes its output directory: ${candidate}`);
    }
    if (active.has(candidate)) {
      continue;
    }
    if (!existsSync(candidate)) {
      fail(`active renderer file is missing: ${candidate}`);
    }

    active.add(candidate);
    const source = readFileSync(candidate, "utf8");
    for (const reference of rendererReferenceCandidates(source)) {
      const referencedPath = reference.startsWith("/")
        ? resolve(rendererDirectory, `.${reference}`)
        : resolve(dirname(candidate), reference);
      if (!isBelow(rendererDirectory, referencedPath)) {
        fail(`renderer reference escapes its output directory: ${reference}`);
      }
      if (existsSync(referencedPath)) {
        queue.push(referencedPath);
        continue;
      }

      // Vite-generated chunks include a content hash. Source-level strings
      // such as "flight_planner.js" may also be present in bundled metadata
      // and are not emitted-file references.
      if (/-[A-Za-z0-9_-]{8,}\.js$/.test(basename(reference))) {
        fail(`active renderer dependency is missing: ${reference}`);
      }
    }
  }

  const allRendererFiles = filesBelow(rendererDirectory).filter(
    (path) => extname(path) === ".js",
  );
  const unreferenced = allRendererFiles.filter((path) => !active.has(path));
  if (unreferenced.length > 0) {
    fail(
      `renderer output contains ${unreferenced.length} unreferenced JavaScript ` +
        `file(s): ${unreferenced.map((path) => basename(path)).join(", ")}`,
    );
  }

  return [...active];
}

function activeRendererStylesheets(rendererDirectory) {
  const entryHtmlPath = join(rendererDirectory, "index.html");
  const entryHtml = readFileSync(entryHtmlPath, "utf8");
  const stylesheetReferences = [
    ...entryHtml.matchAll(
      /<link\b[^>]*href=["']([^"'?#]+\.css)(?:[?#][^"']*)?["'][^>]*>/g,
    ),
  ].map((match) => match[1]);

  if (stylesheetReferences.length === 0) {
    fail("the renderer entry HTML does not reference a stylesheet");
  }

  return stylesheetReferences.map((reference) => {
    const path = reference.startsWith("/")
      ? resolve(rendererDirectory, `.${reference}`)
      : resolve(rendererDirectory, reference);
    if (!isBelow(rendererDirectory, path) || !existsSync(path)) {
      fail(`active renderer stylesheet is missing or unsafe: ${reference}`);
    }
    return path;
  });
}

function decodedSvgDataUrls(declaration) {
  return [
    ...declaration.matchAll(
      /url\((["']?)(data:image\/svg\+xml[^)]*?)\1\)/g,
    ),
  ].flatMap((match) => {
    const dataUrl = match[2];
    const comma = dataUrl.indexOf(",");
    if (comma < 0) {
      return [];
    }
    const mediaType = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    try {
      return [
        mediaType.includes(";base64")
          ? Buffer.from(payload, "base64").toString("utf8")
          : decodeURIComponent(payload),
      ];
    } catch {
      return [];
    }
  });
}

function ruleDeclarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...css.matchAll(new RegExp(`${escaped}\\{([^}]*)\\}`, "g")),
  ].map((match) => match[1]);
}

function hasFlightCommanderWordmark(declaration) {
  return decodedSvgDataUrls(declaration).some(
    (svg) =>
      svg.includes("Flight Commander") &&
      svg.includes(">FLIGHT</text>") &&
      svg.includes(">COMMANDER</text>"),
  );
}

function hasCompleteDarkWelcomeWordmark(declaration) {
  return decodedSvgDataUrls(declaration).some(
    (svg) =>
      svg.includes("Flight Commander") &&
      /<text[^>]+fill=["']#ffffff["'][^>]*>FLIGHT<\/text>/i.test(svg) &&
      /<text[^>]+fill=["']#37a8db["'][^>]*>COMMANDER<\/text>/i.test(svg),
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function icoImages(bytes) {
  if (
    bytes.length < 6 ||
    bytes.readUInt16LE(0) !== 0 ||
    bytes.readUInt16LE(2) !== 1
  ) {
    fail("the canonical Flight Commander ICO header is invalid");
  }

  const count = bytes.readUInt16LE(4);
  if (count === 0 || 6 + count * 16 > bytes.length) {
    fail("the canonical Flight Commander ICO directory is invalid");
  }

  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (size === 0 || offset + size > bytes.length) {
      fail("the canonical Flight Commander ICO image range is invalid");
    }
    return {
      width: bytes[entry] || 256,
      height: bytes[entry + 1] || 256,
      bytes: bytes.subarray(offset, offset + size),
    };
  });
}

function peIconImages(bytes) {
  const peOffset = bytes.readUInt32LE(0x3c);
  const coffOffset = peOffset + 4;
  const sectionCount = bytes.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = bytes.readUInt16LE(coffOffset + 16);
  const optionalHeaderOffset = coffOffset + 20;
  const optionalHeaderMagic = bytes.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset =
    optionalHeaderOffset + (optionalHeaderMagic === 0x20b ? 112 : 96);
  const resourceRva = bytes.readUInt32LE(dataDirectoryOffset + 16);
  const resourceSize = bytes.readUInt32LE(dataDirectoryOffset + 20);
  if (resourceRva === 0 || resourceSize === 0) {
    fail("the Windows executable has no resource directory");
  }

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const offset = sectionTableOffset + index * 40;
    return {
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20),
    };
  });

  function fileOffsetForRva(rva) {
    const section = sections.find(
      (candidate) =>
        rva >= candidate.virtualAddress &&
        rva <
          candidate.virtualAddress +
            Math.max(candidate.virtualSize, candidate.rawSize),
    );
    if (!section) {
      fail(`resource RVA 0x${rva.toString(16)} is outside every PE section`);
    }
    return section.rawOffset + rva - section.virtualAddress;
  }

  const resourceRoot = fileOffsetForRva(resourceRva);

  function directoryEntries(relativeOffset) {
    const offset = resourceRoot + relativeOffset;
    const namedCount = bytes.readUInt16LE(offset + 12);
    const idCount = bytes.readUInt16LE(offset + 14);
    return Array.from({ length: namedCount + idCount }, (_, index) => {
      const entryOffset = offset + 16 + index * 8;
      const name = bytes.readUInt32LE(entryOffset);
      const child = bytes.readUInt32LE(entryOffset + 4);
      return {
        id: name & 0x7fffffff,
        isNamed: Boolean(name & 0x80000000),
        isDirectory: Boolean(child & 0x80000000),
        relativeOffset: child & 0x7fffffff,
      };
    });
  }

  function resourceData(relativeOffset) {
    const entryOffset = resourceRoot + relativeOffset;
    const dataRva = bytes.readUInt32LE(entryOffset);
    const size = bytes.readUInt32LE(entryOffset + 4);
    const offset = fileOffsetForRva(dataRva);
    if (size === 0 || offset + size > bytes.length) {
      fail("a Windows icon resource range is invalid");
    }
    return bytes.subarray(offset, offset + size);
  }

  function numericType(typeId) {
    return directoryEntries(0).find(
      (entry) => !entry.isNamed && entry.id === typeId && entry.isDirectory,
    );
  }

  const iconType = numericType(3);
  const groupIconType = numericType(14);
  if (!iconType || !groupIconType) {
    fail("the Windows executable is missing icon resources");
  }

  const iconResources = new Map();
  for (const iconName of directoryEntries(iconType.relativeOffset)) {
    if (iconName.isNamed || !iconName.isDirectory) {
      continue;
    }
    const language = directoryEntries(iconName.relativeOffset)[0];
    if (!language || language.isDirectory) {
      fail(`Windows icon resource ${iconName.id} has no data language`);
    }
    iconResources.set(iconName.id, resourceData(language.relativeOffset));
  }

  const groupNames = directoryEntries(groupIconType.relativeOffset).filter(
    (entry) => !entry.isNamed && entry.isDirectory,
  );
  if (groupNames.length !== 1) {
    fail(
      `the Windows executable must contain exactly one group-icon resource; ` +
        `found ${groupNames.length}`,
    );
  }
  const groupName = groupNames[0];
  if (!groupName?.isDirectory) {
    fail("the Windows executable has no group-icon resource");
  }
  const groupLanguage = directoryEntries(groupName.relativeOffset)[0];
  if (!groupLanguage || groupLanguage.isDirectory) {
    fail("the Windows group-icon resource has no data language");
  }
  const group = resourceData(groupLanguage.relativeOffset);
  if (
    group.length < 6 ||
    group.readUInt16LE(0) !== 0 ||
    group.readUInt16LE(2) !== 1
  ) {
    fail("the Windows group-icon directory is invalid");
  }

  const count = group.readUInt16LE(4);
  if (count === 0 || 6 + count * 14 > group.length) {
    fail("the Windows group-icon entry table is invalid");
  }

  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 14;
    const id = group.readUInt16LE(entry + 12);
    const image = iconResources.get(id);
    if (!image) {
      fail(`Windows group-icon entry references missing icon ${id}`);
    }
    return {
      width: group[entry] || 256,
      height: group[entry + 1] || 256,
      bytes: image,
    };
  });
}

function findPackageDirectory() {
  if (process.argv[2]) {
    return resolve(projectRoot, process.argv[2]);
  }

  const out = join(projectRoot, "out");
  if (!existsSync(out)) {
    fail("the out directory does not exist");
  }

  const candidates = readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-win32-x64"))
    .map((entry) => join(out, entry.name));

  if (candidates.length !== 1) {
    fail(
      `expected one unpacked win32-x64 directory, found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function peMachine(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    fail(`${path} is not a PE executable`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset + 6 > bytes.length ||
    bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000"
  ) {
    fail(`${path} has an invalid PE header`);
  }
  return bytes.readUInt16LE(peOffset + 4);
}

const packageDirectory = findPackageDirectory();
const executable = join(packageDirectory, "flight-commander.exe");
const appDirectory = join(packageDirectory, "resources", "app");
const packagedManifestPath = join(appDirectory, "package.json");

for (const requiredPath of [executable, packagedManifestPath]) {
  if (!existsSync(requiredPath)) {
    fail(`required file is missing: ${requiredPath}`);
  }
}

if (peMachine(executable) !== 0x8664) {
  fail("flight-commander.exe is not a Windows x64 executable");
}

if (statSync(executable).size < 40 * 1024 * 1024) {
  fail("flight-commander.exe is unexpectedly small");
}

const canonicalIconPath = join(
  projectRoot,
  "images",
  "flight-commander.ico",
);
if (!existsSync(canonicalIconPath)) {
  fail(`the canonical Flight Commander icon is missing: ${canonicalIconPath}`);
}
const canonicalIconImages = icoImages(readFileSync(canonicalIconPath));
const executableIconImages = peIconImages(readFileSync(executable));
if (executableIconImages.length !== canonicalIconImages.length) {
  fail(
    `the embedded executable icon contains ${executableIconImages.length} image(s), ` +
      `expected ${canonicalIconImages.length}`,
  );
}
for (const expectedImage of canonicalIconImages) {
  const actualImage = executableIconImages.find(
    ({ width, height }) =>
      width === expectedImage.width && height === expectedImage.height,
  );
  if (!actualImage) {
    fail(
      `the embedded executable icon is missing ${expectedImage.width}x${expectedImage.height}`,
    );
  }
  if (sha256(actualImage.bytes) !== sha256(expectedImage.bytes)) {
    fail(
      `the embedded executable icon ${expectedImage.width}x${expectedImage.height} ` +
        "does not match the canonical Flight Commander icon",
    );
  }
}

const packageManifest = JSON.parse(readFileSync(packagedManifestPath, "utf8"));
if (packageManifest.name !== "flight-commander") {
  fail(`package name is ${packageManifest.name}`);
}
if (packageManifest.productName !== "Flight Commander") {
  fail(`product name is ${packageManifest.productName}`);
}
if (packageManifest.version !== sourcePackage.version) {
  fail(
    `packaged version ${packageManifest.version} does not match source ${sourcePackage.version}`,
  );
}
if (packageManifest.main !== ".vite/build/main.js") {
  fail(`packaged main entry is ${packageManifest.main}`);
}
if (sourcePackage.version !== "4.1.5") {
  fail(`source version is ${sourcePackage.version}; expected 4.1.5`);
}
if (sourcePackage.flightCommander?.firmwareReleaseVersion !== "4.1.5") {
  fail(
    `published firmware version is ${sourcePackage.flightCommander?.firmwareReleaseVersion}; expected 4.1.5`,
  );
}
if (sourcePackage.flightCommander?.firmwareChangedInRelease !== true) {
  fail("Flight Commander 4.1.5 must publish coordinated Firmware 4.1.5");
}
if (sourcePackage.flightCommander?.firmwareSourceVersion !== "4.1.5") {
  fail("Flight Commander 4.1.5 must publish the Firmware 4.1.5 source archive");
}
if (!sourcePackage.description.includes("flight controller")) {
  fail(`package description is ${sourcePackage.description}`);
}

const packageFiles = filesBelow(packageDirectory);
const forbiddenDirectoryNames = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-ia32",
]);
const foreignFiles = packageFiles.filter((file) => {
  const parts = relative(packageDirectory, file).split(sep);
  return parts.some((part) => forbiddenDirectoryNames.has(part));
});
if (foreignFiles.length > 0) {
  fail(
    `package contains foreign-architecture files, including ${relative(
      packageDirectory,
      foreignFiles[0],
    )}`,
  );
}

const windowsPathBudget = 140;
const overlongPackageFiles = packageFiles.filter(
  (file) => relative(packageDirectory, file).length > windowsPathBudget,
);
if (overlongPackageFiles.length > 0) {
  fail(
    `package contains a path longer than the Windows extraction budget of ` +
      `${windowsPathBudget} characters: ${relative(
        packageDirectory,
        overlongPackageFiles[0],
      )}`,
  );
}

const escapedApplicationDirectory = appDirectory.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&",
);
const packagedFirmware = packageFiles.filter((file) =>
  /[\\/]resources[\\/]app[\\/](?:resources[\\/]firmware(?:-source)?|release[\\/]firmware)[\\/]/i.test(
    file,
  ),
);
if (packagedFirmware.length > 0) {
  fail(
    `firmware must not be packaged inside the Configurator application; found ${relative(
      appDirectory,
      packagedFirmware[0],
    )}`,
  );
}
for (const forbidden of [
  /[\\/]release[\\/]firmware[\\/]/i,
  /[\\/]resources[\\/]firmware(?:-source)?[\\/]/i,
]) {
  if (
    packageFiles.some(
      (file) =>
        file.startsWith(appDirectory) &&
        forbidden.test(file.replace(new RegExp(`^${escapedApplicationDirectory}`), "")),
    )
  ) {
    fail("firmware or firmware source leaked into the packaged application");
  }
}

const serialPrebuilds = join(
  appDirectory,
  ".vite",
  "build",
  "node_natives",
  "node_modules",
  "@serialport",
  "bindings-cpp",
  "prebuilds",
);
if (!existsSync(serialPrebuilds)) {
  fail("the serial native prebuild directory is missing");
}
const serialTargets = readdirSync(serialPrebuilds, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
if (serialTargets.length !== 1 || serialTargets[0] !== "win32-x64") {
  fail(
    `serial native prebuilds are ${serialTargets.join(", ") || "missing"}; expected only win32-x64`,
  );
}

const mainPath = join(appDirectory, ".vite", "build", "main.js");
if (!existsSync(mainPath)) {
  fail("compiled main process is missing");
}
const compiledMain = readFileSync(mainPath, "utf8");
requireMarkers(
  compiledMain,
  [
    "Serial port open timed out",
    "Serial port open was superseded",
    "configuring-control-lines",
    "Unable to configure serial control lines",
    "Serial control-line setup timed out",
    "Stale serial connection close was rejected",
    "Invalid, stale, or closed serial connection",
    "hupcl",
    "rtscts",
    "dtr",
    "rts",
  ],
  "the compiled main-process serial lifecycle",
);
if (
  !compiledMain.includes(`NTRIP FlightCommander/${sourcePackage.version}`) ||
  !compiledMain.includes("ntripListMountpoints") ||
  !compiledMain.includes("NTRIP sourcetable") ||
  !compiledMain.includes("rtkBaseConnect")
) {
  fail(
    "the compiled main process does not contain the native NTRIP and independent RTK-base bridge",
  );
}

const rendererDirectory = join(appDirectory, ".vite", "renderer", "main_window");
if (!existsSync(rendererDirectory)) {
  fail("compiled renderer is missing");
}
const rendererFiles = activeRendererFiles(rendererDirectory);
const rendererStylesheets = activeRendererStylesheets(rendererDirectory);
const rendererText = [
  readFileSync(join(rendererDirectory, "index.html"), "utf8"),
  ...rendererFiles.map((file) => readFileSync(file, "utf8")),
  ...rendererStylesheets.map((file) => readFileSync(file, "utf8")),
].join("\n");

requireMarkers(
  rendererText,
  [
    "USB device may have reset or briefly re-enumerated",
    "serial link ended during MAVLink startup",
    "Serial link interrupted",
    "Unable to enumerate serial ports",
    "hadVehicleHeartbeat",
    "pendingReconnectRequest",
    "unexpectedTerminalOperatorGuardUntil",
  ],
  "the active renderer serial-recovery lifecycle",
);

for (const forbidden of [
  "INAV Configurator",
  "INAV-Configurator",
  "ArduPilot Firmware",
  "ArduPilot setup",
  "ArduPilot configuration",
  "Loading ArduPilot",
  "Open ArduPilot",
  "Official INAV Firmware",
  "Official INAV is connected in compatibility mode",
  "official-INAV compatibility",
  "INAV firmware remains supported",
  "official INAV and Flight Commander Firmware",
  "official INAV plus Flight Commander",
  "official INAV MAVLink commands",
  "commands disabled for official INAV",
  "live INAV-compatible telemetry",
  "Full inherited INAV configuration",
  "Unsupported firmware compatibility",
  "ArduPilot support has been removed",
  "ArduPilot is no longer supported",
  "tab_mavlink_parameters",
  "tab_autotune",
  "tab_ardupilot_setup",
  "tab_ardupilot_configuration",
  "tab_ardupilot_ports",
  "tab_ardupilot_outputs",
  "tab_ardupilot_receiver",
  "tab_ardupilot_modes",
  "tab_ardupilot_pid_tuning",
  "tab_ardupilot_advanced_tuning",
  "tab_ardupilot_gps_navigation",
  "tab_ardupilot_sensors",
  "tab_ardupilot_osd",
  "tab_ardupilot_logging",
  "tab_ardupilot_programming",
]) {
  if (rendererText.includes(forbidden)) {
    fail(`the active renderer still contains ${forbidden}`);
  }
}

for (const marker of [
  "Flight-Commander/",
  "Flight Commander",
  "MAVLink radio transport refreshed",
  "Waiting for vehicle heartbeat",
  "discovery-heartbeat-write-accepted",
  "serial-bytes-received",
  "valid-frame-decoded",
  "MAVLink transport startup failed",
  "A vehicle heartbeat was decoded, but Ground Control could not finish connecting",
  "handleConnectionAbort",
  "commandBlockReason",
  "validated MAVLink telemetry connection",
  "MAVLINK_SESSION_DETACHED",
  "MAVLink host timer",
  "MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES",
  "flight-commander-product-policy",
  "Auto protocol (selected baud)",
  "flightDataMapPane",
  "Make HUD major",
  "Switch Flight Commander's global display units between metric and imperial",
  "flightCommanderTheme",
  "flight-commander-theme-change",
  "data-motor-number-layout",
  "data-motor-prop-configuration",
  "quad_x_reverse",
  "quad_p_reverse",
  "data-motor-rotation",
  "Keep every current value and save only the first-run acknowledgement",
  "Selecting default control profile 1",
  "Control profile 1:",
  "Flight Commander Firmware is not responding after reboot",
  "Flight Commander Firmware did not respond after three post-reboot",
  "Flight Commander Firmware",
  "Online Flight Commander Firmware / Local HEX",
  "Online official and beta releases are verified",
  "Flight-Commander-Firmware-",
  "Online firmware downloaded and SHA-256 verified",
  "FCFW",
  "MICOAIR743",
  "MICROAIR743",
  "The published HEX does not contain the required FCFW firmware identity",
  "Firmware Capabilities",
  "Multirotor AutoTune",
  "Terrain-relative waypoints",
  "Mission streaming",
  "Start Mission",
  "Resume Mission",
  "Abort Mission",
  "Launch / Takeoff",
  "Return Home (RTH / RTL)",
  "The current Flight Commander Firmware does not expose a separately confirmable generic Land command",
  "Direct NTRIP → Aircraft",
  "Survey-in USB Base → Aircraft",
  "NTRIP-refined USB Base → Aircraft",
  "RTK2go public caster",
  "Load streams",
  "Start NTRIP refinement",
  "Finalize refined fixed base",
  "Calibrate this compass",
  "External / UART GPS-module compass",
  "u-blox F9P / F9-series (RTK Rover)",
  "DroneCAN GPS-module compass",
  "Active Flight Commander target magnetometer alignment and diagnostics",
  "MODULE FRONT",
  "Online selections are verified official or beta Flight Commander releases for the selected target",
  "Local HEX files are flashed exactly as selected",
  "Altitude (MSL)",
  "Flight Commander Output",
  "SETTINGS_REFERENCE.md",
  "Aircraft standby",
  "Capability bitmap",
  "nav_fw_pos_z_ff",
  "nav_fw_alt_control_response",
  "batteryProfileHighlightActive",
  "controlProfileHighlightActive",
]) {
  if (!rendererText.includes(marker)) {
    fail(`the active renderer does not contain ${marker}`);
  }
}
for (const retiredRuntime of [
  "legacy-msp-profile",
  "Load included Flight Commander Firmware",
  "Use Bundled Firmware",
  "is available online and bundled",
  "offline firmware copy",
  "MICOAIR743 onboard compass orientation must be corrected first",
  "Apply orientation, reset calibration, and reboot",
  "flightCommanderGroundControlMinorPosition",
  "flightDataMinorDragHandle",
  "Reset minor view",
  "Drag to move",
  "Restoring the selected control profile",
  "Selecting control profile 2",
  "Selecting control profile 3",
  "Control profile 2:",
  "Control profile 3:",
  "tab_ardupilot_setup",
  "tab_ardupilot_configuration",
  "tab_ardupilot_ports",
  "tab_ardupilot_outputs",
  "tab_ardupilot_receiver",
  "tab_ardupilot_modes",
  "tab_ardupilot_pid_tuning",
  "tab_ardupilot_advanced_tuning",
  "tab_ardupilot_gps_navigation",
  "tab_ardupilot_sensors",
  "tab_ardupilot_osd",
  "tab_ardupilot_logging",
  "tab_ardupilot_programming",
]) {
  if (rendererText.includes(retiredRuntime)) {
    fail(`the active renderer still contains retired runtime ${retiredRuntime}`);
  }
}

for (const requiredProtocol of [
  "INAV",
  "MSP2_FLIGHT_COMMANDER_INFO",
  "mspProtocolVersion",
]) {
  if (!rendererText.includes(requiredProtocol)) {
    fail(`the active renderer is missing inherited protocol ${requiredProtocol}`);
  }
}

const applicationStylesheet = rendererStylesheets
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
if (!applicationStylesheet.includes("color-scheme:dark")) {
  fail("the active renderer stylesheet is not dark-only");
}
if (applicationStylesheet.includes('data-theme="light"')) {
  fail("the active renderer stylesheet still contains a light theme branch");
}
for (const selector of [
  ".tab-landing .flightCommanderLogo",
  ".tab-firmware_flasher",
  ".tab-gps",
  ".tab-magnetometer",
  ".tab-ports",
  ".tab-pid_tuning",
  ".tab-calibration",
  ".tab-failsafe",
  ".tab-mixer",
  ".tab-cli",
  ".batteryProfileHighlightActive",
  ".controlProfileHighlightActive",
]) {
  if (!applicationStylesheet.includes(selector)) {
    fail(`the active renderer stylesheet is missing ${selector}`);
  }
}
const titleLogoDeclarations = ruleDeclarations(applicationStylesheet, "#logo");
if (!titleLogoDeclarations.some(hasFlightCommanderWordmark)) {
  fail("the title bar does not contain the Flight Commander wordmark");
}
const welcomeLogoDeclarations = ruleDeclarations(
  applicationStylesheet,
  ".tab-landing .flightCommanderLogo",
);
if (!welcomeLogoDeclarations.some(hasCompleteDarkWelcomeWordmark)) {
  fail("the dark Welcome page does not contain the complete Flight Commander wordmark");
}

const landingCss = applicationStylesheet;
for (const color of ["#17242b", "#131b21", "#edf3f6", "#37a8db"]) {
  if (!landingCss.includes(color)) {
    fail(`the dark Welcome page stylesheet is missing ${color}`);
  }
}

console.log(
  `Verified Flight Commander ${sourcePackage.version} Windows x64 package at ${packageDirectory}`,
);
console.log(`Renderer files: ${rendererFiles.length}`);
console.log(`Package files: ${packageFiles.length}`);
console.log("firmwareBundled: false");
