import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHudAnnouncement,
  createGroundControlHud,
  drawGroundControlHud,
  hudAttitudeTransform,
  normalizeHudState,
} from "../../../tabs/flight_hud-v1.3.5.js";

function createContext() {
  const operations = [];
  const context = {
    operations,
    beginPath() {
      operations.push(["beginPath"]);
    },
    moveTo(...args) {
      operations.push(["moveTo", ...args]);
    },
    lineTo(...args) {
      operations.push(["lineTo", ...args]);
    },
    arcTo(...args) {
      operations.push(["arcTo", ...args]);
    },
    arc(...args) {
      operations.push(["arc", ...args]);
    },
    rect(...args) {
      operations.push(["rect", ...args]);
    },
    closePath() {
      operations.push(["closePath"]);
    },
    clip() {
      operations.push(["clip"]);
    },
    save() {
      operations.push(["save"]);
    },
    restore() {
      operations.push(["restore"]);
    },
    translate(...args) {
      operations.push(["translate", ...args]);
    },
    rotate(...args) {
      operations.push(["rotate", ...args]);
    },
    fillRect(...args) {
      operations.push(["fillRect", ...args]);
    },
    clearRect(...args) {
      operations.push(["clearRect", ...args]);
    },
    fill() {
      operations.push(["fill"]);
    },
    stroke() {
      operations.push(["stroke"]);
    },
    fillText(...args) {
      operations.push(["fillText", ...args]);
    },
    strokeText(...args) {
      operations.push(["strokeText", ...args]);
    },
    setTransform(...args) {
      operations.push(["setTransform", ...args]);
    },
    createLinearGradient(...args) {
      operations.push(["createLinearGradient", ...args]);
      return {
        addColorStop(...stopArgs) {
          operations.push(["addColorStop", ...stopArgs]);
        },
      };
    },
  };
  return context;
}

function createCanvas(width = 640, height = 420) {
  const context = createContext();
  return {
    width: 0,
    height: 0,
    context,
    getBoundingClientRect: () => ({ width, height }),
    getContext: (type) => (type === "2d" ? context : null),
  };
}

test("normalizes finite telemetry without inventing unavailable values", () => {
  assert.deepEqual(
    normalizeHudState({
      connected: true,
      linkLost: false,
      armed: true,
      modeName: "AUTO",
      roll: 220,
      pitch: -120,
      heading: 370,
      groundSpeed: "12.5",
      airSpeed: null,
      relativeAltitude: 43.2,
      climbRate: -1.4,
      batteryRemaining: 130,
      gpsFix: 3,
      satellites: 17.8,
    }),
    {
      connected: true,
      linkLost: false,
      armed: true,
      modeName: "AUTO",
      roll: 180,
      pitch: -90,
      heading: 10,
      groundSpeed: 12.5,
      airSpeed: null,
      relativeAltitude: 43.2,
      climbRate: -1.4,
      voltage: null,
      current: null,
      batteryRemaining: 100,
      gpsFix: 3,
      satellites: 17,
    },
  );
});

test("treats MAVLink unknown battery and satellite sentinels as unavailable", () => {
  const state = normalizeHudState({
    connected: true,
    batteryRemaining: -1,
    satellites: 255,
  });
  assert.equal(state.batteryRemaining, null);
  assert.equal(state.satellites, null);
});

test("uses aircraft-attitude signs expected by an artificial horizon", () => {
  const transform = hudAttitudeTransform({ roll: 25, pitch: 10 }, 360);
  assert.ok(
    transform.rollRadians < 0,
    "right roll must rotate the horizon left",
  );
  assert.ok(
    transform.horizonOffset > 0,
    "nose-up pitch must move the horizon down",
  );
  assert.equal(transform.pixelsPerDegree, 5);
});

test("wraps a rounded north crossing to 000 instead of 360", () => {
  const canvas = createCanvas(640, 420);
  drawGroundControlHud(canvas, {
    connected: true,
    roll: 0,
    pitch: 0,
    heading: 359.6,
  });
  const labels = canvas.context.operations
    .filter(([operation]) => operation === "fillText")
    .map(([, value]) => String(value));
  assert.ok(labels.includes("000"));
  assert.equal(labels.includes("360"), false);
});

test("sizes the backing canvas for device pixel ratio while drawing in CSS pixels", () => {
  const originalDevicePixelRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    const canvas = createCanvas(400, 250);
    drawGroundControlHud(canvas, {
      connected: true,
      roll: 0,
      pitch: 0,
      heading: 90,
    });
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 500);
    assert.ok(
      canvas.context.operations.some(
        ([operation, ...values]) =>
          operation === "setTransform" && values.join(",") === "2,0,0,2,0,0",
      ),
    );
  } finally {
    if (originalDevicePixelRatio === undefined) {
      delete globalThis.devicePixelRatio;
    } else {
      globalThis.devicePixelRatio = originalDevicePixelRatio;
    }
  }
});

test("renders primary flight instruments at both major and inset sizes", () => {
  for (const [width, height] of [
    [720, 480],
    [280, 190],
  ]) {
    const canvas = createCanvas(width, height);
    assert.equal(
      drawGroundControlHud(canvas, {
        connected: true,
        armed: true,
        modeName: "AUTO",
        roll: 8,
        pitch: -4,
        heading: 271,
        groundSpeed: 14.2,
        airSpeed: 15.1,
        relativeAltitude: 82.4,
        climbRate: 1.7,
        voltage: 22.8,
        batteryRemaining: 64,
        gpsFix: 3,
        satellites: 19,
      }),
      true,
    );
    const labels = canvas.context.operations
      .filter(([operation]) => operation === "fillText")
      .map(([, value]) => String(value));
    assert.ok(labels.some((value) => value.includes("271")));
    assert.ok(labels.some((value) => value.includes("AUTO")));
    assert.ok(labels.some((value) => value.includes("GPS 3D")));
    assert.ok(labels.some((value) => value.includes("BAT")));
    assert.ok(
      canvas.context.operations.some(([operation]) => operation === "rotate"),
    );
  }
});

test("announces link, attitude, speed, and altitude for assistive technology", () => {
  const announcement = buildHudAnnouncement({
    connected: true,
    armed: false,
    modeName: "LOITER",
    roll: 1,
    pitch: -2,
    heading: 90,
    groundSpeed: 7.5,
    relativeAltitude: 32,
  });
  assert.match(announcement, /link active/);
  assert.match(announcement, /mode LOITER/);
  assert.match(announcement, /heading 90 degrees/);
  assert.match(announcement, /ground speed 7\.5 meters per second/);
  assert.match(announcement, /relative altitude 32\.0 meters/);
});

test("does not draw a false level horizon when attitude is unavailable", () => {
  const canvas = createCanvas(520, 320);
  assert.equal(
    drawGroundControlHud(canvas, {
      connected: true,
      linkLost: false,
      modeName: "AUTO",
      roll: null,
      pitch: null,
      heading: 180,
    }),
    true,
  );
  assert.equal(
    canvas.context.operations.some(([operation]) => operation === "rotate"),
    false,
  );
  assert.ok(
    canvas.context.operations.some(
      ([operation, value]) =>
        operation === "fillText" && value === "ATTITUDE DATA UNAVAILABLE",
    ),
  );
  for (const operation of canvas.context.operations) {
    for (const argument of operation.slice(1)) {
      if (typeof argument === "number") {
        assert.equal(
          Number.isFinite(argument),
          true,
          `${operation[0]} received ${argument}`,
        );
      }
    }
  }
});

test("swaps map and HUD priority, persists the choice, and cleans up", () => {
  const canvas = createCanvas(640, 420);
  const listeners = new Map();
  const attributes = new Map();
  const visuals = { dataset: {} };
  const surface = {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const button = {
    textContent: "",
    title: "",
    setAttribute(name, value) {
      attributes.set(`button:${name}`, value);
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const elements = {
    flightDataVisuals: visuals,
    flightDataHud: surface,
    flightDataHudCanvas: canvas,
    flightDataPrimaryView: button,
  };
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
  };
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let resizeDisconnected = false;
  let layoutChanges = 0;
  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {}

    disconnect() {
      resizeDisconnected = true;
    }
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const controller = createGroundControlHud({
      storage,
      getState: () => ({
        connected: true,
        modeName: "AUTO",
        heading: 42,
      }),
      onLayoutChange: () => {
        layoutChanges += 1;
      },
    });
    assert.equal(controller.primaryView(), "map");
    assert.equal(visuals.dataset.primary, "map");
    assert.equal(button.textContent, "Expand HUD");
    assert.equal(attributes.get("button:aria-pressed"), "false");

    listeners.get("click")();
    assert.equal(controller.primaryView(), "hud");
    assert.equal(visuals.dataset.primary, "hud");
    assert.equal(button.textContent, "Expand map");
    assert.equal(attributes.get("button:aria-pressed"), "true");
    assert.equal(
      storageValues.get("flightCommanderGroundControlPrimaryView"),
      "hud",
    );
    assert.ok(layoutChanges >= 2);

    controller.render({
      connected: false,
      linkLost: true,
      modeName: "--",
      heading: null,
    });
    assert.match(attributes.get("aria-label"), /link lost/);
    assert.match(attributes.get("aria-label"), /mode AUTO/);

    controller.destroy();
    assert.equal(resizeDisconnected, true);
    assert.equal(listeners.has("click"), false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
