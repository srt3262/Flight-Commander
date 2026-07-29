import { Buffer } from "node:buffer";

import {
  MavLinkPacketParser,
  MavLinkPacketSplitter,
  MavLinkProtocolV1,
  MavLinkProtocolV2,
  ardupilotmega,
  common,
  minimal,
  standard,
} from "node-mavlink";

const DIALECTS = [minimal, common, standard, ardupilotmega];
const MAX_FEED_BYTES = 1024 * 1024;

function buildMessageRegistry() {
  const byId = {};
  const byName = new Map();

  for (const dialect of DIALECTS) {
    Object.assign(byId, dialect.REGISTRY ?? {});
    for (const [exportName, constructor] of Object.entries(dialect)) {
      if (
        typeof constructor !== "function" ||
        !Number.isInteger(constructor.MSG_ID)
      ) {
        continue;
      }
      byName.set(exportName, constructor);
      if (constructor.MSG_NAME) {
        byName.set(constructor.MSG_NAME, constructor);
      }
      byName.set(constructor.name, constructor);
    }
  }

  return { byId, byName };
}

const MESSAGE_REGISTRY = buildMessageRegistry();

function serializableValue(value) {
  if (typeof value === "bigint") {
    return value <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(serializableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializableValue(entry),
      ]),
    );
  }
  return value;
}

function assignMessageFields(message, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("MAVLink message payload must be an object.");
  }

  for (const [field, value] of Object.entries(payload)) {
    if (field in message) {
      message[field] = value;
      continue;
    }

    const privateParam = /^param[1-7]$/.test(field) ? `_${field}` : null;
    if (privateParam && privateParam in message) {
      message[privateParam] = value;
      continue;
    }

    throw new TypeError(
      `${message.constructor.MSG_NAME || message.constructor.name} does not define field ${field}.`,
    );
  }
}

function byteBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  throw new TypeError(
    "MAVLink feed data must be an ArrayBuffer, typed array, Buffer, or byte array.",
  );
}

function systemIdentifier(value, label, fallback, { allowZero = false } = {}) {
  const identifier = value ?? fallback;
  const minimum = allowZero ? 0 : 1;
  if (
    !Number.isInteger(identifier) ||
    identifier < minimum ||
    identifier > 255
  ) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} through 255.`,
    );
  }
  return identifier;
}

export class MavlinkIpcCodec {
  constructor(options = {}) {
    this.onMessage = options.onMessage ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.sequence = 0;
    this.generation = 0;
    this.splitter = null;
    this.parser = null;
    this.reset(options.generation ?? 0);
  }

  reset(generation = this.generation) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new RangeError(
        "MAVLink transport generation must be a non-negative safe integer.",
      );
    }
    this.generation = generation;

    if (this.splitter) {
      this.splitter.unpipe();
      this.splitter.destroy();
    }
    if (this.parser) {
      this.parser.destroy();
    }

    this.splitter = new MavLinkPacketSplitter();
    this.parser = new MavLinkPacketParser();
    const parserGeneration = generation;
    this.splitter.pipe(this.parser);
    this.parser.on("data", (packet) =>
      this.handlePacket(packet, parserGeneration),
    );
    this.parser.on("error", (error) => this.onError(error));
    this.splitter.on("error", (error) => this.onError(error));
    return true;
  }

  destroy() {
    if (this.splitter) {
      this.splitter.unpipe();
      this.splitter.destroy();
      this.splitter = null;
    }
    if (this.parser) {
      this.parser.destroy();
      this.parser = null;
    }
  }

  feed(value, generation = this.generation) {
    if (generation !== this.generation) {
      return false;
    }
    if (value == null) {
      return true;
    }
    const data = byteBuffer(value);
    if (data.byteLength > MAX_FEED_BYTES) {
      throw new RangeError(
        `MAVLink feed exceeds the ${MAX_FEED_BYTES}-byte safety limit.`,
      );
    }
    if (data.byteLength && this.splitter) {
      this.splitter.write(data);
    }
    return true;
  }

  handlePacket(packet, generation = this.generation) {
    if (generation !== this.generation) {
      return false;
    }
    try {
      const Message = MESSAGE_REGISTRY.byId[packet.header.msgid];
      if (!Message) {
        return false;
      }
      const decoded = packet.protocol.data(packet.payload, Message);
      this.onMessage({
        generation,
        protocol: packet.protocol.name,
        header: serializableValue(packet.header),
        messageName: Message.MSG_NAME || Message.name,
        data: serializableValue(decoded),
      });
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  encode(messageName, payload = {}, options = {}) {
    if (typeof messageName !== "string" || !messageName.trim()) {
      throw new TypeError("MAVLink message name must be a non-empty string.");
    }
    const Message = MESSAGE_REGISTRY.byName.get(messageName);
    if (!Message) {
      throw new Error(`Unsupported MAVLink message: ${messageName}`);
    }

    const version = options.version ?? 2;
    if (version !== 1 && version !== 2) {
      throw new RangeError("MAVLink protocol version must be 1 or 2.");
    }
    const systemId = systemIdentifier(
      options.systemId,
      "MAVLink system ID",
      255,
    );
    const componentId = systemIdentifier(
      options.componentId,
      "MAVLink component ID",
      190,
      { allowZero: true },
    );

    const message = new Message();
    assignMessageFields(message, payload);
    const protocol =
      version === 1
        ? new MavLinkProtocolV1(systemId, componentId)
        : new MavLinkProtocolV2(systemId, componentId);
    const encoded = protocol.serialize(message, this.sequence);
    this.sequence = (this.sequence + 1) & 0xff;
    return Uint8Array.from(encoded);
  }
}

export function registerMavlinkIpc(ipc, getWindow, options = {}) {
  if (
    !ipc ||
    typeof ipc.on !== "function" ||
    typeof ipc.handle !== "function" ||
    typeof getWindow !== "function"
  ) {
    throw new TypeError(
      "MAVLink IPC registration requires ipcMain and a window accessor.",
    );
  }

  const onError =
    options.onError ??
    ((error) => {
      console.warn(`MAVLink bridge rejected data: ${error?.message || error}`);
    });
  const codec = new MavlinkIpcCodec({
    onError,
    onMessage(envelope) {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send("mavlinkMessage", envelope);
      }
    },
  });

  const resetHandler = (_event, generation) => {
    try {
      codec.reset(generation);
    } catch (error) {
      onError(error);
    }
  };
  const feedHandler = (_event, data, generation) => {
    try {
      codec.feed(data, generation);
    } catch (error) {
      onError(error);
    }
  };
  const encodeHandler = (_event, messageName, payload, encodeOptions) =>
    codec.encode(messageName, payload, encodeOptions);

  ipc.on("mavlinkReset", resetHandler);
  ipc.on("mavlinkFeed", feedHandler);
  ipc.handle("mavlinkEncode", encodeHandler);

  return {
    codec,
    dispose() {
      ipc.removeListener?.("mavlinkReset", resetHandler);
      ipc.removeListener?.("mavlinkFeed", feedHandler);
      ipc.removeHandler?.("mavlinkEncode");
      codec.destroy();
    },
  };
}

export {
  MAX_FEED_BYTES,
  MESSAGE_REGISTRY,
  assignMessageFields,
  serializableValue,
};
