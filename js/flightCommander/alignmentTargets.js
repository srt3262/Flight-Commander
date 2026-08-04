'use strict';

import {
    BASELINE_PROVIDER_DRONECAN,
    BASELINE_PROVIDER_UART,
    HEADING_SOURCE_DRONECAN_MAG,
    HEADING_SOURCE_EXTERNAL_I2C_MAG,
    HEADING_SOURCE_MOVING_BASELINE,
    HEADING_SOURCE_ONBOARD_MAG,
} from './headingFusion.js';

export const ALIGNMENT_TARGET_LEGACY_MAG = 'legacy-magnetometer';
export const ALIGNMENT_TARGET_UART_RTK = 'uart-rtk-module';
export const ALIGNMENT_TARGET_DRONECAN_RTK = 'dronecan-rtk-module';
export const ALIGNMENT_TARGET_MOVING_BASELINE = 'moving-baseline-rtk';

function dronecanCompassNodes(status = {}) {
    return (Array.isArray(status?.nodes) ? status.nodes : [])
        .filter((node) => (Number(node.capabilities) & (1 << 3)) !== 0)
        .map((node) => Number(node.nodeId))
        .filter((nodeId) => Number.isInteger(nodeId) && nodeId >= 1 && nodeId <= 127);
}

function configuredDronecanNodeLabel(config = {}, status = {}, headingConfig = {}) {
    const nodeId = Number(config.magNodeId);
    if (nodeId >= 1 && nodeId <= 127) return `node ${nodeId}`;
    if (nodeId === 0) {
        const calibratedNodeId = Number(headingConfig.dronecanMagCalibrationNodeId);
        if (calibratedNodeId >= 1 && calibratedNodeId <= 127) {
            return `automatic selection bound by calibration to node ${calibratedNodeId}`;
        }
        const detected = dronecanCompassNodes(status);
        if (detected.length === 1) return `automatic selection currently resolves to node ${detected[0]}`;
        if (detected.length > 1) return `automatic selection is ambiguous (${detected.length} compass nodes)`;
        return 'automatic selection; no compass node detected';
    }
    return 'not yet assigned';
}

function movingBaselineTransport(headingConfig = {}) {
    if (headingConfig.movingBaselineProvider === BASELINE_PROVIDER_UART) {
        return 'UART UBX-NAV-RELPOSNED';
    }
    if (headingConfig.movingBaselineProvider === BASELINE_PROVIDER_DRONECAN) {
        return 'DroneCAN relative-heading message';
    }
    return 'Automatic: best valid UART or DroneCAN relative-heading solution';
}

export function enumerateAlignmentTargets({
    supportsRtkUart = false,
    supportsDronecanGps = false,
    supportsMovingBaseline = false,
    headingConfig = null,
    dronecanConfig = null,
    dronecanStatus = null,
} = {}) {
    const targets = [{
        id: ALIGNMENT_TARGET_LEGACY_MAG,
        label: 'Onboard compass',
        description: 'Shows the active INAV target magnetometer alignment and live diagnostics. Flight Commander does not override the target\'s compass orientation.',
        axes: ['roll', 'pitch', 'yaw'],
        sourceIndex: HEADING_SOURCE_ONBOARD_MAG,
        previewIndex: 0,
        previewKind: 'onboard',
        previewTitle: 'Flight-controller compass reference',
        previewDetail: 'Select a legacy compass model below only when it helps match the installed hardware.',
        transport: 'INAV target compass path',
        binding: 'Onboard / target-selected compass',
        setting: 'INAV align_mag and align_mag_roll/pitch/yaw',
        editable: true,
    }];
    if (!headingConfig) return targets;

    if (supportsRtkUart) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_EXTERNAL_I2C_MAG]?.enabled);
        targets.push({
            id: ALIGNMENT_TARGET_UART_RTK,
            label: `External I²C compass on UART RTK module${enabled ? ' · enabled' : ' · available'}`,
            description: 'Edits only the dedicated external-I²C compass mounted with the UART F9/F9P rover. It does not rotate the UART GNSS position solution or any other compass.',
            axes: ['roll', 'pitch', 'yaw'],
            sourceIndex: HEADING_SOURCE_EXTERNAL_I2C_MAG,
            previewIndex: 30,
            previewKind: 'uart',
            previewTitle: 'F9/F9P RTK carrier + external-I²C compass schematic',
            previewDetail: 'The violet connector marks UART GNSS data; the amber connector marks the separately aligned I²C compass.',
            transport: 'GNSS: UART · Compass: external I²C1',
            binding: 'Dedicated MICOAIR743 external-I²C compass input',
            setting: 'externalMagAlignmentDecidegrees',
            editable: true,
        });
    }

    if (supportsDronecanGps) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_DRONECAN_MAG]?.enabled);
        const configuredNodeId = Number(dronecanConfig?.magNodeId);
        const detectedCompassNodes = dronecanCompassNodes(dronecanStatus);
        const calibrationNodeId = Number(headingConfig.dronecanMagCalibrationNodeId);
        const automaticSelectionIsAmbiguous = configuredNodeId === 0
            && calibrationNodeId === 0
            && detectedCompassNodes.length > 1;
        const nodeLabel = configuredDronecanNodeLabel(
            dronecanConfig,
            dronecanStatus,
            headingConfig,
        );
        targets.push({
            id: ALIGNMENT_TARGET_DRONECAN_RTK,
            label: `DroneCAN module compass · ${nodeLabel}${enabled ? ' · enabled' : ''}`,
            description: automaticSelectionIsAmbiguous
                ? 'More than one DroneCAN compass is currently eligible for Automatic selection. Choose one specific compass node on the GPS tab before editing alignment so values cannot be applied to alternating modules.'
                : 'Edits only the selected DroneCAN compass node. It does not rotate DroneCAN GNSS positions or the external-I²C compass.',
            axes: ['roll', 'pitch', 'yaw'],
            sourceIndex: HEADING_SOURCE_DRONECAN_MAG,
            previewIndex: 31,
            previewKind: 'dronecan',
            previewTitle: 'DroneCAN GNSS/compass module schematic',
            previewDetail: 'The paired blue connectors mark the CAN bus. The selected node identity below is the authoritative device binding.',
            transport: `DroneCAN · ${nodeLabel}`,
            binding: configuredNodeId >= 1 && configuredNodeId <= 127
                ? `Explicit compass node ${configuredNodeId}`
                : nodeLabel,
            setting: 'dronecanMagAlignmentDecidegrees',
            editable: !automaticSelectionIsAmbiguous && configuredNodeId !== 255,
            warning: automaticSelectionIsAmbiguous
                ? 'Alignment is locked until one specific DroneCAN compass node is selected.'
                : '',
        });
    }

    if (supportsMovingBaseline) {
        const enabled = Boolean(headingConfig.sources?.[HEADING_SOURCE_MOVING_BASELINE]?.enabled);
        targets.push({
            id: ALIGNMENT_TARGET_MOVING_BASELINE,
            label: `Dual RTK GPS moving-baseline yaw${enabled ? ' · enabled' : ' · available'}`,
            description: 'Edits only the yaw offset of the antenna-pair baseline. Roll and pitch do not apply, and neither receiver\'s GNSS position orientation is changed.',
            axes: ['yaw'],
            sourceIndex: HEADING_SOURCE_MOVING_BASELINE,
            previewIndex: 32,
            previewKind: 'moving-baseline',
            previewTitle: 'Moving-baseline antenna-pair schematic',
            previewDetail: 'The amber Base→Rover vector is the measured baseline; yaw corrects that pair-level vector only.',
            transport: movingBaselineTransport(headingConfig),
            binding: 'One Base→Rover antenna pair',
            setting: 'sources[movingBaseline].yawOffsetCentidegrees',
            editable: true,
        });
    }
    return targets;
}

function cloneAngles(angles = {}) {
    return {
        roll: Number(angles.roll),
        pitch: Number(angles.pitch),
        yaw: Number(angles.yaw),
    };
}

export function createAlignmentDrafts({
    targets = [],
    headingConfig = null,
    legacyAngles = { roll: 0, pitch: 0, yaw: 0 },
} = {}) {
    const drafts = new Map();
    for (const target of targets) {
        const angles = target.id === ALIGNMENT_TARGET_LEGACY_MAG
            ? legacyAngles
            : readFlightCommanderAlignmentAngles(headingConfig, target.id);
        drafts.set(target.id, cloneAngles(angles));
    }
    return drafts;
}

export function readAlignmentDraft(drafts, targetId) {
    if (!(drafts instanceof Map) || !drafts.has(targetId)) {
        throw new RangeError(`Alignment draft ${targetId} is unavailable.`);
    }
    return cloneAngles(drafts.get(targetId));
}

export function updateAlignmentDraft(drafts, targetId, angles) {
    if (!(drafts instanceof Map) || !drafts.has(targetId)) {
        throw new RangeError(`Alignment draft ${targetId} is unavailable.`);
    }
    const next = cloneAngles(angles);
    drafts.set(targetId, next);
    return cloneAngles(next);
}

export function updateAlignmentDraftAxis(drafts, targetId, axis, value) {
    if (!['roll', 'pitch', 'yaw'].includes(axis)) {
        throw new RangeError(`Unsupported alignment axis ${axis}.`);
    }
    const current = readAlignmentDraft(drafts, targetId);
    current[axis] = finiteAngle(value, `${axis} alignment`);
    return updateAlignmentDraft(drafts, targetId, current);
}

export function applyAlignmentDrafts(headingConfig, drafts) {
    if (!(drafts instanceof Map)) {
        throw new TypeError('Alignment drafts must be stored by source identity.');
    }
    for (const [targetId, angles] of drafts) {
        if (targetId === ALIGNMENT_TARGET_LEGACY_MAG) continue;
        writeFlightCommanderAlignmentAngles(headingConfig, targetId, angles);
    }
    return headingConfig;
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
