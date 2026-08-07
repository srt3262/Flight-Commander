import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPASS_ORIENTATION_FACES } from '../../../js/flightCommander/compassOrientation.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const indicatorSource = readFileSync(
    resolve(projectRoot, 'js/libraries/jquery.flightindicators.js'),
    'utf8',
);
const setupSource = readFileSync(resolve(projectRoot, 'tabs/setup.js'), 'utf8');

test('Status artificial horizon and 3D model use complementary roll scene rotations', () => {
    const rollStart = indicatorSource.indexOf('function _setRoll(roll)');
    const rollEnd = indicatorSource.indexOf('function _setPitch(pitch)', rollStart);
    assert.notEqual(rollStart, -1, 'attitude roll renderer is missing');
    assert.notEqual(rollEnd, -1, 'attitude pitch renderer is missing');
    const rollRenderer = indicatorSource.slice(rollStart, rollEnd);

    assert.doesNotMatch(rollRenderer, /roll\s*\*=\s*-1/);
    assert.match(rollRenderer, /rotate\('\+roll\+'deg\)/);
    assert.match(
        setupSource,
        /model\.rotation\.z\s*=\s*\(FC\.SENSOR_DATA\.kinematics\[0\]\s*\*\s*-1\.0\)/,
    );
});

test('guided compass orientation names the physical left and right faces correctly', () => {
    assert.deepEqual(
        COMPASS_ORIENTATION_FACES.slice(2, 4),
        [
            { index: 2, label: 'Left side up', axis: '+Y' },
            { index: 3, label: 'Right side up', axis: '-Y' },
        ],
    );
});
