const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain
} = require("electron");

const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION =
  "persist:chatgpt-shared";

const SIDEBAR_WIDTH = 260;
const MANUAL_EXPANDED_WIDTH = 620;
const MAX_POPUP_RECTS = 24;

/*
 * 使用者按下關閉後，短時間忽略舊的 dialog 回報，
 * 避免關閉動畫期間又立刻重新鎖定。
 */
const CLOSE_UNLOCK_SUPPRESSION_MS = 900;

const OVERLAY_TRANSPARENCY_CSS = `
  html,
  body,
  #root,
  #__next,
  body > div {
    background-color: transparent !important;
  }

  main,
  [role="main"] {
    background-color: transparent !important;
  }
`;

let workspaceWindow = null;
let sidebarOverlayWindow = null;

let popupRects = [];
let lockedDialogRect = null;

let manualExpanded = false;
let suppressDialogLockUntil = 0;
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
    x + Math.max(
      0,
      Math.ceil(sourceWidth)
    )
  );

  const bottom = Math.min(
    windowBounds.height,
    y + Math.max(
      0,
      Math.ceil(sourceHeight)
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
      "[PoC v3.2] BrowserWindow.setShape unavailable"
    );

    return;
  }

  const bounds =
    sidebarOverlayWindow.getBounds();

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
      .map((rect) =>
        sanitizeRect(rect, bounds)
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
        sanitizeRect(
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

    console.log(
      `[PoC v3.2] shape applied: ` +
      `dialogLocked=${Boolean(lockedDialogRect)}, ` +
      `popupRects=${popupRects.length}`
    );
  } catch (error) {
    console.error(
      "[PoC v3.2] setShape failed:",
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

  suppressDialogLockUntil =
    Date.now() +
    CLOSE_UNLOCK_SUPPRESSION_MS;

  popupRects = [];

  applyOverlayShape();

  console.log(
    "[PoC v3.2] dialog shape unlocked"
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
        "sidebar-shape-preload-v3.2.js"
      ),

      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  sidebarOverlayWindow.webContents.on(
    "did-start-navigation",
    (...navigationArgs) => {
      /*
      * ChatGPT 的設定分頁可能使用 pushState／replaceState
      * 進行頁內導航。did-start-navigation 也會在這類導航中觸發。
      *
      * 因此這裡絕對不能清除 lockedDialogRect，
      * 否則點選設定分頁時，設定視窗會立即被裁掉。
      */

      const details =
        navigationArgs.length > 0 &&
        navigationArgs[0] &&
        typeof navigationArgs[0] === "object"
          ? navigationArgs[0]
          : null;

      console.log(
        "[PoC v3.2] navigation started:",
        {
          url: details?.url,
          isSameDocument: details?.isSameDocument,
          isMainFrame: details?.isMainFrame,
          dialogLocked: Boolean(lockedDialogRect)
        }
      );

      /*
      * 暫時的小型選單可以清除，
      * 但大型設定／搜尋視窗鎖定必須保留。
      */
      popupRects = [];

      applyOverlayShape();
    }
  );

  sidebarOverlayWindow.webContents.on(
  "did-finish-load",
  async () => {
    /*
     * 清除暫時的小型選單狀態即可。
     *
     * 不清除 lockedDialogRect：
     * ChatGPT 若在設定內部重新載入或重新建立頁面，
     * 大型設定視窗仍要維持原本裁切範圍。
     */
    popupRects = [];
    manualExpanded = false;

    /*
     * 只有目前沒有大型視窗鎖定時，
     * 才清除先前的抑制時間。
     */
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
        "[PoC v3.2] transparency CSS failed:",
        error.message
      );
    }

    syncOverlayBounds();
    sidebarOverlayWindow.show();

    console.log(
      "[PoC v3.2] ChatGPT overlay loaded",
      {
        dialogLocked: Boolean(lockedDialogRect)
      }
    );
  }
);

  sidebarOverlayWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(
        "[PoC v3.2] sidebar renderer stopped:",
        details
      );
    }
  );

  sidebarOverlayWindow.loadURL(
    CHATGPT_URL
  );
}

function createWorkspaceWindow() {
  workspaceWindow = new BrowserWindow({
    width: 1400,
    height: 900,

    minWidth: 1000,
    minHeight: 650,

    show: false,
    title: "Shaped Sidebar PoC v3.2",
    backgroundColor: "#111111",

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  workspaceWindow.loadFile(
    path.join(
      __dirname,
      "poc-background.html"
    )
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
    if (
      isUsableWindow(
        sidebarOverlayWindow
      )
    ) {
      sidebarOverlayWindow.moveTop();
    }
  });

  workspaceWindow.on("restore", () => {
    scheduleOverlaySync();

    if (
      isUsableWindow(
        sidebarOverlayWindow
      )
    ) {
      sidebarOverlayWindow.showInactive();
    }
  });

  workspaceWindow.on("minimize", () => {
    if (
      isUsableWindow(
        sidebarOverlayWindow
      )
    ) {
      sidebarOverlayWindow.hide();
    }
  });

  workspaceWindow.on("closed", () => {
    workspaceWindow = null;

    if (
      isUsableWindow(
        sidebarOverlayWindow
      )
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
    const registered =
      globalShortcut.register(
        accelerator,
        callback
      );

    console.log(
      `[PoC v3.2] shortcut ${label}: ` +
      `${accelerator}, ` +
      `registered=${registered}`
    );
  } catch (error) {
    console.error(
      `[PoC v3.2] shortcut ${label} failed:`,
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
    "automatic-shape"
  );

  /*
   * 如果 X／Esc 偵測失敗，可以按 F6 手動解除
   * 大型設定視窗裁切鎖。
   */
  registerShortcut(
    "F6",
    unlockDialogShape,
    "force-unlock-dialog"
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
    if (
      !isUsableWindow(
        sidebarOverlayWindow
      )
    ) {
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
      sanitizeRect(
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

    /*
     * 第一次偵測到大型視窗後，由主程序永久保存。
     * 後續空白或縮小的 DOM 回報不會清除它。
     */
    if (
      !lockedDialogRect &&
      nextDialogRect &&
      Date.now() >=
        suppressDialogLockUntil
    ) {
      lockedDialogRect =
        nextDialogRect;

      console.log(
        "[PoC v3.2] dialog shape locked:",
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
    if (
      !isUsableWindow(
        sidebarOverlayWindow
      )
    ) {
      return;
    }

    if (
      event.sender.id !==
      sidebarOverlayWindow.webContents.id
    ) {
      return;
    }

    unlockDialogShape();
  }
);

app.whenReady().then(() => {
  console.log(
    "[PoC v3.2] Electron:",
    process.versions.electron
  );

  console.log(
    "[PoC v3.2] userData:",
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
    "chatgpt-sidebar-shape-state"
  );

  ipcMain.removeAllListeners(
    "chatgpt-sidebar-dialog-close-intent"
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
