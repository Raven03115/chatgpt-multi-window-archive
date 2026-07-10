const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain
} = require("electron");

const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 260;
const MANUAL_EXPANDED_WIDTH = 620;
const MAX_POPUP_RECTS = 24;

let workspaceWindow = null;
let sidebarOverlayWindow = null;

let popupRects = [];
let manualExpanded = false;
let syncTimer = null;

const USER_DATA_PATH = path.join(
  app.getPath("appData"),
  "chatgpt-multi-window"
);

app.setPath("userData", USER_DATA_PATH);

function isUsableWindow(window) {
  return Boolean(
    window &&
    !window.isDestroyed()
  );
}

function sanitizeRect(rect, windowBounds) {
  if (!rect || typeof rect !== "object") {
    return null;
  }

  const x = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(Number(rect.x) || 0)
  );

  const y = Math.max(
    0,
    Math.floor(Number(rect.y) || 0)
  );

  const right = Math.min(
    windowBounds.width,
    x + Math.max(
      0,
      Math.ceil(Number(rect.width) || 0)
    )
  );

  const bottom = Math.min(
    windowBounds.height,
    y + Math.max(
      0,
      Math.ceil(Number(rect.height) || 0)
    )
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

function applyOverlayShape() {
  if (!isUsableWindow(sidebarOverlayWindow)) {
    return;
  }

  if (
    typeof sidebarOverlayWindow.setShape !==
    "function"
  ) {
    console.error(
      "[PoC v3] BrowserWindow.setShape() is unavailable."
    );

    return;
  }

  const bounds = sidebarOverlayWindow.getBounds();

  let shapeRects;

  if (manualExpanded) {
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
      .map((rect) => sanitizeRect(rect, bounds))
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
      },
      ...sanitizedPopupRects
    ];
  }

  try {
    sidebarOverlayWindow.setShape(shapeRects);

    console.log(
      `[PoC v3] shape applied: ` +
      `manual=${manualExpanded}, ` +
      `popupRects=${popupRects.length}`
    );
  } catch (error) {
    console.error(
      "[PoC v3] setShape failed:",
      error.message
    );
  }
}

function setManualExpanded(expanded) {
  manualExpanded = Boolean(expanded);
  applyOverlayShape();
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
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
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
        "sidebar-shape-preload.js"
      ),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  sidebarOverlayWindow.webContents.on(
    "did-start-navigation",
    () => {
      popupRects = [];
      applyOverlayShape();
    }
  );

  sidebarOverlayWindow.webContents.on(
    "did-finish-load",
    () => {
      popupRects = [];
      manualExpanded = false;

      syncOverlayBounds();
      sidebarOverlayWindow.show();

      console.log(
        "[PoC v3] ChatGPT overlay loaded"
      );
    }
  );

  sidebarOverlayWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(
        "[PoC v3] sidebar renderer stopped:",
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
    title: "Shaped Sidebar PoC v3",
    backgroundColor: "#111111",

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  workspaceWindow.loadFile(
    path.join(__dirname, "poc-background.html")
  );

  workspaceWindow.once(
    "ready-to-show",
    () => {
      workspaceWindow.maximize();
      workspaceWindow.show();

      createSidebarOverlayWindow();
    }
  );

  workspaceWindow.on(
    "move",
    scheduleOverlaySync
  );

  workspaceWindow.on(
    "resize",
    scheduleOverlaySync
  );

  workspaceWindow.on(
    "maximize",
    scheduleOverlaySync
  );

  workspaceWindow.on(
    "unmaximize",
    scheduleOverlaySync
  );

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
      `[PoC v3] shortcut ${label}: ` +
      `${accelerator}, registered=${registered}`
    );
  } catch (error) {
    console.error(
      `[PoC v3] shortcut ${label} failed:`,
      error.message
    );
  }
}

function registerShortcuts() {
  registerShortcut(
    "F8",
    () => setManualExpanded(true),
    "force-expanded"
  );

  registerShortcut(
    "F7",
    () => setManualExpanded(false),
    "return-to-automatic"
  );

  registerShortcut(
    "CommandOrControl+Alt+O",
    () => setManualExpanded(true),
    "force-expanded-alt"
  );

  registerShortcut(
    "CommandOrControl+Alt+P",
    () => setManualExpanded(false),
    "return-to-automatic-alt"
  );

  registerShortcut(
    "CommandOrControl+Alt+Q",
    () => app.quit(),
    "quit"
  );
}

ipcMain.on(
  "chatgpt-sidebar-popup-rects",
  (event, rects) => {
    if (!isUsableWindow(sidebarOverlayWindow)) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    popupRects = Array.isArray(rects)
      ? rects.slice(0, MAX_POPUP_RECTS)
      : [];

    if (!manualExpanded) {
      applyOverlayShape();
    }
  }
);

app.whenReady().then(() => {
  console.log(
    "[PoC v3] Electron:",
    process.versions.electron
  );

  console.log(
    "[PoC v3] userData:",
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
  ipcMain.removeAllListeners(
    "chatgpt-sidebar-popup-rects"
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
