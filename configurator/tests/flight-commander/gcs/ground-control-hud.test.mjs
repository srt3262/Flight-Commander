import assert from "node:assert/strict";
import test from "node:test";
import {
  HUD_GROUND_COLORS,
  buildHudAnnouncement,
  createGroundControlHud,
  drawGroundControlHud,
  hudAttitudeTransform,
  normalizeHudState,
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
  assert.equal(labels.some((value) => value.startsWith("AS ")), false);
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

test("switches major view without moving or overlapping either live pane", () => {
  const canvas = createCanvas(640, 420);
  const attributes = new Map();
  const createElement = (id) => {
    const listeners = new Map();
    return {
      id,
      dataset: {},
      textContent: "",
      title: "",
      listeners,
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, value);
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      removeEventListener(name) {
        listeners.delete(name);
      },
    };
  };
  const workspace = createElement("workspace");
  const visuals = createElement("visuals");
  const surface = createElement("hud");
  const mapSurface = createElement("mapSurface");
  const mapPane = createElement("mapPane");
  const hudPane = createElement("hudPane");
  const mapRole = createElement("mapRole");
  const hudRole = createElement("hudRole");
  const button = createElement("button");
  const elements = {
    flightDataWorkspace: workspace,
    flightDataVisuals: visuals,
    flightDataHud: surface,
    flightDataMapSurface: mapSurface,
    flightDataMapPane: mapPane,
    flightDataHudPane: hudPane,
    flightDataMapRole: mapRole,
    flightDataHudRole: hudRole,
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
    assert.equal(mapPane.dataset.role, "major");
    assert.equal(hudPane.dataset.role, "minor");
    assert.equal(mapRole.textContent, "Major view");
    assert.equal(hudRole.textContent, "Minor view");
    assert.equal(button.textContent, "Make HUD major");
    assert.equal(attributes.get("button:aria-pressed"), "false");

    const changesBeforeSwitch = layoutChanges;
    button.listeners.get("click")();
    assert.equal(controller.primaryView(), "hud");
    assert.equal(visuals.dataset.primary, "hud");
    assert.equal(mapPane.dataset.role, "minor");
    assert.equal(hudPane.dataset.role, "major");
    assert.equal(mapRole.textContent, "Minor view");
    assert.equal(hudRole.textContent, "Major view");
    assert.equal(button.textContent, "Make map major");
    assert.equal(attributes.get("button:aria-pressed"), "true");
    assert.equal(
      storageValues.get("flightCommanderGroundControlPrimaryView"),
      "hud",
    );
    assert.ok(layoutChanges > changesBeforeSwitch);

    controller.render({ connected: false, linkLost: true, modeName: "--" });
    assert.match(attributes.get("hud:aria-label"), /link lost/);
    assert.match(attributes.get("hud:aria-label"), /mode AUTO/);
    controller.setUnitSystem("imperial");
    assert.equal(controller.unitSystem(), "imperial");

    controller.destroy();
    assert.equal(resizeDisconnected, true);
    assert.equal(button.listeners.has("click"), false);

    const restored = createGroundControlHud({
      storage,
      getState: () => ({ connected: true, modeName: "AUTO" }),
    });
    assert.equal(restored.primaryView(), "hud");
    assert.equal(visuals.dataset.primary, "hud");
    restored.destroy();
  } finally {
    globalThis.document = originalDocument;
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
