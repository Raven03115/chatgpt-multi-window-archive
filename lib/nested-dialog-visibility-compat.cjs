"use strict";

const ACTIVE_DIALOG_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]):not([hidden])',
  '[role="alertdialog"][aria-modal="true"]:not([aria-hidden="true"]):not([hidden])',
  '[aria-modal="true"][data-state="open"]',
  'dialog[open]',
  '[data-radix-dialog-content][data-state="open"]',
  '[data-radix-alert-dialog-content][data-state="open"]',
  '[data-testid*="dialog"][data-state="open"]',
  '[data-testid*="modal"][data-state="open"]'
].join(",");

const WORKSPACE_SELECTOR =
  ':is(main,[role="main"])';

/*
 * ChatGPT can mount an active dialog below main/[role=main]. The shaped
 * sidebar intentionally hides those workspace roots, so the dialog inherits
 * visibility:hidden and the existing preload correctly rejects it as hidden.
 *
 * Recover only the ancestor chain leading to an explicitly active dialog.
 * Sibling workspace branches remain hidden, and descendants of the dialog are
 * left to ChatGPT's own visibility rules so closed options are not exposed.
 */
const NESTED_DIALOG_VISIBILITY_CSS = `
${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR}) {
  visibility: visible !important;
}

${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR}) :has(${ACTIVE_DIALOG_SELECTOR}),
${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR}) ${ACTIVE_DIALOG_SELECTOR} {
  visibility: visible !important;
}

${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR})
  > :not(${ACTIVE_DIALOG_SELECTOR}):not(:has(${ACTIVE_DIALOG_SELECTOR})),
${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR})
  :has(${ACTIVE_DIALOG_SELECTOR})
  > :not(${ACTIVE_DIALOG_SELECTOR}):not(:has(${ACTIVE_DIALOG_SELECTOR})) {
  visibility: hidden !important;
  pointer-events: none !important;
}

${WORKSPACE_SELECTOR}:has(${ACTIVE_DIALOG_SELECTOR}) ${ACTIVE_DIALOG_SELECTOR} {
  pointer-events: auto !important;
}
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

function installNestedDialogVisibilityCompatibility(options = {}) {
  const app = options.app;
  const shouldApplyToUrl =
    options.shouldApplyToUrl || isChatGPTPage;

  if (!app || typeof app.on !== "function") {
    throw new TypeError("Electron app is required");
  }

  const cssKeys = new WeakMap();

  const applyCompatibilityCss = async (window) => {
    if (
      !window ||
      window.isDestroyed?.() ||
      !window.webContents ||
      window.webContents.isDestroyed?.()
    ) {
      return false;
    }

    const url = window.webContents.getURL();

    if (!shouldApplyToUrl(url)) {
      return false;
    }

    const previousKey = cssKeys.get(window);

    if (previousKey) {
      try {
        await window.webContents.removeInsertedCSS(previousKey);
      } catch {
        // Navigation may already have discarded the previous document.
      }
    }

    try {
      const key = await window.webContents.insertCSS(
        NESTED_DIALOG_VISIBILITY_CSS,
        { cssOrigin: "author" }
      );

      cssKeys.set(window, key);
      return true;
    } catch {
      return false;
    }
  };

  const handleWindowCreated = (_event, window) => {
    if (!window?.webContents) {
      return;
    }

    window.webContents.on(
      "dom-ready",
      () => {
        applyCompatibilityCss(window);
      }
    );

    window.on?.("closed", () => {
      cssKeys.delete(window);
    });
  };

  app.on(
    "browser-window-created",
    handleWindowCreated
  );

  return () => {
    app.removeListener?.(
      "browser-window-created",
      handleWindowCreated
    );
  };
}

module.exports = {
  ACTIVE_DIALOG_SELECTOR,
  NESTED_DIALOG_VISIBILITY_CSS,
  installNestedDialogVisibilityCompatibility,
  isChatGPTPage
};
