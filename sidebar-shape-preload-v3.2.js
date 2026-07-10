const { ipcRenderer } = require("electron");

const SIDEBAR_WIDTH = 260;
const MAX_RECTS = 24;

const SMALL_POPUP_PADDING = 4;
const LARGE_DIALOG_PADDING = 10;
const MIN_RECT_SIZE = 4;
const MERGE_GAP = 5;

const DIALOG_SELECTORS = [
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

let observer = null;
let fallbackTimer = null;
let started = false;
let lastSignature = "";

const pendingTimers = new Set();

function isVisible(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

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
  const elements = new Set();

  for (const selector of selectors) {
    try {
      document
        .querySelectorAll(selector)
        .forEach((element) => elements.add(element));
    } catch {
      // 個別 selector 不支援時略過。
    }
  }

  return [...elements];
}

function isBackdropLike(element, rect) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const coversMostViewport =
    rect.width >= viewportWidth * 0.9 &&
    rect.height >= viewportHeight * 0.9;

  const role = (
    element.getAttribute("role") || ""
  ).toLowerCase();

  const ariaModal =
    element.getAttribute("aria-modal") === "true";

  const metadata = [
    element.className
      ? String(element.className)
      : "",
    element.getAttribute("data-testid") || ""
  ]
    .join(" ")
    .toLowerCase();

  const looksLikeBackdrop =
    metadata.includes("overlay") ||
    metadata.includes("backdrop") ||
    metadata.includes("scrim");

  const hasInteractiveContent = Boolean(
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

  if (role === "dialog" || ariaModal) {
    return false;
  }

  return (
    coversMostViewport &&
    looksLikeBackdrop &&
    !hasInteractiveContent
  );
}

function normalizeRect(element, padding) {
  if (!isVisible(element)) {
    return null;
  }

  const source = element.getBoundingClientRect();

  if (isBackdropLike(element, source)) {
    return null;
  }

  if (source.right <= SIDEBAR_WIDTH + 1) {
    return null;
  }

  const left = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(source.left - padding)
  );

  const top = Math.max(
    0,
    Math.floor(source.top - padding)
  );

  const right = Math.min(
    window.innerWidth,
    Math.ceil(source.right + padding)
  );

  const bottom = Math.min(
    window.innerHeight,
    Math.ceil(source.bottom + padding)
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

function rectArea(rect) {
  return rect.width * rect.height;
}

function rectContains(outer, inner, tolerance = 3) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <=
      outer.x + outer.width + tolerance &&
    inner.y + inner.height <=
      outer.y + outer.height + tolerance
  );
}

function rectanglesTouch(a, b, gap = MERGE_GAP) {
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
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        if (rectanglesTouch(rects[i], rects[j])) {
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

function findLargestDialogRect() {
  const candidates = [];

  for (const element of collectElements(DIALOG_SELECTORS)) {
    const rect = normalizeRect(
      element,
      LARGE_DIALOG_PADDING
    );

    if (!rect) {
      continue;
    }

    const largeEnough =
      rect.width >= 360 &&
      rect.height >= 220;

    if (!largeEnough) {
      continue;
    }

    candidates.push(rect);
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (a, b) => rectArea(b) - rectArea(a)
  );

  return candidates[0];
}

function collectSmallPopupRects(dialogRect) {
  const rects = [];

  for (
    const element of collectElements(
      SMALL_POPUP_SELECTORS
    )
  ) {
    const rect = normalizeRect(
      element,
      SMALL_POPUP_PADDING
    );

    if (!rect) {
      continue;
    }

    if (
      dialogRect &&
      rectContains(dialogRect, rect)
    ) {
      continue;
    }

    rects.push(rect);
  }

  return mergeRects(rects);
}

function reportShapeState() {
  const dialogRect = findLargestDialogRect();

  const popupRects =
    collectSmallPopupRects(dialogRect);

  const payload = {
    dialogRect,
    popupRects
  };

  const signature = JSON.stringify(payload);

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
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.getAttribute("data-testid"),
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
  if (isCloseControl(event.target)) {
    notifyCloseIntent();
  }

  scheduleReportBurst();
}

function handleKeyDown(event) {
  if (event.key === "Escape") {
    notifyCloseIntent();
  }

  scheduleReportBurst();
}

function startDetection() {
  if (started || !document.documentElement) {
    return;
  }

  started = true;

  observer = new MutationObserver(() => {
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
    scheduleReportBurst,
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

window.addEventListener("beforeunload", () => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }

  pendingTimers.clear();
});
