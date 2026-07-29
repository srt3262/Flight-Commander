import { FirmwareCompatibilityError } from "./errors.js";

function isUint32(value, { allowZero = true } = {}) {
  return (
    Number.isInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= 0xffffffff
  );
}

function normalizedCompatibleIds(value, boardId) {
  if (!value) {
    return new Set();
  }
  if (value instanceof Map) {
    const entries = value.get(boardId) ?? [];
    return new Set(entries);
  }
  const entries = value[boardId] ?? [];
  return new Set(entries);
}

export function checkFirmwareCompatibility(boardInfo, firmware, options = {}) {
  const reasons = [];

  if (!boardInfo || !isUint32(boardInfo.boardId, { allowZero: false })) {
    reasons.push("The bootloader did not provide a valid board ID");
  }
  if (!boardInfo || !isUint32(boardInfo.boardRevision)) {
    reasons.push("The bootloader did not provide a valid board revision");
  }
  if (!boardInfo || !isUint32(boardInfo.flashSize, { allowZero: false })) {
    reasons.push("The bootloader did not provide a valid flash size");
  }
  if (!firmware || !isUint32(firmware.boardId, { allowZero: false })) {
    reasons.push("The firmware package does not have a valid board ID");
  }
  if (!firmware || !isUint32(firmware.imageSize, { allowZero: false })) {
    reasons.push("The firmware package does not have a valid image size");
  }
  if (
    !(firmware?.image instanceof Uint8Array) ||
    firmware.image.byteLength !== firmware.imageSize
  ) {
    reasons.push("The parsed firmware image does not match its declared size");
  }

  if (reasons.length === 0) {
    const exactBoard = boardInfo.boardId === firmware.boardId;
    const compatibleIds = normalizedCompatibleIds(
      options.compatibleBoardIds,
      boardInfo.boardId,
    );
    if (!exactBoard && !compatibleIds.has(firmware.boardId)) {
      reasons.push(
        `Firmware board ID ${firmware.boardId} does not match controller board ID ${boardInfo.boardId}`,
      );
    }
    if (
      firmware.boardRevision > 0 &&
      boardInfo.boardRevision !== firmware.boardRevision
    ) {
      reasons.push(
        `Firmware board revision ${firmware.boardRevision} does not match controller revision ${boardInfo.boardRevision}`,
      );
    }
    if (
      firmware.boardRevisionMin !== null &&
      firmware.boardRevisionMin !== undefined &&
      boardInfo.boardRevision < firmware.boardRevisionMin
    ) {
      reasons.push(
        `Controller revision ${boardInfo.boardRevision} is below firmware minimum ${firmware.boardRevisionMin}`,
      );
    }
    if (
      firmware.boardRevisionMax !== null &&
      firmware.boardRevisionMax !== undefined &&
      boardInfo.boardRevision > firmware.boardRevisionMax
    ) {
      reasons.push(
        `Controller revision ${boardInfo.boardRevision} exceeds firmware maximum ${firmware.boardRevisionMax}`,
      );
    }
    if (firmware.imageSize > boardInfo.flashSize) {
      reasons.push(
        `Firmware image (${firmware.imageSize} bytes) exceeds controller flash (${boardInfo.flashSize} bytes)`,
      );
    }
    if (firmware.requiresExternalFlash) {
      reasons.push(
        "This package contains an external-flash image, which this uploader does not program yet",
      );
    }
  }

  return Object.freeze({
    compatible: reasons.length === 0,
    reasons: Object.freeze(reasons),
    boardId: boardInfo?.boardId ?? null,
    firmwareBoardId: firmware?.boardId ?? null,
  });
}

export function assertFirmwareCompatible(boardInfo, firmware, options = {}) {
  const result = checkFirmwareCompatibility(boardInfo, firmware, options);
  if (!result.compatible) {
    throw new FirmwareCompatibilityError(
      `Firmware is not suitable for this controller: ${result.reasons.join("; ")}`,
      { details: result },
    );
  }
  return result;
}
