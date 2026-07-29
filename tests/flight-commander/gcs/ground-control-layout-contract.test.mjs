import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const groundControlHtml = readFileSync(
  resolve(projectRoot, "tabs/flight_data.html"),
  "utf8",
);
const hudCssSource = readFileSync(
  resolve(projectRoot, "tabs/flight_hud-v1.3.5.css"),
  "utf8",
);
const mainProcessSource = readFileSync(
  resolve(projectRoot, "js/main/main.js"),
  "utf8",
);

const hudCss = hudCssSource
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ")
  .trim();

function ruleBody(selector) {
  const selectorIndex = hudCss.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `missing CSS selector: ${selector}`);
  const openingBrace = hudCss.indexOf("{", selectorIndex + selector.length);
  assert.notEqual(openingBrace, -1, `missing opening brace for: ${selector}`);
  const closingBrace = hudCss.indexOf("}", openingBrace + 1);
  assert.notEqual(closingBrace, -1, `missing closing brace for: ${selector}`);
  return hudCss.slice(openingBrace + 1, closingBrace).trim();
}

function expectDeclarations(body, declarations, label) {
  for (const declaration of declarations) {
    assert.ok(
      body.includes(declaration),
      `${label} must include "${declaration}", received "${body}"`,
    );
  }
}

function shortHeightBudget({ width, height }) {
  const compactNavigation = width <= 1055;
  const compactHeight = height <= 850;
  const contentWidth = width - (compactNavigation ? 60 : 200);
  const contentHeight = height - (compactNavigation ? 151 : 145);
  const wrapperPadding = compactHeight ? 16 : 24;
  const rowGaps = compactHeight ? 30 : 40;
  const titleHeight = compactHeight ? 0 : 24;
  const toolbarHeight = compactHeight ? 42 : 52;
  const commandDeckHeight = compactHeight ? 78 : 60;
  const statusHeight = compactHeight ? 50 : 72;
  const actionHeight = compactHeight ? 18 : 36;
  const flightHeight =
    contentHeight -
    wrapperPadding -
    rowGaps -
    titleHeight -
    toolbarHeight -
    commandDeckHeight -
    statusHeight -
    actionHeight;
  const flightGap = width <= 1050 ? 7 : 10;
  const availableFlightWidth = contentWidth - wrapperPadding - flightGap;
  const telemetryRatio = width <= 1050 ? 0.92 : width <= 1180 ? 0.95 : 0.92;
  const mapRatio = width <= 1050 ? 1.5 : width <= 1180 ? 1.55 : 1.72;
  const telemetryWidth =
    availableFlightWidth * (telemetryRatio / (telemetryRatio + mapRatio));
  const telemetryCardWidth = (telemetryWidth - 12) / 3;
  const telemetryCardHeight = (flightHeight - 24) / 5;
  const mapToolbarHeight = compactHeight ? 34 : 45;

  return {
    contentWidth,
    contentHeight,
    flightHeight,
    telemetryCardWidth,
    telemetryCardHeight,
    visualHeight: flightHeight - mapToolbarHeight,
  };
}

test("Ground Control source exposes all fifteen telemetry values", () => {
  const cardPattern =
    /<div class="fc-card(?: [^"]*)?"><span>([^<]+)<\/span><strong id="([^"]+)">/g;
  const cards = [...groundControlHtml.matchAll(cardPattern)].map((match) => ({
    label: match[1],
    id: match[2],
  }));

  assert.equal(cards.length, 15);
  assert.equal(new Set(cards.map(({ id }) => id)).size, 15);
  assert.deepEqual(
    cards.map(({ label }) => label),
    [
      "Mode",
      "Relative altitude",
      "Ground speed",
      "Air speed",
      "Heading",
      "Climb",
      "GPS",
      "Battery",
      "Roll",
      "Pitch",
      "Latitude",
      "Longitude",
      "Mission state",
      "Mission progress",
      "Next waypoint",
    ],
  );
  assert.match(
    groundControlHtml,
    /id="flightDataVisuals"[^>]*data-primary="map"/,
  );
  assert.match(
    groundControlHtml,
    /id="flightDataPrimaryView"[\s\S]*?aria-pressed="false"[\s\S]*?>Expand HUD<\/button>/,
  );
});

test("map-primary and HUD-primary CSS both retain a major and inset view", () => {
  const primarySelector =
    '.fc-flight-visuals[data-primary="map"] .fc-map-surface, ' +
    '.fc-flight-visuals[data-primary="hud"] .fc-hud-surface';
  const insetSelector =
    '.fc-flight-visuals[data-primary="map"] .fc-hud-surface, ' +
    '.fc-flight-visuals[data-primary="hud"] .fc-map-surface';
  const primaryBody = ruleBody(primarySelector);
  const insetBody = ruleBody(insetSelector);

  expectDeclarations(
    primaryBody,
    ["inset: 0;", "z-index: 1;", "width: auto;", "height: auto;"],
    "primary view",
  );
  expectDeclarations(
    insetBody,
    [
      "z-index: 3;",
      "width: clamp(270px, 39%, 410px);",
      "height: clamp(190px, 43%, 275px);",
      "border: 2px solid",
    ],
    "inset view",
  );

  for (const primary of ["map", "hud"]) {
    const majorSurface =
      primary === "map" ? ".fc-map-surface" : ".fc-hud-surface";
    const insetSurface =
      primary === "map" ? ".fc-hud-surface" : ".fc-map-surface";
    assert.ok(
      primarySelector.includes(`[data-primary="${primary}"] ${majorSurface}`),
      `${primary}-primary major surface`,
    );
    assert.ok(
      insetSelector.includes(`[data-primary="${primary}"] ${insetSurface}`),
      `${primary}-primary inset surface`,
    );
  }
});

test("supported Ground Control layout is fixed-height and only messages scroll internally", () => {
  expectDeclarations(
    ruleBody(".tab-flight-data"),
    ["height: 100%;", "min-height: 0;", "overflow: hidden;"],
    "Ground Control root",
  );
  expectDeclarations(
    ruleBody(".tab-flight-data .content_wrapper"),
    [
      "display: grid;",
      "grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;",
      "height: 100%;",
      "min-height: 0;",
      "overflow: hidden;",
    ],
    "Ground Control wrapper",
  );
  expectDeclarations(
    ruleBody(".tab-flight-data .fc-flight-layout"),
    ["height: 100%;", "min-height: 0;", "overflow: hidden;"],
    "flight workspace",
  );
  expectDeclarations(
    ruleBody(".tab-flight-data .fc-telemetry-grid"),
    [
      "grid-template-columns: repeat(3, minmax(100px, 1fr));",
      "grid-template-rows: repeat(5, minmax(0, 1fr));",
      "height: 100%;",
    ],
    "telemetry grid",
  );
  expectDeclarations(
    ruleBody(".tab-flight-data .fc-card strong"),
    [
      "overflow-wrap: anywhere;",
      "white-space: normal;",
      "font-size: clamp(12px, 1vw, 16px);",
    ],
    "telemetry value",
  );
  expectDeclarations(
    ruleBody(".tab-flight-data .fc-message-log"),
    ["max-height: 58px;", "overflow: auto;"],
    "autopilot message log",
  );

  const fallbackHeader = "@media (max-width: 900px), (max-height: 640px)";
  const fallbackIndex = hudCss.indexOf(fallbackHeader);
  assert.notEqual(
    fallbackIndex,
    -1,
    "missing below-minimum scrolling fallback",
  );
  const fallbackSource = hudCss.slice(fallbackIndex);
  assert.ok(fallbackSource.includes("overflow-y: auto;"));
});

test("main window enforces the 1024 by 720 no-scroll operating minimum", () => {
  const browserWindow = mainProcessSource.match(
    /mainWindow\s*=\s*new BrowserWindow\(\{([\s\S]*?)\n\s*\}\);/,
  );
  assert.ok(browserWindow, "main BrowserWindow configuration is unavailable");

  const minimumWidth = Number(browserWindow[1].match(/minWidth:\s*(\d+)/)?.[1]);
  const minimumHeight = Number(
    browserWindow[1].match(/minHeight:\s*(\d+)/)?.[1],
  );
  assert.equal(minimumWidth, 1024);
  assert.equal(minimumHeight, 720);

  const runtimeMinimums = [
    ...mainProcessSource.matchAll(/setMinimumSize\(\s*(\d+)\s*,\s*(\d+)\s*\)/g),
  ];
  for (const [, width, height] of runtimeMinimums) {
    assert.ok(
      Number(width) >= minimumWidth && Number(height) >= minimumHeight,
      `runtime minimum ${width}x${height} weakens the no-scroll operating minimum`,
    );
  }

  const fallback = hudCss.match(
    /@media \(max-width: (\d+)px\), \(max-height: (\d+)px\)/,
  );
  assert.ok(fallback, "below-minimum layout fallback is unavailable");
  assert.ok(Number(fallback[1]) < minimumWidth);
  assert.ok(Number(fallback[2]) < minimumHeight);
});

test("the 1024 by 720 CSS budget retains readable telemetry in both primary layouts", () => {
  const minimumWindow = { width: 1024, height: 720 };
  const budget = shortHeightBudget(minimumWindow);

  for (const primary of ["map", "hud"]) {
    assert.ok(budget.contentWidth > 0, `${primary}: content width`);
    assert.ok(budget.contentHeight > 0, `${primary}: content height`);
    assert.ok(
      budget.flightHeight >= 290,
      `${primary}: flight workspace height`,
    );
    assert.ok(budget.visualHeight >= 235, `${primary}: major view height`);
    assert.ok(
      budget.telemetryCardWidth >= 100,
      `${primary}: telemetry card width`,
    );
    assert.ok(
      budget.telemetryCardHeight >= 50,
      `${primary}: telemetry card height`,
    );
  }

  const widestRepresentativeValueAt14Px = 139.4;
  const fontSize = 12;
  const textWidth = widestRepresentativeValueAt14Px * (fontSize / 14);
  const innerWidth = budget.telemetryCardWidth - 16;
  const requiredLines = Math.ceil(textWidth / innerWidth);
  const requiredHeight = 10 + 2 + requiredLines * fontSize * 1.15 + 10;
  assert.ok(requiredLines <= 2);
  assert.ok(budget.telemetryCardHeight >= requiredHeight);
});
