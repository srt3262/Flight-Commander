import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DefaultPresetApplicationError,
  expectedAppliedDefaultsValue,
  runDefaultPresetCallbackStep,
  runDefaultPresetTransaction,
  verifyAppliedDefaultsValue,
} from "../../../js/presets/defaultPresetTransaction.js";

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
  assert.match(dialog, /verifyAppliedDefaultsValue/);
  assert.match(dialog, /Preset application stopped/);
  assert.match(dialog, /periodicStatusUpdater\.resume\(\)/);
  assert.match(html, /modal-saving-defaults-progress/);
  assert.match(html, /defaults-dialog__error/);
  assert.match(queue, /request\.onFinish\(false\)/);
  assert.match(msp, /MSP command \$\{code\} did not receive a response/);
  assert.doesNotMatch(wizard, /features\.execute\(self\.enableVirtulaPitot/);
  assert.match(wizard, /features\.execute\(function \(featureResult\)/);
});
