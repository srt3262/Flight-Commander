import assert from 'node:assert/strict';
import test from 'node:test';

import {
    UART_GPS_PRESETS,
    UART_RTK_ROVER_PRESET_ID,
    detectUartGpsPreset,
    uartRtkRoverNextAction,
} from '../../../js/flightCommander/uartGpsPresets.js';
import {
    ALIGNMENT_TARGET_DRONECAN_RTK,
    ALIGNMENT_TARGET_LEGACY_MAG,
    ALIGNMENT_TARGET_MOVING_BASELINE,
    ALIGNMENT_TARGET_UART_RTK,
    enumerateAlignmentTargets,
    readFlightCommanderAlignmentAngles,
    writeFlightCommanderAlignmentAngles,
} from '../../../js/flightCommander/alignmentTargets.js';
import {
    createDefaultHeadingConfig,
    HEADING_SOURCE_MOVING_BASELINE,
} from '../../../js/flightCommander/headingFusion.js';

test('UART GPS presets include an explicit aircraft-side F9 RTK rover', () => {
    const preset = UART_GPS_PRESETS[UART_RTK_ROVER_PRESET_ID];
    assert.equal(preset.name, 'u-blox F9P / F9-series (RTK Rover)');
    assert.equal(preset.protocol, 'UBLOX');
    assert.equal(preset.baud, '115200');
    assert.equal(preset.rate, 8);
    assert.equal(preset.rtkRover, true);
    assert.deepEqual(
        [preset.galileo, preset.glonass, preset.beidou],
        [true, true, true],
    );
    assert.match(preset.description.join(' '), /Ground Control/);
    assert.match(preset.description.join(' '), /RTCM3/);
});

test('legacy u-blox hardware auto-detection remains stable and F9 stays explicit', () => {
    assert.equal(detectUartGpsPreset(0x48), 'm8');
    assert.equal(detectUartGpsPreset(0x49), 'm9-precision');
    assert.equal(detectUartGpsPreset(0x4A), 'm10');
    assert.equal(detectUartGpsPreset(0), 'manual');
});

test('RTK rover guidance identifies the next safe setup action', () => {
    assert.match(
        uartRtkRoverNextAction({ portIdentifier: -1, supportsRtkUart: true }),
        /Choose the UART/,
    );
    assert.match(
        uartRtkRoverNextAction({ portIdentifier: 2, supportsRtkUart: true }),
        /Ground Control/,
    );
    assert.match(
        uartRtkRoverNextAction({ portIdentifier: 2, supportsRtkUart: false }),
        /Flight Commander Firmware is required/,
    );
});

test('Alignment Tool enumerates UART, DroneCAN, and moving-baseline RTK targets', () => {
    const headingConfig = createDefaultHeadingConfig();
    headingConfig.sources[1].enabled = true;
    headingConfig.sources[2].enabled = true;
    headingConfig.sources[3].enabled = true;
    const targets = enumerateAlignmentTargets({
        supportsRtkUart: true,
        supportsDronecanGps: true,
        supportsMovingBaseline: true,
        headingConfig,
        dronecanConfig: { magNodeId: 42 },
    });
    assert.deepEqual(
        targets.map((target) => target.id),
        [
            ALIGNMENT_TARGET_LEGACY_MAG,
            ALIGNMENT_TARGET_UART_RTK,
            ALIGNMENT_TARGET_DRONECAN_RTK,
            ALIGNMENT_TARGET_MOVING_BASELINE,
        ],
    );
    assert.equal(targets[0].label, 'Onboard compass');
    assert.doesNotMatch(targets[0].label, /external/i);
    assert.match(targets[0].description, /MICOAIR743/);
    assert.match(targets[0].description, /CW90/);
    assert.match(targets[1].label, /UART RTK GPS-module compass/);
    assert.match(targets[2].label, /node 42/);
    assert.deepEqual(targets[3].axes, ['yaw']);
    assert.deepEqual(targets.map((target) => target.previewIndex), [0, 30, 31, 32]);
});

test('per-module alignment values round-trip in the firmware heading schema', () => {
    const headingConfig = createDefaultHeadingConfig();
    writeFlightCommanderAlignmentAngles(headingConfig, ALIGNMENT_TARGET_UART_RTK, {
        roll: 12.3,
        pitch: -4.5,
        yaw: 270,
    });
    assert.deepEqual(headingConfig.externalMagAlignmentDecidegrees, [123, -45, 2700]);
    assert.deepEqual(
        readFlightCommanderAlignmentAngles(headingConfig, ALIGNMENT_TARGET_UART_RTK),
        { roll: 12.3, pitch: -4.5, yaw: 270 },
    );

    writeFlightCommanderAlignmentAngles(headingConfig, ALIGNMENT_TARGET_DRONECAN_RTK, {
        roll: -10,
        pitch: 20,
        yaw: 30,
    });
    assert.deepEqual(headingConfig.dronecanMagAlignmentDecidegrees, [-100, 200, 300]);

    writeFlightCommanderAlignmentAngles(headingConfig, ALIGNMENT_TARGET_MOVING_BASELINE, {
        roll: 0,
        pitch: 0,
        yaw: 270,
    });
    assert.equal(
        headingConfig.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees,
        -9000,
    );
    assert.deepEqual(
        readFlightCommanderAlignmentAngles(headingConfig, ALIGNMENT_TARGET_MOVING_BASELINE),
        { roll: 0, pitch: 0, yaw: -90 },
    );
});
