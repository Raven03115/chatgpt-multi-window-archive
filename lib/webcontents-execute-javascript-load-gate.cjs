"use strict";

const wrappedWebContents = new WeakSet();
const pendingLoadGates = new WeakMap();

function shouldWaitForRendererLoad(webContents) {
  if (
    !webContents ||
    typeof webContents.getURL !== "function" ||
    typeof webContents.isLoadingMainFrame !== "function"
  ) {
    return false;
  }

  try {
    if (
      typeof webContents.isDestroyed === "function" &&
      webContents.isDestroyed()
    ) {
      return false;
    }

    return (
      !String(webContents.getURL() || "") ||
      webContents.isLoadingMainFrame()
    );
  } catch {
    return false;
  }
}

function waitForRendererStop(webContents) {
  const existing = pendingLoadGates.get(webContents);

  if (existing) {
    return existing;
  }

  let settle;
  const gate = new Promise((resolve) => {
    settle = resolve;
  });

  pendingLoadGates.set(webContents, gate);

  let settled = false;

  const finish = () => {
    if (settled) {
      return;
    }

    settled = true;

    webContents.removeListener?.(
      "did-stop-loading",
      finish
    );
    webContents.removeListener?.(
      "destroyed",
      finish
    );

    if (pendingLoadGates.get(webContents) === gate) {
      pendingLoadGates.delete(webContents);
    }

    settle();
  };

  webContents.once("did-stop-loading", finish);
  webContents.once("destroyed", finish);

  return gate;
}

function wrapExecuteJavaScript(webContents) {
  if (
    !webContents ||
    wrappedWebContents.has(webContents) ||
    typeof webContents.executeJavaScript !== "function" ||
    typeof webContents.once !== "function"
  ) {
    return false;
  }

  const originalExecuteJavaScript =
    webContents.executeJavaScript.bind(webContents);

  webContents.executeJavaScript = async (...args) => {
    if (shouldWaitForRendererLoad(webContents)) {
      await waitForRendererStop(webContents);
    }

    return originalExecuteJavaScript(...args);
  };

  wrappedWebContents.add(webContents);
  return true;
}

function installExecuteJavaScriptLoadGate(options = {}) {
  const app = options.app;

  if (!app || typeof app.on !== "function") {
    throw new TypeError("Electron app is required");
  }

  const attach = (_event, webContents) => {
    wrapExecuteJavaScript(webContents);
  };

  app.on("web-contents-created", attach);

  return () => {
    app.removeListener?.(
      "web-contents-created",
      attach
    );
  };
}

module.exports = {
  installExecuteJavaScriptLoadGate,
  shouldWaitForRendererLoad,
  wrapExecuteJavaScript
};
