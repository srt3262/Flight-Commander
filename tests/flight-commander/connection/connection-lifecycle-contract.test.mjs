import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const serialBackend = readFileSync(
  resolve(projectRoot, "js/serial_backend.js"),
  "utf8",
);
const connectionSerial = readFileSync(
  resolve(projectRoot, "js/connection/connectionSerial.js"),
  "utf8",
);
const connectionBase = readFileSync(
  resolve(projectRoot, "js/connection/connection.js"),
  "utf8",
);
const connectionShell = readFileSync(
  resolve(projectRoot, "index.html"),
  "utf8",
);
const mainSerial = readFileSync(
  resolve(projectRoot, "js/main/serial.js"),
  "utf8",
);
const firmwareSerial = readFileSync(
  resolve(projectRoot, "js/connection/electronSerialByteTransport.js"),
  "utf8",
);
const configuratorMain = readFileSync(
  resolve(projectRoot, "js/configurator_main.js"),
  "utf8",
);
const mavlinkSession = readFileSync(
  resolve(projectRoot, "js/mavlink/mavlinkSession.js"),
  "utf8",
);
const mavlinkTransportStartup = readFileSync(
  resolve(projectRoot, "js/gcs/mavlinkTransportStartup.js"),
  "utf8",
);
const mavlinkCommandRouter = readFileSync(
  resolve(projectRoot, "js/gcs/mavlinkCommandRouter.js"),
  "utf8",
);
const flightData = readFileSync(
  resolve(projectRoot, "tabs/flight_data.js"),
  "utf8",
);
const englishMessages = JSON.parse(
  readFileSync(resolve(projectRoot, "locale/en/messages.json"), "utf8"),
);

test("serial open uses protocol-specific options and does not persist an unvalidated shared baud", () => {
  assert.match(serialBackend, /serialOptionsForProtocol\(requestedProtocol,\s*selected_baud\)/);
  assert.match(serialBackend, /rememberValidatedBaud/);
  assert.doesNotMatch(serialBackend, /store\.set\(['"]last_used_bps['"]/);
  assert.match(
    connectionShell,
    /<option value="auto"[^>]*>Auto protocol \(selected baud\)<\/option>/,
  );
});

test("explicit MAVLink serial options reach the Windows control-line setup", () => {
  assert.match(
    serialBackend,
    /CONFIGURATOR\.connection\.connect\(\s*selected_port,\s*serialOptionsForProtocol\(requestedProtocol,\s*selected_baud\)/,
  );
  assert.match(
    mainSerial,
    /new SerialPortStream\(\{\s*binding,\s*path:\s*path,\s*baudRate:\s*options\.bitrate/,
  );
  assert.match(
    mainSerial,
    /\.\.\.serialOpenControlLineOptions\(options\)/,
  );
  assert.match(mainSerial, /await prepareSerialPort\(port,\s*options\)/);
});

test("MAVLink listener installation precedes attach and explicit transport opens Ground Control", () => {
  const subscribe = serialBackend.indexOf(
    "privateScope.mavlinkConnectedUnsubscribe = mavlinkSession.on('connected'",
  );
  const attach = serialBackend.indexOf(
    "mavlinkSession.attach(CONFIGURATOR.connection)",
    subscribe,
  );
  assert.ok(subscribe >= 0 && attach > subscribe);
  assert.match(
    serialBackend,
    /requestedProtocol === 'mavlink'[\s\S]*?showWaitingState: privateScope\.onMavlinkTransportOpen/,
  );
  assert.match(
    serialBackend,
    /MAVLink \/ Waiting for vehicle heartbeat/,
  );
  assert.match(
    serialBackend,
    /Flight Commander will keep listening/,
  );
  assert.match(
    serialBackend,
    /initializeExplicitMavlinkTransport\(\{[\s\S]*?showWaitingState:[\s\S]*?scheduleNoHeartbeatTimeout:[\s\S]*?attachSession:/,
  );
  assert.match(
    mavlinkTransportStartup,
    /showWaitingState\(\);[\s\S]*?scheduleNoHeartbeatTimeout\(\);[\s\S]*?attachSession\(\);/,
  );
  assert.match(
    serialBackend,
    /runCriticalMavlinkTransition\(\{[\s\S]*?onMavlinkConnected\(state\)[\s\S]*?onMavlinkConnectedTransitionFailure/,
  );
  assert.match(
    serialBackend,
    /onMavlinkTransportStartupFailure = function[\s\S]*?GUI\.log\(/,
  );
  assert.match(
    serialBackend,
    /onMavlinkConnectedTransitionFailure = function[\s\S]*?GUI\.log\(/,
  );
  assert.doesNotMatch(serialBackend, /scheduleMavlinkFailureAbort/);
});

test("serial open completion uses the immutable protocol captured by the click attempt", () => {
  assert.match(
    serialBackend,
    /const openAttempt = Object\.freeze\(\{[\s\S]*?protocol: requestedProtocol,[\s\S]*?bitrate: selected_baud/,
  );
  assert.match(
    serialBackend,
    /const handleOpen = openInfo => privateScope\.onOpen\(openInfo, openAttempt\)/,
  );
  assert.match(
    serialBackend,
    /openAttempt\?\.protocol \|\| privateScope\.\$protocol\.val\(\) \|\| 'auto'/,
  );
  assert.match(
    serialBackend,
    /privateScope\.pendingOpenAttempt !== openAttempt[\s\S]*?return;[\s\S]*?CONFIGURATOR\.connection\.connect\("127\.0\.0\.1:5760"/,
  );
});

test("INAV save-and-reboot reconnect is bounded and performs a full close/reopen retry", () => {
  assert.match(
    serialBackend,
    /GUI\.handleReconnect = function[\s\S]*?createInavRebootRecoveryAttempt\([\s\S]*?privateScope\.activeOpenAttempt[\s\S]*?reConnect\(\s*rebootOpenAttempt \? \{openAttempt: rebootOpenAttempt\} : \{\}/,
  );
  assert.match(
    serialBackend,
    /requestedAttempt\?\.rebootRecoveryAttempt > 0[\s\S]*?rebootRecoveryAttempt:\s*requestedAttempt\.rebootRecoveryAttempt/,
  );
  assert.match(
    serialBackend,
    /!CONFIGURATOR\.connectionValid &&\s*openAttempt\?\.rebootRecoveryAttempt > 0[\s\S]*?retryInavRebootConnection\(openAttempt\)/,
  );
  assert.match(
    serialBackend,
    /nextInavRebootRecoveryAttempt\(openAttempt\)[\s\S]*?pendingReconnectRequest = \{openAttempt: nextAttempt\}[\s\S]*?reConnect\(\{forceDisconnect: true\}\)/,
  );
  assert.match(
    serialBackend,
    /INAV did not respond after three post-reboot[\s\S]*?serial port has been closed/,
  );
});

test("bytes received while the COM open promise is resolving are buffered and flushed", () => {
  assert.match(connectionSerial, /this\.queuePendingIpcEvent\('data', envelope\)/);
  assert.match(connectionSerial, /this\._receiveReady = true/);
  assert.match(
    connectionSerial,
    /pending\.forEach\(\(\{type, envelope\}\) =>/,
  );
});

test("serial IPC data, close and error events are scoped to one connection ID", () => {
  for (const channel of ["serialData", "serialClose", "serialError"]) {
    assert.match(
      mainSerial,
      new RegExp(`webContents\\.send\\('${channel}', \\{\\s*connectionId,`),
    );
  }
  assert.match(
    connectionSerial,
    /envelope\.connectionId === this\._connectionId/,
  );
  assert.match(
    connectionSerial,
    /this\.dispatchIpcEvent\(type, envelope\)/,
  );
  assert.match(
    firmwareSerial,
    /envelope\?\.connectionId !== this\.connectionId/,
  );
  assert.match(
    connectionSerial,
    /serialSend\(data, this\._connectionId\)/,
  );
  assert.match(
    connectionSerial,
    /serialClose\(this\._connectionId\)/,
  );
  assert.match(
    mainSerial,
    /connectionId === this\._connectionId/,
  );
});

test("unexpected native serial termination survives cleanup without a false success", () => {
  assert.match(
    connectionSerial,
    /consumeDisconnectCause\(\)[\s\S]*?this\._disconnectCause = null/,
  );
  assert.match(
    connectionSerial,
    /this\._nativeDeadConnectionId === this\._connectionId[\s\S]*?callback\(true\)[\s\S]*?return;/,
  );
  assert.match(
    serialBackend,
    /consumeDisconnectCause\?\.\(\) \|\| null/,
  );
  assert.match(
    serialBackend,
    /onClosed = function \(result, closeContext = \{\}\)[\s\S]*?if \(unexpectedCause\)[\s\S]*?unexpectedSerialTerminationMessage/,
  );
  assert.match(
    serialBackend,
    /shouldAttemptMavlinkStartupRecovery\(\{[\s\S]*?connectedDurationMs/,
  );
  assert.match(
    connectionBase,
    /typeof GUI\.handleConnectionAbort === 'function'[\s\S]*?GUI\.handleConnectionAbort\(\)/,
  );
  assert.match(
    serialBackend,
    /GUI\.handleConnectionAbort = function \(\)[\s\S]*?forceDisconnect: true/,
  );
  assert.match(
    serialBackend,
    /GUI\.connect_lock != true \|\| forceDisconnect/,
  );
  assert.match(
    serialBackend,
    /if \(privateScope\.disconnectInProgress\)[\s\S]*?privateScope\.pendingReconnectRequest = options\.openAttempt/,
  );
  assert.match(
    serialBackend,
    /Date\.now\(\) < privateScope\.unexpectedTerminalOperatorGuardUntil[\s\S]*?cancelUnexpectedSerialRecovery\(\)/,
  );
  const finishDisconnect = serialBackend.indexOf(
    "function finishDisconnect()",
  );
  const nativeDisconnect = serialBackend.indexOf(
    "CONFIGURATOR.connection.disconnect(handleClosed)",
    finishDisconnect,
  );
  const protocolCleanup = serialBackend.indexOf(
    "() => privateScope.clearProtocolSession({",
    finishDisconnect,
  );
  assert.ok(
    finishDisconnect >= 0 &&
      nativeDisconnect > finishDisconnect &&
      protocolCleanup > nativeDisconnect,
  );
  assert.match(
    serialBackend,
    /const reconnectRequest =\s*privateScope\.pendingReconnectRequest[\s\S]*?privateScope\.disconnectInProgress = false[\s\S]*?privateScope\.reConnect\(reconnectRequest\)/,
  );
});

test("a delayed old send callback cannot mutate the new connection queue", () => {
  assert.match(connectionBase, /this\._outputGeneration = 0/);
  assert.match(
    connectionBase,
    /currentEntry\.generation !== this\._outputGeneration/,
  );
  assert.match(
    connectionBase,
    /this\._outputBuffer\[0\] !== currentEntry/,
  );
  assert.match(
    connectionBase,
    /this\._outputGeneration \+= 1/,
  );
  assert.match(
    connectionBase,
    /this\._outputBuffer\.length >= 100/,
  );
});

test("native serial open and cleanup paths are bounded", () => {
  assert.match(mainSerial, /SERIAL_OPEN_TIMEOUT_MS = 10000/);
  assert.match(mainSerial, /Serial port open timed out after \$\{openTimeoutMs\} ms/);
  assert.match(mainSerial, /await disposeSerialPort\(port\)/);
  assert.match(
    mainSerial,
    /oldPort\.opening && !oldPort\.isOpen[\s\S]*?quarantineOpeningSerialPort\(oldPort\)/,
  );
  assert.match(
    mainSerial,
    /openGeneration !== this\._openGeneration[\s\S]*?this\._serialport !== port/,
  );
  assert.match(
    mainSerial,
    /Serial port open was superseded by a newer connection/,
  );
});

test("stale disconnect completion cannot clear a replacement connection", () => {
  assert.match(connectionBase, /this\._lifecycleGeneration = 0/);
  assert.match(
    connectionBase,
    /const closingConnectionId = this\._connectionId/,
  );
  assert.match(
    connectionBase,
    /lifecycleGeneration !== this\._lifecycleGeneration/,
  );
  assert.match(
    connectionBase,
    /this\._connectionId !== closingConnectionId/,
  );
  assert.match(connectionBase, /this\._openGeneration = 0/);
  assert.match(
    connectionBase,
    /openGeneration !== this\._openGeneration/,
  );
});

test("Ground Control can render before heartbeat while commands and mission reads remain gated", () => {
  assert.match(
    configuratorMain,
    /mavlinkTransportGroundControl[\s\S]*?CONFIGURATOR\.connectionProtocol === 'mavlink'/,
  );
  assert.match(
    flightData,
    /if \(initialState\.connected\) \{[\s\S]*?requestDataStreams\(5\)/,
  );
  assert.match(
    flightData,
    /vehicleJustConnected[\s\S]*?this\.loadVehicleMission\(\)/,
  );
  assert.match(
    flightData,
    /!CONFIGURATOR\.connectionValid[\s\S]*?!\['msp', 'mavlink'\]\.includes\(this\.protocol\)/,
  );
  assert.match(
    flightData,
    /const initializeGeneration = \+\+this\.initializeGeneration/,
  );
  assert.match(
    flightData,
    /initializeGeneration === this\.initializeGeneration[\s\S]*?GUI\.active_tab === this/,
  );
  assert.match(
    flightData,
    /flightData\.cleanup = function[\s\S]*?this\.initializeGeneration \+= 1/,
  );
});

test("Ground Control mission reads are scoped to one MAVLink attachment", () => {
  assert.match(
    flightData,
    /this\.unsubscribeDetached\?\.\(\);[\s\S]*?this\.unsubscribeDetached = mavlinkSession\.on\('detached'/,
  );
  assert.match(
    flightData,
    /mavlinkAttachmentGeneration[\s\S]*?invalidateMavlinkAttachment[\s\S]*?controller\.abort\(\)/,
  );
  assert.match(
    flightData,
    /withAbortSignal\([\s\S]*?waitForFirmwareFamily\(\)[\s\S]*?abortController\.signal/,
  );
  assert.match(
    flightData,
    /mavlinkMissionManager\.download\([\s\S]*?signal: abortController\.signal/,
  );
  assert.match(
    flightData,
    /if \(!attachmentIsCurrent\(\)\) return;[\s\S]*?this\.mission = mission/,
  );
  assert.match(
    flightData,
    /error\.name === 'AbortError'[\s\S]*?return;/,
  );
});

test("first heartbeat distinguishes live telemetry from control readiness", () => {
  assert.match(
    flightData,
    /live telemetry is active; '\s*\+\s*'supported controls unlock after identification and safety checks\./,
  );
  assert.doesNotMatch(
    flightData,
    /MAVLink vehicle heartbeat received; live controls are available\./,
  );
  assert.match(
    serialBackend,
    /activeMavlinkHeartbeatReceived = true/,
  );
  assert.match(
    serialBackend,
    /hadVehicleHeartbeat:\s*privateScope\.activeMavlinkHeartbeatReceived/,
  );
  assert.match(
    flightData,
    /const linkReady = \(\s*CONFIGURATOR\.connectionValid\s*&&\s*state\.connected/,
  );
  assert.match(
    flightData,
    /this\.protocol !== 'mavlink'\s*\|\|\s*!CONFIGURATOR\.connectionValid/,
  );
  assert.match(
    mavlinkCommandRouter,
    /blockCommands\(reason\)[\s\S]*?this\.commandBlockReason/,
  );
  assert.match(
    serialBackend,
    /onMavlinkConnectedTransitionFailure = function[\s\S]*?mavlinkCommandRouter\.blockCommands\(message\)/,
  );
});

test("vehicle validation precedes firmware state and the first mission read", () => {
  const connected = mavlinkSession.indexOf(
    'this.emit("connected", this.snapshot())',
  );
  const firmwareDetection = mavlinkSession.indexOf(
    "this.startFirmwareDetection()",
    connected,
  );
  assert.ok(connected >= 0 && firmwareDetection > connected);
  assert.match(
    flightData,
    /vehicleJustConnected[\s\S]*?this\.loadVehicleMission\(\)/,
  );
});

test("English serial status does not mislabel every transport as MSP", () => {
  for (const key of [
    "serialPortOpened",
    "serialPortOpenFail",
    "serialPortClosedOk",
    "serialPortClosedFail",
  ]) {
    assert.doesNotMatch(englishMessages[key].message, /\bMSP\b/);
    assert.match(englishMessages[key].message, /serial transport/i);
  }
});
