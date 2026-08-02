"use strict";

// ArduPilot motor numbering differs from INAV. These roll/pitch factors are
// used only to place the controller-native motor numbers on Flight
// Commander's existing Quad X and Quad Plus preview artwork.
export const ARDUPILOT_QUAD_MOTOR_RULES = Object.freeze({
  quad_x: Object.freeze([
    Object.freeze({ roll: -1, pitch: -1 }),
    Object.freeze({ roll: 1, pitch: 1 }),
    Object.freeze({ roll: 1, pitch: -1 }),
    Object.freeze({ roll: -1, pitch: 1 }),
  ]),
  quad_p: Object.freeze([
    Object.freeze({ roll: -1, pitch: 0 }),
    Object.freeze({ roll: 1, pitch: 0 }),
    Object.freeze({ roll: 0, pitch: -1 }),
    Object.freeze({ roll: 0, pitch: 1 }),
  ]),
});
