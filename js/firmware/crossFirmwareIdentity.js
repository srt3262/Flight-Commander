const INAV_TARGET_ALIASES = new Map([
  // Aero Selfie H743 v1.3 is the MicoAir743 hardware design. The direct
  // MICOAIR743 MSP target needs no alias; keep branded mappings revision-bound.
  ["aeroselfieh743v13", "MicoAir743"],
  ["microairh743v13", "MicoAir743"],
]);

export function normalizeFirmwareTargetName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function uniquePlatforms(entries) {
  return [
    ...new Set(
      (entries ?? [])
        .map((entry) => String(entry?.platform ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function resolution(reportedTarget, method, candidates) {
  return Object.freeze({
    reportedTarget,
    matched: candidates.length === 1,
    ambiguous: candidates.length > 1,
    method,
    platform: candidates.length === 1 ? candidates[0] : null,
    candidates: Object.freeze(candidates),
  });
}

export function resolveArduPilotPlatformForInav(reportedTarget, entries) {
  const rawTarget = String(reportedTarget ?? "").trim();
  const normalizedTarget = normalizeFirmwareTargetName(rawTarget);
  if (!normalizedTarget) {
    return resolution(rawTarget, "none", []);
  }

  const platforms = uniquePlatforms(entries);
  const exact = platforms.filter(
    (platform) => normalizeFirmwareTargetName(platform) === normalizedTarget,
  );
  if (exact.length) {
    return resolution(rawTarget, "exact-name", exact);
  }

  const alias = INAV_TARGET_ALIASES.get(normalizedTarget);
  if (!alias) {
    return resolution(rawTarget, "none", []);
  }
  const normalizedAlias = normalizeFirmwareTargetName(alias);
  const mapped = platforms.filter(
    (platform) => normalizeFirmwareTargetName(platform) === normalizedAlias,
  );
  return resolution(rawTarget, "documented-alias", mapped);
}

export { INAV_TARGET_ALIASES };
