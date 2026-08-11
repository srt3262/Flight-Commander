import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    SLCAN_BRIDGE_ENTRY_RESULT,
    SLCAN_BRIDGE_ENTRY_RESULT_LABELS,
    decodeSlcanBridgeResponse,
    encodeSlcanBridgeEnter,
} from '../../../js/flightCommander/slcanBridge.js';

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repositoryRoot = resolve(configuratorRoot, '..');
const source = (relative) => readFileSync(resolve(repositoryRoot, relative), 'utf8');

test('SLCAN bridge entry uses a strict versioned MSP contract', () => {
    assert.deepEqual([...encodeSlcanBridgeEnter()], [1]);

    const accepted = decodeSlcanBridgeResponse([1, SLCAN_BRIDGE_ENTRY_RESULT.ACCEPTED, 0xe8, 0x03]);
    assert.deepEqual(accepted, {
        schema: 1,
        result: SLCAN_BRIDGE_ENTRY_RESULT.ACCEPTED,
        accepted: true,
        bitrateKbps: 1000,
        message: SLCAN_BRIDGE_ENTRY_RESULT_LABELS[SLCAN_BRIDGE_ENTRY_RESULT.ACCEPTED],
    });

    const bytes = Uint8Array.of(1, SLCAN_BRIDGE_ENTRY_RESULT.ARMED, 0xf4, 0x01);
    const armed = decodeSlcanBridgeResponse(new DataView(bytes.buffer));
    assert.equal(armed.accepted, false);
    assert.equal(armed.bitrateKbps, 500);
    assert.match(armed.message, /Disarm/i);
    assert.throws(() => decodeSlcanBridgeResponse([2, 0, 0xe8, 0x03]), /Unsupported.*schema/i);
    assert.throws(() => decodeSlcanBridgeResponse([1, 0]), /requires 4 bytes/i);
});

test('firmware bridge implements bounded LAWICEL/SLCAN framing and reboot-only ownership', () => {
    const bridge = source('src/main/flight_commander/slcan_bridge.c');
    const header = source('src/main/flight_commander/slcan_bridge.h');

    assert.match(bridge, /SLCAN_HOST_TX_QUEUE_SIZE 32U/);
    assert.match(bridge, /SLCAN_BUS_RX_QUEUE_SIZE 64U/);
    assert.match(bridge, /case 'C':/);
    assert.match(bridge, /case 'S':/);
    assert.match(bridge, /case 'O':/);
    assert.match(bridge, /case 'Z':/);
    assert.match(bridge, /case 'F':/);
    assert.match(bridge, /case 'V':/);
    assert.match(bridge, /case 'N':/);
    assert.match(bridge, /case 'T':/);
    assert.match(bridge, /CANARD_CAN_FRAME_EFF/);
    assert.match(bridge, /ENABLE_ARMING_FLAG\(ARMING_DISABLED_DRONECAN_BRIDGE\)/);
    assert.doesNotMatch(header, /slcanBridgeExit/);
    assert.doesNotMatch(bridge, /bridgeActive\s*=\s*false/);
});

test('both supported targets hand raw CAN ownership to the post-ACK USB bridge', () => {
    const target = source('cmake/flight-commander-micoair743.cmake');
    const msp = source('src/main/fc/fc_msp.c');
    const serial = source('src/main/msp/msp_serial.c');
    const dronecan = source('src/main/drivers/dronecan/dronecan.c');

    assert.match(target, /USE_FLIGHT_COMMANDER_SLCAN_BRIDGE/);
    assert.match(target, /configure_flight_commander_target\(MICOAIR743 PB8 PB9\)/);
    assert.match(target, /configure_flight_commander_target\(CUBEORANGEPLUS PD0 PD1\)/);
    assert.match(msp, /\*mspPostProcessFn = mspFcEnterSlcanBridge/);
    assert.match(serial, /waitForSerialPortToFinishTransmitting[\s\S]*mspPostProcessFn/);
    assert.match(serial, /slcanBridgeOwnsPort[\s\S]*slcanBridgeProcessSerial/);
    assert.match(dronecan, /slcanBridgeIsActive[\s\S]*canardSTM32Transmit/);
    assert.match(dronecan, /canardSTM32Recieve[\s\S]*slcanBridgeCaptureRxFrame/);
});

test('Configurator exposes the guarded DroneCAN GUI handoff workflow', () => {
    const gps = source('configurator/tabs/gps.js');
    const html = source('configurator/tabs/gps.html');
    const helper = source('configurator/js/msp/MSPHelper.js');

    assert.match(html, /standards-compatible LAWICEL\/SLCAN adapter/);
    assert.match(html, /Keep the powered CAN hub connected/);
    assert.match(gps, /BitHelper\.bit_check\(FC\.CONFIG\.armingFlags, 2\)/);
    assert.match(gps, /FC\.DRONECAN_STATUS\.state !== 1/);
    assert.match(gps, /In DroneCAN GUI choose SLCAN/);
    assert.match(gps, /connect_controls a\.connect/);
    assert.match(helper, /retryCounter: 0/);
});
