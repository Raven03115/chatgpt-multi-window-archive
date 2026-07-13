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
  buildOverlayShape,
  transitionOverlayState
} = require("../../lib/overlay-policy.cjs");
const {
  configureAutomationsRequestUserAgent
} = require("../../lib/browser-user-agent.cjs");

const events = [];
const eventWaiters = new Set();
let parentWindow = null;
let overlayWindow = null;
let paneView = null;
let overlayState = transitionOverlayState({
  mode: "sidebar-only",
  generation: 0
});
let overlayPendingTimer = null;
let fullscreenCloseTimer = null;
let overlayMoveTopCount = 0;
let fixtureDialogVisible = false;
let fixtureDialogRect = null;
let fixturePopupRects = [];
let appliedFixtureShape = [];
let fixtureOverlayOnlyKind = null;
let fixtureSettingsEscapeGeneration = null;
let fixtureInjectedEscapeCloseIntentGeneration = null;
let fixtureSettingsOutsideClickCount = 0;
let fixtureShapeStayedFullThroughEscapeDispatch = false;

const FIXTURE_WIDTH = 1200;
const FIXTURE_HEIGHT = 800;
const FIXTURE_SIDEBAR_WIDTH = 260;

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
        target.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0
        }));
        target.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0
        }));
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

async function dispatchRetargetedUpgradeCloseGesture() {
  return overlayWindow.webContents.executeJavaScript(`
    (() => {
      const closeControl = document.getElementById("fixture-upgrade-close");
      if (!closeControl) {
        return { ok: false, reason: "close-control-missing" };
      }

      const rect = closeControl.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const pointerId = 41;

      closeControl.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId,
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y
      }));

      document.getElementById("fixture-upgrade-surface")?.remove();
      openAccountMenu();
      const accountMenu = document.getElementById("fixture-account-menu");
      const upgradeControl = document.getElementById("fixture-upgrade-action");
      accountMenu.style.left = rect.left + "px";
      accountMenu.style.top = rect.top + "px";
      upgradeControl.style.width = Math.max(rect.width, 80) + "px";
      upgradeControl.style.height = Math.max(rect.height, 30) + "px";

      const retargetedControl = document.elementFromPoint(x, y);
      const clickTargetKind = retargetedControl?.closest?.(
        "#fixture-upgrade-action"
      )
        ? "upgrade-menuitem"
        : "other";

      retargetedControl?.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId,
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y
      }));
      retargetedControl?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y
      }));
      document.getElementById("fixture-account-menu")?.remove();

      return {
        ok: true,
        pointerDownTargetKind: "close-control",
        clickTargetKind
      };
    })()
  `);
}

function applyFixtureOverlayShape() {
  appliedFixtureShape = buildOverlayShape({
    mode: overlayState.mode,
    bounds: {
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT
    },
    sidebarWidth: FIXTURE_SIDEBAR_WIDTH,
    dialogRect: fixtureDialogRect,
    popupRects: fixturePopupRects,
    captureWorkspaceInput: overlayState.overlayOnlyModal
  });
  overlayWindow.setShape(appliedFixtureShape);
}

function scheduleFixtureFullscreenClose() {
  if (overlayState.overlayOnlyModal) {
    return false;
  }

  if (fullscreenCloseTimer) {
    clearTimeout(fullscreenCloseTimer);
  }

  const generation = overlayState.generation;
  fullscreenCloseTimer = setTimeout(() => {
    fullscreenCloseTimer = null;
    if (
      overlayState.overlayOnlyModal ||
      overlayState.generation !== generation
    ) {
      return;
    }
    overlayState = transitionOverlayState(overlayState, {
      type: "close"
    });
    fixtureDialogRect = null;
    fixturePopupRects = [];
    applyFixtureOverlayShape();
    overlayWindow.webContents.send(
      "chatgpt-sidebar-set-fullscreen-mode",
      false
    );
  }, 120);

  return true;
}

function shapeContainsPoint(rects, x, y) {
  return rects.some((rect) =>
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

async function dispatchWorkspacePointerSequence(x, y) {
  const overlayShapeHit = shapeContainsPoint(
    appliedFixtureShape,
    x,
    y
  );
  const target = overlayShapeHit
    ? overlayWindow.webContents
    : paneView.webContents;
  const targetX = overlayShapeHit
    ? x
    : x - FIXTURE_SIDEBAR_WIDTH;
  const targetKind = overlayShapeHit
    ? await overlayWindow.webContents.executeJavaScript(`
        (() => {
          const target = document.elementFromPoint(${x}, ${y});
          if (target === document.documentElement) return "html";
          if (target === document.body) return "document-body";
          if (target?.closest?.('[role="dialog"], [aria-modal="true"]')) return "dialog";
          if (target?.closest?.('[role="menu"], [role="listbox"]')) return "popup";
          if (target?.matches?.('main, [role="main"]')) return "transparent-root";
          return "other";
        })()
      `)
    : "pane";

  target.sendInputEvent({
    type: "mouseDown",
    x: targetX,
    y,
    button: "left",
    clickCount: 1
  });
  target.sendInputEvent({
    type: "mouseUp",
    x: targetX,
    y,
    button: "left",
    clickCount: 1
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    overlayShapeHit,
    targetKind,
    settingsOutsideClickCount:
      fixtureSettingsOutsideClickCount,
    shapeStayedFullThroughEscapeDispatch:
      fixtureShapeStayedFullThroughEscapeDispatch,
    panePointerDownCount:
      await paneView.webContents.executeJavaScript(
        "Number(window.fixturePanePointerDownCount || 0)"
      ),
    panePointerUpCount:
      await paneView.webContents.executeJavaScript(
        "Number(window.fixturePanePointerUpCount || 0)"
      ),
    paneClickCount:
      await paneView.webContents.executeJavaScript(
        "Number(window.fixturePaneClickCount || 0)"
      ),
    backdropPointerDownCount:
      await overlayWindow.webContents.executeJavaScript(
        "Number(window.fixtureBackdropPointerDownCount || 0)"
      ),
    backdropPointerUpCount:
      await overlayWindow.webContents.executeJavaScript(
        "Number(window.fixtureBackdropPointerUpCount || 0)"
      ),
    backdropClickCount:
      await overlayWindow.webContents.executeJavaScript(
        "Number(window.fixtureBackdropClickCount || 0)"
      ),
    escapeKeyDownCount:
      await overlayWindow.webContents.executeJavaScript(
        "Number(window.fixtureEscapeKeyDownCount || 0)"
      ),
    escapeKeyUpCount:
      await overlayWindow.webContents.executeJavaScript(
        "Number(window.fixtureEscapeKeyUpCount || 0)"
      )
  };
}

async function resetFixturePointerCounts() {
  fixtureSettingsOutsideClickCount = 0;
  fixtureShapeStayedFullThroughEscapeDispatch = false;
  await paneView.webContents.executeJavaScript(`
    window.fixturePanePointerDownCount = 0;
    window.fixturePanePointerUpCount = 0;
    window.fixturePaneClickCount = 0;
  `);
  await overlayWindow.webContents.executeJavaScript(`
    window.fixtureBackdropPointerDownCount = 0;
    window.fixtureBackdropPointerUpCount = 0;
    window.fixtureBackdropClickCount = 0;
    window.fixtureEscapeKeyDownCount = 0;
    window.fixtureEscapeKeyUpCount = 0;
  `);
}

async function getFixtureSettingsGestureState() {
  return overlayWindow.webContents.executeJavaScript(`
    ({
      dialogExists: Boolean(document.getElementById("project-dialog")),
      escapeKeyDownCount: Number(window.fixtureEscapeKeyDownCount || 0),
      escapeKeyUpCount: Number(window.fixtureEscapeKeyUpCount || 0)
    })
  `);
}

async function dispatchRightButtonSequence(x, y) {
  overlayWindow.webContents.sendInputEvent({
    type: "mouseDown",
    x,
    y,
    button: "right",
    clickCount: 1
  });
  overlayWindow.webContents.sendInputEvent({
    type: "mouseUp",
    x,
    y,
    button: "right",
    clickCount: 1
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function dispatchDragSequence() {
  overlayWindow.webContents.sendInputEvent({
    type: "mouseDown",
    x: 1100,
    y: 700,
    button: "left",
    clickCount: 1
  });
  overlayWindow.webContents.sendInputEvent({
    type: "mouseMove",
    x: 1130,
    y: 730,
    movementX: 30,
    movementY: 30
  });
  overlayWindow.webContents.sendInputEvent({
    type: "mouseUp",
    x: 1130,
    y: 730,
    button: "left",
    clickCount: 1
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function dispatchUntrustedOutsideSequence() {
  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const target = document.elementFromPoint(1100, 700) || document.documentElement;
      target.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 77,
        isPrimary: true,
        clientX: 1100,
        clientY: 700
      }));
      target.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 77,
        isPrimary: true,
        clientX: 1100,
        clientY: 700
      }));
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 1100,
        clientY: 700
      }));
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function runUpgradeSettingsRace(delayMs) {
  const upgradeStart = events.length;
  await dispatchPointerAndClick("#account-menu");
  await dispatchPointerAndClick("#fixture-upgrade-action");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= upgradeStart &&
    entry.channel === "chatgpt-sidebar-fullscreen-overlay-intent" &&
    entry.payload === true
  );
  await new Promise((resolve) => setTimeout(resolve, 125));

  const closeStartedAt = performance.now();
  await dispatchPointerAndClick("#fixture-upgrade-close");
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const pendingCloseAtSettingsIntent =
    Boolean(fullscreenCloseTimer);
  const settingsStart = events.length;
  await dispatchPointerAndClick("#project-settings");
  assert(
    shapeContainsPoint(appliedFixtureShape, 1100, 700),
    `Settings intent did not apply full-workspace shape at delay=${delayMs}ms`
  );
  assert(
    !pendingCloseAtSettingsIntent || !fullscreenCloseTimer,
    `Settings intent did not cancel pending Upgrade close at delay=${delayMs}ms`
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );

  const remainingCloseWindow =
    150 - (performance.now() - closeStartedAt);
  if (remainingCloseWindow > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, remainingCloseWindow)
    );
  }

  await resetFixturePointerCounts();
  const backdropResult =
    await dispatchWorkspacePointerSequence(1100, 700);
  assert(
    backdropResult.overlayShapeHit === true &&
      ["html", "document-body", "transparent-root"].includes(
        backdropResult.targetKind
      ) &&
      backdropResult.settingsOutsideClickCount === 1 &&
      backdropResult.shapeStayedFullThroughEscapeDispatch === true &&
      backdropResult.escapeKeyDownCount === 1 &&
      backdropResult.escapeKeyUpCount === 1 &&
      backdropResult.backdropClickCount === 0 &&
      backdropResult.panePointerDownCount === 0 &&
      backdropResult.panePointerUpCount === 0 &&
      backdropResult.paneClickCount === 0,
    `Upgrade to Settings shape race at delay=${delayMs}ms: ` +
      `overlayShapeHit=${backdropResult.overlayShapeHit} ` +
      `targetKind=${backdropResult.targetKind} ` +
      `outsideIpc=${backdropResult.settingsOutsideClickCount} ` +
      `escapeDown=${backdropResult.escapeKeyDownCount} ` +
      `escapeUp=${backdropResult.escapeKeyUpCount} ` +
      `backdropClicks=${backdropResult.backdropClickCount} ` +
      `paneClicks=${backdropResult.paneClickCount}`
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  const rendererState =
    await overlayWindow.webContents.executeJavaScript(`
      ({
        fullscreenClass: document.documentElement.classList.contains("chatgpt-multi-fullscreen-overlay"),
        mainVisibility: getComputedStyle(document.querySelector("main")).visibility
      })
    `);
  assert(
    overlayState.mode === "sidebar-only" &&
      !shapeContainsPoint(appliedFixtureShape, 1100, 700) &&
      shapeContainsPoint(appliedFixtureShape, 100, 700) &&
      !rendererState.fullscreenClass &&
      rendererState.mainVisibility === "hidden" &&
      overlayWindow.isVisible(),
    `Upgrade to Settings close did not restore sidebar-only at delay=${delayMs}ms`
  );
}

async function runConfirmationFlow(options) {
  const {
    triggerSelector,
    minimumWidth,
    minimumHeight
  } = options;
  const menuStart = events.length;

  await dispatchPointerAndClick(triggerSelector);
  await waitForEvent((entry) =>
    events.indexOf(entry) >= menuStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length > 0
  );
  const triggerEvents = events.slice(menuStart);
  assert(!triggerEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-route-intent" ||
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "confirmation menu trigger routed or created an intent");

  const dialogStart = events.length;
  const moveTopBefore = overlayMoveTopCount;
  await dispatchPointerAndClick("#fixture-destructive-action");
  const dialogState = await waitForEvent((entry) =>
    events.indexOf(entry) >= dialogStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  assert(!events.slice(dialogStart).some((entry) =>
    entry.channel === "chatgpt-sidebar-route-intent" ||
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "native menu action routed or created Project intent");
  assert(
    dialogState.payload.dialogRect.width >= minimumWidth &&
      dialogState.payload.dialogRect.height >= minimumHeight,
    "compact confirmation rect was clipped"
  );
  assert(
    overlayState.mode === "shaped-dialog" &&
      overlayState.mainWorkspaceVisible === false,
    "confirmation entered the wrong overlay mode"
  );
  assert(
    overlayMoveTopCount > moveTopBefore,
    "confirmation overlay was not raised above the pane"
  );
  assert(!events.slice(dialogStart).some((entry) =>
    entry.channel === "chatgpt-sidebar-fullscreen-overlay-intent"
  ), "confirmation enabled fullscreen mode");
  const visibleState = await overlayWindow.webContents.executeJavaScript(`
    ({
      mainVisibility: getComputedStyle(document.querySelector("main")).visibility,
      backdropDisplay: getComputedStyle(document.getElementById("fixture-backdrop")).display
    })
  `);
  assert(
    visibleState.mainVisibility === "hidden" &&
      visibleState.backdropDisplay !== "none",
    "workspace isolation or confirmation backdrop is incorrect"
  );

  const cancelStart = events.length;
  await dispatchPointerAndClick('[data-fixture-result="cancel"]');
  await waitForEvent((entry) =>
    events.indexOf(entry) >= cancelStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  const cancelState = await overlayWindow.webContents.executeJavaScript(`
    ({
      confirmationExists: Boolean(document.getElementById("fixture-confirmation")),
      backdropDisplay: getComputedStyle(document.getElementById("fixture-backdrop")).display
    })
  `);
  assert(
    cancelState.confirmationExists === false &&
      cancelState.backdropDisplay === "none",
    "confirmation cancel left stale UI"
  );

  const reopenMenuStart = events.length;
  await dispatchPointerAndClick(triggerSelector);
  await waitForEvent((entry) =>
    events.indexOf(entry) >= reopenMenuStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length > 0
  );
  const reopenDialogStart = events.length;
  await dispatchPointerAndClick("#fixture-destructive-action");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= reopenDialogStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  const confirmStart = events.length;
  await dispatchPointerAndClick('[data-fixture-result="confirm"]');
  await waitForEvent((entry) =>
    events.indexOf(entry) >= confirmStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
}

async function run() {
  const fixturePartition = `sidebar-overlay-fixture-${Date.now()}`;
  const fixtureSession = session.fromPartition(fixturePartition);
  configureAutomationsRequestUserAgent(fixtureSession);
  fixtureSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );

  parentWindow = new BrowserWindow({
    x: -10000,
    y: -10000,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    show: true
  });
  paneView = new WebContentsView({
    webPreferences: {
      partition: fixturePartition
    }
  });
  parentWindow.contentView.addChildView(paneView);
  paneView.setBounds({
    x: FIXTURE_SIDEBAR_WIDTH,
    y: 0,
    width: FIXTURE_WIDTH - FIXTURE_SIDEBAR_WIDTH,
    height: FIXTURE_HEIGHT
  });
  await paneView.webContents.loadURL(
    "data:text/html,<body style='margin:0;width:100vw;height:100vh;background:%23212121'><script>window.fixturePanePointerDownCount=0;window.fixturePanePointerUpCount=0;window.fixturePaneClickCount=0;document.body.addEventListener('pointerdown',()=>{window.fixturePanePointerDownCount+=1;});document.body.addEventListener('pointerup',()=>{window.fixturePanePointerUpCount+=1;});document.body.addEventListener('click',()=>{window.fixturePaneClickCount+=1;});</script></body>"
  );

  overlayWindow = new BrowserWindow({
    parent: parentWindow,
    x: -10000,
    y: -10000,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
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
  assert(
    paneView.webContents.session === fixtureSession &&
      overlayWindow.webContents.session === fixtureSession,
    "pane and overlay do not share the persistent session"
  );
  assert(
    /Electron\/[0-9.]+/i.test(
      paneView.webContents.getUserAgent()
    ) &&
      /Electron\/[0-9.]+/i.test(
        overlayWindow.webContents.getUserAgent()
      ),
    "pane or overlay lost the original Electron product marker"
  );

  for (const channel of [
    "chatgpt-sidebar-shape-state",
    "chatgpt-sidebar-dialog-close-intent",
    "chatgpt-sidebar-route-intent",
    "chatgpt-sidebar-project-action-candidate",
    "chatgpt-sidebar-overlay-only-intent",
    "chatgpt-sidebar-settings-outside-click",
    "chatgpt-sidebar-fullscreen-overlay-intent",
    "chatgpt-sidebar-diagnostic-event"
  ]) {
    ipcMain.on(channel, (_event, payload) => {
      const entry = { channel, payload };
      events.push(entry);
      notifyEventWaiters(entry);

      if (
        channel === "chatgpt-sidebar-shape-state" &&
        (
          payload?.dialogRect ||
          (
            Array.isArray(payload?.popupRects) &&
            payload.popupRects.length > 0
          )
        )
      ) {
        overlayWindow.moveTop();
        overlayMoveTopCount += 1;
      }

      if (channel === "chatgpt-sidebar-overlay-only-intent") {
        if (payload?.kind === "settings" || payload?.kind === "search") {
          fixtureOverlayOnlyKind = payload.kind;
        }

        if (fullscreenCloseTimer) {
          clearTimeout(fullscreenCloseTimer);
          fullscreenCloseTimer = null;
          overlayWindow.webContents.send(
            "chatgpt-sidebar-set-fullscreen-mode",
            false
          );
        }

        if (overlayState.mode !== "overlay-intent-pending") {
          overlayState = transitionOverlayState(overlayState, {
            type: "overlay-intent"
          });
          applyFixtureOverlayShape();
          overlayPendingTimer = setTimeout(() => {
            overlayPendingTimer = null;
            overlayState = transitionOverlayState(overlayState, {
              type: "dialog-missing"
            });
            fixtureDialogRect = null;
            fixturePopupRects = [];
            applyFixtureOverlayShape();
          }, 1500);
        }
      }

      if (channel === "chatgpt-sidebar-settings-outside-click") {
        if (
          fixtureOverlayOnlyKind !== "settings" ||
          !overlayState.overlayOnlyModal ||
          overlayState.mode === "fullscreen" ||
          fixtureSettingsEscapeGeneration === overlayState.generation
        ) {
          return;
        }

        fixtureSettingsOutsideClickCount += 1;
        fixtureSettingsEscapeGeneration = overlayState.generation;
        fixtureInjectedEscapeCloseIntentGeneration =
          overlayState.generation;
        overlayWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "ESCAPE"
        });
        overlayWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "ESCAPE"
        });
        fixtureShapeStayedFullThroughEscapeDispatch =
          shapeContainsPoint(appliedFixtureShape, 1100, 700);
      }

      if (channel === "chatgpt-sidebar-dialog-close-intent") {
        if (
          fixtureOverlayOnlyKind === "settings" &&
          fixtureInjectedEscapeCloseIntentGeneration ===
            overlayState.generation
        ) {
          fixtureInjectedEscapeCloseIntentGeneration = null;
          return;
        }

        const shouldCloseFullscreen =
          overlayState.mode === "fullscreen";
        overlayState = transitionOverlayState(overlayState, {
          type: "close"
        });
        fixtureDialogRect = null;
        fixturePopupRects = [];
        applyFixtureOverlayShape();

        if (shouldCloseFullscreen) {
          scheduleFixtureFullscreenClose();
        }
      }

      if (channel === "chatgpt-sidebar-fullscreen-overlay-intent") {
        const enabled = payload === true;
        if (enabled) {
          overlayState = transitionOverlayState(overlayState, {
            type: "fullscreen",
            explicitExternal: true
          });
          fixtureDialogRect = null;
          fixturePopupRects = [];
          applyFixtureOverlayShape();
          overlayWindow.webContents.send(
            "chatgpt-sidebar-set-fullscreen-mode",
            true
          );
        } else {
          if (overlayState.overlayOnlyModal) {
            return;
          }

          scheduleFixtureFullscreenClose();
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
        if (overlayState.mode !== "fullscreen") {
          overlayState = transitionOverlayState(overlayState, {
            type: "dialog-detected"
          });
        }
        fixtureDialogRect = payload.dialogRect;
        fixturePopupRects = Array.isArray(payload.popupRects)
          ? payload.popupRects
          : [];
        applyFixtureOverlayShape();
        fixtureDialogVisible = true;
      } else if (
        channel === "chatgpt-sidebar-shape-state" &&
        fixtureDialogVisible
      ) {
        overlayState = transitionOverlayState(overlayState, {
          type: "close"
        });
        fixtureDialogRect = null;
        fixturePopupRects = [];
        applyFixtureOverlayShape();
        fixtureDialogVisible = false;
        fixtureOverlayOnlyKind = null;
        fixtureSettingsEscapeGeneration = null;
        fixtureInjectedEscapeCloseIntentGeneration = null;
      } else if (channel === "chatgpt-sidebar-shape-state") {
        fixturePopupRects = Array.isArray(payload?.popupRects)
          ? payload.popupRects
          : [];
        applyFixtureOverlayShape();
      }
    });
  }

  await overlayWindow.loadFile(
    path.join(__dirname, "sidebar-overlay.html")
  );
  applyFixtureOverlayShape();

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

  const ordinaryMenuStart = events.length;
  await dispatchPointerAndClick("#account-menu");
  await dispatchPointerAndClick("#fixture-ordinary-action");
  const ordinaryNativeClickCount =
    await overlayWindow.webContents.executeJavaScript(
      "Number(window.fixtureOrdinaryNativeClickCount || 0)"
    );
  assert(
    ordinaryNativeClickCount === 1,
    "ordinary menuitem native click did not run"
  );
  assert(!events.slice(ordinaryMenuStart).some((entry) =>
    entry.channel === "chatgpt-sidebar-fullscreen-overlay-intent" ||
    entry.channel === "chatgpt-sidebar-route-intent" ||
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "ordinary menuitem emitted an intent");

  const upgradeStart = events.length;
  await dispatchPointerAndClick("#account-menu");
  await dispatchPointerAndClick("#fixture-upgrade-action");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const upgradeEvents = events.slice(upgradeStart);
  assert(upgradeEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-fullscreen-overlay-intent" &&
    entry.payload === true
  ), "Upgrade role=menuitem did not emit fullscreen intent");
  assert(!upgradeEvents.some((entry) =>
    entry.channel === "chatgpt-sidebar-route-intent" ||
    entry.channel === "chatgpt-sidebar-project-action-candidate"
  ), "Upgrade role=menuitem emitted a route or Project intent");
  const upgradeRendererState =
    await overlayWindow.webContents.executeJavaScript(`
      ({
        nativeClickCount: Number(window.fixtureUpgradeNativeClickCount || 0),
        mainVisibility: getComputedStyle(document.querySelector("main")).visibility,
        fullscreenClass: document.documentElement.classList.contains("chatgpt-multi-fullscreen-overlay")
      })
    `);
  assert(
    upgradeRendererState.nativeClickCount === 1,
    "Upgrade native click did not run"
  );
  assert(
    upgradeRendererState.fullscreenClass === true &&
      upgradeRendererState.mainVisibility === "visible" &&
      overlayState.mode === "fullscreen",
    "Upgrade did not preserve fullscreen mode after dialog report"
  );
  const upgradeShape = buildOverlayShape({
    mode: overlayState.mode,
    bounds: { width: 1200, height: 800 },
    sidebarWidth: 260,
    dialogRect: { x: 420, y: 120, width: 520, height: 420 },
    popupRects: []
  });
  assert(
    upgradeShape.length === 1 &&
      upgradeShape[0].x === 0 &&
      upgradeShape[0].y === 0 &&
      upgradeShape[0].width === 1200 &&
      upgradeShape[0].height === 800,
    "Upgrade dialog report replaced the full viewport shape"
  );
  const upgradeCloseStart = events.length;
  const retargetedCloseResult =
    await dispatchRetargetedUpgradeCloseGesture();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const retargetedCloseEvents = events.slice(upgradeCloseStart);
  const terminalCloseCount = retargetedCloseEvents.filter((entry) =>
    entry.channel === "chatgpt-sidebar-dialog-close-intent"
  ).length;
  const reopenedFullscreenCount = retargetedCloseEvents.filter((entry) =>
    entry.channel === "chatgpt-sidebar-fullscreen-overlay-intent" &&
    entry.payload === true
  ).length;
  assert(
    retargetedCloseResult?.ok === true &&
      retargetedCloseResult.pointerDownTargetKind === "close-control" &&
      retargetedCloseResult.clickTargetKind === "upgrade-menuitem" &&
      terminalCloseCount === 1 &&
      reopenedFullscreenCount === 0,
    "Upgrade close gesture was reclassified after DOM removal: " +
      `pointerdown=${retargetedCloseResult?.pointerDownTargetKind} ` +
      `click=${retargetedCloseResult?.clickTargetKind} ` +
      `terminalCloseCount=${terminalCloseCount} ` +
      `reopenedFullscreenCount=${reopenedFullscreenCount}`
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= upgradeCloseStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  await new Promise((resolve) => setTimeout(resolve, 220));
  const upgradeClosedState =
    await overlayWindow.webContents.executeJavaScript(`
      ({
        surfaceExists: Boolean(document.getElementById("fixture-upgrade-surface")),
        mainVisibility: getComputedStyle(document.querySelector("main")).visibility,
        fullscreenClass: document.documentElement.classList.contains("chatgpt-multi-fullscreen-overlay")
      })
    `);
  assert(
    upgradeClosedState.surfaceExists === false &&
      upgradeClosedState.fullscreenClass === false &&
      upgradeClosedState.mainVisibility === "hidden" &&
      overlayState.mode === "sidebar-only",
    "closing Upgrade did not restore sidebar-only mode: " +
      `surfaceExists=${upgradeClosedState.surfaceExists} ` +
      `fullscreenClass=${upgradeClosedState.fullscreenClass} ` +
      `mainVisibility=${upgradeClosedState.mainVisibility} ` +
      `mode=${overlayState.mode}`
  );

  const rightBackdropStart = events.length;
  await dispatchPointerAndClick("#project-settings");
  assert(
    overlayState.overlayOnlyModal === true &&
      shapeContainsPoint(appliedFixtureShape, 1100, 700),
    "Settings intent did not immediately capture the right-side workspace"
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= rightBackdropStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );

  await resetFixturePointerCounts();
  const dialogInsideResult =
    await dispatchWorkspacePointerSequence(400, 150);
  let settingsGuardState =
    await getFixtureSettingsGestureState();
  assert(
    dialogInsideResult.targetKind === "dialog" &&
      dialogInsideResult.settingsOutsideClickCount === 0 &&
      dialogInsideResult.escapeKeyDownCount === 0 &&
      dialogInsideResult.escapeKeyUpCount === 0 &&
      settingsGuardState.dialogExists,
    "Settings dialog-inside click triggered outside closure"
  );

  const popupStart = events.length;
  await overlayWindow.webContents.executeJavaScript(`
    (() => {
      const popup = document.createElement("div");
      popup.id = "fixture-settings-popup";
      popup.setAttribute("role", "menu");
      popup.style.position = "absolute";
      popup.style.left = "900px";
      popup.style.top = "100px";
      popup.style.width = "160px";
      popup.style.height = "100px";
      popup.style.background = "#222";
      document.body.appendChild(popup);
    })()
  `);
  await waitForEvent((entry) =>
    events.indexOf(entry) >= popupStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length > 0
  );
  await resetFixturePointerCounts();
  const popupInsideResult =
    await dispatchWorkspacePointerSequence(920, 120);
  settingsGuardState = await getFixtureSettingsGestureState();
  assert(
    popupInsideResult.targetKind === "popup" &&
      popupInsideResult.settingsOutsideClickCount === 0 &&
      popupInsideResult.escapeKeyDownCount === 0 &&
      popupInsideResult.escapeKeyUpCount === 0 &&
      settingsGuardState.dialogExists,
    "Settings popup-inside click triggered outside closure"
  );
  const popupRemoveStart = events.length;
  await overlayWindow.webContents.executeJavaScript(
    'document.getElementById("fixture-settings-popup")?.remove()'
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= popupRemoveStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.popupRects?.length === 0
  );

  await resetFixturePointerCounts();
  await dispatchRightButtonSequence(1100, 700);
  settingsGuardState = await getFixtureSettingsGestureState();
  assert(
    fixtureSettingsOutsideClickCount === 0 &&
      settingsGuardState.escapeKeyDownCount === 0 &&
      settingsGuardState.escapeKeyUpCount === 0 &&
      settingsGuardState.dialogExists,
    "Settings right click triggered outside closure"
  );

  await resetFixturePointerCounts();
  await dispatchDragSequence();
  settingsGuardState = await getFixtureSettingsGestureState();
  assert(
    fixtureSettingsOutsideClickCount === 0 &&
      settingsGuardState.escapeKeyDownCount === 0 &&
      settingsGuardState.escapeKeyUpCount === 0 &&
      settingsGuardState.dialogExists,
    "Settings pointer drag triggered outside closure"
  );

  await resetFixturePointerCounts();
  await dispatchUntrustedOutsideSequence();
  settingsGuardState = await getFixtureSettingsGestureState();
  assert(
    fixtureSettingsOutsideClickCount === 0 &&
      settingsGuardState.escapeKeyDownCount === 0 &&
      settingsGuardState.escapeKeyUpCount === 0 &&
      settingsGuardState.dialogExists,
    "Settings untrusted events triggered outside closure"
  );

  await resetFixturePointerCounts();
  const rightBackdropResult =
    await dispatchWorkspacePointerSequence(1100, 700);
  assert(
    rightBackdropResult.overlayShapeHit === true &&
      ["html", "document-body", "transparent-root"].includes(
        rightBackdropResult.targetKind
      ) &&
      rightBackdropResult.settingsOutsideClickCount === 1 &&
      rightBackdropResult.shapeStayedFullThroughEscapeDispatch === true &&
      rightBackdropResult.escapeKeyDownCount === 1 &&
      rightBackdropResult.escapeKeyUpCount === 1 &&
      rightBackdropResult.backdropPointerDownCount === 0 &&
      rightBackdropResult.backdropPointerUpCount === 0 &&
      rightBackdropResult.backdropClickCount === 0 &&
      rightBackdropResult.panePointerDownCount === 0 &&
      rightBackdropResult.panePointerUpCount === 0 &&
      rightBackdropResult.paneClickCount === 0,
    "right-side Settings backdrop click-through: " +
      `overlayShapeHit=${rightBackdropResult.overlayShapeHit} ` +
      `targetKind=${rightBackdropResult.targetKind} ` +
      `outsideIpc=${rightBackdropResult.settingsOutsideClickCount} ` +
      `escapeDown=${rightBackdropResult.escapeKeyDownCount} ` +
      `escapeUp=${rightBackdropResult.escapeKeyUpCount} ` +
      `backdropPointerDown=${rightBackdropResult.backdropPointerDownCount} ` +
      `backdropPointerUp=${rightBackdropResult.backdropPointerUpCount} ` +
      `backdropClicks=${rightBackdropResult.backdropClickCount} ` +
      `panePointerDown=${rightBackdropResult.panePointerDownCount} ` +
      `panePointerUp=${rightBackdropResult.panePointerUpCount} ` +
      `paneClicks=${rightBackdropResult.paneClickCount}`
  );
  await waitForEvent((entry) =>
    events.indexOf(entry) >= rightBackdropStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect &&
    entry.payload?.popupRects?.length === 0
  );
  assert(
    overlayState.mode === "sidebar-only" &&
      shapeContainsPoint(appliedFixtureShape, 100, 700) &&
      !shapeContainsPoint(appliedFixtureShape, 1100, 700) &&
      overlayWindow.isVisible(),
    "Settings backdrop close did not restore sidebar-only shape"
  );

  const settingsCloseStart = events.length;
  await dispatchPointerAndClick("#project-settings");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsCloseStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );
  await dispatchPointerAndClick("#project-dialog-close");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsCloseStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect
  );
  assert(
    overlayState.mode === "sidebar-only" &&
      !shapeContainsPoint(appliedFixtureShape, 1100, 700) &&
      overlayWindow.isVisible(),
    "Settings close button did not restore sidebar-only shape"
  );

  const settingsEscapeStart = events.length;
  await dispatchPointerAndClick("#project-settings");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsEscapeStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );
  await overlayWindow.webContents.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true
    }));
  `);
  await waitForEvent((entry) =>
    events.indexOf(entry) >= settingsEscapeStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    !entry.payload?.dialogRect
  );
  assert(
    overlayState.mode === "sidebar-only" &&
      !shapeContainsPoint(appliedFixtureShape, 1100, 700) &&
      overlayWindow.isVisible(),
    "Settings Escape did not restore sidebar-only shape"
  );

  const searchBackdropStart = events.length;
  await dispatchPointerAndClick("#search-control");
  await waitForEvent((entry) =>
    events.indexOf(entry) >= searchBackdropStart &&
    entry.channel === "chatgpt-sidebar-shape-state" &&
    entry.payload?.dialogRect?.height >= 300
  );
  await resetFixturePointerCounts();
  const searchBackdropResult =
    await dispatchWorkspacePointerSequence(1100, 700);
  assert(
    searchBackdropResult.overlayShapeHit === true &&
      searchBackdropResult.backdropClickCount === 1 &&
      searchBackdropResult.settingsOutsideClickCount === 0 &&
      searchBackdropResult.escapeKeyDownCount === 0 &&
      searchBackdropResult.escapeKeyUpCount === 0 &&
      searchBackdropResult.paneClickCount === 0 &&
      overlayState.mode === "sidebar-only",
    "right-side Search backdrop did not stay inside the overlay: " +
      `overlayShapeHit=${searchBackdropResult.overlayShapeHit} ` +
      `backdropClicks=${searchBackdropResult.backdropClickCount} ` +
      `paneClicks=${searchBackdropResult.paneClickCount} ` +
      `mode=${overlayState.mode}`
  );

  for (const delayMs of [
    0,
    5,
    10,
    15,
    25,
    50,
    80,
    120,
    150
  ]) {
    await runUpgradeSettingsRace(delayMs);
  }

  const settingsStart = events.length;
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
    events.indexOf(entry) >= settingsStart &&
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

  await runConfirmationFlow({
    triggerSelector: "#conversation-menu-path",
    minimumWidth: 320,
    minimumHeight: 160
  });
  await runConfirmationFlow({
    triggerSelector: "#project-menu-path",
    minimumWidth: 280,
    minimumHeight: 140
  });
  await runConfirmationFlow({
    triggerSelector: "#project-root-menu-path",
    minimumWidth: 300,
    minimumHeight: 150
  });
  await runConfirmationFlow({
    triggerSelector: "#plain-dialog-menu",
    minimumWidth: 448,
    minimumHeight: 176
  });
  await runConfirmationFlow({
    triggerSelector: "#delayed-dialog-menu",
    minimumWidth: 448,
    minimumHeight: 176
  });
  await runConfirmationFlow({
    triggerSelector: "#ancestor-dialog-menu",
    minimumWidth: 448,
    minimumHeight: 176
  });

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
  if (fullscreenCloseTimer) {
    clearTimeout(fullscreenCloseTimer);
    fullscreenCloseTimer = null;
  }
  ipcMain.removeAllListeners();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  if (parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.destroy();
  }
});
