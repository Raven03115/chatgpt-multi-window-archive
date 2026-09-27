"use strict";

const path = require("node:path");
const os = require("node:os");
const {
  app,
  BrowserWindow,
  ipcMain,
  session
} = require("electron");

const fixtureUserDataPath = path.join(
  os.tmpdir(),
  `chatgpt-multi-window-nested-dialog-${process.pid}`
);
app.setPath("userData", fixtureUserDataPath);

const {
  installNestedDialogVisibilityCompatibility
} = require("../../lib/nested-dialog-visibility-compat.cjs");

installNestedDialogVisibilityCompatibility({
  app,
  shouldApplyToUrl: () => true
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function waitForDialogRect(timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const handler = (_event, payload) => {
      if (!payload?.dialogRect) {
        return;
      }

      clearTimeout(timer);
      ipcMain.removeListener(
        "chatgpt-sidebar-shape-state",
        handler
      );
      resolve(payload.dialogRect);
    };

    const timer = setTimeout(() => {
      ipcMain.removeListener(
        "chatgpt-sidebar-shape-state",
        handler
      );
      reject(new Error("nested dialog rect timeout"));
    }, timeoutMs);

    ipcMain.on(
      "chatgpt-sidebar-shape-state",
      handler
    );
  });
}

async function run() {
  const fixturePartition =
    `nested-dialog-fixture-${Date.now()}`;
  const fixtureSession =
    session.fromPartition(fixturePartition);

  fixtureSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );

  const window = new BrowserWindow({
    x: -10000,
    y: -10000,
    width: 1200,
    height: 800,
    show: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(
        __dirname,
        "..",
        "..",
        "sidebar-shape-preload-v4.5.4.js"
      ),
      partition: fixturePartition,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  await window.loadURL(
    "data:text/html," +
      encodeURIComponent(`<!doctype html>
        <html>
          <body>
            <aside style="position:absolute;left:0;top:0;width:260px;height:800px"></aside>
            <main id="workspace" style="position:absolute;left:260px;top:0;width:940px;height:800px">
              <section id="conversation-content">conversation workspace</section>
              <div id="dialog-host">
                <section
                  id="rename-dialog"
                  role="dialog"
                  aria-modal="true"
                  data-state="open"
                  style="position:absolute;left:180px;top:180px;width:420px;height:180px;background:#333;border-radius:12px"
                >
                  <input id="rename-input" value="fixture">
                  <div id="closed-option" style="visibility:hidden">hidden option</div>
                  <button id="rename-cancel">cancel</button>
                </section>
              </div>
            </main>
          </body>
        </html>`)
  );

  const dialogRect = await waitForDialogRect();

  assert(
    dialogRect.width >= 400 &&
      dialogRect.height >= 170,
    "nested rename dialog was not detected"
  );

  const state = await window.webContents.executeJavaScript(`
    ({
      mainVisibility: getComputedStyle(document.getElementById("workspace")).visibility,
      hostVisibility: getComputedStyle(document.getElementById("dialog-host")).visibility,
      dialogVisibility: getComputedStyle(document.getElementById("rename-dialog")).visibility,
      dialogPointerEvents: getComputedStyle(document.getElementById("rename-dialog")).pointerEvents,
      workspaceVisibility: getComputedStyle(document.getElementById("conversation-content")).visibility,
      hiddenOptionVisibility: getComputedStyle(document.getElementById("closed-option")).visibility
    })
  `);

  assert(
    state.mainVisibility === "visible" &&
      state.hostVisibility === "visible" &&
      state.dialogVisibility === "visible" &&
      state.dialogPointerEvents === "auto",
    "active nested dialog chain was not recovered"
  );
  assert(
    state.workspaceVisibility === "hidden",
    "workspace content became visible while nested dialog was active"
  );
  assert(
    state.hiddenOptionVisibility === "hidden",
    "compatibility CSS forced a hidden dialog descendant visible"
  );

  window.destroy();
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    app.exit(1);
  });
