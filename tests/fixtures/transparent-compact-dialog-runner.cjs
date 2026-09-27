"use strict";

const path = require("node:path");
const os = require("node:os");
const {
  app,
  BrowserWindow,
  ipcMain,
  session
} = require("electron");

app.setPath(
  "userData",
  path.join(
    os.tmpdir(),
    `chatgpt-multi-window-transparent-dialog-${process.pid}`
  )
);

const {
  installTransparentCompactDialogCompatibility
} = require("../../lib/transparent-compact-dialog-compat.cjs");

installTransparentCompactDialogCompatibility({
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
      resolve(payload);
    };

    const timer = setTimeout(() => {
      ipcMain.removeListener(
        "chatgpt-sidebar-shape-state",
        handler
      );
      reject(
        new Error(
          "transparent compact role=dialog was not detected"
        )
      );
    }, timeoutMs);

    ipcMain.on(
      "chatgpt-sidebar-shape-state",
      handler
    );
  });
}

async function run() {
  const partition =
    `transparent-dialog-fixture-${Date.now()}`;
  const fixtureSession =
    session.fromPartition(partition);

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
      partition,
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
            <main style="position:absolute;left:260px;top:0;width:940px;height:800px">
              workspace
            </main>
            <div id="portal-root"></div>
          </body>
        </html>`)
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  const reportPromise = waitForDialogRect();

  await window.webContents.executeJavaScript(`
    (() => {
      const dialog = document.createElement("div");
      dialog.id = "rename-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("data-state", "open");
      dialog.style.position = "fixed";
      dialog.style.left = "390px";
      dialog.style.top = "250px";
      dialog.style.width = "420px";
      dialog.style.height = "188px";
      dialog.style.background = "transparent";
      dialog.style.pointerEvents = "auto";

      const panel = document.createElement("form");
      panel.style.width = "420px";
      panel.style.height = "188px";
      panel.style.background = "rgb(40, 40, 40)";
      panel.innerHTML = [
        '<input value="fixture">',
        '<button type="button">cancel</button>'
      ].join("");

      dialog.appendChild(panel);
      document.getElementById("portal-root").appendChild(dialog);
    })()
  `);

  const payload = await reportPromise;

  assert(
    payload.dialogKind === "compact-confirmation",
    `unexpected dialog kind: ${payload.dialogKind}`
  );
  assert(
    payload.dialogRect.width >= 418 &&
      payload.dialogRect.height >= 186,
    `unexpected dialog rect: ${JSON.stringify(payload.dialogRect)}`
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
