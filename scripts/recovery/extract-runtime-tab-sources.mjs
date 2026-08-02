#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] ?? "");
const projectRoot = path.resolve(process.argv[3] ?? process.cwd());
const assetsRoot = path.join(
  runtimeRoot,
  "resources",
  "app",
  ".vite",
  "renderer",
  "main_window",
  "assets",
);

if (!fs.existsSync(assetsRoot)) {
  throw new Error(
    `Flight Commander renderer assets were not found at ${assetsRoot}`,
  );
}

const recoveredTabs = new Map([
  ["advanced_tuning.html", "advanced_tuning"],
  ["firmware_flasher.html", "firmware_flasher"],
  ["firmware_flasher.js", "firmware_flasher"],
  ["flight_data.html", "flight_data"],
  ["flight_data.js", "flight_data"],
  ["flight_planner.html", "flight_planner"],
  ["flight_planner.js", "flight_planner"],
  ["landing.html", "landing"],
  ["options.html", "options"],
]);

async function rawModuleContents(filePath) {
  const moduleUrl = `${pathToFileURL(filePath).href}?recovery=${Date.now()}`;
  const loaded = await import(moduleUrl);
  if (typeof loaded.default !== "string") {
    throw new Error(`${path.basename(filePath)} is not a Vite raw-text module`);
  }
  return loaded.default;
}

async function findRawAsset(stem, extension) {
  const candidates = fs
    .readdirSync(assetsRoot)
    .filter((name) => name.startsWith(`${stem}-`) && name.endsWith(".js"))
    .sort();

  const matches = [];
  for (const candidate of candidates) {
    const candidatePath = path.join(assetsRoot, candidate);
    const header = fs.readFileSync(candidatePath, "utf8").slice(0, 96);
    if (!/^const\s+[\w$]+\s*=\s*[`'"]/.test(header)) continue;

    try {
      const contents = await rawModuleContents(candidatePath);
      const detectedExtension = contents.trimStart().startsWith("<")
        ? ".html"
        : ".js";
      if (detectedExtension === extension) {
        matches.push({ candidate, contents });
      }
    } catch {
      // Non-raw Vite chunks are deliberately ignored.
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${stem}${extension} raw module, found ${matches.length}: ` +
        matches.map(({ candidate }) => candidate).join(", "),
    );
  }
  return matches[0];
}

const manifest = [];
for (const [targetName, stem] of recoveredTabs) {
  const extension = path.extname(targetName);
  const recovered = await findRawAsset(stem, extension);
  const targetPath = path.join(projectRoot, "tabs", targetName);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, recovered.contents, "utf8");
  manifest.push({
    target: path.relative(projectRoot, targetPath),
    runtimeAsset: recovered.candidate,
    bytes: Buffer.byteLength(recovered.contents),
  });
}

for (const assetName of ["flight_hud-v1.3.5.js", "flight_hud-v1.3.5.css"]) {
  const sourcePath = path.join(assetsRoot, assetName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Recovered HUD asset is missing: ${sourcePath}`);
  }
  const targetPath = path.join(projectRoot, "tabs", assetName);
  fs.copyFileSync(sourcePath, targetPath);
  manifest.push({
    target: path.relative(projectRoot, targetPath),
    runtimeAsset: assetName,
    bytes: fs.statSync(targetPath).size,
  });
}

const runtimeIndexPath = path.join(
  runtimeRoot,
  "resources",
  "app",
  ".vite",
  "renderer",
  "main_window",
  "index.html",
);
let recoveredIndex = fs.readFileSync(runtimeIndexPath, "utf8");
recoveredIndex = recoveredIndex
  .replace(
    /\s*<script type="module" crossorigin src="\.\/assets\/index-[^"]+\.js"><\/script>/,
    "",
  )
  .replace(
    /\s*<link rel="stylesheet" crossorigin href="\.\/assets\/index-[^"]+\.css">/,
    "",
  )
  .replace(
    '<link rel="stylesheet" href="./assets/flight_hud-v1.3.5.css">',
    '<link rel="stylesheet" href="/tabs/flight_hud-v1.3.5.css">',
  )
  .replace(
    "</body>",
    '    <script type="module" src="/js/configurator_main.js"></script>\n</body>',
  );

const indexTargetPath = path.join(projectRoot, "index.html");
fs.writeFileSync(indexTargetPath, recoveredIndex, "utf8");
manifest.push({
  target: path.relative(projectRoot, indexTargetPath),
  runtimeAsset: path.relative(runtimeRoot, runtimeIndexPath),
  bytes: Buffer.byteLength(recoveredIndex),
});

const localeNames = ["bg", "de", "en", "ja", "ru", "uk", "zh_CN"];
const localeCandidates = localeNames.map((locale) => {
  const targetPath = path.join(projectRoot, "locale", locale, "messages.json");
  return {
    locale,
    targetPath,
    messages: JSON.parse(fs.readFileSync(targetPath, "utf8")),
  };
});

const messageAssets = fs
  .readdirSync(assetsRoot)
  .filter((name) => name.startsWith("messages-") && name.endsWith(".js"))
  .filter((name) => {
    const header = fs
      .readFileSync(path.join(assetsRoot, name), "utf8")
      .slice(0, 96);
    return /^const\s+[\w$]+\s*=\s*[`'"]/.test(header);
  })
  .sort();

for (const messageAsset of messageAssets) {
  const sourcePath = path.join(assetsRoot, messageAsset);
  const contents = await rawModuleContents(sourcePath);
  const recoveredMessages = JSON.parse(contents);
  const scored = localeCandidates
    .map((candidate) => {
      let compared = 0;
      let equal = 0;
      for (const [key, value] of Object.entries(recoveredMessages)) {
        if (key === "mainLogoText") continue;
        compared += 1;
        if (JSON.stringify(value) === JSON.stringify(candidate.messages[key])) {
          equal += 1;
        }
      }
      return { ...candidate, equal, compared };
    })
    .sort((left, right) => right.equal - left.equal);

  const match = scored[0];
  if (!match || match.equal / Math.max(1, match.compared) < 0.9) {
    throw new Error(`Could not identify the locale for ${messageAsset}`);
  }
  fs.writeFileSync(match.targetPath, contents, "utf8");
  manifest.push({
    target: path.relative(projectRoot, match.targetPath),
    runtimeAsset: messageAsset,
    bytes: Buffer.byteLength(contents),
  });
}

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
