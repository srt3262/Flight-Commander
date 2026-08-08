'use strict';

export const FLIGHT_COMMANDER_REPOSITORY_URL =
  'https://github.com/srt3262/Flight-Commander';
export const FLIGHT_COMMANDER_DOCUMENTATION_HUB_URL =
  'https://github.com/srt3262/Flight-Commander/tree/master/docs';
export const FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL =
  'https://github.com/srt3262/Flight-Commander/blob/master/docs/';

const documentUrl = (filename, anchor = '') =>
  `${FLIGHT_COMMANDER_DOCUMENTATION_FILE_BASE_URL}${filename}${anchor ? `#${anchor}` : ''}`;

export const FLIGHT_COMMANDER_DOCUMENTATION = Object.freeze({
  hub: FLIGHT_COMMANDER_DOCUMENTATION_HUB_URL,
  gettingStarted: documentUrl('GETTING_STARTED.md'),
  connections: documentUrl('CONNECTIONS.md'),
  firmwareFlashing: documentUrl('FIRMWARE_FLASHING.md'),
  configuration: documentUrl('CONFIGURATION_REFERENCE.md'),
  gpsRtk: documentUrl('GPS_AND_RTK.md'),
  headingFusion: documentUrl('HEADING_FUSION.md'),
  groundControl: documentUrl('GROUND_CONTROL.md'),
  flightPlanner: documentUrl('FLIGHT_PLANNER.md'),
  cli: documentUrl('CLI.md'),
  settings: documentUrl('SETTINGS_REFERENCE.md'),
  tuning: documentUrl('TUNING.md'),
  osd: documentUrl('OSD.md'),
  loggingProgramming: documentUrl('LOGGING_AND_PROGRAMMING.md'),
  sitl: documentUrl('SITL.md'),
  troubleshooting: documentUrl('TROUBLESHOOTING.md'),
  firmwareFeatures: documentUrl(
    'CONFIGURATION_REFERENCE.md',
    'firmware-features',
  ),
  rtkBaseNtrip: documentUrl('RTK_BASE_NTRIP.md'),
  characterMap:
    `${FLIGHT_COMMANDER_REPOSITORY_URL}/blob/main/resources/osd/INAV%20Character%20Map.md`,
});

const CONFIGURATION_TAB_ANCHORS = Object.freeze({
  setup: 'setup',
  calibration: 'calibration',
  magnetometer: 'alignment-tool',
  configuration: 'configuration',
  ports: 'ports',
  mixer: 'mixer',
  outputs: 'outputs',
  receiver: 'receiver',
  auxiliary: 'modes',
  failsafe: 'failsafe',
  firmware_info: 'firmware-features',
  gps: 'gps-and-rtk',
  sensors: 'sensors',
  led_strip: 'led-strip',
  programming: 'programming',
  javascript_programming: 'javascript-programming',
});

const TAB_DOCUMENTATION = Object.freeze({
  landing: FLIGHT_COMMANDER_DOCUMENTATION.gettingStarted,
  help: FLIGHT_COMMANDER_DOCUMENTATION.hub,
  flight_data: FLIGHT_COMMANDER_DOCUMENTATION.groundControl,
  flight_planner: FLIGHT_COMMANDER_DOCUMENTATION.flightPlanner,
  firmware_flasher: FLIGHT_COMMANDER_DOCUMENTATION.firmwareFlashing,
  pid_tuning: FLIGHT_COMMANDER_DOCUMENTATION.tuning,
  advanced_tuning: documentUrl('TUNING.md', 'advanced-tuning'),
  adjustments: documentUrl('TUNING.md', 'in-flight-adjustments'),
  osd: FLIGHT_COMMANDER_DOCUMENTATION.osd,
  onboard_logging: documentUrl('LOGGING_AND_PROGRAMMING.md', 'onboard-logging'),
  logging: documentUrl('LOGGING_AND_PROGRAMMING.md', 'tethered-logging'),
  cli: FLIGHT_COMMANDER_DOCUMENTATION.cli,
  search: documentUrl('SETTINGS_REFERENCE.md', 'find-a-setting-by-name'),
  options: documentUrl('GETTING_STARTED.md', 'application-options'),
  sitl: FLIGHT_COMMANDER_DOCUMENTATION.sitl,
});

export function documentationUrlForTab(tabName) {
  const normalizedTabName = String(tabName ?? '').trim();
  if (TAB_DOCUMENTATION[normalizedTabName]) {
    return TAB_DOCUMENTATION[normalizedTabName];
  }

  const configurationAnchor = CONFIGURATION_TAB_ANCHORS[normalizedTabName];
  if (configurationAnchor) {
    return documentUrl('CONFIGURATION_REFERENCE.md', configurationAnchor);
  }

  return FLIGHT_COMMANDER_DOCUMENTATION.hub;
}

export function settingDocumentationUrl(settingName) {
  const anchor = String(settingName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');

  return anchor
    ? `${FLIGHT_COMMANDER_DOCUMENTATION.settings}#${anchor}`
    : FLIGHT_COMMANDER_DOCUMENTATION.settings;
}
