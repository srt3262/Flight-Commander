import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
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

const rendererDirectory = join(
  appDirectory,
  ".vite",
  "renderer",
  "main_window",
);
const rendererFiles = activeRendererFiles(rendererDirectory);
if (rendererFiles.length === 0) {
  fail("the compiled main-window renderer is missing");
}

const rendererStylesheets = activeRendererStylesheets(rendererDirectory);
const rendererCss = rendererStylesheets
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const selector of [
  "#logo",
  ".tab-landing .flightCommanderLogo",
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
if (rendererCss.includes(".inavLogo{")) {
  fail("the active renderer CSS still contains the retired INAV logo selector");
}

const rendererText = rendererFiles
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const marker of [
  "flightDataMap",
  "flightDataHud",
  "plannerCameraCommandMode",
  "plannerInavMissionRestart",
  "plannerArduPilotMissionRestart",
]) {
  if (!rendererText.includes(marker)) {
    fail(`the active renderer does not contain ${marker}`);
  }
}
if (rendererText.includes("tab_mission_control")) {
  fail("the retired duplicate Mission Control tab is still bundled");
}

const serialBindings = applicationFiles.filter(
  (path) =>
    path.endsWith(".node") && path.includes(join("prebuilds", "win32-x64")),
);
if (serialBindings.length === 0) {
  fail("the Windows x64 native serial binding is missing");
}
for (const binding of serialBindings) {
  if (peMachine(binding) !== 0x8664) {
    fail(`native serial binding is not Windows x64: ${binding}`);
  }
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
      packageDirectory,
    },
    null,
    2,
  ),
);
