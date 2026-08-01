const MSP_V1 = Object.freeze({
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  BEGIN: 0x24,
  PROTOCOL: 0x4d,
  REQUEST: 0x3c,
  RESPONSE: 0x3e,
  UNSUPPORTED: 0x21,
});

function ascii(bytes) {
  return String.fromCharCode(...bytes).replace(/\0+$/g, "").trim();
}

export function encodeMspV1Request(command, payload = new Uint8Array(0)) {
  if (!Number.isInteger(command) || command < 0 || command > 0xfe) {
    throw new RangeError("MSPv1 command must fit in one byte");
  }
  const data = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (data.byteLength > 0xfe) {
    throw new RangeError("MSPv1 payload is too large");
  }
  const frame = new Uint8Array(data.byteLength + 6);
  frame.set([MSP_V1.BEGIN, MSP_V1.PROTOCOL, MSP_V1.REQUEST, data.byteLength, command]);
  frame.set(data, 5);
  let checksum = data.byteLength ^ command;
  for (const value of data) checksum ^= value;
  frame[frame.length - 1] = checksum;
  return frame;
}

async function readByte(transport, deadline, signal) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Timed out waiting for an INAV MSP response.");
  }
  return (
    await transport.readExactly(1, {
      timeoutMs: remaining,
      signal,
    })
  )[0];
}

export async function readMspV1Response(
  transport,
  expectedCommand,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 1200;
  const signal = options.signal ?? null;
  const deadline = Date.now() + timeoutMs;
  let headerState = 0;

  while (Date.now() < deadline) {
    const value = await readByte(transport, deadline, signal);
    if (headerState === 0) {
      headerState = value === MSP_V1.BEGIN ? 1 : 0;
      continue;
    }
    if (headerState === 1) {
      headerState = value === MSP_V1.PROTOCOL ? 2 : value === MSP_V1.BEGIN ? 1 : 0;
      continue;
    }
    if (value !== MSP_V1.RESPONSE && value !== MSP_V1.UNSUPPORTED) {
      headerState = value === MSP_V1.BEGIN ? 1 : 0;
      continue;
    }

    const direction = value;
    const length = await readByte(transport, deadline, signal);
    const command = await readByte(transport, deadline, signal);
    const payload = await transport.readExactly(length, {
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal,
    });
    const receivedChecksum = await readByte(transport, deadline, signal);
    let checksum = length ^ command;
    for (const byte of payload) checksum ^= byte;
    headerState = 0;
    if (checksum !== receivedChecksum) {
      if (command === expectedCommand) {
        throw new Error(`INAV MSP command ${command} returned a bad checksum.`);
      }
      continue;
    }
    if (command !== expectedCommand) continue;
    if (direction === MSP_V1.UNSUPPORTED) {
      throw new Error(`INAV does not support MSP command ${command}.`);
    }
    return payload;
  }
  throw new Error("Timed out waiting for an INAV MSP response.");
}

export async function requestMspV1(
  transport,
  command,
  options = {},
) {
  transport.flushInput?.();
  await transport.write(encodeMspV1Request(command));
  return readMspV1Response(transport, command, options);
}

function parseVersion(payload, label) {
  if (payload.byteLength < 3) {
    throw new Error(`INAV ${label} response is too short.`);
  }
  return `${payload[0]}.${payload[1]}.${payload[2]}`;
}

export function parseInavBoardInfo(payload) {
  if (!(payload instanceof Uint8Array) || payload.byteLength < 9) {
    throw new Error("INAV board-info response is too short.");
  }
  const targetLength = payload[8];
  if (!targetLength || 9 + targetLength > payload.byteLength) {
    throw new Error("INAV board-info response has an invalid target name.");
  }
  const target = ascii(payload.slice(9, 9 + targetLength));
  if (!target || !/^[A-Za-z0-9_-]+$/.test(target)) {
    throw new Error("INAV reported an invalid firmware target name.");
  }
  return Object.freeze({
    boardIdentifier: ascii(payload.slice(0, 4)),
    boardVersion: payload[4] | (payload[5] << 8),
    target,
  });
}

export async function identifyInavRuntime(transport, options = {}) {
  if (
    !transport ||
    typeof transport.write !== "function" ||
    typeof transport.readExactly !== "function"
  ) {
    throw new TypeError("INAV identity probe requires a byte transport.");
  }
  const requestOptions = {
    timeoutMs: options.timeoutMs ?? 1200,
    signal: options.signal ?? null,
  };
  const apiPayload = await requestMspV1(
    transport,
    MSP_V1.API_VERSION,
    requestOptions,
  );
  const variantPayload = await requestMspV1(
    transport,
    MSP_V1.FC_VARIANT,
    requestOptions,
  );
  const variant = ascii(variantPayload);
  if (variant !== "INAV") {
    throw new Error(`Selected controller reports ${variant || "an unknown firmware"}, not INAV.`);
  }
  const versionPayload = await requestMspV1(
    transport,
    MSP_V1.FC_VERSION,
    requestOptions,
  );
  const boardPayload = await requestMspV1(
    transport,
    MSP_V1.BOARD_INFO,
    requestOptions,
  );
  const board = parseInavBoardInfo(boardPayload);
  return Object.freeze({
    firmwareFamily: "inav",
    apiVersion: parseVersion(apiPayload, "API-version"),
    firmwareVersion: parseVersion(versionPayload, "firmware-version"),
    ...board,
  });
}

export { MSP_V1 };
