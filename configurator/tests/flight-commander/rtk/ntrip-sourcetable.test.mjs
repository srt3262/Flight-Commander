import assert from "node:assert/strict";
import test from "node:test";

import {
  f9pMountpointCompatibility,
  mountpointDistanceKm,
  parseNtripSourcetable,
  sortNtripMountpoints,
} from "../../../js/rtk/ntripSourcetable.js";

const source = [
  "SOURCETABLE 200 OK",
  "STR;NEAR;Nearest;RTCM 3.2;1005(5),1077(1);2;GPS+GLO;FREE;USA;40.1000;-105.1000;1;1;GEN;none;B;N;9600;",
  "STR;FAR;Far Base;RTCM 3.1;1005(10),1077(1);2;GPS;FREE;USA;42.0000;-107.0000;0;0;GEN;none;N;N;4800;",
  "ENDSOURCETABLE",
].join("\r\n");

test("NTRIP sourcetable parser exposes free RTCM stream metadata", () => {
  const records = parseNtripSourcetable(source);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    mountpoint: "NEAR",
    identifier: "Nearest",
    format: "RTCM 3.2",
    formatDetails: "1005(5),1077(1)",
    carrier: 2,
    navigationSystems: "GPS+GLO",
    network: "FREE",
    country: "USA",
    latitude: 40.1,
    longitude: -105.1,
    requiresNmea: true,
    networkSolution: true,
    generator: "GEN",
    compression: "none",
    authentication: "B",
    fee: false,
    bitrate: 9600,
    misc: "",
  });
});

test("NTRIP mountpoints sort by distance from the surveyed base", () => {
  const records = parseNtripSourcetable(source);
  const sorted = sortNtripMountpoints([...records].reverse(), {
    latitude: 40,
    longitude: -105,
  });
  assert.equal(sorted[0].mountpoint, "NEAR");
  assert.ok(mountpointDistanceKm(sorted[0], { latitude: 40, longitude: -105 }) < 20);
  assert.equal(mountpointDistanceKm({ latitude: null, longitude: null }, {
    latitude: 40,
    longitude: -105,
  }), null);
});

test("F9P compatibility requires RTCM3 reference and observation messages", () => {
  const [compatible] = parseNtripSourcetable(source);
  assert.deepEqual(f9pMountpointCompatibility(compatible), {
    compatible: true,
    level: "compatible",
    label: "F9P compatible",
    reason: "RTCM3 reference and carrier observations available",
  });
  assert.equal(f9pMountpointCompatibility({ ...compatible, format: "RTCM 2.3" }).compatible, false);
  assert.equal(f9pMountpointCompatibility({ ...compatible, formatDetails: "1230(10)" }).compatible, false);
  assert.equal(f9pMountpointCompatibility({ ...compatible, carrier: 1 }).level, "limited");
  assert.equal(f9pMountpointCompatibility({ ...compatible, formatDetails: "" }).level, "unknown");
});
