import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculateMotorNumberPositions,
  calculateMotorRotationDirections,
  motorPreviewAssetStem,
  renderMotorNumberLabels,
  resolveMotorNumberPositions,
  resolveMotorPreviewLayout,
} from "../../../js/motorPreview.js";
import { ARDUPILOT_QUAD_MOTOR_RULES } from "../../../js/ardupilot/motorLayout.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

const rule = (roll, pitch, yaw = 0) => ({
  getRoll: () => roll,
  getPitch: () => pitch,
  getYaw: () => yaw,
});

test("Quad X labels map motors 1-4 to the four motor circles", () => {
  assert.deepEqual(
    calculateMotorNumberPositions("quad_x", [
      rule(-1, 1),
      rule(-1, -1),
      rule(1, 1),
      rule(1, -1),
    ]),
    [
      { left: 80, top: 80 },
      { left: 80, top: 20 },
      { left: 20, top: 80 },
      { left: 20, top: 20 },
    ],
  );
});

test("Quad Plus labels center the front/rear and left/right motors", () => {
  assert.deepEqual(
    calculateMotorNumberPositions("quad_p", [
      rule(0, 1),
      rule(-1, 0),
      rule(1, 0),
      rule(0, -1),
    ]),
    [
      { left: 50, top: 80 },
      { left: 80, top: 50 },
      { left: 20, top: 50 },
      { left: 50, top: 20 },
    ],
  );
});

test("Mixer and Outputs both use the image-bound motor-number overlay", () => {
  for (const path of ["tabs/mixer.html", "tabs/outputs.html"]) {
    const html = source(path);
    assert.match(html, /class="mixer-preview-image-numbers"/);
    for (let motor = 1; motor <= 4; motor += 1) {
      assert.match(html, new RegExp(`id="motorNumber${motor}"`));
    }
  }

  for (const path of ["tabs/mixer.js", "tabs/outputs.js"]) {
    assert.match(source(path), /renderMotorNumberLabels/);
    assert.match(source(path), /motorPreviewAssetStem/);
    assert.match(source(path), /\$\{assetStem\}\.svg/);
    assert.match(source(path), /motorMixer/);
  }
  assert.match(source("js/motorPreview.js"), /data-motor-number-fallback/);

  const theme = source("src/css/theme.css");
  assert.match(theme, /\.mixer-preview-image-numbers \.motorNumber\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*3;[^}]*visibility:\s*visible;[^}]*color:\s*#ffffff\s*!important;/s);
  assert.match(theme, /transform:\s*translate\(-50%,\s*-50%\)/);
  assert.doesNotMatch(
    source("src/css/tabs/motors.css"),
    /\.tab-motors \.motorNumber\s*\{[^}]*visibility:\s*hidden/s,
  );
});

test("INAV motor order and rotation stay aligned for Props-in and Props-out", () => {
  const layouts = {
    quad_x: [
      rule(-1, 1, -1),
      rule(-1, -1, 1),
      rule(1, 1, 1),
      rule(1, -1, -1),
    ],
    quad_p: [
      rule(0, 1, -1),
      rule(-1, 0, 1),
      rule(1, 0, 1),
      rule(0, -1, -1),
    ],
  };

  for (const [imageName, rules] of Object.entries(layouts)) {
    const propsIn = resolveMotorPreviewLayout(imageName, rules, null, false);
    const propsOut = resolveMotorPreviewLayout(imageName, rules, null, true);

    assert.deepEqual(
      propsIn.map(({ left, top }) => ({ left, top })),
      propsOut.map(({ left, top }) => ({ left, top })),
      `${imageName} must not move or renumber motors when direction changes`,
    );
    assert.deepEqual(
      calculateMotorRotationDirections(imageName, rules, false),
      ["CW", "CCW", "CCW", "CW"],
    );
    assert.deepEqual(
      calculateMotorRotationDirections(imageName, rules, true),
      ["CCW", "CW", "CW", "CCW"],
    );
    assert.equal(motorPreviewAssetStem(imageName, false), imageName);
    assert.equal(motorPreviewAssetStem(imageName, true), `${imageName}_reverse`);

    const normalAsset = source(`resources/motor_order/${imageName}.svg`);
    const reverseAsset = source(`resources/motor_order/${imageName}_reverse.svg`);
    assert.match(normalAsset, /data-props-configuration="in"/);
    assert.match(normalAsset, /data-motor-rotations="1:CW;2:CCW;3:CCW;4:CW"/);
    assert.match(reverseAsset, /data-props-configuration="out"/);
    assert.match(reverseAsset, /data-motor-rotations="1:CCW;2:CW;3:CW;4:CCW"/);
  }
});

test("an empty live mixer falls back to the selected Quad X preset", () => {
  const presetRules = [
    rule(-1, 1),
    rule(-1, -1),
    rule(1, 1),
    rule(1, -1),
  ];
  assert.deepEqual(resolveMotorNumberPositions("quad_x", [], presetRules), [
    { left: 80, top: 80 },
    { left: 80, top: 20 },
    { left: 20, top: 80 },
    { left: 20, top: 20 },
  ]);
});

test("the fallback renderer makes labels 1-4 visible at percentage positions", () => {
  const labels = Array.from({ length: 4 }, () => ({
    length: 1,
    classes: new Set(["is-hidden"]),
    styles: {},
    value: "",
    attributes: {},
    text(value) {
      this.value = String(value);
      return this;
    },
    css(nameOrValues, value) {
      if (typeof nameOrValues === "string") {
        this.styles[nameOrValues] = value;
      } else {
        Object.assign(this.styles, nameOrValues);
      }
      return this;
    },
    attr(nameOrValues, value) {
      if (typeof nameOrValues === "string") {
        this.attributes[nameOrValues] = value;
      } else {
        Object.assign(this.attributes, nameOrValues);
      }
      return this;
    },
    removeClass(name) {
      this.classes.delete(name);
      return this;
    },
  }));
  const collection = {
    addClass(name) {
      labels.forEach((label) => label.classes.add(name));
      return this;
    },
    css(name, value) {
      labels.forEach((label) => label.css(name, value));
      return this;
    },
    eq(index) {
      return labels[index] ?? { length: 0 };
    },
  };
  const attributes = {};
  const preview = {
    attr(name, value) {
      attributes[name] = value;
      return this;
    },
    find() {
      return collection;
    },
  };
  const presetRules = [
    rule(-1, 1, -1),
    rule(-1, -1, 1),
    rule(1, 1, 1),
    rule(1, -1, -1),
  ];

  renderMotorNumberLabels(preview, "quad_x", [], presetRules);

  assert.equal(attributes["data-motor-number-layout"], "percentage");
  assert.equal(attributes["data-motor-number-fallback"], "selected-preset");
  assert.equal(attributes["data-motor-prop-configuration"], "props-in");
  assert.deepEqual(labels.map((label) => label.value), ["1", "2", "3", "4"]);
  assert.deepEqual(labels.map((label) => label.styles.visibility), [
    "visible",
    "visible",
    "visible",
    "visible",
  ]);
  assert.ok(labels.every((label) => !label.classes.has("is-hidden")));
  assert.deepEqual(labels.map((label) => [label.styles.left, label.styles.top]), [
    ["80%", "80%"],
    ["80%", "20%"],
    ["20%", "80%"],
    ["20%", "20%"],
  ]);
  assert.deepEqual(
    labels.map((label) => label.attributes["data-motor-rotation"]),
    ["CW", "CCW", "CCW", "CW"],
  );
  assert.deepEqual(
    labels.map((label) => label.attributes.title),
    [
      "Motor 1 · CW · Props-in",
      "Motor 2 · CCW · Props-in",
      "Motor 3 · CCW · Props-in",
      "Motor 4 · CW · Props-in",
    ],
  );
});

test("ArduPilot Quad X and Plus use their native motor order in the mirrored previews", () => {
  assert.deepEqual(
    calculateMotorNumberPositions("quad_x", ARDUPILOT_QUAD_MOTOR_RULES.quad_x),
    [
      { left: 80, top: 20 },
      { left: 20, top: 80 },
      { left: 20, top: 20 },
      { left: 80, top: 80 },
    ],
  );
  assert.deepEqual(
    calculateMotorNumberPositions("quad_p", ARDUPILOT_QUAD_MOTOR_RULES.quad_p),
    [
      { left: 80, top: 50 },
      { left: 20, top: 50 },
      { left: 50, top: 20 },
      { left: 50, top: 80 },
    ],
  );
});
