import assert from "node:assert/strict";
import test from "node:test";
import {
  HUD_GROUND_COLORS,
  buildHudAnnouncement,
  createGroundControlHud,
  drawGroundControlHud,
  hudAttitudeTransform,
  normalizeHudState,
  normalizeMinorViewPosition,
} from "../../../tabs/flight_hud-v1.3.5.js";

function relativeLuminance(hexColor) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hexColor.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)]
    .sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

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

test("uses a green ground gradient with high-contrast HUD markings", () => {
  const whiteMarkings = "#ffffff";
  const yellowAircraftMarker = "#fff200";
  const skyAtHorizon = "#46aee0";
  for (const color of Object.values(HUD_GROUND_COLORS)) {
    assert.ok(
      contrastRatio(color, whiteMarkings) >= 7,
      `${color} must keep white HUD data at enhanced contrast`,
    );
    assert.ok(
      contrastRatio(color, yellowAircraftMarker) >= 7,
      `${color} must keep the yellow aircraft marker at enhanced contrast`,
    );
    assert.ok(
      contrastRatio(color, skyAtHorizon) >= 3,
      `${color} must remain visibly distinct from the sky`,
    );
  }
  assert.ok(
    contrastRatio(HUD_GROUND_COLORS.horizon, HUD_GROUND_COLORS.depth) >= 1.5,
    "the green ground must retain visible depth shading",
  );

  const canvas = createCanvas(640, 420);
  drawGroundControlHud(canvas, {
    connected: true,
    roll: 0,
    pitch: 0,
    heading: 0,
  });
  const gradientStops = canvas.context.operations
    .filter(([operation]) => operation === "addColorStop")
    .map(([, , color]) => color);
  assert.ok(gradientStops.includes(HUD_GROUND_COLORS.horizon));
  assert.ok(gradientStops.includes(HUD_GROUND_COLORS.depth));
  assert.equal(gradientStops.includes("#a26a37"), false);
  assert.equal(gradientStops.includes("#4f2b16"), false);
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

test("converts every HUD speed, altitude, and spoken unit in imperial mode", () => {
  const canvas = createCanvas(720, 480);
  drawGroundControlHud(canvas, {
    connected: true,
    modeName: "AUTO",
    roll: 0,
    pitch: 0,
    heading: 90,
    groundSpeed: 10,
    airSpeed: 12,
    relativeAltitude: 30,
    climbRate: 2,
  }, "imperial");
  const labels = canvas.context.operations
    .filter(([operation]) => operation === "fillText")
    .map(([, value]) => String(value));
  assert.ok(labels.includes("GS mph"));
  assert.ok(labels.includes("REL ALT ft"));
  assert.ok(labels.some((value) => value.startsWith("AS 26.8 mph")));
  assert.ok(labels.some((value) => value.startsWith("VS 6.6 ft/s")));

  const announcement = buildHudAnnouncement({
    connected: true,
    modeName: "AUTO",
    groundSpeed: 10,
    relativeAltitude: 30,
  }, "imperial");
  assert.match(announcement, /ground speed 22\.4 miles per hour/);
  assert.match(announcement, /relative altitude 98\.4 feet/);
});

test("normalizes persisted minor-view coordinates and rejects corrupt values", () => {
  assert.deepEqual(normalizeMinorViewPosition('{"x":0.25,"y":0.75}'), {
    x: 0.25,
    y: 0.75,
  });
  assert.deepEqual(normalizeMinorViewPosition({ x: -2, y: 3 }), {
    x: 0,
    y: 1,
  });
  assert.equal(normalizeMinorViewPosition("not json"), null);
  assert.equal(normalizeMinorViewPosition({ x: "bad", y: 0.5 }), null);
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

test("swaps, drags, persists, resets, and cleans up the movable minor view", () => {
  const canvas = createCanvas(640, 420);
  const attributes = new Map();
  const createElement = ({ id, rect } = {}) => {
    const listeners = new Map();
    const classes = new Set();
    const element = {
      id,
      dataset: {},
      style: {},
      children: [],
      parentNode: null,
      disabled: false,
      textContent: "",
      title: "",
      listeners,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, value);
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      removeEventListener(name) {
        listeners.delete(name);
      },
      appendChild(child) {
        if (child.parentNode) {
          child.parentNode.children = child.parentNode.children.filter(
            (candidate) => candidate !== child,
          );
        }
        this.children = this.children.filter((candidate) => candidate !== child);
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      getBoundingClientRect() {
        return typeof rect === "function" ? rect() : rect ?? {
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          right: 0,
          bottom: 0,
        };
      },
    };
    return element;
  };
  const workspace = createElement({ id: "workspace" });
  const visuals = createElement({ id: "visuals" });
  const surface = createElement({ id: "hud" });
  const mapSurface = createElement({ id: "map" });
  let layerWidth = 900;
  let layerHeight = 400;
  const floatingLayer = createElement({
    id: "layer",
    rect: () => ({
      left: 100,
      top: 200,
      width: layerWidth,
      height: layerHeight,
      right: 100 + layerWidth,
      bottom: 200 + layerHeight,
    }),
  });
  const minorWindow = createElement({
    id: "minorWindow",
    rect: () => {
      const left = minorWindow.style.left
        ? 100 + Number.parseFloat(minorWindow.style.left)
        : 680;
      const top = minorWindow.style.top
        ? 200 + Number.parseFloat(minorWindow.style.top)
        : 360;
      return {
        left,
        top,
        width: 300,
        height: 220,
        right: left + 300,
        bottom: top + 220,
      };
    },
  });
  const minorContent = createElement({ id: "minorContent" });
  const dragHandle = createElement({ id: "dragHandle" });
  const capturedPointers = new Set();
  dragHandle.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  dragHandle.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  dragHandle.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
  const minorTitle = createElement({ id: "minorTitle" });
  const resetButton = createElement({ id: "reset" });
  const button = createElement({ id: "button" });
  visuals.appendChild(mapSurface);
  minorContent.appendChild(surface);
  const elements = {
    flightDataWorkspace: workspace,
    flightDataVisuals: visuals,
    flightDataHud: surface,
    flightDataMapSurface: mapSurface,
    flightDataHudCanvas: canvas,
    flightDataPrimaryView: button,
    flightDataFloatingLayer: floatingLayer,
    flightDataMinorWindow: minorWindow,
    flightDataMinorContent: minorContent,
    flightDataMinorDragHandle: dragHandle,
    flightDataMinorViewTitle: minorTitle,
    flightDataResetMinorView: resetButton,
  };
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: (key) => storageValues.delete(key),
  };
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let resizeDisconnected = false;
  let layoutChanges = 0;
  const resizeCallbacks = [];
  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeCallbacks.push(callback);
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
    assert.deepEqual(visuals.children, [mapSurface]);
    assert.deepEqual(minorContent.children, [surface]);
    assert.equal(minorTitle.textContent, "Live HUD");

    const layoutChangesBeforeFirstSwap = layoutChanges;
    button.listeners.get("click")();
    assert.equal(controller.primaryView(), "hud");
    assert.equal(visuals.dataset.primary, "hud");
    assert.equal(button.textContent, "Expand map");
    assert.equal(attributes.get("button:aria-pressed"), "true");
    assert.deepEqual(visuals.children, [surface]);
    assert.deepEqual(minorContent.children, [mapSurface]);
    assert.equal(minorTitle.textContent, "Live map");
    assert.equal(
      storageValues.get("flightCommanderGroundControlPrimaryView"),
      "hud",
    );
    assert.ok(layoutChanges > layoutChangesBeforeFirstSwap);

    dragHandle.listeners.get("pointerdown")({
      pointerId: 4,
      button: 0,
      clientX: 700,
      clientY: 400,
      preventDefault() {},
    });
    dragHandle.listeners.get("pointermove")({
      pointerId: 4,
      clientX: 200,
      clientY: 250,
      preventDefault() {},
    });
    assert.equal(minorWindow.style.left, "80px");
    assert.equal(minorWindow.style.top, "10px");
    assert.equal(
      minorWindow.classList.contains("fc-minor-view-window--dragging"),
      true,
    );
    dragHandle.listeners.get("pointerup")({
      pointerId: 4,
      preventDefault() {},
    });
    assert.equal(
      minorWindow.classList.contains("fc-minor-view-window--dragging"),
      false,
    );
    const savedPosition = JSON.parse(
      storageValues.get("flightCommanderGroundControlMinorPosition"),
    );
    assert.ok(Math.abs(savedPosition.x - 80 / 600) < 0.001);
    assert.ok(Math.abs(savedPosition.y - 10 / 180) < 0.001);

    dragHandle.listeners.get("keydown")({
      key: "ArrowLeft",
      shiftKey: false,
      preventDefault() {},
    });
    assert.equal(minorWindow.style.left, "70px");

    button.listeners.get("click")();
    assert.equal(controller.primaryView(), "map");
    assert.equal(minorWindow.style.left, "70px");
    assert.deepEqual(visuals.children, [mapSurface]);
    assert.deepEqual(minorContent.children, [surface]);

    resetButton.listeners.get("click")();
    assert.equal(controller.minorViewPosition(), null);
    assert.equal(minorWindow.style.left, "");
    assert.equal(minorWindow.style.top, "");
    assert.equal(resetButton.disabled, true);
    assert.equal(
      storageValues.has("flightCommanderGroundControlMinorPosition"),
      false,
    );

    controller.render({
      connected: false,
      linkLost: true,
      modeName: "--",
      heading: null,
    });
    assert.match(attributes.get("hud:aria-label"), /link lost/);
    assert.match(attributes.get("hud:aria-label"), /mode AUTO/);

    controller.setUnitSystem("imperial");
    assert.equal(controller.unitSystem(), "imperial");

    dragHandle.listeners.get("pointerdown")({
      pointerId: 9,
      button: 0,
      clientX: 700,
      clientY: 400,
      preventDefault() {},
    });
    assert.equal(capturedPointers.has(9), true);
    dragHandle.listeners.get("pointercancel")({
      pointerId: 9,
      preventDefault() {},
    });
    assert.equal(capturedPointers.has(9), false);

    dragHandle.listeners.get("pointerdown")({
      pointerId: 10,
      button: 0,
      clientX: 700,
      clientY: 400,
      preventDefault() {},
    });
    assert.equal(capturedPointers.has(10), true);
    dragHandle.listeners.get("lostpointercapture")({
      pointerId: 10,
      preventDefault() {},
    });
    assert.equal(capturedPointers.has(10), false);

    dragHandle.listeners.get("pointerdown")({
      pointerId: 11,
      button: 0,
      clientX: 700,
      clientY: 400,
      preventDefault() {},
    });
    assert.equal(capturedPointers.has(11), true);

    controller.destroy();
    assert.equal(resizeDisconnected, true);
    assert.equal(capturedPointers.size, 0);
    assert.equal(button.listeners.has("click"), false);
    assert.equal(dragHandle.listeners.has("pointerdown"), false);
    assert.equal(resetButton.listeners.has("click"), false);

    storageValues.set(
      "flightCommanderGroundControlMinorPosition",
      JSON.stringify({ x: 0.5, y: 0.5 }),
    );
    const restoredController = createGroundControlHud({
      storage,
      getState: () => ({ connected: true, modeName: "AUTO" }),
      onLayoutChange: () => {
        layoutChanges += 1;
      },
    });
    assert.deepEqual(restoredController.minorViewPosition(), {
      x: 0.5,
      y: 0.5,
    });
    assert.equal(minorWindow.style.left, "300px");
    assert.equal(minorWindow.style.top, "90px");

    layerWidth = 700;
    layerHeight = 300;
    resizeCallbacks.at(-1)();
    assert.equal(minorWindow.style.left, "200px");
    assert.equal(minorWindow.style.top, "40px");
    restoredController.destroy();
  } finally {
    globalThis.document = originalDocument;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
