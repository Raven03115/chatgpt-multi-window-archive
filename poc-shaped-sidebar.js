const {
  app,
  BrowserWindow,
  globalShortcut
} = require("electron");

const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 280;
const EXPANDED_SHAPE_WIDTH = 620;

let workspaceWindow = null;
let sidebarOverlayWindow = null;
let expandedShape = false;
let syncTimer = null;

const OVERLAY_CSS = `
  html,
  body,
  #root,
  #__next {
    background: transparent !important;
  }

  main,
  [role="main"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

function applyOverlayShape() {
  if (
    !sidebarOverlayWindow ||
    sidebarOverlayWindow.isDestroyed()
  ) {
    return;
  }

  if (typeof sidebarOverlayWindow.setShape !== "function") {
    console.error(
      "[PoC] BrowserWindow.setShape() is not available in this Electron version."
    );

    return;
  }

  const bounds = sidebarOverlayWindow.getBounds();

  const shapeWidth = Math.min(
    expandedShape
      ? EXPANDED_SHAPE_WIDTH
      : SIDEBAR_WIDTH,
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
      `[PoC] shape=${expandedShape ? "expanded" : "sidebar"} width=${shapeWidth}`
    );
  } catch (error) {
    console.error("[PoC] setShape failed:", error);
  }
}

function syncOverlayBounds() {
  if (
    !workspaceWindow ||
    workspaceWindow.isDestroyed() ||
    !sidebarOverlayWindow ||
    sidebarOverlayWindow.isDestroyed()
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

function createSidebarOverlayWindow() {
  if (
    !workspaceWindow ||
    workspaceWindow.isDestroyed()
  ) {
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
    autoHideMenuBar: true,

    webPreferences: {
      partition: CHATGPT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  sidebarOverlayWindow.webContents.on(
    "did-finish-load",
    async () => {
      try {
        await sidebarOverlayWindow.webContents.insertCSS(
          OVERLAY_CSS
        );
      } catch (error) {
        console.error(
          "[PoC] CSS injection failed:",
          error
        );
      }

      syncOverlayBounds();
      sidebarOverlayWindow.showInactive();

      console.log("[PoC] ChatGPT sidebar overlay loaded.");
    }
  );

  sidebarOverlayWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(
        "[PoC] sidebar renderer stopped:",
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
    title: "Shaped Sidebar PoC",
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

  workspaceWindow.once("ready-to-show", () => {
    workspaceWindow.maximize();
    workspaceWindow.show();

    createSidebarOverlayWindow();
  });

  workspaceWindow.on("move", scheduleOverlaySync);
  workspaceWindow.on("resize", scheduleOverlaySync);
  workspaceWindow.on("maximize", scheduleOverlaySync);
  workspaceWindow.on("unmaximize", scheduleOverlaySync);
  workspaceWindow.on("restore", () => {
    scheduleOverlaySync();

    if (
      sidebarOverlayWindow &&
      !sidebarOverlayWindow.isDestroyed()
    ) {
      sidebarOverlayWindow.showInactive();
    }
  });

  workspaceWindow.on("minimize", () => {
    if (
      sidebarOverlayWindow &&
      !sidebarOverlayWindow.isDestroyed()
    ) {
      sidebarOverlayWindow.hide();
    }
  });

  workspaceWindow.on("show", scheduleOverlaySync);

  workspaceWindow.on("closed", () => {
    workspaceWindow = null;

    if (
      sidebarOverlayWindow &&
      !sidebarOverlayWindow.isDestroyed()
    ) {
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
      `[PoC] shortcut ${label}: ${accelerator}, registered=${registered}`
    );
  } catch (error) {
    console.error(
      `[PoC] shortcut ${label} failed:`,
      error
    );
  }
}

function registerShortcuts() {
  registerShortcut(
    "CommandOrControl+Alt+O",
    () => {
      expandedShape = true;
      applyOverlayShape();
    },
    "expand-shape"
  );

  registerShortcut(
    "CommandOrControl+Alt+P",
    () => {
      expandedShape = false;
      applyOverlayShape();
    },
    "collapse-shape"
  );

  registerShortcut(
    "CommandOrControl+Alt+Q",
    () => {
      app.quit();
    },
    "quit-poc"
  );
}

app.whenReady().then(() => {
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
