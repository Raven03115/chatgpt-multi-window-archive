const { ipcRenderer } = require("electron");

const SIDEBAR_WIDTH = 260;
const MAX_RECTS = 24;

const SMALL_POPUP_PADDING = 3;
const LARGE_DIALOG_PADDING = 1;
const MIN_RECT_SIZE = 4;
const MIN_COMPACT_DIALOG_WIDTH = 240;
const MIN_COMPACT_DIALOG_HEIGHT = 100;
const MIN_STANDARD_DIALOG_WIDTH = 340;
const MIN_STANDARD_DIALOG_HEIGHT = 190;
const MERGE_GAP = 3;
const SETTINGS_OUTSIDE_CLICK_MAX_DISTANCE = 8;

const DIALOG_ROOT_SELECTORS = [
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog[open]',
  '[data-radix-alert-dialog-content]',
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

const SHAPE_RELEVANT_SELECTOR = [
  ...DIALOG_ROOT_SELECTORS,
  ...SMALL_POPUP_SELECTORS
].join(",");


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

  /*
   * Hide only the conversation workspace root.
   *
   * Settings, search, menus and selects are portal layers outside the
   * main workspace. Their official visibility state must remain intact.
   */
  main,
  [role="main"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  html.chatgpt-multi-fullscreen-overlay,
  html.chatgpt-multi-fullscreen-overlay body,
  html.chatgpt-multi-fullscreen-overlay #root,
  html.chatgpt-multi-fullscreen-overlay #__next,
  html.chatgpt-multi-fullscreen-overlay body > div {
    background-color: #000000 !important;
  }

  html.chatgpt-multi-fullscreen-overlay main,
  html.chatgpt-multi-fullscreen-overlay [role="main"] {
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
let dialogResizeObserver = null;
let popupResizeObserver = null;
let observedDialogSurface = null;
let observedPopupSurfaces = new Set();
let reportAnimationFrame = null;
let interactionReportTimers = new Set();
let started = false;
let lastSignature = "";
let lastDialogRectSignature = "";
let lastPopupRectsSignature = "[]";
let activeOverlayOnlyKind = null;
let overlayDialogObserved = false;
let currentDialogRect = null;
let currentPopupRects = [];
let settingsOutsidePointerGesture = null;
let pointerGestureId = 0;
let pointerGestureSnapshot = null;

function reportDiagnostic(event) {
  ipcRenderer.send(
    "chatgpt-sidebar-diagnostic-event",
    event
  );
}

function isVisible(element) {
  if (
    !(element instanceof Element) ||
    !element.isConnected
  ) {
    return false;
  }

  const rect =
    element.getBoundingClientRect();

  for (
    let current = element;
    current;
    current = current.parentElement
  ) {
    const style =
      window.getComputedStyle(current);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
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

function getDialogSurfaceKind(
  element,
  rect,
  root
) {
  if (!isVisible(element)) {
    return "non-dialog";
  }

  if (
    rect.right <=
    SIDEBAR_WIDTH + 1
  ) {
    return "non-dialog";
  }

  if (isNearlyFullscreen(rect)) {
    return "invalid-wrapper";
  }

  if (!hasInteractiveContent(element)) {
    return "non-dialog";
  }

  const role = String(
    element.getAttribute("role") || ""
  ).toLowerCase();
  const hasExplicitRootSemantic =
    element === root &&
    (
      role === "dialog" ||
      role === "alertdialog" ||
      element.getAttribute("aria-modal") === "true" ||
      element.matches("dialog[open]") ||
      element.matches("[data-radix-dialog-content]") ||
      element.matches(
        "[data-radix-alert-dialog-content]"
      )
    );
  const meetsCompactSize =
    rect.width >= MIN_COMPACT_DIALOG_WIDTH &&
    rect.height >= MIN_COMPACT_DIALOG_HEIGHT;
  const meetsStandardSize =
    rect.width >= MIN_STANDARD_DIALOG_WIDTH &&
    rect.height >= MIN_STANDARD_DIALOG_HEIGHT;

  if (
    meetsCompactSize &&
    hasOpaqueBackground(element) &&
    hasExplicitRootSemantic &&
    !meetsStandardSize
  ) {
    return "compact-confirmation";
  }

  if (!meetsStandardSize) {
    return "non-dialog";
  }

  return "standard-dialog";
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

  if (role === "alertdialog") {
    score += 130;
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
    element.matches(
      "[data-radix-alert-dialog-content]"
    )
  ) {
    score += 140;
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
      const kind = getDialogSurfaceKind(
        element,
        rect,
        root
      );

      if (
        kind !== "standard-dialog" &&
        kind !== "compact-confirmation"
      ) {
        continue;
      }

      results.push({
        element,
        rect,
        kind,
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
    const kindPriority = {
      "compact-confirmation": 2,
      "standard-dialog": 1
    };
    const priorityDifference =
      kindPriority[b.kind] -
      kindPriority[a.kind];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (
      rectArea(b.rect) -
      rectArea(a.rect)
    );
  });

  const best = results[0];

  return {
    element: best.element,
    kind: best.kind,
    rect: normalizeRawRect(
      best.rect,
      LARGE_DIALOG_PADDING
    )
  };
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

function collectSmallPopupSurfaces(
  dialogRect
) {
  const rects = [];
  const elements = [];

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
    elements.push(element);
  }

  return {
    elements,
    rects: mergeRects(rects)
  };
}

function scheduleFrameReport() {
  if (reportAnimationFrame !== null) {
    return;
  }

  reportAnimationFrame = requestAnimationFrame(() => {
    reportAnimationFrame = null;
    reportShapeState();
  });
}

function syncDialogResizeObserver(element) {
  if (observedDialogSurface === element) {
    return;
  }

  if (dialogResizeObserver) {
    dialogResizeObserver.disconnect();
  }

  if (observedDialogSurface) {
    reportDiagnostic({
      event: "dialog-observer-detached",
      action: "detach",
      reason: element
        ? "dialog-surface-replaced"
        : "dialog-surface-removed"
    });
  }

  const replaced = Boolean(
    observedDialogSurface && element
  );
  observedDialogSurface = element || null;

  if (replaced) {
    reportDiagnostic({
      event: "dialog-surface-replaced",
      action: "replace",
      reason: "current-dialog-node-changed"
    });
  }

  if (observedDialogSurface && dialogResizeObserver) {
    dialogResizeObserver.observe(
      observedDialogSurface
    );
    reportDiagnostic({
      event: "dialog-observer-attached",
      action: "attach",
      reason: "active-dialog-surface"
    });
  }
}

function syncPopupResizeObservers(elements) {
  const next = new Set(elements);
  let changed = next.size !== observedPopupSurfaces.size;

  if (!changed) {
    changed = [...next].some(
      (element) => !observedPopupSurfaces.has(element)
    );
  }

  if (!changed) {
    return;
  }

  if (popupResizeObserver) {
    popupResizeObserver.disconnect();
    for (const element of next) {
      popupResizeObserver.observe(element);
    }
  }

  observedPopupSurfaces = next;
}

function reportShapeState() {
  const dialogSurface =
    findBestDialogSurface();
  const dialogRect =
    dialogSurface?.rect || null;
  const dialogKind =
    dialogSurface?.kind || null;
  const popupSurfaces =
    collectSmallPopupSurfaces(
      dialogRect
    );
  const popupRects = popupSurfaces.rects;

  currentDialogRect = dialogRect;
  currentPopupRects = popupRects;

  if (activeOverlayOnlyKind && dialogRect) {
    overlayDialogObserved = true;
  } else if (
    activeOverlayOnlyKind &&
    overlayDialogObserved &&
    !dialogRect
  ) {
    activeOverlayOnlyKind = null;
    overlayDialogObserved = false;
    settingsOutsidePointerGesture = null;
  }

  syncDialogResizeObserver(
    dialogSurface?.element || null
  );
  syncPopupResizeObservers(
    popupSurfaces.elements
  );

  const dialogSignature =
    JSON.stringify(dialogRect);
  const popupSignature =
    JSON.stringify(popupRects);

  if (dialogSignature !== lastDialogRectSignature) {
    reportDiagnostic({
      event: dialogRect
        ? "dialog-rect-changed"
        : "overlay-dialog-missing",
      action: dialogRect ? "update" : "remove",
      reason: dialogRect
        ? "dialog-surface-bounds-changed"
        : "no-valid-dialog-surface",
      rectWidth: dialogRect?.width,
      rectHeight: dialogRect?.height
    });
    lastDialogRectSignature = dialogSignature;
  }

  if (popupSignature !== lastPopupRectsSignature) {
    const previousHadPopup =
      lastPopupRectsSignature !== "[]";
    reportDiagnostic({
      event: popupRects.length > 0
        ? previousHadPopup
          ? "popup-rect-changed"
          : "popup-detected"
        : "popup-rect-removed",
      action: popupRects.length > 0
        ? "update"
        : "remove",
      reason: "popup-surface-set-changed",
      rectCount: popupRects.length
    });
    lastPopupRectsSignature = popupSignature;
  }

  const payload = {
    dialogRect,
    dialogKind,
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

  const metadata = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();

  const exactText = String(
    control.textContent || ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    exactText === "x" ||
    exactText === "×" ||
    metadata.includes("close") ||
    metadata.includes("dismiss") ||
    metadata.includes("關閉") ||
    metadata.includes("关闭")
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

function isConversationRouteUrl(url) {
  try {
    const parsed = new URL(
      url,
      window.location.href
    );

    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com" &&
      /(?:^|\/)c\/[^/]+/.test(parsed.pathname)
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

  const control = getControlElement(target);

  if (control && isMenuTriggerControl(control)) {
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

  const insideDialog = Boolean(
    target instanceof Element &&
    target.closest(
      DIALOG_ANCESTOR_SELECTOR
    )
  );

  /*
   * Links inside Settings/Search dialogs normally stay
   * inside the overlay. The exception is a Search result
   * that points to an actual /c/... conversation.
   */
  if (
    insideDialog &&
    !isConversationRouteUrl(url)
  ) {
    return;
  }

  ipcRenderer.send(
    "chatgpt-sidebar-route-intent",
    url
  );
}

function isLargeBackdropLikeControl(control) {
  try {
    const rect = control.getBoundingClientRect();

    return (
      rect.width >= window.innerWidth * 0.5 &&
      rect.height >= window.innerHeight * 0.5
    );
  } catch {
    return true;
  }
}

function getControlKind(control) {
  if (control.matches("a[href]")) {
    return "anchor";
  }

  if (control.tagName.toLowerCase() === "button") {
    return "button";
  }

  const role = String(
    control.getAttribute("role") || ""
  ).toLowerCase();

  if (role === "button") {
    return "role-button";
  }

  if (role === "menuitem") {
    return "menuitem";
  }

  return "other";
}

function isNativeMenuAction(target) {
  const control = getControlElement(target);

  return Boolean(
    control &&
    control.matches('[role="menuitem"]') &&
    !isUpgradeControl(control)
  );
}

function isMenuTriggerControl(control) {
  if (!(control instanceof Element)) {
    return false;
  }

  const hasPopup = String(
    control.getAttribute("aria-haspopup") || ""
  ).toLowerCase();
  const controlsId =
    control.getAttribute("aria-controls");
  const expanded =
    control.getAttribute("aria-expanded");
  let controlsMenu = false;

  if (controlsId) {
    try {
      const controlled = document.getElementById(
        controlsId
      );
      controlsMenu = Boolean(
        controlled &&
        controlled.matches(
          '[role="menu"], [data-radix-menu-content], [data-radix-dropdown-menu-content]'
        )
      );
    } catch {
      controlsMenu = false;
    }
  }

  return (
    hasPopup === "menu" ||
    hasPopup === "true" ||
    controlsMenu ||
    Boolean(controlsId && expanded !== null)
  );
}

function reportMenuTrigger(target) {
  const control = getControlElement(target);

  if (!control || !isMenuTriggerControl(control)) {
    return false;
  }

  reportDiagnostic({
    event: "menu-trigger-detected",
    controlKind: "menu-trigger",
    action: "preserve-native-menu",
    reason: "semantic-menu-trigger"
  });
  reportDiagnostic({
    event: "menu-route-suppressed",
    controlKind: "menu-trigger",
    action: "ignore-route-intent",
    reason: "menu-trigger-precedes-parent-anchor"
  });

  return true;
}

function reportProjectActionCandidate(target) {
  const control = getControlElement(target);

  if (!control) {
    return false;
  }

  if (isMenuTriggerControl(control)) {
    return false;
  }

  if (control.matches('[role="menuitem"]')) {
    return false;
  }

  const hasAnchor =
    control.matches("a[href]") ||
    Boolean(control.closest("a[href]"));

  if (hasAnchor) {
    return false;
  }

  const insideDialog = Boolean(
    control.closest(DIALOG_ANCESTOR_SELECTOR)
  );

  ipcRenderer.send(
    "chatgpt-sidebar-project-action-candidate",
    {
      phase: "pointerdown",
      controlKind: getControlKind(control),
      hasAnchor,
      insideDialog,
      overlayState: insideDialog
        ? "dialog"
        : "closed",
      overlayControl:
        isOverlayOnlyControl(control),
      closeControl: isCloseControl(control),
      externalControl: isUpgradeControl(control),
      backdropControl:
        isLargeBackdropLikeControl(control)
    }
  );

  return true;
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

function getOverlayOnlyControlKind(target) {
  const control = getControlElement(target);

  if (!control) {
    return null;
  }

  const normalize = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const settingsLabels = new Set([
    "設定",
    "settings"
  ]);
  const searchLabels = new Set([
    "搜尋對話",
    "搜尋聊天",
    "search chats",
    "search conversations"
  ]);

  const semanticLabels = [
    control.getAttribute("aria-label"),
    control.getAttribute("title")
  ]
    .map(normalize)
    .filter(Boolean);

  const exactText = normalize(control.textContent);
  const testId = normalize(
    control.getAttribute("data-testid")
  );

  if (semanticLabels.some((label) => settingsLabels.has(label)) ||
      settingsLabels.has(exactText) ||
      /(?:^|[-_])(settings?|preferences?)(?:$|[-_])/.test(testId)) {
    return "settings";
  }

  if (semanticLabels.some((label) => searchLabels.has(label)) ||
      searchLabels.has(exactText) ||
      /(?:^|[-_])search(?:[-_](?:chats?|conversations?))?(?:$|[-_])/.test(testId)) {
    return "search";
  }

  return null;
}

function isOverlayOnlyControl(target) {
  return Boolean(getOverlayOnlyControlKind(target));
}

function notifyOverlayOnlyIntent(kind) {
  if (kind !== "settings" && kind !== "search") {
    return;
  }

  if (activeOverlayOnlyKind !== kind) {
    overlayDialogObserved = false;
    settingsOutsidePointerGesture = null;
  }

  activeOverlayOnlyKind = kind;
  ipcRenderer.send(
    "chatgpt-sidebar-overlay-only-intent",
    { kind }
  );
}

function pointIsInsideRect(x, y, rect) {
  return Boolean(
    rect &&
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

function pointIsInsideOverlaySurface(x, y) {
  return (
    pointIsInsideRect(x, y, currentDialogRect) ||
    currentPopupRects.some((rect) =>
      pointIsInsideRect(x, y, rect)
    )
  );
}

function isPrimaryTrustedPointer(event) {
  return (
    event.isTrusted === true &&
    event.button === 0 &&
    event.isPrimary !== false &&
    Number.isInteger(event.pointerId)
  );
}

function stopSettingsOutsideGesture(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleSettingsOutsidePointerDown(event) {
  if (
    activeOverlayOnlyKind !== "settings" ||
    !isPrimaryTrustedPointer(event) ||
    event.clientX <= SIDEBAR_WIDTH ||
    pointIsInsideOverlaySurface(event.clientX, event.clientY)
  ) {
    return;
  }

  settingsOutsidePointerGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    readyForClick: false
  };
  stopSettingsOutsideGesture(event);
}

function handleSettingsOutsidePointerUp(event) {
  const gesture = settingsOutsidePointerGesture;

  if (!gesture) {
    return;
  }

  const distance = Math.hypot(
    event.clientX - gesture.startX,
    event.clientY - gesture.startY
  );
  const valid =
    isPrimaryTrustedPointer(event) &&
    event.pointerId === gesture.pointerId &&
    distance <= SETTINGS_OUTSIDE_CLICK_MAX_DISTANCE &&
    event.clientX > SIDEBAR_WIDTH &&
    !pointIsInsideOverlaySurface(event.clientX, event.clientY);

  if (!valid) {
    settingsOutsidePointerGesture = null;
    return;
  }

  gesture.readyForClick = true;
  stopSettingsOutsideGesture(event);
}

function handleSettingsOutsideClick(event) {
  const gesture = settingsOutsidePointerGesture;

  if (
    !gesture ||
    !gesture.readyForClick ||
    activeOverlayOnlyKind !== "settings" ||
    event.isTrusted !== true ||
    event.button !== 0
  ) {
    return;
  }

  const distance = Math.hypot(
    event.clientX - gesture.startX,
    event.clientY - gesture.startY
  );

  if (
    distance > SETTINGS_OUTSIDE_CLICK_MAX_DISTANCE ||
    event.clientX <= SIDEBAR_WIDTH ||
    pointIsInsideOverlaySurface(event.clientX, event.clientY)
  ) {
    settingsOutsidePointerGesture = null;
    return;
  }

  settingsOutsidePointerGesture = null;
  stopSettingsOutsideGesture(event);
  ipcRenderer.send(
    "chatgpt-sidebar-settings-outside-click"
  );
}

function notifyFullscreenOverlayIntent(
  enabled
) {
  if (enabled) {
    activeOverlayOnlyKind = null;
    overlayDialogObserved = false;
    settingsOutsidePointerGesture = null;
  }

  ipcRenderer.send(
    "chatgpt-sidebar-fullscreen-overlay-intent",
    Boolean(enabled)
  );
}

function matchesOrIsInsideShapeUi(value) {
  if (!(value instanceof Element)) {
    return false;
  }

  try {
    return (
      value.matches(SHAPE_RELEVANT_SELECTOR) ||
      Boolean(value.closest(SHAPE_RELEVANT_SELECTOR))
    );
  } catch {
    return false;
  }
}

function mayContainShapeUi(value) {
  if (!(value instanceof Element)) {
    return false;
  }

  try {
    return (
      matchesOrIsInsideShapeUi(value) ||
      Boolean(value.querySelector(SHAPE_RELEVANT_SELECTOR))
    );
  } catch {
    return false;
  }
}

function mutationMayAffectShape(record) {
  if (record.type === "characterData") {
    return matchesOrIsInsideShapeUi(
      record.target.parentElement
    );
  }

  if (record.type === "attributes") {
    return mayContainShapeUi(record.target);
  }

  if (
    matchesOrIsInsideShapeUi(record.target)
  ) {
    return true;
  }

  return [
    ...record.addedNodes,
    ...record.removedNodes
  ].some(mayContainShapeUi);
}

function clearReportBurstTimers() {
  for (const timer of interactionReportTimers) {
    clearTimeout(timer);
  }
  interactionReportTimers.clear();
}

function scheduleReportBurst() {
  clearReportBurstTimers();
  scheduleFrameReport();

  for (const delay of [125, 375, 750]) {
    const timer = setTimeout(() => {
      interactionReportTimers.delete(timer);
      scheduleFrameReport();
    }, delay);
    interactionReportTimers.add(timer);
  }
}

function createPointerGestureSnapshot(event) {
  const control = getControlElement(event.target);
  const closeControl = isCloseControl(event.target);
  const upgradeControl =
    !closeControl && isUpgradeControl(event.target);

  pointerGestureId += 1;

  return {
    gestureId: pointerGestureId,
    pointerId: Number.isInteger(event.pointerId)
      ? event.pointerId
      : null,
    control,
    hasControl: Boolean(control),
    closeControl,
    upgradeControl,
    overlaySurface:
      matchesOrIsInsideShapeUi(event.target),
    nativeMenu: isNativeMenuAction(event.target),
    menuTrigger: Boolean(
      control && isMenuTriggerControl(control)
    ),
    overlayOnlyKind:
      closeControl || upgradeControl
        ? null
        : getOverlayOnlyControlKind(event.target),
    pointerUpCompleted: false
  };
}

function handlePointerUp(event) {
  const snapshot = pointerGestureSnapshot;

  if (!snapshot) {
    return;
  }

  if (
    snapshot.pointerId === null ||
    event.pointerId !== snapshot.pointerId ||
    event.button !== 0
  ) {
    pointerGestureSnapshot = null;
    return;
  }

  snapshot.pointerUpCompleted = true;
}

function handlePointerCancel(event) {
  if (
    pointerGestureSnapshot &&
    event.pointerId === pointerGestureSnapshot.pointerId
  ) {
    pointerGestureSnapshot = null;
  }
}

function handlePointerDown(event) {
  const snapshot = createPointerGestureSnapshot(event);
  pointerGestureSnapshot = snapshot;

  if (snapshot.closeControl) {
    scheduleFrameReport();
    return;
  }

  if (snapshot.menuTrigger && reportMenuTrigger(event.target)) {
    // Preserve the official menu handler without routing the row anchor.
  } else if (snapshot.upgradeControl) {
    notifyFullscreenOverlayIntent(true);
  } else if (snapshot.overlayOnlyKind) {
    notifyOverlayOnlyIntent(snapshot.overlayOnlyKind);
  } else if (snapshot.nativeMenu) {
    // Preserve native popup actions without creating Project intent.
  } else if (
    reportProjectActionCandidate(event.target)
  ) {
    // Native ChatGPT routing will provide the final Project URL.
  } else if (
    !interceptExternalRoute(event)
  ) {
    reportRouteIntent(event.target);
  }

  scheduleFrameReport();
}

function handleClick(event) {
  const snapshot = pointerGestureSnapshot;
  const completedPointerGesture = Boolean(
    snapshot && snapshot.pointerUpCompleted
  );

  pointerGestureSnapshot = null;

  if (completedPointerGesture) {
    if (snapshot.closeControl) {
      const originalControlStillOwnsClick = Boolean(
        snapshot.control &&
        snapshot.control.isConnected &&
        (
          event.target === snapshot.control ||
          snapshot.control.contains(event.target)
        )
      );

      notifyCloseIntent();

      if (!originalControlStillOwnsClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    if (snapshot.hasControl) {
      scheduleReportBurst();
    } else {
      scheduleFrameReport();
    }

    return;
  }

  const control = getControlElement(event.target);
  const overlayOnlyKind =
    getOverlayOnlyControlKind(event.target);

  if (control && isMenuTriggerControl(control)) {
    // The official click handler owns menu visibility.
  } else if (isUpgradeControl(event.target)) {
    notifyFullscreenOverlayIntent(true);
  } else if (overlayOnlyKind) {
    notifyOverlayOnlyIntent(overlayOnlyKind);
  } else if (isNativeMenuAction(event.target)) {
    // The official popup action owns its native click behavior.
  } else if (
    !interceptExternalRoute(event)
  ) {
    reportRouteIntent(event.target);
  }

  if (control) {
    scheduleReportBurst();
  } else {
    scheduleFrameReport();
  }
}

function handleKeyDown(event) {
  pointerGestureSnapshot = null;

  if (event.key === "Escape") {
    notifyCloseIntent();
    notifyFullscreenOverlayIntent(false);
  }

  if (event.key === "Escape") {
    scheduleReportBurst();
  }
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

  dialogResizeObserver = new ResizeObserver(
    scheduleFrameReport
  );
  popupResizeObserver = new ResizeObserver(
    scheduleFrameReport
  );

  observer = new MutationObserver((records) => {
    installOverlayIsolationStyle();
    const checkedAttributeTargets = new Set();

    if (records.some((record) => {
      if (record.type === "attributes") {
        if (checkedAttributeTargets.has(record.target)) {
          return false;
        }
        checkedAttributeTargets.add(record.target);
      }

      return mutationMayAffectShape(record);
    })) {
      scheduleFrameReport();
    }
  });

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: [
        "class",
        "hidden",
        "open",
        "aria-hidden",
        "aria-expanded",
        "aria-modal",
        "role",
        "data-state",
        "style"
      ]
    }
  );

  document.addEventListener(
    "pointerdown",
    handleSettingsOutsidePointerDown,
    true
  );

  document.addEventListener(
    "pointerup",
    handleSettingsOutsidePointerUp,
    true
  );

  document.addEventListener(
    "pointerup",
    handlePointerUp,
    true
  );

  document.addEventListener(
    "pointercancel",
    handlePointerCancel,
    true
  );

  document.addEventListener(
    "click",
    handleSettingsOutsideClick,
    true
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
    scheduleFrameReport,
    true
  );

  document.addEventListener(
    "animationend",
    scheduleFrameReport,
    true
  );

  document.addEventListener(
    "scroll",
    scheduleFrameReport,
    true
  );

  window.addEventListener(
    "resize",
    scheduleFrameReport
  );

  scheduleFrameReport();
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

    if (dialogResizeObserver) {
      dialogResizeObserver.disconnect();
      dialogResizeObserver = null;
    }

    if (popupResizeObserver) {
      popupResizeObserver.disconnect();
      popupResizeObserver = null;
    }

    if (reportAnimationFrame !== null) {
      cancelAnimationFrame(reportAnimationFrame);
      reportAnimationFrame = null;
    }

    clearReportBurstTimers();

    pointerGestureSnapshot = null;
    observedDialogSurface = null;
    observedPopupSurfaces.clear();
  }
);
