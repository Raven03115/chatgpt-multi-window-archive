const { ipcRenderer } = require("electron");

const SIDEBAR_WIDTH = 260;
const MAX_RECTS = 24;

const SMALL_POPUP_PADDING = 4;
const LARGE_DIALOG_PADDING = 10;
const MERGE_GAP = 5;
const MIN_RECT_SIZE = 4;

/*
 * 大型視窗重新渲染時，可能會短暫找不到外層 dialog。
 * 在這段時間保留上一個大型視窗矩形，避免設定內容突然被裁掉。
 */
const DIALOG_RELEASE_GRACE_MS = 1200;

/*
 * 大型視窗的專用 selector。
 * 不再使用過度寬泛的 [data-state="open"]。
 */
const DIALOG_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog[open]',
  '[data-radix-dialog-content]',
  '[data-testid*="dialog"]',
  '[data-testid*="modal"]'
];

/*
 * 小型選單與下拉選單。
 */
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

let lastSignature = "";

let observer = null;
let fallbackTimer = null;
let started = false;

const pendingTimers = new Set();

/*
 * 大型設定／搜尋視窗的穩定狀態。
 */
let lockedDialogElement = null;
let lockedDialogRect = null;
let lastDialogSeenAt = 0;

function isElementVisible(element) {
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

function rectArea(rect) {
  return rect.width * rect.height;
}

function rectContains(outer, inner, tolerance = 2) {
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
      for (
        let j = i + 1;
        j < rects.length;
        j += 1
      ) {
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

function isBackdropLike(element, rect) {
  const style = window.getComputedStyle(element);

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
    element.getAttribute("data-testid") || "",
    element.getAttribute("data-state") || ""
  ]
    .join(" ")
    .toLowerCase();

  const looksLikeOverlay =
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

  /*
   * 真正的 dialog 本體不能被當成背景遮罩排除。
   */
  if (role === "dialog" || ariaModal) {
    return false;
  }

  if (
    coversMostViewport &&
    looksLikeOverlay &&
    !hasInteractiveContent
  ) {
    return true;
  }

  if (
    coversMostViewport &&
    !hasInteractiveContent &&
    (
      style.pointerEvents === "auto" ||
      style.pointerEvents === "all"
    )
  ) {
    return true;
  }

  return false;
}

function normalizeElementRect(
  element,
  padding
) {
  if (!isElementVisible(element)) {
    return null;
  }

  const sourceRect =
    element.getBoundingClientRect();

  if (isBackdropLike(element, sourceRect)) {
    return null;
  }

  if (
    sourceRect.right <=
    SIDEBAR_WIDTH + 1
  ) {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const left = Math.max(
    SIDEBAR_WIDTH,
    Math.floor(sourceRect.left - padding)
  );

  const top = Math.max(
    0,
    Math.floor(sourceRect.top - padding)
  );

  const right = Math.min(
    viewportWidth,
    Math.ceil(sourceRect.right + padding)
  );

  const bottom = Math.min(
    viewportHeight,
    Math.ceil(sourceRect.bottom + padding)
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

function collectElements(selectors) {
  const elements = new Set();

  for (const selector of selectors) {
    try {
      document
        .querySelectorAll(selector)
        .forEach((element) => {
          elements.add(element);
        });
    } catch {
      /*
       * 個別 selector 不支援時略過。
       */
    }
  }

  return [...elements];
}

function findLargestDialogCandidate() {
  const candidates = [];

  const elements =
    collectElements(DIALOG_SELECTORS);

  for (const element of elements) {
    const rect = normalizeElementRect(
      element,
      LARGE_DIALOG_PADDING
    );

    if (!rect) {
      continue;
    }

    /*
     * 避免將很小的內部元件誤判成大型 dialog。
     */
    const sufficientlyLarge =
      rect.width >= 320 ||
      rect.height >= 240;

    if (!sufficientlyLarge) {
      continue;
    }

    candidates.push({
      element,
      rect
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      rectArea(b.rect) - rectArea(a.rect)
  );

  return candidates[0];
}

function updateLockedDialog() {
  const now = Date.now();

  const candidate =
    findLargestDialogCandidate();

  if (candidate) {
    lastDialogSeenAt = now;

    if (!lockedDialogRect) {
      lockedDialogElement = candidate.element;
      lockedDialogRect = candidate.rect;

      return lockedDialogRect;
    }

    const previousArea =
      rectArea(lockedDialogRect);

    const candidateArea =
      rectArea(candidate.rect);

    /*
     * 允許 dialog 變大或正常微調。
     * 不允許在切換設定分頁時突然縮成只剩左側導覽列。
     */
    const notSuspiciouslySmaller =
      candidate.rect.width >=
        lockedDialogRect.width * 0.78 &&
      candidate.rect.height >=
        lockedDialogRect.height * 0.78;

    if (
      candidateArea >= previousArea ||
      notSuspiciouslySmaller
    ) {
      lockedDialogElement =
        candidate.element;

      lockedDialogRect =
        candidate.rect;
    }

    return lockedDialogRect;
  }

  /*
   * 如果原本的 dialog element 仍存在且仍可見，
   * 保持原矩形，不因內容重新渲染而縮小。
   */
  if (
    lockedDialogElement &&
    document.contains(lockedDialogElement) &&
    isElementVisible(lockedDialogElement)
  ) {
    lastDialogSeenAt = now;
    return lockedDialogRect;
  }

  /*
   * 重新渲染期間短暫找不到 dialog 時，
   * 保留上一個矩形一小段時間。
   */
  if (
    lockedDialogRect &&
    now - lastDialogSeenAt <
      DIALOG_RELEASE_GRACE_MS
  ) {
    return lockedDialogRect;
  }

  lockedDialogElement = null;
  lockedDialogRect = null;
  lastDialogSeenAt = 0;

  return null;
}

function collectSmallPopupRects(
  stableDialogRect
) {
  const rects = [];

  const elements =
    collectElements(
      SMALL_POPUP_SELECTORS
    );

  for (const element of elements) {
    const rect = normalizeElementRect(
      element,
      SMALL_POPUP_PADDING
    );

    if (!rect) {
      continue;
    }

    /*
     * 已經完全位於大型 dialog 裡面的選單，
     * 不需要額外建立 shape。
     */
    if (
      stableDialogRect &&
      rectContains(
        stableDialogRect,
        rect
      )
    ) {
      continue;
    }

    rects.push(rect);
  }

  return mergeRects(rects);
}

function collectPopupRects() {
  const stableDialogRect =
    updateLockedDialog();

  const smallPopupRects =
    collectSmallPopupRects(
      stableDialogRect
    );

  const result = [];

  if (stableDialogRect) {
    result.push(stableDialogRect);
  }

  result.push(...smallPopupRects);

  return result.slice(0, MAX_RECTS);
}

function reportPopupRects() {
  const rects =
    collectPopupRects();

  const signature =
    JSON.stringify(rects);

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
  scheduleReport(30);
  scheduleReport(80);
  scheduleReport(160);
  scheduleReport(320);
  scheduleReport(650);
  scheduleReport(1100);
}

function startDetection() {
  if (
    started ||
    !document.documentElement
  ) {
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
    scheduleReportBurst,
    true
  );

  document.addEventListener(
    "click",
    scheduleReportBurst,
    true
  );

  document.addEventListener(
    "keyup",
    scheduleReportBurst,
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
    reportPopupRects,
    500
  );

  scheduleReportBurst();
}

if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    startDetection,
    {
      once: true
    }
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
      clearInterval(
        fallbackTimer
      );

      fallbackTimer = null;
    }

    for (
      const timer of pendingTimers
    ) {
      clearTimeout(timer);
    }

    pendingTimers.clear();

    lockedDialogElement = null;
    lockedDialogRect = null;
    lastDialogSeenAt = 0;
  }
);
