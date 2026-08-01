import { FirmwarePackageError } from "./errors.js";

export const DEFAULT_MAX_INTEL_HEX_SOURCE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_INTEL_HEX_IMAGE_BYTES = 16 * 1024 * 1024;

function packageError(message, details = null) {
  return new FirmwarePackageError(message, {
    code: "INTEL_HEX_INVALID",
    details,
  });
}

function sourceText(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(input),
    );
  }
  if (ArrayBuffer.isView(input)) {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    );
  }
  throw packageError("Intel HEX input must be text or bytes");
}

function uint16BigEndian(bytes, offset = 0) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32BigEndian(bytes, offset = 0) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function parseRecord(line, lineNumber) {
  if (!line.startsWith(":")) {
    throw packageError(`Intel HEX line ${lineNumber} does not start with ':'`);
  }
  const payload = line.slice(1);
  if (payload.length < 10 || payload.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(payload)) {
    throw packageError(`Intel HEX line ${lineNumber} is malformed`);
  }
  const bytes = Uint8Array.from(
    payload.match(/.{2}/g).map((value) => Number.parseInt(value, 16)),
  );
  const byteCount = bytes[0];
  if (bytes.length !== byteCount + 5) {
    throw packageError(
      `Intel HEX line ${lineNumber} declares ${byteCount} data bytes but contains ${bytes.length - 5}`,
    );
  }
  const checksum = bytes.reduce((sum, value) => (sum + value) & 0xff, 0);
  if (checksum !== 0) {
    throw packageError(`Intel HEX checksum failed on line ${lineNumber}`);
  }
  return {
    address: uint16BigEndian(bytes, 1),
    type: bytes[3],
    data: bytes.slice(4, 4 + byteCount),
  };
}

export function parseIntelHex(input, options = {}) {
  let text;
  try {
    text = sourceText(input);
  } catch (error) {
    if (error instanceof FirmwarePackageError) throw error;
    throw packageError(`Intel HEX text decoding failed: ${error.message}`);
  }

  const maxSourceBytes =
    options.maxSourceBytes ?? DEFAULT_MAX_INTEL_HEX_SOURCE_BYTES;
  const maxImageBytes =
    options.maxImageBytes ?? DEFAULT_MAX_INTEL_HEX_IMAGE_BYTES;
  if (new TextEncoder().encode(text).byteLength > maxSourceBytes) {
    throw packageError(
      `Intel HEX source exceeds the ${maxSourceBytes}-byte safety limit`,
    );
  }

  const records = [];
  let baseAddress = 0;
  let startLinearAddress = null;
  let endOfFile = false;
  let bytesTotal = 0;
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const lineNumber = index + 1;
    if (endOfFile) {
      throw packageError(`Intel HEX contains data after EOF on line ${lineNumber}`);
    }
    const record = parseRecord(line, lineNumber);

    switch (record.type) {
      case 0x00: {
        const absoluteAddress = baseAddress + record.address;
        const endAddress = absoluteAddress + record.data.byteLength;
        if (
          !Number.isSafeInteger(absoluteAddress) ||
          absoluteAddress < 0 ||
          endAddress > 0x100000000
        ) {
          throw packageError(`Intel HEX line ${lineNumber} has an invalid address`);
        }
        bytesTotal += record.data.byteLength;
        if (bytesTotal > maxImageBytes) {
          throw packageError(
            `Intel HEX image exceeds the ${maxImageBytes}-byte safety limit`,
          );
        }
        if (record.data.byteLength) {
          records.push({
            address: absoluteAddress,
            data: Array.from(record.data),
          });
        }
        break;
      }
      case 0x01:
        if (record.address !== 0 || record.data.byteLength !== 0) {
          throw packageError(`Intel HEX EOF record on line ${lineNumber} is invalid`);
        }
        endOfFile = true;
        break;
      case 0x02:
        if (record.address !== 0 || record.data.byteLength !== 2) {
          throw packageError(
            `Intel HEX segment-address record on line ${lineNumber} is invalid`,
          );
        }
        baseAddress = uint16BigEndian(record.data) << 4;
        break;
      case 0x03:
        if (record.address !== 0 || record.data.byteLength !== 4) {
          throw packageError(
            `Intel HEX start-segment record on line ${lineNumber} is invalid`,
          );
        }
        break;
      case 0x04:
        if (record.address !== 0 || record.data.byteLength !== 2) {
          throw packageError(
            `Intel HEX linear-address record on line ${lineNumber} is invalid`,
          );
        }
        baseAddress = uint16BigEndian(record.data) * 0x10000;
        break;
      case 0x05:
        if (record.address !== 0 || record.data.byteLength !== 4) {
          throw packageError(
            `Intel HEX start-address record on line ${lineNumber} is invalid`,
          );
        }
        startLinearAddress = uint32BigEndian(record.data);
        break;
      default:
        throw packageError(
          `Intel HEX line ${lineNumber} uses unsupported record type 0x${record.type.toString(16).padStart(2, "0")}`,
        );
    }
  }

  if (!endOfFile) {
    throw packageError("Intel HEX is missing its EOF record");
  }
  if (!records.length || bytesTotal === 0) {
    throw packageError("Intel HEX contains no firmware data");
  }

  records.sort((left, right) => left.address - right.address);
  const blocks = [];
  for (const record of records) {
    const previous = blocks.at(-1);
    const previousEnd = previous ? previous.address + previous.bytes : null;
    if (previousEnd != null && record.address < previousEnd) {
      throw packageError(
        `Intel HEX contains overlapping data at 0x${record.address.toString(16)}`,
      );
    }
    if (previous && record.address === previousEnd) {
      previous.data.push(...record.data);
      previous.bytes += record.data.length;
    } else {
      blocks.push({
        address: record.address,
        bytes: record.data.length,
        data: [...record.data],
      });
    }
  }

  return {
    data: blocks,
    end_of_file: true,
    bytes_total: bytesTotal,
    start_linear_address: startLinearAddress ?? blocks[0].address,
  };
}

export function assertArduPilotWithBootloaderHex(hex) {
  if (!hex || !Array.isArray(hex.data) || !hex.data.length) {
    throw packageError("ArduPilot with-bootloader HEX did not parse into flash blocks");
  }
  const flashStart = 0x08000000;
  const flashLimit = 0x09000000;
  if (hex.data[0].address !== flashStart) {
    throw packageError(
      `ArduPilot with-bootloader HEX starts at 0x${hex.data[0].address.toString(16)}, not STM32 flash base 0x08000000`,
    );
  }
  if (!Number.isInteger(hex.bytes_total) || hex.bytes_total < 4096) {
    throw packageError("ArduPilot with-bootloader HEX is unexpectedly small");
  }
  for (const block of hex.data) {
    const end = block.address + block.bytes;
    if (block.address < flashStart || end > flashLimit) {
      throw packageError(
        `ArduPilot with-bootloader HEX contains data outside STM32 internal flash at 0x${block.address.toString(16)}`,
      );
    }
  }
  if (
    hex.start_linear_address < flashStart ||
    hex.start_linear_address >= flashLimit
  ) {
    throw packageError(
      `ArduPilot with-bootloader HEX has invalid entry address 0x${hex.start_linear_address.toString(16)}`,
    );
  }
  return hex;
}
