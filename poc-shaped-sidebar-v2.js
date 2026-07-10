const {
  app,
  BrowserWindow,
  globalShortcut
} = require("electron");

const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 260;
const EXPANDED_SHAPE_WIDTH = 620;

let workspaceWindow = null;
let sidebarOverlayWindow = null;
let expandedShape = false;
let syncTimer = null;

/*
 * 明確固定 userData 位置，避免 PoC 與原專案因啟動方式不同，
 * 使用到不同的 Cookie 與登入資料目錄。
 */
const USER_DATA_PATH = path.join(
  app.getPath("appData"),
  "chatgpt-multi-window"
);

app.setPath("userData", USER_DATA_PATH);

function isUsableWindow(win) {
  return Boolean(win && !win.isDestroyed());
}

function installDebugMarker() {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  const script = `
    (() => {
      const existing = document.getElementById(
        "chatgpt-shaped-window-debug-marker"
      );

      if (existing) {
        existing.remove();
      }

      const marker = document.createElement("div");

      marker.id = "chatgpt-shaped-window-debug-marker";
      marker.textContent = "EXPANDED SHAPE TEST";

      marker.style.position = "fixed";
      marker.style.left = "${SIDEBAR_WIDTH + 16}px";
      marker.style.top = "12px";
      marker.style.padding = "7px 10px";
      marker.style.border = "1px solid rgba(239, 68, 68, 0.8)";
      marker.style.borderRadius = "6px";
      marker.style.background = "rgba(127, 29, 29, 0.86)";
      marker.style.color = "#ffffff";
      marker.style.fontFamily =
        '"Segoe UI", "Microsoft JhengHei", sans-serif';
      marker.style.fontSize = "12px";
      marker.style.fontWeight = "700";
      marker.style.pointerEvents = "none";
      marker.style.zIndex = "2147483647";

      document.documentElement.appendChild(marker);

      return true;
    })();
  `;

  sidebarOverlayWindow.webContents
    .executeJavaScript(script, true)
    .catch((error) => {
      console.error(
        "[PoC v2] debug marker failed:",
        error.message
      );
    });
}

function applyOverlayShape() {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  if (typeof sidebarOverlayWindow.setShape !== "function") {
    console.error(
      "[PoC v2] BrowserWindow.setShape() is unavailable."
    );

    return;
  }

  const bounds = sidebarOverlayWindow.getBounds();

  const requestedWidth = expandedShape
    ? EXPANDED_SHAPE_WIDTH
    : SIDEBAR_WIDTH;

  const shapeWidth = Math.min(
    requestedWidth,
    bounds.width
  );

  try {
    sidebarOverlayWindow.setShape([
      {
        x: 0,
        y: 0,
        width: shapeWidth,
        height: bounds.height
      }
    ]);

    console.log(
      `[PoC v2] shape=${
        expandedShape ? "expanded" : "collapsed"
      }, width=${shapeWidth}`
    );
  } catch (error) {
    console.error(
      "[PoC v2] setShape failed:",
      error.message
    );
  }
}

function setExpandedShape(expanded) {
  expandedShape = Boolean(expanded);
  applyOverlayShape();
}

function syncOverlayBounds() {
  if (
    !isUsableWindow(workspaceWindow) ||
    !isUsableWindow(sidebarOverlayWindow)
  ) {
    return;
  }

  const contentBounds = workspaceWindow.getContentBounds();

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
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncOverlayBounds();
  }, 30);
}

function handleTestKey(input, event) {
  if (!input || input.type !== "keyDown") {
    return;
  }

  if (input.key === "F8") {
    event.preventDefault();
    setExpandedShape(true);
  }

  if (input.key === "F7") {
    event.preventDefault();
    setExpandedShape(false);
  }
}

function attachLocalTestShortcuts(webContents) {
  webContents.on(
    "before-input-event",
    (event, input) => {
      handleTestKey(input, event);
    }
  );
}

function createSidebarOverlayWindow() {
  if (!isUsableWindow(workspaceWindow)) {
    return;
  }

  const contentBounds = workspaceWindow.getContentBounds();

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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  attachLocalTestShortcuts(
    sidebarOverlayWindow.webContents
  );

  sidebarOverlayWindow.on("focus", () => {
    console.log("[PoC v2] sidebar overlay focused");
  });

  sidebarOverlayWindow.on("blur", () => {
    console.log("[PoC v2] sidebar overlay blurred");
  });

  sidebarOverlayWindow.webContents.on(
    "did-finish-load",
    async () => {
      installDebugMarker();

      /*
       * 先套用 shape，再顯示視窗，避免完整 ChatGPT 頁面
       * 在啟動瞬間閃現。
       */
      syncOverlayBounds();

      /*
       * 使用 show()，而不是 showInactive()。
       * 讓官方 ChatGPT 側欄可以正常取得焦點。
       */
      sidebarOverlayWindow.show();

      console.log(
        "[PoC v2] ChatGPT overlay loaded"
      );

      console.log(
        "[PoC v2] userData:",
        app.getPath("userData")
      );
    }
  );

  sidebarOverlayWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(
        "[PoC v2] sidebar renderer stopped:",
        details
      );
    }
  );

  sidebarOverlayWindow.loadURL(CHATGPT_URL);
}

function createWorkspaceWindow() {
  workspaceWindow = new BrowserWindow({
    width: 1400,
    height: 900,

    minWidth: 1000,
    minHeight: 650,

    show: false,
    title: "Shaped Sidebar PoC v2",
    backgroundColor: "#111111",

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  attachLocalTestShortcuts(
    workspaceWindow.webContents
  );

  workspaceWindow.loadFile(
    path.join(__dirname, "poc-background.html")
  );

  workspaceWindow.once("ready-to-show", () => {
    workspaceWindow.maximize();
    workspaceWindow.show();

    createSidebarOverlayWindow();
  });

  workspaceWindow.on("move", scheduleOverlaySync);
  workspaceWindow.on("resize", scheduleOverlaySync);
  workspaceWindow.on("maximize", scheduleOverlaySync);
  workspaceWindow.on("unmaximize", scheduleOverlaySync);

  workspaceWindow.on("focus", () => {
    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.moveTop();
    }
  });

  workspaceWindow.on("restore", () => {
    scheduleOverlaySync();

    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.showInactive();
    }
  });

  workspaceWindow.on("minimize", () => {
    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.hide();
    }
  });

  workspaceWindow.on("show", scheduleOverlaySync);

  workspaceWindow.on("closed", () => {
    workspaceWindow = null;

    if (isUsableWindow(sidebarOverlayWindow)) {
      sidebarOverlayWindow.destroy();
    }

    sidebarOverlayWindow = null;
  });
}

function registerShortcut(
  accelerator,
  callback,
  label
) {
  try {
    const registered = globalShortcut.register(
      accelerator,
      callback
    );

    console.log(
      `[PoC v2] shortcut ${label}: ` +
      `${accelerator}, registered=${registered}`
    );

    return registered;
  } catch (error) {
    console.error(
      `[PoC v2] shortcut ${label} failed:`,
      error.message
    );

    return false;
  }
}

function registerShortcuts() {
  registerShortcut(
    "CommandOrControl+Alt+O",
    () => setExpandedShape(true),
    "expand-ctrl-alt-o"
  );

  registerShortcut(
    "CommandOrControl+Alt+P",
    () => setExpandedShape(false),
    "collapse-ctrl-alt-p"
  );

  registerShortcut(
    "F8",
    () => setExpandedShape(true),
    "expand-f8"
  );

  registerShortcut(
    "F7",
    () => setExpandedShape(false),
    "collapse-f7"
  );

  registerShortcut(
    "CommandOrControl+Alt+Q",
    () => app.quit(),
    "quit"
  );
}

app.whenReady().then(() => {
  console.log(
    "[PoC v2] Electron:",
    process.versions.electron
  );

  console.log(
    "[PoC v2] userData:",
    app.getPath("userData")
  );

  registerShortcuts();
  createWorkspaceWindow();
});

app.on("will-quit", () => {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
