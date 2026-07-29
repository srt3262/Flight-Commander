export class FirmwareError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = new.target.name;
    this.code = options.code ?? "FIRMWARE_ERROR";
    this.details = options.details ?? null;
  }
}

export class FirmwareManifestError extends FirmwareError {
  constructor(message, options = {}) {
    super(message, { code: "FIRMWARE_MANIFEST_INVALID", ...options });
  }
}

export class FirmwarePackageError extends FirmwareError {
  constructor(message, options = {}) {
    super(message, { code: "FIRMWARE_PACKAGE_INVALID", ...options });
  }
}

export class FirmwareCompatibilityError extends FirmwareError {
  constructor(message, options = {}) {
    super(message, { code: "FIRMWARE_INCOMPATIBLE", ...options });
  }
}

export class BootloaderProtocolError extends FirmwareError {
  constructor(message, options = {}) {
    super(message, { code: "BOOTLOADER_PROTOCOL_ERROR", ...options });
  }
}

export class BootloaderTimeoutError extends BootloaderProtocolError {
  constructor(message, options = {}) {
    super(message, { code: "BOOTLOADER_TIMEOUT", ...options });
  }
}

export class FirmwareUploadCancelledError extends FirmwareError {
  constructor(message = "Firmware operation cancelled", options = {}) {
    super(message, { code: "FIRMWARE_UPLOAD_CANCELLED", ...options });
  }
}
