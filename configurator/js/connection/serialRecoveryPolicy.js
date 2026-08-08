'use strict';

export const SERIAL_STARTUP_RECOVERY_DELAY_MS = 1500;
export const SERIAL_STARTUP_RECOVERY_WINDOW_MS = 5000;
export const SERIAL_STARTUP_RECOVERY_LIMIT = 1;
export const SERIAL_TERMINAL_OPERATOR_GUARD_MS = 500;

export function isUnexpectedNativeSerialTermination(cause) {
    return Boolean(
        cause
        && cause.origin === 'native'
        && cause.expected === false
        && (cause.event === 'close' || cause.event === 'error'),
    );
}

export function shouldAttemptMavlinkStartupRecovery({
    cause,
    openAttempt,
    connectedDurationMs,
    hadVehicleHeartbeat = false,
}) {
    return Boolean(
        isUnexpectedNativeSerialTermination(cause)
        && cause.phase === 'active'
        && openAttempt?.protocol === 'mavlink'
        && hadVehicleHeartbeat === false
        && Number.isFinite(connectedDurationMs)
        && connectedDurationMs >= 0
        && connectedDurationMs <= SERIAL_STARTUP_RECOVERY_WINDOW_MS
        && (openAttempt.recoveryAttempt || 0) < SERIAL_STARTUP_RECOVERY_LIMIT
    );
}

export function unexpectedSerialTerminationMessage(cause, port) {
    const eventText = cause?.event === 'error'
        ? 'failed'
        : 'closed unexpectedly';
    const phase = cause?.phase || 'unknown';
    const detail = cause?.message || 'No operating-system error was supplied';
    const location = port ? ` on ${port}` : '';

    return (
        `Serial transport${location} ${eventText} during ${phase}: ${detail}. ` +
        'The USB device may have reset or briefly re-enumerated.'
    );
}
