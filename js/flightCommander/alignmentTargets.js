'use strict';

import {
    HEADING_SOURCE_DRONECAN_MAG,
    HEADING_SOURCE_EXTERNAL_I2C_MAG,
    HEADING_SOURCE_MOVING_BASELINE,
} from './headingFusion.js';

export const ALIGNMENT_TARGET_LEGACY_MAG = 'legacy-magnetometer';
export const ALIGNMENT_TARGET_UART_RTK = 'uart-rtk-module';
export const ALIGNMENT_TARGET_DRONECAN_RTK = 'dronecan-rtk-module';
export const ALIGNMENT_TARGET_MOVING_BASELINE = 'moving-baseline-rtk';

function configuredDronecanNodeLabel(config = {}) {
    const nodeId = Number(config.magNodeId);
    if (nodeId >= 1 && nodeId <= 127) return `node ${nodeId}`;
    if (nodeId === 0) return 'automatic node selection';
    return 'not yet assigned';
}

export function enumerateAlignmentTargets({
    supportsRtkUart = false,
    supportsDronecanGps = false,
    supportsMovingBaseline = false,
    headingConfig = null,
    dronecanConfig = null,
} = {}) {
    const targets = [{
        id: ALIGNMENT_TARGET_LEGACY_MAG,
        label: 'Onboard / standard external compass',
        description: 'Edits the standard firmware magnetometer alignment settings.',
        axes: ['roll', 'pitch', 'yaw'],
        previewIndex: 0,
    }];
    if (!headingConfig) return targets;

    if (supportsRtkUart) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_EXTERNAL_I2C_MAG]?.enabled);
        targets.push({
            id: ALIGNMENT_TARGET_UART_RTK,
            label: `UART RTK GPS-module compass${enabled ? ' · enabled' : ' · available'}`,
            description: 'Edits the mounting rotation for a compass carried by the UART F9/F9P RTK rover. GNSS position itself does not require angular alignment.',
            axes: ['roll', 'pitch', 'yaw'],
            previewIndex: 30,
        });
    }

    if (supportsDronecanGps) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_DRONECAN_MAG]?.enabled);
        targets.push({
            id: ALIGNMENT_TARGET_DRONECAN_RTK,
            label: `DroneCAN RTK GPS-module compass · ${configuredDronecanNodeLabel(dronecanConfig)}${enabled ? ' · enabled' : ''}`,
            description: 'Edits the mounting rotation for the selected DroneCAN GPS-module compass. GNSS position itself does not require angular alignment.',
            axes: ['roll', 'pitch', 'yaw'],
            previewIndex: 31,
        });
    }

    if (supportsMovingBaseline) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_MOVING_BASELINE]?.enabled);
        targets.push({
            id: ALIGNMENT_TARGET_MOVING_BASELINE,
            label: `Dual RTK GPS moving-baseline yaw${enabled ? ' · enabled' : ' · available'}`,
            description: 'Edits only the yaw offset of the measured antenna baseline. Roll and pitch alignment do not apply to this heading source.',
            axes: ['yaw'],
            previewIndex: 32,
        });
    }
    return targets;
}

function finiteAngle(value, label) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < -180 || numeric > 360) {
        throw new RangeError(`${label} must be between -180 and 360 degrees.`);
    }
    return numeric;
}

export function readFlightCommanderAlignmentAngles(headingConfig, targetId) {
    if (!headingConfig) throw new TypeError('Flight Commander heading configuration is unavailable.');
    if (targetId === ALIGNMENT_TARGET_UART_RTK) {
        const [roll, pitch, yaw] = headingConfig.externalMagAlignmentDecidegrees;
        return { roll: roll / 10, pitch: pitch / 10, yaw: yaw / 10 };
    }
    if (targetId === ALIGNMENT_TARGET_DRONECAN_RTK) {
        const [roll, pitch, yaw] = headingConfig.dronecanMagAlignmentDecidegrees;
        return { roll: roll / 10, pitch: pitch / 10, yaw: yaw / 10 };
    }
    if (targetId === ALIGNMENT_TARGET_MOVING_BASELINE) {
        return {
            roll: 0,
            pitch: 0,
            yaw: Number(headingConfig.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees) / 100,
        };
    }
    throw new RangeError(`Unsupported Flight Commander alignment target ${targetId}.`);
}

export function writeFlightCommanderAlignmentAngles(headingConfig, targetId, angles) {
    const roll = finiteAngle(angles?.roll, 'Roll alignment');
    const pitch = finiteAngle(angles?.pitch, 'Pitch alignment');
    const yaw = finiteAngle(angles?.yaw, 'Yaw alignment');
    if (targetId === ALIGNMENT_TARGET_UART_RTK) {
        headingConfig.externalMagAlignmentDecidegrees = [roll, pitch, yaw]
            .map((value) => Math.round(value * 10));
        return headingConfig;
    }
    if (targetId === ALIGNMENT_TARGET_DRONECAN_RTK) {
        headingConfig.dronecanMagAlignmentDecidegrees = [roll, pitch, yaw]
            .map((value) => Math.round(value * 10));
        return headingConfig;
    }
    if (targetId === ALIGNMENT_TARGET_MOVING_BASELINE) {
        const canonicalYaw = yaw > 180 ? yaw - 360 : yaw;
        headingConfig.sources[HEADING_SOURCE_MOVING_BASELINE].yawOffsetCentidegrees = Math.round(canonicalYaw * 100);
        return headingConfig;
    }
    throw new RangeError(`Unsupported Flight Commander alignment target ${targetId}.`);
}
