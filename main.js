const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  globalShortcut
} = require("electron");

const fs = require("fs");
const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const DEFAULT_PANE_COUNT = 1;
const MIN_PANES = 1;
const MAX_PANES = 6;

const OFFICIAL_SIDEBAR_WIDTH = 280;

const ACTIVE_PANE_BORDER_COLOR = "rgba(156, 163, 175, 0.45)";
const ACTIVE_PANE_BORDER_WIDTH = 2;

let mainWindow = null;
let sidebarView = null;
let paneViews = [];
let activePaneIndex = 0;
let isChangingLayout = false;
let saveTimer = null;
let activeVisualUpdateSerial = 0;

let appConfig = {
  paneCount: DEFAULT_PANE_COUNT,
  paneUrls: []
};

const HIDE_CHATGPT_INTERNAL_SIDEBAR_CSS = `
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

  body {
    --sidebar-width: 0px !important;
  }

  main,
  [role="main"] {
    margin-left: 0 !important;
  }

  /* 右側窗格的小尺寸 sidebar / menu 開關 */
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

  /* 小視窗開 sidebar 後可能出現的遮罩／暗化層 */
  [data-radix-dialog-overlay],
  [data-state="open"][data-radix-dialog-overlay],
  .fixed.inset-0.bg-black,
  .fixed.inset-0[class*="bg-black"],
  div[class*="bg-black/"],
  div[class*="backdrop"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

function getRemoveActivePaneOverlayScript() {
  return `
    (() => {
      const overlay = document.getElementById("chatgpt-multi-active-pane-overlay");
      const label = document.getElementById("chatgpt-multi-active-pane-label");

      if (overlay) overlay.remove();
      if (label) label.remove();

      return true;
    })();
  `;
}

function getShowActivePaneOverlayScript(index) {
  const borderColor = ACTIVE_PANE_BORDER_COLOR;
  const borderWidth = ACTIVE_PANE_BORDER_WIDTH;

  return `
    (() => {
      const oldOverlay = document.getElementById("chatgpt-multi-active-pane-overlay");
      const oldLabel = document.getElementById("chatgpt-multi-active-pane-label");

      if (oldOverlay) oldOverlay.remove();
      if (oldLabel) oldLabel.remove();

      const overlay = document.createElement("div");
      overlay.id = "chatgpt-multi-active-pane-overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.border = "${borderWidth}px solid ${borderColor}";
      overlay.style.boxSizing = "border-box";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483646";

      document.documentElement.appendChild(overlay);

      return true;
    })();
  `;
}

async function clearActivePaneVisual(view) {
  if (!view || view.webContents.isDestroyed()) return;

  try {
    if (view.__activeCssKey) {
      await view.webContents.removeInsertedCSS(view.__activeCssKey);
      view.__activeCssKey = null;
    }
  } catch {
    view.__activeCssKey = null;
  }

  try {
    await view.webContents.executeJavaScript(
      getRemoveActivePaneOverlayScript(),
      true
    );
  } catch {
    // 頁面尚未載入完成時可能失敗，忽略即可。
  }
}

function clampPaneCount(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return DEFAULT_PANE_COUNT;
  return Math.max(MIN_PANES, Math.min(MAX_PANES, Math.floor(n)));
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "official-sidebar-config.json");
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

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    return {
      paneCount: clampPaneCount(parsed.paneCount),
      paneUrls: Array.isArray(parsed.paneUrls) ? parsed.paneUrls : []
    };
  } catch (error) {
    console.log("[Config] failed to load:", error.message);

    return {
      paneCount: DEFAULT_PANE_COUNT,
      paneUrls: []
    };
  }
}

function saveConfigNow() {
  try {
    const configPath = getConfigPath();

    fs.writeFileSync(
      configPath,
      JSON.stringify(appConfig, null, 2),
      "utf-8"
    );

    console.log("[Config] saved:", appConfig);
  } catch (error) {
    console.log("[Config] failed to save:", error.message);
  }
}

function saveConfigDebounced() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveConfigNow();
  }, 300);
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

function safePaneUrl(index) {
  const url = appConfig.paneUrls[index];

  if (typeof url === "string" && isChatGPTUrl(url)) {
    return url;
  }

  return CHATGPT_URL;
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setTitle(
    `ChatGPT Multi Workspace — 目前窗格 ${activePaneIndex + 1}/${appConfig.paneCount}`
  );
}

async function removeInternalSidebarElements(view) {
  if (!view || view.webContents.isDestroyed()) return;

  const script = `
    (() => {
      const shouldHideButton = (el) => {
        const text = [
          el.getAttribute("aria-label"),
          el.getAttribute("title"),
          el.getAttribute("data-testid")
        ].filter(Boolean).join(" ").toLowerCase();

        return (
          text.includes("sidebar") ||
          text.includes("側邊欄") ||
          text.includes("open-sidebar") ||
          text.includes("close-sidebar")
        );
      };

      document.querySelectorAll("button, [role='button']").forEach((el) => {
        const rect = el.getBoundingClientRect();
        const isTopLeftIconButton =
          rect.top >= 0 &&
          rect.top < 80 &&
          rect.left >= 0 &&
          rect.left < 80 &&
          rect.width <= 64 &&
          rect.height <= 64 &&
          el.querySelector("svg");

        if (shouldHideButton(el) || isTopLeftIconButton) {
          el.style.display = "none";
          el.style.visibility = "hidden";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        }
      });

      document.querySelectorAll(
        "#stage-slideover-sidebar, [data-testid='sidebar'], [data-testid='sidebar-container'], [data-radix-dialog-overlay]"
      ).forEach((el) => {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      });

      return true;
    })();
  `;

  try {
    await view.webContents.executeJavaScript(script, true);
  } catch {
    // 頁面尚未載入完成時可能失敗，忽略即可。
  }
}

async function injectHideSidebarCss(view) {
  if (!view || view.webContents.isDestroyed()) return;

  try {
    await view.webContents.insertCSS(HIDE_CHATGPT_INTERNAL_SIDEBAR_CSS);
  } catch (error) {
    console.log("[CSS] hide sidebar insert failed:", error.message);
  }

  await removeInternalSidebarElements(view);

  // ChatGPT 有些按鈕會在 hydration 後才出現，所以延遲再清一次。
  setTimeout(() => {
    removeInternalSidebarElements(view);
  }, 800);

  setTimeout(() => {
    removeInternalSidebarElements(view);
  }, 1800);
}

async function refreshActivePaneVisuals() {
  const serial = ++activeVisualUpdateSerial;
  const targetIndex = activePaneIndex;
  const count = appConfig.paneCount;
  const views = [...paneViews];

  for (const view of views) {
    await clearActivePaneVisual(view);
  }

  if (serial !== activeVisualUpdateSerial) {
    return;
  }

  const activeView = views[targetIndex];

  if (
    activeView &&
    !activeView.webContents.isDestroyed() &&
    targetIndex < count
  ) {
    try {
      await activeView.webContents.executeJavaScript(
        getShowActivePaneOverlayScript(targetIndex),
        true
      );
    } catch (error) {
      console.log("[Active Pane] overlay insert failed:", error.message);
    }
  }

  updateWindowTitle();
}

function setActivePane(index) {
  const count = appConfig.paneCount;
  const nextIndex = Math.max(0, Math.min(index, count - 1));

  activePaneIndex = nextIndex;

  console.log("[Active Pane]", activePaneIndex + 1);
  refreshActivePaneVisuals();
}

function updatePaneUrl(index, url) {
  if (!isChatGPTUrl(url)) return;

  appConfig.paneUrls[index] = url;
  saveConfigDebounced();
}

function getContentBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      width: 1400,
      height: 900
    };
  }

  const bounds = mainWindow.getContentBounds();

  return {
    width: Math.max(900, bounds.width),
    height: Math.max(600, bounds.height)
  };
}

function getWorkspaceBounds() {
  const content = getContentBounds();

  return {
    x: OFFICIAL_SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(300, content.width - OFFICIAL_SIDEBAR_WIDTH),
    height: content.height
  };
}

function getPaneBounds(index, total) {
  const workspace = getWorkspaceBounds();

  const x0 = workspace.x;
  const y0 = workspace.y;
  const totalWidth = workspace.width;
  const totalHeight = workspace.height;

  if (total === 1) {
    return {
      x: x0,
      y: y0,
      width: totalWidth,
      height: totalHeight
    };
  }

  if (total === 2) {
    const width = Math.floor(totalWidth / 2);

    return {
      x: x0 + index * width,
      y: y0,
      width: index === 1 ? totalWidth - width : width,
      height: totalHeight
    };
  }

  if (total === 3) {
    const width = Math.floor(totalWidth / 3);

    return {
      x: x0 + index * width,
      y: y0,
      width: index === 2 ? totalWidth - width * 2 : width,
      height: totalHeight
    };
  }

  if (total === 4) {
    const columns = 2;
    const rows = 2;

    const width = Math.floor(totalWidth / columns);
    const height = Math.floor(totalHeight / rows);

    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      x: x0 + column * width,
      y: y0 + row * height,
      width: column === columns - 1 ? totalWidth - width * column : width,
      height: row === rows - 1 ? totalHeight - height * row : height
    };
  }

  const columns = 3;
  const rows = 2;

  const width = Math.floor(totalWidth / columns);
  const height = Math.floor(totalHeight / rows);

  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: x0 + column * width,
    y: y0 + row * height,
    width: column === columns - 1 ? totalWidth - width * column : width,
    height: row === rows - 1 ? totalHeight - height * row : height
  };
}

function layoutSidebar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!sidebarView) return;

  const content = getContentBounds();

  // 固定使用完整主視窗寬度，讓官方 ChatGPT 左欄維持桌面版形態。
  // 右側 paneViews 會蓋在它上方，因此實際可見的是左側欄。
  sidebarView.setBounds({
    x: 0,
    y: 0,
    width: content.width,
    height: content.height
  });
}

function layoutPanes() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  layoutSidebar();

  const count = appConfig.paneCount;

  for (let i = 0; i < paneViews.length; i++) {
    const view = paneViews[i];

    if (!view) continue;

    if (i < count) {
      view.setBounds(getPaneBounds(i, count));
    } else {
      view.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });
    }
  }

  refreshActivePaneVisuals();
}

function attachPaneEvents(view, index) {
  view.webContents.on("focus", () => {
    setActivePane(index);
  });

  view.webContents.on("did-finish-load", () => {
    injectHideSidebarCss(view);
    refreshActivePaneVisuals();
  });

  view.webContents.on("did-navigate", (_event, url) => {
    updatePaneUrl(index, url);
    injectHideSidebarCss(view);
    refreshActivePaneVisuals();
  });

  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) {
      updatePaneUrl(index, url);
      injectHideSidebarCss(view);
      refreshActivePaneVisuals();
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isChatGPTUrl(url)) {
      view.webContents.loadURL(url);
    }

    return { action: "deny" };
  });
}

function createPane(index) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

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

  mainWindow.contentView.addChildView(view);

  view.webContents.loadURL(safePaneUrl(index));

  paneViews[index] = view;

  return view;
}

function ensurePaneExists(index) {
  if (paneViews[index]) return paneViews[index];

  return createPane(index);
}

function ensurePaneCount(targetCount) {
  if (isChangingLayout) {
    console.log("[Layout] ignored because layout change is already running");
    return;
  }

  isChangingLayout = true;

  try {
    const count = clampPaneCount(targetCount);

    console.log(`[Layout] target=${count}`);

    for (let i = 0; i < count; i++) {
      ensurePaneExists(i);
    }

    appConfig.paneCount = count;

    if (activePaneIndex >= count) {
      activePaneIndex = count - 1;
    }

    saveConfigNow();
    layoutPanes();
  } finally {
    setTimeout(() => {
      isChangingLayout = false;
    }, 150);
  }
}

function getActivePane() {
  return paneViews[activePaneIndex] || null;
}

function reloadPane(index) {
  const view = paneViews[index];

  if (!view || view.webContents.isDestroyed()) return;

  view.webContents.reload();
}

function reloadAllPanes() {
  const count = appConfig.paneCount;

  for (let i = 0; i < count; i++) {
    reloadPane(i);
  }
}

function loadUrlInActivePane(url) {
  const view = getActivePane();

  if (!view || !isChatGPTUrl(url)) return;

  console.log(`[Load URL] pane=${activePaneIndex + 1}, url=${url}`);

  view.webContents.loadURL(url);
  updatePaneUrl(activePaneIndex, url);
  refreshActivePaneVisuals();
}

function newChatInActivePane() {
  loadUrlInActivePane(CHATGPT_URL);
}

function createSidebarController() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  sidebarView = new WebContentsView({
    webPreferences: {
      partition: CHATGPT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.contentView.addChildView(sidebarView);

  sidebarView.webContents.on("did-navigate", (_event, url) => {
    if (isConversationUrl(url)) {
      loadUrlInActivePane(url);
    }
  });


  sidebarView.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && isConversationUrl(url)) {
      loadUrlInActivePane(url);
    }
  });

  sidebarView.webContents.setWindowOpenHandler(({ url }) => {
    if (isConversationUrl(url)) {
      loadUrlInActivePane(url);
    }


    return { action: "deny" };
  });

  sidebarView.webContents.loadURL(CHATGPT_URL);

  layoutSidebar();
}

function createAppMenu() {
  const template = [
    {
      label: "ChatGPT Workspace",
      submenu: [
        {
          label: "Layout: 1 Pane",
          click: () => ensurePaneCount(1)
        },
        {
          label: "Layout: 2 Panes",
          click: () => ensurePaneCount(2)
        },
        {
          label: "Layout: 3 Panes",
          click: () => ensurePaneCount(3)
        },
        {
          label: "Layout: 4 Panes",
          click: () => ensurePaneCount(4)
        },
        {
          label: "Layout: 6 Panes",
          click: () => ensurePaneCount(6)
        },
        { type: "separator" },
        {
          label: "Select Pane 1",
          click: () => setActivePane(0)
        },
        {
          label: "Select Pane 2",
          click: () => setActivePane(1)
        },
        {
          label: "Select Pane 3",
          click: () => setActivePane(2)
        },
        {
          label: "Select Pane 4",
          click: () => setActivePane(3)
        },
        {
          label: "Select Pane 5",
          click: () => setActivePane(4)
        },
        {
          label: "Select Pane 6",
          click: () => setActivePane(5)
        },
        { type: "separator" },
        {
          label: "Reload All Panes",
          click: () => reloadAllPanes()
        },
        {
          label: "Reload Active Pane",
          click: () => reloadPane(activePaneIndex)
        },
        {
          label: "New Chat in Active Pane",
          click: () => newChatInActivePane()
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerShortcut(accelerator, callback, label) {
  try {
    const registered = globalShortcut.register(accelerator, callback);
    console.log(`[Shortcut] ${label} ${accelerator} registered=${registered}`);

    if (!registered) {
      console.log(`[Shortcut] failed to register: ${label} ${accelerator}`);
    }
  } catch (error) {
    console.log(
      `[Shortcut] error: ${label} ${accelerator} - ${error.message}`
    );
  }
}

function registerGlobalShortcuts() {
  registerShortcut("CommandOrControl+Alt+1", () => ensurePaneCount(1), "layout-1");
  registerShortcut("CommandOrControl+Alt+2", () => ensurePaneCount(2), "layout-2");
  registerShortcut("CommandOrControl+Alt+3", () => ensurePaneCount(3), "layout-3");
  registerShortcut("CommandOrControl+Alt+4", () => ensurePaneCount(4), "layout-4");
  registerShortcut("CommandOrControl+Alt+6", () => ensurePaneCount(6), "layout-6");

  registerShortcut("CommandOrControl+Alt+R", () => reloadAllPanes(), "reload-all");

  registerShortcut("CommandOrControl+Alt+N", () => {
    if (appConfig.paneCount < MAX_PANES) {
      ensurePaneCount(appConfig.paneCount + 1);
    }
  }, "add-pane");

  registerShortcut("CommandOrControl+Alt+W", () => {
    if (appConfig.paneCount > MIN_PANES) {
      ensurePaneCount(appConfig.paneCount - 1);
    }
  }, "remove-pane");

  registerShortcut("CommandOrControl+Alt+Left", () => {
    setActivePane(activePaneIndex - 1);
  }, "active-left");

  registerShortcut("CommandOrControl+Alt+Right", () => {
    setActivePane(activePaneIndex + 1);
  }, "active-right");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    title: "ChatGPT Multi Workspace",
    backgroundColor: "#0f0f0f",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile("renderer.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
    layoutPanes();
  });

  mainWindow.on("resize", () => {
    layoutPanes();
  });

  mainWindow.on("maximize", () => {
    layoutPanes();
  });

  mainWindow.on("unmaximize", () => {
    layoutPanes();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  appConfig = loadConfig();
  appConfig.paneCount = clampPaneCount(appConfig.paneCount || DEFAULT_PANE_COUNT);

  session.fromPartition(CHATGPT_PARTITION);

  createAppMenu();
  registerGlobalShortcuts();
  createMainWindow();

  createSidebarController();

  for (let i = 0; i < appConfig.paneCount; i++) {
    createPane(i);
  }

  layoutPanes();
  updateWindowTitle();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createSidebarController();

      for (let i = 0; i < appConfig.paneCount; i++) {
        ensurePaneExists(i);
      }

      layoutPanes();
      updateWindowTitle();
    }
  });
});

app.on("before-quit", () => {
  saveConfigNow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});