"use strict";

const { classifyRoute } = require("./route-policy.cjs");

const ACTIVE_PANE_CONTEXT_TOAST_ID =
  "chatgpt-multi-pane-context-toast";
const ACTIVE_PANE_CONTEXT_TOAST_STATE =
  "__chatgptMultiPaneContextToastState";
const MAX_DISPLAY_TITLE_LENGTH = 120;
const TOAST_VISIBLE_MS = 2600;
const TOAST_FADE_OUT_MS = 300;

function parseChatGptUrl(value) {
  try {
    const parsed = new URL(value);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function extractConversationId(value) {
  const parsed = parseChatGptUrl(value);

  if (!parsed) {
    return null;
  }

  const match = parsed.pathname.match(
    /(?:^|\/)c\/([^/]+)\/?$/i
  );

  return match?.[1] || null;
}

function normalizePaneDisplayTitle(value) {
  let title = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^chatgpt$/i.test(title)) {
    return "";
  }

  title = title
    .replace(/^chatgpt\s*(?:-|\|)\s*/i, "")
    .replace(/\s*(?:-|\|)\s*chatgpt$/i, "")
    .trim();

  return Array.from(title)
    .slice(0, MAX_DISPLAY_TITLE_LENGTH)
    .join("");
}

function classifyPaneDisplayRoute(value) {
  const parsed = parseChatGptUrl(value);

  if (!parsed) {
    return {
      routeKind: "invalid",
      routeIdentity: "invalid"
    };
  }

  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const lowerPathname = pathname.toLowerCase();
  const conversationId = extractConversationId(parsed.href);

  if (pathname === "/") {
    return {
      routeKind: "new-chat",
      routeIdentity: "new-chat:/"
    };
  }

  if (conversationId) {
    const routeKind = classifyRoute(parsed.href);

    return {
      routeKind,
      routeIdentity: `${routeKind}:${conversationId}`
    };
  }

  if (/^\/g\/g-p-[^/]+(?:\/project)?$/i.test(pathname)) {
    return {
      routeKind: "project-workspace",
      routeIdentity: `project-workspace:${lowerPathname}`
    };
  }

  if (/^\/g\/[^/]+(?:\/.*)?$/i.test(pathname)) {
    return {
      routeKind: "gpt",
      routeIdentity: `gpt:${lowerPathname}`
    };
  }

  const routeKind = classifyRoute(parsed.href);

  return {
    routeKind,
    routeIdentity: `${routeKind}:${lowerPathname}`
  };
}

function getFallbackDisplayTitle(routeKind) {
  if (routeKind === "new-chat") {
    return "新對話";
  }

  if (
    routeKind === "conversation" ||
    routeKind === "project-conversation"
  ) {
    return "目前對話";
  }

  if (routeKind === "gpt") {
    return "GPT";
  }

  if (routeKind === "project-workspace") {
    return "Project";
  }

  return "目前頁面";
}

function buildPaneContextSignature(context = {}) {
  return JSON.stringify([
    Number.isInteger(context.paneIndex)
      ? context.paneIndex
      : -1,
    Number.isInteger(context.paneCount)
      ? context.paneCount
      : 0,
    String(
      context.routeIdentity ||
      context.conversationId ||
      context.routeKind ||
      "invalid"
    ),
    String(context.displayTitle || "")
  ]);
}

function createPaneDisplayContext(input = {}) {
  const paneIndex = Number.isInteger(input.paneIndex)
    ? Math.max(0, input.paneIndex)
    : 0;
  const paneCount = Number.isInteger(input.paneCount)
    ? Math.max(1, input.paneCount)
    : 1;
  const url = String(input.url || "");
  const conversationId = extractConversationId(url);
  const route = classifyPaneDisplayRoute(url);
  const normalizedTitle = normalizePaneDisplayTitle(input.title);
  const displayTitle =
    normalizedTitle || getFallbackDisplayTitle(route.routeKind);
  const context = {
    paneIndex,
    paneCount,
    url,
    routeKind: route.routeKind,
    routeIdentity: route.routeIdentity,
    conversationId,
    displayTitle
  };

  return {
    ...context,
    signature: buildPaneContextSignature(context)
  };
}

function shouldShowPaneContextToast(input = {}) {
  return Boolean(
    input.userInitiated === true &&
    input.suppressed !== true &&
    input.viewUsable === true &&
    typeof input.signature === "string" &&
    input.signature.length > 0 &&
    input.signature !== input.lastSignature
  );
}

function serializeForJavaScript(value) {
  return JSON.stringify(value).replace(
    /[<\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function getTimerCleanupScript() {
  return `
    const previousState =
      window[${JSON.stringify(ACTIVE_PANE_CONTEXT_TOAST_STATE)}];

    if (previousState?.fadeTimer) {
      clearTimeout(previousState.fadeTimer);
    }

    if (previousState?.removeTimer) {
      clearTimeout(previousState.removeTimer);
    }
  `;
}

function getRemoveActivePaneContextToastScript() {
  return `
    (() => {
      ${getTimerCleanupScript()}

      document
        .getElementById(${JSON.stringify(ACTIVE_PANE_CONTEXT_TOAST_ID)})
        ?.remove();

      window[${JSON.stringify(ACTIVE_PANE_CONTEXT_TOAST_STATE)}] = null;
      return true;
    })();
  `;
}

function getActivePaneContextToastScript(context) {
  const safeContext = {
    paneIndex: context?.paneIndex,
    paneCount: context?.paneCount,
    displayTitle: context?.displayTitle,
    signature: context?.signature
  };

  return `
    (() => {
      const context = ${serializeForJavaScript(safeContext)};
      const TOAST_ID = ${JSON.stringify(ACTIVE_PANE_CONTEXT_TOAST_ID)};
      const STATE_KEY = ${JSON.stringify(ACTIVE_PANE_CONTEXT_TOAST_STATE)};
      ${getTimerCleanupScript()}

      const existing = document.getElementById(TOAST_ID);
      if (existing) {
        existing.remove();
      }

      const toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.style.position = "fixed";
      toast.style.top = "24px";
      toast.style.left = "50%";
      toast.style.transform = "translateX(-50%)";
      toast.style.pointerEvents = "none";
      toast.style.userSelect = "none";
      toast.style.zIndex = "2147483646";
      toast.style.boxSizing = "border-box";
      toast.style.maxWidth = "min(480px, 70vw)";
      toast.style.padding = "12px 18px";
      toast.style.borderRadius = "12px";
      toast.style.background = "rgba(17, 17, 17, 0.88)";
      toast.style.color = "#ffffff";
      toast.style.boxShadow = "0 12px 32px rgba(0, 0, 0, 0.38)";
      toast.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      toast.style.textAlign = "center";
      toast.style.opacity = "0";
      toast.style.transition =
        "opacity 180ms ease-out, transform 180ms ease-out";

      const paneLine = document.createElement("div");
      paneLine.style.fontSize = "13px";
      paneLine.style.fontWeight = "600";
      paneLine.style.lineHeight = "1.35";
      paneLine.style.color = "rgba(255, 255, 255, 0.72)";
      paneLine.textContent =
        "窗格 " + (context.paneIndex + 1) + " / " + context.paneCount;

      const titleLine = document.createElement("div");
      titleLine.style.marginTop = "4px";
      titleLine.style.fontSize = "16px";
      titleLine.style.fontWeight = "600";
      titleLine.style.lineHeight = "1.4";
      titleLine.style.whiteSpace = "nowrap";
      titleLine.style.overflow = "hidden";
      titleLine.style.textOverflow = "ellipsis";
      titleLine.textContent = context.displayTitle;

      toast.append(paneLine, titleLine);
      document.documentElement.appendChild(toast);

      requestAnimationFrame(() => {
        if (toast.isConnected) {
          toast.style.opacity = "1";
        }
      });

      const state = {
        signature: context.signature,
        fadeTimer: null,
        removeTimer: null
      };

      state.fadeTimer = setTimeout(() => {
        if (!toast.isConnected) {
          return;
        }

        toast.style.opacity = "0";
        state.removeTimer = setTimeout(() => {
          toast.remove();

          if (window[STATE_KEY] === state) {
            window[STATE_KEY] = null;
          }
        }, ${TOAST_FADE_OUT_MS});
      }, ${TOAST_VISIBLE_MS});

      window[STATE_KEY] = state;
      return true;
    })();
  `;
}

module.exports = {
  ACTIVE_PANE_CONTEXT_TOAST_ID,
  MAX_DISPLAY_TITLE_LENGTH,
  TOAST_FADE_OUT_MS,
  TOAST_VISIBLE_MS,
  buildPaneContextSignature,
  classifyPaneDisplayRoute,
  createPaneDisplayContext,
  extractConversationId,
  getActivePaneContextToastScript,
  getRemoveActivePaneContextToastScript,
  normalizePaneDisplayTitle,
  shouldShowPaneContextToast
};
