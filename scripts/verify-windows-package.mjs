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
const canonicalIcon = readFileSync(canonicalIconPath);
if (
  sha256(canonicalIcon) !==
  "0cd605edccc41fd9054c73c8ef93ad10c402a9939059d8acb8b21a25f4c21d08"
) {
  fail("the canonical Flight Commander Windows icon has changed unexpectedly");
}

const expectedIconImages = icoImages(canonicalIcon);
const executableIconImages = peIconImages(readFileSync(executable));
const expectedIconSignatures = expectedIconImages
  .map((image) => `${image.width}x${image.height}:${sha256(image.bytes)}`)
  .sort();
const executableIconSignatures = executableIconImages
  .map((image) => `${image.width}x${image.height}:${sha256(image.bytes)}`)
  .sort();
if (
  JSON.stringify(executableIconSignatures) !==
  JSON.stringify(expectedIconSignatures)
) {
  fail(
    "the embedded executable icon does not match the canonical " +
      "Flight Commander icon",
  );
}

const packagedManifest = JSON.parse(readFileSync(packagedManifestPath, "utf8"));
for (const field of ["name", "productName", "version"]) {
  if (packagedManifest[field] !== sourcePackage[field]) {
    fail(
      `packaged ${field} is ${JSON.stringify(packagedManifest[field])}; ` +
        `expected ${JSON.stringify(sourcePackage[field])}`,
    );
  }
}

const applicationFiles = filesBelow(appDirectory);
const packagedFirmwareFiles = applicationFiles.filter((path) => {
  const relativePath = relative(appDirectory, path).split(sep).join("/");
  return (
    /(^|\/)resources\/firmware(?:-source)?\//i.test(relativePath) ||
    /(^|\/)release\/firmware\//i.test(relativePath) ||
    /Flight-Commander-Firmware-.*\.hex$/i.test(relativePath) ||
    /Flight-Commander-Firmware-Source-.*\.zip$/i.test(relativePath)
  );
});
if (packagedFirmwareFiles.length > 0) {
  fail(
    "firmware must not be packaged with the Configurator: " +
      packagedFirmwareFiles.map((path) => relative(appDirectory, path)).join(", "),
  );
}
for (const requiredSuffix of [
  join(".vite", "build", "main.js"),
  join(".vite", "build", "preload.mjs"),
]) {
  if (!applicationFiles.some((path) => path.endsWith(requiredSuffix))) {
    fail(`compiled application file is missing: ${requiredSuffix}`);
  }
}

const compiledMainPath = join(appDirectory, ".vite", "build", "main.js");
const compiledMain = readFileSync(compiledMainPath, "utf8");
if (!compiledMain.includes("Flight-Commander/")) {
  fail(
    "the compiled main process does not contain the Flight Commander user agent",
  );
}
if (compiledMain.includes("INAV-Configurator/")) {
  fail("the compiled main process still contains the retired INAV user agent");
}
if (compiledMain.includes("inav_icon_128")) {
  fail("the compiled main process still references the INAV application icon");
}
const runtimeIcon = readFileSync(
  join(projectRoot, "images", "flight_commander_256.png"),
);
if (!compiledMain.includes(runtimeIcon.toString("base64"))) {
  fail(
    "the compiled main process does not embed the Flight Commander runtime icon",
  );
}
if (
  !compiledMain.includes("Unable to configure serial control lines") ||
  !compiledMain.includes("Serial control-line setup timed out") ||
  !compiledMain.includes("dtr") ||
  !compiledMain.includes("rts") ||
  !compiledMain.includes("hupcl")
) {
  fail(
    "the compiled main process does not contain the Windows MAVLink DTR/RTS-low open setup",
  );
}
if (
  !compiledMain.includes("Serial port open timed out") ||
  !compiledMain.includes("Stale serial connection close was rejected") ||
  !compiledMain.includes("Serial port open was superseded by a newer connection") ||
  !compiledMain.includes("errorDetails") ||
  !compiledMain.includes("configuring-control-lines")
) {
  fail(
    "the compiled main process does not contain bounded, connection-scoped serial lifecycle handling",
  );
}
if (
  !compiledMain.includes(`NTRIP FlightCommander/${sourcePackage.version}`) ||
  !compiledMain.includes("ntripListMountpoints") ||
  !compiledMain.includes("NTRIP sourcetable") ||
  !compiledMain.includes("rtkBaseConnect")
) {
  fail(
    "the compiled main process does not contain native NTRIP and USB RTK-base services",
  );
}

const rendererDirectory = join(
  appDirectory,
  ".vite",
  "renderer",
  "main_window",
);
const rendererEntryHtml = readFileSync(
  join(rendererDirectory, "index.html"),
  "utf8",
);
for (const label of [
  "Auto protocol (selected baud)",
  "Ground Control / MAVLink",
]) {
  if (!rendererEntryHtml.includes(label)) {
    fail(`the active renderer entry does not contain ${label}`);
  }
}
const rendererFiles = activeRendererFiles(rendererDirectory);
if (rendererFiles.length === 0) {
  fail("the compiled main-window renderer is missing");
}

const rendererStylesheets = activeRendererStylesheets(rendererDirectory);
const rendererCss = rendererStylesheets
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
if (!/<html\b[^>]*data-theme=["']dark["']/i.test(rendererEntryHtml)) {
  fail("the active renderer entry is not initialized as dark-only");
}
if (/id=["']applicationTheme["']|fc-theme-switch/i.test(rendererEntryHtml)) {
  fail("the dark-only renderer still contains a light/dark theme switch");
}
if (/data-theme=["']light["']|\.fc-theme-switch/.test(rendererCss)) {
  fail("the active renderer CSS still packages a light-theme or theme-switch surface");
}
for (const selector of [
  "#logo",
  ".tab-cli .backdrop",
  "#content-watermark",
]) {
  const declarations = ruleDeclarations(rendererCss, selector);
  if (declarations.length === 0) {
    fail(`the active renderer CSS does not contain ${selector}`);
  }
  if (!declarations.some(hasFlightCommanderWordmark)) {
    fail(`${selector} does not render the Flight Commander wordmark`);
  }
}
const welcomeLogoDeclarations = ruleDeclarations(
  rendererCss,
  ".tab-landing .flightCommanderLogo",
);
if (welcomeLogoDeclarations.length === 0) {
  fail(
    "the active renderer CSS does not contain the welcome Flight Commander logo",
  );
}
if (!hasCompleteDarkWelcomeWordmark(welcomeLogoDeclarations.at(-1) ?? "")) {
  fail(
    "the dark-only welcome surface does not end with the complete dark-background Flight Commander wordmark",
  );
}
const welcomeTaglineDeclarations = ruleDeclarations(
  rendererCss,
  ".tab-landing .flightCommanderTagline",
);
if (welcomeTaglineDeclarations.length === 0) {
  fail("the dark-only welcome tagline style is missing");
}
if (rendererCss.includes(".inavLogo{")) {
  fail("the active renderer CSS still contains the retired INAV logo selector");
}
for (const selector of [
  ".fc-firmware-identity",
  ".fc-firmware-feature",
  ".fc-firmware-feature--enabled",
  ".fc-flight-visuals",
  ".fc-live-pane",
  ".compass-calibration-card",
  ".rtk-workflow-option",
  ".mixer-preview-image-numbers .motorNumber",
  ".batteryProfileHighlightActive",
  ".controlProfileHighlightActive",
  ".heading-calibration-location",
]) {
  if (ruleDeclarations(rendererCss, selector).length === 0) {
    fail(`the active renderer CSS does not contain ${selector}`);
  }
}

const rendererText = [
  rendererEntryHtml,
  ...rendererFiles.map((path) => readFileSync(path, "utf8")),
].join("\n");

const flightCommanderDocumentationUrl =
  "https://github.com/srt3262/Flight-Commander/tree/main/docs";
const retiredInavDocumentationUrl =
  /https:\/\/github\.com\/iNavFlight/;
const documentationUrlOccurrences =
  rendererText.split(flightCommanderDocumentationUrl).length - 1;
if (documentationUrlOccurrences < 2) {
  fail(
    "the active renderer does not route both Documentation & Support surfaces " +
      "to Flight Commander documentation",
  );
}
if (retiredInavDocumentationUrl.test(rendererText)) {
  fail(
    "the active renderer still contains an upstream INAV documentation/support route",
  );
}

for (const contract of [
  {
    stem: "quad_x",
    configuration: "in",
    rotations: "1:CW;2:CCW;3:CCW;4:CW",
  },
  {
    stem: "quad_x_reverse",
    configuration: "out",
    rotations: "1:CCW;2:CW;3:CW;4:CCW",
  },
  {
    stem: "quad_p",
    configuration: "in",
    rotations: "1:CW;2:CCW;3:CCW;4:CW",
  },
  {
    stem: "quad_p_reverse",
    configuration: "out",
    rotations: "1:CCW;2:CW;3:CW;4:CCW",
  },
]) {
  const chunkPattern = new RegExp(`^${contract.stem}-[A-Za-z0-9_-]+\\.js$`);
  const chunk = rendererFiles.find((path) => chunkPattern.test(basename(path)));
  if (!chunk) {
    fail(`the active renderer is missing the ${contract.stem} motor-diagram module`);
  }
  const declaration = readFileSync(chunk, "utf8");
  const encodedSvg = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(declaration)?.[1];
  if (!encodedSvg) {
    fail(`${contract.stem} does not export an inline SVG diagram`);
  }
  const svg = Buffer.from(encodedSvg, "base64").toString("utf8");
  if (!svg.includes(`data-props-configuration="${contract.configuration}"`)) {
    fail(`${contract.stem} has the wrong Props-in/Props-out diagram identity`);
  }
  if (!svg.includes(`data-motor-rotations="${contract.rotations}"`)) {
    fail(`${contract.stem} has the wrong INAV motor rotation order`);
  }
}

for (const marker of [
  "flightDataMap",
  "flightDataHud",
  "flightDataMapPane",
  "flightDataHudPane",
  "Make HUD major",
  "Switch Flight Commander's global display units between metric and imperial",
  "flightCommanderTheme",
  "flight-commander-theme-change",
  'Multirotor with 10" propellers',
  'Multirotor with 12" propellers',
  'Multirotor with 15" propellers',
  'Multirotor with 17" propellers',
  "generated roll P/I/D/FF",
  "ez_snappiness",
  "miles per hour",
  "#31523b",
  "#172a20",
  "plannerInavMissionRestart",
  "connectionBaudPreferencesByProtocol",
  "forceDtrLow",
  "Waiting for vehicle heartbeat",
  "MAVLink serial transport is open",
  "discovery-heartbeat-write-accepted",
  "serial-bytes-received",
  "valid-frame-decoded",
  "MAVLink transport startup failed",
  "A vehicle heartbeat was decoded, but Ground Control could not finish connecting",
  "The USB device may have reset or briefly re-enumerated",
  "The serial link ended during MAVLink startup",
  "MAVLink / Serial link interrupted",
  "PortHandler - Unable to enumerate serial ports",
  "handleConnectionAbort",
  "hadVehicleHeartbeat",
  "pendingReconnectRequest",
  "unexpectedTerminalOperatorGuardUntil",
  "commandBlockReason",
  "validated MAVLink telemetry connection",
  "MAVLINK_SESSION_DETACHED",
  "MAVLink host timer",
  "supported controls unlock after identification and safety checks",
  "data-motor-number-layout",
  "data-motor-prop-configuration",
  "selected-preset",
  "Keep every current value and save only the first-run acknowledgement",
  "Preset compatibility: skipped optional settings",
  "No preset values were written to the controller",
  "Selecting default control profile 1",
  "Control profile 1:",
  "INAV is not responding after reboot",
  "INAV did not respond after three post-reboot",
  "Flight Commander Firmware",
  "Official INAV Firmware",
  "Flight-Commander-Firmware-",
  "Online firmware downloaded and SHA-256 verified",
  "FCFW",
  "MICOAIR743",
  "MICROAIR743",
  "Select Flight Commander Firmware before flashing it",
  "Firmware Capabilities",
  "Official INAV is connected in compatibility mode",
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
  "Active INAV target magnetometer alignment and diagnostics",
  "MODULE FRONT",
  "Flash only firmware built for the detected controller target",
  "Altitude (MSL)",
  "Flight Commander Output",
  "SETTINGS_REFERENCE.md",
  "Aircraft standby",
  "Capability bitmap",
  "ArduPilot support has been removed",
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
  "tab_ardupilot_javascript_programming",
  "tab_ardupilot_cli",
  "tab_ardupilot_search",
  "ArduPilot extras",
  "Complete native fallback",
  "plannerArduPilotMissionRestart",
  "MavlinkParameterManager",
  "mavlinkFtpClient",
  "mavlinkLogManager",
  "ARDUPILOT_SCRIPT_PATH",
]) {
  if (rendererText.includes(retiredRuntime)) {
    fail(`the active renderer still contains retired runtime ${retiredRuntime}`);
  }
}
if (rendererText.includes("tab_mission_control")) {
  fail("the retired duplicate Mission Control tab is still bundled");
}

const serialBindings = applicationFiles.filter(
  (path) =>
    path.endsWith(".node") && path.includes(join("prebuilds", "win32-x64")),
);
if (serialBindings.length !== 1) {
  fail(
    `expected exactly one Windows x64 native serial binding; found ${serialBindings.length}`,
  );
}
for (const binding of serialBindings) {
  if (peMachine(binding) !== 0x8664) {
    fail(`native serial binding is not Windows x64: ${binding}`);
  }
}

const foreignSerialBindings = applicationFiles.filter(
  (path) =>
    path.endsWith(".node") &&
    path.includes(join("@serialport", "bindings-cpp", "prebuilds")) &&
    !path.includes(join("prebuilds", "win32-x64")),
);
if (foreignSerialBindings.length > 0) {
  fail(
    `the Windows package contains ${foreignSerialBindings.length} foreign-architecture ` +
      "serial binding(s), which can trigger Windows extraction path failures",
  );
}

const packageRelativeFiles = filesBelow(packageDirectory).map((path) =>
  relative(packageDirectory, path),
);
const longestPackagePath = packageRelativeFiles.reduce(
  (longest, path) => (path.length > longest.length ? path : longest),
  "",
);
if (longestPackagePath.length > 140) {
  fail(
    `the longest packaged path is ${longestPackagePath.length} characters; ` +
      `the Windows extraction budget is 140: ${longestPackagePath}`,
  );
}

console.log(
  JSON.stringify(
    {
      productName: packagedManifest.productName,
      version: packagedManifest.version,
      platform: "win32",
      architecture: "x64",
      executableBytes: statSync(executable).size,
      executableIconImages: executableIconImages.length,
      rendererBundles: rendererFiles.length,
      rendererStylesheets: rendererStylesheets.length,
      serialBindings: serialBindings.length,
      longestPackagePathCharacters: longestPackagePath.length,
      firmwareBundled: false,
      packageDirectory,
    },
    null,
    2,
  ),
);
