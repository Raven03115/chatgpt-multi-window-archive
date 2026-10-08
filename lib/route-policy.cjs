"use strict";

const ROUTE_KINDS = new Set([
  "conversation",
  "project-conversation",
  "project-workspace",
  "overlay-only",
  "settings-page",
  "external-account",
  "blocked",
  "unknown-workspace",
  "invalid"
]);

const FORWARDABLE_WORKSPACE_ROUTE_KINDS = new Set([
  "conversation",
  "project-conversation",
  "project-workspace",
  "unknown-workspace"
]);

const PROJECT_ACTION_INTENT_MAX_AGE_MS = 1000;
const MENU_ROUTE_INTENT_MAX_AGE_MS = 1000;
const PROJECT_ACTION_CONTROL_KINDS = new Set([
  "button",
  "role-button",
  "role-link"
]);

const EXTERNAL_ACCOUNT_PREFIXES = [
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

const BLOCKED_PREFIXES = [
  "/backend-api/",
  "/api/",
  "/assets/",
  "/cdn-cgi/",
  "/auth/",
  "/login",
  "/logout"
];

function matchesPrefix(pathname, prefix) {
  const normalizedPrefix = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : prefix;

  return (
    pathname === normalizedPrefix ||
    pathname.startsWith(`${normalizedPrefix}/`)
  );
}

function isSettingsPageUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com" &&
      (
        matchesPrefix(
          parsed.pathname.toLowerCase(),
          "/profile"
        ) ||
        matchesPrefix(
          parsed.pathname.toLowerCase(),
          "/settings"
        )
      )
    );
  } catch {
    return false;
  }
}

function isSettingsReturnRoute(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com" &&
      parsed.pathname === "/"
    );
  } catch {
    return false;
  }
}

function classifyRoute(value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return "invalid";
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "chatgpt.com"
  ) {
    return "invalid";
  }

  const pathname = parsed.pathname.toLowerCase();

  if (isSettingsPageUrl(value)) {
    return "settings-page";
  }

  if (
    EXTERNAL_ACCOUNT_PREFIXES.some((prefix) =>
      matchesPrefix(pathname, prefix)
    )
  ) {
    return "external-account";
  }

  if (
    matchesPrefix(pathname, "/settings") ||
    matchesPrefix(pathname, "/search") ||
    matchesPrefix(pathname, "/search-conversations")
  ) {
    return "overlay-only";
  }

  if (
    BLOCKED_PREFIXES.some((prefix) =>
      matchesPrefix(pathname, prefix)
    )
  ) {
    return "blocked";
  }

  if (
    /^\/g\/g-p-[^/]+\/c\/[^/]+\/?$/.test(pathname)
  ) {
    return "project-conversation";
  }

  if (
    /^\/g\/g-p-[^/]+(?:\/project)?\/?$/.test(pathname)
  ) {
    return "project-workspace";
  }

  if (/^\/c\/[^/]+\/?$/.test(pathname)) {
    return "conversation";
  }

  return "unknown-workspace";
}

function decision(action, reason) {
  return {
    action,
    reason
  };
}

function isProjectActionIntentValid(
  intent,
  context = {}
) {
  const {
    activePaneIndex,
    currentGeneration,
    now
  } = context;

  if (
    !intent ||
    intent.consumed === true ||
    !Number.isInteger(intent.paneIndex) ||
    !Number.isInteger(intent.generation) ||
    !Number.isFinite(intent.createdAt) ||
    !Number.isInteger(activePaneIndex) ||
    !Number.isInteger(currentGeneration) ||
    !Number.isFinite(now) ||
    intent.paneIndex < 0 ||
    intent.generation < 1 ||
    activePaneIndex < 0 ||
    currentGeneration < 1
  ) {
    return false;
  }

  const age = now - intent.createdAt;

  return (
    intent.paneIndex === activePaneIndex &&
    intent.generation === currentGeneration &&
    age >= 0 &&
    age <= PROJECT_ACTION_INTENT_MAX_AGE_MS
  );
}

function isMenuRouteIntentValid(
  intent,
  context = {}
) {
  const {
    activePaneIndex,
    currentGeneration,
    now
  } = context;

  if (
    !intent ||
    intent.consumed === true ||
    !Number.isInteger(intent.paneIndex) ||
    !Number.isInteger(intent.generation) ||
    !Number.isFinite(intent.createdAt) ||
    !Number.isInteger(activePaneIndex) ||
    !Number.isInteger(currentGeneration) ||
    !Number.isFinite(now) ||
    intent.paneIndex < 0 ||
    intent.generation < 1 ||
    activePaneIndex < 0 ||
    currentGeneration < 1
  ) {
    return false;
  }

  const age = now - intent.createdAt;

  return (
    intent.paneIndex === activePaneIndex &&
    intent.generation === currentGeneration &&
    age >= 0 &&
    age <= MENU_ROUTE_INTENT_MAX_AGE_MS
  );
}

function decideMenuRouteCandidate(input = {}) {
  const {
    phase,
    controlKind,
    insideDialog = false,
    overlayState = "closed",
    overlayControl = false,
    closeControl = false,
    externalControl = false,
    backdropControl = false
  } = input;

  if (phase !== "pointerdown") {
    return decision("ignore-control", "non-candidate-phase");
  }

  if (controlKind !== "menuitem") {
    return decision("ignore-control", "unsupported-control-kind");
  }

  if (
    insideDialog ||
    overlayState !== "closed" ||
    overlayControl
  ) {
    return decision("ignore-control", "overlay-control-or-state");
  }

  if (closeControl) {
    return decision("ignore-control", "close-control");
  }

  if (externalControl) {
    return decision("ignore-control", "external-control");
  }

  if (backdropControl) {
    return decision("ignore-control", "backdrop-control");
  }

  return decision(
    "create-menu-route-intent",
    "eligible-native-menu-action"
  );
}

function decideProjectActionCandidate(input = {}) {
  const {
    phase,
    controlKind,
    hasAnchor = false,
    insideDialog = false,
    overlayState = "closed",
    overlayControl = false,
    closeControl = false,
    externalControl = false,
    backdropControl = false
  } = input;

  if (phase !== "pointerdown") {
    return decision("ignore-control", "non-candidate-phase");
  }

  if (!PROJECT_ACTION_CONTROL_KINDS.has(controlKind)) {
    return decision("ignore-control", "unsupported-control-kind");
  }

  if (hasAnchor) {
    return decision("ignore-control", "anchor-control");
  }

  if (
    insideDialog ||
    overlayState !== "closed" ||
    overlayControl
  ) {
    return decision("ignore-control", "overlay-control-or-state");
  }

  if (closeControl) {
    return decision("ignore-control", "close-control");
  }

  if (externalControl) {
    return decision("ignore-control", "external-control");
  }

  if (backdropControl) {
    return decision("ignore-control", "backdrop-control");
  }

  return decision(
    "create-project-intent",
    "eligible-non-anchor-control"
  );
}

function decideSidebarRouting(input = {}) {
  const {
    routeKind,
    source,
    overlayState = "closed",
    projectActionIntent = null,
    menuRouteIntent = null,
    activePaneIndex = -1,
    currentProjectIntentGeneration = -1,
    currentMenuRouteIntentGeneration = -1,
    now = Number.NaN,
    suppressionActive = false,
    activePaneValid = false
  } = input;

  const validProjectActionIntent =
    isProjectActionIntentValid(
      projectActionIntent,
      {
        activePaneIndex,
        currentGeneration:
          currentProjectIntentGeneration,
        now
      }
    );
  const validMenuRouteIntent =
    isMenuRouteIntentValid(
      menuRouteIntent,
      {
        activePaneIndex,
        currentGeneration:
          currentMenuRouteIntentGeneration,
        now
      }
    );

  if (!ROUTE_KINDS.has(routeKind)) {
    return decision("reject-route", "invalid-route-kind");
  }

  if (source === "dialog-close") {
    return decision(
      "clear-project-intent",
      "dialog-close-clears-intent"
    );
  }

  if (routeKind === "invalid" || routeKind === "blocked") {
    return decision("reject-route", "blocked-or-invalid-route");
  }

  if (routeKind === "external-account") {
    return decision("keep-in-overlay", "external-account-route");
  }

  if (routeKind === "settings-page") {
    return decision("keep-in-overlay", "settings-page-route");
  }

  if (
    routeKind === "overlay-only" ||
    source === "overlay-control" ||
    ["settings", "search", "dialog"].includes(overlayState)
  ) {
    return decision("keep-in-overlay", "overlay-route-or-state");
  }

  if (suppressionActive) {
    return decision("ignore-duplicate", "suppression-active");
  }

  if (!activePaneValid) {
    return decision("reject-route", "active-pane-invalid");
  }

  if (source === "anchor-intent") {
    if (FORWARDABLE_WORKSPACE_ROUTE_KINDS.has(routeKind)) {
      return decision("forward-to-pane", "explicit-anchor-intent");
    }

    return decision("reject-route", "anchor-route-not-forwardable");
  }

  if (source === "native-navigation") {
    if (
      validProjectActionIntent &&
      FORWARDABLE_WORKSPACE_ROUTE_KINDS.has(routeKind)
    ) {
      return decision(
        "forward-to-pane",
        "explicit-sidebar-action-intent"
      );
    }

    if (
      validMenuRouteIntent &&
      routeKind === "unknown-workspace"
    ) {
      return decision(
        "forward-to-pane",
        "explicit-menu-workspace-intent"
      );
    }

    return decision("ignore-native-route", "native-route-without-intent");
  }

  return decision("reject-route", "unsupported-routing-source");
}

module.exports = {
  MENU_ROUTE_INTENT_MAX_AGE_MS,
  PROJECT_ACTION_INTENT_MAX_AGE_MS,
  classifyRoute,
  decideMenuRouteCandidate,
  decideProjectActionCandidate,
  decideSidebarRouting,
  isMenuRouteIntentValid,
  isProjectActionIntentValid,
  isSettingsPageUrl,
  isSettingsReturnRoute
};
