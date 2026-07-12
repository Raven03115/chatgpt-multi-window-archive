"use strict";

const MENU_HASPOPUP_VALUES = new Set([
  "menu",
  "true"
]);

function classifyOverlayControl(facts = {}) {
  const hasPopup = String(
    facts.ariaHaspopup || ""
  ).toLowerCase();
  const isMenuTrigger =
    MENU_HASPOPUP_VALUES.has(hasPopup) ||
    facts.controlsMenu === true ||
    (
      facts.hasAriaControls === true &&
      (
        facts.ariaExpanded === "true" ||
        facts.ariaExpanded === "false"
      )
    );

  if (isMenuTrigger) {
    return "menu-trigger";
  }

  if (facts.overlayControl) {
    return "overlay-control";
  }

  if (facts.externalControl) {
    return "external-control";
  }

  if (facts.closeControl) {
    return "close-control";
  }

  if (facts.backdropControl) {
    return "backdrop";
  }

  if (facts.actionableKind === "anchor") {
    return "anchor";
  }

  if (facts.actionableKind === "menuitem") {
    return "menu-action";
  }

  if (
    ["button", "role-button"].includes(
      facts.actionableKind
    )
  ) {
    return "project-action";
  }

  return "other";
}

function decideOverlayControl(controlKind) {
  if (controlKind === "anchor") {
    return {
      route: true,
      projectIntent: false
    };
  }

  if (controlKind === "project-action") {
    return {
      route: false,
      projectIntent: true
    };
  }

  return {
    route: false,
    projectIntent: false
  };
}

function classifyDialogSurface(facts = {}) {
  const role = String(facts.role || "").toLowerCase();
  const width = Number(facts.width) || 0;
  const height = Number(facts.height) || 0;
  const isAlertDialog =
    role === "alertdialog" ||
    facts.radixAlertDialogContent === true;
  const isStandardDialog =
    role === "dialog" ||
    facts.ariaModal === true ||
    facts.nativeDialogOpen === true ||
    facts.radixDialogContent === true;
  const hasDialogSemantic =
    isAlertDialog || isStandardDialog;
  const hasExplicitRootSemantic =
    hasDialogSemantic &&
    facts.isRootSurface !== false;

  if (
    facts.connected !== true ||
    facts.visible !== true ||
    facts.opaque !== true ||
    facts.rightOfSidebar !== true ||
    Number(facts.interactiveControlCount) < 1
  ) {
    return "non-dialog";
  }

  if (facts.nearlyFullscreen === true) {
    return hasDialogSemantic
      ? "invalid-wrapper"
      : "backdrop";
  }

  const meetsCompactSize =
    width >= 240 && height >= 100;
  const meetsStandardSize =
    width >= 340 && height >= 190;

  if (
    meetsCompactSize &&
    hasExplicitRootSemantic &&
    !meetsStandardSize
  ) {
    return "compact-confirmation";
  }

  if (hasDialogSemantic && meetsStandardSize) {
    return "standard-dialog";
  }

  return "non-dialog";
}

function selectDialogSurface(candidates = []) {
  const priorities = {
    "compact-confirmation": 3,
    "standard-dialog": 2,
    "large-panel": 2
  };

  return candidates
    .filter((candidate) =>
      Boolean(priorities[candidate?.kind])
    )
    .sort((a, b) => {
      const priorityDifference =
        priorities[b.kind] - priorities[a.kind];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return (
        Number(b.score || 0) -
        Number(a.score || 0)
      );
    })[0] || null;
}

function cloneRect(value) {
  if (!value) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height
  };
}

function replacePopupRects(_current, next) {
  return Array.isArray(next)
    ? next.map(cloneRect).filter(Boolean)
    : [];
}

function replaceDialogRect(_current, next) {
  return cloneRect(next);
}

function replaceDialogSurfaceState(current = {}, next) {
  if (!next) {
    return {
      dialogRect: null,
      dialogKind: null,
      popupRects: []
    };
  }

  return {
    dialogRect: cloneRect(next.rect),
    dialogKind: next.kind || null,
    popupRects:
      next.kind === "compact-confirmation"
        ? []
        : replacePopupRects([], current.popupRects)
  };
}

function buildOverlayShape(options = {}) {
  const {
    mode = "sidebar-only",
    bounds = { width: 0, height: 0 },
    sidebarWidth = 0,
    dialogRect = null,
    popupRects = []
  } = options;

  if (mode === "fullscreen") {
    return [{
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    }];
  }

  const result = [{
    x: 0,
    y: 0,
    width: Math.min(sidebarWidth, bounds.width),
    height: bounds.height
  }];

  if (dialogRect) {
    result.push(cloneRect(dialogRect));
  }

  result.push(...replacePopupRects([], popupRects));

  return result;
}

function normalizeOverlayState(state = {}) {
  const mode = state.mode || "sidebar-only";

  return {
    mode,
    generation: Number.isInteger(state.generation)
      ? state.generation
      : 0,
    suppressPanes:
      mode === "shaped-dialog" || mode === "fullscreen",
    mainWorkspaceVisible: mode === "fullscreen"
  };
}

function transitionOverlayState(state, event = {}) {
  const current = normalizeOverlayState(state);
  let mode = current.mode;
  let generation = current.generation;

  switch (event.type) {
    case "overlay-intent":
      mode = "overlay-intent-pending";
      generation += 1;
      break;
    case "dialog-detected":
      mode = "shaped-dialog";
      break;
    case "popup-detected":
      if (mode === "sidebar-only") {
        mode = "shaped-popup";
      }
      break;
    case "popup-removed":
      if (mode === "shaped-popup") {
        mode = "sidebar-only";
      }
      break;
    case "dialog-missing":
    case "pending-cancelled":
      if (mode === "overlay-intent-pending") {
        mode = "sidebar-only";
      }
      break;
    case "fullscreen":
      if (event.explicitExternal === true) {
        mode = "fullscreen";
      }
      break;
    case "close":
      mode = "sidebar-only";
      break;
    case "dialog-resized":
      break;
    default:
      break;
  }

  return normalizeOverlayState({ mode, generation });
}

module.exports = {
  buildOverlayShape,
  classifyDialogSurface,
  classifyOverlayControl,
  decideOverlayControl,
  replaceDialogRect,
  replaceDialogSurfaceState,
  replacePopupRects,
  selectDialogSurface,
  transitionOverlayState
};
