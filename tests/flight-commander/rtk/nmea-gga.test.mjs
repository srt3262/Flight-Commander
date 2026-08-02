import assert from "node:assert/strict";
import test from "node:test";

import { buildNmeaGga, nmeaChecksum } from "../../../js/rtk/nmeaGga.js";

test("NTRIP GGA uses NMEA coordinates, UTC, altitude, and a valid checksum", () => {
  const sentence = buildNmeaGga({
    latitude: 40.1234567,
    longitude: -105.9876543,
    altitudeMsl: 1600.25,
    geoidSeparation: -21.5,
    fixQuality: 4,
    satellites: 21,
    hdop: 0.7,
  }, new Date("2026-08-02T16:30:45Z"));

  assert.match(
    sentence,
    /^\$GPGGA,163045\.00,4007\.4074020,N,10559\.2592580,W,4,21,0\.7,1600\.250,M,-21\.500,M,,\*[0-9A-F]{2}$/,
  );
  const [body, checksum] = sentence.slice(1).split("*");
  assert.equal(checksum, nmeaChecksum(body));
});

test("NTRIP GGA rejects out-of-range coordinates", () => {
  assert.throws(() => buildNmeaGga({ latitude: 91, longitude: 0 }), /Latitude is invalid/);
  assert.throws(() => buildNmeaGga({ latitude: 0, longitude: -181 }), /Longitude is invalid/);
});
