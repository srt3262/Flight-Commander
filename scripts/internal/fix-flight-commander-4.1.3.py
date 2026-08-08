#!/usr/bin/env python3
"""Apply focused corrections discovered while validating Flight Commander 4.1.3."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, text: str) -> None:
    (ROOT / relative).write_text(text, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    text = read(relative)
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one replacement marker, found {count}: {old[:100]!r}"
        )
    write(relative, text.replace(old, new, 1))


def replace_regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(
        pattern,
        lambda _match: replacement,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one regex marker, found {count}: {pattern[:100]!r}"
        )
    write(relative, updated)


# Keep the native NTRIP user agent coordinated with the Configurator release.
replace_once(
    "js/main/ntripClient.js",
    "User-Agent: NTRIP FlightCommander/4.1.2",
    "User-Agent: NTRIP FlightCommander/4.1.3",
)

# Align source-contract tests with the new local/online flashing policy and the
# official release workflow that replaced the retired beta publisher.
replace_once(
    "tests/flight-commander/packaging/package-contract.test.mjs",
    '''  assert.match(
    packageVerifier,
    /Flash only Flight Commander Firmware built for the detected controller target/,
  );''',
    '''  assert.match(
    packageVerifier,
    /Online selections are verified official or beta Flight Commander releases for the selected target/,
  );
  assert.match(
    packageVerifier,
    /Local HEX files are flashed exactly as selected/,
  );''',
)
replace_once(
    "tests/flight-commander/packaging/package-contract.test.mjs",
    '''  assert.match(releaseOrchestrator, /The beta candidate does not contain exactly the four canonical components/);
  assert.match(releaseOrchestrator, /Complete beta ZIP contains exactly four byte-matched components/);''',
    '''  assert.match(
    releaseOrchestrator,
    /Complete release bundle does not contain exactly the four canonical files/,
  );
  assert.match(
    releaseOrchestrator,
    /Published complete release asset does not match the verified bundle/,
  );''',
)

# Probe AUTOPILOT_VERSION with both commands defined by MAVLink, retry for a
# bounded radio-link window, preserve a validated cached Firmware 4.0.8 profile,
# and still accept a signed identity that arrives after an earlier timeout.
replace_once(
    "js/mavlink/mavlinkSession.js",
    "export const MAV_CMD_REQUEST_MESSAGE = 512;\n",
    "export const MAV_CMD_REQUEST_MESSAGE = 512;\n"
    "export const MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES = 520;\n",
)
replace_once(
    "js/mavlink/mavlinkSession.js",
    '''    this.firmwareDetectionTimer = null;
    this.firmwareDetectionTimeoutMs =
      options.firmwareDetectionTimeoutMs ?? 1500;''',
    '''    this.firmwareDetectionTimer = null;
    this.firmwareDetectionRetryTimer = null;
    this.firmwareDetectionTimeoutMs =
      options.firmwareDetectionTimeoutMs ?? 6000;
    this.firmwareDetectionRetryIntervalMs =
      options.firmwareDetectionRetryIntervalMs ?? 750;''',
)
replace_regex_once(
    "js/mavlink/mavlinkSession.js",
    r"  stopFirmwareDetection\(\) \{.*?\n  \}\n\n\nresolveFlightCommanderIdentity\(\)",
    '''  stopFirmwareDetection() {
    if (this.firmwareDetectionRetryTimer != null) {
      this.clearTimeoutFn(this.firmwareDetectionRetryTimer);
      this.firmwareDetectionRetryTimer = null;
    }
    if (this.firmwareDetectionTimer != null) {
      this.clearTimeoutFn(this.firmwareDetectionTimer);
      this.firmwareDetectionTimer = null;
    }
  }

  resolveFlightCommanderIdentity()''',
)
replace_regex_once(
    "js/mavlink/mavlinkSession.js",
    r"startFirmwareDetection\(\) \{.*?\n\}\n\n  handleFirmwareFingerprint\(envelope\)",
    '''startFirmwareDetection() {
  this.stopFirmwareDetection();
  if (this.applyFirmwareFamilyOverride()) return;

  if (
    this.state.autopilot !== MAV_AUTOPILOT_GENERIC &&
    this.state.autopilot !== MAV_AUTOPILOT_ARDUPILOTMEGA
  ) {
    this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "autopilot-family");
    return;
  }

  const cachedIdentity = this.resolveFlightCommanderIdentity();
  if (cachedIdentity) {
    this.state.flightCommanderCapabilities = cachedIdentity.capabilities;
    this.setFirmwareFamily(
      FIRMWARE_FAMILY_FLIGHT_COMMANDER,
      cachedIdentity.source,
    );
  } else {
    this.setFirmwareFamily(FIRMWARE_FAMILY_UNKNOWN, "probing");
  }

  if (
    !cachedIdentity &&
    this.state.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA
  ) {
    this.send("ParamRequestList", this.target()).catch(() => {});
  }

  const attachment = this.activeAttachment("firmware detection");
  const probe = () => {
    if (!this.attachmentIsCurrent(attachment)) return;
    this.requestFlightCommanderIdentity().catch(() => {});
    this.firmwareDetectionRetryTimer = timerUnref(
      this.setTimeoutFn(probe, this.firmwareDetectionRetryIntervalMs),
    );
  };
  probe();

  this.firmwareDetectionTimer = timerUnref(
    this.setTimeoutFn(() => {
      this.firmwareDetectionTimer = null;
      if (this.firmwareDetectionRetryTimer != null) {
        this.clearTimeoutFn(this.firmwareDetectionRetryTimer);
        this.firmwareDetectionRetryTimer = null;
      }
      if (!this.attachmentIsCurrent(attachment)) return;
      if (this.state.firmwareFamily === FIRMWARE_FAMILY_UNKNOWN) {
        this.setFirmwareFamily(FIRMWARE_FAMILY_UNSUPPORTED, "probe-timeout");
      }
    }, this.firmwareDetectionTimeoutMs),
  );
}

  handleFirmwareFingerprint(envelope)''',
)
replace_once(
    "js/mavlink/mavlinkSession.js",
    '''  requestAutopilotVersion() {
    return this.send("CommandLong", {
      ...this.target(),
      command: MAV_CMD_REQUEST_MESSAGE,
      confirmation: 0,
      param1: MAVLINK_MSG_ID_AUTOPILOT_VERSION,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }''',
    '''  requestAutopilotCapabilities() {
    return this.send("CommandLong", {
      ...this.target(),
      command: MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES,
      confirmation: 0,
      param1: 1,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  requestAutopilotVersion() {
    return this.send("CommandLong", {
      ...this.target(),
      command: MAV_CMD_REQUEST_MESSAGE,
      confirmation: 0,
      param1: MAVLINK_MSG_ID_AUTOPILOT_VERSION,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  requestFlightCommanderIdentity() {
    return Promise.allSettled([
      this.requestAutopilotCapabilities(),
      this.requestAutopilotVersion(),
    ]);
  }''',
)

# Exercise the dual request path and prove that the bounded probe timer cannot
# downgrade a uniquely matched legacy Firmware 4.0.8 profile.
replace_once(
    "tests/flight-commander/mavlink/session.test.mjs",
    '''  FIRMWARE_FAMILY_UNSUPPORTED,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MavlinkSession,''',
    '''  FIRMWARE_FAMILY_UNSUPPORTED,
  MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES,
  MAV_CMD_REQUEST_MESSAGE,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MavlinkSession,''',
)
replace_once(
    "tests/flight-commander/mavlink/session.test.mjs",
    '''  test("recognizes legacy Firmware 4.0.8 from one cached wired Flight Commander profile", () => {
    const capabilities = FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS |
      FLIGHT_COMMANDER_CAPABILITIES.MISSION_RESUME;
    const { session } = createAttachedSession({
      flightCommanderIdentityResolver(state) {
        assert.equal(state.systemId, 23);
        assert.equal(state.autopilot, 0);
        return { capabilities, source: "legacy-msp-profile" };
      },
    });

    session.handleMessage(heartbeat({ autopilot: 0, sysid: 23 }));

    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(session.state.firmwareFamilySource, "legacy-msp-profile");
    assert.equal(session.state.flightCommanderCapabilities, capabilities);
  });''',
    '''  test("recognizes legacy Firmware 4.0.8 from one cached wired Flight Commander profile", () => {
    const capabilities = FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS |
      FLIGHT_COMMANDER_CAPABILITIES.MISSION_RESUME;
    const { session } = createAttachedSession({
      flightCommanderIdentityResolver(state) {
        assert.equal(state.systemId, 23);
        assert.equal(state.autopilot, 0);
        return { capabilities, source: "legacy-msp-profile" };
      },
    });

    session.handleMessage(heartbeat({ autopilot: 0, sysid: 23 }));

    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(session.state.firmwareFamilySource, "legacy-msp-profile");
    assert.equal(session.state.flightCommanderCapabilities, capabilities);
  });

  test("requests Flight Commander identity through both standard MAVLink commands", async () => {
    const { session, bridge } = createAttachedSession({
      firmwareDetectionTimeoutMs: 100,
      firmwareDetectionRetryIntervalMs: 50,
    });
    session.handleMessage(heartbeat({ autopilot: 0, sysid: 24 }));
    await Promise.resolve();
    await Promise.resolve();

    const commands = bridge.encoded
      .filter(({ messageName }) => messageName === "CommandLong")
      .map(({ payload }) => payload.command);
    assert.ok(commands.includes(MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES));
    assert.ok(commands.includes(MAV_CMD_REQUEST_MESSAGE));
  });

  test("does not downgrade a cached Firmware 4.0.8 identity when probing ends", async () => {
    const capabilities = FLIGHT_COMMANDER_CAPABILITIES.NATIVE_GCS_COMMANDS;
    const { session } = createAttachedSession({
      firmwareDetectionTimeoutMs: 10,
      firmwareDetectionRetryIntervalMs: 3,
      flightCommanderIdentityResolver: () => ({
        capabilities,
        source: "legacy-msp-profile",
      }),
    });
    session.handleMessage(heartbeat({ autopilot: 0, sysid: 25 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(session.state.firmwareFamily, FIRMWARE_FAMILY_FLIGHT_COMMANDER);
    assert.equal(session.state.firmwareFamilySource, "legacy-msp-profile");
    assert.equal(session.state.flightCommanderCapabilities, capabilities);
  });''',
)

print("Applied focused Flight Commander 4.1.3 corrections.")
