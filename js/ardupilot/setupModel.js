"use strict";

export const ARDUPILOT_MODE_PWM_SLOTS = Object.freeze([
  Object.freeze({ slot: 1, min: null, max: 1230, label: "800–1230" }),
  Object.freeze({ slot: 2, min: 1231, max: 1360, label: "1231–1360" }),
  Object.freeze({ slot: 3, min: 1361, max: 1490, label: "1361–1490" }),
  Object.freeze({ slot: 4, min: 1491, max: 1620, label: "1491–1620" }),
  Object.freeze({ slot: 5, min: 1621, max: 1749, label: "1621–1749" }),
  Object.freeze({ slot: 6, min: 1750, max: null, label: "1750–2200" }),
]);

export const ARDUPILOT_PID_GAIN_NAMES = Object.freeze([
  "P",
  "I",
  "D",
  "FF",
]);

const ARDUPILOT_PID_BASE_PATTERN = /^(?:ATC_|PSC_|RATE_|PID|Q_A_|TECS_|AROT_|RLL2SRV|PTCH2SRV|YAW2SRV)/;

function asParameterMap(parameters) {
  if (parameters instanceof Map) return parameters;
  return new Map(
    Array.from(parameters ?? [], (parameter) => [parameter.id, parameter]),
  );
}

function metadataFor(metadata, id) {
  return metadata instanceof Map ? metadata.get(id) ?? null : null;
}

function numberedParameters(parameters, pattern) {
  const map = asParameterMap(parameters);
  return [...map.entries()]
    .map(([id, parameter]) => {
      const match = pattern.exec(id);
      return match ? { number: Number(match[1]), id, parameter } : null;
    })
    .filter((entry) => entry && Number.isInteger(entry.number))
    .sort((left, right) => left.number - right.number);
}

export function discoverArduPilotSerialPorts(parameters, metadata = new Map()) {
  const map = asParameterMap(parameters);
  return numberedParameters(map, /^SERIAL(\d+)_PROTOCOL$/).map((entry) => {
    const prefix = `SERIAL${entry.number}`;
    const protocolId = `${prefix}_PROTOCOL`;
    const baudId = `${prefix}_BAUD`;
    const optionsId = `${prefix}_OPTIONS`;
    const protocolMetadata = metadataFor(metadata, protocolId);
    const baudMetadata = metadataFor(metadata, baudId);
    const optionsMetadata = metadataFor(metadata, optionsId);
    return Object.freeze({
      number: entry.number,
      label: `SERIAL${entry.number}`,
      description:
        protocolMetadata?.description
        || protocolMetadata?.displayName
        || `ArduPilot serial port ${entry.number}`,
      protocol: Object.freeze({
        id: protocolId,
        parameter: map.get(protocolId),
        metadata: protocolMetadata,
      }),
      baud: map.has(baudId)
        ? Object.freeze({
            id: baudId,
            parameter: map.get(baudId),
            metadata: baudMetadata,
          })
        : null,
      options: map.has(optionsId)
        ? Object.freeze({
            id: optionsId,
            parameter: map.get(optionsId),
            metadata: optionsMetadata,
          })
        : null,
    });
  });
}

export function serialReceiverProtocolValue(port) {
  const choices = port?.protocol?.metadata?.values ?? [];
  const match = choices.find((choice) =>
    /^(rcin|rc input|receiver input)$/i.test(String(choice.label).trim()),
  ) ?? choices.find((choice) => /rcin|receiver/i.test(String(choice.label)));
  return match?.value ?? null;
}

function modeParameterFamily(map) {
  if (map.has("FLTMODE_CH") && map.has("FLTMODE1")) {
    return Object.freeze({ channelId: "FLTMODE_CH", slotPrefix: "FLTMODE" });
  }
  if (map.has("MODE_CH") && map.has("MODE1")) {
    return Object.freeze({ channelId: "MODE_CH", slotPrefix: "MODE" });
  }
  return null;
}

export function discoverArduPilotModeConfiguration(
  parameters,
  metadata = new Map(),
) {
  const map = asParameterMap(parameters);
  const family = modeParameterFamily(map);
  if (!family) return null;
  const slots = ARDUPILOT_MODE_PWM_SLOTS.map((range) => {
    const id = `${family.slotPrefix}${range.slot}`;
    return map.has(id)
      ? Object.freeze({
          ...range,
          id,
          parameter: map.get(id),
          metadata: metadataFor(metadata, id),
        })
      : null;
  }).filter(Boolean);
  return Object.freeze({
    channel: Object.freeze({
      id: family.channelId,
      parameter: map.get(family.channelId),
      metadata: metadataFor(metadata, family.channelId),
    }),
    slots: Object.freeze(slots),
  });
}

export function activeArduPilotModeSlot(pwm) {
  if (pwm == null || pwm === "") return null;
  const value = Number(pwm);
  if (!Number.isFinite(value)) return null;
  return ARDUPILOT_MODE_PWM_SLOTS.find(
    ({ min, max }) => (min == null || value >= min) && (max == null || value <= max),
  )?.slot ?? null;
}

export function detectMovedRcChannel(
  baseline,
  current,
  { allowedChannels = null, threshold = 150 } = {},
) {
  const allowed = allowedChannels == null
    ? null
    : new Set(Array.from(allowedChannels, Number));
  let result = null;
  const count = Math.max(baseline?.length ?? 0, current?.length ?? 0);
  for (let index = 0; index < count; index += 1) {
    const channel = index + 1;
    if (allowed && !allowed.has(channel)) continue;
    const start = Number(baseline?.[index]);
    const value = Number(current?.[index]);
    if (!Number.isFinite(start) || !Number.isFinite(value)) continue;
    const delta = Math.abs(value - start);
    if (delta < threshold || (result && delta <= result.delta)) continue;
    result = Object.freeze({ channel, pwm: value, baseline: start, delta });
  }
  return result;
}

export function discoverArduPilotAuxiliaryChannels(
  parameters,
  metadata = new Map(),
) {
  return Object.freeze(
    numberedParameters(parameters, /^RC(\d+)_OPTION$/).map((entry) =>
      Object.freeze({
        channel: entry.number,
        id: entry.id,
        parameter: entry.parameter,
        metadata: metadataFor(metadata, entry.id),
      }),
    ),
  );
}

export function discoverArduPilotReceiverChannels(
  parameters,
  metadata = new Map(),
) {
  const map = asParameterMap(parameters);
  const channelNumbers = new Set();
  for (const id of map.keys()) {
    const match = /^RC(\d+)_(?:MIN|MAX|TRIM|DZ|REVERSED)$/.exec(id);
    if (match) channelNumbers.add(Number(match[1]));
  }
  return Object.freeze(
    [...channelNumbers]
      .sort((left, right) => left - right)
      .map((channel) => {
        const fields = {};
        for (const suffix of ["MIN", "TRIM", "MAX", "DZ", "REVERSED"]) {
          const id = `RC${channel}_${suffix}`;
          if (!map.has(id)) continue;
          fields[suffix.toLowerCase()] = Object.freeze({
            id,
            parameter: map.get(id),
            metadata: metadataFor(metadata, id),
          });
        }
        return Object.freeze({ channel, ...fields });
      }),
  );
}

export function bitmaskValueFromBits(bits) {
  return Array.from(new Set(Array.from(bits ?? [], Number)))
    .filter((bit) => Number.isInteger(bit) && bit >= 0 && bit <= 30)
    .reduce((value, bit) => value + (2 ** bit), 0);
}

export function selectedBitsFromBitmask(value, choices = []) {
  const numeric = Math.max(0, Math.floor(Number(value) || 0));
  return choices
    .map((choice) => Number(choice.value))
    .filter((bit) => Number.isInteger(bit) && bit >= 0 && bit <= 30)
    .filter((bit) => Math.floor(numeric / (2 ** bit)) % 2 === 1);
}

function pidGroupLabel(base) {
  const knownLabels = new Map([
    ["ATC_RAT_RLL", "Roll rate"],
    ["ATC_RAT_PIT", "Pitch rate"],
    ["ATC_RAT_YAW", "Yaw rate"],
    ["ATC_ANG_RLL", "Roll angle"],
    ["ATC_ANG_PIT", "Pitch angle"],
    ["ATC_ANG_YAW", "Yaw angle"],
    ["PSC_ACCZ", "Vertical acceleration"],
    ["PSC_VELZ", "Vertical velocity"],
    ["PSC_POSZ", "Vertical position"],
    ["PSC_VELXY", "Horizontal velocity"],
    ["PSC_POSXY", "Horizontal position"],
  ]);
  return knownLabels.get(base)
    ?? base
      .replace(/_/g, " ")
      .replace(/\bRLL\b/g, "Roll")
      .replace(/\bPIT\b/g, "Pitch")
      .replace(/\bYAW\b/g, "Yaw")
      .replace(/\bRAT\b/g, "Rate")
      .replace(/\bACC\b/g, "Acceleration")
      .replace(/\bVEL\b/g, "Velocity")
      .replace(/\bPOS\b/g, "Position")
      .replace(/\bFF\b/g, "Feed-forward")
      .toLowerCase()
      .replace(/^./, (character) => character.toUpperCase());
}

export function discoverArduPilotPidGroups(parameters, metadata = new Map()) {
  const map = asParameterMap(parameters);
  const groups = new Map();
  for (const [id, parameter] of map.entries()) {
    const match = /^(.+)_(P|I|D|FF)$/.exec(id);
    if (!match || !ARDUPILOT_PID_BASE_PATTERN.test(match[1])) continue;
    const [, base, gain] = match;
    if (!groups.has(base)) {
      groups.set(base, {
        id: base,
        label: pidGroupLabel(base),
        gains: {},
      });
    }
    groups.get(base).gains[gain.toLowerCase()] = Object.freeze({
      id,
      parameter,
      metadata: metadataFor(metadata, id),
    });
  }

  return Object.freeze(
    [...groups.values()]
      .filter((group) => Object.keys(group.gains).length >= 2)
      .map((group) => Object.freeze({
        ...group,
        gains: Object.freeze({ ...group.gains }),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  );
}
