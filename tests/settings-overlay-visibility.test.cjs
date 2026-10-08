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
  assert.match(
    nativeNavigation,
    /if \(settingsPageMode\)\s*\{\s*const isHomeRoute = isSettingsReturnRoute\(url\);[\s\S]*?if \(isHomeRoute\)\s*\{\s*closeSettingsPage\("native-home-route"\);\s*return;/
  );
  assert.match(
    anchorHandler,
    /if \(settingsPageMode && isSettingsReturnRoute\(url\)\)\s*\{\s*closeSettingsPage\("anchor-home-route"\);\s*return;/
  );
  const returnIndex = anchorHandler.indexOf(
    'closeSettingsPage("anchor-home-route");'
  );
  const forwardingIndex = anchorHandler.indexOf(
    "completeOverlayWorkspaceSelection(url)"
  );
  assert.ok(
    returnIndex >= 0 &&
      forwardingIndex > returnIndex,
    "Settings return must close the overlay before any pane forwarding"
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
  const closeStart = mainSource.indexOf(
    'function closeSettingsPage(closeSource = "unspecified")'
  );
  const closeEnd = mainSource.indexOf(
    "\nfunction openFullscreenAccountRoute(",
    closeStart
  );
  assert.ok(
    closeStart >= 0 && closeEnd > closeStart,
    "Settings close function must remain independently identifiable"
  );
  const closeBody = mainSource.slice(closeStart, closeEnd);
  assert.match(
    closeBody,
    /applyOverlayRuntimeEvent\(\s*\{ type: "close" \}/
  );
  assert.doesNotMatch(
    closeBody,
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
    /settingsPageMode && isSettingsReturnRoute\(url\)[\s\S]*?closeSettingsPage\("window-open-home-route"\);[\s\S]*?sidebarOverlayWindow\.loadURL\(CHATGPT_URL\)/
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

