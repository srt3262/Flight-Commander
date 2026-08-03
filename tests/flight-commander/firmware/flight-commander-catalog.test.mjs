import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
  catalogByTarget,
  flightCommanderReleaseDescriptors,
  normalizeFirmwareTarget,
  parseFlightCommanderFirmwareFilename,
  parsedHexContainsFlightCommanderIdentity,
} from "../../../js/flightCommander/firmwareCatalog.js";

describe("Flight Commander firmware catalog", () => {
  test("uses Flight Commander releases and preserves the legacy target alias", () => {
    assert.equal(
      FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
      "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20",
    );
    assert.equal(normalizeFirmwareTarget("MICOAIR743"), "MICOAIR743");
    assert.equal(normalizeFirmwareTarget("MICROAIR743"), "MICOAIR743");
  });

  test("parses release and bench-only HEX names for the supported H743 target", () => {
    assert.deepEqual(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-0.1.0-MICOAIR743-BENCH-ONLY.hex",
      ),
      {
        family: "flight-commander",
        version: "0.1.0",
        target_id: "MICOAIR743",
        target: "MICOAIR743 (Aero Selfie H743)",
        format: "hex",
        benchOnly: true,
      },
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-0.2.0-MICROAIR743.hex",
      ).target_id,
      "MICOAIR743",
    );
    assert.equal(parseFlightCommanderFirmwareFilename("arducopter.apj"), null);
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-0.1.0-UNKNOWN.hex",
      ),
      null,
    );
  });

  test("filters draft and unrelated assets and indexes published firmware by target", () => {
    const releases = [
      {
        draft: true,
        tag_name: "v9.9.9",
        assets: [
          {
            name: "Flight-Commander-Firmware-9.9.9-MICOAIR743.hex",
            browser_download_url: "https://example.invalid/draft.hex",
          },
        ],
      },
      {
        draft: false,
        prerelease: true,
        tag_name: "v0.1.0",
        name: "Firmware 0.1.0 identity baseline",
        html_url: "https://example.invalid/release",
        published_at: "2026-08-02T12:00:00Z",
        body: "Prop-off bench baseline.",
        assets: [
          {
            name: "Flight-Commander-Firmware-0.1.0-MICOAIR743-BENCH-ONLY.hex",
            browser_download_url: "https://example.invalid/firmware.hex",
            digest: "sha256:abc",
          },
          { name: "Flight-Commander-Firmware-0.1.0-source.zip" },
        ],
      },
    ];
    const descriptors = flightCommanderReleaseDescriptors(releases);
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].status, "bench-only");
    assert.equal(descriptors[0].target_id, "MICOAIR743");
    assert.equal(descriptors[0].digest, "sha256:abc");
    assert.equal(catalogByTarget(descriptors).MICOAIR743.length, 1);
  });

  test("requires the compiled FCFW marker before a HEX can be offered as fork firmware", () => {
    assert.equal(
      parsedHexContainsFlightCommanderIdentity({
        data: [{ data: [0, 0x46, 0x43, 0x46, 0x57, 0] }],
      }),
      true,
    );
    assert.equal(
      parsedHexContainsFlightCommanderIdentity({
        data: [{ data: [0x49, 0x4e, 0x41, 0x56] }],
      }),
      false,
    );
  });
});
