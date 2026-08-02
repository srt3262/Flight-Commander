"use strict";

const MESSAGE_ALIASES = Object.freeze({
  heartbeat: "Heartbeat",
  global_position_int: "GlobalPositionInt",
  home_position: "HomePosition",
  gps_raw_int: "GpsRawInt",
  attitude: "Attitude",
  raw_imu: "RawImu",
  scaled_imu: "ScaledImu",
  scaled_imu2: "ScaledImu2",
  scaled_imu3: "ScaledImu3",
  highres_imu: "HighresImu",
  scaled_pressure: "ScaledPressure",
  scaled_pressure2: "ScaledPressure2",
  scaled_pressure3: "ScaledPressure3",
  distance_sensor: "DistanceSensor",
  sys_status: "SysStatus",
  vfr_hud: "VfrHud",
  radio_status: "RadioStatus",
  rc_channels: "RcChannels",
  rc_channels_raw: "RcChannelsRaw",
  servo_output_raw: "ServoOutputRaw",
  param_value: "ParamValue",
  autopilot_version: "AutopilotVersion",
  mission_current: "MissionCurrent",
  mission_item_reached: "MissionItemReached",
  nav_controller_output: "NavControllerOutput",
  statustext: "StatusText",
  command_ack: "CommandAck",
  mission_count: "MissionCount",
  mission_item_int: "MissionItemInt",
  mission_item: "MissionItem",
  mission_request_int: "MissionRequestInt",
  mission_request: "MissionRequest",
  mission_ack: "MissionAck",
  log_entry: "LogEntry",
  log_data: "LogData",
  file_transfer_protocol: "FileTransferProtocol",
});

function snakeCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/^mavlink_msg_id_/, "")
    .toLowerCase();
}

export function canonicalMessageName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return MESSAGE_ALIASES[snakeCase(text)] ?? text;
}

export function normalizeProtocol(value) {
  if (value === 1 || /(?:^|_)v?1$/i.test(String(value ?? ""))) return "MAV_V1";
  if (value === 2 || /(?:^|_)v?2$/i.test(String(value ?? ""))) return "MAV_V2";
  const text = String(value ?? "");
  if (/mavlinkv1/i.test(text)) return "MAV_V1";
  if (/mavlinkv2/i.test(text)) return "MAV_V2";
  return value ?? null;
}

function finiteInteger(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }
  return null;
}

/**
 * Converts the decoded object emitted by node-mavlink (and the older
 * Flight Commander IPC envelope) into one stable renderer-side envelope.
 */
export function normalizeMavlinkEnvelope(frame) {
  if (!frame || typeof frame !== "object") {
    throw new TypeError("A decoded MAVLink frame object is required.");
  }

  const sourceMessage =
    frame.data ??
    frame.message ??
    frame.payload ??
    frame.packet?.message ??
    frame;
  const sourceHeader =
    frame.header ?? frame.packet?.header ?? sourceMessage.header ?? {};
  const constructorName = sourceMessage?.constructor?.name;
  const messageName = canonicalMessageName(
    frame.messageName ??
      frame.name ??
      frame.messageType ??
      sourceMessage.messageName ??
      sourceMessage.name ??
      (constructorName !== "Object" ? constructorName : ""),
  );

  if (!messageName) {
    throw new Error(
      "Decoded MAVLink frame does not identify its message type.",
    );
  }

  const data =
    sourceMessage === frame
      ? Object.fromEntries(
          Object.entries(sourceMessage).filter(
            ([key]) =>
              ![
                "header",
                "protocol",
                "messageName",
                "name",
                "messageType",
              ].includes(key),
          ),
        )
      : sourceMessage;

  return {
    messageName,
    data: data && typeof data === "object" ? data : {},
    header: {
      ...sourceHeader,
      sysid: finiteInteger(
        sourceHeader.sysid,
        sourceHeader.systemId,
        sourceHeader.system_id,
        frame.systemId,
      ),
      compid: finiteInteger(
        sourceHeader.compid,
        sourceHeader.componentId,
        sourceHeader.component_id,
        frame.componentId,
      ),
      payloadLength: finiteInteger(
        sourceHeader.payloadLength,
        sourceHeader.payload_length,
        sourceHeader.len,
      ),
    },
    protocol: normalizeProtocol(
      frame.protocol ??
        frame.protocolVersion ??
        sourceHeader.protocol ??
        sourceHeader.protocolVersion,
    ),
    raw: frame.raw ?? frame.packet?.buffer ?? null,
  };
}

export function field(data, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data ?? {}, name))
      return data[name];
  }
  return undefined;
}
