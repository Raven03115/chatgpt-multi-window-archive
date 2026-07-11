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

const {
  PROJECT_ACTION_INTENT_MAX_AGE_MS,
  classifyRoute,
  decideProjectActionCandidate,
  decideSidebarRouting
} = require("./lib/route-policy.cjs");
const {
  createDiagnosticsLogger
} = require("./lib/diagnostics.cjs");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 260;

const DEFAULT_PANE_COUNT = 1;
const ALLOWED_PANE_COUNTS = new Set([
  1,
  2,
  3,
  4,
  6
]);
const MAX_PANES = 6;
const PANE_LOAD_STAGGER_MS = 160;

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

const integrationDiagnostics =
  createDiagnosticsLogger({ app });

const OVERLAY_TRANSPARENCY_CSS = `
  html,
  body,
  #root,
  #__next,
  body > div {
    background-color: transparent !important;
  }

  /*
   * Hide only the conversation workspace root.
   *
   * Do not force every descendant to visibility:hidden. ChatGPT keeps
   * some closed select options mounted in the DOM, and those elements
   * must retain their own official visibility state.
   */
  main,
  [role="main"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  /*
   * Do not override visibility or pointer-events for dialogs, selects,
   * menus, listboxes or their descendants.
   *
   * ChatGPT controls those states itself. The shaped overlay window
   * already limits which screen regions are exposed, so forcing overlay
   * roots visible is unnecessary and can reveal stacked hidden labels.
   */

  html.chatgpt-multi-fullscreen-overlay,
  html.chatgpt-multi-fullscreen-overlay body,
  html.chatgpt-multi-fullscreen-overlay #root,
  html.chatgpt-multi-fullscreen-overlay #__next,
  html.chatgpt-multi-fullscreen-overlay body > div {
    background-color: #000000 !important;
  }

  html.chatgpt-multi-fullscreen-overlay main,
  html.chatgpt-multi-fullscreen-overlay [role="main"] {
    visibility: visible !important;
    pointer-events: auto !important;
  }
`;
const PANE_CHROME_CSS = `
  /*
   * Keep the static rules deliberately conservative.
   * ChatGPT occasionally changes wrapper test IDs; hiding a broad
   * wrapper can remove the entire conversation workspace.
   */
  #stage-slideover-sidebar,
  [data-testid="sidebar"],
  [data-testid="conversation-sidebar"],
  nav[aria-label="Chat history"] {
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
let activeVisualUpdateQueue = Promise.resolve();
let renderedActivePaneIndex = null;
let lastRefreshRequestAt = 0;
let lastClosePaneRequestAt = 0;
const refreshInputHandlerTargets = new WeakSet();
const closePaneInputHandlerTargets = new WeakSet();

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
let paneCloseNoticeTimer = null;
let paneCloseNoticeView = null;
let sidebarInitialLoadComplete = false;

let overlayOnlyUiActive = false;
let fullscreenOverlayMode = false;
let sidebarRouteForwardSuppressionUntil = 0;
let panesSuppressedForOverlay = false;
let lastAppliedOverlayShapeSignature = "";
let projectActionIntent = null;
let projectActionIntentGeneration = 0;
let projectActionIntentTimer = null;

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
      "[Integration v4.5.6] config load failed:",
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
      "[Integration v4.5.6] config save failed:",
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

function recordIntegrationEvent(event) {
  try {
    integrationDiagnostics.log(event);
  } catch {
    // Diagnostics must never interrupt application behavior.
  }
}

function getDiagnosticRouteKind(url) {
  return classifyRoute(url);
}

function getViewDiagnosticRouteKind(view) {
  if (!isUsableView(view)) {
    return "invalid";
  }

  try {
    return getDiagnosticRouteKind(
      view.webContents.getURL()
    );
  } catch {
    return "invalid";
  }
}

function clearProjectActionIntent(
  reason,
  expectedGeneration = null
) {
  if (
    !projectActionIntent ||
    (
      expectedGeneration !== null &&
      projectActionIntent.generation !== expectedGeneration
    )
  ) {
    return false;
  }

  const clearedIntent = projectActionIntent;
  projectActionIntent = null;

  if (projectActionIntentTimer) {
    clearTimeout(projectActionIntentTimer);
    projectActionIntentTimer = null;
  }

  recordIntegrationEvent({
    event: "project-intent-cleared",
    pane: clearedIntent.paneIndex + 1,
    routeKind: "project-workspace",
    source: "project-action-intent",
    action: "clear-project-intent",
    reason
  });

  return true;
}

function createProjectActionIntent() {
  clearProjectActionIntent("replaced-by-new-intent");

  sidebarRouteForwardSuppressionUntil = 0;

  projectActionIntentGeneration += 1;

  const generation = projectActionIntentGeneration;
  const paneIndex = activePaneIndex;

  projectActionIntent = {
    paneIndex,
    generation,
    createdAt: performance.now(),
    consumed: false
  };

  projectActionIntentTimer = setTimeout(() => {
    clearProjectActionIntent(
      "intent-timeout",
      generation
    );
  }, PROJECT_ACTION_INTENT_MAX_AGE_MS);

  recordIntegrationEvent({
    event: "project-intent-created",
    pane: paneIndex + 1,
    routeKind: "project-workspace",
    source: "project-action-intent",
    action: "create-project-intent",
    reason: "explicit-non-anchor-project-action"
  });
}

function consumeProjectActionIntent(routeKind) {
  if (!projectActionIntent) {
    return null;
  }

  const consumedIntent = {
    ...projectActionIntent,
    consumed: true
  };

  projectActionIntent = null;

  if (projectActionIntentTimer) {
    clearTimeout(projectActionIntentTimer);
    projectActionIntentTimer = null;
  }

  recordIntegrationEvent({
    event: "project-intent-consumed",
    pane: consumedIntent.paneIndex + 1,
    routeKind,
    source: "project-action-intent",
    action: "consume-project-intent",
    reason: "matching-native-project-route"
  });

  return consumedIntent;
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
      /(?:^|\/)c\/[^/]+/.test(parsed.pathname)
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
      const HIDDEN_MARKER =
        "data-chatgpt-multi-pane-hidden";
      const SCAN_DELAY_MS = 120;

      let style =
        document.getElementById(STYLE_ID);

      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ${JSON.stringify(PANE_CHROME_CSS)};
        document.documentElement.appendChild(style);
      }

      /*
       * These include fallback candidates, but a candidate is hidden
       * only when its geometry still looks like a left sidebar.
       */
      const sidebarSelectors = [
        "#stage-slideover-sidebar",
        '[data-testid="sidebar"]',
        '[data-testid="sidebar-container"]',
        '[data-testid="conversation-sidebar"]',
        'nav[aria-label="Chat history"]',
        'nav[aria-label*="聊天"]',
        'nav[aria-label*="對話"]',
        'aside:has(a[href^="/c/"])',
        'aside:has(a[href*="/c/"])'
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

      const candidateSelector = [
        ...sidebarSelectors,
        ...buttonSelectors
      ].join(",");

      const isSidebarLike = (element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const rect =
          element.getBoundingClientRect();

        const style =
          window.getComputedStyle(element);

        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width < 120 ||
          rect.height < 180
        ) {
          return false;
        }

        const maximumWidth = Math.min(
          430,
          window.innerWidth * 0.48
        );

        return (
          rect.left <= 20 &&
          rect.top <= 160 &&
          rect.width <= maximumWidth &&
          rect.height >=
            window.innerHeight * 0.45
        );
      };

      const hideElement = (element) => {
        if (!(element instanceof Element)) {
          return;
        }

        const alreadyHidden =
          element.getAttribute(HIDDEN_MARKER) === "true" &&
          element.style.getPropertyValue("display") === "none" &&
          element.style.getPropertyValue("visibility") === "hidden" &&
          element.style.getPropertyValue("opacity") === "0" &&
          element.style.getPropertyValue("pointer-events") === "none";

        if (alreadyHidden) {
          return;
        }

        element.setAttribute(
          HIDDEN_MARKER,
          "true"
        );

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
        for (const selector of sidebarSelectors) {
          try {
            document
              .querySelectorAll(selector)
              .forEach((element) => {
                if (isSidebarLike(element)) {
                  hideElement(element);
                }
              });
          } catch {
            // Ignore selectors temporarily unsupported
            // by the current page state.
          }
        }

        for (const selector of buttonSelectors) {
          try {
            document
              .querySelectorAll(selector)
              .forEach(hideElement);
          } catch {
            // Ignore transient DOM rebuilds.
          }
        }
      };

      const matchesPaneChrome = (node) => {
        if (!(node instanceof Element)) {
          return false;
        }

        try {
          return node.matches(candidateSelector);
        } catch {
          return false;
        }
      };

      const mayContainPaneChrome = (node) => {
        if (!(node instanceof Element)) {
          return false;
        }

        try {
          return (
            matchesPaneChrome(node) ||
            Boolean(node.querySelector(candidateSelector))
          );
        } catch {
          return false;
        }
      };

      hidePaneChrome();

      if (!window.__chatgptMultiPaneChromeObserver) {
        let scanTimer = null;

        const scheduleScan = () => {
          if (scanTimer) {
            clearTimeout(scanTimer);
          }

          scanTimer = setTimeout(() => {
            scanTimer = null;
            hidePaneChrome();
          }, SCAN_DELAY_MS);
        };

        window.__chatgptMultiPaneChromeObserver =
          new MutationObserver((records) => {
            const relevant = records.some((record) => {
              if (record.type === "attributes") {
                return matchesPaneChrome(record.target);
              }

              return [
                ...record.addedNodes
              ].some(mayContainPaneChrome);
            });

            if (relevant) {
              scheduleScan();
            }
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
      "[Integration v4.5.6] pane UI injection failed:",
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

async function setPaneActiveVisual(
  index,
  active
) {
  const view = paneViews[index];

  if (!isUsableView(view)) {
    return;
  }

  try {
    await view.webContents.executeJavaScript(
      getActivePaneVisualScript(active),
      true
    );
  } catch {
    // A pane may still be navigating.
  }
}

function refreshActivePaneVisuals() {
  const targetIndex = activePaneIndex;

  activeVisualUpdateQueue =
    activeVisualUpdateQueue
      .catch(() => {
        // Keep later visual updates running after a transient failure.
      })
      .then(async () => {
        const previousIndex =
          renderedActivePaneIndex;

        if (
          previousIndex !== null &&
          previousIndex !== targetIndex
        ) {
          await setPaneActiveVisual(
            previousIndex,
            false
          );
        }

        await setPaneActiveVisual(
          targetIndex,
          true
        );

        renderedActivePaneIndex =
          targetIndex;

        if (isUsableWindow(workspaceWindow)) {
          workspaceWindow.setTitle(
            `ChatGPT Multi Pane v4.5.6 — Active ${targetIndex + 1}/${appConfig.paneCount}`
          );
        }
      });

  return activeVisualUpdateQueue;
}

function syncPaneVisualAfterNavigation(index) {
  if (index === activePaneIndex) {
    refreshActivePaneVisuals();
  } else {
    setPaneActiveVisual(index, false);
  }
}

function setActivePane(index) {
  const previousActivePaneIndex = activePaneIndex;
  const maximumIndex = Math.max(
    0,
    appConfig.paneCount - 1
  );

  const nextIndex = Math.max(
    0,
    Math.min(index, maximumIndex)
  );

  activePaneIndex = nextIndex;

  if (activePaneIndex !== previousActivePaneIndex) {
    clearProjectActionIntent("active-pane-changed");

    recordIntegrationEvent({
      event: "active-pane-changed",
      pane: activePaneIndex + 1,
      source: "pane-selection",
      action: "selected",
      reason: "active-pane-request"
    });
  }

  console.log(
    `[Integration v4.5.6] active pane=${activePaneIndex + 1}`
  );

  refreshActivePaneVisuals();
}

function getActivePaneView() {
  return paneViews[activePaneIndex] || null;
}

function getPaneCloseNoticeScript(message) {
  const serializedMessage =
    JSON.stringify(message);

  return `
    (() => {
      const NOTICE_ID =
        "chatgpt-multi-pane-close-notice";

      let notice =
        document.getElementById(NOTICE_ID);

      if (!notice) {
        notice = document.createElement("div");
        notice.id = NOTICE_ID;
        notice.setAttribute("role", "status");
        notice.setAttribute("aria-live", "polite");
        notice.style.position = "fixed";
        notice.style.top = "24px";
        notice.style.left = "50%";
        notice.style.transform = "translateX(-50%)";
        notice.style.maxWidth = "calc(100vw - 48px)";
        notice.style.padding = "10px 16px";
        notice.style.border =
          "1px solid rgba(255, 255, 255, 0.16)";
        notice.style.borderRadius = "10px";
        notice.style.background =
          "rgba(153, 27, 27, 0.96)";
        notice.style.color = "#f7f7f8";
        notice.style.boxShadow =
          "0 8px 24px rgba(0, 0, 0, 0.32)";
        notice.style.boxSizing = "border-box";
        notice.style.fontFamily =
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        notice.style.fontSize = "14px";
        notice.style.fontWeight = "600";
        notice.style.lineHeight = "1.5";
        notice.style.textAlign = "center";
        notice.style.pointerEvents = "none";
        notice.style.userSelect = "none";
        notice.style.zIndex = "2147483647";

        document.documentElement.appendChild(notice);
      }

      notice.textContent = ${serializedMessage};
      return true;
    })();
  `;
}

function removePaneCloseNoticeFromView(view) {
  if (!isUsableView(view)) {
    return;
  }

  view.webContents
    .executeJavaScript(
      `
        (() => {
          document
            .getElementById(
              "chatgpt-multi-pane-close-notice"
            )
            ?.remove();
          return true;
        })();
      `,
      true
    )
    .catch(() => {
      // The pane may be navigating or closing.
    });
}

function clearPaneCloseNotice() {
  if (paneCloseNoticeTimer) {
    clearTimeout(paneCloseNoticeTimer);
    paneCloseNoticeTimer = null;
  }

  const noticeView = paneCloseNoticeView;
  paneCloseNoticeView = null;
  removePaneCloseNoticeFromView(noticeView);
}

function showPaneCloseNotice(message) {
  const targetView = getActivePaneView();

  if (!isUsableView(targetView)) {
    return;
  }

  if (paneCloseNoticeTimer) {
    clearTimeout(paneCloseNoticeTimer);
    paneCloseNoticeTimer = null;
  }

  if (
    paneCloseNoticeView &&
    paneCloseNoticeView !== targetView
  ) {
    removePaneCloseNoticeFromView(
      paneCloseNoticeView
    );
  }

  paneCloseNoticeView = targetView;

  targetView.webContents
    .executeJavaScript(
      getPaneCloseNoticeScript(message),
      true
    )
    .catch((error) => {
      console.error(
        "[Integration v4.5.6] pane close notice failed:",
        error.message
      );
    });

  paneCloseNoticeTimer = setTimeout(() => {
    paneCloseNoticeTimer = null;

    const noticeView = paneCloseNoticeView;
    paneCloseNoticeView = null;
    removePaneCloseNoticeFromView(noticeView);
  }, 2500);
}

function moveActivePaneVertical(direction) {
  const count =
    normalizePaneCount(
      appConfig.paneCount
    );

  const {
    columns,
    rows
  } = getPaneGrid(count);

  if (rows <= 1) {
    return;
  }

  const currentRow =
    Math.floor(
      activePaneIndex / columns
    );

  const currentColumn =
    activePaneIndex % columns;

  const targetRow =
    currentRow + direction;

  if (
    targetRow < 0 ||
    targetRow >= rows
  ) {
    return;
  }

  const targetIndex =
    targetRow * columns +
    currentColumn;

  if (
    targetIndex < 0 ||
    targetIndex >= count
  ) {
    return;
  }

  setActivePane(targetIndex);
}

function moveActivePanePosition(direction) {
  const currentIndex = activePaneIndex;
  const targetIndex =
    currentIndex + direction;
  const directionLabel =
    direction === -1
      ? "left"
      : direction === 1
        ? "right"
        : "unknown";

  if (
    (direction !== -1 && direction !== 1) ||
    targetIndex < 0 ||
    targetIndex >= paneViews.length
  ) {
    console.log(
      "[Integration v4.5.6] active pane move no-op:",
      {
        sourceIndex: currentIndex,
        targetIndex,
        direction: directionLabel
      }
    );
    return;
  }

  clearProjectActionIntent("pane-position-moved");

  const activeView =
    paneViews[currentIndex];

  paneViews[currentIndex] =
    paneViews[targetIndex];
  paneViews[targetIndex] = activeView;

  const activePendingUrl =
    pendingPaneUrls[currentIndex];

  pendingPaneUrls[currentIndex] =
    pendingPaneUrls[targetIndex];
  pendingPaneUrls[targetIndex] =
    activePendingUrl;

  const activeSavedUrl =
    appConfig.paneUrls[currentIndex];

  appConfig.paneUrls[currentIndex] =
    appConfig.paneUrls[targetIndex];
  appConfig.paneUrls[targetIndex] =
    activeSavedUrl;

  activePaneIndex = targetIndex;
  renderedActivePaneIndex = null;

  saveConfigNow();
  layoutPaneViews();
  refreshActivePaneVisuals();

  console.log(
    "[Integration v4.5.6] active pane moved:",
    {
      sourceIndex: currentIndex,
      targetIndex,
      direction: directionLabel
    }
  );
}

function isRefreshShortcutInput(input) {
  if (
    !input ||
    input.type !== "keyDown" ||
    input.isAutoRepeat
  ) {
    return false;
  }

  return (
    Boolean(input.control) &&
    Boolean(input.alt) &&
    !Boolean(input.shift) &&
    !Boolean(input.meta) &&
    String(input.key || "")
      .toLowerCase() === "r"
  );
}

function installRefreshShortcutInputHandler(
  targetWebContents
) {
  if (
    !targetWebContents ||
    targetWebContents.isDestroyed() ||
    refreshInputHandlerTargets.has(
      targetWebContents
    )
  ) {
    return;
  }

  refreshInputHandlerTargets.add(
    targetWebContents
  );

  targetWebContents.on(
    "before-input-event",
    (event, input) => {
      if (!isRefreshShortcutInput(input)) {
        return;
      }

      event.preventDefault();

      refreshActivePaneAndSidebar(
        "focused-webcontents"
      );
    }
  );
}


function isClosePaneShortcutInput(input) {
  if (
    !input ||
    input.type !== "keyDown" ||
    input.isAutoRepeat
  ) {
    return false;
  }

  return (
    Boolean(input.control) &&
    Boolean(input.alt) &&
    !Boolean(input.shift) &&
    !Boolean(input.meta) &&
    String(input.key || "")
      .toLowerCase() === "w"
  );
}

function installClosePaneShortcutInputHandler(
  targetWebContents
) {
  if (
    !targetWebContents ||
    targetWebContents.isDestroyed() ||
    closePaneInputHandlerTargets.has(
      targetWebContents
    )
  ) {
    return;
  }

  closePaneInputHandlerTargets.add(
    targetWebContents
  );

  targetWebContents.on(
    "before-input-event",
    (event, input) => {
      if (!isClosePaneShortcutInput(input)) {
        return;
      }

      event.preventDefault();

      closeActivePane(
        "focused-webcontents"
      );
    }
  );
}

function reloadWebContentsFromCurrentUrl(
  targetWebContents,
  label
) {
  if (
    !targetWebContents ||
    targetWebContents.isDestroyed()
  ) {
    return false;
  }

  const currentUrl =
    targetWebContents.getURL();

  if (!currentUrl) {
    return false;
  }

  try {
    targetWebContents.stop();

    targetWebContents
      .loadURL(
        currentUrl,
        {
          extraHeaders:
            "Cache-Control: no-cache\r\n" +
            "Pragma: no-cache"
        }
      )
      .catch((error) => {
        console.error(
          `[Integration v4.5.6] ${label} reload failed:`,
          error.message
        );
      });

    return true;
  } catch (error) {
    console.error(
      `[Integration v4.5.6] ${label} reload failed:`,
      error.message
    );

    return false;
  }
}

function refreshActivePaneAndSidebar(
  source = "global-shortcut"
) {
  const now = Date.now();

  if (
    now - lastRefreshRequestAt <
    500
  ) {
    return;
  }

  lastRefreshRequestAt = now;
  clearProjectActionIntent("refresh-requested");

  const paneIndex = activePaneIndex;
  const activeView = getActivePaneView();

  popupRects = [];
  lockedDialogRect = null;
  manualExpanded = false;
  overlayOnlyUiActive = false;
  fullscreenOverlayMode = false;
  sidebarRouteForwardSuppressionUntil = 0;
  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  sendFullscreenOverlayClass(false);
  updatePaneSuppression();

  lastAppliedOverlayShapeSignature = "";
  applyOverlayShape();

  if (isUsableWindow(workspaceWindow)) {
    workspaceWindow.setTitle(
      `ChatGPT Multi Pane v4.5.6 — Refreshing Active ${paneIndex + 1}/${appConfig.paneCount}`
    );
  }

  let paneStarted = false;
  let sidebarStarted = false;

  if (isUsableView(activeView)) {
    pendingPaneUrls[paneIndex] = null;

    paneStarted =
      reloadWebContentsFromCurrentUrl(
        activeView.webContents,
        `pane ${paneIndex + 1}`
      );
  }

  if (isUsableWindow(sidebarOverlayWindow)) {
    sidebarInitialLoadComplete = false;

    sidebarStarted =
      reloadWebContentsFromCurrentUrl(
        sidebarOverlayWindow.webContents,
        "sidebar overlay"
      );
  }

  console.log(
    "[Integration v4.5.6] refresh requested:",
    {
      source,
      pane: paneIndex + 1,
      paneStarted,
      sidebarStarted
    }
  );

  recordIntegrationEvent({
    event: "refresh-requested",
    pane: paneIndex + 1,
    routeKind: getViewDiagnosticRouteKind(activeView),
    source,
    action: "reload",
    reason: "user-request",
    stage: "requested"
  });

  setTimeout(() => {
    refreshActivePaneVisuals();
  }, 900);
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

  const loadStartedAt = performance.now();
  const routeKind = getDiagnosticRouteKind(url);

  console.log(
    `[Integration v4.5.6] load pane=${paneIndex + 1} url=${url}`
  );

  updatePaneUrl(
    paneIndex,
    url
  );

  pendingPaneUrls[paneIndex] = url;

  recordIntegrationEvent({
    event: "pane-load-url",
    pane: paneIndex + 1,
    routeKind,
    source: "sidebar-selection",
    action: "started",
    reason: "workspace-route",
    stage: "load"
  });

  activeView.webContents
    .loadURL(url)
    .then(() => {
      recordIntegrationEvent({
        event: "pane-load-url",
        pane: paneIndex + 1,
        routeKind,
        source: "sidebar-selection",
        action: "completed",
        reason: "load-url-resolved",
        stage: "load",
        elapsedMs: Math.round(
          performance.now() - loadStartedAt
        )
      });
    })
    .catch((error) => {
      recordIntegrationEvent({
        event: "pane-load-url",
        pane: paneIndex + 1,
        routeKind,
        source: "sidebar-selection",
        action: "failed",
        reason: "load-url-rejected",
        stage: "load",
        elapsedMs: Math.round(
          performance.now() - loadStartedAt
        ),
        errorName: error?.name || "Error",
        sanitizedErrorMessage:
          error?.message || "Unknown loadURL error"
      });

      console.error(
        "[Integration v4.5.6] pane navigation failed:",
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

function completeOverlayWorkspaceSelection(url) {
  if (!isWorkspaceRouteUrl(url)) {
    return false;
  }

  console.log(
    "[Integration v4.5.6] completing workspace selection:",
    url
  );

  /*
   * Project chats and other workspace routes can use nested paths,
   * not only /c/<id>. Any non-settings workspace destination should
   * return control to the active pane.
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
   * A short guard absorbs the overlay page's own duplicate
   * navigation event without blocking normal sidebar clicks.
   */
  sidebarRouteForwardSuppressionUntil =
    Date.now() + 350;

  sendFullscreenOverlayClass(false);
  updatePaneSuppression();
  applyOverlayShape();

  return true;
}

function shouldSuppressSidebarRouteForwarding() {
  /*
   * Overlay shape detection can temporarily mistake ordinary ChatGPT
   * content for a dialog. Only an explicit timed guard may suppress a
   * workspace route; shape state alone must never block a user click.
   */
  return (
    Date.now() <
      sidebarRouteForwardSuppressionUntil
  );
}

function handleSidebarNavigation(url) {
  if (!sidebarInitialLoadComplete) {
    return;
  }

  if (isExternalAccountRouteUrl(url)) {
    clearProjectActionIntent("external-route-opened");

    recordIntegrationEvent({
      event: "sidebar-route-handled",
      routeKind: getDiagnosticRouteKind(url),
      source: "native-navigation",
      action: "open-external-route",
      reason: "external-account-route"
    });
    openFullscreenAccountRoute(url);
    return;
  }

  if (isOverlayOnlyRouteUrl(url)) {
    clearProjectActionIntent("overlay-only-route-opened");

    recordIntegrationEvent({
      event: "sidebar-route-handled",
      routeKind: getDiagnosticRouteKind(url),
      source: "native-navigation",
      action: "keep-in-overlay",
      reason: "overlay-only-route"
    });
    setOverlayOnlyUiActive(true);
    return;
  }

  if (isWorkspaceRouteUrl(url)) {
    const routeKind = getDiagnosticRouteKind(url);
    const decision = decideSidebarRouting({
      routeKind,
      source: "native-navigation",
      overlayState:
        overlayOnlyUiActive || Boolean(lockedDialogRect)
          ? "dialog"
          : "closed",
      projectActionIntent,
      activePaneIndex,
      currentProjectIntentGeneration:
        projectActionIntentGeneration,
      now: performance.now(),
      suppressionActive:
        shouldSuppressSidebarRouteForwarding(),
      activePaneValid:
        isUsableView(getActivePaneView())
    });
    let nativeRouteReason = decision.reason;

    if (decision.action === "ignore-duplicate") {
      recordIntegrationEvent({
        event: "duplicate-suppressed",
        pane: activePaneIndex + 1,
        routeKind,
        source: "native-navigation",
        action: decision.action,
        reason: decision.reason
      });

      return;
    }

    if (decision.action === "forward-to-pane") {
      const consumedIntent =
        consumeProjectActionIntent(routeKind);

      if (
        consumedIntent &&
        consumedIntent.paneIndex === activePaneIndex &&
        completeOverlayWorkspaceSelection(url)
      ) {
        recordIntegrationEvent({
          event: "route-forwarded",
          pane: activePaneIndex + 1,
          routeKind,
          source: "native-navigation",
          action: decision.action,
          reason: decision.reason
        });

        return;
      }

      nativeRouteReason =
        "workspace-forwarding-unavailable";
    }

    recordIntegrationEvent({
      event: "native-route-ignored",
      pane: activePaneIndex + 1,
      routeKind,
      source: "native-navigation",
      action: "ignore-native-route",
      reason: nativeRouteReason
    });

    console.log(
      "[Integration v4.5.6] native sidebar route ignored:",
      url
    );

    if (
      overlayOnlyUiActive ||
      Boolean(lockedDialogRect)
    ) {
      unlockDialogShape(false);
    }

    return;
  }
}

function setOverlayOnlyUiActive(active) {
  overlayOnlyUiActive = Boolean(active);

  if (overlayOnlyUiActive) {
    clearProjectActionIntent("overlay-state-activated");
  }

  /*
   * Do not start a route guard merely because shape detection found a
   * dialog-like surface. The confirmed close-intent path owns that
   * guard, preventing false positives from blocking later chat clicks.
   */
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
      "[Integration v4.5.6] dismiss input failed:",
      error.message
    );
  }

  setTimeout(() => {
    popupRects = [];
    lockedDialogRect = null;
    applyOverlayShape();
  }, 80);
}

function getPaneIndex(view) {
  return paneViews.indexOf(view);
}

function attachPaneEvents(view) {
  const resolveIndex = () =>
    getPaneIndex(view);

  installRefreshShortcutInputHandler(
    view.webContents
  );

  installClosePaneShortcutInputHandler(
    view.webContents
  );

  view.webContents.on("focus", () => {
    const index = resolveIndex();

    if (index < 0) {
      return;
    }

    setActivePane(index);
    dismissSidebarTransientUi();
  });

  view.webContents.on("dom-ready", () => {
    const index = resolveIndex();

    if (index < 0) {
      return;
    }

    installPaneUi(view);
    syncPaneVisualAfterNavigation(index);
  });

  view.webContents.on("did-finish-load", () => {
    const index = resolveIndex();

    if (index < 0) {
      return;
    }

    updatePaneUrl(
      index,
      view.webContents.getURL()
    );

    installPaneUi(view);
    syncPaneVisualAfterNavigation(index);
  });

  view.webContents.on(
    "did-navigate",
    (_event, url) => {
      const index = resolveIndex();

      if (index < 0) {
        return;
      }

      pendingPaneUrls[index] = null;
      updatePaneUrl(index, url);
      installPaneUi(view);
      syncPaneVisualAfterNavigation(index);
    }
  );

  view.webContents.on(
    "did-navigate-in-page",
    (_event, url, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      const index = resolveIndex();

      if (index < 0) {
        return;
      }

      updatePaneUrl(index, url);
      installPaneUi(view);
      syncPaneVisualAfterNavigation(index);
    }
  );

  view.webContents.on(
    "render-process-gone",
    (_event, details) => {
      const index = resolveIndex();

      if (
        projectActionIntent &&
        projectActionIntent.paneIndex === index
      ) {
        clearProjectActionIntent(
          "target-pane-renderer-gone"
        );
      }

      recordIntegrationEvent({
        event: "pane-renderer-gone",
        pane: index >= 0 ? index + 1 : undefined,
        source: "pane",
        action: "failed",
        reason: "renderer-gone",
        stage: "renderer",
        errorName: details?.reason,
        sanitizedErrorMessage: details?.exitCode
      });
    }
  );

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isChatGPTUrl(url)) {
      view.webContents.loadURL(url);
    } else {
      shell.openExternal(url).catch((error) => {
        console.error(
          "[Integration v4.5.6] external link failed:",
          error.message
        );
      });
    }

    return {
      action: "deny"
    };
  });
}

function schedulePaneInitialLoad(
  view,
  index,
  delayMs = 0
) {
  const load = () => {
    view.__chatgptInitialLoadTimer = null;

    if (
      !isUsableView(view) ||
      paneViews[index] !== view
    ) {
      return;
    }

    view.webContents
      .loadURL(getPaneStartUrl(index))
      .catch((error) => {
        console.error(
          "[Integration v4.5.6] initial pane load failed:",
          error.message
        );
      });
  };

  if (delayMs <= 0) {
    load();
    return;
  }

  view.__chatgptInitialLoadTimer =
    setTimeout(load, delayMs);
}

function createPaneView(
  index,
  loadDelayMs = 0
) {
  if (!isUsableWindow(workspaceWindow)) {
    return null;
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: CHATGPT_PARTITION,
      preload: path.join(
        __dirname,
        "pane-chrome-preload-v4.5.4.js"
      ),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  attachPaneEvents(view);

  workspaceWindow.contentView.addChildView(view);
  paneViews[index] = view;

  view.setBounds(getPaneBounds(index));

  schedulePaneInitialLoad(
    view,
    index,
    loadDelayMs
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
    createPaneView(
      index,
      index * PANE_LOAD_STAGGER_MS
    );
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

  if (view?.__chatgptInitialLoadTimer) {
    clearTimeout(
      view.__chatgptInitialLoadTimer
    );

    view.__chatgptInitialLoadTimer = null;
  }

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

function preserveActivePaneForReduction(
  targetCount
) {
  const selectedIndex = activePaneIndex;

  if (
    !Number.isInteger(targetCount) ||
    targetCount < 1 ||
    targetCount >= paneViews.length ||
    selectedIndex < targetCount ||
    selectedIndex >= paneViews.length
  ) {
    return;
  }

  const preservedIndex = targetCount - 1;

  const selectedView =
    paneViews[selectedIndex];

  paneViews[selectedIndex] =
    paneViews[preservedIndex];

  paneViews[preservedIndex] = selectedView;

  const selectedPendingUrl =
    pendingPaneUrls[selectedIndex];

  pendingPaneUrls[selectedIndex] =
    pendingPaneUrls[preservedIndex];

  pendingPaneUrls[preservedIndex] =
    selectedPendingUrl;

  const selectedSavedUrl =
    appConfig.paneUrls[selectedIndex];

  appConfig.paneUrls[selectedIndex] =
    appConfig.paneUrls[preservedIndex];

  appConfig.paneUrls[preservedIndex] =
    selectedSavedUrl;

  activePaneIndex = preservedIndex;
  renderedActivePaneIndex = null;

  console.log(
    "[Integration v4.5.6] preserved active pane during layout reduction:",
    {
      sourceIndex: selectedIndex,
      targetIndex: preservedIndex,
      targetCount
    }
  );
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

  clearProjectActionIntent("pane-count-changed");

  paneCountChangeInProgress = true;

  try {
    dismissSidebarTransientUi();
    saveOpenPaneUrls();

    if (nextCount < currentCount) {
      preserveActivePaneForReduction(
        nextCount
      );
    }

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
        createPaneView(
          index,
          (index - currentCount) *
            PANE_LOAD_STAGGER_MS
        );
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
      `[Integration v4.5.6] pane count=${nextCount}`
    );
  } finally {
    setTimeout(() => {
      paneCountChangeInProgress = false;
    }, 150);
  }
}


function closeActivePane(
  source = "global-shortcut"
) {
  const currentCount = paneViews.length;
  const blockedMessage =
    currentCount === 1
      ? "至少需要保留 1 個窗格。"
      : currentCount === 6
        ? "6 格布局不支援單格關閉，請先移動要保留的窗格，再切換布局。"
        : null;

  if (blockedMessage) {
    showPaneCloseNotice(blockedMessage);

    console.log(
      "[Integration v4.5.6] close pane blocked:",
      {
        source,
        paneCount: currentCount
      }
    );

    return;
  }

  const now = Date.now();

  /*
   * 全域快捷鍵與 before-input-event
   * 可能同時收到同一次按鍵，必須防止
   * 一次關閉兩個窗格。
   */
  if (
    now - lastClosePaneRequestAt <
    500
  ) {
    return;
  }

  lastClosePaneRequestAt = now;

  if (paneCountChangeInProgress) {
    return;
  }

  /*
   * 目前規格只允許：
   * 4 -> 3
   * 3 -> 2
   * 2 -> 1
   *
   * 1 格不可再關閉；
   * 6 格不可變成未正式支援的 5 格。
   */
  if (
    ![2, 3, 4].includes(currentCount) ||
    appConfig.paneCount !== currentCount
  ) {
    console.error(
      "[Integration v4.5.6] close pane rejected because pane state is inconsistent:",
      {
        source,
        viewCount: currentCount,
        configuredCount:
          appConfig.paneCount
      }
    );

    return;
  }

  const closingIndex = Math.max(
    0,
    Math.min(
      activePaneIndex,
      currentCount - 1
    )
  );

  clearProjectActionIntent("active-pane-closed");

  paneCountChangeInProgress = true;

  try {
    dismissSidebarTransientUi();
    saveOpenPaneUrls();

    /*
     * destroyPaneView() 只銷毀被選取的
     * WebContentsView。其他窗格實體仍保留，
     * 不會重新載入。
     */
    destroyPaneView(closingIndex);

    /*
     * 移除已銷毀的位置，讓後方既有窗格
     * 向前補位。三個陣列必須同步位移。
     */
    paneViews.splice(
      closingIndex,
      1
    );

    pendingPaneUrls.splice(
      closingIndex,
      1
    );

    appConfig.paneUrls.splice(
      closingIndex,
      1
    );

    const nextCount =
      currentCount - 1;

    appConfig.paneCount =
      nextCount;

    /*
     * 關閉中間格時，後方窗格補上原位置；
     * 關閉最後一格時，改選新的最後一格。
     */
    activePaneIndex = Math.min(
      closingIndex,
      nextCount - 1
    );

    /*
     * 原本的視覺索引已因陣列位移而失效，
     * 重新建立活動窗格外框。
     */
    renderedActivePaneIndex = null;

    saveConfigNow();
    layoutPaneViews();
    refreshActivePaneVisuals();

    console.log(
      "[Integration v4.5.6] active pane closed:",
      {
        source,
        closedPane:
          closingIndex + 1,
        paneCount:
          nextCount,
        activePane:
          activePaneIndex + 1
      }
    );
  } finally {
    setTimeout(() => {
      paneCountChangeInProgress = false;
    }, 150);
  }
}

function destroyPaneViews() {
  clearProjectActionIntent("pane-views-destroyed");
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
      "[Integration v4.5.6] rejected oversized dialog rect:",
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
      "[Integration v4.5.6] BrowserWindow.setShape unavailable"
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

  const shapeSignature =
    JSON.stringify(shapeRects);

  if (
    shapeSignature ===
    lastAppliedOverlayShapeSignature
  ) {
    return;
  }

  try {
    sidebarOverlayWindow.setShape(
      shapeRects
    );

    lastAppliedOverlayShapeSignature =
      shapeSignature;
  } catch (error) {
    console.error(
      "[Integration v4.5.6] setShape failed:",
      error.message
    );
  }
}

function setManualExpanded(expanded) {
  manualExpanded = Boolean(expanded);
  applyOverlayShape();
}

function unlockDialogShape(suppressSidebarRoute = false) {
  lockedDialogRect = null;
  overlayOnlyUiActive = false;

  if (suppressSidebarRoute) {
    /*
     * Only a confirmed Settings/Search close action should block the
     * overlay page's follow-up route. Normal sidebar clicks must not
     * create this guard.
     */
    sidebarRouteForwardSuppressionUntil =
      Math.max(
        sidebarRouteForwardSuppressionUntil,
        Date.now() + 1500
      );
  }

  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  popupRects = [];

  updatePaneSuppression();
  applyOverlayShape();

  console.log(
    "[Integration v4.5.6] dialog shape unlocked"
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

  const currentBounds =
    sidebarOverlayWindow.getBounds();

  const boundsChanged =
    currentBounds.x !== contentBounds.x ||
    currentBounds.y !== contentBounds.y ||
    currentBounds.width !== contentBounds.width ||
    currentBounds.height !== contentBounds.height;

  if (boundsChanged) {
    sidebarOverlayWindow.setBounds(
      {
        x: contentBounds.x,
        y: contentBounds.y,
        width: contentBounds.width,
        height: contentBounds.height
      },
      false
    );
  }

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

  lastAppliedOverlayShapeSignature = "";

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
        "sidebar-shape-preload-v4.5.4.js"
      ),

      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  installRefreshShortcutInputHandler(
    sidebarOverlayWindow.webContents
  );

  installClosePaneShortcutInputHandler(
    sidebarOverlayWindow.webContents
  );

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
          "[Integration v4.5.6] transparency CSS failed:",
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
        "[Integration v4.5.6] ChatGPT sidebar overlay loaded"
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
        isWorkspaceRouteUrl(url)
      ) {
        console.log(
          "[Integration v4.5.6] native sidebar window route ignored:",
          url
        );
      } else if (!isChatGPTUrl(url)) {
        shell.openExternal(url).catch((error) => {
          console.error(
            "[Integration v4.5.6] sidebar external link failed:",
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
      clearProjectActionIntent("sidebar-renderer-gone");

      recordIntegrationEvent({
        event: "sidebar-renderer-gone",
        source: "sidebar",
        action: "failed",
        reason: "renderer-gone",
        stage: "renderer",
        errorName: details?.reason,
        sanitizedErrorMessage: details?.exitCode
      });
      console.error(
        "[Integration v4.5.6] sidebar renderer stopped:",
        details
      );
    }
  );

  sidebarOverlayWindow.on("closed", () => {
    clearProjectActionIntent("sidebar-window-closed");
    sidebarOverlayWindow = null;
    lastAppliedOverlayShapeSignature = "";
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
      `ChatGPT Multi Pane v4.5.6 — Active 1/${appConfig.paneCount}`,
    backgroundColor: "#111111",

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  installRefreshShortcutInputHandler(
    workspaceWindow.webContents
  );

  installClosePaneShortcutInputHandler(
    workspaceWindow.webContents
  );

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
    clearPaneCloseNotice();
    clearProjectActionIntent("workspace-window-closed");

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
      `[Integration v4.5.6] shortcut ${label}: ` +
      `${accelerator}, registered=${registered}`
    );
  } catch (error) {
    console.error(
      `[Integration v4.5.6] shortcut ${label} failed:`,
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
    "CommandOrControl+Alt+Shift+Left",
    () => moveActivePanePosition(-1),
    "move-active-left"
  );

  registerShortcut(
    "CommandOrControl+Alt+Shift+Right",
    () => moveActivePanePosition(1),
    "move-active-right"
  );

  registerShortcut(
    "CommandOrControl+Alt+Up",
    () => moveActivePaneVertical(-1),
    "active-up"
  );

  registerShortcut(
    "CommandOrControl+Alt+Down",
    () => moveActivePaneVertical(1),
    "active-down"
  );

  registerShortcut(
    "CommandOrControl+Alt+W",
    () => closeActivePane(
      "global-shortcut"
    ),
    "close-active-pane"
  );

  registerShortcut(
    "CommandOrControl+Alt+R",
    refreshActivePaneAndSidebar,
    "refresh-active-pane-and-sidebar"
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
        "[Integration v4.5.6] dialog shape locked:",
        lockedDialogRect
      );
    }

    if (!manualExpanded) {
      applyOverlayShape();
    }
  }
);

ipcMain.on(
  "chatgpt-sidebar-project-action-candidate",
  (event, candidate) => {
    if (
      !isUsableWindow(sidebarOverlayWindow) ||
      event.sender.id !==
        sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    const overlayState =
      overlayOnlyUiActive ||
      Boolean(lockedDialogRect) ||
      fullscreenOverlayMode
        ? "dialog"
        : candidate?.overlayState;
    const decision = decideProjectActionCandidate({
      phase: candidate?.phase,
      controlKind: candidate?.controlKind,
      hasAnchor: Boolean(candidate?.hasAnchor),
      insideDialog: Boolean(candidate?.insideDialog),
      overlayState,
      overlayControl: Boolean(candidate?.overlayControl),
      closeControl: Boolean(candidate?.closeControl),
      externalControl: Boolean(candidate?.externalControl),
      backdropControl: Boolean(candidate?.backdropControl)
    });

    recordIntegrationEvent({
      event: "project-action-candidate",
      pane: activePaneIndex + 1,
      source: "pointerdown",
      action: decision.action,
      reason: decision.reason
    });

    if (
      decision.action !== "create-project-intent" ||
      !isUsableView(getActivePaneView())
    ) {
      return;
    }

    createProjectActionIntent();
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

    clearProjectActionIntent("dialog-close-intent");

    const hadOverlayDialog =
      overlayOnlyUiActive ||
      Boolean(lockedDialogRect) ||
      fullscreenOverlayMode;

    if (!hadOverlayDialog) {
      recordIntegrationEvent({
        event: "sidebar-dialog-close-intent",
        source: "dialog-close-intent",
        action: "ignored",
        reason: "no-overlay-dialog"
      });
      console.log(
        "[Integration v4.5.6] ignored stray dialog close intent"
      );

      return;
    }

    recordIntegrationEvent({
      event: "sidebar-dialog-close-intent",
      source: "dialog-close-intent",
      action: "close-overlay-dialog",
      reason: "confirmed-overlay-dialog"
    });
    unlockDialogShape(true);

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

    clearProjectActionIntent("anchor-route-intent");

    const routeKind = getDiagnosticRouteKind(url);

    recordIntegrationEvent({
      event: "sidebar-route-intent",
      pane: activePaneIndex + 1,
      routeKind,
      source: "anchor-intent",
      action: "received",
      reason: "explicit-anchor-click"
    });

    if (isExternalAccountRouteUrl(url)) {
      recordIntegrationEvent({
        event: "sidebar-route-handled",
        pane: activePaneIndex + 1,
        routeKind,
        source: "anchor-intent",
        action: "open-external-route",
        reason: "external-account-route"
      });
      openFullscreenAccountRoute(url);
      return;
    }

    if (isOverlayOnlyRouteUrl(url)) {
      recordIntegrationEvent({
        event: "sidebar-route-handled",
        pane: activePaneIndex + 1,
        routeKind,
        source: "anchor-intent",
        action: "keep-in-overlay",
        reason: "overlay-only-route"
      });
      setOverlayOnlyUiActive(true);
      return;
    }

    if (completeOverlayWorkspaceSelection(url)) {
      recordIntegrationEvent({
        event: "sidebar-route-forwarded",
        pane: activePaneIndex + 1,
        routeKind,
        source: "anchor-intent",
        action: "forward-to-active-pane",
        reason: "explicit-workspace-selection"
      });
      return;
    }

    if (shouldSuppressSidebarRouteForwarding()) {
      recordIntegrationEvent({
        event: "sidebar-route-suppressed",
        pane: activePaneIndex + 1,
        routeKind,
        source: "anchor-intent",
        action: "ignore-duplicate-route",
        reason: "duplicate-route-guard"
      });
      console.log(
        "[Integration v4.5.6] suppressed sidebar route intent:",
        url
      );
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

    clearProjectActionIntent("external-route-intent");

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

    clearProjectActionIntent("overlay-only-intent");

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

    clearProjectActionIntent("fullscreen-overlay-opened");

    setFullscreenOverlayMode(true);
  }
);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  appConfig = loadConfig();

  console.log(
    "[Integration v4.5.6] Electron:",
    process.versions.electron
  );

  console.log(
    "[Integration v4.5.6] userData:",
    app.getPath("userData")
  );

  console.log(
    "[Integration v4.5.6] restored pane count:",
    appConfig.paneCount
  );

  registerShortcuts();
  createWorkspaceWindow();
});

app.on("will-quit", () => {
  clearPaneCloseNotice();
  clearProjectActionIntent("app-will-quit");
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
    "chatgpt-sidebar-project-action-candidate"
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
