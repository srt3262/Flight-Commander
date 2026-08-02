import assert from "node:assert/strict";
import test from "node:test";

import { summarizeFixedSamples } from "../../../js/rtk/rtkBaseRefinement.js";

test("RTK base refinement averages stable fixed samples and reports readiness", () => {
  const samples = Array.from({ length: 10 }, (_unused, index) => ({
    latitude: 40 + (index - 4.5) * 1e-8,
    longitude: -105 - (index - 4.5) * 1e-8,
    ellipsoidHeightM: 1600 + (index % 2 ? 0.004 : -0.004),
    altitudeMsl: 1578.5,
    horizontalAccuracyM: 0.012,
    verticalAccuracyM: 0.02,
  }));
  const summary = summarizeFixedSamples(samples);
  assert.equal(summary.ready, true);
  assert.equal(summary.samples, 10);
  assert.ok(Math.abs(summary.latitude - 40) < 1e-12);
  assert.ok(Math.abs(summary.longitude + 105) < 1e-12);
  assert.ok(summary.stabilityM < 0.01);
  assert.ok(summary.fixedPositionAccuracyM >= 0.02);
});

test("RTK base refinement remains unready before ten consecutive fixed samples", () => {
  const summary = summarizeFixedSamples(Array.from({ length: 9 }, () => ({
    latitude: 40,
    longitude: -105,
    ellipsoidHeightM: 1600,
    horizontalAccuracyM: 0.01,
    verticalAccuracyM: 0.02,
  })));
  assert.equal(summary.ready, false);
  assert.equal(summary.samples, 9);
});
