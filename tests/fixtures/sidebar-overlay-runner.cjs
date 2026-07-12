"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session
} = require("electron");
const {
  transitionOverlayState
} = require("../../lib/overlay-policy.cjs");

const events = [];
const eventWaiters = new Set();
let parentWindow = null;
let overlayWindow = null;
let overlayState = transitionOverlayState({
  mode: "sidebar-only",
  generation: 0
});
let overlayPendingTimer = null;
let overlayMoveTopCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function waitForEvent(predicate, timeoutMs = 2500) {
  const existing = events.find(predicate);

  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve: (entry) => {
        clearTimeout(waiter.timer);
        eventWaiters.delete(waiter);
        resolve(entry);
      },
      timer: null
    };

    waiter.timer = setTimeout(() => {
      eventWaiters.delete(waiter);
      reject(new Error("fixture event timeout"));
    }, timeoutMs);
    eventWaiters.add(waiter);
  });
}

function notifyEventWaiters(entry) {
  for (const waiter of [...eventWaiters]) {
    if (waiter.predicate(entry)) {
      waiter.resolve(entry);
    }
  }
}

async function dispatchPointerAndClick(selector) {
  const result = await overlayWindow.webContents.executeJavaScript(`
    (() => {
      try {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) {
          return { ok: false, reason: "target-missing" };
        }
        target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0
        }));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error && error.name ? error.name : "renderer-error",
          message: error && error.message ? error.message : "unknown"
        };
      }
    })()
  `);
  assert(
    result?.ok === true,
    `fixture interaction failed for ${selector}: ${result?.reason || "unknown"} ${result?.message || ""}`.trim()
  );
}

async function run() {
  const fixturePartition = `sidebar-overlay-fixture-${Date.now()}`;
  const fixtureSession = session.fromPartition(fixturePartition);
  fixtureSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );

  parentWindow = new BrowserWindow({
    x: -10000,
    y: -10000,
    width: 1200,
    height: 800,
    show: true
  });
  const pane = new WebContentsView();
  parentWindow.contentView.addChildView(pane);
  pane.setBounds({ x: 260, y: 0, width: 940, height: 800 });

  overlayWindow = new BrowserWindow({
    parent: parentWindow,
    x: -10000,
    y: -10000,
    width: 1200,
    height: 800,
    show: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "sidebar-shape-preload-v4.5.4.js"),
      partition: fixturePartition,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  for (const channel of [
    "chatgpt-sidebar-shape-state",
    "chatgpt-sidebar-route-intent",
    "chatgpt-sidebar-project-action-candidate",
    "chatgpt-sidebar-overlay-only-intent",
    "chatgpt-sidebar-fullscreen-overlay-intent",
    "chatgpt-sidebar-diagnostic-event"
  ]) {
    ipcMain.on(channel, (_event, payload) => {
      const entry = { channel, payload };
      events.push(entry);
      notifyEventWaiters(entry);

      if (
        channel === "chatgpt-sidebar-shape-state" &&
        Array.isArray(payload?.popupRects) &&
        payload.popupRects.length > 0
      ) {
        overlayWindow.moveTop();
        overlayMoveTopCount += 1;
      }

      if (channel === "chatgpt-sidebar-overlay-only-intent") {
        if (overlayState.mode !== "overlay-intent-pending") {
          overlayState = transitionOverlayState(overlayState, {
            type: "overlay-intent"
          });
          overlayPendingTimer = setTimeout(() => {
            overlayPendingTimer = null;
            overlayState = transitionOverlayState(overlayState, {
              type: "dialog-missing"
            });
          }, 1500);
        }
      }

      if (
        channel === "chatgpt-sidebar-shape-state" &&
        payload?.dialogRect
      ) {
        if (overlayPendingTimer) {
          clearTimeout(overlayPendingTimer);
          overlayPendingTimer = null;
        }
        overlayState = transitionOverlayState(overlayState, {
          type: "dialog-detected"
        });
      }
    });
  }

  await overlayWindow.loadFile(
    path.join(__dirname, "sidebar-overlay.html")
  );

  const startCount = events.length;
  await dispatchPointerAndClick("#conversation-menu-path");
  await waitForEvent((entry) =>
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length > 0
  );
  const menuEvents = events.slice(startCount);
  assert(!menuEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-route-intent"
  ), "conversation menu routed its parent anchor");
  assert(!menuEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "conversation menu created Project candidate");
  assert(overlayMoveTopCount > 0, "conversation menu did not raise overlay");

  const popupMoveStart = events.length;
  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const menu = document.getElementById("fixture-menu");
      menu.style.left = "320px";
      menu.style.top = "55px";
      menu.style.width = "210px";
    })()
  `);
  await waitForEvent((entry) =>
    events.indexOf(entry) >= popupMoveStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.some((rect) =>
      rect.x >= 317 && rect.width >= 210
    )
  );

  const conversationMenuRemoveStart = events.length;
  await overlayWindow.webContents.executeJavaScript(
    'document.getElementById("fixture-menu").remove()'
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= conversationMenuRemoveStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length === 0
  );

  const projectStart = events.length;
  await dispatchPointerAndClick("#project-menu-path");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= projectStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length > 0
  );
  const projectMenuEvents = events.slice(projectStart);
  assert(!projectMenuEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-route-intent" ||
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "Project menu routed or created an intent");

  const projectMenuRemoveStart = events.length;
  await overlayWindow.webContents.executeJavaScript(
    'document.getElementById("fixture-menu").remove()'
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= projectMenuRemoveStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length === 0
  );

  const routeStart = events.length;
  await dispatchPointerAndClick("#conversation-row");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= routeStart &&
    entry.channel === "chatgpt-sidebar-route-intent"
  );

  const candidateStart = events.length;
  await dispatchPointerAndClick("#project-new-chat");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= candidateStart &&
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  );

  await dispatchPointerAndClick("#project-settings");
  assert(
    overlayState.mode === "overlay-intent-pending",
    "Settings did not enter pending state"
  );
  assert(
    overlayState.suppressPanes === false,
    "pending state suppressed panes before dialog detection"
  );
  const initialDialog = await waitForEvent((entry) =>
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );
  assert(initialDialog.payload.dialogRect.width >= 500, "dialog rect missing");
  assert(overlayState.mode === "shaped-dialog", "dialog did not enter shaped mode");

  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const dialog = document.getElementById("project-dialog");
      const textarea = dialog.querySelector("textarea");
      textarea.value = "line 1\\nline 2\\nline 3\\nline 4";
      textarea.style.height = "320px";
      dialog.style.height = "500px";
    })()
  `);
  await waitForEvent((entry) =>
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 500
  );
  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const dialog = document.getElementById("project-dialog");
      const textarea = dialog.querySelector("textarea");
      textarea.value = "";
      textarea.style.height = "80px";
      dialog.style.height = "240px";
    })()
  `);
  await waitForEvent((entry) =>
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height <= 245
  );
  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const oldDialog = document.getElementById("project-dialog");
      const replacement = oldDialog.cloneNode(true);
      replacement.style.height = "360px";
      oldDialog.replaceWith(replacement);
    })()
  `);
  await waitForEvent((entry) =>
    entry.channel === "chatgpt-sidebar-diagnostic-event" &&
    entry.payload?.event === "dialog-surface-replaced"
  );

  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      document.getElementById("project-dialog").remove();
      document.getElementById("fixture-backdrop").style.display = "none";
    })()
  `);
  await dispatchPointerAndClick("#project-settings-missing");
  assert(
    overlayState.mode === "overlay-intent-pending",
    "missing dialog did not enter pending state"
  );
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert(
    overlayState.mode === "sidebar-only" &&
      overlayState.suppressPanes === false,
    "missing dialog did not return to sidebar-only"
  );

  const hidden = await overlayWindow.webContents.executeJavaScript(
    'getComputedStyle(document.querySelector("main")).visibility'
  );
  assert(hidden === "hidden", "main workspace visible in normal mode");
  overlayWindow.webContents.send(
    "chatgpt-sidebar-set-fullscreen-mode",
    true
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  const visible = await overlayWindow.webContents.executeJavaScript(
    'getComputedStyle(document.querySelector("main")).visibility'
  );
  assert(visible === "visible", "fullscreen did not reveal main workspace");
  overlayWindow.webContents.send(
    "chatgpt-sidebar-set-fullscreen-mode",
    false
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  const hiddenAgain = await overlayWindow.webContents.executeJavaScript(
    'getComputedStyle(document.querySelector("main")).visibility'
  );
  assert(hiddenAgain === "hidden", "normal mode did not restore isolation");

  process.stdout.write("SIDEBAR OVERLAY FIXTURE: PASS\n");
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  });

app.on("will-quit", () => {
  for (const waiter of eventWaiters) {
    clearTimeout(waiter.timer);
  }
  eventWaiters.clear();
  if (overlayPendingTimer) {
    clearTimeout(overlayPendingTimer);
    overlayPendingTimer = null;
  }
  ipcMain.removeAllListeners();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  if (parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.destroy();
  }
});
