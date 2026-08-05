'use strict';

// Kept as a compatibility shim for extensions that imported the former UI
// guard. Firmware 3.0.7 owns the fixed MICOAIR743 onboard IST8310 transform;
// the Configurator adds no second rotation and leaves user alignment at CW 0°.
export function onboardCompassOrientationRequirement() {
    return null;
}
