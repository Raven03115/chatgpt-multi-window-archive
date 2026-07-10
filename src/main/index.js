const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const PARTITION = "persist:chatgpt-shared";
const MAX_PANES = 6;
const MIN_W = 380;
const MIN_H = 480;
const TOOLBAR_W = 820;
const TOOLBAR_H = 188;
const GAP = 8;

app.setPath("userData", path.join(app.getPath("appData"), "chatgpt-multi-window"));
const CONFIG_PATH = path.join(app.getPath("userData"), "floating-workspace-v5.json");

let controller = null;
const panes = new Map();
let quitting = false;
let applyingLayout = false;
let saveTimer = null;

function defaultState() {
  return {
    paneCount: 2,
    layoutMode: "floating",
    layoutLocked: false,
    activePaneId: 1,
    panes: Array.from({ length: MAX_PANES }, (_, i) => ({
      id: i + 1,
      visible: i < 2,
      url: CHATGPT_URL,
      bounds: null
    }))
  };
}

let state = defaultState();

function clamp(n, min, max, fallback) {
  n = Number(n);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

function validChatGPTUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && u.hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const probe = {
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Math.max(1, Number(bounds.width) || 1),
    height: Math.max(1, Number(bounds.height) || 1)
  };
  const area = screen.getDisplayMatching(probe).workArea;
  const width = clamp(bounds.width, MIN_W, Math.max(MIN_W, area.width), 720);
  const height = clamp(bounds.height, MIN_H, Math.max(MIN_H, area.height), 760);
  const x = clamp(bounds.x, area.x - width + 80, area.x + area.width - 80, area.x + 24);
  const y = clamp(bounds.y, area.y, area.y + area.height - 80, area.y + 90);
  return { x, y, width, height };
}

function normalizeState(raw) {
  const next = defaultState();
  if (!raw || typeof raw !== "object") return next;

  next.paneCount = clamp(raw.paneCount, 1, MAX_PANES, 2);
  next.layoutMode = raw.layoutMode === "tiled" ? "tiled" : "floating";
  next.layoutLocked = Boolean(raw.layoutLocked);
  next.activePaneId = clamp(raw.activePaneId, 1, next.paneCount, 1);

  const input = Array.isArray(raw.panes) ? raw.panes : [];
  next.panes = Array.from({ length: MAX_PANES }, (_, i) => {
    const id = i + 1;
    const old = input.find((x) => Number(x?.id) === id) || {};
    return {
      id,
      visible: id <= next.paneCount ? old.visible !== false : false,
      url: validChatGPTUrl(old.url) ? old.url : CHATGPT_URL,
      bounds: normalizeBounds(old.bounds)
    };
  });
  return next;
}

function loadState() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return defaultState();
    return normalizeState(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  } catch (error) {
    console.error("[v5.0-A] config load failed:", error.message);
    return defaultState();
  }
}

function saveNow() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    console.error("[v5.0-A] config save failed:", error.message);
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function paneState(id) {
  return state.panes.find((p) => p.id === id);
}

function usable(win) {
  return Boolean(win && !win.isDestroyed());
}

function publicState() {
  return {
    paneCount: state.paneCount,
    layoutMode: state.layoutMode,
    layoutLocked: state.layoutLocked,
    activePaneId: state.activePaneId,
    configPath: CONFIG_PATH,
    panes: state.panes.filter((p) => p.id <= state.paneCount).map((p) => {
      const win = panes.get(p.id);
      return {
        id: p.id,
        visible: usable(win) ? win.isVisible() : p.visible,
        minimized: usable(win) ? win.isMinimized() : false,
        url: p.url,
        bounds: usable(win) ? win.getBounds() : p.bounds
      };
    })
  };
}

function broadcastState() {
  if (usable(controller) && !controller.webContents.isDestroyed()) {
    controller.webContents.send("workspace:state", publicState());
  }
}

function broadcastActive() {
  for (const [id, win] of panes) {
    if (usable(win)) win.webContents.send("workspace:pane-active", id === state.activePaneId);
  }
  broadcastState();
}

function setActive(id) {
  state.activePaneId = clamp(id, 1, state.paneCount, state.activePaneId);
  saveSoon();
  broadcastActive();
}

function updateBounds(id) {
  const win = panes.get(id);
  const p = paneState(id);
  if (!usable(win) || !p) return;
  p.bounds = win.getBounds();
  saveSoon();
  broadcastState();
}

function updateUrl(id, url) {
  if (!validChatGPTUrl(url)) return;
  const p = paneState(id);
  if (!p) return;
  p.url = url;
  saveSoon();
  broadcastState();
}

function defaultFloatingBounds(id) {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(760, Math.max(MIN_W, Math.floor(a.width * 0.48)));
  const height = Math.min(820, Math.max(MIN_H, Math.floor(a.height * 0.76)));
  const o = (id - 1) * 34;
  return {
    x: Math.min(a.x + a.width - width - 12, a.x + 36 + o),
    y: Math.min(a.y + a.height - height - 12, a.y + TOOLBAR_H + 24 + o),
    width,
    height
  };
}

function createPane(id) {
  const current = panes.get(id);
  if (usable(current)) return current;

  const p = paneState(id);
  const bounds = normalizeBounds(p.bounds) || defaultFloatingBounds(id);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    frame: true,
    movable: !state.layoutLocked,
    resizable: !state.layoutLocked,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: `ChatGPT Pane ${id}`,
    backgroundColor: "#212121",
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "..", "preload", "pane-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  win.removeMenu();
  panes.set(id, win);

  win.on("focus", () => setActive(id));
  win.on("move", () => { if (!applyingLayout) updateBounds(id); });
  win.on("resize", () => { if (!applyingLayout) updateBounds(id); });
  win.on("minimize", broadcastState);
  win.on("restore", () => { setActive(id); broadcastState(); });
  win.on("show", () => { p.visible = true; saveSoon(); broadcastState(); });
  win.on("hide", () => { p.visible = false; saveSoon(); broadcastState(); });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => panes.delete(id));

  win.webContents.on("did-navigate", (_e, url) => updateUrl(id, url));
  win.webContents.on("did-navigate-in-page", (_e, url, mainFrame) => {
    if (mainFrame) updateUrl(id, url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (validChatGPTUrl(url)) win.loadURL(url);
    else shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (validChatGPTUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  win.once("ready-to-show", () => {
    if (p.visible) win.show();
    broadcastActive();
  });

  win.loadURL(p.url || CHATGPT_URL).catch((error) => {
    console.error(`[v5.0-A] pane ${id} load failed:`, error.message);
  });
  return win;
}

function showPane(id, focus = false) {
  if (id < 1 || id > state.paneCount) return;
  const p = paneState(id);
  const win = createPane(id);
  p.visible = true;
  if (win.isMinimized()) win.restore();
  win.show();
  if (focus) {
    win.focus();
    setActive(id);
  }
  saveSoon();
}

function hidePane(id) {
  const p = paneState(id);
  const win = panes.get(id);
  if (!p) return;
  p.visible = false;
  if (usable(win)) win.hide();
  saveSoon();
  broadcastState();
}

function showAll() {
  for (let id = 1; id <= state.paneCount; id += 1) showPane(id);
  showPane(state.activePaneId, true);
}

function hideAll() {
  for (let id = 1; id <= state.paneCount; id += 1) hidePane(id);
  if (usable(controller)) {
    controller.show();
    controller.focus();
  }
}

function tileBounds(count) {
  const a = screen.getPrimaryDisplay().workArea;
  const area = {
    x: a.x + GAP,
    y: a.y + TOOLBAR_H + GAP * 2,
    width: a.width - GAP * 2,
    height: a.height - TOOLBAR_H - GAP * 3
  };

  function grid(cols, rows) {
    const cw = Math.floor((area.width - GAP * (cols - 1)) / cols);
    const ch = Math.floor((area.height - GAP * (rows - 1)) / rows);
    return Array.from({ length: count }, (_, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return {
        x: area.x + c * (cw + GAP),
        y: area.y + r * (ch + GAP),
        width: c === cols - 1 ? area.width - c * (cw + GAP) : cw,
        height: r === rows - 1 ? area.height - r * (ch + GAP) : ch
      };
    });
  }

  if (count === 1) return [{ ...area }];
  if (count === 2) return grid(2, 1);
  if (count === 3) return grid(3, 1);
  if (count === 4) return grid(2, 2);
  if (count === 6) return grid(3, 2);

  const topH = Math.floor((area.height - GAP) / 2);
  const topW = Math.floor((area.width - GAP * 2) / 3);
  const bottomW = Math.floor((area.width - GAP) / 2);
  return [
    ...Array.from({ length: 3 }, (_, i) => ({
      x: area.x + i * (topW + GAP),
      y: area.y,
      width: i === 2 ? area.width - i * (topW + GAP) : topW,
      height: topH
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      x: area.x + i * (bottomW + GAP),
      y: area.y + topH + GAP,
      width: i === 1 ? area.width - bottomW - GAP : bottomW,
      height: area.height - topH - GAP
    }))
  ];
}

function arrange() {
  const list = tileBounds(state.paneCount);
  applyingLayout = true;
  try {
    for (let id = 1; id <= state.paneCount; id += 1) {
      const p = paneState(id);
      const win = createPane(id);
      p.visible = true;
      p.bounds = list[id - 1];
      if (win.isMinimized()) win.restore();
      win.setBounds(list[id - 1], false);
      win.show();
    }
  } finally {
    setTimeout(() => {
      applyingLayout = false;
      saveNow();
      broadcastState();
    }, 120);
  }
}

function setLocked(value) {
  state.layoutLocked = Boolean(value);
  for (const win of panes.values()) {
    if (!usable(win)) continue;
    win.setMovable(!state.layoutLocked);
    win.setResizable(!state.layoutLocked);
  }
  saveNow();
  broadcastState();
}

function setMode(mode) {
  state.layoutMode = mode === "tiled" ? "tiled" : "floating";
  if (state.layoutMode === "tiled") arrange();
  else {
    saveNow();
    broadcastState();
  }
}

function setCount(value) {
  const count = clamp(value, 1, MAX_PANES, state.paneCount);
  state.paneCount = count;
  if (state.activePaneId > count) state.activePaneId = count;

  for (let id = 1; id <= MAX_PANES; id += 1) {
    const p = paneState(id);
    if (id <= count) {
      p.visible = true;
      createPane(id);
    } else {
      p.visible = false;
      const win = panes.get(id);
      if (usable(win)) win.hide();
    }
  }

  if (state.layoutMode === "tiled") arrange();
  else {
    showAll();
    saveNow();
    broadcastState();
  }
}

function togglePane(id) {
  if (id < 1 || id > state.paneCount) return;
  const win = panes.get(id);
  if (usable(win) && win.isVisible()) hidePane(id);
  else showPane(id, true);
}

function positionController() {
  if (!usable(controller)) return;
  const a = screen.getPrimaryDisplay().workArea;
  controller.setBounds({
    x: a.x + Math.round((a.width - Math.min(TOOLBAR_W, a.width - GAP * 2)) / 2),
    y: a.y + GAP,
    width: Math.min(TOOLBAR_W, a.width - GAP * 2),
    height: TOOLBAR_H
  });
}

function createController() {
  controller = new BrowserWindow({
    width: TOOLBAR_W,
    height: TOOLBAR_H,
    minWidth: 620,
    minHeight: TOOLBAR_H,
    maxHeight: TOOLBAR_H,
    show: false,
    frame: true,
    resizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    title: "ChatGPT Floating Workspace v5.0-A",
    backgroundColor: "#171717",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "controller-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  controller.removeMenu();
  positionController();
  controller.loadFile(path.join(__dirname, "..", "..", "ui", "controller.html"));

  controller.once("ready-to-show", () => {
    controller.show();
    broadcastState();
  });
  controller.on("close", () => { quitting = true; });
  controller.on("closed", () => {
    controller = null;
    app.quit();
  });
}

function registerIpc() {
  ipcMain.handle("workspace:get-state", () => publicState());
  ipcMain.handle("workspace:set-pane-count", (_e, n) => { setCount(n); return publicState(); });
  ipcMain.handle("workspace:set-layout-mode", (_e, m) => { setMode(m); return publicState(); });
  ipcMain.handle("workspace:arrange", () => { arrange(); return publicState(); });
  ipcMain.handle("workspace:set-layout-locked", (_e, v) => { setLocked(v); return publicState(); });
  ipcMain.handle("workspace:show-all", () => { showAll(); return publicState(); });
  ipcMain.handle("workspace:hide-all", () => { hideAll(); return publicState(); });
  ipcMain.handle("workspace:focus-pane", (_e, id) => {
    id = clamp(id, 1, state.paneCount, state.activePaneId);
    showPane(id, true);
    return publicState();
  });
  ipcMain.handle("workspace:toggle-pane", (_e, id) => {
    togglePane(clamp(id, 1, state.paneCount, state.activePaneId));
    return publicState();
  });
}

app.whenReady().then(() => {
  state = loadState();
  registerIpc();
  createController();
  for (let id = 1; id <= state.paneCount; id += 1) createPane(id);
  setLocked(state.layoutLocked);
  if (state.layoutMode === "tiled") arrange();
  else {
    for (let id = 1; id <= state.paneCount; id += 1) {
      if (paneState(id).visible) showPane(id);
    }
  }
});

app.on("before-quit", () => {
  quitting = true;
  for (const [id, win] of panes) {
    if (!usable(win)) continue;
    const p = paneState(id);
    p.bounds = win.getBounds();
    p.visible = win.isVisible();
  }
  saveNow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
