"use strict";

const {
  createDiagnosticsLogger
} = require("./diagnostics.cjs");

const CONSOLE_PREFIX =
  "__CHATGPT_MULTI_NATIVE_MENU_DIAG__";

const ALLOWED_EVENTS = new Set([
  "native-menu-action-click",
  "native-menu-surface-summary",
  "native-menu-surface-snapshot"
]);

const SAFE_TOKEN_PATTERN =
  /^[a-z0-9_.:-]{1,80}$/i;

const STRING_FIELDS = [
  "action",
  "reason",
  "surfaceTag",
  "surfaceRole",
  "surfaceState",
  "surfaceTestId",
  "surfacePosition",
  "surfaceVisibility",
  "surfaceDisplay",
  "surfacePointerEvents"
];

const NUMBER_FIELDS = [
  "elapsedMs",
  "rectWidth",
  "rectHeight",
  "rectCount"
];

const BOOLEAN_FIELDS = [
  "surfaceInsideMain",
  "surfaceAriaModal",
  "surfaceHasInput",
  "surfaceHasButton",
  "surfaceAddedAfterAction",
  "surfaceContainsAddedNode"
];

function normalizeToken(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const token = String(value)
    .trim()
    .toLowerCase();

  return SAFE_TOKEN_PATTERN.test(token)
    ? token
    : "[redacted-attribute]";
}

function normalizeFiniteNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.round(
    Math.max(-100000, Math.min(100000, numeric))
  );
}

function normalizeSurfaceDiagnostic(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !ALLOWED_EVENTS.has(payload.event)
  ) {
    return null;
  }

  const normalized = {
    event: payload.event
  };

  for (const field of STRING_FIELDS) {
    const token = normalizeToken(payload[field]);

    if (token !== undefined) {
      normalized[field] = token;
    }
  }

  for (const field of NUMBER_FIELDS) {
    const numeric = normalizeFiniteNumber(
      payload[field]
    );

    if (numeric !== undefined) {
      normalized[field] = numeric;
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (typeof payload[field] === "boolean") {
      normalized[field] = payload[field];
    }
  }

  return normalized;
}

function browserDiagnosticBootstrap(prefix) {
  const installKey =
    "__chatgptMultiNativeMenuSurfaceDiagnosticsInstalled";

  if (window[installKey]) {
    return;
  }

  window[installKey] = true;

  const safeTokenPattern =
    /^[a-z0-9_.:-]{1,80}$/i;
  const snapshotDelays = [0, 50, 150, 500];
  const semanticSelector = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    'dialog',
    '[data-state="open"]',
    '[data-testid*="dialog"]',
    '[data-testid*="modal"]',
    'form'
  ].join(",");
  const inputSelector = [
    "input",
    "textarea",
    '[contenteditable="true"]'
  ].join(",");

  let generation = 0;
  let observer = null;
  let changedElements = new Set();
  let timers = [];

  const safeToken = (value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const token = String(value)
      .trim()
      .toLowerCase();

    return safeTokenPattern.test(token)
      ? token
      : "[redacted-attribute]";
  };

  const emit = (payload) => {
    try {
      console.info(
        prefix + JSON.stringify(payload)
      );
    } catch {
      // Diagnostics must never affect the page.
    }
  };

  const addElementAndAncestors = (
    collection,
    element,
    maximumDepth = 5
  ) => {
    let current = element;
    let depth = 0;

    while (
      current instanceof Element &&
      depth < maximumDepth
    ) {
      collection.add(current);
      current = current.parentElement;
      depth += 1;
    }
  };

  const collectChangedNode = (node) => {
    if (!(node instanceof Element)) {
      return;
    }

    changedElements.add(node);

    try {
      node
        .querySelectorAll(
          `${semanticSelector},${inputSelector}`
        )
        .forEach((element) =>
          changedElements.add(element)
        );
    } catch {
      // Ignore a transient detached subtree.
    }
  };

  const describeCandidate = (element) => {
    if (
      !(element instanceof Element) ||
      !element.isConnected
    ) {
      return null;
    }

    let rect;
    let style;

    try {
      rect = element.getBoundingClientRect();
      style = window.getComputedStyle(element);
    } catch {
      return null;
    }

    const role = safeToken(
      element.getAttribute("role")
    );
    const state = safeToken(
      element.getAttribute("data-state")
    );
    const testId = safeToken(
      element.getAttribute("data-testid")
    );
    const tag = safeToken(
      element.tagName.toLowerCase()
    );
    const position = safeToken(style.position);
    const visibility = safeToken(style.visibility);
    const display = safeToken(style.display);
    const pointerEvents = safeToken(
      style.pointerEvents
    );
    const ariaModal =
      element.getAttribute("aria-modal") === "true";
    const insideMain = Boolean(
      element.closest('main,[role="main"]')
    );
    const hasInput = Boolean(
      element.matches(inputSelector) ||
      element.querySelector(inputSelector)
    );
    const hasButton = Boolean(
      element.matches("button") ||
      element.querySelector("button")
    );
    const addedAfterAction =
      changedElements.has(element);
    const containsAddedNode =
      addedAfterAction ||
      [...changedElements].some((changed) =>
        changed !== element &&
        changed.isConnected &&
        element.contains(changed)
      );

    let score = 0;

    if (role === "dialog") score += 120;
    if (role === "alertdialog") score += 140;
    if (ariaModal) score += 100;
    if (state === "open") score += 50;
    if (testId && testId.includes("dialog")) score += 60;
    if (testId && testId.includes("modal")) score += 60;
    if (position === "fixed") score += 45;
    if (position === "absolute") score += 20;
    if (hasInput) score += 55;
    if (hasButton) score += 10;
    if (addedAfterAction) score += 35;
    if (containsAddedNode) score += 20;
    if (insideMain) score += 5;
    if (rect.width >= 180 && rect.height >= 70) score += 25;
    if (display === "none") score -= 40;

    if (score < 25) {
      return null;
    }

    return {
      score,
      payload: {
        surfaceTag: tag,
        surfaceRole: role,
        surfaceState: state,
        surfaceTestId: testId,
        surfacePosition: position,
        surfaceVisibility: visibility,
        surfaceDisplay: display,
        surfacePointerEvents: pointerEvents,
        surfaceInsideMain: insideMain,
        surfaceAriaModal: ariaModal,
        surfaceHasInput: hasInput,
        surfaceHasButton: hasButton,
        surfaceAddedAfterAction: addedAfterAction,
        surfaceContainsAddedNode: containsAddedNode,
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height)
      }
    };
  };

  const snapshot = (expectedGeneration, elapsedMs) => {
    if (expectedGeneration !== generation) {
      return;
    }

    const candidates = new Set();

    for (const element of changedElements) {
      addElementAndAncestors(
        candidates,
        element
      );
    }

    try {
      document
        .querySelectorAll(semanticSelector)
        .forEach((element) =>
          addElementAndAncestors(
            candidates,
            element,
            4
          )
        );

      document
        .querySelectorAll(inputSelector)
        .forEach((element) =>
          addElementAndAncestors(
            candidates,
            element,
            6
          )
        );
    } catch {
      // Ignore transient DOM rebuilds.
    }

    const described = [...candidates]
      .map(describeCandidate)
      .filter(Boolean)
      .sort((left, right) =>
        right.score - left.score
      )
      .slice(0, 12);

    emit({
      event: "native-menu-surface-summary",
      action: "inspect",
      reason: "post-native-menu-action",
      elapsedMs,
      rectCount: described.length
    });

    for (const entry of described) {
      emit({
        event: "native-menu-surface-snapshot",
        action: "inspect",
        reason: "post-native-menu-action",
        elapsedMs,
        rectCount: described.length,
        ...entry.payload
      });
    }

    if (elapsedMs === 500 && observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const beginObservation = () => {
    generation += 1;
    const currentGeneration = generation;

    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];

    if (observer) {
      observer.disconnect();
    }

    changedElements = new Set();

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          collectChangedNode(record.target);
          continue;
        }

        for (const node of record.addedNodes) {
          collectChangedNode(node);
        }
      }
    });

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "role",
          "aria-modal",
          "aria-hidden",
          "data-state",
          "data-testid",
          "style",
          "class"
        ]
      }
    );

    emit({
      event: "native-menu-action-click",
      action: "observe",
      reason: "native-menuitem"
    });

    for (const delay of snapshotDelays) {
      timers.push(
        setTimeout(
          () => snapshot(
            currentGeneration,
            delay
          ),
          delay
        )
      );
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest('[role="menuitem"]')
          : null;

      if (!target) {
        return;
      }

      beginObservation();
    },
    true
  );
}

function buildNativeMenuActionDiagnosticsScript() {
  return `(${browserDiagnosticBootstrap.toString()})(${JSON.stringify(CONSOLE_PREFIX)});`;
}

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

function installNativeMenuActionSurfaceDiagnostics(
  options = {}
) {
  const app = options.app;
  const logger = options.logger ||
    createDiagnosticsLogger({ app });
  const shouldApplyToUrl =
    options.shouldApplyToUrl || isChatGPTPage;

  if (!app || typeof app.on !== "function") {
    throw new TypeError("Electron app is required");
  }

  const attachedWindows = new WeakSet();
  const script =
    buildNativeMenuActionDiagnosticsScript();

  const attachWindow = (_event, window) => {
    if (
      !window?.webContents ||
      attachedWindows.has(window)
    ) {
      return;
    }

    attachedWindows.add(window);
    const webContents = window.webContents;

    webContents.on(
      "console-message",
      (_consoleEvent, _level, message) => {
        if (
          typeof message !== "string" ||
          !message.startsWith(CONSOLE_PREFIX)
        ) {
          return;
        }

        let parsed;

        try {
          parsed = JSON.parse(
            message.slice(CONSOLE_PREFIX.length)
          );
        } catch {
          return;
        }

        const normalized =
          normalizeSurfaceDiagnostic(parsed);

        if (normalized) {
          logger.log(normalized);
        }
      }
    );

    webContents.on(
      "dom-ready",
      () => {
        if (
          webContents.isDestroyed?.() ||
          !shouldApplyToUrl(
            webContents.getURL()
          )
        ) {
          return;
        }

        webContents
          .executeJavaScript(script, true)
          .catch(() => {
            // Diagnostics must never affect application behavior.
          });
      }
    );
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
  CONSOLE_PREFIX,
  buildNativeMenuActionDiagnosticsScript,
  installNativeMenuActionSurfaceDiagnostics,
  isChatGPTPage,
  normalizeSurfaceDiagnostic
};
