const CATEGORY_DEFINITIONS = [
  {
    id: "basic",
    label: "Basic setup",
    pattern: /^(AHRS|FRAME|PILOT|SYSID|SCHED|BRD_|FORMAT_VERSION)/,
  },
  {
    id: "safety",
    label: "Safety & arming",
    pattern:
      /^(ARMING|ARM_|FS_|FENCE|RTL_|Q_RTL|LAND_|FLIGHT_OPTIONS|CRASH_|PARACHUTE)/,
  },
  {
    id: "modes",
    label: "Flight modes",
    pattern: /^(FLTMODE|MODE|SIMPLE|SUPER_SIMPLE|INITIAL_MODE)/,
  },
  {
    id: "radio",
    label: "Radio & inputs",
    pattern: /^(RC\d|RC_|RSSI|THR_DZ|MANUAL_|PILOT_)/,
  },
  {
    id: "outputs",
    label: "Motors & outputs",
    pattern: /^(SERVO\d|SERVO_|MOT_|MOTOR|DSHOT|RELAY|RPM|RSC_|H_)/,
  },
  {
    id: "power",
    label: "Power & battery",
    pattern: /^(BATT|BATTERY|ESC_|GEN_|EFI_|ICE_)/,
  },
  {
    id: "sensors",
    label: "Sensors",
    pattern:
      /^(INS_|COMPASS|BARO|GPS|EK[234F]_|AHRS_|ARSPD|RNGFND|PRX|FLOW|VISO|BEACON)/,
  },
  {
    id: "navigation",
    label: "Navigation & position",
    pattern:
      /^(WP|WPNAV|NAV|LOIT|TERR|OA_|AVOID|CIRCLE|RALLY|FOLL|GUIDED|POSCONTROL)/,
  },
  {
    id: "tuning",
    label: "PID tuning",
    pattern:
      /^(ATC_|PSC_|RATE_|PID|AUTOTUNE|AUTOTUNE_|Q_A_|TECS_|AROT_|ACRO_|TUNE)/,
  },
  {
    id: "telemetry",
    label: "Ports & telemetry",
    pattern: /^(SERIAL\d|SERIAL_|MAV_|SR\d|NET_|CAN_|SLCAN|ADSB|GCS_|NMEA)/,
  },
  { id: "logging", label: "Logging", pattern: /^(LOG_|LOGGING|FILE_)/ },
  { id: "other", label: "Other settings", pattern: /.*/ },
];

const BOOLEAN_LABEL_PATTERN =
  /^(disabled|disable|off|false|no|enabled|enable|on|true|yes)$/i;

function slug(value) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "other"
  );
}

function categoryForParameter(id, metadata = {}) {
  if (metadata.category) {
    return { id: slug(metadata.category), label: metadata.category };
  }
  const normalized = String(id).toUpperCase();
  const definition = CATEGORY_DEFINITIONS.find((candidate) =>
    candidate.pattern.test(normalized),
  );
  return { id: definition.id, label: definition.label };
}

function groupForParameter(id, metadata = {}) {
  if (metadata.group) {
    return { id: slug(metadata.group), label: metadata.group };
  }

  const normalized = String(id).toUpperCase();
  const special = [
    [/^SERVO\d+_/, "servo-outputs", "Servo outputs"],
    [/^RC\d+_/, "rc-channels", "RC channels"],
    [/^SERIAL\d+_/, "serial-ports", "Serial ports"],
    [/^BATT\d*_/, "battery-monitors", "Battery monitors"],
    [/^GPS\d*_/, "gps", "GPS"],
    [/^COMPASS\d*_/, "compass", "Compass"],
    [/^RNGFND\d*_/, "rangefinders", "Rangefinders"],
  ].find(([pattern]) => pattern.test(normalized));
  if (special) {
    return { id: special[1], label: special[2] };
  }

  const prefix = normalized.split("_")[0] || normalized;
  return { id: slug(prefix), label: prefix.replace(/\d+$/, "") || "Other" };
}

function isBooleanMetadata(metadata = {}) {
  if (!Array.isArray(metadata.values) || metadata.values.length !== 2) {
    return false;
  }
  const values = metadata.values.map((choice) => choice.value);
  const labels = metadata.values.map((choice) => choice.label);
  return (
    values.includes(0) &&
    values.includes(1) &&
    labels.every((label) => BOOLEAN_LABEL_PATTERN.test(String(label).trim()))
  );
}

function controlKindForMetadata(metadata = {}) {
  if (Array.isArray(metadata.bitmask) && metadata.bitmask.length) {
    return "bitmask";
  }
  if (isBooleanMetadata(metadata)) {
    return "boolean";
  }
  if (Array.isArray(metadata.values) && metadata.values.length) {
    return "enum";
  }
  return "number";
}

function inferredMetadata(id) {
  return {
    id,
    displayName: id,
    description: "",
    units: "",
    min: null,
    max: null,
    increment: null,
    values: [],
    bitmask: [],
    user: "",
    category: "",
    group: "",
    readOnly: false,
    rebootRequired: false,
    volatile: false,
  };
}

export function parameterView(parameter, metadata) {
  const definition =
    metadata.get(parameter.id) ?? inferredMetadata(parameter.id);
  return {
    ...parameter,
    metadata: definition,
    category: categoryForParameter(parameter.id, definition),
    group: groupForParameter(parameter.id, definition),
    controlKind: controlKindForMetadata(definition),
  };
}

export function matchesSearch(parameter, query) {
  const normalized = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }
  return [
    parameter.id,
    parameter.value,
    parameter.metadata.displayName,
    parameter.metadata.description,
    parameter.metadata.units,
    parameter.category.label,
    parameter.group.label,
  ].some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalized),
  );
}

export function buildParameterCatalog(
  parameters,
  metadata = new Map(),
  options = {},
) {
  const level = options.level === "advanced" ? "advanced" : "standard";
  const metadataAvailable = metadata.size > 0;
  let views = parameters
    .map((parameter) => parameterView(parameter, metadata))
    .filter((parameter) => matchesSearch(parameter, options.query));

  if (level === "standard" && metadataAvailable) {
    const standardViews = views.filter(
      (parameter) => parameter.metadata.user === "standard",
    );
    if (standardViews.length) {
      views = standardViews;
    }
  }

  const categories = new Map();
  for (const parameter of views) {
    if (!categories.has(parameter.category.id)) {
      categories.set(parameter.category.id, {
        ...parameter.category,
        count: 0,
        groups: new Map(),
      });
    }
    const category = categories.get(parameter.category.id);
    category.count += 1;
    if (!category.groups.has(parameter.group.id)) {
      category.groups.set(parameter.group.id, {
        ...parameter.group,
        parameters: [],
      });
    }
    category.groups.get(parameter.group.id).parameters.push(parameter);
  }

  const categoryOrder = new Map(
    CATEGORY_DEFINITIONS.map((definition, index) => [definition.id, index]),
  );
  return [...categories.values()]
    .map((category) => ({
      ...category,
      groups: [...category.groups.values()]
        .map((group) => ({
          ...group,
          parameters: group.parameters.sort((first, second) =>
            first.id.localeCompare(second.id),
          ),
        }))
        .sort((first, second) => first.label.localeCompare(second.label)),
    }))
    .sort((first, second) => {
      const firstOrder =
        categoryOrder.get(first.id) ?? CATEGORY_DEFINITIONS.length;
      const secondOrder =
        categoryOrder.get(second.id) ?? CATEGORY_DEFINITIONS.length;
      return (
        firstOrder - secondOrder || first.label.localeCompare(second.label)
      );
    });
}

export function validateParameterValue(parameter, value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return {
      valid: false,
      message: `${parameter.id} must contain a numeric value.`,
    };
  }
  if (parameter.metadata.min != null && numericValue < parameter.metadata.min) {
    return {
      valid: false,
      message:
        `${parameter.id} must be at least ${parameter.metadata.min}` +
        `${parameter.metadata.units ? ` ${parameter.metadata.units}` : ""}.`,
    };
  }
  if (parameter.metadata.max != null && numericValue > parameter.metadata.max) {
    return {
      valid: false,
      message:
        `${parameter.id} must be no more than ${parameter.metadata.max}` +
        `${parameter.metadata.units ? ` ${parameter.metadata.units}` : ""}.`,
    };
  }
  return { valid: true, value: numericValue };
}

export { CATEGORY_DEFINITIONS };
