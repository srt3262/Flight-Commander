"use strict";

export function bindHostTimer(name) {
  const timer = globalThis[name];
  if (typeof timer !== "function") {
    throw new TypeError(`MAVLink host timer ${name} is unavailable.`);
  }
  return timer.bind(globalThis);
}
