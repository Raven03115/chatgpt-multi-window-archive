const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell
} = require("electron");

const fs = require("fs");
const path = require("path");

const CHATGPT_URL = "https://chatgpt.com";
const PARTITION = "persist:chatgpt-shared";

const MAX_PANES = 6;

const FLOATING_MIN_WIDTH = 380;
const FLOATING_MIN_HEIGHT = 480;
const TILED_MIN_WIDTH = 280;
const TILED_MIN_HEIGHT = 300;

const TOOLBAR_WIDTH = 1060;
const TOOLBAR_HEIGHT = 230;
const GAP = 8;

app.setPath(
  "userData",
  path.join(
    app.getPath("appData"),
    "chatgpt-multi-window"
  )
);

const CONFIG_PATH = path.join(
  app.getPath("userData"),
  "floating-workspace-v5.json"
);

let controller = null;
const panes = new Map();

let quitting = false;
let applyingLayout = false;
let saveTimer = null;

function defaultTiledLayouts() {
  return {
    "1": {},
    "2": {
      x1: 0.5
    },
    "3": {
      x1: 1 / 3,
      x2: 2 / 3
    },
    "4": {
      x1: 0.5,
      y1: 0.5
    },
    "5": {
      y1: 0.5,
      topX1: 1 / 3,
      topX2: 2 / 3,
      bottomX1: 0.5
    },
    "6": {
      x1: 1 / 3,
      x2: 2 / 3,
      y1: 0.5
    }
  };
}

function defaultState() {
  return {
    version: 2,
    paneCount: 2,
    layoutMode: "floating",
    layoutLocked: false,
    activePaneId: 1,
    tiledLayouts: defaultTiledLayouts(),
    panes: Array.from(
      { length: MAX_PANES },
      (_unused, index) => ({
        id: index + 1,
        visible: index < 2,
        url: CHATGPT_URL,
        floatingBounds: null
      })
    )
  };
}

let state = defaultState();

function clamp(
  value,
  minimum,
  maximum,
  fallback
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(
      maximum,
      number
    )
  );
}

function clampInteger(
  value,
  minimum,
  maximum,
  fallback
) {
  return Math.floor(
    clamp(
      value,
      minimum,
      maximum,
      fallback
    )
  );
}

function validChatGPTUrl(url) {
  try {
    const parsed = new URL(
      String(url)
    );

    return (
      parsed.protocol === "https:" &&
      parsed.hostname ===
        "chatgpt.com"
    );
  } catch {
    return false;
  }
}

function normalizeFloatingBounds(
  bounds
) {
  if (
    !bounds ||
    typeof bounds !== "object"
  ) {
    return null;
  }

  const probe = {
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Math.max(
      1,
      Number(bounds.width) || 1
    ),
    height: Math.max(
      1,
      Number(bounds.height) || 1
    )
  };

  const area =
    screen.getDisplayMatching(
      probe
    ).workArea;

  const width = clampInteger(
    bounds.width,
    FLOATING_MIN_WIDTH,
    Math.max(
      FLOATING_MIN_WIDTH,
      area.width
    ),
    720
  );

  const height = clampInteger(
    bounds.height,
    FLOATING_MIN_HEIGHT,
    Math.max(
      FLOATING_MIN_HEIGHT,
      area.height
    ),
    760
  );

  const x = clampInteger(
    bounds.x,
    area.x - width + 80,
    area.x + area.width - 80,
    area.x + 24
  );

  const y = clampInteger(
    bounds.y,
    area.y,
    area.y + area.height - 80,
    area.y + 90
  );

  return {
    x,
    y,
    width,
    height
  };
}

function normalizeRatio(
  value,
  fallback
) {
  return clamp(
    value,
    0.05,
    0.95,
    fallback
  );
}

function normalizeStoredTiledLayout(
  count,
  raw
) {
  const defaults =
    defaultTiledLayouts()[
      String(count)
    ];

  const input =
    raw &&
    typeof raw === "object"
      ? raw
      : {};

  if (count === 1) {
    return {};
  }

  if (count === 2) {
    return {
      x1: normalizeRatio(
        input.x1,
        defaults.x1
      )
    };
  }

  if (count === 3) {
    return {
      x1: normalizeRatio(
        input.x1,
        defaults.x1
      ),
      x2: normalizeRatio(
        input.x2,
        defaults.x2
      )
    };
  }

  if (count === 4) {
    return {
      x1: normalizeRatio(
        input.x1,
        defaults.x1
      ),
      y1: normalizeRatio(
        input.y1,
        defaults.y1
      )
    };
  }

  if (count === 5) {
    return {
      y1: normalizeRatio(
        input.y1,
        defaults.y1
      ),
      topX1: normalizeRatio(
        input.topX1,
        defaults.topX1
      ),
      topX2: normalizeRatio(
        input.topX2,
        defaults.topX2
      ),
      bottomX1: normalizeRatio(
        input.bottomX1,
        defaults.bottomX1
      )
    };
  }

  return {
    x1: normalizeRatio(
      input.x1,
      defaults.x1
    ),
    x2: normalizeRatio(
      input.x2,
      defaults.x2
    ),
    y1: normalizeRatio(
      input.y1,
      defaults.y1
    )
  };
}

function normalizeState(raw) {
  const next = defaultState();

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return next;
  }

  next.paneCount =
    clampInteger(
      raw.paneCount,
      1,
      MAX_PANES,
      2
    );

  next.layoutMode =
    raw.layoutMode === "tiled"
      ? "tiled"
      : "floating";

  next.layoutLocked =
    Boolean(raw.layoutLocked);

  next.activePaneId =
    clampInteger(
      raw.activePaneId,
      1,
      next.paneCount,
      1
    );

  const rawTiledLayouts =
    raw.tiledLayouts &&
    typeof raw.tiledLayouts ===
      "object"
      ? raw.tiledLayouts
      : {};

  next.tiledLayouts =
    Object.fromEntries(
      Array.from(
        { length: MAX_PANES },
        (_unused, index) => {
          const count = index + 1;

          return [
            String(count),
            normalizeStoredTiledLayout(
              count,
              rawTiledLayouts[
                String(count)
              ]
            )
          ];
        }
      )
    );

  const input =
    Array.isArray(raw.panes)
      ? raw.panes
      : [];

  next.panes = Array.from(
    { length: MAX_PANES },
    (_unused, index) => {
      const id = index + 1;

      const old =
        input.find(
          (candidate) =>
            Number(
              candidate?.id
            ) === id
        ) || {};

      /*
       * v5.0-A used "bounds".
       * Migrate it into the new
       * floating-only bounds field.
       */
      const legacyBounds =
        old.floatingBounds ||
        old.bounds;

      return {
        id,
        visible:
          id <= next.paneCount
            ? old.visible !== false
            : false,
        url: validChatGPTUrl(
          old.url
        )
          ? old.url
          : CHATGPT_URL,
        floatingBounds:
          normalizeFloatingBounds(
            legacyBounds
          )
      };
    }
  );

  return next;
}

function loadState() {
  try {
    if (
      !fs.existsSync(
        CONFIG_PATH
      )
    ) {
      return defaultState();
    }

    return normalizeState(
      JSON.parse(
        fs.readFileSync(
          CONFIG_PATH,
          "utf8"
        )
      )
    );
  } catch (error) {
    console.error(
      "[v5.0-B] config load failed:",
      error.message
    );

    return defaultState();
  }
}

function saveNow() {
  try {
    fs.mkdirSync(
      app.getPath("userData"),
      { recursive: true }
    );

    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        state,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "[v5.0-B] config save failed:",
      error.message
    );
  }
}

function saveSoon() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(
    () => {
      saveTimer = null;
      saveNow();
    },
    250
  );
}

function paneState(id) {
  return state.panes.find(
    (pane) =>
      pane.id === id
  );
}

function usable(window) {
  return Boolean(
    window &&
    !window.isDestroyed()
  );
}

function currentTiledLayout() {
  return state.tiledLayouts[
    String(state.paneCount)
  ];
}

function effectiveLocked() {
  return (
    state.layoutMode === "tiled" ||
    state.layoutLocked
  );
}

function publicState() {
  return {
    version: state.version,
    paneCount: state.paneCount,
    layoutMode: state.layoutMode,
    layoutLocked:
      state.layoutLocked,
    effectiveLocked:
      effectiveLocked(),
    activePaneId:
      state.activePaneId,
    configPath: CONFIG_PATH,
    tiledLayout: {
      ...currentTiledLayout()
    },
    panes: state.panes
      .filter(
        (pane) =>
          pane.id <=
          state.paneCount
      )
      .map((pane) => {
        const window =
          panes.get(pane.id);

        return {
          id: pane.id,
          visible:
            usable(window)
              ? window.isVisible()
              : pane.visible,
          minimized:
            usable(window)
              ? window.isMinimized()
              : false,
          url: pane.url,
          bounds:
            usable(window)
              ? window.getBounds()
              : pane.floatingBounds,
          floatingBounds:
            pane.floatingBounds
        };
      })
  };
}

function broadcastState() {
  if (
    usable(controller) &&
    !controller.webContents
      .isDestroyed()
  ) {
    controller.webContents.send(
      "workspace:state",
      publicState()
    );
  }
}

function broadcastActive() {
  for (
    const [id, window]
    of panes.entries()
  ) {
    if (!usable(window)) {
      continue;
    }

    window.webContents.send(
      "workspace:pane-active",
      id === state.activePaneId
    );
  }

  broadcastState();
}

function setActive(id) {
  state.activePaneId =
    clampInteger(
      id,
      1,
      state.paneCount,
      state.activePaneId
    );

  saveSoon();
  broadcastActive();
}

function captureFloatingBounds(id) {
  if (
    state.layoutMode !==
    "floating" ||
    applyingLayout
  ) {
    return;
  }

  const window =
    panes.get(id);

  const pane =
    paneState(id);

  if (
    !usable(window) ||
    !pane
  ) {
    return;
  }

  pane.floatingBounds =
    normalizeFloatingBounds(
      window.getBounds()
    );

  saveSoon();
  broadcastState();
}

function captureAllFloatingBounds() {
  if (
    state.layoutMode !==
    "floating"
  ) {
    return;
  }

  for (
    let id = 1;
    id <= state.paneCount;
    id += 1
  ) {
    const pane =
      paneState(id);

    const window =
      panes.get(id);

    if (
      pane &&
      usable(window)
    ) {
      pane.floatingBounds =
        normalizeFloatingBounds(
          window.getBounds()
        );
    }
  }
}

function updateUrl(id, url) {
  if (!validChatGPTUrl(url)) {
    return;
  }

  const pane =
    paneState(id);

  if (!pane) {
    return;
  }

  pane.url = url;
  saveSoon();
  broadcastState();
}

function defaultFloatingBounds(id) {
  const area =
    screen.getPrimaryDisplay()
      .workArea;

  const width = Math.min(
    760,
    Math.max(
      FLOATING_MIN_WIDTH,
      Math.floor(
        area.width * 0.48
      )
    )
  );

  const height = Math.min(
    820,
    Math.max(
      FLOATING_MIN_HEIGHT,
      Math.floor(
        area.height * 0.76
      )
    )
  );

  const offset =
    (id - 1) * 34;

  return {
    x: Math.min(
      area.x +
        area.width -
        width -
        12,
      area.x + 36 + offset
    ),
    y: Math.min(
      area.y +
        area.height -
        height -
        12,
      area.y +
        TOOLBAR_HEIGHT +
        24 +
        offset
    ),
    width,
    height
  };
}

function applyPaneInteractionMode(
  window
) {
  if (!usable(window)) {
    return;
  }

  if (
    state.layoutMode === "tiled"
  ) {
    window.setMinimumSize(
      TILED_MIN_WIDTH,
      TILED_MIN_HEIGHT
    );

    window.setMovable(false);
    window.setResizable(false);
    window.setMaximizable(false);
    return;
  }

  window.setMinimumSize(
    FLOATING_MIN_WIDTH,
    FLOATING_MIN_HEIGHT
  );

  window.setMovable(
    !state.layoutLocked
  );

  window.setResizable(
    !state.layoutLocked
  );

  window.setMaximizable(
    !state.layoutLocked
  );
}

function createPane(id) {
  const current =
    panes.get(id);

  if (usable(current)) {
    return current;
  }

  const pane =
    paneState(id);

  const initialBounds =
    normalizeFloatingBounds(
      pane.floatingBounds
    ) ||
    defaultFloatingBounds(id);

  const window =
    new BrowserWindow({
      ...initialBounds,
      minWidth:
        FLOATING_MIN_WIDTH,
      minHeight:
        FLOATING_MIN_HEIGHT,
      show: false,
      frame: true,
      movable:
        state.layoutMode ===
          "floating" &&
        !state.layoutLocked,
      resizable:
        state.layoutMode ===
          "floating" &&
        !state.layoutLocked,
      maximizable:
        state.layoutMode ===
          "floating" &&
        !state.layoutLocked,
      skipTaskbar: true,
      autoHideMenuBar: true,
      title:
        `ChatGPT Pane ${id}`,
      backgroundColor: "#212121",
      webPreferences: {
        partition: PARTITION,
        preload: path.join(
          __dirname,
          "..",
          "preload",
          "pane-preload.js"
        ),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

  window.removeMenu();
  panes.set(id, window);

  window.on(
    "focus",
    () => setActive(id)
  );

  window.on(
    "move",
    () => {
      captureFloatingBounds(id);
    }
  );

  window.on(
    "resize",
    () => {
      captureFloatingBounds(id);
    }
  );

  window.on(
    "minimize",
    broadcastState
  );

  window.on(
    "restore",
    () => {
      setActive(id);
      broadcastState();
    }
  );

  window.on(
    "show",
    () => {
      pane.visible = true;
      saveSoon();
      broadcastState();
    }
  );

  window.on(
    "hide",
    () => {
      pane.visible = false;
      saveSoon();
      broadcastState();
    }
  );

  window.on(
    "close",
    (event) => {
      if (quitting) {
        return;
      }

      event.preventDefault();
      window.hide();
    }
  );

  window.on(
    "closed",
    () => {
      panes.delete(id);
    }
  );

  window.webContents.on(
    "did-navigate",
    (_event, url) => {
      updateUrl(id, url);
    }
  );

  window.webContents.on(
    "did-navigate-in-page",
    (
      _event,
      url,
      isMainFrame
    ) => {
      if (isMainFrame) {
        updateUrl(id, url);
      }
    }
  );

  window.webContents
    .setWindowOpenHandler(
      ({ url }) => {
        if (
          validChatGPTUrl(url)
        ) {
          window.loadURL(url);
        } else {
          shell
            .openExternal(url)
            .catch(() => {});
        }

        return {
          action: "deny"
        };
      }
    );

  window.webContents.on(
    "will-navigate",
    (event, url) => {
      if (
        validChatGPTUrl(url)
      ) {
        return;
      }

      event.preventDefault();

      shell
        .openExternal(url)
        .catch(() => {});
    }
  );

  window.once(
    "ready-to-show",
    () => {
      applyPaneInteractionMode(
        window
      );

      if (pane.visible) {
        window.show();
      }

      broadcastActive();
    }
  );

  window
    .loadURL(
      pane.url ||
      CHATGPT_URL
    )
    .catch((error) => {
      console.error(
        `[v5.0-B] pane ${id} load failed:`,
        error.message
      );
    });

  return window;
}

function showPane(
  id,
  focus = false
) {
  if (
    id < 1 ||
    id > state.paneCount
  ) {
    return;
  }

  const pane =
    paneState(id);

  const window =
    createPane(id);

  pane.visible = true;

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();

  if (focus) {
    window.focus();
    setActive(id);
  }

  saveSoon();
}

function hidePane(id) {
  const pane =
    paneState(id);

  const window =
    panes.get(id);

  if (!pane) {
    return;
  }

  pane.visible = false;

  if (usable(window)) {
    window.hide();
  }

  saveSoon();
  broadcastState();
}

function showAll() {
  for (
    let id = 1;
    id <= state.paneCount;
    id += 1
  ) {
    showPane(id);
  }

  showPane(
    state.activePaneId,
    true
  );
}

function hideAll() {
  for (
    let id = 1;
    id <= state.paneCount;
    id += 1
  ) {
    hidePane(id);
  }

  if (usable(controller)) {
    controller.show();
    controller.focus();
  }
}

function tileArea() {
  const workArea =
    screen.getPrimaryDisplay()
      .workArea;

  return {
    x:
      workArea.x +
      GAP,
    y:
      workArea.y +
      TOOLBAR_HEIGHT +
      GAP * 2,
    width:
      workArea.width -
      GAP * 2,
    height:
      workArea.height -
      TOOLBAR_HEIGHT -
      GAP * 3
  };
}

function minimumRatio(
  pixels,
  totalPixels
) {
  return Math.min(
    0.28,
    Math.max(
      0.10,
      (
        pixels +
        GAP
      ) /
        Math.max(
          1,
          totalPixels
        )
    )
  );
}

function normalizeTiledLayoutForArea(
  count,
  raw,
  area
) {
  const input =
    normalizeStoredTiledLayout(
      count,
      raw
    );

  const minimumX =
    minimumRatio(
      TILED_MIN_WIDTH,
      area.width
    );

  const minimumY =
    minimumRatio(
      TILED_MIN_HEIGHT,
      area.height
    );

  if (count === 1) {
    return {};
  }

  if (count === 2) {
    return {
      x1: clamp(
        input.x1,
        minimumX,
        1 - minimumX,
        0.5
      )
    };
  }

  if (count === 3) {
    const x1 = clamp(
      input.x1,
      minimumX,
      1 - minimumX * 2,
      1 / 3
    );

    const x2 = clamp(
      input.x2,
      x1 + minimumX,
      1 - minimumX,
      2 / 3
    );

    return {
      x1,
      x2
    };
  }

  if (count === 4) {
    return {
      x1: clamp(
        input.x1,
        minimumX,
        1 - minimumX,
        0.5
      ),
      y1: clamp(
        input.y1,
        minimumY,
        1 - minimumY,
        0.5
      )
    };
  }

  if (count === 5) {
    const topX1 = clamp(
      input.topX1,
      minimumX,
      1 - minimumX * 2,
      1 / 3
    );

    const topX2 = clamp(
      input.topX2,
      topX1 + minimumX,
      1 - minimumX,
      2 / 3
    );

    return {
      y1: clamp(
        input.y1,
        minimumY,
        1 - minimumY,
        0.5
      ),
      topX1,
      topX2,
      bottomX1: clamp(
        input.bottomX1,
        minimumX,
        1 - minimumX,
        0.5
      )
    };
  }

  const x1 = clamp(
    input.x1,
    minimumX,
    1 - minimumX * 2,
    1 / 3
  );

  const x2 = clamp(
    input.x2,
    x1 + minimumX,
    1 - minimumX,
    2 / 3
  );

  return {
    x1,
    x2,
    y1: clamp(
      input.y1,
      minimumY,
      1 - minimumY,
      0.5
    )
  };
}

function splitLength(
  totalLength,
  ratios,
  gapCount
) {
  const usableLength =
    Math.max(
      1,
      totalLength -
      GAP * gapCount
    );

  const boundaries = [
    0,
    ...ratios,
    1
  ];

  const lengths = [];

  for (
    let index = 0;
    index <
      boundaries.length - 1;
    index += 1
  ) {
    const start = Math.round(
      usableLength *
        boundaries[index]
    );

    const end =
      index ===
      boundaries.length - 2
        ? usableLength
        : Math.round(
            usableLength *
              boundaries[index + 1]
          );

    lengths.push(
      Math.max(
        1,
        end - start
      )
    );
  }

  return lengths;
}

function gridBounds(
  area,
  columns,
  rows
) {
  const columnWidths =
    splitLength(
      area.width,
      columns,
      columns.length
    );

  const rowHeights =
    splitLength(
      area.height,
      rows,
      rows.length
    );

  const result = [];

  let y = area.y;

  for (
    let row = 0;
    row <
      rowHeights.length;
    row += 1
  ) {
    let x = area.x;

    for (
      let column = 0;
      column <
        columnWidths.length;
      column += 1
    ) {
      result.push({
        x,
        y,
        width:
          columnWidths[column],
        height:
          rowHeights[row]
      });

      x +=
        columnWidths[column] +
        GAP;
    }

    y +=
      rowHeights[row] +
      GAP;
  }

  return result;
}

function tiledBounds(count) {
  const area = tileArea();

  const layout =
    normalizeTiledLayoutForArea(
      count,
      state.tiledLayouts[
        String(count)
      ],
      area
    );

  state.tiledLayouts[
    String(count)
  ] = layout;

  if (count === 1) {
    return [{
      ...area
    }];
  }

  if (count === 2) {
    return gridBounds(
      area,
      [layout.x1],
      []
    );
  }

  if (count === 3) {
    return gridBounds(
      area,
      [
        layout.x1,
        layout.x2
      ],
      []
    );
  }

  if (count === 4) {
    return gridBounds(
      area,
      [layout.x1],
      [layout.y1]
    );
  }

  if (count === 6) {
    return gridBounds(
      area,
      [
        layout.x1,
        layout.x2
      ],
      [layout.y1]
    );
  }

  /*
   * Five panes have independent
   * top and bottom row columns.
   */
  const rowHeights =
    splitLength(
      area.height,
      [layout.y1],
      1
    );

  const topArea = {
    x: area.x,
    y: area.y,
    width: area.width,
    height: rowHeights[0]
  };

  const bottomArea = {
    x: area.x,
    y:
      area.y +
      rowHeights[0] +
      GAP,
    width: area.width,
    height: rowHeights[1]
  };

  return [
    ...gridBounds(
      topArea,
      [
        layout.topX1,
        layout.topX2
      ],
      []
    ),
    ...gridBounds(
      bottomArea,
      [layout.bottomX1],
      []
    )
  ];
}

function applyInteractionModeToAll() {
  for (
    const window
    of panes.values()
  ) {
    applyPaneInteractionMode(
      window
    );
  }
}

function arrange() {
  const boundsList =
    tiledBounds(
      state.paneCount
    );

  applyingLayout = true;

  try {
    for (
      let id = 1;
      id <= state.paneCount;
      id += 1
    ) {
      const pane =
        paneState(id);

      const window =
        createPane(id);

      pane.visible = true;

      applyPaneInteractionMode(
        window
      );

      if (window.isMinimized()) {
        window.restore();
      }

      window.setBounds(
        boundsList[id - 1],
        false
      );

      window.show();
    }
  } finally {
    setTimeout(
      () => {
        applyingLayout = false;
        saveNow();
        broadcastState();
      },
      120
    );
  }
}

function restoreFloatingLayout() {
  applyingLayout = true;

  try {
    for (
      let id = 1;
      id <= state.paneCount;
      id += 1
    ) {
      const pane =
        paneState(id);

      const window =
        createPane(id);

      const bounds =
        normalizeFloatingBounds(
          pane.floatingBounds
        ) ||
        defaultFloatingBounds(id);

      pane.floatingBounds =
        bounds;

      applyPaneInteractionMode(
        window
      );

      window.setBounds(
        bounds,
        false
      );

      if (pane.visible) {
        if (window.isMinimized()) {
          window.restore();
        }

        window.show();
      } else {
        window.hide();
      }
    }
  } finally {
    setTimeout(
      () => {
        applyingLayout = false;
        saveNow();
        broadcastState();
      },
      120
    );
  }
}

function setLocked(value) {
  state.layoutLocked =
    Boolean(value);

  applyInteractionModeToAll();
  saveNow();
  broadcastState();
}

function setMode(mode) {
  const nextMode =
    mode === "tiled"
      ? "tiled"
      : "floating";

  if (
    nextMode ===
    state.layoutMode
  ) {
    if (
      nextMode === "tiled"
    ) {
      arrange();
    } else {
      restoreFloatingLayout();
    }

    return;
  }

  if (
    state.layoutMode ===
    "floating"
  ) {
    captureAllFloatingBounds();
  }

  state.layoutMode = nextMode;

  if (
    nextMode === "tiled"
  ) {
    arrange();
  } else {
    restoreFloatingLayout();
  }
}

function setCount(value) {
  const count =
    clampInteger(
      value,
      1,
      MAX_PANES,
      state.paneCount
    );

  if (
    state.layoutMode ===
    "floating"
  ) {
    captureAllFloatingBounds();
  }

  state.paneCount = count;

  if (
    state.activePaneId > count
  ) {
    state.activePaneId =
      count;
  }

  for (
    let id = 1;
    id <= MAX_PANES;
    id += 1
  ) {
    const pane =
      paneState(id);

    if (id <= count) {
      pane.visible = true;
      createPane(id);
    } else {
      pane.visible = false;

      const window =
        panes.get(id);

      if (usable(window)) {
        window.hide();
      }
    }
  }

  if (
    state.layoutMode === "tiled"
  ) {
    arrange();
  } else {
    restoreFloatingLayout();
    showAll();
  }
}

function setTiledLayout(patch) {
  if (
    !patch ||
    typeof patch !== "object"
  ) {
    return;
  }

  const key =
    String(state.paneCount);

  state.tiledLayouts[key] = {
    ...state.tiledLayouts[key],
    ...patch
  };

  if (
    state.layoutMode === "tiled"
  ) {
    arrange();
  } else {
    saveNow();
    broadcastState();
  }
}

function resetTiledLayout() {
  const key =
    String(state.paneCount);

  state.tiledLayouts[key] = {
    ...defaultTiledLayouts()[key]
  };

  if (
    state.layoutMode === "tiled"
  ) {
    arrange();
  } else {
    saveNow();
    broadcastState();
  }
}

function togglePane(id) {
  if (
    id < 1 ||
    id > state.paneCount
  ) {
    return;
  }

  const window =
    panes.get(id);

  if (
    usable(window) &&
    window.isVisible()
  ) {
    hidePane(id);
  } else {
    showPane(id, true);
  }
}

function positionController() {
  if (!usable(controller)) {
    return;
  }

  const area =
    screen.getPrimaryDisplay()
      .workArea;

  const width = Math.min(
    TOOLBAR_WIDTH,
    area.width - GAP * 2
  );

  controller.setBounds({
    x:
      area.x +
      Math.round(
        (
          area.width -
          width
        ) / 2
      ),
    y: area.y + GAP,
    width,
    height: TOOLBAR_HEIGHT
  });
}

function createController() {
  controller =
    new BrowserWindow({
      width: TOOLBAR_WIDTH,
      height: TOOLBAR_HEIGHT,
      minWidth: 720,
      minHeight:
        TOOLBAR_HEIGHT,
      maxHeight:
        TOOLBAR_HEIGHT,
      show: false,
      frame: true,
      resizable: true,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      autoHideMenuBar: true,
      title:
        "ChatGPT Floating Workspace v5.0-B",
      backgroundColor: "#171717",
      webPreferences: {
        preload: path.join(
          __dirname,
          "..",
          "preload",
          "controller-preload.js"
        ),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

  controller.removeMenu();
  positionController();

  controller.loadFile(
    path.join(
      __dirname,
      "..",
      "..",
      "ui",
      "controller.html"
    )
  );

  controller.once(
    "ready-to-show",
    () => {
      controller.show();
      broadcastState();
    }
  );

  controller.on(
    "close",
    () => {
      quitting = true;
    }
  );

  controller.on(
    "closed",
    () => {
      controller = null;
      app.quit();
    }
  );
}

function registerIpc() {
  ipcMain.handle(
    "workspace:get-state",
    () => publicState()
  );

  ipcMain.handle(
    "workspace:set-pane-count",
    (_event, count) => {
      setCount(count);
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:set-layout-mode",
    (_event, mode) => {
      setMode(mode);
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:arrange",
    () => {
      if (
        state.layoutMode !== "tiled"
      ) {
        setMode("tiled");
      } else {
        arrange();
      }

      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:set-layout-locked",
    (_event, value) => {
      setLocked(value);
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:set-tiled-layout",
    (_event, patch) => {
      setTiledLayout(patch);
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:reset-tiled-layout",
    () => {
      resetTiledLayout();
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:show-all",
    () => {
      showAll();
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:hide-all",
    () => {
      hideAll();
      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:focus-pane",
    (_event, id) => {
      const safeId =
        clampInteger(
          id,
          1,
          state.paneCount,
          state.activePaneId
        );

      showPane(
        safeId,
        true
      );

      return publicState();
    }
  );

  ipcMain.handle(
    "workspace:toggle-pane",
    (_event, id) => {
      togglePane(
        clampInteger(
          id,
          1,
          state.paneCount,
          state.activePaneId
        )
      );

      return publicState();
    }
  );
}

app.whenReady().then(() => {
  state = loadState();

  registerIpc();
  createController();

  for (
    let id = 1;
    id <= state.paneCount;
    id += 1
  ) {
    createPane(id);
  }

  applyInteractionModeToAll();

  if (
    state.layoutMode === "tiled"
  ) {
    arrange();
  } else {
    restoreFloatingLayout();
  }
});

app.on(
  "before-quit",
  () => {
    quitting = true;

    if (
      state.layoutMode ===
      "floating"
    ) {
      captureAllFloatingBounds();
    }

    saveNow();
  }
);

app.on(
  "window-all-closed",
  () => {
    if (
      process.platform !==
      "darwin"
    ) {
      app.quit();
    }
  }
);
