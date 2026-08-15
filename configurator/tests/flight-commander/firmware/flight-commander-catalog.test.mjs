import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
  FLIGHT_COMMANDER_FIRMWARE_TARGETS,
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

const testDirectory = dirname(fileURLToPath(import.meta.url));
const officialTargets = readFileSync(
  resolve(testDirectory, "../../../../flight-commander/official-targets.txt"),
  "utf8",
)
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("|", 1)[0]);

function asset(version, marker, suffix = "", target = "MICOAIR743") {
  return {
    name: `Flight-Commander-Firmware-${version}-${target}${suffix}.hex`,
    browser_download_url: `https://example.invalid/${version}-${target}${suffix}.hex`,
    digest: `sha256:${marker.repeat(64)}`,
    size: 1200,
  };
}

function release({
  version,
  marker,
  prerelease = false,
  tag = `v${version}`,
  name = `Flight Commander ${version}`,
  published = "2026-08-08T12:00:00Z",
  assets = null,
  draft = false,
}) {
  return {
    draft,
    prerelease,
    tag_name: tag,
    name,
    html_url: `https://example.invalid/releases/${tag}`,
    published_at: published,
    body: `${name} notes`,
    assets: assets ?? [asset(version, marker)],
  };
}

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
  test("uses the Flight Commander GitHub Releases feed and supported baselines", () => {
    assert.equal(
      FLIGHT_COMMANDER_FIRMWARE_RELEASES_URL,
      "https://api.github.com/repos/srt3262/Flight-Commander/releases?per_page=20",
    );
    assert.equal(FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION, "4.0.7");
    assert.deepEqual(FLIGHT_COMMANDER_KNOWN_GOOD_FIRMWARE_VERSIONS, ["3.0.7"]);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("3.0.7"), true);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.6"), false);
    assert.equal(isSupportedFlightCommanderFirmwareVersion("4.0.8"), true);
    assert.equal(normalizeFirmwareTarget("MICROAIR743"), "MICOAIR743");
    assert.equal(normalizeFirmwareTarget("CubeOrange+"), "CUBEORANGEPLUS");
    assert.equal(normalizeFirmwareTarget("aeth743basic"), "AETH743Basic");
    assert.equal(FLIGHT_COMMANDER_FIRMWARE_TARGETS.length, 50);
    assert.deepEqual(
      FLIGHT_COMMANDER_FIRMWARE_TARGETS.map(({ id }) => id),
      officialTargets,
    );
  });

  test("parses canonical release filenames", () => {
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-4.0.8-MICOAIR743.hex",
      ).version,
      "4.0.8",
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-3.0.7-MICOAIR743-BENCH-ONLY.hex",
      ).benchOnly,
      true,
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-4.1.8-CUBEORANGEPLUS.hex",
      ).target_id,
      "CUBEORANGEPLUS",
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-4.3.1-AETH743Basic.hex",
      ).target_id,
      "AETH743Basic",
    );
    assert.equal(
      parseFlightCommanderFirmwareFilename(
        "Flight-Commander-Firmware-4.3.1-MICOAIR743_EXTMAG.hex",
      ).target_id,
      "MICOAIR743_EXTMAG",
    );
    assert.equal(parseFlightCommanderFirmwareFilename("arducopter.apj"), null);
  });

  test("offers only official and beta assets and suppresses duplicates", () => {
    const releases = [
      release({ version: "4.0.8", marker: "a", prerelease: true, tag: "v4.0.8-beta", name: "4.0.8 Beta" }),
      release({ version: "4.0.8", marker: "b", published: "2026-08-09T12:00:00Z" }),
      release({ version: "4.1.2", marker: "c", tag: "v4.1.2", assets: [asset("4.0.8", "c")] }),
      release({ version: "4.0.9", marker: "d", prerelease: true, tag: "v4.0.9-rc1", name: "4.0.9 RC1" }),
      release({ version: "4.1.0", marker: "e", prerelease: true, tag: "v4.1.0-dev", name: "development" }),
      release({ version: "4.0.7", marker: "f", prerelease: true, tag: "v4.0.7-beta", name: "4.0.7 Beta" }),
      release({ version: "4.0.8", marker: "9", prerelease: true, tag: "v4.0.8-beta", assets: [asset("4.0.8", "9", "-BENCH-ONLY")] }),
      release({ version: "9.9.9", marker: "9", draft: true }),
    ];
    const descriptors = flightCommanderReleaseDescriptors(releases);
    assert.deepEqual(
      descriptors.map(({ version, status }) => [version, status]),
      [["4.0.8", "official"], ["4.0.7", "beta"]],
    );
    assert.equal(descriptors[0].digest, `sha256:${"b".repeat(64)}`);
    assert.equal(catalogByTarget(descriptors).MICOAIR743.length, 2);
    assert.deepEqual(catalogByTarget(descriptors).CUBEORANGEPLUS, []);
  });

  test("verifies online byte count and GitHub SHA-256", async () => {
    const hex = ":020000040800F2\n:00000001FF\n";
    const payload = new TextEncoder().encode(hex);
    const digest = createHash("sha256").update(payload).digest("hex");
    assert.equal(
      await verifyFlightCommanderOnlinePayload(payload, {
        bytes: payload.byteLength,
        digest: `sha256:${digest}`,
      }),
      hex,
    );
    await assert.rejects(
      verifyFlightCommanderOnlinePayload(payload, {
        bytes: payload.byteLength,
        digest: `sha256:${"0".repeat(64)}`,
      }),
      /SHA-256 verification failed/,
    );
  });

  test("keeps identity and target helpers for verified online assets", () => {
    const parsed = parsedFirmwareBytes(
      [0x46, 0x43, 0x46, 0x57],
      "MICOAIR743\0",
    );
    assert.equal(parsedHexContainsFlightCommanderIdentity(parsed), true);
    assert.equal(inferFlightCommanderFirmwareTarget(parsed), "MICOAIR743");
    assert.equal(
      localFlightCommanderFirmwareDescriptor(parsed, {
        filename: "renamed.hex",
        selectedTarget: "0",
      }).target_id,
      "MICOAIR743",
    );

    const cube = parsedFirmwareBytes(
      [0x46, 0x43, 0x46, 0x57],
      "CUBEORANGEPLUS\0",
    );
    assert.equal(inferFlightCommanderFirmwareTarget(cube), "CUBEORANGEPLUS");
    assert.equal(
      localFlightCommanderFirmwareDescriptor(cube).target_id,
      "CUBEORANGEPLUS",
    );

    const externalMag = parsedFirmwareBytes(
      [0x46, 0x43, 0x46, 0x57],
      "MICOAIR743_EXTMAG\0",
    );
    assert.equal(
      inferFlightCommanderFirmwareTarget(externalMag),
      "MICOAIR743_EXTMAG",
    );
  });
});
