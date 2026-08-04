'use strict';

// Kept as a compatibility shim for extensions that imported the former
// board-specific guard. Flight Commander 3.0.3 defers magnetometer alignment
// entirely to the active INAV target and the user's normal alignment settings.
export function onboardCompassOrientationRequirement() {
    return null;
}
