import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const groundControlHtml = readFileSync(resolve(projectRoot, 'tabs/flight_data.html'), 'utf8');
const hudCssSource = readFileSync(resolve(projectRoot, 'tabs/flight_hud-v1.3.5.css'), 'utf8');
const groundControlSource = readFileSync(resolve(projectRoot, 'tabs/flight_data.js'), 'utf8');
const rtkHtml = readFileSync(resolve(projectRoot, 'tabs/rtk_base.html'), 'utf8');
const rtkSource = readFileSync(resolve(projectRoot, 'tabs/rtk_base.js'), 'utf8');
const hudSource = readFileSync(resolve(projectRoot, 'tabs/flight_hud-v1.3.5.js'), 'utf8');
const indexSource = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
const guiSource = readFileSync(resolve(projectRoot, 'js/gui.js'), 'utf8');
const mainProcessSource = readFileSync(resolve(projectRoot, 'js/main/main.js'), 'utf8');

const hudCss = hudCssSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function ruleBody(selector) {
  const selectorIndex = hudCss.indexOf(`${selector} {`);
  assert.notEqual(selectorIndex, -1, `missing CSS selector: ${selector}`);
  const openingBrace = hudCss.indexOf('{', selectorIndex + selector.length);
  assert.notEqual(openingBrace, -1, `missing opening brace for: ${selector}`);
  const closingBrace = hudCss.indexOf('}', openingBrace + 1);
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

test('Ground Control exposes all telemetry below two persistent side-by-side panes', () => {
  const cardPattern =
    /<div class="fc-card(?: [^"]*)?"><span>([^<]+)<\/span><strong id="([^"]+)">/g;
  const cards = [...groundControlHtml.matchAll(cardPattern)].map((match) => ({
    label: match[1],
    id: match[2],
  }));
  assert.equal(cards.length, 15);
  assert.equal(new Set(cards.map(({ id }) => id)).size, 15);
  assert.deepEqual(cards.map(({ label }) => label), [
    'Mode',
    'Relative altitude',
    'Ground speed',
    'Air speed',
    'Heading',
    'Climb',
    'GPS',
    'Battery',
    'Roll',
    'Pitch',
    'Latitude',
    'Longitude',
    'Mission state',
    'Mission progress',
    'Next waypoint',
  ]);

  assert.match(groundControlHtml, /id="flightDataVisuals"[^>]*data-primary="map"/);
  assert.match(
    groundControlHtml,
    /id="flightDataPrimaryView"[\s\S]*?aria-controls="flightDataVisuals"[\s\S]*?aria-pressed="false"[\s\S]*?>Make HUD major<\/button>/,
  );
  assert.match(
    groundControlHtml,
    /id="flightDataVisuals"[\s\S]*?id="flightDataMapPane"[\s\S]*?id="flightDataMapSurface"[\s\S]*?id="flightDataHudPane"[\s\S]*?id="flightDataHud"/,
  );
  assert.doesNotMatch(groundControlHtml, /flightDataFloatingLayer|flightDataMinorWindow|flightDataMinorDragHandle/);

  const visualsIndex = groundControlHtml.indexOf('id="flightDataVisuals"');
  const telemetryIndex = groundControlHtml.indexOf('class="fc-telemetry-grid"');
  const rtkIndex = groundControlHtml.indexOf('id="flightDataRtkMount"');
  assert.ok(visualsIndex < telemetryIndex, 'telemetry must follow the two live views');
  assert.ok(telemetryIndex < rtkIndex, 'RTK setup must follow telemetry in scroll order');
});

test('major and minor panes use grid columns and never overlap', () => {
  expectDeclarations(
    ruleBody('.fc-flight-visuals'),
    [
      'display: grid;',
      'grid-template-columns: minmax(250px, 0.8fr) minmax(430px, 1.8fr);',
      'gap: 8px;',
    ],
    'live view grid',
  );
  expectDeclarations(
    ruleBody('.fc-live-pane'),
    ['display: flex;', 'min-width: 0;', 'overflow: hidden;'],
    'live pane',
  );
  const surfaces = ruleBody('.fc-map-surface, .fc-hud-surface');
  expectDeclarations(surfaces, ['position: relative;', 'flex: 1 1 auto;', 'overflow: hidden;'], 'live surfaces');
  assert.equal(surfaces.includes('position: absolute;'), false);
  assert.doesNotMatch(hudCssSource, /\.fc-minor-view-layer|\.fc-minor-view-window/);
  assert.match(hudCssSource, /\[data-primary="map"\] \.fc-live-pane--hud[\s\S]*?order:\s*1/);
  assert.match(hudCssSource, /\[data-primary="hud"\] \.fc-live-pane--map[\s\S]*?order:\s*1/);

  assert.match(hudSource, /mapPane\.dataset\.role = hudPrimary \? 'minor' : 'major'/);
  assert.match(hudSource, /hudPane\.dataset\.role = hudPrimary \? 'major' : 'minor'/);
  assert.doesNotMatch(hudSource, /appendChild\(primarySurface\)|pointerdown|setPointerCapture/);
});

test('telemetry fits under both views while RTK is reached by normal page scrolling', () => {
  expectDeclarations(
    ruleBody('.tab-flight-data'),
    ['height: 100%;', 'overflow-x: hidden;', 'overflow-y: auto;'],
    'Ground Control scroll root',
  );
  expectDeclarations(
    ruleBody('.tab-flight-data .content_wrapper'),
    ['display: flex;', 'flex-direction: column;', 'min-height: 100%;'],
    'Ground Control content',
  );
  expectDeclarations(
    ruleBody('.tab-flight-data .fc-telemetry-grid'),
    ['display: grid;', 'grid-template-columns: repeat(8, minmax(90px, 1fr));'],
    'desktop telemetry grid',
  );
  expectDeclarations(
    ruleBody('.tab-flight-data .fc-card'),
    ['min-height: 54px;', 'padding: 6px 8px;', 'overflow: hidden;'],
    'compact telemetry card',
  );
  expectDeclarations(
    ruleBody('.fc-rtk-mount'),
    ['min-width: 0;', 'scroll-margin-top: 10px;'],
    'embedded RTK mount',
  );
  assert.match(groundControlHtml, /href="#flightDataRtk">RTK setup ↓<\/a>/);
});

test('Ground Control owns RTK setup and remains available with the aircraft offline', () => {
  assert.match(groundControlSource, /import rtkBasePanel from ['"]\.\/rtk_base['"]/);
  assert.match(
    groundControlSource,
    /rtkBasePanel\.mount\('#flightDataRtkMount',\s*\{[\s\S]*?unitSystem: this\.unitSystem/,
  );
  assert.match(groundControlSource, /if \(!this\.protocol \|\| !CONFIGURATOR\.connectionValid\)/);
  assert.match(groundControlSource, /Offline setup mode/);

  const disconnectedMenu = indexSource.match(
    /<ul class="mode-disconnected">([\s\S]*?)<\/ul>/,
  )?.[1] ?? '';
  assert.match(disconnectedMenu, /tab_flight_data/);
  assert.doesNotMatch(indexSource, /tab_rtk_base/);
  const disconnectedTabs = guiSource.match(
    /defaultAllowedTabsWhenDisconnected\s*=\s*\[([\s\S]*?)\]/,
  )?.[1] ?? '';
  assert.match(disconnectedTabs, /['"]flight_data['"]/);
  assert.doesNotMatch(guiSource, /['"]rtk_base['"]/);
});

test('unit switching converts every Ground Control display and input boundary', () => {
  assert.match(groundControlSource, /globalSettings\.unitType/);
  assert.match(groundControlSource, /store\.get\(\s*['"]unit_type['"]/);
  assert.match(groundControlSource, /store\.set\(['"]unit_type['"], this\.unitSystem\)/);
  assert.match(groundControlSource, /resolveConfiguredUnitSystem/);
  assert.doesNotMatch(groundControlSource, /flightCommanderGroundControlUnits/);
  for (const quantity of [
    'relativeAltitude',
    'groundSpeed',
    'airSpeed',
    'climbRate',
    'distanceToWaypoint',
  ]) {
    assert.match(
      groundControlSource,
      new RegExp(`formatGroundControlValue\\([\\s\\S]*?['"]${quantity}['"]`),
    );
  }
  assert.match(hudSource, /toGroundControlDisplayState/);
  assert.match(
    groundControlSource,
    /groundControlDisplayToCanonicalValue\([\s\S]*?flightDataTakeoffAltitude[\s\S]*?mavlinkCommandRouter\.takeoff\(altitudeM\)/,
  );
  assert.match(groundControlSource, /rtkBasePanel\.setUnitSystem\(this\.unitSystem\)/);
  assert.match(rtkSource, /groundControlDisplayToCanonicalValue/);
  assert.match(rtkSource, /formatGroundControlLongDistance/);
  assert.match(rtkSource, /formatGroundControlValue\([\s\S]*?survey\.meanAccuracyM/);
  assert.match(rtkSource, /formatGroundControlValue\([\s\S]*?position\.ellipsoidHeightM/);
  assert.match(rtkSource, /formatGroundControlValue\([\s\S]*?refinement\.stabilityM/);
  assert.equal(
    [...rtkHtml.matchAll(/<span data-ground-control-distance-unit>m<\/span>/g)].length,
    4,
  );
  assert.doesNotMatch(rtkSource, /toFixed\([^)]*\)\} m/);
  assert.doesNotMatch(rtkSource, /toFixed\([^)]*\)\} km/);
});

test('vehicle and mission commands stay visible with explicit safe actions', () => {
  for (const [id, label] of [
    ['flightDataStartMission', 'Start Mission'],
    ['flightDataResumeMission', 'Resume Mission'],
    ['flightDataAbortMission', 'Abort Mission'],
    ['flightDataTakeoff', 'Launch / Takeoff'],
    ['flightDataRtl', 'Return Home (RTH / RTL)'],
    ['flightDataLand', 'Land'],
  ]) {
    assert.match(
      groundControlHtml,
      new RegExp(`id="${id}"[\\s\\S]*?>\\s*${label.replace(/[()/]/g, '\\$&')}\\s*<`),
    );
  }
  assert.doesNotMatch(
    groundControlSource,
    /\.fc-command-deck['"]\)\.addClass\(['"]is-hidden/,
  );
  assert.match(groundControlSource, /dialog\.confirm\([\s\S]*?Abort the active mission/);
  assert.match(groundControlSource, /mavlinkCommandRouter\.abortMission\(\)/);
  assert.match(groundControlSource, /The stored mission will not be deleted/);
});

test('desktop minimum and responsive fallback both support the two-pane layout', () => {
  const browserWindow = mainProcessSource.match(
    /mainWindow\s*=\s*new BrowserWindow\(\{([\s\S]*?)\n\s*\}\);/,
  );
  assert.ok(browserWindow);
  assert.equal(Number(browserWindow[1].match(/minWidth:\s*(\d+)/)?.[1]), 1024);
  assert.equal(Number(browserWindow[1].match(/minHeight:\s*(\d+)/)?.[1]), 720);
  assert.match(
    hudCssSource,
    /@media \(max-width: 900px\)[\s\S]*?\.fc-flight-visuals\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  );
  assert.match(
    hudCssSource,
    /@media \(max-width: 1250px\)[\s\S]*?\.fc-telemetry-grid\s*\{[\s\S]*?repeat\(5/,
  );
});
