'use strict';

import {
    HEADING_SOURCE_DRONECAN_MAG,
    HEADING_SOURCE_EXTERNAL_I2C_MAG,
    HEADING_SOURCE_LABELS,
    HEADING_SOURCE_ONBOARD_MAG,
} from './headingFusion.js';
import { DRONECAN_NODE_ID_DISABLED } from './dualGps.js';

export const COMPASS_CALIBRATION_SOURCE_COUNT = 3;
export const DRONECAN_COMPASS_CAPABILITY = 1 << 3;

function finiteVector(values, fallback) {
    const source = Array.isArray(values) ? values : [];
    return [0, 1, 2].map((index) => {
        const value = Number(source[index]);
        return Number.isFinite(value) ? value : fallback;
    });
}

function legacyVector(values, fallback) {
    return ['X', 'Y', 'Z'].map((axis) => {
        const value = Number(values?.[axis]);
        return Number.isFinite(value) ? value : fallback;
    });
}

function sourceIsLive(source) {
    return Boolean(
        source
        && (
            source.healthy
            || source.active
            || source.calibrating
            || (Number.isFinite(Number(source.ageMs)) && Number(source.ageMs) !== 0xffff)
        )
    );
}

function matchingCanNodes(dronecanStatus, configuredNodeId) {
    const nodes = Array.isArray(dronecanStatus?.nodes) ? dronecanStatus.nodes : [];
    return nodes.filter((node) => (
        (Number(node.capabilities) & DRONECAN_COMPASS_CAPABILITY) !== 0
        && (
            Number(configuredNodeId) === 0
            || Number(configuredNodeId) === Number(node.nodeId)
        )
    ));
}

function adjustedCalibration(zero, gain, defaultGain) {
    return zero.some((value) => value !== 0)
        || gain.some((value) => value !== defaultGain);
}

export function assessCompassCalibration(zeroValues, gainValues, defaultGain) {
    const zero = finiteVector(zeroValues, 0);
    const gain = finiteVector(gainValues, defaultGain);
    const adjusted = adjustedCalibration(zero, gain, defaultGain);
    if (!adjusted) return { adjusted: false, valid: true, issue: '' };
    if (gain.some((value) => !Number.isFinite(value) || value <= 0)) {
        return {
            adjusted: true,
            valid: false,
            issue: 'One or more axis gains are zero or negative.',
        };
    }
    const minimumGain = Math.min(...gain);
    const maximumGain = Math.max(...gain);
    if (maximumGain > minimumGain * 5) {
        return {
            adjusted: true,
            valid: false,
            issue: `Axis gains are implausibly unbalanced (${(maximumGain / minimumGain).toFixed(1)}:1).`,
        };
    }
    const maximumZero = Math.max(...zero.map((value) => Math.abs(value)));
    if (maximumZero > maximumGain * 10) {
        return {
            adjusted: true,
            valid: false,
            issue: 'The solved zero offset is implausibly large relative to the measured field range.',
        };
    }
    return { adjusted: true, valid: true, issue: '' };
}

function targetStatus(source, fallbackCalibrated, calibrationAssessment) {
    const invalidCalibration = Boolean(
        calibrationAssessment?.adjusted && !calibrationAssessment.valid,
    );
    return {
        calibrated: !invalidCalibration && (source ? Boolean(source.calibrated) : fallbackCalibrated),
        calibrating: Boolean(source?.calibrating),
        failed: Boolean(source?.calibrationFailed) || invalidCalibration,
        invalidCalibration,
        calibrationIssue: calibrationAssessment?.issue || '',
        healthy: Boolean(source?.healthy),
        ageMs: Number.isFinite(Number(source?.ageMs)) && Number(source.ageMs) !== 0xffff
            ? Number(source.ageMs)
            : null,
    };
}

export function enumerateCompassCalibrationTargets({
    supportsHeadingFusion = false,
    activeSensors = null,
    sensorConfig = {},
    calibrationData = {},
    headingConfig = null,
    headingStatus = {},
    dronecanConfig = {},
    dronecanStatus = {},
} = {}) {
    const legacyZero = legacyVector(calibrationData.magZero, 0);
    const legacyGain = legacyVector(calibrationData.magGain, 1024);
    const activeSensorsMask = Number(activeSensors);
    const legacyMagDetected = (
        activeSensors !== null
        && activeSensors !== undefined
        && Number.isFinite(activeSensorsMask)
    )
        ? (activeSensorsMask & (1 << 2)) !== 0
        : Number(sensorConfig.magnetometer) !== 0;

    if (!supportsHeadingFusion || !headingConfig?.sources) {
        if (!legacyMagDetected) return [];
        const assessment = assessCompassCalibration(legacyZero, legacyGain, 1024);
        return [{
            index: HEADING_SOURCE_ONBOARD_MAG,
            key: 'legacy-primary',
            title: 'Primary / onboard compass',
            description: 'Compass reported through the standard firmware magnetometer configuration.',
            zero: legacyZero,
            gain: legacyGain,
            zeroUnit: 'raw',
            gainUnit: 'scale',
            nodeId: null,
            ...targetStatus(null, assessment.adjusted, assessment),
        }];
    }

    const targets = [];
    const statusSources = Array.isArray(headingStatus.sources) ? headingStatus.sources : [];
    const onboardSource = statusSources[HEADING_SOURCE_ONBOARD_MAG];
    const onboardEnabled = Boolean(headingConfig.sources[HEADING_SOURCE_ONBOARD_MAG]?.enabled);
    if (
        onboardEnabled
        && (legacyMagDetected || sourceIsLive(onboardSource))
    ) {
        const assessment = assessCompassCalibration(legacyZero, legacyGain, 1024);
        targets.push({
            index: HEADING_SOURCE_ONBOARD_MAG,
            key: 'onboard',
            title: HEADING_SOURCE_LABELS[HEADING_SOURCE_ONBOARD_MAG],
            description: 'Magnetometer installed on or directly connected to the flight controller.',
            zero: legacyZero,
            gain: legacyGain,
            zeroUnit: 'raw',
            gainUnit: 'scale',
            nodeId: null,
            ...targetStatus(
                onboardSource,
                assessment.adjusted,
                assessment,
            ),
        });
    }

    const externalSource = statusSources[HEADING_SOURCE_EXTERNAL_I2C_MAG];
    const externalEnabled = Boolean(
        headingConfig.sources[HEADING_SOURCE_EXTERNAL_I2C_MAG]?.enabled
        && Number(headingConfig.externalMagHardware) !== 0,
    );
    if (externalEnabled && sourceIsLive(externalSource)) {
        const zero = finiteVector(headingConfig.externalMagZero, 0);
        const gain = finiteVector(headingConfig.externalMagGain, 1024);
        const assessment = assessCompassCalibration(zero, gain, 1024);
        targets.push({
            index: HEADING_SOURCE_EXTERNAL_I2C_MAG,
            key: 'external-i2c',
            title: 'External / UART GPS-module compass',
            description: 'External I²C compass, including the compass wired from a UART GPS module.',
            zero,
            gain,
            zeroUnit: 'raw',
            gainUnit: 'scale',
            nodeId: null,
            ...targetStatus(
                externalSource,
                assessment.adjusted,
                assessment,
            ),
        });
    }

    const canSource = statusSources[HEADING_SOURCE_DRONECAN_MAG];
    const configuredCanNode = Number(dronecanConfig?.magNodeId ?? DRONECAN_NODE_ID_DISABLED);
    const canNodes = matchingCanNodes(dronecanStatus, configuredCanNode);
    const canEnabled = Boolean(
        headingConfig.sources[HEADING_SOURCE_DRONECAN_MAG]?.enabled
        && configuredCanNode !== DRONECAN_NODE_ID_DISABLED,
    );
    if (canEnabled && (sourceIsLive(canSource) || canNodes.length > 0)) {
        const zero = finiteVector(headingConfig.dronecanMagZeroMilliGauss, 0);
        const gain = finiteVector(headingConfig.dronecanMagGainMilliGauss, 0);
        const assessment = assessCompassCalibration(zero, gain, 0);
        const boundNode = Number(headingConfig.dronecanMagCalibrationNodeId);
        const selectedNode = boundNode > 0
            ? boundNode
            : configuredCanNode > 0 && configuredCanNode <= 127
                ? configuredCanNode
                : Number(canNodes[0]?.nodeId) || null;
        targets.push({
            index: HEADING_SOURCE_DRONECAN_MAG,
            key: 'dronecan',
            title: HEADING_SOURCE_LABELS[HEADING_SOURCE_DRONECAN_MAG],
            description: selectedNode
                ? `CAN GPS-module compass on node ${selectedNode}.`
                : 'Automatically selected CAN GPS-module compass.',
            zero,
            gain,
            zeroUnit: 'mG',
            gainUnit: 'mG scale',
            nodeId: selectedNode,
            ...targetStatus(
                canSource,
                assessment.adjusted,
                assessment,
            ),
        });
    }

    return targets;
}

export function compassCalibrationState(target) {
    if (target?.calibrating) return { label: 'Calibrating', tone: 'working' };
    if (target?.invalidCalibration) return { label: 'Invalid calibration', tone: 'error' };
    if (target?.failed) return { label: 'Calibration failed', tone: 'error' };
    if (target?.calibrated) return { label: 'Calibrated', tone: 'ready' };
    return { label: 'Calibration required', tone: 'warning' };
}
