'use strict';

const NUMBERED_MOTOR_IMAGES = new Set(['quad_x', 'quad_p']);

function readRuleAxis(rule, axis) {
    const getter = `get${axis[0].toUpperCase()}${axis.slice(1)}`;
    const rawValue = typeof rule?.[getter] === 'function'
        ? rule[getter]()
        : rule?.[axis];
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : 0;
}

/**
 * Return motor-label positions as percentages of the square preview image.
 * Quad-X and Quad-Plus SVGs intentionally rely on HTML labels because their
 * embedded SVG number groups are empty. Percentages keep the labels correct
 * before and after an image load, at every preview size.
 */
export function calculateMotorNumberPositions(imageName, rules) {
    if (!NUMBERED_MOTOR_IMAGES.has(imageName) || !rules) {
        return [];
    }

    return Object.keys(rules).map((key) => {
        const rule = rules[key];
        const roll = readRuleAxis(rule, 'roll');
        const pitch = readRuleAxis(rule, 'pitch');

        return {
            left: Math.abs(roll) < 0.1 ? 50 : (roll < 0 ? 80 : 20),
            top: Math.abs(pitch) < 0.1 ? 50 : (pitch > 0 ? 80 : 20),
        };
    });
}

/**
 * INAV's normal motor mixer uses negative yaw factors for clockwise motors
 * and positive yaw factors for counter-clockwise motors. The firmware flips
 * the yaw multiplier when motor_direction_inverted selects Props-out.
 */
export function calculateMotorRotationDirections(imageName, rules, isReversed = false) {
    if (!NUMBERED_MOTOR_IMAGES.has(imageName) || !rules) {
        return [];
    }

    return Object.keys(rules).map((key) => {
        const yaw = readRuleAxis(rules[key], 'yaw');
        if (Math.abs(yaw) < 0.1) {
            return null;
        }
        const normalDirection = yaw < 0 ? 'CW' : 'CCW';
        if (!isReversed) {
            return normalDirection;
        }
        return normalDirection === 'CW' ? 'CCW' : 'CW';
    });
}

export function motorPreviewAssetStem(imageName, isReversed = false) {
    return `${imageName}${isReversed ? '_reverse' : ''}`;
}

function hasCompleteNumberedLayout(imageName, positions) {
    if (!NUMBERED_MOTOR_IMAGES.has(imageName) || positions.length < 4) {
        return false;
    }
    const firstFour = positions.slice(0, 4);
    return new Set(firstFour.map(({ left, top }) => `${left}:${top}`)).size === 4;
}

/**
 * Prefer the controller's active rules, but retain useful numbering while a
 * freshly erased controller has only the selected mixer identity. This state
 * can also occur after an older preset stops before its mixer-write phase.
 */
export function resolveMotorNumberPositions(imageName, rules, presetRules = null) {
    const activePositions = calculateMotorNumberPositions(imageName, rules);
    if (hasCompleteNumberedLayout(imageName, activePositions)) {
        return activePositions.slice(0, 4);
    }

    const presetPositions = calculateMotorNumberPositions(imageName, presetRules);
    if (hasCompleteNumberedLayout(imageName, presetPositions)) {
        return presetPositions.slice(0, 4);
    }
    return [];
}

export function resolveMotorPreviewLayout(
    imageName,
    rules,
    presetRules = null,
    isReversed = false,
) {
    const activePositions = calculateMotorNumberPositions(imageName, rules);
    const useActiveRules = hasCompleteNumberedLayout(imageName, activePositions);
    const selectedRules = useActiveRules ? rules : presetRules;
    const positions = useActiveRules
        ? activePositions.slice(0, 4)
        : resolveMotorNumberPositions(imageName, null, presetRules);
    const rotations = calculateMotorRotationDirections(
        imageName,
        selectedRules,
        isReversed,
    );

    return positions.map((position, index) => ({
        ...position,
        rotation: rotations[index] ?? null,
    }));
}

/**
 * Render the fixed motor-number elements inside one preview-image wrapper.
 * The function does not depend on image dimensions or the SVG load event.
 */
export function renderMotorNumberLabels(
    $preview,
    imageName,
    rules,
    presetRules = null,
    isReversed = false,
) {
    const layout = resolveMotorPreviewLayout(
        imageName,
        rules,
        presetRules,
        isReversed,
    );
    const $labels = $preview.find('.motorNumber');
    const propConfiguration = isReversed ? 'Props-out' : 'Props-in';

    $preview.attr('data-motor-number-layout', 'percentage');
    $preview.attr('data-motor-number-fallback', 'selected-preset');
    $preview.attr('data-motor-prop-configuration', propConfiguration.toLowerCase());
    $labels.addClass('is-hidden').css('visibility', 'hidden');

    layout.forEach((position, index) => {
        const $label = $labels.eq(index);
        if ($label.length === 0) {
            return;
        }

        $label
            .text(index + 1)
            .attr({
                title: position.rotation
                    ? `Motor ${index + 1} · ${position.rotation} · ${propConfiguration}`
                    : `Motor ${index + 1}`,
                'data-motor-rotation': position.rotation ?? 'unknown',
            })
            .css({
                left: `${position.left}%`,
                top: `${position.top}%`,
                visibility: 'visible',
            })
            .removeClass('is-hidden');
    });
}
