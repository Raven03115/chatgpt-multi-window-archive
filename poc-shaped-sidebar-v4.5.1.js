const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  globalShortcut,
  ipcMain,
  shell
} = require("electron");

const fs = require("fs");
const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 260;

const DEFAULT_PANE_COUNT = 2;
const ALLOWED_PANE_COUNTS = new Set([
  1,
  2,
  3,
  4,
  6
]);
const MAX_PANES = 6;

const MAX_POPUP_RECTS = 24;
const MANUAL_EXPANDED_WIDTH = 620;
const CLOSE_UNLOCK_SUPPRESSION_MS = 900;

const ACTIVE_PANE_BORDER_COLOR =
  "rgba(156, 163, 175, 0.45)";
const ACTIVE_PANE_BORDER_WIDTH = 2;

const USER_DATA_PATH = path.join(
  app.getPath("appData"),
  "chatgpt-multi-window"
);

app.setPath("userData", USER_DATA_PATH);

const OVERLAY_TRANSPARENCY_CSS = `
  html,
  body,
  #root,
  #__next,
  body > div {
    background-color: transparent !important;
  }

  /*
   * The overlay window contains a complete ChatGPT page.
   * Hide its original conversation workspace while keeping
   * the official sidebar and portalled menus/dialogs visible.
   */
  main,
  main *,
  [role="main"],
  [role="main"] * {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  [role="dialog"],
  [role="dialog"] *,
  [aria-modal="true"],
  [aria-modal="true"] *,
  [role="menu"],
  [role="menu"] *,
  [role="listbox"],
  [role="listbox"] *,
  [role="tooltip"],
  [role="tooltip"] *,
  [popover]:popover-open,
  [popover]:popover-open *,
  [data-radix-popper-content-wrapper],
  [data-radix-popper-content-wrapper] *,
  [data-radix-dialog-content],
  [data-radix-dialog-content] *,
  [data-radix-menu-content],
  [data-radix-menu-content] *,
  [data-radix-dropdown-menu-content],
  [data-radix-dropdown-menu-content] *,
  [data-radix-select-content],
  [data-radix-select-content] *,
  [data-radix-popover-content],
  [data-radix-popover-content] * {
    visibility: visible !important;
    pointer-events: auto !important;
  }

  html.chatgpt-multi-fullscreen-overlay,
  html.chatgpt-multi-fullscreen-overlay body,
  html.chatgpt-multi-fullscreen-overlay #root,
  html.chatgpt-multi-fullscreen-overlay #__next,
  html.chatgpt-multi-fullscreen-overlay body > div {
    background-color: #000000 !important;
  }

  html.chatgpt-multi-fullscreen-overlay main,
  html.chatgpt-multi-fullscreen-overlay main *,
  html.chatgpt-multi-fullscreen-overlay [role="main"],
  html.chatgpt-multi-fullscreen-overlay [role="main"] * {
    visibility: visible !important;
    pointer-events: auto !important;
  }
`;
const PANE_CHROME_CSS = `
  #stage-slideover-sidebar,
  [data-testid="sidebar"],
  [data-testid="sidebar-container"],
  [data-testid="conversation-sidebar"],
  nav[aria-label="Chat history"],
  nav[aria-label*="聊天"],
  nav[aria-label*="對話"],
  aside:has(a[href^="/c/"]) {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    pointer-events: none !important;
  }

  html,
  body {
    --sidebar-width: 0px !important;
  }

  main,
  [role="main"] {
    margin-left: 0 !important;
    max-width: none !important;
  }

  button[aria-label*="Open sidebar"],
  button[aria-label*="Close sidebar"],
  button[aria-label*="open sidebar"],
  button[aria-label*="close sidebar"],
  button[aria-label*="Sidebar"],
  button[aria-label*="sidebar"],
  button[aria-label*="側邊欄"],
  button[aria-label*="開啟側邊欄"],
  button[aria-label*="關閉側邊欄"],
  button[data-testid*="sidebar"],
  button[data-testid*="Sidebar"],
  [data-testid="open-sidebar-button"],
  [data-testid="close-sidebar-button"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

let workspaceWindow = null;
let sidebarOverlayWindow = null;

const paneViews = [];
const pendingPaneUrls = [];
let activePaneIndex = 0;
let activeVisualUpdateSerial = 0;

let appConfig = {
  paneCount: DEFAULT_PANE_COUNT,
  paneUrls: []
};

let configSaveTimer = null;
let paneCountChangeInProgress = false;

let popupRects = [];
let lockedDialogRect = null;
let manualExpanded = false;
let suppressDialogLockUntil = 0;

let overlaySyncTimer = null;
let workspaceLayoutTimer = null;
let sidebarInitialLoadComplete = false;

let overlayOnlyUiActive = false;
let fullscreenOverlayMode = false;
let sidebarRouteForwardSuppressionUntil = 0;
let panesSuppressedForOverlay = false;

function getConfigPath() {
  return path.join(
    app.getPath("userData"),
    "multi-pane-layout-config.json"
  );
}

function normalizePaneCount(value) {
  const count = Number(value);

  if (
    Number.isInteger(count) &&
    ALLOWED_PANE_COUNTS.has(count)
  ) {
    return count;
  }

  return DEFAULT_PANE_COUNT;
}

function loadConfig() {
  try {
    const configPath = getConfigPath();

    if (!fs.existsSync(configPath)) {
      return {
        paneCount: DEFAULT_PANE_COUNT,
        paneUrls: []
      };
    }

    const parsed = JSON.parse(
      fs.readFileSync(
        configPath,
        "utf8"
      )
    );

    return {
      paneCount: normalizePaneCount(
        parsed?.paneCount
      ),
      paneUrls: Array.isArray(
        parsed?.paneUrls
      )
        ? parsed.paneUrls
            .slice(0, MAX_PANES)
            .map((url) =>
              typeof url === "string" &&
              isChatGPTUrl(url)
                ? url
                : CHATGPT_URL
            )
        : []
    };
  } catch (error) {
    console.error(
      "[Integration v4.5.1] config load failed:",
      error.message
    );

    return {
      paneCount: DEFAULT_PANE_COUNT,
      paneUrls: []
    };
  }
}

function saveConfigNow() {
  try {
    fs.writeFileSync(
      getConfigPath(),
      JSON.stringify(
        {
          paneCount:
            appConfig.paneCount,
          paneUrls:
            appConfig.paneUrls
              .slice(0, MAX_PANES)
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "[Integration v4.5.1] config save failed:",
      error.message
    );
  }
}

function saveConfigDebounced() {
  if (configSaveTimer) {
    clearTimeout(configSaveTimer);
  }

  configSaveTimer = setTimeout(() => {
    configSaveTimer = null;
    saveConfigNow();
  }, 250);
}

function getPaneStartUrl(index) {
  const savedUrl =
    appConfig.paneUrls[index];

  return (
    typeof savedUrl === "string" &&
    isChatGPTUrl(savedUrl)
  )
    ? savedUrl
    : CHATGPT_URL;
}

function updatePaneUrl(index, url) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= MAX_PANES ||
    !isChatGPTUrl(url)
  ) {
    return;
  }

  if (
    appConfig.paneUrls[index] ===
    url
  ) {
    return;
  }

  appConfig.paneUrls[index] = url;
  saveConfigDebounced();
}

function saveOpenPaneUrls() {
  for (
    let index = 0;
    index < paneViews.length;
    index += 1
  ) {
    const view = paneViews[index];

    if (!isUsableView(view)) {
      continue;
    }

    updatePaneUrl(
      index,
      view.webContents.getURL()
    );
  }
}

function isUsableWindow(window) {
  return Boolean(window && !window.isDestroyed());
}

function isUsableView(view) {
  return Boolean(
    view &&
    view.webContents &&
    !view.webContents.isDestroyed()
  );
}

function isChatGPTUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

function isConversationUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "chatgpt.com" &&
      /^\/c\/[^/]+/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isExternalAccountRouteUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return false;
    }

    const pathName =
      parsed.pathname.toLowerCase();

    const externalPrefixes = [
      "/upgrade",
      "/pricing",
      "/plans",
      "/plan",
      "/subscription",
      "/subscriptions",
      "/billing",
      "/checkout",
      "/purchase"
    ];

    return externalPrefixes.some(
      (prefix) =>
        pathName === prefix ||
        pathName.startsWith(
          `${prefix}/`
        )
    );
  } catch {
    return false;
  }
}

function isOverlayOnlyRouteUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return false;
    }

    const routeText = [
      parsed.pathname,
      parsed.search,
      parsed.hash
    ]
      .join(" ")
      .toLowerCase();

    const overlayOnlyTokens = [
      "/settings",
      "settings",
      "/search",
      "search-conversations",
      "search_chats",
      "search-chats",
      "preferences"
    ];

    return overlayOnlyTokens.some(
      (token) =>
        routeText.includes(token)
    );
  } catch {
    return false;
  }
}

function isWorkspaceRouteUrl(url) {
  try {
    if (
      isExternalAccountRouteUrl(url) ||
      isOverlayOnlyRouteUrl(url)
    ) {
      return false;
    }

    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return false;
    }

    const blockedPrefixes = [
      "/backend-api/",
      "/api/",
      "/assets/",
      "/cdn-cgi/",
      "/auth/",
      "/login",
      "/logout"
    ];

    return !blockedPrefixes.some((prefix) =>
      parsed.pathname.startsWith(prefix)
    );
  } catch {
    return false;
  }
}

function getWorkspaceContentSize() {
  if (!isUsableWindow(workspaceWindow)) {
    return {
      width: 1400,
      height: 900
    };
  }

  const bounds = workspaceWindow.getContentBounds();

  return {
    width: Math.max(900, bounds.width),
    height: Math.max(600, bounds.height)
  };
}

function getPaneGrid(count) {
  switch (count) {
    case 1:
      return {
        columns: 1,
        rows: 1
      };

    case 2:
      return {
        columns: 2,
        rows: 1
      };

    case 3:
      return {
        columns: 3,
        rows: 1
      };

    case 4:
      return {
        columns: 2,
        rows: 2
      };

    case 6:
      return {
        columns: 3,
        rows: 2
      };

    default:
      return {
        columns: 2,
        rows: 1
      };
  }
}

function getPaneBounds(index) {
  const content =
    getWorkspaceContentSize();

  const count =
    normalizePaneCount(
      appConfig.paneCount
    );

  const availableWidth = Math.max(
    400,
    content.width - SIDEBAR_WIDTH
  );

  const {
    columns,
    rows
  } = getPaneGrid(count);

  const column =
    index % columns;

  const row =
    Math.floor(index / columns);

  const left = Math.floor(
    availableWidth *
    column /
    columns
  );

  const right = Math.floor(
    availableWidth *
    (column + 1) /
    columns
  );

  const top = Math.floor(
    content.height *
    row /
    rows
  );

  const bottom = Math.floor(
    content.height *
    (row + 1) /
    rows
  );

  return {
    x: SIDEBAR_WIDTH + left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function layoutPaneViews() {
  for (let index = 0; index < paneViews.length; index += 1) {
    const view = paneViews[index];

    if (!isUsableView(view)) {
      continue;
    }

    if (panesSuppressedForOverlay) {
      view.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });

      continue;
    }

    view.setBounds(getPaneBounds(index));
  }
}

function updatePaneSuppression() {
  const shouldSuppress =
    overlayOnlyUiActive ||
    fullscreenOverlayMode;

  if (
    panesSuppressedForOverlay ===
    shouldSuppress
  ) {
    return;
  }

  panesSuppressedForOverlay =
    shouldSuppress;

  layoutPaneViews();
}

function scheduleWorkspaceLayout() {
  if (workspaceLayoutTimer) {
    clearTimeout(workspaceLayoutTimer);
  }

  workspaceLayoutTimer = setTimeout(() => {
    workspaceLayoutTimer = null;
    layoutPaneViews();
    scheduleOverlaySync();
  }, 30);
}

function getPaneUiInstallerScript() {
  return `
    (() => {
      const STYLE_ID =
        "chatgpt-multi-pane-chrome-style";

      let style =
        document.getElementById(STYLE_ID);

      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ${JSON.stringify(PANE_CHROME_CSS)};
        document.documentElement.appendChild(style);
      }

      const sidebarSelectors = [
        "#stage-slideover-sidebar",
        '[data-testid="sidebar"]',
        '[data-testid="sidebar-container"]',
        '[data-testid="conversation-sidebar"]',
        'nav[aria-label="Chat history"]',
        'nav[aria-label*="聊天"]',
        'nav[aria-label*="對話"]',
        'aside:has(a[href^="/c/"])'
      ];

      const buttonSelectors = [
        'button[aria-label*="Open sidebar"]',
        'button[aria-label*="Close sidebar"]',
        'button[aria-label*="open sidebar"]',
        'button[aria-label*="close sidebar"]',
        'button[aria-label*="Sidebar"]',
        'button[aria-label*="sidebar"]',
        'button[aria-label*="側邊欄"]',
        'button[aria-label*="開啟側邊欄"]',
        'button[aria-label*="關閉側邊欄"]',
        'button[data-testid*="sidebar"]',
        'button[data-testid*="Sidebar"]',
        '[data-testid="open-sidebar-button"]',
        '[data-testid="close-sidebar-button"]'
      ];

      const hideElement = (element) => {
        element.style.setProperty(
          "display",
          "none",
          "important"
        );

        element.style.setProperty(
          "visibility",
          "hidden",
          "important"
        );

        element.style.setProperty(
          "opacity",
          "0",
          "important"
        );

        element.style.setProperty(
          "pointer-events",
          "none",
          "important"
        );
      };

      const hidePaneChrome = () => {
        for (const selector of [
          ...sidebarSelectors,
          ...buttonSelectors
        ]) {
          try {
            document
              .querySelectorAll(selector)
              .forEach(hideElement);
          } catch {
            // Ignore selectors temporarily unsupported
            // by the current page state.
          }
        }
      };

      hidePaneChrome();

      if (!window.__chatgptMultiPaneChromeObserver) {
        window.__chatgptMultiPaneChromeObserver =
          new MutationObserver(() => {
            hidePaneChrome();
          });

        window.__chatgptMultiPaneChromeObserver.observe(
          document.documentElement,
          {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
              "class",
              "style",
              "hidden",
              "aria-label",
              "data-testid"
            ]
          }
        );
      }

      return true;
    })();
  `;
}

async function installPaneUi(view) {
  if (!isUsableView(view)) {
    return;
  }

  try {
    await view.webContents.executeJavaScript(
      getPaneUiInstallerScript(),
      true
    );
  } catch (error) {
    console.error(
      "[Integration v4.5.1] pane UI injection failed:",
      error.message
    );
  }
}

function getActivePaneVisualScript(active) {
  return `
    (() => {
      const OVERLAY_ID =
        "chatgpt-multi-active-pane-overlay";

      const existing =
        document.getElementById(OVERLAY_ID);

      if (existing) {
        existing.remove();
      }

      if (!${active ? "true" : "false"}) {
        return true;
      }

      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.border =
        "${ACTIVE_PANE_BORDER_WIDTH}px solid " +
        "${ACTIVE_PANE_BORDER_COLOR}";
      overlay.style.boxSizing = "border-box";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483647";

      document.documentElement.appendChild(overlay);

      return true;
    })();
  `;
}

async function refreshActivePaneVisuals() {
  const serial = ++activeVisualUpdateSerial;
  const targetIndex = activePaneIndex;

  for (let index = 0; index < paneViews.length; index += 1) {
    const view = paneViews[index];

    if (!isUsableView(view)) {
      continue;
    }

    try {
      await view.webContents.executeJavaScript(
        getActivePaneVisualScript(false),
        true
      );
    } catch {
      // A pane may still be navigating.
    }
  }

  if (serial !== activeVisualUpdateSerial) {
    return;
  }

  const activeView = paneViews[targetIndex];

  if (isUsableView(activeView)) {
    try {
      await activeView.webContents.executeJavaScript(
        getActivePaneVisualScript(true),
        true
      );
    } catch {
      // The border will be restored after did-finish-load.
    }
  }

  if (isUsableWindow(workspaceWindow)) {
    workspaceWindow.setTitle(
      `ChatGPT Multi Pane v4.5.1 — Active ${targetIndex + 1}/${appConfig.paneCount}`
    );
  }
}

function setActivePane(index) {
  const maximumIndex = Math.max(
    0,
    appConfig.paneCount - 1
  );

  const nextIndex = Math.max(
    0,
    Math.min(index, maximumIndex)
  );

  activePaneIndex = nextIndex;

  console.log(
    `[Integration v4.5.1] active pane=${activePaneIndex + 1}`
  );

  refreshActivePaneVisuals();
}

function getActivePaneView() {
  return paneViews[activePaneIndex] || null;
}

function loadUrlInActivePane(url) {
  if (!isWorkspaceRouteUrl(url)) {
    return;
  }

  const paneIndex = activePaneIndex;
  const activeView = getActivePaneView();

  if (!isUsableView(activeView)) {
    return;
  }

  const currentUrl =
    activeView.webContents.getURL();

  if (
    currentUrl === url ||
    pendingPaneUrls[paneIndex] === url
  ) {
    refreshActivePaneVisuals();
    return;
  }

  console.log(
    `[Integration v4.5.1] load pane=${paneIndex + 1} url=${url}`
  );

  updatePaneUrl(
    paneIndex,
    url
  );

  pendingPaneUrls[paneIndex] = url;

  activeView.webContents
    .loadURL(url)
    .catch((error) => {
      console.error(
        "[Integration v4.5.1] pane navigation failed:",
        error.message
      );
    })
    .finally(() => {
      if (
        pendingPaneUrls[paneIndex] === url
      ) {
        pendingPaneUrls[paneIndex] = null;
      }
    });

  refreshActivePaneVisuals();
}

function completeOverlayConversationSelection(url) {
  if (
    !isConversationUrl(url) ||
    !isWorkspaceRouteUrl(url)
  ) {
    return false;
  }

  console.log(
    "[Integration v4.5.1] completing search selection:",
    url
  );

  /*
   * Load the selected conversation into the active pane,
   * then immediately restore all pane bounds.
   */
  loadUrlInActivePane(url);

  popupRects = [];
  lockedDialogRect = null;
  overlayOnlyUiActive = false;
  fullscreenOverlayMode = false;
  sidebarRouteForwardSuppressionUntil = 0;

  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  /*
   * A short guard absorbs the overlay page's own navigation
   * event without making normal sidebar links feel delayed.
   */
  sidebarRouteForwardSuppressionUntil =
    Date.now() + 350;

  sendFullscreenOverlayClass(false);
  updatePaneSuppression();
  applyOverlayShape();

  return true;
}

function shouldSuppressSidebarRouteForwarding() {
  return (
    overlayOnlyUiActive ||
    Boolean(lockedDialogRect) ||
    Date.now() <
      sidebarRouteForwardSuppressionUntil
  );
}

function handleSidebarNavigation(url) {
  if (!sidebarInitialLoadComplete) {
    return;
  }

  if (isExternalAccountRouteUrl(url)) {
    openFullscreenAccountRoute(url);
    return;
  }

  if (isOverlayOnlyRouteUrl(url)) {
    setOverlayOnlyUiActive(true);
    return;
  }

  /*
   * Selecting a conversation from Search navigates the
   * overlay page to /c/... while panes are suppressed.
   * Treat that navigation as a completed selection.
   */
  if (
    overlayOnlyUiActive &&
    completeOverlayConversationSelection(url)
  ) {
    return;
  }

  if (shouldSuppressSidebarRouteForwarding()) {
    console.log(
      "[Integration v4.5.1] suppressed sidebar route:",
      url
    );

    return;
  }

  if (isWorkspaceRouteUrl(url)) {
    loadUrlInActivePane(url);
  }
}

function setOverlayOnlyUiActive(active) {
  overlayOnlyUiActive = Boolean(active);

  if (overlayOnlyUiActive) {
    sidebarRouteForwardSuppressionUntil =
      Date.now() + 5000;
  } else {
    /*
     * Do not leave normal sidebar links blocked for the
     * remainder of the old five-second overlay guard.
     */
    sidebarRouteForwardSuppressionUntil = 0;
  }

  updatePaneSuppression();
}

function sendFullscreenOverlayClass(enabled) {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  sidebarOverlayWindow.webContents.send(
    "chatgpt-sidebar-set-fullscreen-mode",
    Boolean(enabled)
  );
}

function setFullscreenOverlayMode(enabled) {
  fullscreenOverlayMode = Boolean(enabled);

  if (fullscreenOverlayMode) {
    sidebarRouteForwardSuppressionUntil =
      Date.now() + 10000;
  }

  sendFullscreenOverlayClass(
    fullscreenOverlayMode
  );

  updatePaneSuppression();
  applyOverlayShape();
}

function closeFullscreenOverlayMode() {
  setFullscreenOverlayMode(false);

  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  const currentUrl =
    sidebarOverlayWindow.webContents.getURL();

  if (isExternalAccountRouteUrl(currentUrl)) {
    sidebarInitialLoadComplete = false;

    sidebarOverlayWindow.loadURL(
      CHATGPT_URL
    );
  }
}

function openFullscreenAccountRoute(url) {
  if (!isExternalAccountRouteUrl(url)) {
    return;
  }

  setFullscreenOverlayMode(true);

  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  const currentUrl =
    sidebarOverlayWindow.webContents.getURL();

  if (currentUrl !== url) {
    sidebarOverlayWindow.loadURL(url);
  }
}

function dismissSidebarTransientUi() {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  /*
   * Collapse the shaped overlay immediately so a sidebar
   * popover does not remain visible above the selected pane.
   */
  popupRects = [];
  lockedDialogRect = null;

  overlayOnlyUiActive = false;
  fullscreenOverlayMode = false;

  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  sendFullscreenOverlayClass(false);
  updatePaneSuppression();
  applyOverlayShape();

  /*
   * Also send a real Escape key to close Radix menus,
   * search dialogs and settings dialogs in the overlay DOM.
   */
  try {
    sidebarOverlayWindow.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "ESCAPE"
    });

    sidebarOverlayWindow.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "ESCAPE"
    });
  } catch (error) {
    console.error(
      "[Integration v4.5.1] dismiss input failed:",
      error.message
    );
  }

  setTimeout(() => {
    popupRects = [];
    lockedDialogRect = null;
    applyOverlayShape();
  }, 80);
}

function attachPaneEvents(view, index) {
  view.webContents.on("focus", () => {
    setActivePane(index);
    dismissSidebarTransientUi();
  });

  view.webContents.on("did-finish-load", () => {
    updatePaneUrl(
      index,
      view.webContents.getURL()
    );

    installPaneUi(view);
    refreshActivePaneVisuals();
  });

  view.webContents.on(
    "did-navigate",
    (_event, url) => {
      pendingPaneUrls[index] = null;
      pendingPaneUrls[index] = null;
      updatePaneUrl(index, url);
      installPaneUi(view);
      refreshActivePaneVisuals();
    }
  );

  view.webContents.on(
    "did-navigate-in-page",
    (_event, url, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      updatePaneUrl(index, url);
      installPaneUi(view);
      refreshActivePaneVisuals();
    }
  );

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isChatGPTUrl(url)) {
      view.webContents.loadURL(url);
    } else {
      shell.openExternal(url).catch((error) => {
        console.error(
          "[Integration v4.5.1] external link failed:",
          error.message
        );
      });
    }

    return {
      action: "deny"
    };
  });
}

function createPaneView(index) {
  if (!isUsableWindow(workspaceWindow)) {
    return null;
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: CHATGPT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  attachPaneEvents(view, index);

  workspaceWindow.contentView.addChildView(view);
  paneViews[index] = view;

  view.setBounds(getPaneBounds(index));
  view.webContents.loadURL(
    getPaneStartUrl(index)
  );

  return view;
}

function createPaneViews() {
  const count =
    normalizePaneCount(
      appConfig.paneCount
    );

  appConfig.paneCount = count;

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    createPaneView(index);
  }

  setActivePane(
    Math.min(
      activePaneIndex,
      count - 1
    )
  );

  layoutPaneViews();
}

function destroyPaneView(index) {
  const view = paneViews[index];

  if (!isUsableView(view)) {
    paneViews[index] = null;
    return;
  }

  updatePaneUrl(
    index,
    view.webContents.getURL()
  );

  try {
    workspaceWindow
      ?.contentView
      .removeChildView(view);
  } catch {
    // Ignore if already detached.
  }

  try {
    view.webContents.close();
  } catch {
    // Ignore shutdown races.
  }

  paneViews[index] = null;
}

function setPaneCount(targetCount) {
  if (paneCountChangeInProgress) {
    return;
  }

  const nextCount =
    normalizePaneCount(targetCount);

  const currentCount =
    paneViews.length;

  if (
    nextCount ===
    appConfig.paneCount &&
    currentCount === nextCount
  ) {
    layoutPaneViews();
    refreshActivePaneVisuals();
    return;
  }

  paneCountChangeInProgress = true;

  try {
    dismissSidebarTransientUi();
    saveOpenPaneUrls();

    /*
     * getPaneBounds() uses appConfig.paneCount,
     * so update it before creating new panes.
     */
    appConfig.paneCount = nextCount;

    if (nextCount < currentCount) {
      for (
        let index =
          currentCount - 1;
        index >= nextCount;
        index -= 1
      ) {
        destroyPaneView(index);
      }

      paneViews.length =
        nextCount;
    } else if (
      nextCount > currentCount
    ) {
      for (
        let index = currentCount;
        index < nextCount;
        index += 1
      ) {
        createPaneView(index);
      }
    }

    if (
      activePaneIndex >=
      nextCount
    ) {
      activePaneIndex =
        nextCount - 1;
    }

    saveConfigNow();
    layoutPaneViews();
    refreshActivePaneVisuals();

    console.log(
      `[Integration v4.5.1] pane count=${nextCount}`
    );
  } finally {
    setTimeout(() => {
      paneCountChangeInProgress = false;
    }, 150);
  }
}

function destroyPaneViews() {
  saveOpenPaneUrls();

  for (
    let index =
      paneViews.length - 1;
    index >= 0;
    index -= 1
  ) {
    destroyPaneView(index);
  }

  paneViews.length = 0;
}

function sanitizeRect(rect, windowBounds) {
  if (!rect || typeof rect !== "object") {
    return null;
  }

  const sourceX = Number(rect.x);
  const sourceY = Number(rect.y);
  const sourceWidth = Number(rect.width);
  const sourceHeight = Number(rect.height);

  if (
    !Number.isFinite(sourceX) ||
    !Number.isFinite(sourceY) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight)
  ) {
    return null;
  }

  const x = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(sourceX)
  );

  const y = Math.max(
    0,
    Math.floor(sourceY)
  );

  const right = Math.min(
    windowBounds.width,
    x + Math.max(0, Math.ceil(sourceWidth))
  );

  const bottom = Math.min(
    windowBounds.height,
    y + Math.max(0, Math.ceil(sourceHeight))
  );

  const width = right - x;
  const height = bottom - y;

  if (width < 4 || height < 4) {
    return null;
  }

  return {
    x,
    y,
    width,
    height
  };
}


function rectAreaRatio(rect, windowBounds) {
  if (!rect || !windowBounds) {
    return 1;
  }

  const windowArea =
    Math.max(1, windowBounds.width * windowBounds.height);

  return (
    Math.max(0, rect.width) *
    Math.max(0, rect.height)
  ) / windowArea;
}

function sanitizeDialogRect(
  rect,
  windowBounds
) {
  const sanitized =
    sanitizeRect(rect, windowBounds);

  if (!sanitized) {
    return null;
  }

  const widthRatio =
    sanitized.width /
    Math.max(1, windowBounds.width);

  const heightRatio =
    sanitized.height /
    Math.max(1, windowBounds.height);

  const areaRatio =
    rectAreaRatio(
      sanitized,
      windowBounds
    );

  /*
   * ChatGPT 的 modal 外層有時是接近全螢幕的
   * wrapper/backdrop。這些不能交給 setShape，
   * 否則會把 overlay 視窗背後的原始對話一起露出。
   */
  if (
    widthRatio >= 0.88 ||
    heightRatio >= 0.88 ||
    areaRatio >= 0.72
  ) {
    console.log(
      "[Integration v4.5.1] rejected oversized dialog rect:",
      {
        sanitized,
        widthRatio,
        heightRatio,
        areaRatio
      }
    );

    return null;
  }

  return sanitized;
}

function sanitizePopupRect(
  rect,
  windowBounds
) {
  const sanitized =
    sanitizeRect(rect, windowBounds);

  if (!sanitized) {
    return null;
  }

  const widthRatio =
    sanitized.width /
    Math.max(1, windowBounds.width);

  const heightRatio =
    sanitized.height /
    Math.max(1, windowBounds.height);

  const areaRatio =
    rectAreaRatio(
      sanitized,
      windowBounds
    );

  /*
   * 小型選單不應接近整個畫面。
   * 若抓到大型 wrapper，直接排除。
   */
  if (
    widthRatio >= 0.72 ||
    heightRatio >= 0.72 ||
    areaRatio >= 0.36
  ) {
    return null;
  }

  return sanitized;
}

function applyOverlayShape() {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  if (
    typeof sidebarOverlayWindow.setShape !==
    "function"
  ) {
    console.error(
      "[Integration v4.5.1] BrowserWindow.setShape unavailable"
    );

    return;
  }

  const bounds =
    sidebarOverlayWindow.getBounds();

  let shapeRects;

  if (fullscreenOverlayMode) {
    shapeRects = [
      {
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      }
    ];
  } else if (manualExpanded) {
    shapeRects = [
      {
        x: 0,
        y: 0,
        width: Math.min(
          MANUAL_EXPANDED_WIDTH,
          bounds.width
        ),
        height: bounds.height
      }
    ];
  } else {
    const sanitizedPopupRects = popupRects
      .slice(0, MAX_POPUP_RECTS)
      .map((rect) =>
        sanitizePopupRect(
          rect,
          bounds
        )
      )
      .filter(Boolean);

    shapeRects = [
      {
        x: 0,
        y: 0,
        width: Math.min(
          SIDEBAR_WIDTH,
          bounds.width
        ),
        height: bounds.height
      }
    ];

    if (lockedDialogRect) {
      const sanitizedDialog =
        sanitizeDialogRect(
          lockedDialogRect,
          bounds
        );

      if (sanitizedDialog) {
        shapeRects.push(sanitizedDialog);
      }
    }

    shapeRects.push(...sanitizedPopupRects);
  }

  try {
    sidebarOverlayWindow.setShape(
      shapeRects
    );
  } catch (error) {
    console.error(
      "[Integration v4.5.1] setShape failed:",
      error.message
    );
  }
}

function setManualExpanded(expanded) {
  manualExpanded = Boolean(expanded);
  applyOverlayShape();
}

function unlockDialogShape() {
  lockedDialogRect = null;
  overlayOnlyUiActive = false;
  sidebarRouteForwardSuppressionUntil = 0;

  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  popupRects = [];

  updatePaneSuppression();
  applyOverlayShape();

  console.log(
    "[Integration v4.5.1] dialog shape unlocked"
  );
}

function syncOverlayBounds() {
  if (
    !isUsableWindow(workspaceWindow) ||
    !isUsableWindow(sidebarOverlayWindow)
  ) {
    return;
  }

  const contentBounds =
    workspaceWindow.getContentBounds();

  sidebarOverlayWindow.setBounds(
    {
      x: contentBounds.x,
      y: contentBounds.y,
      width: contentBounds.width,
      height: contentBounds.height
    },
    false
  );

  applyOverlayShape();
}

function scheduleOverlaySync() {
  if (overlaySyncTimer) {
    clearTimeout(overlaySyncTimer);
  }

  overlaySyncTimer = setTimeout(() => {
    overlaySyncTimer = null;
    syncOverlayBounds();
  }, 30);
}

function createSidebarOverlayWindow() {
  if (!isUsableWindow(workspaceWindow)) {
    return;
  }

  const contentBounds =
    workspaceWindow.getContentBounds();

  sidebarOverlayWindow = new BrowserWindow({
    parent: workspaceWindow,
    modal: false,

    x: contentBounds.x,
    y: contentBounds.y,
    width: contentBounds.width,
    height: contentBounds.height,

    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,

    show: false,
    skipTaskbar: true,

    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,

    focusable: true,
    autoHideMenuBar: true,

    webPreferences: {
      partition: CHATGPT_PARTITION,

      preload: path.join(
        __dirname,
        "sidebar-shape-preload-v4.5.1.js"
      ),

      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  sidebarOverlayWindow.webContents.on(
    "will-navigate",
    (event, url) => {
      if (!isExternalAccountRouteUrl(url)) {
        return;
      }

      event.preventDefault();
      openFullscreenAccountRoute(url);
    }
  );

  sidebarOverlayWindow.webContents.on(
    "did-start-navigation",
    () => {
      /*
       * ChatGPT settings tabs can use same-document
       * navigation. Never clear lockedDialogRect here.
       */
      popupRects = [];
      applyOverlayShape();
    }
  );

  sidebarOverlayWindow.webContents.on(
    "did-finish-load",
    async () => {
      popupRects = [];
      manualExpanded = false;

      if (!lockedDialogRect) {
        suppressDialogLockUntil = 0;
      }

      try {
        await sidebarOverlayWindow
          .webContents
          .insertCSS(
            OVERLAY_TRANSPARENCY_CSS
          );
      } catch (error) {
        console.error(
          "[Integration v4.5.1] transparency CSS failed:",
          error.message
        );
      }

      syncOverlayBounds();
      sidebarOverlayWindow.show();

      sendFullscreenOverlayClass(
        fullscreenOverlayMode
      );

      sidebarInitialLoadComplete = true;

      console.log(
        "[Integration v4.5.1] ChatGPT sidebar overlay loaded"
      );
    }
  );

  sidebarOverlayWindow.webContents.on(
    "did-navigate",
    (_event, url) => {
      handleSidebarNavigation(url);
    }
  );

  sidebarOverlayWindow.webContents.on(
    "did-navigate-in-page",
    (_event, url, isMainFrame) => {
      if (isMainFrame) {
        handleSidebarNavigation(url);
      }
    }
  );

  sidebarOverlayWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (isExternalAccountRouteUrl(url)) {
        openFullscreenAccountRoute(url);
      } else if (
        isOverlayOnlyRouteUrl(url)
      ) {
        setOverlayOnlyUiActive(true);
      } else if (
        !shouldSuppressSidebarRouteForwarding() &&
        isWorkspaceRouteUrl(url)
      ) {
        loadUrlInActivePane(url);
      } else if (!isChatGPTUrl(url)) {
        shell.openExternal(url).catch((error) => {
          console.error(
            "[Integration v4.5.1] sidebar external link failed:",
            error.message
          );
        });
      }

      return {
        action: "deny"
      };
    }
  );

  sidebarOverlayWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(
        "[Integration v4.5.1] sidebar renderer stopped:",
        details
      );
    }
  );

  sidebarOverlayWindow.on("closed", () => {
    sidebarOverlayWindow = null;
  });

  sidebarOverlayWindow.loadURL(CHATGPT_URL);
}

function createWorkspaceWindow() {
  workspaceWindow = new BrowserWindow({
    width: 1400,
    height: 900,

    minWidth: 1000,
    minHeight: 650,

    show: false,
    title:
      `ChatGPT Multi Pane v4.5.1 — Active 1/${appConfig.paneCount}`,
    backgroundColor: "#111111",

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  workspaceWindow.loadURL("about:blank");

  workspaceWindow.once(
    "ready-to-show",
    () => {
      workspaceWindow.maximize();
      workspaceWindow.show();

      createPaneViews();
      createSidebarOverlayWindow();

      scheduleWorkspaceLayout();
    }
  );

  workspaceWindow.on(
    "move",
    scheduleOverlaySync
  );

  workspaceWindow.on(
    "resize",
    scheduleWorkspaceLayout
  );

  workspaceWindow.on(
    "maximize",
    scheduleWorkspaceLayout
  );

  workspaceWindow.on(
    "unmaximize",
    scheduleWorkspaceLayout
  );

  workspaceWindow.on("focus", () => {
    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.moveTop();
    }
  });

  workspaceWindow.on("restore", () => {
    scheduleWorkspaceLayout();

    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.showInactive();
    }
  });

  workspaceWindow.on("minimize", () => {
    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.hide();
    }
  });

  workspaceWindow.on("closed", () => {
    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.destroy();
    }

    sidebarOverlayWindow = null;

    destroyPaneViews();
    workspaceWindow = null;
  });
}

function registerShortcut(
  accelerator,
  callback,
  label
) {
  try {
    const registered =
      globalShortcut.register(
        accelerator,
        callback
      );

    console.log(
      `[Integration v4.5.1] shortcut ${label}: ` +
      `${accelerator}, registered=${registered}`
    );
  } catch (error) {
    console.error(
      `[Integration v4.5.1] shortcut ${label} failed:`,
      error.message
    );
  }
}

function registerShortcuts() {
  registerShortcut(
    "CommandOrControl+Alt+1",
    () => setPaneCount(1),
    "layout-1"
  );

  registerShortcut(
    "CommandOrControl+Alt+2",
    () => setPaneCount(2),
    "layout-2"
  );

  registerShortcut(
    "CommandOrControl+Alt+3",
    () => setPaneCount(3),
    "layout-3"
  );

  registerShortcut(
    "CommandOrControl+Alt+4",
    () => setPaneCount(4),
    "layout-4"
  );

  registerShortcut(
    "CommandOrControl+Alt+6",
    () => setPaneCount(6),
    "layout-6"
  );

  registerShortcut(
    "CommandOrControl+Alt+Left",
    () => setActivePane(
      activePaneIndex - 1
    ),
    "active-left"
  );

  registerShortcut(
    "CommandOrControl+Alt+Right",
    () => setActivePane(
      activePaneIndex + 1
    ),
    "active-right"
  );

  registerShortcut(
    "F8",
    () => setManualExpanded(true),
    "force-expanded"
  );

  registerShortcut(
    "F7",
    () => setManualExpanded(false),
    "automatic-shape"
  );

  registerShortcut(
    "F6",
    unlockDialogShape,
    "force-unlock-dialog"
  );

  registerShortcut(
    "F5",
    closeFullscreenOverlayMode,
    "force-close-fullscreen-overlay"
  );

  registerShortcut(
    "CommandOrControl+Alt+Q",
    () => app.quit(),
    "quit"
  );
}

ipcMain.on(
  "chatgpt-sidebar-shape-state",
  (event, state) => {
    if (!isUsableWindow(sidebarOverlayWindow)) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    const bounds =
      sidebarOverlayWindow.getBounds();

    const nextDialogRect =
      sanitizeDialogRect(
        state?.dialogRect,
        bounds
      );

    popupRects = Array.isArray(
      state?.popupRects
    )
      ? state.popupRects.slice(
          0,
          MAX_POPUP_RECTS
        )
      : [];

    if (
      !lockedDialogRect &&
      nextDialogRect &&
      Date.now() >=
        suppressDialogLockUntil
    ) {
      lockedDialogRect =
        nextDialogRect;

      if (!fullscreenOverlayMode) {
        setOverlayOnlyUiActive(true);
      }

      console.log(
        "[Integration v4.5.1] dialog shape locked:",
        lockedDialogRect
      );
    }

    if (!manualExpanded) {
      applyOverlayShape();
    }
  }
);

ipcMain.on(
  "chatgpt-sidebar-dialog-close-intent",
  (event) => {
    if (!isUsableWindow(sidebarOverlayWindow)) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    unlockDialogShape();

    if (fullscreenOverlayMode) {
      setTimeout(() => {
        closeFullscreenOverlayMode();
      }, 120);
    }
  }
);

ipcMain.on(
  "chatgpt-sidebar-route-intent",
  (event, url) => {
    if (!isUsableWindow(sidebarOverlayWindow)) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    if (isExternalAccountRouteUrl(url)) {
      openFullscreenAccountRoute(url);
      return;
    }

    if (isOverlayOnlyRouteUrl(url)) {
      setOverlayOnlyUiActive(true);
      return;
    }

    if (
      overlayOnlyUiActive &&
      completeOverlayConversationSelection(url)
    ) {
      return;
    }

    if (
      !shouldSuppressSidebarRouteForwarding() &&
      isWorkspaceRouteUrl(url)
    ) {
      loadUrlInActivePane(url);
    }
  }
);

ipcMain.on(
  "chatgpt-sidebar-external-route-intent",
  (event, url) => {
    if (!isUsableWindow(sidebarOverlayWindow)) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    openFullscreenAccountRoute(url);
  }
);

ipcMain.on(
  "chatgpt-sidebar-overlay-only-intent",
  (event) => {
    if (
      !isUsableWindow(
        sidebarOverlayWindow
      ) ||
      event.sender.id !==
        sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    setOverlayOnlyUiActive(true);
  }
);

ipcMain.on(
  "chatgpt-sidebar-fullscreen-overlay-intent",
  (event, enabled) => {
    if (
      !isUsableWindow(
        sidebarOverlayWindow
      ) ||
      event.sender.id !==
        sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    if (enabled === false) {
      setTimeout(() => {
        closeFullscreenOverlayMode();
      }, 120);

      return;
    }

    setFullscreenOverlayMode(true);
  }
);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  appConfig = loadConfig();

  console.log(
    "[Integration v4.5.1] Electron:",
    process.versions.electron
  );

  console.log(
    "[Integration v4.5.1] userData:",
    app.getPath("userData")
  );

  console.log(
    "[Integration v4.5.1] restored pane count:",
    appConfig.paneCount
  );

  registerShortcuts();
  createWorkspaceWindow();
});

app.on("will-quit", () => {
  saveOpenPaneUrls();
  saveConfigNow();

  if (configSaveTimer) {
    clearTimeout(configSaveTimer);
    configSaveTimer = null;
  }

  if (overlaySyncTimer) {
    clearTimeout(overlaySyncTimer);
    overlaySyncTimer = null;
  }

  if (workspaceLayoutTimer) {
    clearTimeout(workspaceLayoutTimer);
    workspaceLayoutTimer = null;
  }

  globalShortcut.unregisterAll();

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-shape-state"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-dialog-close-intent"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-route-intent"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-external-route-intent"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-overlay-only-intent"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-fullscreen-overlay-intent"
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
