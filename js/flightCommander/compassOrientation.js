'use strict';

export const ALIGN_DEFAULT = 0;
export const ALIGN_CW90_DEG = 2;

export const MICOAIR743_ONBOARD_COMPASS_PROFILE = Object.freeze({
    id: 'micoair743-ist8310',
    target: 'MICOAIR743',
    sensor: 'IST8310',
    alignMag: ALIGN_CW90_DEG,
    label: 'CW90 (unflipped)',
});

const MICOAIR743_TARGET_IDENTIFIERS = new Set([
    'MICOAIR743',
    'MICROAIR743',
    'M743',
]);

function normalizedIdentifier(value) {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function finiteDecidegrees(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isMicoAir743Target(config = {}) {
    const reportedTarget = normalizedIdentifier(config.target);
    return [reportedTarget, config.boardIdentifier]
        .map(normalizedIdentifier)
        .some((identifier) => MICOAIR743_TARGET_IDENTIFIERS.has(identifier));
}

export function onboardCompassOrientationRequirement({
    config = {},
    activeSensors = null,
    sensorConfig = {},
    sensorAlignment = {},
    customAngles = {},
} = {}) {
    const activeSensorsMask = Number(activeSensors);
    const detectionKnown = activeSensors !== null
        && activeSensors !== undefined
        && Number.isFinite(activeSensorsMask);
    const magnetometerDetected = (activeSensorsMask & (1 << 2)) !== 0;
    if (
        !isMicoAir743Target(config)
        || (detectionKnown && !magnetometerDetected)
    ) {
        return null;
    }

    const angles = {
        roll: finiteDecidegrees(customAngles.roll),
        pitch: finiteDecidegrees(customAngles.pitch),
        yaw: finiteDecidegrees(customAngles.yaw),
    };
    const anglesKnown = Object.values(angles).every((value) => value !== null);
    const customRotationDisabled = anglesKnown
        && Object.values(angles).every((value) => value === 0);
    const currentAlignMag = Number(sensorAlignment.align_mag);
    const ready = currentAlignMag === MICOAIR743_ONBOARD_COMPASS_PROFILE.alignMag
        && customRotationDisabled;

    return Object.freeze({
        ...MICOAIR743_ONBOARD_COMPASS_PROFILE,
        currentAlignMag: Number.isFinite(currentAlignMag) ? currentAlignMag : null,
        customAngles: Object.freeze(angles),
        anglesKnown,
        ready,
        needsCorrection: !ready,
    });
}
