const { ipcRenderer } = require("electron");

const SIDEBAR_WIDTH = 260;
const MAX_RECTS = 24;

const SMALL_POPUP_PADDING = 4;
const LARGE_DIALOG_PADDING = 10;
const MERGE_GAP = 6;
const MIN_RECT_SIZE = 4;

const POPUP_SELECTORS = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  'dialog[open]',
  '[popover]:popover-open',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-menu-content]',
  '[data-radix-dropdown-menu-content]',
  '[data-radix-dialog-content]',
  '[data-radix-select-content]',
  '[data-radix-popover-content]',
  '[data-state="open"]'
];

let lastSignature = "";
let observer = null;
let fallbackTimer = null;
let started = false;
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

  return rect.width >= MIN_RECT_SIZE && rect.height >= MIN_RECT_SIZE;
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
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);

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
          rects[i] = mergeTwoRects(rects[i], rects[j]);
          rects.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return rects.slice(0, MAX_RECTS);
}

function isBackdropLike(element, rect) {
  const style = window.getComputedStyle(element);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const coversMostViewport =
    rect.width >= viewportWidth * 0.9 &&
    rect.height >= viewportHeight * 0.9;

  const ariaModal = element.getAttribute("aria-modal") === "true";
  const role = (element.getAttribute("role") || "").toLowerCase();

  const classText = [
    element.className ? String(element.className) : "",
    element.getAttribute("data-state") || "",
    element.getAttribute("data-testid") || ""
  ]
    .join(" ")
    .toLowerCase();

  const looksLikeOverlay =
    classText.includes("overlay") ||
    classText.includes("backdrop") ||
    classText.includes("scrim");

  const hasInteractiveDescendant = Boolean(
    element.querySelector(
      'button, input, textarea, select, a[href], [role="menuitem"], [role="option"], [role="textbox"], [contenteditable="true"]'
    )
  );

  if (role === "dialog" || ariaModal) {
    return false;
  }

  if (looksLikeOverlay && coversMostViewport && !hasInteractiveDescendant) {
    return true;
  }

  if (
    coversMostViewport &&
    !hasInteractiveDescendant &&
    (
      style.pointerEvents === "auto" ||
      style.pointerEvents === "all"
    )
  ) {
    return true;
  }

  return false;
}

function isLargeDialogElement(element, rect) {
  const role = (element.getAttribute("role") || "").toLowerCase();
  const ariaModal = element.getAttribute("aria-modal") === "true";

  const classText = [
    element.className ? String(element.className) : "",
    element.getAttribute("data-testid") || ""
  ]
    .join(" ")
    .toLowerCase();

  if (role === "dialog" || ariaModal) {
    return true;
  }

  if (
    classText.includes("dialog") ||
    classText.includes("modal") ||
    classText.includes("sheet")
  ) {
    return true;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (
    rect.width >= viewportWidth * 0.35 ||
    rect.height >= viewportHeight * 0.22
  ) {
    return true;
  }

  return false;
}

function normalizeRect(element) {
  if (!isVisible(element)) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  if (rect.right <= SIDEBAR_WIDTH + 1) {
    return null;
  }

  if (isBackdropLike(element, rect)) {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const isLargeDialog = isLargeDialogElement(element, rect);
  const padding = isLargeDialog
    ? LARGE_DIALOG_PADDING
    : SMALL_POPUP_PADDING;

  const left = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(rect.left - padding)
  );

  const top = Math.max(
    0,
    Math.floor(rect.top - padding)
  );

  const right = Math.min(
    viewportWidth,
    Math.ceil(rect.right + padding)
  );

  const bottom = Math.min(
    viewportHeight,
    Math.ceil(rect.bottom + padding)
  );

  const width = right - left;
  const height = bottom - top;

  if (width < MIN_RECT_SIZE || height < MIN_RECT_SIZE) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height
  };
}

function collectPopupRects() {
  const elements = new Set();

  for (const selector of POPUP_SELECTORS) {
    try {
      document
        .querySelectorAll(selector)
        .forEach((element) => elements.add(element));
    } catch {
      // 個別 selector 不支援時略過
    }
  }

  const rects = [];

  for (const element of elements) {
    const rect = normalizeRect(element);

    if (rect) {
      rects.push(rect);
    }
  }

  return mergeRects(rects);
}

function reportPopupRects() {
  const rects = collectPopupRects();
  const signature = JSON.stringify(rects);

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;

  ipcRenderer.send(
    "chatgpt-sidebar-popup-rects",
    rects
  );
}

function scheduleReport(delay = 0) {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    reportPopupRects();
  }, delay);

  pendingTimers.add(timer);
}

function scheduleReportBurst() {
  scheduleReport(0);
  scheduleReport(40);
  scheduleReport(120);
  scheduleReport(260);
  scheduleReport(500);
}

function startDetection() {
  if (started || !document.documentElement) {
    return;
  }

  started = true;

  observer = new MutationObserver(() => {
    scheduleReportBurst();
  });

  observer.observe(document.documentElement, {
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
      "data-state"
    ]
  });

  document.addEventListener("pointerdown", scheduleReportBurst, true);
  document.addEventListener("click", scheduleReportBurst, true);
  document.addEventListener("keyup", scheduleReportBurst, true);
  document.addEventListener("transitionend", scheduleReportBurst, true);
  document.addEventListener("animationend", scheduleReportBurst, true);
  document.addEventListener("scroll", scheduleReportBurst, true);
  window.addEventListener("resize", scheduleReportBurst);

  fallbackTimer = setInterval(reportPopupRects, 750);

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