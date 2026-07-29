const MAV_AUTOPILOT_INVALID = 8;
const MAV_TYPE_GCS = 6;
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246;
const REBOOT_TO_BOOTLOADER = 3;

function waitForHeartbeat(api, timeoutMs, signal = null) {
  return new Promise((resolve, reject) => {
    let messageHandler;
    const cleanup = () => {
      clearTimeout(timeout);
      if (messageHandler) {
        api.offMavlinkMessage(messageHandler);
      }
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("MAVLink heartbeat wait cancelled."),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("No MAVLink autopilot heartbeat was received."));
    }, timeoutMs);

    messageHandler = api.onMavlinkMessage((event) => {
      const data = event?.data;
      if (!["HEARTBEAT", "Heartbeat"].includes(event?.messageName)) {
        return;
      }
      if (
        data?.type === MAV_TYPE_GCS ||
        data?.autopilot === MAV_AUTOPILOT_INVALID
      ) {
        return;
      }
      cleanup();
      resolve({
        systemId: event.header?.sysid,
        componentId: event.header?.compid ?? 1,
        protocolVersion: ["MAV_V1", "MAVLinkV1"].includes(event.protocol)
          ? 1
          : 2,
      });
    });

    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}

export async function rebootArduPilotToBootloader(path, options = {}) {
  const {
    api = globalThis.window?.electronAPI,
    baudRate = 115200,
    heartbeatTimeoutMs = 4000,
    signal = null,
  } = options;
  if (!api) {
    throw new TypeError(
      "ArduPilot bootloader entry requires an Electron API bridge.",
    );
  }

  let serialDataHandler = null;
  let serialConnectionId = null;
  const pendingSerialData = [];
  let opened = false;
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(
      signal?.reason instanceof Error
        ? signal.reason
        : new Error("ArduPilot bootloader entry cancelled."),
    );
  };

  try {
    if (signal?.aborted) {
      abortFromCaller();
    } else {
      signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    api.mavlinkReset();
    serialDataHandler = api.onSerialData((envelope) => {
      if (serialConnectionId == null) {
        if (pendingSerialData.length >= 256) pendingSerialData.shift();
        pendingSerialData.push(envelope);
        return;
      }
      if (envelope?.connectionId === serialConnectionId) {
        api.mavlinkFeed(envelope.data);
      }
    });
    const heartbeatPromise = waitForHeartbeat(
      api,
      heartbeatTimeoutMs,
      controller.signal,
    );
    // Serial connection can reject before this promise is awaited. Attach a
    // rejection observer immediately so cleanup cancellation is never unhandled.
    heartbeatPromise.catch(() => {});
    const connection = await api.serialConnect(path, { bitrate: baudRate });
    if (connection?.error) {
      const error = new Error(connection.msg || `Unable to open ${path}.`);
      controller.abort(error);
      await heartbeatPromise.catch(() => {});
      throw error;
    }
    serialConnectionId = connection.id;
    for (const envelope of pendingSerialData.splice(0)) {
      if (envelope?.connectionId === serialConnectionId) {
        api.mavlinkFeed(envelope.data);
      }
    }
    opened = true;

    const heartbeat = await heartbeatPromise;
    const encoded = await api.mavlinkEncode(
      "CommandLong",
      {
        targetSystem: heartbeat.systemId,
        targetComponent: heartbeat.componentId,
        command: MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
        confirmation: 0,
        param1: REBOOT_TO_BOOTLOADER,
        param2: 0,
        param3: 0,
        param4: 0,
        param5: 0,
        param6: 0,
        param7: 0,
      },
      {
        version: heartbeat.protocolVersion,
        systemId: 255,
        componentId: 190,
      },
    );
    const payload =
      encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    if (payload.byteLength === 0) {
      throw new Error(
        "MAVLink encoder returned an empty bootloader reboot command.",
      );
    }
    const sendResult = await api.serialSend(payload, serialConnectionId);
    if (sendResult?.error) {
      throw new Error(
        sendResult.msg || "Unable to send the bootloader reboot command.",
      );
    }
    if (
      typeof sendResult?.bytesWritten === "number" &&
      sendResult.bytesWritten !== payload.byteLength
    ) {
      throw new Error(
        `Bootloader reboot command write was incomplete (${sendResult.bytesWritten} ` +
          `of ${payload.byteLength} bytes).`,
      );
    }
    return heartbeat;
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", abortFromCaller);
    if (serialDataHandler) {
      api.offSerialData(serialDataHandler);
    }
    if (opened) {
      try {
        await api.serialClose(serialConnectionId);
      } catch {
        // Closing a port which has rebooted and disappeared is best effort.
      }
    }
  }
}

export default rebootArduPilotToBootloader;
