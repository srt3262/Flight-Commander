import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { calculateMotorNumberPositions } from "../../../js/motorPreview.js";
import { ARDUPILOT_QUAD_MOTOR_RULES } from "../../../js/ardupilot/motorLayout.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

const rule = (roll, pitch) => ({
  getRoll: () => roll,
  getPitch: () => pitch,
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
  }
  assert.match(source("js/motorPreview.js"), /data-motor-number-layout/);

  const theme = source("src/css/theme.css");
  assert.match(theme, /\.mixer-preview-image-numbers \.motorNumber\s*\{[^}]*z-index:\s*3;[^}]*color:\s*#ffffff\s*!important;/s);
  assert.match(theme, /transform:\s*translate\(-50%,\s*-50%\)/);
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
