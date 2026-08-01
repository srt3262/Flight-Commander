"use strict";

export const APPLICATION_THEMES = Object.freeze({
  DARK: "dark",
});

export const DEFAULT_APPLICATION_THEME = APPLICATION_THEMES.DARK;
export const APPLICATION_THEME_STORAGE_KEY = "flightCommanderTheme";
export const APPLICATION_THEME_EVENT = "flight-commander-theme-change";

export function normalizeApplicationTheme(value) {
  void value;
  return APPLICATION_THEMES.DARK;
}

export function monacoThemeForApplicationTheme(value) {
  void value;
  return "vs-dark";
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
  // Flight Commander is intentionally dark-only. Persist the canonical value
  // once so installations that previously selected the light theme cannot
  // briefly restore it during startup or after an application update.
  return applyApplicationTheme(DEFAULT_APPLICATION_THEME, {
    documentRef,
    storeApi,
    persist: true,
    announce: false,
  });
}
