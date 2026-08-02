import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import defaultsDialogData from "../../../js/defaults_dialog_entries.js";
import {
  INAV_LARGE_MULTIROTOR_PRESETS,
  LARGE_MULTIROTOR_TUNING_PROFILES,
  deriveInavEzTunePids,
} from "../../../js/presets/inavMultirotorPresets.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function settingMap(preset) {
  return new Map(preset.settings.map((entry) => [entry.key, entry.value]));
}

test("Flight Commander exposes exactly the requested large-prop INAV presets", () => {
  assert.deepEqual(
    INAV_LARGE_MULTIROTOR_PRESETS.map((preset) => preset.propInches),
    [10, 12, 15, 17],
  );
  assert.equal(new Set(INAV_LARGE_MULTIROTOR_PRESETS.map((preset) => preset.id)).size, 4);
  for (const preset of INAV_LARGE_MULTIROTOR_PRESETS) {
    assert.match(preset.title, new RegExp(`${preset.propInches}\\" propellers`));
    assert.match(preset.description, /generated roll P\/I\/D\/FF/);
    assert.equal(preset.mixerToApply, 3);
    assert.equal(preset.reboot, true);
  }
});

test("larger props receive progressively lower bandwidth and response", () => {
  const filters = LARGE_MULTIROTOR_TUNING_PROFILES.map((profile) => profile.filterHz);
  const response = LARGE_MULTIROTOR_TUNING_PROFILES.map((profile) => profile.response);
  assert.deepEqual(filters, [75, 60, 50, 45]);
  assert.deepEqual(response, [90, 85, 78, 72]);
  for (let index = 1; index < filters.length; index += 1) {
    assert.ok(filters[index] < filters[index - 1]);
    assert.ok(response[index] < response[index - 1]);
  }
});

test("every large-prop preset writes a complete bounded INAV 9.1 EZ Tune profile", () => {
  for (const preset of INAV_LARGE_MULTIROTOR_PRESETS) {
    const settings = settingMap(preset);
    assert.equal(settings.get("platform_type"), "MULTIROTOR");
    assert.equal(settings.get("ez_enabled"), "ON");
    assert.equal(settings.get("ez_filter_hz"), preset.tuning.filterHz);
    assert.equal(settings.get("ez_response"), preset.tuning.response);
    assert.equal(settings.get("ez_damping"), preset.tuning.damping);
    assert.equal(settings.get("ez_stability"), preset.tuning.stability);
    assert.equal(settings.get("ez_aggressiveness"), preset.tuning.aggressiveness);
    assert.equal(settings.get("ez_snappiness"), 0);
    assert.equal(settings.get("applied_defaults"), 5);
    assert.ok(settings.get("ez_filter_hz") >= 20 && settings.get("ez_filter_hz") <= 300);
    for (const key of ["ez_response", "ez_damping", "ez_stability", "ez_aggressiveness"]) {
      assert.ok(settings.get(key) >= 0 && settings.get(key) <= 200);
    }
  }
});

test("calculated preset PIDs mirror the INAV 9.1 EZ Tune generator", () => {
  assert.deepEqual(deriveInavEzTunePids(LARGE_MULTIROTOR_TUNING_PROFILES[0]).roll, {
    p: 36,
    i: 82,
    d: 27,
    ff: 85,
  });
  assert.deepEqual(deriveInavEzTunePids(LARGE_MULTIROTOR_TUNING_PROFILES[0]).pitch, {
    p: 39,
    i: 90,
    d: 30,
    ff: 93,
  });
  assert.deepEqual(deriveInavEzTunePids(LARGE_MULTIROTOR_TUNING_PROFILES[3]).roll, {
    p: 28,
    i: 88,
    d: 31,
    ff: 70,
  });
});

test("every multirotor prop-size preset is a complete coherent INAV 9.1 starting point", () => {
  const multirotors = defaultsDialogData.filter((preset) => Number.isFinite(preset.propInches));
  assert.deepEqual(multirotors.map((preset) => preset.propInches), [3, 5, 7, 10, 12, 15, 17]);

  const expectedFilters = new Map([
    [3, 90],
    [5, 110],
    [7, 90],
    [10, 75],
    [12, 60],
    [15, 50],
    [17, 45],
  ]);
  for (const preset of multirotors) {
    const settings = settingMap(preset);
    assert.equal(preset.mixerToApply, 3);
    assert.equal(settings.get("model_preview_type"), 3);
    assert.equal(settings.get("platform_type"), "MULTIROTOR");
    assert.equal(settings.get("motor_pwm_protocol"), "DSHOT300");
    assert.equal(settings.get("ez_enabled"), "ON");
    assert.equal(settings.get("ez_filter_hz"), expectedFilters.get(preset.propInches));
    assert.ok(settings.has("ez_snappiness"));
    assert.ok(settings.has("airmode_type"));
    assert.ok(settings.has("mc_iterm_relax"));
    assert.ok(settings.has("d_boost_min"));
    assert.ok(settings.has("d_boost_max"));
    assert.ok(settings.has("failsafe_procedure"));
    assert.equal(settings.has("gyro_hardware_lpf"), false);
    assert.equal(settings.has("gyro_dyn_lpf_min_hz"), false);
    assert.equal(settings.has("gyro_dyn_lpf_max_hz"), false);
    assert.equal(settings.has("gyro_dyn_lpf_curve_expo"), false);

    const pids = deriveInavEzTunePids({
      axisRatio: settings.get("ez_axis_ratio"),
      response: settings.get("ez_response"),
      damping: settings.get("ez_damping"),
      stability: settings.get("ez_stability"),
      aggressiveness: settings.get("ez_aggressiveness"),
    });
    assert.ok(pids.roll.p >= 28 && pids.roll.p <= 41);
    assert.ok(pids.roll.i >= 75 && pids.roll.i <= 89);
    assert.ok(pids.roll.d >= 23 && pids.roll.d <= 32);
    assert.ok(pids.roll.ff >= 70 && pids.roll.ff <= 100);

    const dBoostMin = preset.settings.find((entry) => entry.key === "d_boost_min");
    assert.equal(dBoostMin.optional, true);
    assert.equal(
      dBoostMin.value,
      1 - (settings.get("ez_snappiness") / 100),
    );
  }
});

test("all first-run presets exclude removed INAV settings and use canonical names", () => {
  const migration = JSON.parse(
    readFileSync(resolve(projectRoot, "js/migration/7_to_8.json"), "utf8"),
  );
  const removed = new Set(migration.removed);
  for (const preset of defaultsDialogData) {
    const keys = (preset.settings ?? []).map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length, `${preset.title} contains duplicate settings`);
    for (const key of keys) {
      assert.equal(removed.has(key), false, `${preset.title} still writes removed setting ${key}`);
    }
    assert.equal(keys.includes("nav_fw_pos_z_FF"), false);
  }

  for (const preset of defaultsDialogData.filter((entry) => /Airplane/.test(entry.title))) {
    assert.ok(settingMap(preset).has("nav_fw_pos_z_ff"));
  }
});

test("airframe presets select distinct INAV mixers and platform types", () => {
  const byTitle = new Map(defaultsDialogData.map((preset) => [preset.title, preset]));
  const conventional = byTitle.get("Airplane with a Tail");
  const wing = byTitle.get("Airplane without a Tail (Wing, Delta, etc)");
  const rover = byTitle.get("Rover");
  const boat = byTitle.get("Boat");

  assert.equal(conventional.mixerToApply, 14);
  assert.equal(settingMap(conventional).get("platform_type"), "AIRPLANE");
  assert.equal(settingMap(conventional).get("nav_fw_bank_angle"), 35);
  assert.equal(wing.mixerToApply, 8);
  assert.equal(settingMap(wing).get("platform_type"), "AIRPLANE");
  assert.equal(settingMap(wing).get("nav_fw_bank_angle"), 45);

  assert.equal(rover.mixerToApply, 31);
  assert.equal(settingMap(rover).get("model_preview_type"), 31);
  assert.equal(settingMap(rover).get("platform_type"), "ROVER");
  assert.equal(boat.mixerToApply, 32);
  assert.equal(settingMap(boat).get("model_preview_type"), 32);
  assert.equal(settingMap(boat).get("platform_type"), "BOAT");
});
