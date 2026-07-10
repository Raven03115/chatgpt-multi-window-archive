/*
 * ChatGPT Multi Pane v4.5.2
 * Early pane chrome guard.
 *
 * This runs before the page finishes loading. It uses only conservative
 * static selectors; the main process applies geometry-checked fallbacks.
 */

const STYLE_ID =
  "chatgpt-multi-pane-early-chrome-style";

const CSS = `
  #stage-slideover-sidebar,
  [data-testid="sidebar"],
  [data-testid="conversation-sidebar"],
  nav[aria-label="Chat history"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    pointer-events: none !important;
  }

  html,
  body {
    --sidebar-width: 0px !important;
  }

  main,
  [role="main"] {
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

function install() {
  if (
    !document.documentElement ||
    document.getElementById(STYLE_ID)
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id = STYLE_ID;
  style.textContent = CSS;

  document.documentElement.appendChild(style);
}

install();

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    install,
    { once: true }
  );
}
