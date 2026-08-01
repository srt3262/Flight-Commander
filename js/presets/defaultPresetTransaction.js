"use strict";

// EEPROM writes use a five-second queue window and may be retried twice. Give
// that bounded queue enough time to report its own terminal result before the
// UI-level watchdog takes over.
export const DEFAULT_PRESET_STEP_TIMEOUT_MS = 20000;

export class DefaultPresetApplicationError extends Error {
  constructor(step, message, options = {}) {
    super(`${step}: ${message}`, options);
    this.name = "DefaultPresetApplicationError";
    this.step = step;
  }
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
