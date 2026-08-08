"use strict";

// EEPROM writes use a five-second queue window and may be retried twice. Give
// that bounded queue enough time to report its own terminal result before the
// UI-level watchdog takes over.
export const DEFAULT_PRESET_STEP_TIMEOUT_MS = 20000;
export const DEFAULT_CONTROL_PROFILE_INDEX = 0;

export class DefaultPresetApplicationError extends Error {
  constructor(step, message, options = {}) {
    super(`${step}: ${message}`, options);
    this.name = "DefaultPresetApplicationError";
    this.step = step;
    this.settingsMayBeStaged = options.settingsMayBeStaged ?? true;
  }
}

export function partitionDefaultPresetSettings(
  settings,
  { isControlProfileParameter, isBatteryProfileParameter } = {},
) {
  if (
    typeof isControlProfileParameter !== "function"
    || typeof isBatteryProfileParameter !== "function"
  ) {
    throw new TypeError("Preset partitioning requires both profile classifiers");
  }

  const control = [];
  const battery = [];
  const common = [];

  for (const entry of Array.from(settings ?? [])) {
    if (isControlProfileParameter(entry.key)) {
      control.push(entry);
    } else if (isBatteryProfileParameter(entry.key)) {
      battery.push(entry);
    } else {
      common.push(entry);
    }
  }

  return Object.freeze({
    control: Object.freeze(control),
    battery: Object.freeze(battery),
    common: Object.freeze(common),
  });
}

export function buildDefaultControlProfilePresetSteps(
  preset,
  {
    commonSettings = [],
    controlProfileSettings = [],
  } = {},
  {
    selectControlProfile,
    setSetting,
  } = {},
) {
  if (typeof setSetting !== "function") {
    throw new TypeError("Preset steps require a setting writer");
  }

  const steps = [];
  if (preset?.preserveCurrentSettings !== true) {
    if (typeof selectControlProfile !== "function") {
      throw new TypeError("Preset steps require a control-profile selector");
    }
    steps.push({
      label: "Selecting default control profile 1",
      run(done) {
        selectControlProfile(DEFAULT_CONTROL_PROFILE_INDEX, done);
      },
    });
  }

  for (const input of Array.from(commonSettings)) {
    steps.push({
      label: `Setting ${input.key}`,
      run(done) {
        setSetting(input.key, input.value, done);
      },
    });
  }

  for (const input of Array.from(controlProfileSettings)) {
    steps.push({
      label: `Control profile 1: ${input.key}`,
      run(done) {
        setSetting(input.key, input.value, done);
      },
    });
  }

  return Object.freeze(steps);
}

export async function preflightDefaultPresetSettings(
  settings,
  {
    inspectSetting,
    encodeSetting,
    onProgress = null,
  } = {},
) {
  if (typeof inspectSetting !== "function" || typeof encodeSetting !== "function") {
    throw new TypeError("Preset preflight requires setting inspection and encoding functions");
  }

  const entries = Array.from(settings ?? []);
  const compatibleSettings = [];
  const skippedSettings = [];
  const seen = new Set();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const key = entry?.key;
    if (typeof key !== "string" || key.trim() === "") {
      throw new DefaultPresetApplicationError(
        "Checking preset compatibility",
        `entry ${index + 1} has no setting name`,
        { settingsMayBeStaged: false },
      );
    }
    if (seen.has(key)) {
      throw new DefaultPresetApplicationError(
        "Checking preset compatibility",
        `setting ${key} is defined more than once`,
        { settingsMayBeStaged: false },
      );
    }
    seen.add(key);

    onProgress?.({
      index,
      total: entries.length,
      label: `Checking ${key}`,
    });

    let discovered;
    try {
      discovered = await inspectSetting(key);
    } catch (error) {
      throw new DefaultPresetApplicationError(
        "Checking preset compatibility",
        `could not inspect ${key}: ${error?.message ?? String(error)}`,
        { cause: error, settingsMayBeStaged: false },
      );
    }

    if (!discovered) {
      if (entry.optional === true) {
        skippedSettings.push(entry);
        continue;
      }
      throw new DefaultPresetApplicationError(
        "Checking preset compatibility",
        `setting ${key} is not available on the connected INAV target`,
        { settingsMayBeStaged: false },
      );
    }

    try {
      await encodeSetting(key, entry.value);
    } catch (error) {
      throw new DefaultPresetApplicationError(
        "Checking preset compatibility",
        `${key} cannot accept ${JSON.stringify(entry.value)}: ${error?.message ?? String(error)}`,
        { cause: error, settingsMayBeStaged: false },
      );
    }
    compatibleSettings.push(entry);
  }

  return Object.freeze({
    checked: entries.length,
    settings: Object.freeze(compatibleSettings.slice()),
    skipped: Object.freeze(skippedSettings.slice()),
  });
}

export function runDefaultPresetCallbackStep(
  step,
  operation,
  { timeoutMs = DEFAULT_PRESET_STEP_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(
        reject,
        new DefaultPresetApplicationError(
          step,
          `the controller did not respond within ${Math.ceil(timeoutMs / 1000)} seconds`,
        ),
      );
    }, timeoutMs);

    try {
      operation((result) => {
        if (result === false) {
          finish(
            reject,
            new DefaultPresetApplicationError(
              step,
              "the controller rejected the command or exhausted its retries",
            ),
          );
          return;
        }
        finish(resolve, result);
      });
    } catch (error) {
      finish(
        reject,
        new DefaultPresetApplicationError(step, error?.message ?? String(error), {
          cause: error,
        }),
      );
    }
  });
}

export async function runDefaultPresetTransaction(
  steps,
  { timeoutMs = DEFAULT_PRESET_STEP_TIMEOUT_MS, onProgress = null } = {},
) {
  const entries = Array.from(steps ?? []);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    onProgress?.({
      index,
      total: entries.length,
      label: entry.label,
    });
    await runDefaultPresetCallbackStep(entry.label, entry.run, { timeoutMs });
  }
  return Object.freeze({ completed: entries.length });
}

export function expectedAppliedDefaultsValue(preset) {
  const marker = Array.from(preset?.settings ?? []).find(
    (setting) => setting?.key === "applied_defaults",
  );
  return marker?.value ?? null;
}

export function verifyAppliedDefaultsValue(preset, result) {
  const expected = expectedAppliedDefaultsValue(preset);
  if (expected == null) {
    throw new DefaultPresetApplicationError(
      "Verifying preset",
      "the selected preset does not define an applied_defaults marker",
    );
  }
  const actual = Number(result?.value);
  if (!Number.isFinite(actual) || actual !== Number(expected)) {
    throw new DefaultPresetApplicationError(
      "Verifying preset",
      `expected applied_defaults=${expected}, but the controller reported ${result?.value ?? "no value"}`,
    );
  }
  return true;
}
