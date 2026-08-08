import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const text = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Flight Commander 4.1.3 keeps one Flight Commander operating product", () => {
  const packageJson = JSON.parse(text("package.json"));
  const flasherHtml = text("tabs/firmware_flasher.html");
  const flasherSource = text("tabs/firmware_flasher.js");
  const catalog = text("js/flightCommander/firmwareCatalog.js");
  const session = text("js/mavlink/mavlinkSession.js");
  const router = text("js/gcs/mavlinkCommandRouter.js");
  const landing = text("tabs/landing.html");

  assert.equal(packageJson.version, "4.1.3");
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.0.8");
  assert.match(flasherHtml, /Online Flight Commander Firmware \/ Local HEX/);
  assert.doesNotMatch(flasherHtml, /value="inav"|Official INAV/);
  assert.match(flasherSource, /if \(local\) \{[\s\S]+flashed as supplied/);
  assert.match(flasherSource, /!localFirmwareLoaded && loadedFirmwareFamily/);
  assert.match(catalog, /publishedReleaseChannel/);
  assert.match(catalog, /status: channel/);
  assert.match(session, /resolveFlightCommanderIdentity/);
  assert.match(session, /legacy cached proof/);
  assert.match(router, /resolveCachedFlightCommanderIdentity/);
  assert.match(router, /legacy-msp-profile/);
  assert.match(landing, /Flight Commander capabilities/);
  assert.match(landing, /USB RTK base workflows/);
  assert.doesNotMatch(
    landing,
    /retired stock-firmware|compatibility path|have been removed|removal of/i,
  );
});
