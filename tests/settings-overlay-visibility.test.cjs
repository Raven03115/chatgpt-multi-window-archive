"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  transitionOverlayState
} = require("../lib/overlay-policy.cjs");

const root = path.join(__dirname, "..");
const preloadSource = fs.readFileSync(
  path.join(root, "sidebar-shape-preload-v4.5.4.js"),
  "utf8"
);
const mainSource = fs.readFileSync(
  path.join(root, "poc-shaped-sidebar-v4.5.4.js"),
  "utf8"
);

test("Settings recognizes a visible native modal independently of generic dialog geometry", () => {
  assert.match(
    preloadSource,
    /function hasVisibleNativeSettingsSurface\(\)[\s\S]*?activeOverlayOnlyKind !== "settings"/
  );
  assert.match(
    preloadSource,
    /settingsSurfacePresent\s*=\s*hasVisibleNativeSettingsSurface\(\)/
  );
  assert.match(
    preloadSource,
    /const payload = \{\s*dialogRect,\s*dialogKind,\s*popupRects,\s*settingsSurfacePresent\s*\}/
  );
  assert.match(
    mainSource,
    /nativeSettingsSurfacePresent\s*&&\s*overlayRuntimeState\.mode === "overlay-intent-pending"/
  );
});

test("explicit Settings pending intent suppresses panes before geometry detection", () => {
  assert.match(
    mainSource,
    /const shouldSuppress =\s*overlayRuntimeState\.suppressPanes \|\|\s*\(\s*overlayOnlyIntentKind === "settings"\s*&&\s*overlayRuntimeState\.mode === "overlay-intent-pending"/
  );

  let state = transitionOverlayState(
    { mode: "sidebar-only", generation: 0 },
    { type: "overlay-intent" }
  );
  assert.equal(state.suppressPanes, false);
  assert.equal(state.overlayOnlyModal, true);

  state = transitionOverlayState(state, { type: "dialog-detected" });
  assert.equal(state.suppressPanes, true);
  assert.equal(state.overlayOnlyModal, true);

  state = transitionOverlayState(state, { type: "close" });
  assert.equal(state.suppressPanes, false);
  assert.equal(state.overlayOnlyModal, false);
});

test("Settings main content is exposed only under the explicit Settings CSS class", () => {
  for (const source of [preloadSource, mainSource]) {
    assert.match(
      source,
      /html\.chatgpt-multi-settings-overlay main,\s*html\.chatgpt-multi-settings-overlay \[role="main"\]/
    );
  }

  assert.match(
    preloadSource,
    /"chatgpt-sidebar-set-settings-mode"/
  );
  assert.match(
    mainSource,
    /sendSettingsOverlayClass\(\s*overlayOnlyIntentKind === "settings"/
  );
});

test("Settings semantic close restores panes without modifying generic Rename detection", () => {
  assert.match(
    mainSource,
    /function scheduleSettingsSurfaceClose\(\)[\s\S]*?unlockDialogShape\(false\)/
  );
  assert.match(
    mainSource,
    /settingsSurfaceObserved\s*&&\s*overlayOnlyIntentKind === "settings"\s*&&\s*!nativeSettingsSurfacePresent/
  );
  assert.match(
    preloadSource,
    /overlayDialogObserved\s*&&\s*!dialogRect\s*&&\s*!settingsSurfacePresent/
  );
  assert.match(
    mainSource,
    /const nextDialogRect =\s*sanitizeDialogRect\(\s*state\?\.dialogRect,\s*bounds\s*\)/
  );
});
