import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    DSHOT_CONFIGURATION_STATUS,
    decodeEscRpmPayload,
    decodeEscTelemetryPayload,
    getDshotConfigurationState,
    isDshotProtocol,
    normalizeDshotDependencies,
    validateMotorPoleCount,
} from '../../../js/flightCommander/dshotConfiguration.js';
import MSPCodes from '../../../js/msp/MSPCodes.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputsHtml = readFileSync(resolve(projectRoot, 'tabs/outputs.html'), 'utf8');
const outputsSource = readFileSync(resolve(projectRoot, 'tabs/outputs.js'), 'utf8');
const pidTuningHtml = readFileSync(resolve(projectRoot, 'tabs/pid_tuning.html'), 'utf8');
const englishMessages = JSON.parse(readFileSync(resolve(projectRoot, 'locale/en/messages.json'), 'utf8'));

test('all supported digital motor protocols, including DSHOT150, are DShot', () => {
    for (const protocol of [4, 5, 6, '4', '5', '6']) {
        assert.equal(isDshotProtocol(protocol), true, `protocol ${protocol} should be DShot`);
    }
    for (const protocol of [0, 1, 2, 3, 7, null, undefined, 'DSHOT300']) {
        assert.equal(isDshotProtocol(protocol), false, `protocol ${protocol} should not be DShot`);
    }
});

test('bidirectional and extended telemetry dependencies are deterministic', () => {
    const analog = getDshotConfigurationState({
        protocol: 3,
        bidirectionalSupported: true,
        bidirectionalEnabled: true,
        extendedTelemetrySupported: true,
        extendedTelemetryEnabled: true,
        motorPoles: 14,
    });
    assert.equal(analog.status, DSHOT_CONFIGURATION_STATUS.DSHOT_REQUIRED);
    assert.equal(analog.bidirectionalAllowed, false);
    assert.deepEqual(normalizeDshotDependencies({
        protocol: 3,
        bidirectionalSupported: true,
        bidirectionalEnabled: true,
        extendedTelemetrySupported: true,
        extendedTelemetryEnabled: true,
        motorPoles: 14,
    }), {
        bidirectionalEnabled: false,
        extendedTelemetryEnabled: false,
    });

    const bidirectionalOff = getDshotConfigurationState({
        protocol: 4,
        bidirectionalSupported: true,
        bidirectionalEnabled: false,
        extendedTelemetrySupported: true,
        extendedTelemetryEnabled: true,
        motorPoles: 14,
    });
    assert.equal(bidirectionalOff.status, DSHOT_CONFIGURATION_STATUS.DISABLED);
    assert.equal(bidirectionalOff.extendedTelemetryAllowed, false);

    const ready = getDshotConfigurationState({
        protocol: 4,
        bidirectionalSupported: true,
        bidirectionalEnabled: true,
        extendedTelemetrySupported: true,
        extendedTelemetryEnabled: true,
        motorPoles: 14,
    });
    assert.equal(ready.status, DSHOT_CONFIGURATION_STATUS.READY);
    assert.equal(ready.telemetryReady, true);
    assert.equal(ready.extendedTelemetryActive, true);
});

test('motor pole validation matches the firmware setting range', () => {
    assert.deepEqual(validateMotorPoleCount(4), { valid: true, value: 4, reason: null });
    assert.deepEqual(validateMotorPoleCount('255'), { valid: true, value: 255, reason: null });
    assert.equal(validateMotorPoleCount(3).reason, 'out-of-range');
    assert.equal(validateMotorPoleCount(256).reason, 'out-of-range');
    assert.equal(validateMotorPoleCount(14.5).reason, 'not-an-integer');

    const invalid = getDshotConfigurationState({
        protocol: 6,
        bidirectionalSupported: true,
        bidirectionalEnabled: true,
        motorPoles: 3,
    });
    assert.equal(invalid.status, DSHOT_CONFIGURATION_STATUS.INVALID_MOTOR_POLES);
    assert.equal(invalid.telemetryReady, false);
});

test('MSP2 ESC RPM payloads decode one little-endian value per motor', () => {
    const payload = new ArrayBuffer(12);
    const view = new DataView(payload);
    view.setUint32(0, 12345, true);
    view.setUint32(4, 23456, true);
    view.setUint32(8, 34567, true);

    assert.deepEqual(decodeEscRpmPayload(payload), [
        { index: 0, rpm: 12345 },
        { index: 1, rpm: 23456 },
        { index: 2, rpm: 34567 },
    ]);
    assert.deepEqual(decodeEscRpmPayload(payload, 2), [
        { index: 0, rpm: 12345 },
        { index: 1, rpm: 23456 },
    ]);
    assert.throws(() => decodeEscRpmPayload(new Uint8Array(3)), /32-bit RPM/);
});

test('MSP2 extended ESC telemetry decodes aligned firmware records safely', () => {
    const payload = new ArrayBuffer(1 + 2 * 16);
    const view = new DataView(payload);
    view.setUint8(0, 2);

    view.setUint8(1, 0);
    view.setInt16(3, 42, true);
    view.setInt16(5, 16000, true);
    view.setInt32(9, 3250, true);
    view.setUint32(13, 12345, true);

    const second = 17;
    view.setUint8(second, 255);
    view.setInt16(second + 2, 50, true);
    view.setInt16(second + 4, 0, true);
    view.setInt32(second + 8, 0, true);
    view.setUint32(second + 12, 0, true);

    assert.deepEqual(decodeEscTelemetryPayload(payload), [
        {
            index: 0,
            dataAge: 0,
            valid: true,
            temperature: 42,
            voltage: 16000,
            current: 3250,
            rpm: 12345,
        },
        {
            index: 1,
            dataAge: 255,
            valid: false,
            temperature: 50,
            voltage: 0,
            current: 0,
            rpm: 0,
        },
    ]);
    assert.throws(() => decodeEscTelemetryPayload([2, 0, 1]), /too short/);
});

test('Outputs exposes gated, persistent controls and both live telemetry commands', () => {
    assert.match(outputsHtml, /id="dshot-bidirectional"[^>]*data-setting="dshot_bidir_enabled"/);
    assert.match(outputsHtml, /id="dshot-extended-telemetry"[^>]*data-setting="dshot_edt_enabled"/);
    assert.match(outputsHtml, /id="motor_poles"[^>]*data-setting="motor_poles"/);
    assert.match(outputsHtml, /id="dshot-telemetry-motors"/);
    assert.match(outputsSource, /function onLoad\(settingsPromise\)/);
    assert.match(outputsSource, /Promise\.resolve\(settingsPromise\)\.then/);
    assert.match(outputsSource, /MSPCodes\.MSP2_INAV_ESC_RPM/);
    assert.match(outputsSource, /MSPCodes\.MSP2_INAV_ESC_TELEM/);
    assert.match(outputsSource, /telemetryMotor\.voltage \/ 100/);
    assert.match(outputsSource, /telemetryMotor\.current \/ 100/);
    assert.doesNotMatch(outputsSource, /telemetryMotor\.(?:voltage|current) \/ 1000/);
    assert.match(outputsSource, /prepareDshotConfigurationForSave\(\)/);
    assert.doesNotMatch(outputsSource, /motorPwmProtocol\s*>=\s*5/);
    assert.equal(MSPCodes.MSP2_INAV_ESC_RPM, 0x2040);
    assert.equal(MSPCodes.MSP2_INAV_ESC_TELEM, 0x2041);
});

test('RPM-filter guidance links live RPM, motor poles, and reboot requirements', () => {
    assert.match(pidTuningHtml, /data-i18n_title="pidTuning_rpm_gyro_filter_enabled_help"/);
    const help = englishMessages.pidTuning_rpm_gyro_filter_enabled_help.message;
    assert.match(help, /bidirectional DShot/i);
    assert.match(help, /motor pole count/i);
    assert.match(help, /every motor/i);
    assert.match(help, /reboot/i);
    assert.match(englishMessages.dshotExtendedTelemetryHelp.message, /not required.*RPM filter/i);
    assert.match(englishMessages.motor_poles_help.message, /electrical RPM.*mechanical RPM/i);
});
