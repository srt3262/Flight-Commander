import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalFlightCommanderMspGpsFix,
  groundControlGpsFixStatus,
} from "../../../js/gcs/gpsFixStatus.js";

test("Flight Commander MSP GPS fixes map to the four Ground Control states", () => {
  const cases = [
    { native: 0, canonical: 1, label: "No Fix" },
    { native: 1, canonical: 1, label: "No Fix" },
    { native: 2, canonical: 3, label: "3D Fix" },
    { native: 3, canonical: 5, label: "RTK Float" },
    { native: 4, canonical: 6, label: "RTK Fix" },
  ];

  for (const entry of cases) {
    const canonical = canonicalFlightCommanderMspGpsFix(entry.native);
    assert.equal(canonical, entry.canonical);
    assert.equal(groundControlGpsFixStatus(canonical).label, entry.label);
  }
});

test("MAVLink GPS fixes render as No Fix, 3D Fix, RTK Float, or RTK Fix", () => {
  assert.equal(groundControlGpsFixStatus(0).label, "No Fix");
  assert.equal(groundControlGpsFixStatus(2).label, "No Fix");
  assert.equal(groundControlGpsFixStatus(3).label, "3D Fix");
  assert.equal(groundControlGpsFixStatus(5).label, "RTK Float");
  assert.equal(groundControlGpsFixStatus(6).label, "RTK Fix");
});
