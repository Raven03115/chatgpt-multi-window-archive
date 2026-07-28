"use strict";

const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";

function normalizeGoogleAuthUserAgent(value) {
  return String(value || "")
    .replace(/(?:^|\s+)Electron\/[0-9.]+(?=\s|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGoogleAccountsUrl(value) {
  try {
    return new URL(value).origin === GOOGLE_ACCOUNTS_ORIGIN;
  } catch {
    return false;
  }
}

function isChatGptAuthCompletionUrl(value) {
  try {
    const parsed = new URL(value);

    if (parsed.origin !== "https://chatgpt.com") {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();

    return !(
      pathname === "/login" ||
      pathname.startsWith("/login/") ||
      pathname === "/auth" ||
      pathname.startsWith("/auth/")
    );
  } catch {
    return false;
  }
}

function attachGoogleAuthUserAgentCompatibility(webContents) {
  if (
    !webContents ||
    typeof webContents.getUserAgent !== "function" ||
    typeof webContents.setUserAgent !== "function" ||
    typeof webContents.on !== "function" ||
    typeof webContents.loadURL !== "function"
  ) {
    throw new TypeError("A valid Electron webContents is required");
  }

  const originalUserAgent = String(
    webContents.getUserAgent() || ""
  );
  const compatibleUserAgent =
    normalizeGoogleAuthUserAgent(originalUserAgent);

  let compatibilityActive = false;
  let restartPending = false;

  function activate() {
    if (
      compatibilityActive ||
      compatibleUserAgent === originalUserAgent
    ) {
      compatibilityActive = true;
      return;
    }

    webContents.setUserAgent(compatibleUserAgent);
    compatibilityActive = true;
  }

  function restore() {
    if (!compatibilityActive) {
      return;
    }

    if (compatibleUserAgent !== originalUserAgent) {
      webContents.setUserAgent(originalUserAgent);
    }

    compatibilityActive = false;
  }

  function restartGoogleNavigation(event, url, isMainFrame = true) {
    if (
      isMainFrame === false ||
      compatibilityActive ||
      restartPending ||
      !isGoogleAccountsUrl(url)
    ) {
      return false;
    }

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    activate();
    restartPending = true;

    Promise.resolve(webContents.loadURL(url))
      .catch(() => {
        restore();
      })
      .finally(() => {
        restartPending = false;
      });

    return true;
  }

  webContents.on(
    "will-navigate",
    (event, url, _isInPlace, isMainFrame) => {
      restartGoogleNavigation(
        event,
        url,
        isMainFrame
      );
    }
  );

  webContents.on(
    "will-redirect",
    (event, url, _isInPlace, isMainFrame) => {
      restartGoogleNavigation(
        event,
        url,
        isMainFrame
      );
    }
  );

  webContents.on(
    "did-navigate",
    (_event, url) => {
      if (
        compatibilityActive &&
        isChatGptAuthCompletionUrl(url)
      ) {
        restore();
      }
    }
  );

  webContents.on("destroyed", () => {
    compatibilityActive = false;
    restartPending = false;
  });

  return {
    compatibleUserAgent,
    originalUserAgent,
    isActive: () => compatibilityActive,
    restore
  };
}

module.exports = {
  attachGoogleAuthUserAgentCompatibility,
  isChatGptAuthCompletionUrl,
  isGoogleAccountsUrl,
  normalizeGoogleAuthUserAgent
};