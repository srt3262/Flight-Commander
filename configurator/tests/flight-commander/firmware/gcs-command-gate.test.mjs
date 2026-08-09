import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const configuratorRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const repositoryRoot = resolve(configuratorRoot, "..");
const source = (relative) =>
  readFileSync(resolve(repositoryRoot, relative), "utf8");

test("native commands require the physical GCS NAV authorization input", () => {
  const commands = source("src/main/flight_commander/gcs_commands.c");
  const modes = source("src/main/fc/rc_modes.c");
  const mavlink = source("src/main/telemetry/mavlink.c");
  const navigation = source("src/main/navigation/navigation.c");
  const target = source("cmake/flight-commander-micoair743.cmake");

  assert.match(target, /flight_commander\/gcs_commands\.c/);
  assert.match(target, /USE_FLIGHT_COMMANDER_GCS_COMMANDS/);
  assert.match(modes, /isRcModeActiveFromInput/);
  assert.match(
    commands,
    /flightCommanderGcsIsEnabled[\s\S]+isRcModeActiveFromInput\(BOXGCSNAV\)/,
  );
  assert.match(
    commands,
    /modeId == BOXGCSNAV[\s\S]+return false;/,
  );
  assert.match(
    commands,
    /gcsNavWasActive && !gcsNavIsActive[\s\S]+armControlActive = false/,
  );

  const authorizationCheck = mavlink.indexOf(
    "if (!flightCommanderGcsIsEnabled())",
  );
  const commandDispatch = mavlink.indexOf(
    "switch (msg->command)",
    authorizationCheck,
  );
  assert.ok(authorizationCheck >= 0, "firmware authorization check is missing");
  assert.ok(
    commandDispatch > authorizationCheck,
    "authorization must run before native command dispatch",
  );
  assert.match(mavlink, /case MAVLINK_MSG_ID_COMMAND_LONG:/);
  assert.match(mavlink, /case MAVLINK_MSG_ID_MISSION_SET_CURRENT:/);
  assert.match(
    mavlink,
    /handleIncoming_COMMAND_INT[\s\S]+MAV_CMD_DO_REPOSITION[\s\S]+!flightCommanderGcsIsEnabled\(\)[\s\S]+MAV_RESULT_DENIED/,
  );
  assert.match(
    mavlink,
    /GUIDED_ENABLED[\s\S]+isRcModeActiveFromInput\(BOXGCSNAV\)/,
  );
  assert.match(
    navigation,
    /GCS mission-start staging retains its index separately[\s\S]+activeWaypointIndex = posControl\.startWpIndex/,
  );
  assert.match(
    commands,
    /missionIndexStaged && ARMING_FLAG\(ARMED\) && gcsNavIsActive[\s\S]+requestedMode = BOXNAVWP/,
  );
  assert.match(
    commands,
    /modeId == BOXNAVWP && !ARMING_FLAG\(ARMED\)[\s\S]+flightCommanderGcsStartMission/,
  );
  assert.match(
    commands,
    /getStateOfForcedRTH\(\) != RTH_IDLE[\s\S]+abortForcedRTH\(\)[\s\S]+forcedRthActive = false/,
  );
  assert.match(
    commands,
    /navigationIsExecutingAnEmergencyLanding\(\)[\s\S]+abortForcedEmergLanding\(\)[\s\S]+forcedLandingActive = false/,
  );
});

test("the native command surface retains normal iNav safety checks", () => {
  const mavlink = source("src/main/telemetry/mavlink.c");

  for (const command of [
    "MAV_CMD_DO_SET_MODE",
    "MAV_CMD_COMPONENT_ARM_DISARM",
    "MAV_CMD_MISSION_START",
    "MAV_CMD_DO_PAUSE_CONTINUE",
    "MAV_CMD_NAV_RETURN_TO_LAUNCH",
    "MAV_CMD_NAV_LAND",
    "MAV_CMD_NAV_TAKEOFF",
  ]) {
    assert.match(mavlink, new RegExp(`case ${command}:`), command);
  }
  assert.match(mavlink, /tryArm\(\)/);
  assert.match(
    mavlink,
    /!failsafeIsActive\(\)[\s\S]+armingConfig\(\)->disarm_always[\s\S]+throttleStickIsLow\(\)/,
  );
  assert.doesNotMatch(
    mavlink,
    /param2\s*==\s*21196|param2\s*==\s*21196\.0f/,
  );
});
