"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CHILD_ENV = "CHATGPT_MULTI_UI_AUDIT_CHILD";
const REPORT_NAME = "chatgpt-multi-pane-ui-audit.json";
const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

function runElectronChild() {
  let electronPath = null;

  try {
    const resolved = require("electron");
    electronPath = typeof resolved === "string" ? resolved : null;
  } catch {
    electronPath = null;
  }

  if (!electronPath || !fs.existsSync(electronPath)) {
    const fallback = path.join(
      __dirname,
      "..",
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron"
    );

    if (fs.existsSync(fallback)) {
      electronPath = fallback;
    }
  }

  if (!electronPath || !fs.existsSync(electronPath)) {
    console.error("UI AUDIT: FAILED");
    console.error(
      "找不到 Electron。請先在 D:\\chatgpt-multi-window 執行 npm install。"
    );
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(
    electronPath,
    [__filename],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        [CHILD_ENV]: "1"
      },
      windowsHide: false,
      shell: false
    }
  );

  if (result.error) {
    console.error("UI AUDIT: FAILED");
    console.error(result.error.message);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

if (process.env[CHILD_ENV] !== "1") {
  runElectronChild();
  return;
}

const {
  app,
  BrowserWindow
} = require("electron");

const USER_DATA_PATH = path.join(
  app.getPath("appData"),
  "chatgpt-multi-window"
);
app.setPath("userData", USER_DATA_PATH);

const reportPath = path.join(
  app.getPath("desktop"),
  REPORT_NAME
);

let auditWindow = null;
let auditStarted = false;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function writeReport(report) {
  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, null, 2),
    "utf8"
  );
}

async function evalInPage(source) {
  if (!auditWindow || auditWindow.isDestroyed()) {
    throw new Error("Audit window unavailable");
  }

  return auditWindow.webContents.executeJavaScript(
    source,
    true
  );
}

async function clickPoint(point) {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return false;
  }

  const x = Math.round(point.x);
  const y = Math.round(point.y);

  auditWindow.webContents.sendInputEvent({
    type: "mouseMove",
    x,
    y
  });
  await sleep(80);

  auditWindow.webContents.sendInputEvent({
    type: "mouseDown",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  auditWindow.webContents.sendInputEvent({
    type: "mouseUp",
    x,
    y,
    button: "left",
    clickCount: 1
  });

  return true;
}

async function pressEscape() {
  if (!auditWindow || auditWindow.isDestroyed()) {
    return;
  }

  auditWindow.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "ESCAPE"
  });
  auditWindow.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "ESCAPE"
  });
}

async function waitForPageReady(timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await evalInPage(`
        ({
          readyState: document.readyState,
          host: location.hostname,
          hasBody: Boolean(document.body),
          bodyTextLength: document.body?.innerText?.length || 0
        })
      `);

      if (
        state?.host === "chatgpt.com" &&
        state?.hasBody &&
        state?.bodyTextLength > 20 &&
        state?.readyState !== "loading"
      ) {
        return state;
      }
    } catch {
      // Renderer may still be navigating.
    }

    await sleep(250);
  }

  throw new Error("Timed out waiting for ChatGPT UI");
}

const installAuditHelpersSource = String.raw`
(() => {
  const KNOWN_UI_TOKENS = [
    "new chat", "new conversation", "新對話",
    "search", "搜尋", "settings", "設定",
    "scheduled", "schedule", "排程",
    "library", "檔案庫", "images", "image", "圖像",
    "maps", "map", "地圖",
    "plugins", "plugin", "外掛",
    "explore", "探索", "gpt",
    "rename", "重新命名",
    "project", "projects", "專案",
    "share", "分享", "archive", "封存",
    "delete", "刪除", "pin", "釘選",
    "cancel", "取消", "save", "儲存", "保存",
    "close", "關閉", "open", "開啟",
    "add", "新增", "create", "建立"
  ];

  const normalize = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const safeUiText = (value) => {
    const text = normalize(value).slice(0, 180);
    if (!text) return "";

    const lower = text.toLowerCase();
    const known = KNOWN_UI_TOKENS.some(
      (token) => lower.includes(token.toLowerCase())
    );

    return known ? text : "<redacted-user-text>";
  };

  const safeClassName = (value) =>
    normalize(value)
      .split(" ")
      .filter(Boolean)
      .slice(0, 12)
      .join(" ")
      .slice(0, 220);

  const sanitizeHref = (value) => {
    try {
      const parsed = new URL(value, location.href);
      let pathname = parsed.pathname;

      pathname = pathname
        .replace(
          /\/g\/[^/]+\/c\/[^/]+/g,
          "/g/:project/c/:conversation"
        )
        .replace(/\/g\/[^/]+/g, "/g/:project")
        .replace(/\/c\/[^/]+/g, "/c/:conversation")
        .replace(
          /\/project\/[^/]+/g,
          "/project/:project"
        );

      return parsed.origin + pathname;
    } catch {
      return "";
    }
  };

  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom)
    };
  };

  const isRendered = (element) => {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width >= 2 &&
      rect.height >= 2 &&
      style.display !== "none" &&
      Number(style.opacity || 1) !== 0
    );
  };

  const summarize = (element) => {
    const style = getComputedStyle(element);
    const rect = rectOf(element);
    const anchor = element.matches("a[href]")
      ? element
      : element.closest("a[href]");

    return {
      tag: element.tagName.toLowerCase(),
      role: normalize(element.getAttribute("role")),
      ariaLabel: safeUiText(element.getAttribute("aria-label")),
      title: safeUiText(element.getAttribute("title")),
      testId: normalize(element.getAttribute("data-testid")).slice(0, 160),
      className: safeClassName(element.className),
      text: safeUiText(element.textContent),
      href: anchor ? sanitizeHref(anchor.href) : "",
      hasPopup: normalize(element.getAttribute("aria-haspopup")),
      expanded: normalize(element.getAttribute("aria-expanded")),
      state: normalize(element.getAttribute("data-state")),
      hiddenAttr: element.hasAttribute("hidden"),
      ariaHidden: normalize(element.getAttribute("aria-hidden")),
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
      position: style.position,
      zIndex: style.zIndex,
      insideMain: Boolean(element.closest("main, [role='main']")),
      insideNav: Boolean(element.closest("nav, aside")),
      rect
    };
  };

  const actionables = () =>
    [...document.querySelectorAll([
      "a[href]",
      "button",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='menuitemradio']",
      "[role='menuitemcheckbox']"
    ].join(","))];

  const visibleActionables = () =>
    actionables().filter(isRendered);

  const dialogs = () =>
    [...document.querySelectorAll([
      "[role='alertdialog']",
      "[role='dialog']",
      "[aria-modal='true']",
      "dialog[open]",
      "[data-radix-alert-dialog-content]",
      "[data-radix-dialog-content]",
      "[data-testid*='dialog']",
      "[data-testid*='modal']"
    ].join(","))]
      .filter(isRendered)
      .map(summarize);

  const visibleMenuItems = () =>
    [...document.querySelectorAll([
      "[role='menuitem']",
      "[role='menuitemradio']",
      "[role='menuitemcheckbox']"
    ].join(","))]
      .filter(isRendered)
      .map(summarize);

  const visibleMenus = () =>
    [...document.querySelectorAll([
      "[role='menu']",
      "[data-radix-menu-content]",
      "[data-radix-dropdown-menu-content]"
    ].join(","))]
      .filter(isRendered)
      .map(summarize);

  const sidebarSurfaces = () =>
    [...document.querySelectorAll([
      "#stage-slideover-sidebar",
      "[data-testid='sidebar']",
      "[data-testid='sidebar-container']",
      "[data-testid='conversation-sidebar']",
      "nav",
      "aside"
    ].join(","))]
      .filter(isRendered)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left <= 24 &&
          rect.width >= 120 &&
          rect.height >= Math.min(240, innerHeight * 0.35)
        );
      })
      .map(summarize);

  const knownControlTokens = [
    "new chat", "new conversation", "新對話",
    "scheduled", "schedule", "排程",
    "library", "檔案庫",
    "images", "圖像",
    "maps", "地圖",
    "plugins", "plugin", "外掛",
    "explore", "探索",
    "project", "專案",
    "search", "搜尋",
    "settings", "設定"
  ];

  const knownRouteControls = () =>
    visibleActionables()
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.left > 620) return false;

        const text = [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.textContent
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return knownControlTokens.some(
          (token) => text.includes(token.toLowerCase())
        );
      })
      .map(summarize);

  const menuTriggers = () =>
    visibleActionables()
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.left > 620) return false;

        const popup = normalize(
          element.getAttribute("aria-haspopup")
        ).toLowerCase();

        return (
          popup === "menu" ||
          popup === "true" ||
          (
            element.hasAttribute("aria-controls") &&
            element.hasAttribute("aria-expanded")
          )
        );
      });

  const pageSnapshot = () => ({
    url: sanitizeHref(location.href),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio
    },
    cssSidebarWidth: (() => {
      const values = [document.documentElement, document.body]
        .filter(Boolean)
        .map((root) =>
          getComputedStyle(root)
            .getPropertyValue("--sidebar-width")
            .trim()
        )
        .filter(Boolean);
      return values;
    })(),
    mainSurfaces: [
      ...document.querySelectorAll("main, [role='main']")
    ]
      .filter(isRendered)
      .map(summarize),
    sidebarSurfaces: sidebarSurfaces(),
    knownRouteControls: knownRouteControls(),
    menuTriggers: menuTriggers().map(summarize),
    dialogs: dialogs(),
    visibleMenus: visibleMenus(),
    visibleMenuItems: visibleMenuItems()
  });

  const pointFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + Math.max(2, rect.width / 2),
      y: rect.top + Math.max(2, rect.height / 2)
    };
  };

  const firstAnchorByPath = (kind) => {
    const anchors = [...document.querySelectorAll("a[href]")]
      .filter(isRendered);

    if (kind === "conversation") {
      return anchors.find((anchor) => {
        try {
          return /\/c\/[^/]+/.test(new URL(anchor.href).pathname);
        } catch {
          return false;
        }
      }) || null;
    }

    if (kind === "project") {
      return anchors.find((anchor) => {
        try {
          const pathname = new URL(anchor.href).pathname;
          return (
            /\/g\/[^/]+/.test(pathname) ||
            /\/project\/[^/]+/.test(pathname)
          );
        } catch {
          return false;
        }
      }) || null;
    }

    return null;
  };

  const triggerNearElement = (element) => {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const candidates = menuTriggers()
      .map((candidate) => ({
        element: candidate,
        rect: candidate.getBoundingClientRect()
      }))
      .filter(({ rect: candidateRect }) =>
        candidateRect.top < rect.bottom + 8 &&
        candidateRect.bottom > rect.top - 8 &&
        candidateRect.left < 620
      )
      .sort((a, b) => b.rect.left - a.rect.left);

    return candidates[0]?.element || null;
  };

  const findMenuItem = (kind) => {
    const tokenMap = {
      rename: ["rename", "重新命名"],
      settings: ["project settings", "專案設定", "settings", "設定"],
      share: ["share", "分享"]
    };
    const tokens = tokenMap[kind] || [];

    return [
      ...document.querySelectorAll([
        "[role='menuitem']",
        "[role='menuitemradio']",
        "[role='menuitemcheckbox']",
        "button"
      ].join(","))
    ]
      .filter(isRendered)
      .find((element) => {
        const value = [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return tokens.some(
          (token) => value.includes(token.toLowerCase())
        );
      }) || null;
  };

  window.__chatgptMultiUiAudit = {
    summarize,
    isRendered,
    dialogs,
    visibleMenuItems,
    visibleMenus,
    menuTriggers,
    pageSnapshot,
    pointFor,
    firstAnchorByPath,
    triggerNearElement,
    findMenuItem
  };

  return pageSnapshot();
})()
`;

async function installAuditHelpers() {
  return evalInPage(installAuditHelpersSource);
}

async function snapshot() {
  return evalInPage(`
    window.__chatgptMultiUiAudit?.pageSnapshot?.() || null
  `);
}

async function inspectTargetMenu(kind) {
  const target = await evalInPage(`
    (() => {
      const audit = window.__chatgptMultiUiAudit;
      const element = audit?.firstAnchorByPath?.(${JSON.stringify(kind)});
      if (!element) return null;
      return {
        summary: audit.summarize(element),
        point: audit.pointFor(element)
      };
    })()
  `);

  if (!target) {
    return {
      kind,
      found: false,
      reason: "target-anchor-not-found"
    };
  }

  await clickPoint(target.point);
  await sleep(160);

  const trigger = await evalInPage(`
    (() => {
      const audit = window.__chatgptMultiUiAudit;
      const element = audit?.firstAnchorByPath?.(${JSON.stringify(kind)});
      const trigger = audit?.triggerNearElement?.(element);
      if (!trigger) return null;
      return {
        summary: audit.summarize(trigger),
        point: audit.pointFor(trigger)
      };
    })()
  `);

  if (!trigger) {
    return {
      kind,
      found: true,
      target: target.summary,
      menuTriggerFound: false
    };
  }

  await clickPoint(trigger.point);
  await sleep(300);

  const menuState = await evalInPage(`
    (() => {
      const audit = window.__chatgptMultiUiAudit;
      return {
        menus: audit.visibleMenus(),
        items: audit.visibleMenuItems()
      };
    })()
  `);

  const safeActions = [];

  for (const actionKind of ["rename", "settings"]) {
    const action = await evalInPage(`
      (() => {
        const audit = window.__chatgptMultiUiAudit;
        const element = audit?.findMenuItem?.(${JSON.stringify(actionKind)});
        if (!element) return null;
        return {
          summary: audit.summarize(element),
          point: audit.pointFor(element)
        };
      })()
    `);

    if (!action) {
      continue;
    }

    await clickPoint(action.point);
    await sleep(450);

    safeActions.push({
      action: actionKind,
      menuItem: action.summary,
      afterClick: await snapshot()
    });

    await pressEscape();
    await sleep(240);
    await pressEscape();
    await sleep(180);

    if (actionKind === "rename") {
      await clickPoint(trigger.point);
      await sleep(280);
    }
  }

  await pressEscape();
  await sleep(160);

  return {
    kind,
    found: true,
    target: target.summary,
    menuTriggerFound: true,
    trigger: trigger.summary,
    menuState,
    safeActions
  };
}

async function auditKnownRouteControls() {
  const controls = await evalInPage(`
    (() => {
      const audit = window.__chatgptMultiUiAudit;
      const snapshot = audit?.pageSnapshot?.();
      return snapshot?.knownRouteControls || [];
    })()
  `);

  return controls;
}

async function runAudit() {
  if (auditStarted) {
    return;
  }
  auditStarted = true;

  const report = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    safety: {
      destructiveActionsClicked: false,
      renameSaved: false,
      cookiesRead: false,
      localStorageRead: false,
      messageBodiesRead: false,
      userTextRedacted: true
    },
    environment: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    },
    initial: null,
    knownRouteControls: [],
    conversationMenu: null,
    projectMenu: null,
    final: null,
    errors: []
  };

  try {
    await waitForPageReady();
    await sleep(1800);
    report.initial = await installAuditHelpers();

    report.knownRouteControls =
      await auditKnownRouteControls();

    report.conversationMenu =
      await inspectTargetMenu("conversation");

    report.projectMenu =
      await inspectTargetMenu("project");

    report.final = await snapshot();
  } catch (error) {
    report.errors.push({
      name: error?.name || "Error",
      message: error?.message || String(error)
    });
  }

  try {
    writeReport(report);
    console.log("");
    console.log("UI AUDIT: COMPLETE");
    console.log(`Report: ${reportPath}`);
    console.log("");
  } catch (error) {
    console.error("UI AUDIT: FAILED TO WRITE REPORT");
    console.error(error.message);
    process.exitCode = 1;
  }

  setTimeout(() => app.quit(), 300);
}

app.whenReady().then(async () => {
  console.log("ChatGPT Multi Pane UI compatibility audit");
  console.log("只會讀取 UI 結構與安全地開啟/關閉重新命名、設定介面。");
  console.log("不會執行刪除、封存、釘選、分享或儲存重新命名。\n");

  auditWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: CHATGPT_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  auditWindow.on("closed", () => {
    auditWindow = null;
  });

  await auditWindow.loadURL(CHATGPT_URL);
  runAudit().catch((error) => {
    console.error("UI AUDIT: FAILED");
    console.error(error?.stack || error?.message || String(error));
    try {
      writeReport({
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        fatalError: {
          name: error?.name || "Error",
          message: error?.message || String(error)
        }
      });
    } catch {
      // Preserve the original failure.
    }
    process.exitCode = 1;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
