"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAIN_FILE = "poc-shaped-sidebar-v4.5.4.js";
const PRELOAD_FILE = "sidebar-shape-preload-v4.5.4.js";
const ROUTE_POLICY_FILE = "lib/route-policy.cjs";
const ROUTE_TEST_FILE = "tests/route-policy.test.cjs";
const WIDTH_INTEGRATION_TEST = "tests/sidebar-width-integration.test.cjs";

function fail(message) {
  throw new Error(message);
}

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);

  if (first < 0) {
    fail(`Could not find ${label}.`);
  }

  const second = text.indexOf(needle, first + needle.length);

  if (second >= 0) {
    fail(`Found more than one ${label}; refusing an ambiguous patch.`);
  }

  return (
    text.slice(0, first) +
    replacement +
    text.slice(first + needle.length)
  );
}

function filePath(relativePath) {
  const fullPath = path.join(ROOT, relativePath);

  if (!fs.existsSync(fullPath)) {
    fail(`Required file not found: ${relativePath}`);
  }

  return fullPath;
}

function patchMain() {
  const target = filePath(MAIN_FILE);
  let text = fs.readFileSync(target, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";

  const overlayRequire = [
    "const {",
    "  buildOverlayShape,",
    "  classifyOverlayControl,",
    "  decideOverlayControl,",
    "  replaceDialogSurfaceState,",
    "  replacePopupRects,",
    "  transitionOverlayState",
    '} = require("./lib/overlay-policy.cjs");'
  ].join(nl);

  const geometryRequire = [
    overlayRequire,
    "const {",
    "  DEFAULT_SIDEBAR_WIDTH,",
    "  normalizeSidebarWidth,",
    "  shouldUpdateSidebarWidth",
    '} = require("./lib/sidebar-geometry.cjs");'
  ].join(nl);

  text = replaceOnce(
    text,
    overlayRequire,
    geometryRequire,
    "overlay policy import"
  );

  text = replaceOnce(
    text,
    "const SIDEBAR_WIDTH = 260;",
    "let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;",
    "fixed sidebar width declaration"
  );

  text = text.replace(/\bSIDEBAR_WIDTH\b/g, "sidebarWidth");

  const ipcMarker = [
    "ipcMain.on(",
    '  "chatgpt-sidebar-shape-state",'
  ].join(nl);

  const widthListener = [
    "ipcMain.on(",
    '  "chatgpt-sidebar-width-changed",',
    "  (event, payload) => {",
    "    if (",
    "      !isUsableWindow(sidebarOverlayWindow) ||",
    "      event.sender.id !==",
    "        sidebarOverlayWindow.webContents.id",
    "    ) {",
    "      return;",
    "    }",
    "",
    "    const workspace = getWorkspaceContentSize();",
    "    const nextWidth = normalizeSidebarWidth(",
    "      payload?.width,",
    "      workspace.width",
    "    );",
    "",
    "    if (",
    "      !shouldUpdateSidebarWidth(",
    "        sidebarWidth,",
    "        nextWidth",
    "      )",
    "    ) {",
    "      return;",
    "    }",
    "",
    "    sidebarWidth = nextWidth;",
    "    lastAppliedOverlayShapeSignature = \"\";",
    "",
    "    layoutPaneViews();",
    "    applyOverlayShape();",
    "",
    "    recordIntegrationEvent({",
    '      event: "sidebar-width-changed",',
    '      source: "sidebar-preload",',
    '      action: "apply",',
    '      reason: "measured-sidebar-geometry",',
    "      rectWidth: sidebarWidth",
    "    });",
    "  }",
    ");",
    "",
    ipcMarker
  ].join(nl);

  text = replaceOnce(
    text,
    ipcMarker,
    widthListener,
    "sidebar shape IPC listener"
  );

  const cleanupMarker = [
    "  ipcMain.removeAllListeners(",
    '    "chatgpt-sidebar-diagnostic-event"',
    "  );"
  ].join(nl);

  const cleanupReplacement = [
    "  ipcMain.removeAllListeners(",
    '    "chatgpt-sidebar-width-changed"',
    "  );",
    "",
    cleanupMarker
  ].join(nl);

  text = replaceOnce(
    text,
    cleanupMarker,
    cleanupReplacement,
    "IPC cleanup marker"
  );

  fs.writeFileSync(target, text, "utf8");
}

function patchPreload() {
  const target = filePath(PRELOAD_FILE);
  let text = fs.readFileSync(target, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";

  const widthDeclaration = [
    "const DEFAULT_SIDEBAR_WIDTH = 260;",
    "const MIN_SIDEBAR_WIDTH = 220;",
    "const MAX_SIDEBAR_WIDTH = 420;",
    "let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;",
    "",
    "const SIDEBAR_SURFACE_SELECTORS = [",
    '  "#stage-slideover-sidebar",',
    '  \'[data-testid="sidebar"]\',',
    '  \'[data-testid="sidebar-container"]\',',
    '  \'[data-testid="conversation-sidebar"]\',',
    '  \'nav[aria-label="Chat history"]\',',
    '  \'nav[aria-label*="聊天"]\',',
    '  \'nav[aria-label*="對話"]\',',
    '  \'aside:has(a[href^="/c/"])\',',
    '  \'aside:has(a[href*="/c/"])\'',
    "];"
  ].join(nl);

  text = replaceOnce(
    text,
    "const SIDEBAR_WIDTH = 260;",
    widthDeclaration,
    "preload fixed sidebar width declaration"
  );

  text = text.replace(/\bSIDEBAR_WIDTH\b/g, "sidebarWidth");

  text = replaceOnce(
    text,
    "let reportAnimationFrame = null;",
    [
      "let reportAnimationFrame = null;",
      "let sidebarWidthAnimationFrame = null;"
    ].join(nl),
    "report animation state"
  );

  const metadataMarker = "function getMetadata(element) {";

  const widthFunctions = [
    "function normalizeMeasuredSidebarWidth(value) {",
    "  const numeric = Number(value);",
    "",
    "  if (!Number.isFinite(numeric)) {",
    "    return DEFAULT_SIDEBAR_WIDTH;",
    "  }",
    "",
    "  return Math.round(",
    "    Math.min(",
    "      MAX_SIDEBAR_WIDTH,",
    "      Math.max(MIN_SIDEBAR_WIDTH, numeric)",
    "    )",
    "  );",
    "}",
    "",
    "function getOfficialSidebarCssWidth() {",
    "  let measured = 0;",
    "",
    "  for (const root of [",
    "    document.documentElement,",
    "    document.body",
    "  ]) {",
    "    if (!root) {",
    "      continue;",
    "    }",
    "",
    "    try {",
    "      const rawValue = window",
    "        .getComputedStyle(root)",
    '        .getPropertyValue("--sidebar-width");',
    "      const parsed = Number.parseFloat(rawValue);",
    "",
    "      if (",
    "        Number.isFinite(parsed) &&",
    "        parsed >= MIN_SIDEBAR_WIDTH &&",
    "        parsed <= MAX_SIDEBAR_WIDTH",
    "      ) {",
    "        measured = Math.max(measured, parsed);",
    "      }",
    "    } catch {",
    "      // Ignore transient style reads.",
    "    }",
    "  }",
    "",
    "  return measured;",
    "}",
    "",
    "function measureSidebarWidth() {",
    "  let measured = getOfficialSidebarCssWidth();",
    "  const minimumCandidateHeight = Math.min(",
    "    240,",
    "    Math.max(120, window.innerHeight * 0.35)",
    "  );",
    "",
    "  for (",
    "    const element of collectElements(",
    "      SIDEBAR_SURFACE_SELECTORS",
    "    )",
    "  ) {",
    "    if (!isVisible(element)) {",
    "      continue;",
    "    }",
    "",
    "    const rect = getRect(element);",
    "",
    "    if (",
    "      rect.left < -80 ||",
    "      rect.left > 12 ||",
    "      rect.height < minimumCandidateHeight ||",
    "      rect.right < MIN_SIDEBAR_WIDTH ||",
    "      rect.right > MAX_SIDEBAR_WIDTH",
    "    ) {",
    "      continue;",
    "    }",
    "",
    "    measured = Math.max(measured, rect.right);",
    "  }",
    "",
    "  return normalizeMeasuredSidebarWidth(",
    "    measured || DEFAULT_SIDEBAR_WIDTH",
    "  );",
    "}",
    "",
    "function syncSidebarWidth() {",
    "  const nextWidth = measureSidebarWidth();",
    "",
    "  if (Math.abs(nextWidth - sidebarWidth) < 1) {",
    "    return false;",
    "  }",
    "",
    "  sidebarWidth = nextWidth;",
    "  lastSignature = \"\";",
    "",
    "  ipcRenderer.send(",
    '    "chatgpt-sidebar-width-changed",',
    "    { width: sidebarWidth }",
    "  );",
    "",
    "  reportDiagnostic({",
    '    event: "sidebar-width-changed",',
    '    action: "measure",',
    '    reason: "official-sidebar-geometry",',
    "    rectWidth: sidebarWidth",
    "  });",
    "",
    "  scheduleFrameReport();",
    "  return true;",
    "}",
    "",
    "function scheduleSidebarWidthSync() {",
    "  if (sidebarWidthAnimationFrame !== null) {",
    "    return;",
    "  }",
    "",
    "  sidebarWidthAnimationFrame =",
    "    requestAnimationFrame(() => {",
    "      sidebarWidthAnimationFrame = null;",
    "      syncSidebarWidth();",
    "    });",
    "}",
    "",
    metadataMarker
  ].join(nl);

  text = replaceOnce(
    text,
    metadataMarker,
    widthFunctions,
    "metadata function marker"
  );

  const reportMarker = "function reportShapeState() {";

  text = replaceOnce(
    text,
    reportMarker,
    [reportMarker, "  syncSidebarWidth();"].join(nl),
    "shape report function"
  );

  const observerMarker = [
    "  observer = new MutationObserver((records) => {",
    "    installOverlayIsolationStyle();"
  ].join(nl);

  text = replaceOnce(
    text,
    observerMarker,
    [
      "  observer = new MutationObserver((records) => {",
      "    installOverlayIsolationStyle();",
      "    scheduleSidebarWidthSync();"
    ].join(nl),
    "mutation observer"
  );

  const resizeListener = [
    "  window.addEventListener(",
    '    "resize",',
    "    scheduleFrameReport",
    "  );"
  ].join(nl);

  text = replaceOnce(
    text,
    resizeListener,
    [
      "  window.addEventListener(",
      '    "resize",',
      "    () => {",
      "      scheduleSidebarWidthSync();",
      "      scheduleFrameReport();",
      "    }",
      "  );"
    ].join(nl),
    "window resize listener"
  );

  const initialReport = "  scheduleFrameReport();";
  const finalInitial = text.lastIndexOf(initialReport);

  if (finalInitial < 0) {
    fail("Could not find initial shape report.");
  }

  text =
    text.slice(0, finalInitial) +
    [
      "  scheduleSidebarWidthSync();",
      "  scheduleFrameReport();"
    ].join(nl) +
    text.slice(finalInitial + initialReport.length);

  const unloadMarker = [
    "    if (reportAnimationFrame !== null) {",
    "      cancelAnimationFrame(reportAnimationFrame);",
    "      reportAnimationFrame = null;",
    "    }"
  ].join(nl);

  const unloadReplacement = [
    unloadMarker,
    "",
    "    if (sidebarWidthAnimationFrame !== null) {",
    "      cancelAnimationFrame(sidebarWidthAnimationFrame);",
    "      sidebarWidthAnimationFrame = null;",
    "    }"
  ].join(nl);

  text = replaceOnce(
    text,
    unloadMarker,
    unloadReplacement,
    "animation cleanup"
  );

  fs.writeFileSync(target, text, "utf8");
}

function patchRoleLinkSupport() {
  const policyPath = filePath(ROUTE_POLICY_FILE);
  let policy = fs.readFileSync(policyPath, "utf8");
  const policyNl = policy.includes("\r\n") ? "\r\n" : "\n";

  const kinds = [
    "const PROJECT_ACTION_CONTROL_KINDS = new Set([",
    '  "button",',
    '  "role-button"',
    "]);"
  ].join(policyNl);

  policy = replaceOnce(
    policy,
    kinds,
    [
      "const PROJECT_ACTION_CONTROL_KINDS = new Set([",
      '  "button",',
      '  "role-button",',
      '  "role-link"',
      "]);"
    ].join(policyNl),
    "project action control kinds"
  );

  fs.writeFileSync(policyPath, policy, "utf8");

  const routeTestPath = filePath(ROUTE_TEST_FILE);
  let routeTests = fs.readFileSync(routeTestPath, "utf8");

  routeTests = replaceOnce(
    routeTests,
    `/return target\\.closest\\(\\s*'a\\[href\\], button, \\[role="button"\\], \\[role="menuitem"\\]'\\s*\\)/`,
    `/return target\\.closest\\(\\s*'a\\[href\\], button, \\[role="button"\\], \\[role="link"\\], \\[role="menuitem"\\]'\\s*\\)/`,
    "actionable control selector regression assertion"
  );

  fs.writeFileSync(routeTestPath, routeTests, "utf8");

  const preloadPath = filePath(PRELOAD_FILE);
  let preload = fs.readFileSync(preloadPath, "utf8");
  const preloadNl = preload.includes("\r\n") ? "\r\n" : "\n";

  preload = replaceOnce(
    preload,
    `'a[href], button, [role="button"], [role="menuitem"]'`,
    `'a[href], button, [role="button"], [role="link"], [role="menuitem"]'`,
    "actionable control selector"
  );

  const roleButtonBlock = [
    '  if (role === "button") {',
    '    return "role-button";',
    "  }",
    "",
    '  if (role === "menuitem") {'
  ].join(preloadNl);

  preload = replaceOnce(
    preload,
    roleButtonBlock,
    [
      '  if (role === "button") {',
      '    return "role-button";',
      "  }",
      "",
      '  if (role === "link") {',
      '    return "role-link";',
      "  }",
      "",
      '  if (role === "menuitem") {'
    ].join(preloadNl),
    "control kind role block"
  );

  fs.writeFileSync(preloadPath, preload, "utf8");
}

function addIntegrationTest() {
  const target = path.join(ROOT, WIDTH_INTEGRATION_TEST);

  const content = `"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
  path.join(root, "poc-shaped-sidebar-v4.5.4.js"),
  "utf8"
);
const preloadSource = fs.readFileSync(
  path.join(root, "sidebar-shape-preload-v4.5.4.js"),
  "utf8"
);
const routePolicySource = fs.readFileSync(
  path.join(root, "lib", "route-policy.cjs"),
  "utf8"
);

test("main process uses measured sidebar width for pane and overlay geometry", () => {
  assert.match(
    mainSource,
    /let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;/
  );
  assert.match(
    mainSource,
    /content\\.width - sidebarWidth/
  );
  assert.match(
    mainSource,
    /x: sidebarWidth \\+ left/
  );
  assert.match(
    mainSource,
    /"chatgpt-sidebar-width-changed"/
  );
  assert.match(
    mainSource,
    /normalizeSidebarWidth\\(/
  );
});

test("sidebar preload measures official responsive sidebar geometry", () => {
  assert.match(
    preloadSource,
    /function measureSidebarWidth\\(\\)/
  );
  assert.match(
    preloadSource,
    /--sidebar-width/
  );
  assert.match(
    preloadSource,
    /#stage-slideover-sidebar/
  );
  assert.match(
    preloadSource,
    /"chatgpt-sidebar-width-changed"/
  );
  assert.match(
    preloadSource,
    /let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;/
  );
});

test("non-anchor role links are eligible explicit sidebar actions", () => {
  assert.match(
    preloadSource,
    /\\[role="link"\\]/
  );
  assert.match(
    routePolicySource,
    /"role-link"/
  );
});

test("fixed 260px sidebar token is no longer used as runtime geometry", () => {
  assert.doesNotMatch(
    mainSource,
    /\\bSIDEBAR_WIDTH\\b/
  );
  assert.doesNotMatch(
    preloadSource,
    /\\bSIDEBAR_WIDTH\\b/
  );
});
`;

  fs.writeFileSync(target, content, "utf8");
}

patchMain();
patchPreload();
patchRoleLinkSupport();
addIntegrationTest();

console.log("sidebar compatibility patch applied");
