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
 * Render the fixed motor-number elements inside one preview-image wrapper.
 * The function does not depend on image dimensions or the SVG load event.
 */
export function renderMotorNumberLabels($preview, imageName, rules) {
    const positions = calculateMotorNumberPositions(imageName, rules);
    const $labels = $preview.find('.motorNumber');

    $preview.attr('data-motor-number-layout', 'percentage');
    $labels.addClass('is-hidden').css('visibility', 'hidden');

    positions.forEach((position, index) => {
        const $label = $labels.eq(index);
        if ($label.length === 0) {
            return;
        }

        $label
            .text(index + 1)
            .css({
                left: `${position.left}%`,
                top: `${position.top}%`,
                visibility: 'visible',
            })
            .removeClass('is-hidden');
    });
}
