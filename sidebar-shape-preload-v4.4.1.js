const { ipcRenderer } = require("electron");

const SIDEBAR_WIDTH = 260;
const MAX_RECTS = 24;

const SMALL_POPUP_PADDING = 3;
const LARGE_DIALOG_PADDING = 1;
const MIN_RECT_SIZE = 4;
const MERGE_GAP = 3;

const DIALOG_ROOT_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog[open]',
  '[data-radix-dialog-content]',
  '[data-testid*="dialog"]',
  '[data-testid*="modal"]'
];

const SMALL_POPUP_SELECTORS = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[popover]:popover-open',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-menu-content]',
  '[data-radix-dropdown-menu-content]',
  '[data-radix-select-content]',
  '[data-radix-popover-content]'
];

const DIALOG_ANCESTOR_SELECTOR =
  DIALOG_ROOT_SELECTORS.join(",");


const OVERLAY_ISOLATION_STYLE_ID =
  "chatgpt-multi-overlay-isolation-style";

const OVERLAY_ISOLATION_CSS = `
  html,
  body,
  #root,
  #__next,
  body > div {
    background-color: transparent !important;
  }

  main,
  main *,
  [role="main"],
  [role="main"] * {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  [role="dialog"],
  [role="dialog"] *,
  [aria-modal="true"],
  [aria-modal="true"] *,
  [role="menu"],
  [role="menu"] *,
  [role="listbox"],
  [role="listbox"] *,
  [role="tooltip"],
  [role="tooltip"] *,
  [popover]:popover-open,
  [popover]:popover-open *,
  [data-radix-popper-content-wrapper],
  [data-radix-popper-content-wrapper] *,
  [data-radix-dialog-content],
  [data-radix-dialog-content] *,
  [data-radix-menu-content],
  [data-radix-menu-content] *,
  [data-radix-dropdown-menu-content],
  [data-radix-dropdown-menu-content] *,
  [data-radix-select-content],
  [data-radix-select-content] *,
  [data-radix-popover-content],
  [data-radix-popover-content] * {
    visibility: visible !important;
    pointer-events: auto !important;
  }

  html.chatgpt-multi-fullscreen-overlay,
  html.chatgpt-multi-fullscreen-overlay body,
  html.chatgpt-multi-fullscreen-overlay #root,
  html.chatgpt-multi-fullscreen-overlay #__next,
  html.chatgpt-multi-fullscreen-overlay body > div {
    background-color: #000000 !important;
  }

  html.chatgpt-multi-fullscreen-overlay main,
  html.chatgpt-multi-fullscreen-overlay main *,
  html.chatgpt-multi-fullscreen-overlay [role="main"],
  html.chatgpt-multi-fullscreen-overlay [role="main"] * {
    visibility: visible !important;
    pointer-events: auto !important;
  }
`;

function installOverlayIsolationStyle() {
  if (!document.documentElement) {
    return;
  }

  let style =
    document.getElementById(
      OVERLAY_ISOLATION_STYLE_ID
    );

  if (!style) {
    style = document.createElement("style");
    style.id =
      OVERLAY_ISOLATION_STYLE_ID;
    style.textContent =
      OVERLAY_ISOLATION_CSS;

    document.documentElement.appendChild(
      style
    );
  }
}

ipcRenderer.on(
  "chatgpt-sidebar-set-fullscreen-mode",
  (_event, enabled) => {
    if (!document.documentElement) {
      return;
    }

    document.documentElement.classList.toggle(
      "chatgpt-multi-fullscreen-overlay",
      Boolean(enabled)
    );
  }
);

let observer = null;
let fallbackTimer = null;
let started = false;
let lastSignature = "";

const pendingTimers = new Set();

function isVisible(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const style =
    window.getComputedStyle(element);

  const rect =
    element.getBoundingClientRect();

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return false;
  }

  return (
    rect.width >= MIN_RECT_SIZE &&
    rect.height >= MIN_RECT_SIZE
  );
}

function collectElements(selectors) {
  const result = new Set();

  for (const selector of selectors) {
    try {
      document
        .querySelectorAll(selector)
        .forEach((element) =>
          result.add(element)
        );
    } catch {
      // Ignore selectors not supported
      // by the current DOM state.
    }
  }

  return [...result];
}

function getMetadata(element) {
  return [
    element.className
      ? String(element.className)
      : "",
    element.getAttribute(
      "data-testid"
    ) || "",
    element.getAttribute(
      "data-state"
    ) || "",
    element.getAttribute("role") || ""
  ]
    .join(" ")
    .toLowerCase();
}

function getRect(element) {
  const rect =
    element.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function rectArea(rect) {
  return rect.width * rect.height;
}

function areaRatio(rect) {
  return (
    rectArea(rect) /
    Math.max(
      1,
      window.innerWidth *
      window.innerHeight
    )
  );
}

function isNearlyFullscreen(rect) {
  return (
    rect.width >=
      window.innerWidth * 0.88 ||
    rect.height >=
      window.innerHeight * 0.88 ||
    areaRatio(rect) >= 0.72
  );
}

function hasOpaqueBackground(element) {
  const style =
    window.getComputedStyle(element);

  const value =
    style.backgroundColor || "";

  if (
    value === "transparent" ||
    value === "rgba(0, 0, 0, 0)"
  ) {
    return false;
  }

  return true;
}

function getBorderRadius(element) {
  const style =
    window.getComputedStyle(element);

  const value =
    Number.parseFloat(
      style.borderTopLeftRadius
    );

  return Number.isFinite(value)
    ? value
    : 0;
}

function hasInteractiveContent(element) {
  return Boolean(
    element.querySelector(
      [
        "button",
        "input",
        "textarea",
        "select",
        "a[href]",
        '[role="menuitem"]',
        '[role="option"]',
        '[role="textbox"]',
        '[contenteditable="true"]'
      ].join(",")
    )
  );
}

function hasCloseControl(element) {
  return Boolean(
    element.querySelector(
      [
        'button[aria-label*="Close"]',
        'button[aria-label*="close"]',
        'button[aria-label*="關閉"]',
        'button[title*="Close"]',
        'button[title*="關閉"]',
        '[data-testid*="close"]'
      ].join(",")
    )
  );
}

function isReasonableDialogSurface(
  element,
  rect
) {
  if (!isVisible(element)) {
    return false;
  }

  if (
    rect.right <=
    SIDEBAR_WIDTH + 1
  ) {
    return false;
  }

  if (
    rect.width < 340 ||
    rect.height < 190
  ) {
    return false;
  }

  if (isNearlyFullscreen(rect)) {
    return false;
  }

  if (!hasInteractiveContent(element)) {
    return false;
  }

  return true;
}

function dialogSurfaceScore(
  element,
  rect,
  root
) {
  let score = 0;

  const role = (
    element.getAttribute("role") || ""
  ).toLowerCase();

  const metadata =
    getMetadata(element);

  if (element === root) {
    score += 25;
  }

  if (role === "dialog") {
    score += 90;
  }

  if (
    element.getAttribute(
      "aria-modal"
    ) === "true"
  ) {
    score += 80;
  }

  if (
    element.matches(
      "[data-radix-dialog-content]"
    )
  ) {
    score += 100;
  }

  if (
    metadata.includes("dialog") ||
    metadata.includes("modal")
  ) {
    score += 35;
  }

  if (hasOpaqueBackground(element)) {
    score += 40;
  }

  const borderRadius =
    getBorderRadius(element);

  if (borderRadius >= 6) {
    score += 35;
  }

  if (hasCloseControl(element)) {
    score += 25;
  }

  const style =
    window.getComputedStyle(element);

  if (
    style.overflow === "hidden" ||
    style.overflowY === "auto" ||
    style.overflowY === "scroll"
  ) {
    score += 12;
  }

  /*
   * 偏好完整 panel，而不是 panel 內部
   * 某個很小的內容區。
   */
  score +=
    Math.min(areaRatio(rect), 0.55) *
    100;

  /*
   * 越接近 viewport 中央越合理。
   */
  const centerX =
    rect.left + rect.width / 2;

  const centerY =
    rect.top + rect.height / 2;

  const distanceX =
    Math.abs(
      centerX - window.innerWidth / 2
    ) /
    Math.max(1, window.innerWidth);

  const distanceY =
    Math.abs(
      centerY - window.innerHeight / 2
    ) /
    Math.max(1, window.innerHeight);

  score -=
    (distanceX + distanceY) * 30;

  return score;
}

function normalizeRawRect(
  rawRect,
  padding
) {
  const left = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(
      rawRect.left - padding
    )
  );

  const top = Math.max(
    0,
    Math.floor(
      rawRect.top - padding
    )
  );

  const right = Math.min(
    window.innerWidth,
    Math.ceil(
      rawRect.right + padding
    )
  );

  const bottom = Math.min(
    window.innerHeight,
    Math.ceil(
      rawRect.bottom + padding
    )
  );

  const width = right - left;
  const height = bottom - top;

  if (
    width < MIN_RECT_SIZE ||
    height < MIN_RECT_SIZE
  ) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height
  };
}

function getDialogSurfaceCandidates(root) {
  const candidates = [root];

  /*
   * ChatGPT 的 role=dialog 有時是全畫面
   * wrapper，真正可見的設定／搜尋 panel
   * 位於其內部。向內尋找可見 surface。
   */
  try {
    root
      .querySelectorAll(
        [
          "section",
          "form",
          "article",
          "div"
        ].join(",")
      )
      .forEach((element) => {
        candidates.push(element);
      });
  } catch {
    // Ignore transient DOM rebuilds.
  }

  return candidates;
}

function findBestDialogSurface() {
  const results = [];

  for (
    const root of collectElements(
      DIALOG_ROOT_SELECTORS
    )
  ) {
    if (!isVisible(root)) {
      continue;
    }

    for (
      const element of
        getDialogSurfaceCandidates(root)
    ) {
      if (!isVisible(element)) {
        continue;
      }

      const rect = getRect(element);

      if (
        !isReasonableDialogSurface(
          element,
          rect
        )
      ) {
        continue;
      }

      results.push({
        element,
        rect,
        score: dialogSurfaceScore(
          element,
          rect,
          root
        )
      });
    }
  }

  if (results.length === 0) {
    return null;
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (
      rectArea(b.rect) -
      rectArea(a.rect)
    );
  });

  const best = results[0];

  console.log(
    "[Sidebar Shape v4.4.1] dialog surface:",
    {
      rect: best.rect,
      score: best.score,
      tag: best.element.tagName,
      role:
        best.element.getAttribute(
          "role"
        ),
      testid:
        best.element.getAttribute(
          "data-testid"
        )
    }
  );

  return normalizeRawRect(
    best.rect,
    LARGE_DIALOG_PADDING
  );
}

function rectanglesTouch(
  a,
  b,
  gap = MERGE_GAP
) {
  return !(
    a.x + a.width + gap < b.x ||
    b.x + b.width + gap < a.x ||
    a.y + a.height + gap < b.y ||
    b.y + b.height + gap < a.y
  );
}

function mergeTwoRects(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);

  const right = Math.max(
    a.x + a.width,
    b.x + b.width
  );

  const bottom = Math.max(
    a.y + a.height,
    b.y + b.height
  );

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function mergeRects(inputRects) {
  const rects = [...inputRects];
  let changed = true;

  while (changed) {
    changed = false;

    outer:
    for (
      let i = 0;
      i < rects.length;
      i += 1
    ) {
      for (
        let j = i + 1;
        j < rects.length;
        j += 1
      ) {
        if (
          rectanglesTouch(
            rects[i],
            rects[j]
          )
        ) {
          rects[i] = mergeTwoRects(
            rects[i],
            rects[j]
          );

          rects.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return rects.slice(0, MAX_RECTS);
}

function collectSmallPopupRects(
  dialogRect
) {
  const rects = [];

  for (
    const element of collectElements(
      SMALL_POPUP_SELECTORS
    )
  ) {
    if (!isVisible(element)) {
      continue;
    }

    const rawRect = getRect(element);

    if (
      rawRect.right <=
      SIDEBAR_WIDTH + 1
    ) {
      continue;
    }

    if (
      rawRect.width >=
        window.innerWidth * 0.72 ||
      rawRect.height >=
        window.innerHeight * 0.72 ||
      areaRatio(rawRect) >= 0.36
    ) {
      continue;
    }

    const rect =
      normalizeRawRect(
        rawRect,
        SMALL_POPUP_PADDING
      );

    if (!rect) {
      continue;
    }

    if (
      dialogRect &&
      rect.x >= dialogRect.x - 3 &&
      rect.y >= dialogRect.y - 3 &&
      rect.x + rect.width <=
        dialogRect.x +
        dialogRect.width +
        3 &&
      rect.y + rect.height <=
        dialogRect.y +
        dialogRect.height +
        3
    ) {
      continue;
    }

    rects.push(rect);
  }

  return mergeRects(rects);
}

function reportShapeState() {
  const dialogRect =
    findBestDialogSurface();

  const popupRects =
    collectSmallPopupRects(
      dialogRect
    );

  const payload = {
    dialogRect,
    popupRects
  };

  const signature =
    JSON.stringify(payload);

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;

  ipcRenderer.send(
    "chatgpt-sidebar-shape-state",
    payload
  );
}

function isCloseControl(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const control = target.closest(
    'button, [role="button"]'
  );

  if (!control) {
    return false;
  }

  const text = [
    control.getAttribute(
      "aria-label"
    ),
    control.getAttribute("title"),
    control.getAttribute(
      "data-testid"
    ),
    control.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();

  return (
    text === "x" ||
    text === "×" ||
    text.includes("close") ||
    text.includes("dismiss") ||
    text.includes("關閉") ||
    text.includes("关闭")
  );
}

function notifyCloseIntent() {
  ipcRenderer.send(
    "chatgpt-sidebar-dialog-close-intent"
  );
}

function isExternalAccountRouteUrl(url) {
  try {
    const parsed = new URL(
      url,
      window.location.href
    );

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return false;
    }

    const pathName =
      parsed.pathname.toLowerCase();

    const externalPrefixes = [
      "/upgrade",
      "/pricing",
      "/plans",
      "/plan",
      "/subscription",
      "/subscriptions",
      "/billing",
      "/checkout",
      "/purchase"
    ];

    return externalPrefixes.some(
      (prefix) =>
        pathName === prefix ||
        pathName.startsWith(
          `${prefix}/`
        )
    );
  } catch {
    return false;
  }
}

function isChatGPTRouteUrl(url) {
  try {
    if (isExternalAccountRouteUrl(url)) {
      return false;
    }

    const parsed = new URL(
      url,
      window.location.href
    );

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "chatgpt.com"
    ) {
      return false;
    }

    const blockedPrefixes = [
      "/backend-api/",
      "/api/",
      "/assets/",
      "/cdn-cgi/",
      "/auth/",
      "/login",
      "/logout"
    ];

    return !blockedPrefixes.some(
      (prefix) =>
        parsed.pathname.startsWith(
          prefix
        )
    );
  } catch {
    return false;
  }
}

function getAnchorUrl(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (
    target.closest(
      DIALOG_ANCESTOR_SELECTOR
    )
  ) {
    return null;
  }

  const anchor =
    target.closest("a[href]");

  return anchor ? anchor.href : null;
}

function reportRouteIntent(target) {
  const url = getAnchorUrl(target);

  if (!url || !isChatGPTRouteUrl(url)) {
    return;
  }

  ipcRenderer.send(
    "chatgpt-sidebar-route-intent",
    url
  );
}

function interceptExternalRoute(event) {
  const url =
    getAnchorUrl(event.target);

  if (
    !url ||
    !isExternalAccountRouteUrl(url)
  ) {
    return false;
  }

  /*
   * Upgrade/account pages belong to the official overlay,
   * not to a right-side pane. Switch the shaped overlay to
   * full-window mode and allow ChatGPT's native click.
   */
  notifyFullscreenOverlayIntent(true);

  return false;
}

function getControlElement(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(
    'a[href], button, [role="button"], [role="menuitem"]'
  );
}

function getControlText(target) {
  const control =
    getControlElement(target);

  if (!control) {
    return "";
  }

  return [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.getAttribute("data-testid"),
    control.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isUpgradeControl(target) {
  const text = getControlText(target);

  if (!text) {
    return false;
  }

  const upgradeTokens = [
    "升級方案",
    "升級你的方案",
    "升級計畫",
    "upgrade plan",
    "upgrade your plan",
    "view plans",
    "get plus",
    "get pro"
  ];

  return upgradeTokens.some(
    (token) => text.includes(token)
  );
}

function isOverlayOnlyControl(target) {
  const text = getControlText(target);

  if (!text) {
    return false;
  }

  const overlayOnlyTokens = [
    "設定",
    "settings",
    "搜尋對話",
    "search chats",
    "search conversations"
  ];

  return overlayOnlyTokens.some(
    (token) => text === token ||
      text.includes(token)
  );
}

function notifyOverlayOnlyIntent() {
  ipcRenderer.send(
    "chatgpt-sidebar-overlay-only-intent"
  );
}

function notifyFullscreenOverlayIntent(
  enabled
) {
  ipcRenderer.send(
    "chatgpt-sidebar-fullscreen-overlay-intent",
    Boolean(enabled)
  );
}

function scheduleReport(delay = 0) {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    reportShapeState();
  }, delay);

  pendingTimers.add(timer);
}

function scheduleReportBurst() {
  scheduleReport(0);
  scheduleReport(30);
  scheduleReport(80);
  scheduleReport(160);
  scheduleReport(320);
  scheduleReport(650);
  scheduleReport(1100);
}

function handlePointerDown(event) {
  if (isUpgradeControl(event.target)) {
    notifyFullscreenOverlayIntent(true);
  } else if (
    isOverlayOnlyControl(event.target)
  ) {
    notifyOverlayOnlyIntent();
  } else if (
    !interceptExternalRoute(event)
  ) {
    reportRouteIntent(event.target);
  }

  if (isCloseControl(event.target)) {
    notifyCloseIntent();
    notifyFullscreenOverlayIntent(false);
  }

  scheduleReportBurst();
}

function handleClick(event) {
  if (isUpgradeControl(event.target)) {
    notifyFullscreenOverlayIntent(true);
  } else if (
    isOverlayOnlyControl(event.target)
  ) {
    notifyOverlayOnlyIntent();
  } else {
    interceptExternalRoute(event);
  }

  scheduleReportBurst();
}

function handleKeyDown(event) {
  if (event.key === "Escape") {
    notifyCloseIntent();
    notifyFullscreenOverlayIntent(false);
  }

  scheduleReportBurst();
}

function startDetection() {
  if (
    started ||
    !document.documentElement
  ) {
    return;
  }

  started = true;

  installOverlayIsolationStyle();

  observer = new MutationObserver(() => {
    installOverlayIsolationStyle();
    scheduleReportBurst();
  });

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "open",
        "aria-hidden",
        "aria-expanded",
        "aria-modal",
        "role",
        "data-state"
      ]
    }
  );

  document.addEventListener(
    "pointerdown",
    handlePointerDown,
    true
  );

  document.addEventListener(
    "click",
    handleClick,
    true
  );

  document.addEventListener(
    "keydown",
    handleKeyDown,
    true
  );

  document.addEventListener(
    "transitionend",
    scheduleReportBurst,
    true
  );

  document.addEventListener(
    "animationend",
    scheduleReportBurst,
    true
  );

  document.addEventListener(
    "scroll",
    scheduleReportBurst,
    true
  );

  window.addEventListener(
    "resize",
    scheduleReportBurst
  );

  fallbackTimer = setInterval(
    reportShapeState,
    500
  );

  scheduleReportBurst();
}

if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    startDetection,
    { once: true }
  );
} else {
  startDetection();
}

window.addEventListener(
  "beforeunload",
  () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    for (
      const timer of pendingTimers
    ) {
      clearTimeout(timer);
    }

    pendingTimers.clear();
  }
);
