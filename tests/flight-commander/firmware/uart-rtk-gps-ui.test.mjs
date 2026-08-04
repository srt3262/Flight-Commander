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
    applyAlignmentDrafts,
    createAlignmentDrafts,
    enumerateAlignmentTargets,
    readAlignmentDraft,
    readFlightCommanderAlignmentAngles,
    updateAlignmentDraft,
    updateAlignmentDraftAxis,
    writeFlightCommanderAlignmentAngles,
} from '../../../js/flightCommander/alignmentTargets.js';
import {
    createDefaultHeadingConfig,
    decodeHeadingConfig,
    encodeHeadingConfig,
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
    assert.match(targets[0].description, /Active INAV target/);
    assert.doesNotMatch(targets[0].description, /does not override/i);
    assert.match(targets[1].label, /External I²C compass/);
    assert.match(targets[2].label, /node 42/);
    assert.deepEqual(targets[3].axes, ['yaw']);
    assert.deepEqual(targets.map((target) => target.previewIndex), [0, 30, 31, 32]);
    assert.deepEqual(
        targets.map((target) => target.previewTitle),
        [
            'Onboard compass',
            'UART RTK GPS-module compass',
            'DroneCAN GPS-module compass',
            'Moving-baseline GPS pair',
        ],
    );
    assert.equal(targets[1].setting, 'externalMagAlignmentDecidegrees');
    assert.equal(targets[2].setting, 'dronecanMagAlignmentDecidegrees');
    assert.match(targets[3].binding, /Base→Rover/);
});

test('Alignment Tool locks ambiguous DroneCAN automatic compass selection', () => {
    const headingConfig = createDefaultHeadingConfig();
    const targets = enumerateAlignmentTargets({
        supportsDronecanGps: true,
        headingConfig,
        dronecanConfig: { magNodeId: 0 },
        dronecanStatus: {
            nodes: [
                { nodeId: 41, capabilities: 1 << 3 },
                { nodeId: 42, capabilities: 1 << 3 },
            ],
        },
    });
    const canTarget = targets.find((target) => target.id === ALIGNMENT_TARGET_DRONECAN_RTK);
    assert.equal(canTarget.editable, false);
    assert.match(canTarget.label, /ambiguous/);
    assert.match(canTarget.warning, /locked/);
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

test('per-source alignment drafts cannot leak into another module', () => {
    const headingConfig = createDefaultHeadingConfig();
    headingConfig.externalMagAlignmentDecidegrees = [100, 200, 300];
    headingConfig.dronecanMagAlignmentDecidegrees = [-100, -200, -300];
    headingConfig.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees = 4500;
    const targets = enumerateAlignmentTargets({
        supportsRtkUart: true,
        supportsDronecanGps: true,
        supportsMovingBaseline: true,
        headingConfig,
        dronecanConfig: { magNodeId: 42 },
    });
    const drafts = createAlignmentDrafts({
        targets,
        headingConfig,
        legacyAngles: { roll: 1, pitch: 2, yaw: 3 },
    });

    updateAlignmentDraft(drafts, ALIGNMENT_TARGET_UART_RTK, {
        roll: 11,
        pitch: 22,
        yaw: 33,
    });
    assert.deepEqual(
        readAlignmentDraft(drafts, ALIGNMENT_TARGET_DRONECAN_RTK),
        { roll: -10, pitch: -20, yaw: -30 },
    );
    assert.deepEqual(
        readAlignmentDraft(drafts, ALIGNMENT_TARGET_MOVING_BASELINE),
        { roll: 0, pitch: 0, yaw: 45 },
    );

    applyAlignmentDrafts(headingConfig, drafts);
    const persisted = decodeHeadingConfig(encodeHeadingConfig(
        headingConfig,
        { gpsNodeId: 42, magNodeId: 42 },
    ));
    assert.deepEqual(persisted.externalMagAlignmentDecidegrees, [110, 220, 330]);
    assert.deepEqual(persisted.dronecanMagAlignmentDecidegrees, [-100, -200, -300]);
    assert.equal(
        persisted.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees,
        4500,
    );
});

test('editing and revisiting every alignment target preserves four independent values', () => {
    const headingConfig = createDefaultHeadingConfig();
    const targets = enumerateAlignmentTargets({
        supportsRtkUart: true,
        supportsDronecanGps: true,
        supportsMovingBaseline: true,
        headingConfig,
        dronecanConfig: { magNodeId: 42 },
    });
    const drafts = createAlignmentDrafts({
        targets,
        headingConfig,
        legacyAngles: { roll: 1, pitch: 2, yaw: 3 },
    });

    for (const [targetId, values] of [
        [ALIGNMENT_TARGET_LEGACY_MAG, { roll: 4, pitch: 5, yaw: 6 }],
        [ALIGNMENT_TARGET_UART_RTK, { roll: 11, pitch: 12, yaw: 13 }],
        [ALIGNMENT_TARGET_DRONECAN_RTK, { roll: 21, pitch: 22, yaw: 23 }],
        [ALIGNMENT_TARGET_MOVING_BASELINE, { roll: 0, pitch: 0, yaw: 31 }],
    ]) {
        for (const axis of ['roll', 'pitch', 'yaw']) {
            updateAlignmentDraftAxis(drafts, targetId, axis, values[axis]);
        }
    }

    assert.deepEqual(readAlignmentDraft(drafts, ALIGNMENT_TARGET_LEGACY_MAG), { roll: 4, pitch: 5, yaw: 6 });
    assert.deepEqual(readAlignmentDraft(drafts, ALIGNMENT_TARGET_UART_RTK), { roll: 11, pitch: 12, yaw: 13 });
    assert.deepEqual(readAlignmentDraft(drafts, ALIGNMENT_TARGET_DRONECAN_RTK), { roll: 21, pitch: 22, yaw: 23 });
    assert.deepEqual(readAlignmentDraft(drafts, ALIGNMENT_TARGET_MOVING_BASELINE), { roll: 0, pitch: 0, yaw: 31 });

    applyAlignmentDrafts(headingConfig, drafts);
    const reloaded = decodeHeadingConfig(encodeHeadingConfig(
        headingConfig,
        { gpsNodeId: 42, magNodeId: 42 },
    ));
    assert.deepEqual(reloaded.externalMagAlignmentDecidegrees, [110, 120, 130]);
    assert.deepEqual(reloaded.dronecanMagAlignmentDecidegrees, [210, 220, 230]);
    assert.equal(reloaded.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees, 3100);
});
