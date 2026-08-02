"use strict";

export const NTRIP_PROVIDER_CUSTOM = "custom";
export const NTRIP_PROVIDER_RTK2GO = "rtk2go";

export const NTRIP_PROVIDER_PRESETS = Object.freeze({
  [NTRIP_PROVIDER_RTK2GO]: Object.freeze({
    id: NTRIP_PROVIDER_RTK2GO,
    name: "RTK2go public caster",
    host: "rtk2go.com",
    port: 2101,
    tls: false,
    noFee: true,
    usernameIsEmail: true,
  }),
});

export function resolveNtripProviderSettings(settings = {}) {
  const provider = String(settings.provider ?? NTRIP_PROVIDER_CUSTOM);
  const preset = NTRIP_PROVIDER_PRESETS[provider];
  if (!preset) return { ...settings, provider: NTRIP_PROVIDER_CUSTOM };
  return {
    ...settings,
    provider,
    host: preset.host,
    port: preset.port,
    tls: preset.tls,
  };
}

export function validateNtripProviderAccount(settings = {}) {
  const resolved = resolveNtripProviderSettings(settings);
  const preset = NTRIP_PROVIDER_PRESETS[resolved.provider];
  if (!preset?.usernameIsEmail) return resolved;
  const username = String(resolved.username ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    throw new Error(
      `${preset.name} requires a valid email address in the NTRIP username field.`,
    );
  }
  return { ...resolved, username };
}

