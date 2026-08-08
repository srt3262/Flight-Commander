import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tabsDirectory = join(projectRoot, 'tabs');
const outputPath = resolve(projectRoot, '../docs/SETTINGS_REFERENCE.md');

const pageNames = Object.freeze({
  adjustments: 'Adjustments',
  advanced_tuning: 'Advanced Tuning',
  calibration: 'Calibration',
  configuration: 'Configuration',
  failsafe: 'Failsafe',
  firmware_flasher: 'Firmware Flasher',
  flight_data: 'Ground Control',
  gps: 'GPS and RTK',
  led_strip: 'LED Strip',
  logging: 'Tethered Logging',
  magnetometer: 'Alignment Tool',
  mixer: 'Mixer',
  onboard_logging: 'Onboard Logging',
  osd: 'OSD',
  outputs: 'Outputs',
  pid_tuning: 'PID Tuning',
  ports: 'Ports',
  programming: 'Programming',
  receiver: 'Receiver',
  sensors: 'Sensors',
});

const settings = new Map();
for (const filename of readdirSync(tabsDirectory).filter((name) => name.endsWith('.html')).sort()) {
  const tabName = filename.slice(0, -'.html'.length);
  const pageName = pageNames[tabName] ?? tabName.replaceAll('_', ' ');
  const html = readFileSync(join(tabsDirectory, filename), 'utf8');
  for (const match of html.matchAll(/\bdata-setting=["']([^"']+)["']/g)) {
    const settingName = match[1].trim();
    if (!settingName) continue;
    const pages = settings.get(settingName) ?? new Set();
    pages.add(pageName);
    settings.set(settingName, pages);
  }
}

const lines = [
  '# Flight Commander settings reference',
  '',
  'This index covers every static firmware setting exposed by the installed',
  'Flight Commander graphical pages. A connected controller remains authoritative:',
  'target builds can omit settings, add target-specific settings, or report different',
  'ranges and defaults.',
  '',
  '## Find a setting by name',
  '',
  'Use the Configurator **Search** page for graphical controls. In CLI, query the',
  'connected firmware directly:',
  '',
  '```text',
  'get setting_name',
  'get partial_name',
  'get *',
  '```',
  '',
  'Read the value, range, and unit returned by that firmware before using `set`.',
  'Raw CLI units can differ from the converted Metric/Imperial values shown in the',
  'interface. Use `diff all` for a reviewable backup before changing values.',
  '',
  'See the [CLI command reference](CLI.md) for command safety and restore steps, and',
  'the [configuration reference](CONFIGURATION_REFERENCE.md) for page workflows.',
  '',
  `## Graphical setting index (${settings.size})`,
  '',
];

for (const [settingName, pages] of [...settings].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(
    `<a id="${settingName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}"></a>`,
    `### \`${settingName}\``,
    '',
    `Configurator page${pages.size === 1 ? '' : 's'}: ${[...pages].sort().join(', ')}.`,
    '',
  );
}

lines.push(
  '## Settings not listed here',
  '',
  'Flight Commander-only schemas such as heading-fusion source records are',
  'capability-gated protocol structures rather than ordinary CLI setting names.',
  'They are documented in the relevant feature guide. Conversely, a target may',
  'publish CLI settings that have no graphical control. Use `get *` and `help` on',
  'that connected firmware for the complete runtime schema.',
  '',
  `Generated from \`${relative(projectRoot, tabsDirectory)}/*.html\` by`,
  '`scripts/generate-flight-commander-settings-docs.mjs`.',
);

writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${relative(projectRoot, outputPath)} with ${settings.size} settings.`);
