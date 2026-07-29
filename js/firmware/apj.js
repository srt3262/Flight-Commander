import { unzlibSync } from "fflate";

import { FirmwarePackageError } from "./errors.js";

const MAX_UINT32 = 0xffffffff;
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const APJ_MAGIC = "APJFWv1";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireUint32(value, field, { allowZero = true } = {}) {
  if (
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_UINT32
  ) {
    throw new FirmwarePackageError(
      `${field} must be ${allowZero ? "a" : "a non-zero"} 32-bit unsigned integer`,
      { details: { field, value } },
    );
  }

  return value;
}

function optionalUint32(value, field) {
  return value === undefined ? null : requireUint32(value, field);
}

function decodeJsonInput(input) {
  if (isPlainObject(input)) {
    return { ...input };
  }

  let text;
  try {
    if (typeof input === "string") {
      text = input;
    } else if (input instanceof ArrayBuffer) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(input),
      );
    } else if (ArrayBuffer.isView(input)) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
      );
    } else {
      throw new FirmwarePackageError(
        "APJ input must be JSON text, bytes, or an object",
      );
    }
  } catch (error) {
    throw error instanceof FirmwarePackageError
      ? error
      : new FirmwarePackageError(
          `APJ input is not valid UTF-8: ${error.message}`,
          { cause: error },
        );
  }

  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      throw new Error("root value is not an object");
    }
    return parsed;
  } catch (error) {
    throw new FirmwarePackageError(`APJ JSON is malformed: ${error.message}`, {
      cause: error,
    });
  }
}

function decodeBase64(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new FirmwarePackageError(
      `${field} must be a non-empty base64 string`,
    );
  }

  const compact = value.replace(/\s+/g, "");
  if (
    compact.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      compact,
    )
  ) {
    throw new FirmwarePackageError(`${field} contains invalid base64 data`);
  }

  try {
    if (typeof atob === "function") {
      const decoded = atob(compact);
      const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
      }
      return bytes;
    }

    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(compact, "base64"));
    }
  } catch (error) {
    throw new FirmwarePackageError(`${field} could not be decoded`, {
      cause: error,
    });
  }

  throw new FirmwarePackageError(
    "No base64 decoder is available in this runtime",
  );
}

function decompressImage(value, field, maximumBytes) {
  const compressed = decodeBase64(value, field);
  try {
    const image = unzlibSync(compressed);
    if (image.byteLength > maximumBytes) {
      throw new FirmwarePackageError(
        `${field} expands beyond the ${maximumBytes}-byte safety limit`,
      );
    }
    return image;
  } catch (error) {
    throw error instanceof FirmwarePackageError
      ? error
      : new FirmwarePackageError(
          `${field} is not a valid zlib-compressed image`,
          { cause: error },
        );
  }
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(input) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLength = source.length * 8;
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const constants = new Uint32Array([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993,
    2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987,
    1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774,
    264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711,
    113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291,
    1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411,
    3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218,
    1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424,
    2428436474, 2756734187, 3204031479, 3329325298,
  ]);
  const hash = new Uint32Array([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924,
    528734635, 1541459225,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const first =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const second =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] =
        (words[index - 16] + first + words[index - 7] + second) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
      const sigma0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return Array.from(hash, (value) => value.toString(16).padStart(8, "0")).join(
    "",
  );
}

export function ardupilotCrc32(input, seed = 0) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  let crc = seed >>> 0;
  for (const byte of source) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return crc >>> 0;
}

export function padFirmwareImage(input) {
  const image = input instanceof Uint8Array ? input : new Uint8Array(input);
  const paddedLength = Math.ceil(image.length / 4) * 4;
  if (paddedLength === image.length) {
    return image.slice();
  }

  const padded = new Uint8Array(paddedLength);
  padded.fill(0xff);
  padded.set(image);
  return padded;
}

export function calculateFirmwareCrc(input, flashSize) {
  const image = padFirmwareImage(input);
  requireUint32(flashSize, "flashSize", { allowZero: false });
  if (flashSize % 4 !== 0) {
    throw new FirmwarePackageError(
      "flashSize must be aligned to four bytes for CRC verification",
    );
  }
  if (image.length > flashSize) {
    throw new FirmwarePackageError(
      "Firmware image is larger than the target flash size",
    );
  }

  let crc = ardupilotCrc32(image);
  const erased = new Uint8Array(4096);
  erased.fill(0xff);
  let remaining = flashSize - image.length;
  while (remaining > 0) {
    const size = Math.min(remaining, erased.length);
    crc = ardupilotCrc32(erased.subarray(0, size), crc);
    remaining -= size;
  }
  return crc >>> 0;
}

function parseExpectedChecksum(value, field) {
  if (Number.isInteger(value) && value >= 0 && value <= MAX_UINT32) {
    return value >>> 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/^0x/, "");
    if (/^[0-9a-f]{1,8}$/.test(normalized)) {
      return Number.parseInt(normalized, 16) >>> 0;
    }
  }
  throw new FirmwarePackageError(
    `${field} must be a 32-bit integer or hexadecimal string`,
  );
}

function validateChecksums(descriptor, image) {
  const verified = [];
  const crcFields = ["image_crc32", "image_crc", "crc32"].filter(
    (field) => descriptor[field] !== undefined,
  );
  for (const field of crcFields) {
    const expected = parseExpectedChecksum(descriptor[field], field);
    const actual = ardupilotCrc32(image);
    if (expected !== actual) {
      throw new FirmwarePackageError(
        `${field} does not match the decompressed image`,
        {
          details: { field, expected, actual },
        },
      );
    }
    verified.push(field);
  }

  const shaFields = ["image_sha256", "sha256"].filter(
    (field) => descriptor[field] !== undefined,
  );
  for (const field of shaFields) {
    const expected = String(descriptor[field]).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw new FirmwarePackageError(
        `${field} must be a 64-character SHA-256 digest`,
      );
    }
    const actual = sha256Hex(image);
    if (expected !== actual) {
      throw new FirmwarePackageError(
        `${field} does not match the decompressed image`,
        {
          details: { field, expected, actual },
        },
      );
    }
    verified.push(field);
  }

  if (descriptor.checksum !== undefined) {
    const match = /^sha256:([0-9a-f]{64})$/i.exec(
      String(descriptor.checksum).trim(),
    );
    if (!match) {
      throw new FirmwarePackageError(
        "checksum is present but does not use the supported sha256:<digest> form",
      );
    }
    if (match[1].toLowerCase() !== sha256Hex(image)) {
      throw new FirmwarePackageError(
        "checksum does not match the decompressed image",
      );
    }
    verified.push("checksum");
  }

  for (const field of ["image_md5", "md5"]) {
    if (descriptor[field] !== undefined) {
      throw new FirmwarePackageError(
        `${field} is present but this checksum algorithm is not supported`,
      );
    }
  }

  return verified;
}

export function parseApjPackage(input, options = {}) {
  const descriptor = decodeJsonInput(input);
  const maximumBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const format = String(options.sourceFormat ?? "apj").toLowerCase();

  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    throw new FirmwarePackageError("maxImageBytes must be a positive integer");
  }
  if (!["apj", "px4"].includes(format)) {
    throw new FirmwarePackageError(
      `Unsupported ArduPilot package format: ${format}`,
    );
  }
  if (descriptor.magic !== APJ_MAGIC) {
    throw new FirmwarePackageError(
      `Unsupported APJ magic: ${String(descriptor.magic)}`,
    );
  }

  const boardId = requireUint32(descriptor.board_id, "board_id", {
    allowZero: false,
  });
  const boardRevision = requireUint32(
    descriptor.board_revision,
    "board_revision",
  );
  const boardRevisionMin = optionalUint32(
    descriptor.board_revision_min,
    "board_revision_min",
  );
  const boardRevisionMax = optionalUint32(
    descriptor.board_revision_max,
    "board_revision_max",
  );
  if (
    boardRevisionMin !== null &&
    boardRevisionMax !== null &&
    boardRevisionMin > boardRevisionMax
  ) {
    throw new FirmwarePackageError(
      "board_revision_min cannot exceed board_revision_max",
    );
  }
  if (
    boardRevision > 0 &&
    ((boardRevisionMin !== null && boardRevision < boardRevisionMin) ||
      (boardRevisionMax !== null && boardRevision > boardRevisionMax))
  ) {
    throw new FirmwarePackageError(
      "board_revision conflicts with its declared revision range",
    );
  }

  const declaredImageSize = requireUint32(descriptor.image_size, "image_size");
  if (declaredImageSize > maximumBytes) {
    throw new FirmwarePackageError(
      `image_size exceeds the ${maximumBytes}-byte safety limit`,
    );
  }
  const image = decompressImage(descriptor.image, "image", maximumBytes);
  if (image.byteLength !== declaredImageSize) {
    throw new FirmwarePackageError(
      `image_size is ${declaredImageSize}, but the image expands to ${image.byteLength} bytes`,
    );
  }

  const imageMaxSize = optionalUint32(
    descriptor.image_maxsize,
    "image_maxsize",
  );
  const flashTotal = optionalUint32(descriptor.flash_total, "flash_total");
  if (imageMaxSize !== null && declaredImageSize > imageMaxSize) {
    throw new FirmwarePackageError("image_size exceeds image_maxsize");
  }
  if (flashTotal !== null && declaredImageSize > flashTotal) {
    throw new FirmwarePackageError("image_size exceeds flash_total");
  }

  const externalImageSize =
    optionalUint32(descriptor.extf_image_size, "extf_image_size") ?? 0;
  let externalImage = null;
  if (descriptor.extf_image !== undefined) {
    externalImage = decompressImage(
      descriptor.extf_image,
      "extf_image",
      maximumBytes,
    );
    if (externalImage.byteLength !== externalImageSize) {
      throw new FirmwarePackageError(
        `extf_image_size is ${externalImageSize}, but extf_image expands to ${externalImage.byteLength} bytes`,
      );
    }
  } else if (externalImageSize !== 0) {
    throw new FirmwarePackageError(
      "extf_image_size is non-zero but extf_image is missing",
    );
  }

  if (declaredImageSize === 0 && externalImageSize === 0) {
    throw new FirmwarePackageError(
      "APJ package contains no internal or external firmware image",
    );
  }

  const verifiedChecksums = validateChecksums(descriptor, image);
  return Object.freeze({
    format,
    magic: APJ_MAGIC,
    boardId,
    boardRevision,
    boardRevisionMin,
    boardRevisionMax,
    image,
    paddedImage: padFirmwareImage(image),
    imageSize: image.byteLength,
    imageMaxSize,
    flashTotal,
    extfImage: externalImage,
    extfImageSize: externalImageSize,
    requiresExternalFlash: externalImageSize > 0,
    summary: typeof descriptor.summary === "string" ? descriptor.summary : null,
    description:
      typeof descriptor.description === "string"
        ? descriptor.description
        : null,
    version: typeof descriptor.version === "string" ? descriptor.version : null,
    gitIdentity:
      typeof descriptor.git_identity === "string"
        ? descriptor.git_identity
        : null,
    signedFirmware: descriptor.signed_firmware === true,
    verifiedChecksums: Object.freeze(verifiedChecksums),
    descriptor: Object.freeze({ ...descriptor }),
  });
}

export { APJ_MAGIC, DEFAULT_MAX_IMAGE_BYTES };
