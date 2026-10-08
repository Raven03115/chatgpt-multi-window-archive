"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const mainSource = fs.readFileSync(
  path.join(__dirname, "..", "poc-shaped-sidebar-v4.5.4.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "lib", "route-policy.cjs"),
  "utf8"
);

test("profile route is opened in the existing overlay rather than ignored or forwarded", () => {
  const nativeNavigation = mainSource.slice(
    mainSource.indexOf("function handleSidebarNavigation"),
    mainSource.indexOf("function clearOverlayPendingTimer")
  );
  const windowOpen = mainSource.slice(
    mainSource.indexOf("sidebarOverlayWindow.webContents.setWindowOpenHandler"),
    mainSource.indexOf('"render-process-gone"', mainSource.indexOf("sidebarOverlayWindow.webContents.setWindowOpenHandler"))
  );

  assert.match(
    nativeNavigation,
    /if \(isSettingsPageUrl\(url\)\)[\s\S]*?openSettingsPage\(url\)/
  );
  assert.match(
    windowOpen,
    /if \(isSettingsPageUrl\(url\)\)[\s\S]*?openSettingsPage\(url\)/
  );
  assert.match(
    routeSource,
    /function isSettingsPageUrl\(value\)/
  );
});

test("Settings return cannot load the home page into an active pane", () => {
  const nativeNavigation = mainSource.slice(
    mainSource.indexOf("function handleSidebarNavigation"),
    mainSource.indexOf("function clearOverlayPendingTimer")
  );
  const anchorHandler = mainSource.slice(
    mainSource.indexOf('"chatgpt-sidebar-route-intent"'),
    mainSource.indexOf('"chatgpt-sidebar-external-route-intent"')
  );
  const returnPattern =
    /if \(settingsPageMode && isSettingsReturnRoute\(url\)\)\s*\{\s*closeSettingsPage\(\);\s*return;/;

  assert.match(
    nativeNavigation,
    /if \(settingsPageMode\)\s*\{\s*if \(isSettingsReturnRoute\(url\)\)\s*\{\s*closeSettingsPage\(\);\s*return;/
  );
  assert.match(anchorHandler, returnPattern);
  assert.ok(
    anchorHandler.indexOf("closeSettingsPage();") <
      anchorHandler.indexOf("completeOverlayWorkspaceSelection(url)")
  );
});

test("Settings shape reports cannot dismiss the full-page view", () => {
  const handler = mainSource.slice(
    mainSource.indexOf('"chatgpt-sidebar-shape-state"'),
    mainSource.indexOf('"chatgpt-sidebar-diagnostic-event"')
  );
  assert.match(
    handler,
    /if \(settingsPageMode\)\s*\{\s*return;\s*\}/
  );
  assert.match(
    mainSource,
    /function scheduleFullscreenOverlayClose\(\)[\s\S]*?settingsPageMode/
  );
});

test("full-page Settings uses a viewport-sized overlay while preserving existing pane data", () => {
  assert.match(
    mainSource,
    /if \(fullscreenOverlayMode \|\| settingsPageMode\)\s*\{\s*shapeRects = \[/
  );
  assert.match(
    mainSource,
    /function openSettingsPage\(url\)[\s\S]*?type: "settings-page"/
  );
  assert.match(
    mainSource,
    /function closeSettingsPage\(\)[\s\S]*?type: "close"/
  );
  assert.doesNotMatch(
    mainSource.match(/function closeSettingsPage\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "",
    /loadUrlInActivePane\(|completeOverlayWorkspaceSelection\(/
  );
});

test("Settings return requested through window.open reloads only the sidebar overlay", () => {
  const start = mainSource.indexOf(
    "sidebarOverlayWindow.webContents.setWindowOpenHandler"
  );
  const end = mainSource.indexOf('"render-process-gone"', start);
  const handler = mainSource.slice(start, end);

  assert.match(
    handler,
    /settingsPageMode && isSettingsReturnRoute\(url\)[\s\S]*?closeSettingsPage\(\);[\s\S]*?sidebarOverlayWindow\.loadURL\(CHATGPT_URL\)/
  );
  assert.doesNotMatch(
    handler,
    /loadUrlInActivePane\(|completeOverlayWorkspaceSelection\(/
  );
});


test("pending Settings and Search overlay never issue workspace navigation intents", () => {
  const mainCandidateStart = mainSource.indexOf(
    '"chatgpt-sidebar-project-action-candidate"'
  );
  const mainCandidateEnd = mainSource.indexOf(
    '"chatgpt-sidebar-dialog-close-intent"',
    mainCandidateStart
  );
  const projectCandidateHandler = mainSource.slice(
    mainCandidateStart,
    mainCandidateEnd
  );
  const menuCandidateStart = mainSource.indexOf(
    '"chatgpt-sidebar-menu-route-candidate"'
  );
  const menuCandidateHandler = mainSource.slice(
    menuCandidateStart,
    mainCandidateStart
  );

  assert.ok(mainCandidateStart >= 0 && mainCandidateEnd > mainCandidateStart);
  assert.ok(menuCandidateStart >= 0 && menuCandidateStart < mainCandidateStart);
  assert.match(
    projectCandidateHandler,
    /overlayRuntimeState\.overlayOnlyModal/
  );
  assert.match(
    menuCandidateHandler,
    /overlayRuntimeState\.overlayOnlyModal/
  );
});

