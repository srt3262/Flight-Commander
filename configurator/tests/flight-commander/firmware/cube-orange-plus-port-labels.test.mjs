import assert from "node:assert/strict";
import test from "node:test";

import {
  targetSerialPortLabel,
} from "../../../js/flightCommander/targetSerialPortLabels.js";

const expectedLabels = Object.freeze({
  1: "TELEM1 (UART2)",
  2: "TELEM2 (UART3)",
  3: "GPS1 (UART4)",
  6: "CONS / ADS-B (UART7)",
  7: "GPS2 (UART8)",
});
test("Cube Orange+ Ports rows lead with physical carrier connector labels", () => {
  for (const [identifier, expected] of Object.entries(expectedLabels)) {
    const result = targetSerialPortLabel({
      identifier: Number(identifier),
      target: "CUBEORANGEPLUS",
      boardIdentifier: "COPL",
      fallback: `UART${Number(identifier) + 1}`,
    });
    assert.equal(result.label, expected);
    assert.match(result.description, /Cube/);
  }
});

test("the COPL board identity enables labels before the target name is available", () => {
  assert.equal(
    targetSerialPortLabel({
      identifier: 1,
      boardIdentifier: "COPL",
      fallback: "UART2",
    }).label,
    "TELEM1 (UART2)",
  );
});

test("other targets keep their normal UART labels", () => {
  assert.deepEqual(
    targetSerialPortLabel({
      identifier: 1,
      target: "MICOAIR743",
      boardIdentifier: "MAH7",
      fallback: "UART2",
    }),
    {
      label: "UART2",
      description: "UART2",
    },
  );
});
