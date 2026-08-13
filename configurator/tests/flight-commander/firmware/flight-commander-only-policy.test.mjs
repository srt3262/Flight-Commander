import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const text = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Flight Commander 4.2.4 keeps one product without runtime identity or stale-profile gates", () => {
  const packageJson = JSON.parse(text("package.json"));
  const flasherHtml = text("tabs/firmware_flasher.html");
  const flasherSource = text("tabs/firmware_flasher.js");
  const catalog = text("js/flightCommander/firmwareCatalog.js");
  const session = text("js/mavlink/mavlinkSession.js");
  const router = text("js/gcs/mavlinkCommandRouter.js");
  const routerInstance = text("js/gcs/mavlinkCommandRouterInstance.js");
  const serialBackend = text("js/serial_backend.js");
  const landing = text("tabs/landing.html");
  const featureSurfaces = [
    "tabs/calibration.js",
    "tabs/configuration.js",
    "tabs/flight_planner.js",
    "tabs/gps.js",
    "tabs/magnetometer.js",
    "tabs/ports.js",
  ].map(text).join("\n");

  assert.equal(packageJson.version, "4.2.4");
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.2.0");
  assert.match(flasherHtml, /Online Flight Commander Firmware \/ Local HEX/);
  assert.doesNotMatch(flasherHtml, /value="inav"|Official INAV/);
  assert.match(flasherSource, /if \(local\) \{[\s\S]+flashed as supplied/);
  assert.match(flasherSource, /!localFirmwareLoaded && loadedFirmwareFamily/);
  assert.match(catalog, /publishedReleaseChannel/);
  assert.match(catalog, /status: channel/);
  assert.match(session, /flight-commander-product-policy/);
  assert.match(session, /MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES/);
  assert.match(router, /new FlightCommanderMavlinkCommandAdapter/);
  assert.match(router, /GCS NAV remains the pilot authorization gate/);
  assert.doesNotMatch(router, /cached Flight Commander command profile/i);
  assert.doesNotMatch(router, /configured AUX range/i);
  assert.doesNotMatch(router, /RcChannelsOverride|RC_CHANNELS_OVERRIDE/);
  assert.doesNotMatch(router, /profileStore|InavMavlinkProfileStore/);
  assert.doesNotMatch(router, /Multiple INAV controller profiles/);
  assert.doesNotMatch(router, /Select the controller profile/);
  assert.doesNotMatch(routerInstance, /profileStore|inavMavlinkProfileStore/);
  assert.doesNotMatch(serialBackend, /captureFromMsp|command profile saved/);
  assert.doesNotMatch(serialBackend, /configuration, missions, and commands are disabled/);
  assert.doesNotMatch(featureSurfaces, /firmwareFeatureSupport/);
  assert.match(landing, /Flight Commander capabilities/);
  assert.match(landing, /USB RTK base workflows/);
  assert.doesNotMatch(
    landing,
    /retired stock-firmware|compatibility path|have been removed|removal of/i,
  );
});
