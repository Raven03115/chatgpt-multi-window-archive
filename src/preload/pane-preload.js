const { ipcRenderer } = require("electron");

const STYLE_ID = "chatgpt-floating-workspace-style";
const ACTIVE_ID = "chatgpt-floating-active-overlay";

const CSS = `
  #stage-slideover-sidebar,
  [data-testid="sidebar"],
  [data-testid="sidebar-container"],
  [data-testid="conversation-sidebar"],
  nav[aria-label="Chat history"],
  nav[aria-label*="聊天"],
  nav[aria-label*="對話"],
  aside:has(a[href^="/c/"]) {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    pointer-events: none !important;
  }

  html, body {
    --sidebar-width: 0px !important;
  }

  main, [role="main"] {
    margin-left: 0 !important;
    max-width: none !important;
  }

  button[aria-label*="Open sidebar"],
  button[aria-label*="Close sidebar"],
  button[aria-label*="open sidebar"],
  button[aria-label*="close sidebar"],
  button[aria-label*="Sidebar"],
  button[aria-label*="sidebar"],
  button[aria-label*="側邊欄"],
  button[aria-label*="開啟側邊欄"],
  button[aria-label*="關閉側邊欄"],
  button[data-testid*="sidebar"],
  button[data-testid*="Sidebar"],
  [data-testid="open-sidebar-button"],
  [data-testid="close-sidebar-button"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

function setActive(active) {
  let overlay = document.getElementById(ACTIVE_ID);
  if (!active) {
    overlay?.remove();
    return;
  }

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = ACTIVE_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxSizing: "border-box",
      border: "2px solid rgba(156, 163, 175, 0.60)"
    });
    document.documentElement.appendChild(overlay);
  }
}

function start() {
  ensureStyle();
  const observer = new MutationObserver(ensureStyle);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
}

ipcRenderer.on("workspace:pane-active", (_event, active) => setActive(Boolean(active)));

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
