import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import {
  FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
  FLIGHT_COMMANDER_KNOWN_GOOD_FIRMWARE_VERSIONS,
  FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION,
  catalogByTarget,
  flightCommanderReleaseDescriptors,
  inferFlightCommanderFirmwareTarget,
  isSupportedFlightCommanderFirmwareVersion,
  localFlightCommanderFirmwareDescriptor,
  normalizeFirmwareTarget,
  parseFlightCommanderFirmwareFilename,
  parsedHexContainsFlightCommanderIdentity,
  verifyFlightCommanderOnlinePayload,
} from "../../../js/flightCommander/firmwareCatalog.js";

function parsedFirmwareBytes(...chunks) {
  return {
    data: chunks.map((chunk) => ({
      data: typeof chunk === "string"
        ? Array.from(chunk, (character) => character.charCodeAt(0))
        : chunk,
    })),
  };
}

describe("Flight Commander firmware catalog", () => {
  test("uses Flight Commander releases, preserves the recovery baseline, and rejects failed revisions", () => {
    assert.equal(
      FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
      "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20",
    );
    assert.equal(FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION, "4.0.6");
    assert.deepEqual(FLIGHT_COMMANDER_KNOWN_GOOD_FIRMWARE_VERSIONS, ["3.0.7"]);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.6"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.7"), true);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.7-recovery"), true);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.8"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.0"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.4"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.5"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.6"), true);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.1.0"), true);
    assert.equal(normalizeFirmwareTarget("MICOAIR743"), "MICOAIR743");
    assert.equal(normalizeFirmwareTarget("MICROAIR743"), "MICOAIR743");
  });

  test("parses release and bench-only HEX names for the supported H743 target", () => {
    assert.deepEqual(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-3.0.7-MICOAIR743-BENCH-ONLY.hex",
      ),
      {
        family: "flight-commander",
        version: "3.0.7",
        target_id: "MICOAIR743",
        target: "MICOAIR743 (Aero Selfie H743)",
        format: "hex",
        benchOnly: true,
      },
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-3.0.8-MICROAIR743.hex",
      ).target_id,
      "MICOAIR743",
    );
    assert.equal(parseFlightCommanderFirmwareFilename("arducopter.apj"), null);
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-3.0.7-UNKNOWN.hex",
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
        tag_name: "v4.0.6",
        name: "Firmware 4.0.6 beta",
        html_url: "https://example.invalid/release",
        published_at: "2026-08-02T12:00:00Z",
        body: "Prop-off bench baseline.",
        assets: [
          {
            name: "Flight-Commander-Firmware-4.0.6-MICOAIR743-BENCH-ONLY.hex",
            browser_download_url: "https://example.invalid/firmware.hex",
            digest: `sha256:${"a".repeat(64)}`,
            size: 1234,
          },
          { name: "Flight-Commander-Firmware-4.0.6-source.zip" },
        ],
      },
    ];
    const descriptors = flightCommanderReleaseDescriptors(releases);
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].status, "bench-only");
    assert.equal(descriptors[0].target_id, "MICOAIR743");
    assert.equal(descriptors[0].digest, `sha256:${"a".repeat(64)}`);
    assert.equal(descriptors[0].bytes, 1234);
    assert.equal(catalogByTarget(descriptors).MICOAIR743.length, 1);
  });

  test("uses standalone GitHub HEX assets for the current release and verified recovery baseline", () => {
    const filename = "Flight-Commander-Firmware-4.0.6-MICOAIR743.hex";
    const online = flightCommanderReleaseDescriptors([
      {
        draft: false,
        prerelease: false,
        tag_name: "v4.0.6",
        assets: [
          {
            name: "Flight-Commander-Firmware-3.0.7-MICOAIR743.hex",
            browser_download_url: "https://example.invalid/recovery.hex",
            digest: `sha256:${"b".repeat(64)}`,
            size: 1200,
          },
          {
            name: filename,
            browser_download_url: "https://example.invalid/firmware.hex",
            digest: `sha256:${"a".repeat(64)}`,
            size: 1234,
          },
        ],
      },
    ]);

    assert.equal(online.length, 2);
    assert.deepEqual(online.map(({ version }) => version), ["4.0.6", "3.0.7"]);
    assert.equal(online[0].url, "https://example.invalid/firmware.hex");
    assert.equal(online[0].bytes, 1234);
    assert.equal(online[1].url, "https://example.invalid/recovery.hex");
    assert.equal(catalogByTarget(online).MICOAIR743.length, 2);
    assert.equal("bundled" in online[0], false);
  });

  test("verifies online byte count and GitHub SHA-256 before decoding the HEX", async () => {
    const hex = ":020000040800F2\n:00000001FF\n";
    const payload = new TextEncoder().encode(hex);
    const digest = createHash("sha256").update(payload).digest("hex");
    const descriptor = {
      bytes: payload.byteLength,
      digest: `sha256:${digest}`,
    };

    assert.equal(
      await verifyFlightCommanderOnlinePayload(payload, descriptor),
      hex,
    );
    await assert.rejects(
      verifyFlightCommanderOnlinePayload(payload, {
        ...descriptor,
        bytes: payload.byteLength + 1,
      }),
      /size mismatch/,
    );
    await assert.rejects(
      verifyFlightCommanderOnlinePayload(payload, {
        ...descriptor,
        digest: `sha256:${"0".repeat(64)}`,
      }),
      /SHA-256 verification failed/,
    );
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

  test("infers the MICOAIR743 target from compiled firmware content", () => {
    const parsedHex = parsedFirmwareBytes(
      [0, 0x46, 0x43, 0x46, 0x57, 0],
      "padding MICOAIR743 padding",
    );
    assert.equal(inferFlightCommanderFirmwareTarget(parsedHex), "MICOAIR743");
  });

  test("accepts renamed local firmware without requiring a release filename", () => {
    const parsedHex = parsedFirmwareBytes(
      [0x46, 0x43, 0x46, 0x57],
      "MICOAIR743",
    );
    const descriptor = localFlightCommanderFirmwareDescriptor(parsedHex, {
      filename: "known-good-compass-test.hex",
      selectedTarget: "0",
    });

    assert.equal(descriptor.target_id, "MICOAIR743");
    assert.equal(descriptor.version, null);
    assert.equal(descriptor.file, "known-good-compass-test.hex");
    assert.equal(descriptor.targetEvidence, "firmware-content");
  });

  test("uses an explicitly selected supported target when old local firmware has no target string", () => {
    const parsedHex = parsedFirmwareBytes([0x46, 0x43, 0x46, 0x57]);
    const descriptor = localFlightCommanderFirmwareDescriptor(parsedHex, {
      filename: "archive-copy.hex",
      selectedTarget: "MICROAIR743",
    });

    assert.equal(descriptor.target_id, "MICOAIR743");
    assert.equal(descriptor.targetEvidence, "selected-target");
  });
});


test("keeps 3.0.7 and 4.0.6 while removing every verified-bad intervening release", () => {
  const releaseFor = (version, marker) => ({
    draft: false,
    prerelease: true,
    tag_name: `v${version}-beta`,
    assets: [{
      name: `Flight-Commander-Firmware-${version}-MICOAIR743.hex`,
      browser_download_url: `https://example.invalid/${version}.hex`,
      digest: `sha256:${marker.repeat(64)}`,
      size: 1200,
    }],
  });

  const descriptors = flightCommanderReleaseDescriptors([
    releaseFor("3.0.6", "6"),
    releaseFor("3.0.7", "7"),
    releaseFor("3.0.8", "8"),
    releaseFor("4.0.0", "0"),
    releaseFor("4.0.1", "1"),
    releaseFor("4.0.2", "2"),
    releaseFor("4.0.3", "3"),
    releaseFor("4.0.4", "4"),
    releaseFor("4.0.5", "5"),
    releaseFor("4.0.6", "a"),
  ]);
  assert.deepEqual(descriptors.map(({ version }) => version), ["4.0.6", "3.0.7"]);
});
