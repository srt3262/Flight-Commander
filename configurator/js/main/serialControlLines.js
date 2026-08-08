const CONTROL_LINE_TIMEOUT_MS = 2000;

/**
 * @serialport/bindings-cpp maps `hupcl: true` to DTR enabled while opening a
 * Windows COM port.  Lowering DTR from the later `open` event is too late for
 * ESP32-based ExpressLRS transmitters because the initial high pulse can reboot
 * or lock the module.  These options make the native open itself start with
 * DTR low; disabling RTS/CTS also keeps RTS low during that same transition.
 */
export function serialOpenControlLineOptions(
  options = {},
  platform = process.platform,
) {
  if (platform !== "win32" || options.forceDtrLow !== true) {
    return {};
  }
  return {
    hupcl: false,
    rtscts: false,
  };
}

function setControlLines(
  port,
  signals,
  timeoutMs = CONTROL_LINE_TIMEOUT_MS,
) {
  if (!port || typeof port.set !== "function") {
    return Promise.reject(
      new TypeError("The serial port does not support control-line changes."),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Serial control-line setup timed out after ${timeoutMs} ms.`,
        ),
      );
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    try {
      const result = port.set(signals, finish);
      if (result?.then) {
        result.then(() => finish(), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

export async function configureSerialControlLines(
  port,
  options = {},
  platform = process.platform,
) {
  if (platform !== "win32" || options.forceDtrLow !== true) {
    return false;
  }

  await setControlLines(
    port,
    { dtr: false, rts: false },
    options.controlLineTimeoutMs ?? CONTROL_LINE_TIMEOUT_MS,
  );
  return true;
}

export async function disposeSerialPort(
  port,
  closeTimeoutMs = CONTROL_LINE_TIMEOUT_MS,
) {
  if (!port) return;

  try {
    port.removeAllListeners?.();
  } catch {
    // Best-effort cleanup must preserve the original connection error.
  }

  if (port.isOpen && typeof port.close === "function") {
    await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(resolveOnce, closeTimeoutMs);
      const finish = () => {
        resolveOnce();
      };
      function resolveOnce() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      }

      try {
        const result = port.close(finish);
        if (result?.then) {
          result.then(finish, finish);
        }
      } catch {
        finish();
      }
    });
  }

  try {
    port.destroy?.();
  } catch {
    // Best-effort cleanup must preserve the original connection error.
  }
}

/**
 * A native serial open cannot be cancelled through SerialPortStream. If the
 * application-level open deadline expires while the binding is still opening,
 * keep one guarded listener so a late native success is closed immediately
 * instead of leaving an unreachable Windows COM handle locked.
 */
export function quarantineOpeningSerialPort(port) {
  if (!port || typeof port.once !== "function") {
    return false;
  }

  try {
    port.removeAllListeners?.();
  } catch {
    // Continue with the best available late-open guard.
  }

  let settled = false;
  const cleanupFailure = () => {
    if (settled) return;
    settled = true;
    try {
      port.removeAllListeners?.();
      port.destroy?.();
    } catch {
      // The user-visible timeout has already been reported.
    }
  };
  const cleanupOpen = () => {
    if (settled) return;
    settled = true;
    disposeSerialPort(port).catch(() => {});
  };

  port.once("open", cleanupOpen);
  port.once("error", cleanupFailure);
  if (port.isOpen) cleanupOpen();
  return true;
}

export async function prepareSerialPort(
  port,
  options = {},
  platform = process.platform,
) {
  try {
    return await configureSerialControlLines(port, options, platform);
  } catch (error) {
    await disposeSerialPort(
      port,
      options.closeTimeoutMs ?? CONTROL_LINE_TIMEOUT_MS,
    );
    throw error;
  }
}
