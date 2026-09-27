"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CHILD_ENV = "CHATGPT_MULTI_UI_AUDIT_V3_CHILD";
const REPORT_NAME = "chatgpt-multi-pane-ui-audit-v3.json";
const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt-shared";

const SOURCE_USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "chatgpt-multi-window"
);
const SOURCE_PARTITION = path.join(
  SOURCE_USER_DATA,
  "Partitions",
  "chatgpt-shared"
);
const TEMP_APPDATA_ROOT = path.join(
  os.tmpdir(),
  `chatgpt-multi-ui-audit-v3-${process.pid}`
);
const TEMP_USER_DATA = path.join(
  TEMP_APPDATA_ROOT,
  "chatgpt-multi-window"
);
const TEMP_PARTITION = path.join(
  TEMP_USER_DATA,
  "Partitions",
  "chatgpt-shared"
);
const REPORT_PATH = path.join(
  os.homedir(),
  "Desktop",
  REPORT_NAME
);

const EXCLUDED_NAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Crashpad",
  "blob_storage",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket"
]);

function fail(message) {
  throw new Error(message);
}

function shouldCopy(sourcePath) {
  const name = path.basename(sourcePath);
  if (EXCLUDED_NAMES.has(name)) return false;
  const lower = name.toLowerCase();
  return !(
    lower === "lock" ||
    lower.endsWith(".lock") ||
    lower.endsWith(".tmp")
  );
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) return false;

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stat = fs.statSync(source);

  if (stat.isDirectory()) {
    fs.cpSync(source, destination, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: shouldCopy
    });
  } else {
    fs.copyFileSync(source, destination);
  }

  return true;
}

function cleanupTempProfile() {
  try {
    fs.rmSync(TEMP_APPDATA_ROOT, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 250
    });
  } catch (error) {
    console.error(
      `[UI Audit v3] temp cleanup warning: ${error.message}`
    );
  }
}

function findElectron() {
  const candidate = path.join(
    __dirname,
    "..",
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );

  return fs.existsSync(candidate) ? candidate : null;
}

function runOuter() {
  console.log("ChatGPT Multi Pane UI compatibility audit v3");
  console.log(
    "Uses a temporary copy of the existing authenticated profile."
  );
  console.log(
    "Does not save rename, delete, archive, pin, share, or modify the formal profile."
  );
  console.log("");

  if (!fs.existsSync(SOURCE_USER_DATA)) {
    fail(`Formal userData not found: ${SOURCE_USER_DATA}`);
  }
  if (!fs.existsSync(SOURCE_PARTITION)) {
    fail(`Formal ChatGPT partition not found: ${SOURCE_PARTITION}`);
  }

  const electronPath = findElectron();
  if (!electronPath) {
    fail("Electron executable not found. Run npm install first.");
  }

  cleanupTempProfile();
  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });

  copyIfExists(
    path.join(SOURCE_USER_DATA, "Local State"),
    path.join(TEMP_USER_DATA, "Local State")
  );
  copyIfExists(SOURCE_PARTITION, TEMP_PARTITION);

  try {
    fs.unlinkSync(REPORT_PATH);
  } catch {
    // No prior report.
  }

  const result = spawnSync(
    electronPath,
    [__filename],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      shell: false,
      windowsHide: false,
      env: {
        ...process.env,
        APPDATA: TEMP_APPDATA_ROOT,
        [CHILD_ENV]: "1"
      }
    }
  );

  if (result.error) {
    fail(`Audit could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Audit exited with code ${result.status}`);
  }
  if (!fs.existsSync(REPORT_PATH)) {
    fail(`Audit report not found: ${REPORT_PATH}`);
  }

  const report = JSON.parse(
    fs.readFileSync(REPORT_PATH, "utf8")
  );

  if (!report.authenticated) {
    fail(
      "Audit did not reach an authenticated ChatGPT UI. " +
      "Do not use the report for compatibility conclusions."
    );
  }

  console.log("");
  console.log("UI AUDIT V3: COMPLETE");
  console.log(`Report: ${REPORT_PATH}`);
}

if (process.env[CHILD_ENV] !== "1") {
  try {
    runOuter();
  } catch (error) {
    console.error("");
    console.error("UI AUDIT V3: FAILED");
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  } finally {
    cleanupTempProfile();
  }
  return;
}

const {
  app,
  BrowserWindow
} = require("electron");

app.setPath(
  "userData",
  path.join(
    app.getPath("appData"),
    "chatgpt-multi-window"
  )
);

let win = null;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function writeReport(report) {
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(report, null, 2),
    "utf8"
  );
}

async function evalPage(source) {
  if (!win || win.isDestroyed()) {
    throw new Error("Audit window unavailable");
  }
  return win.webContents.executeJavaScript(source, true);
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

  win.webContents.sendInputEvent({
    type: "mouseMove",
    x,
    y
  });
  await sleep(100);

  win.webContents.sendInputEvent({
    type: "mouseDown",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x,
    y,
    button: "left",
    clickCount: 1
  });

  return true;
}

async function pressEscape() {
  win.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "ESCAPE"
  });
  win.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "ESCAPE"
  });
}

async function waitForAuthenticatedUi(timeoutMs = 20000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await evalPage(`
        (() => {
          const url = location.href;
          const sidebar = document.querySelector(
            "aside, nav[role='navigation'], nav"
          );
          return {
            url,
            readyState: document.readyState,
            hasSidebar: Boolean(sidebar),
            hasBody: Boolean(document.body),
            bodyLength: document.body?.innerText?.length || 0
          };
        })()
      `);

      if (
        state?.readyState !== "loading" &&
        state?.hasBody &&
        state?.bodyLength > 20 &&
        state?.hasSidebar &&
        !String(state?.url || "").includes("/auth/login")
      ) {
        return state;
      }
    } catch {
      // Renderer may still be navigating.
    }

    await sleep(250);
  }

  throw new Error("Timed out waiting for authenticated ChatGPT UI");
}

const HELPERS = String.raw`
(() => {
  const normalize = (value) =>
    String(value || "").replace(/\s+/g, " ").trim();

  const fixedTokens = [
    "新對話", "搜尋", "已排程", "排程", "檔案庫",
    "外掛程式", "探索", "專案", "重新命名", "重新命名專案",
    "設定", "專案設定", "分享", "封存", "刪除", "釘選",
    "取消", "儲存", "保存", "關閉", "新增新的專案",
    "new chat", "search", "scheduled", "library", "plugins",
    "explore", "project", "rename", "settings", "share",
    "archive", "delete", "pin", "cancel", "save", "close"
  ];

  const safeText = (value) => {
    const text = normalize(value).slice(0, 180);
    if (!text) return "";
    const lower = text.toLowerCase();

    const matched = fixedTokens.find(
      (token) => lower.includes(token.toLowerCase())
    );

    if (!matched) return "<redacted-user-text>";

    if (
      lower.includes("專案動作") ||
      lower.includes("中開始新對話")
    ) {
      return lower.includes("專案動作")
        ? "<redacted-project-name> 的專案動作"
        : "在 <redacted-project-name> 中開始新對話";
    }

    return text;
  };

  const safeClass = (value) =>
    normalize(value)
      .split(" ")
      .filter(Boolean)
      .slice(0, 12)
      .join(" ")
      .slice(0, 220);

  const sanitizeHref = (value) => {
    try {
      const parsed = new URL(value, location.href);
      let p = parsed.pathname;
      p = p
        .replace(/\/g\/[^/]+\/c\/[^/]+/g, "/g/:project/c/:conversation")
        .replace(/\/g\/[^/]+/g, "/g/:project")
        .replace(/\/c\/[^/]+/g, "/c/:conversation")
        .replace(/\/project\/[^/]+/g, "/project/:project");
      return parsed.origin + p;
    } catch {
      return "";
    }
  };

  const isRendered = (el) => {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width >= 2 &&
      r.height >= 2 &&
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      Number(s.opacity || 1) !== 0
    );
  };

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom)
    };
  };

  const summary = (el) => {
    const s = getComputedStyle(el);
    const anchor = el.matches("a[href]")
      ? el
      : el.closest("a[href]");

    return {
      tag: el.tagName.toLowerCase(),
      role: normalize(el.getAttribute("role")),
      ariaLabel: safeText(el.getAttribute("aria-label")),
      title: safeText(el.getAttribute("title")),
      text: safeText(el.textContent),
      testId: normalize(el.getAttribute("data-testid")).slice(0, 120),
      className: safeClass(el.className),
      href: anchor ? sanitizeHref(anchor.href) : "",
      hasPopup: normalize(el.getAttribute("aria-haspopup")),
      expanded: normalize(el.getAttribute("aria-expanded")),
      state: normalize(el.getAttribute("data-state")),
      insideMain: Boolean(el.closest("main, [role='main']")),
      insideNav: Boolean(el.closest("nav, aside")),
      visibility: s.visibility,
      display: s.display,
      pointerEvents: s.pointerEvents,
      position: s.position,
      zIndex: s.zIndex,
      rect: rect(el)
    };
  };

  const point = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + Math.max(2, r.width / 2),
      y: r.top + Math.max(2, r.height / 2)
    };
  };

  const buttonsAndActions = () =>
    [...document.querySelectorAll([
      "button",
      "a[href]",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='menuitemradio']",
      "[role='menuitemcheckbox']"
    ].join(","))].filter(isRendered);

  const actionText = (el) =>
    [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  const actionKind = (el) => {
    const value = actionText(el);
    const tests = [
      ["rename", ["重新命名", "rename"]],
      ["settings", ["專案設定", "project settings", "settings"]],
      ["share", ["分享", "share"]],
      ["archive", ["封存", "archive"]],
      ["delete", ["刪除", "delete"]],
      ["pin", ["釘選", "pin"]],
      ["cancel", ["取消", "cancel"]],
      ["save", ["儲存", "保存", "save"]],
      ["close", ["關閉", "close"]]
    ];

    for (const [kind, tokens] of tests) {
      if (tokens.some((token) => value.includes(token))) {
        return kind;
      }
    }
    return "";
  };

  const actionCandidates = () =>
    buttonsAndActions()
      .map((el) => ({
        kind: actionKind(el),
        element: el
      }))
      .filter((entry) => entry.kind)
      .map((entry) => ({
        kind: entry.kind,
        summary: summary(entry.element),
        point: point(entry.element)
      }));

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
      .map((el) => {
        const ancestors = [];
        let current = el.parentElement;
        while (current && ancestors.length < 8) {
          const s = getComputedStyle(current);
          ancestors.push({
            tag: current.tagName.toLowerCase(),
            role: normalize(current.getAttribute("role")),
            className: safeClass(current.className),
            visibility: s.visibility,
            pointerEvents: s.pointerEvents,
            isMain: current.matches("main, [role='main']")
          });
          current = current.parentElement;
        }

        return {
          ...summary(el),
          ancestors
        };
      });

  const sidebarSurface = () => {
    const candidates = [
      ...document.querySelectorAll("aside, nav")
    ]
      .filter(isRendered)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) =>
        r.left <= 24 &&
        r.width >= 120 &&
        r.height >= Math.min(240, innerHeight * 0.35)
      )
      .sort((a, b) => b.r.width - a.r.width);

    return candidates[0]?.el || null;
  };

  const routeControls = () => {
    const tokens = [
      "新對話", "搜尋", "已排程", "排程",
      "檔案庫", "外掛程式", "探索", "專案",
      "new chat", "search", "scheduled", "library",
      "plugins", "explore", "project"
    ];

    return buttonsAndActions()
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.left > 620) return false;
        const value = actionText(el);
        return tokens.some(
          (token) => value.includes(token.toLowerCase())
        );
      })
      .map(summary);
  };

  const conversationAnchor = () =>
    [...document.querySelectorAll("a[href]")]
      .filter(isRendered)
      .filter((a) => a.closest("nav, aside"))
      .find((a) => {
        try {
          return /\/c\/[^/]+/.test(new URL(a.href).pathname);
        } catch {
          return false;
        }
      }) || null;

  const menuTriggerNear = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();

    const candidates = buttonsAndActions()
      .filter((candidate) => {
        if (candidate === el) return false;
        const cr = candidate.getBoundingClientRect();
        const popup = normalize(
          candidate.getAttribute("aria-haspopup")
        ).toLowerCase();
        const menuLike =
          popup === "menu" ||
          popup === "true" ||
          candidate.className?.toString().includes("sidebar-trigger");

        return (
          menuLike &&
          cr.left < 620 &&
          cr.top < r.bottom + 8 &&
          cr.bottom > r.top - 8
        );
      })
      .map((candidate) => ({
        candidate,
        r: candidate.getBoundingClientRect()
      }))
      .sort((a, b) => {
        const ay = Math.abs(
          (a.r.top + a.r.bottom) / 2 -
          (r.top + r.bottom) / 2
        );
        const by = Math.abs(
          (b.r.top + b.r.bottom) / 2 -
          (r.top + r.bottom) / 2
        );
        if (ay !== by) return ay - by;
        return b.r.left - a.r.left;
      });

    return candidates[0]?.candidate || null;
  };

  const projectActionTrigger = () =>
    buttonsAndActions()
      .filter((el) => el.tagName === "BUTTON")
      .filter((el) => el.closest("nav, aside"))
      .filter((el) => {
        const label = normalize(el.getAttribute("aria-label"));
        return (
          label.includes("專案動作") &&
          normalize(el.getAttribute("aria-haspopup")).toLowerCase() === "menu"
        );
      })
      .sort((a, b) =>
        a.getBoundingClientRect().top -
        b.getBoundingClientRect().top
      )[0] || null;

  const topSearchButton = () =>
    buttonsAndActions()
      .find((el) => {
        const value = actionText(el);
        const r = el.getBoundingClientRect();
        return (
          r.left < 620 &&
          (value.includes("搜尋") || value.includes("search"))
        );
      }) || null;

  const exploreButton = () =>
    buttonsAndActions()
      .find((el) => {
        const value = actionText(el);
        const r = el.getBoundingClientRect();
        return (
          r.left < 620 &&
          (value.includes("探索") || value.includes("explore"))
        );
      }) || null;

  const snapshot = () => {
    const sidebar = sidebarSurface();
    return {
      url: sanitizeHref(location.href),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio
      },
      sidebar: sidebar ? summary(sidebar) : null,
      main: [...document.querySelectorAll("main, [role='main']")]
        .filter(isRendered)
        .map(summary),
      routeControls: routeControls(),
      dialogs: dialogs(),
      actionCandidates: actionCandidates()
    };
  };

  window.__chatgptMultiAuditV3 = {
    summary,
    point,
    isRendered,
    actionCandidates,
    dialogs,
    snapshot,
    conversationAnchor,
    menuTriggerNear,
    projectActionTrigger,
    topSearchButton,
    exploreButton
  };

  return snapshot();
})()
`;

async function installHelpers() {
  return evalPage(HELPERS);
}

async function capture() {
  return evalPage(
    "window.__chatgptMultiAuditV3?.snapshot?.() || null"
  );
}

async function locate(kind) {
  const expr = {
    conversationTrigger: `
      (() => {
        const a = window.__chatgptMultiAuditV3;
        const anchor = a?.conversationAnchor?.();
        const trigger = a?.menuTriggerNear?.(anchor);
        return trigger ? {
          target: anchor ? a.summary(anchor) : null,
          trigger: a.summary(trigger),
          point: a.point(trigger)
        } : null;
      })()
    `,
    projectTrigger: `
      (() => {
        const a = window.__chatgptMultiAuditV3;
        const trigger = a?.projectActionTrigger?.();
        return trigger ? {
          trigger: a.summary(trigger),
          point: a.point(trigger)
        } : null;
      })()
    `,
    search: `
      (() => {
        const a = window.__chatgptMultiAuditV3;
        const el = a?.topSearchButton?.();
        return el ? {
          summary: a.summary(el),
          point: a.point(el)
        } : null;
      })()
    `,
    explore: `
      (() => {
        const a = window.__chatgptMultiAuditV3;
        const el = a?.exploreButton?.();
        return el ? {
          summary: a.summary(el),
          point: a.point(el)
        } : null;
      })()
    `
  }[kind];

  return expr ? evalPage(expr) : null;
}

async function findAction(kind) {
  return evalPage(`
    (() => {
      const a = window.__chatgptMultiAuditV3;
      const entry = a?.actionCandidates?.()
        .find((candidate) => candidate.kind === ${JSON.stringify(kind)});
      return entry || null;
    })()
  `);
}

async function inspectMenuFlow(kind) {
  const locatorKind =
    kind === "conversation"
      ? "conversationTrigger"
      : "projectTrigger";

  const located = await locate(locatorKind);
  if (!located) {
    return {
      kind,
      found: false,
      reason: "menu-trigger-not-found"
    };
  }

  await clickPoint(located.point);
  await sleep(350);

  const afterMenu = await capture();
  const result = {
    kind,
    found: true,
    target: located.target || null,
    trigger: located.trigger,
    afterMenu,
    safeActions: []
  };

  for (const actionKind of ["rename", "settings"]) {
    const action = await findAction(actionKind);
    if (!action) continue;

    await clickPoint(action.point);
    await sleep(550);

    result.safeActions.push({
      action: actionKind,
      menuItem: action.summary,
      afterClick: await capture()
    });

    await pressEscape();
    await sleep(300);
    await pressEscape();
    await sleep(200);

    if (actionKind === "rename") {
      const reopened = await locate(locatorKind);
      if (!reopened) break;
      await clickPoint(reopened.point);
      await sleep(350);
    }
  }

  await pressEscape();
  await sleep(200);
  return result;
}

async function inspectSafeControl(kind) {
  const control = await locate(kind);
  if (!control) {
    return {
      kind,
      found: false
    };
  }

  await clickPoint(control.point);
  await sleep(450);

  const result = {
    kind,
    found: true,
    control: control.summary,
    afterClick: await capture()
  };

  await pressEscape();
  await sleep(250);
  return result;
}

async function runAudit() {
  const report = {
    schemaVersion: 3,
    createdAt: new Date().toISOString(),
    authenticated: false,
    safety: {
      destructiveActionsClicked: false,
      renameSaved: false,
      formalProfileModified: false,
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
    conversationMenu: null,
    projectMenu: null,
    search: null,
    explore: null,
    final: null,
    errors: []
  };

  try {
    await waitForAuthenticatedUi();
    report.authenticated = true;
    await sleep(1500);
    report.initial = await installHelpers();

    report.conversationMenu =
      await inspectMenuFlow("conversation");

    report.projectMenu =
      await inspectMenuFlow("project");

    report.search =
      await inspectSafeControl("search");

    report.explore =
      await inspectSafeControl("explore");

    report.final = await capture();
  } catch (error) {
    report.errors.push({
      name: error?.name || "Error",
      message: error?.message || String(error)
    });
  }

  writeReport(report);

  console.log("");
  console.log("UI AUDIT V3 CHILD: REPORT WRITTEN");
  console.log(`Report: ${REPORT_PATH}`);

  setTimeout(() => app.quit(), 300);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
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

  win.on("closed", () => {
    win = null;
  });

  await win.loadURL(CHATGPT_URL);
  runAudit().catch((error) => {
    console.error("UI AUDIT V3 CHILD: FAILED");
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
