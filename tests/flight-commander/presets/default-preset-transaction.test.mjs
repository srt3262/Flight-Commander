import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DefaultPresetApplicationError,
  expectedAppliedDefaultsValue,
  partitionDefaultPresetSettings,
  preflightDefaultPresetSettings,
  runDefaultPresetCallbackStep,
  runDefaultPresetTransaction,
  verifyAppliedDefaultsValue,
} from "../../../js/presets/defaultPresetTransaction.js";
import defaultsDialogData from "../../../js/defaults_dialog_entries.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("preset transaction runs controller writes sequentially and reports progress", async () => {
  const order = [];
  const progress = [];
  const result = await runDefaultPresetTransaction([
    {
      label: "first",
      run(done) {
        order.push("start-first");
        setTimeout(() => {
          order.push("finish-first");
          done(true);
        }, 5);
      },
    },
    {
      label: "second",
      run(done) {
        order.push("start-second");
        done({ accepted: true });
      },
    },
  ], {
    timeoutMs: 100,
    onProgress: (entry) => progress.push(entry),
  });

  assert.deepEqual(order, ["start-first", "finish-first", "start-second"]);
  assert.deepEqual(progress, [
    { index: 0, total: 2, label: "first" },
    { index: 1, total: 2, label: "second" },
  ]);
  assert.deepEqual(result, { completed: 2 });
});

test("preset preflight validates every required value before returning writable settings", async () => {
  const inspected = [];
  const encoded = [];
  const progress = [];
  const settings = [
    { key: "required", value: 42 },
    { key: "compiled_feature", value: "ON", optional: true },
    { key: "second", value: 7 },
  ];

  const result = await preflightDefaultPresetSettings(settings, {
    inspectSetting: async (key) => {
      inspected.push(key);
      return key === "compiled_feature" ? null : { setting: { name: key } };
    },
    encodeSetting: async (key, value) => {
      encoded.push([key, value]);
      return [value];
    },
    onProgress: (entry) => progress.push(entry),
  });

  assert.deepEqual(inspected, ["required", "compiled_feature", "second"]);
  assert.deepEqual(encoded, [["required", 42], ["second", 7]]);
  assert.deepEqual(result.settings, [settings[0], settings[2]]);
  assert.deepEqual(result.skipped, [settings[1]]);
  assert.equal(result.checked, 3);
  assert.deepEqual(progress.map((entry) => entry.label), [
    "Checking required",
    "Checking compiled_feature",
    "Checking second",
  ]);
});

test("preset preflight rejects an unavailable required setting before application", async () => {
  await assert.rejects(
    preflightDefaultPresetSettings(
      [
        { key: "valid", value: 1 },
        { key: "removed_setting", value: 2 },
      ],
      {
        inspectSetting: async (key) => (key === "valid" ? { setting: {} } : null),
        encodeSetting: async () => true,
      },
    ),
    (error) => (
      error instanceof DefaultPresetApplicationError
      && error.settingsMayBeStaged === false
      && /removed_setting is not available/.test(error.message)
    ),
  );
});

test("preset preflight rejects duplicate writes and invalid encoded values", async () => {
  await assert.rejects(
    preflightDefaultPresetSettings(
      [{ key: "duplicate", value: 1 }, { key: "duplicate", value: 2 }],
      {
        inspectSetting: async () => ({ setting: {} }),
        encodeSetting: async () => true,
      },
    ),
    /defined more than once/,
  );

  await assert.rejects(
    preflightDefaultPresetSettings(
      [{ key: "bounded", value: 101 }],
      {
        inspectSetting: async () => ({ setting: {} }),
        encodeSetting: async () => { throw new Error("above maximum"); },
      },
    ),
    (error) => error.settingsMayBeStaged === false && /above maximum/.test(error.message),
  );
});

test("Keep current settings never enters control or battery profile selection", () => {
  const keepCurrent = defaultsDialogData.find((preset) => preset.preserveCurrentSettings);
  assert.ok(keepCurrent);

  const partitioned = partitionDefaultPresetSettings(keepCurrent.settings, {
    isControlProfileParameter: (key) => key.startsWith("control_"),
    isBatteryProfileParameter: (key) => key.startsWith("battery_"),
  });

  assert.deepEqual(partitioned.control, []);
  assert.deepEqual(partitioned.battery, []);
  assert.deepEqual(partitioned.common, [
    { key: "applied_defaults", value: 1 },
  ]);

  const dialog = source("js/defaults_dialog.js");
  assert.match(dialog, /if \(controlProfileSettings\.length > 0\)/);
  assert.match(dialog, /if \(batterySettings\.length > 0\)/);
  assert.doesNotMatch(dialog, /selectedDefaultPreset\.id == 0[\s\S]*savingDefaultsModal\.close/);
});

test("explicit command failure rejects instead of leaving the preset modal blocked", async () => {
  await assert.rejects(
    runDefaultPresetCallbackStep("Saving EEPROM", (done) => done(false), {
      timeoutMs: 100,
    }),
    (error) => (
      error instanceof DefaultPresetApplicationError
      && error.step === "Saving EEPROM"
      && /exhausted its retries/.test(error.message)
    ),
  );
});

test("a callback that never returns is bounded by an explicit timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    runDefaultPresetCallbackStep("Selecting profile", () => {}, {
      timeoutMs: 15,
    }),
    /did not respond/,
  );
  assert.ok(Date.now() - started < 250);
});

test("preset success requires a read-back match of applied_defaults", () => {
  const preset = {
    settings: [
      { key: "foo", value: 1 },
      { key: "applied_defaults", value: 17 },
    ],
  };
  assert.equal(expectedAppliedDefaultsValue(preset), 17);
  assert.equal(verifyAppliedDefaultsValue(preset, { value: 17 }), true);
  assert.throws(
    () => verifyAppliedDefaultsValue(preset, { value: 0 }),
    /expected applied_defaults=17/,
  );
  assert.throws(
    () => verifyAppliedDefaultsValue({ settings: [] }, { value: 0 }),
    /does not define an applied_defaults marker/,
  );
});

test("first-run preset UI has progress, recovery, retry, and read-back contracts", () => {
  const dialog = source("js/defaults_dialog.js");
  const html = source("index.html");
  const queue = source("js/serial_queue.js");
  const msp = source("js/msp.js");
  const wizard = source("js/wizard_save_framework.js");

  assert.match(dialog, /runDefaultPresetTransaction/);
  assert.match(dialog, /preflightDefaultPresetSettings/);
  assert.match(dialog, /verifyAppliedDefaultsValue/);
  assert.match(dialog, /Preset application stopped/);
  assert.match(dialog, /No preset values were written to the controller/);
  assert.ok(
    dialog.indexOf("preflightPreset(selectedDefaultPreset)")
      < dialog.indexOf("setFeaturesBits(compatiblePreset)"),
  );
  assert.match(dialog, /periodicStatusUpdater\.resume\(\)/);
  assert.match(html, /modal-saving-defaults-progress/);
  assert.match(html, /defaults-dialog__error/);
  assert.match(queue, /request\.onFinish\(false\)/);
  assert.match(msp, /MSP command \$\{code\} did not receive a response/);
  assert.doesNotMatch(wizard, /features\.execute\(self\.enableVirtulaPitot/);
  assert.match(wizard, /features\.execute\(function \(featureResult\)/);
});
