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

  if (
    ["button", "role-button", "menuitem"].includes(
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
  classifyOverlayControl,
  decideOverlayControl,
  replaceDialogRect,
  replacePopupRects,
  transitionOverlayState
};
