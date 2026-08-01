import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_THEMES,
  APPLICATION_THEME_EVENT,
  APPLICATION_THEME_STORAGE_KEY,
  DEFAULT_APPLICATION_THEME,
  applyApplicationTheme,
  initializeApplicationTheme,
  monacoThemeForApplicationTheme,
  normalizeApplicationTheme,
} from "../../../js/theme.js";

function fakeDocument() {
  const attributes = new Map();
  const events = [];
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }
  return {
    attributes,
    events,
    documentElement: {
      style: {},
      setAttribute: (name, value) => attributes.set(name, value),
    },
    defaultView: { CustomEvent: FakeCustomEvent },
    dispatchEvent: (event) => events.push(event),
  };
}

test("application theme normalization defaults safely to dark", () => {
  assert.equal(DEFAULT_APPLICATION_THEME, "dark");
  assert.equal(normalizeApplicationTheme(" LIGHT "), "light");
  assert.equal(normalizeApplicationTheme("dark"), "dark");
  assert.equal(normalizeApplicationTheme("unknown"), "dark");
  assert.equal(monacoThemeForApplicationTheme("light"), "vs");
  assert.equal(monacoThemeForApplicationTheme("dark"), "vs-dark");
});

test("stored theme is applied to the whole document before controls bind", () => {
  const documentRef = fakeDocument();
  const reads = [];
  const theme = initializeApplicationTheme({
    get(key, fallback) {
      reads.push({ key, fallback });
      return APPLICATION_THEMES.LIGHT;
    },
  }, documentRef);

  assert.equal(theme, "light");
  assert.deepEqual(reads, [{
    key: APPLICATION_THEME_STORAGE_KEY,
    fallback: DEFAULT_APPLICATION_THEME,
  }]);
  assert.equal(documentRef.attributes.get("data-theme"), "light");
  assert.equal(documentRef.documentElement.style.colorScheme, "light");
  assert.equal(documentRef.events.length, 0);
});

test("theme toggles persist and announce one normalized application event", () => {
  const documentRef = fakeDocument();
  const writes = [];
  const theme = applyApplicationTheme("DARK", {
    documentRef,
    storeApi: { set: (key, value) => writes.push({ key, value }) },
    persist: true,
  });

  assert.equal(theme, "dark");
  assert.deepEqual(writes, [{
    key: APPLICATION_THEME_STORAGE_KEY,
    value: "dark",
  }]);
  assert.equal(documentRef.attributes.get("data-theme"), "dark");
  assert.equal(documentRef.events.length, 1);
  assert.equal(documentRef.events[0].type, APPLICATION_THEME_EVENT);
  assert.deepEqual(documentRef.events[0].detail, { theme: "dark" });
});
