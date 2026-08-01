import assert from "node:assert/strict";
import test from "node:test";

import {
  INAV_LARGE_MULTIROTOR_PRESETS,
  LARGE_MULTIROTOR_TUNING_PROFILES,
  deriveInavEzTunePids,
} from "../../../js/presets/inavMultirotorPresets.js";

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
