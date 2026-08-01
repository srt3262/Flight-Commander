"use strict";

export const APPLICATION_THEMES = Object.freeze({
  LIGHT: "light",
  DARK: "dark",
});

export const DEFAULT_APPLICATION_THEME = APPLICATION_THEMES.DARK;
export const APPLICATION_THEME_STORAGE_KEY = "flightCommanderTheme";
export const APPLICATION_THEME_EVENT = "flight-commander-theme-change";

export function normalizeApplicationTheme(value) {
  return String(value ?? "").trim().toLowerCase() === APPLICATION_THEMES.LIGHT
    ? APPLICATION_THEMES.LIGHT
    : APPLICATION_THEMES.DARK;
}

export function monacoThemeForApplicationTheme(value) {
  return normalizeApplicationTheme(value) === APPLICATION_THEMES.DARK
    ? "vs-dark"
    : "vs";
}

export function applyApplicationTheme(
  value,
  {
    documentRef = globalThis.document,
    storeApi = null,
    persist = false,
    announce = true,
  } = {},
) {
  const theme = normalizeApplicationTheme(value);
  const root = documentRef?.documentElement;
  if (root) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }
  if (persist) {
    storeApi?.set?.(APPLICATION_THEME_STORAGE_KEY, theme);
  }
  if (announce && documentRef?.dispatchEvent) {
    const EventConstructor = documentRef.defaultView?.CustomEvent
      ?? globalThis.CustomEvent;
    if (typeof EventConstructor === "function") {
      documentRef.dispatchEvent(
        new EventConstructor(APPLICATION_THEME_EVENT, {
          detail: Object.freeze({ theme }),
        }),
      );
    }
  }
  return theme;
}

export function initializeApplicationTheme(
  storeApi,
  documentRef = globalThis.document,
) {
  const stored = storeApi?.get?.(
    APPLICATION_THEME_STORAGE_KEY,
    DEFAULT_APPLICATION_THEME,
  );
  return applyApplicationTheme(stored, {
    documentRef,
    storeApi,
    persist: false,
    announce: false,
  });
}
