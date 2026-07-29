import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
      rendererBundles: rendererFiles.length,
      serialBindings: serialBindings.length,
      packageDirectory,
    },
    null,
    2,
  ),
);
