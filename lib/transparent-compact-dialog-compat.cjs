"use strict";

const COMPAT_SCRIPT = `
(() => {
  const installKey = "__chatgptMultiTransparentCompactDialogCompat";

  if (window[installKey]) {
    return;
  }

  window[installKey] = true;

  const semanticSelector = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    'dialog[open]',
    '[data-radix-dialog-content]',
    '[data-radix-alert-dialog-content]'
  ].join(",");
  const previousInlineBackground = new WeakMap();

  const isTransparent = (value) => {
    const normalized = String(value || "")
      .replace(/\\s+/g, "")
      .toLowerCase();

    return (
      normalized === "transparent" ||
      normalized === "rgba(0,0,0,0)" ||
      normalized === "rgb(0 0 0/0)" ||
      normalized === "rgb(0,0,0,0)"
    );
  };

  const isExplicitActiveDialog = (element) => {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    if (element.hasAttribute("hidden")) {
      return false;
    }

    const state = String(
      element.getAttribute("data-state") || ""
    ).toLowerCase();

    if (state === "closed") {
      return false;
    }

    return (
      element.getAttribute("role") === "dialog" ||
      element.getAttribute("role") === "alertdialog" ||
      element.getAttribute("aria-modal") === "true" ||
      element.matches("dialog[open]") ||
      element.matches("[data-radix-dialog-content]") ||
      element.matches("[data-radix-alert-dialog-content]")
    );
  };

  const restore = (element) => {
    if (!previousInlineBackground.has(element)) {
      return;
    }

    const previous = previousInlineBackground.get(element);
    previousInlineBackground.delete(element);

    if (!previous.value) {
      element.style.removeProperty("background-color");
      return;
    }

    element.style.setProperty(
      "background-color",
      previous.value,
      previous.priority
    );
  };

  const reconcile = (element) => {
    if (!(element instanceof Element)) {
      return;
    }

    if (!isExplicitActiveDialog(element)) {
      restore(element);
      return;
    }

    const rect = element.getBoundingClientRect();
    const isCompact =
      rect.width >= 240 &&
      rect.height >= 100 &&
      rect.width < window.innerWidth * 0.88 &&
      rect.height < 190;

    if (!isCompact) {
      restore(element);
      return;
    }

    const style = window.getComputedStyle(element);

    if (!isTransparent(style.backgroundColor)) {
      restore(element);
      return;
    }

    if (!previousInlineBackground.has(element)) {
      previousInlineBackground.set(
        element,
        {
          value: element.style.getPropertyValue("background-color"),
          priority: element.style.getPropertyPriority("background-color")
        }
      );
    }

    /*
     * The overlay isolation stylesheet intentionally makes direct body
     * children transparent with !important. ChatGPT's current compact
     * rename dialog can itself be one of those direct portal children.
     * Use an inline !important alpha so the semantic dialog root survives
     * both that rule and Chromium's roughly 8-bit computed-alpha rounding.
     * 0.004 is approximately 1/255 and remains visually imperceptible.
     */
    element.style.setProperty(
      "background-color",
      "rgba(0, 0, 0, 0.004)",
      "important"
    );
  };

  const scan = () => {
    try {
      document
        .querySelectorAll(semanticSelector)
        .forEach(reconcile);
    } catch {
      // Compatibility must never interrupt ChatGPT rendering.
    }
  };

  const observer = new MutationObserver(() => {
    scan();
  });

  const start = () => {
    scan();

    if (!document.documentElement) {
      return;
    }

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-hidden",
          "aria-modal",
          "data-state",
          "hidden",
          "role",
          "class"
        ]
      }
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
`;

function isChatGPTPage(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com"
    );
  } catch {
    return false;
  }
}

function installTransparentCompactDialogCompatibility(
  options = {}
) {
  const app = options.app;
  const shouldApplyToUrl =
    options.shouldApplyToUrl || isChatGPTPage;

  if (!app || typeof app.on !== "function") {
    throw new TypeError("Electron app is required");
  }

  const attachedWindows = new WeakSet();

  const attachWindow = (_event, window) => {
    if (
      !window?.webContents ||
      attachedWindows.has(window)
    ) {
      return;
    }

    attachedWindows.add(window);
    const webContents = window.webContents;

    webContents.on("dom-ready", () => {
      if (
        webContents.isDestroyed?.() ||
        !shouldApplyToUrl(webContents.getURL())
      ) {
        return;
      }

      webContents
        .executeJavaScript(COMPAT_SCRIPT, true)
        .catch(() => {
          // Compatibility must never interrupt application behavior.
        });
    });
  };

  app.on(
    "browser-window-created",
    attachWindow
  );

  return () => {
    app.removeListener?.(
      "browser-window-created",
      attachWindow
    );
  };
}

module.exports = {
  COMPAT_SCRIPT,
  installTransparentCompactDialogCompatibility,
  isChatGPTPage
};
