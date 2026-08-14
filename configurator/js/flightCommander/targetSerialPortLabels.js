"use strict";

const CUBE_ORANGE_PLUS_PORTS = Object.freeze({
  1: Object.freeze({
    label: "TELEM1 (UART2)",
    description: "Cube carrier TELEM1 / SERIAL1, STM32 USART2",
  }),
  2: Object.freeze({
    label: "TELEM2 (UART3)",
    description: "Cube carrier TELEM2 / SERIAL2, STM32 USART3",
  }),
  3: Object.freeze({
    label: "GPS1 (UART4)",
    description: "Cube carrier GPS1 / SERIAL3, STM32 UART4",
  }),
  6: Object.freeze({
    label: "CONS / ADS-B (UART7)",
    description: "Cube CONSOLE / SERIAL5, or the built-in ADS-B receiver on an ADS-B carrier, STM32 UART7",
  }),
  7: Object.freeze({
    label: "GPS2 (UART8)",
    description: "Cube carrier GPS2 / SERIAL4, STM32 UART8",
  }),
});

function isCubeOrangePlus(target, boardIdentifier) {
  const targetName = String(target ?? "").trim().toUpperCase();
  const boardName = String(boardIdentifier ?? "").trim().toUpperCase();
  return targetName === "CUBEORANGEPLUS" || boardName === "COPL";
}
export function targetSerialPortLabel({
  identifier,
  target,
  boardIdentifier,
  fallback,
} = {}) {
  const fallbackLabel = String(fallback ?? `UART${Number(identifier) + 1}`);
  if (!isCubeOrangePlus(target, boardIdentifier)) {
    return Object.freeze({
      label: fallbackLabel,
      description: fallbackLabel,
    });
  }

  return CUBE_ORANGE_PLUS_PORTS[Number(identifier)] ?? Object.freeze({
    label: fallbackLabel,
    description: fallbackLabel,
  });
}
