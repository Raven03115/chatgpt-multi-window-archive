"use strict";

const ROUTE_KINDS = new Set([
  "conversation",
  "project-conversation",
  "project-workspace",
  "overlay-only",
  "external-account",
  "blocked",
  "unknown-workspace",
  "invalid"
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

function decideSidebarRouting(input = {}) {
  const {
    routeKind,
    source,
    overlayState = "closed",
    explicitProjectActionIntent = false,
    suppressionActive = false,
    activePaneValid = false
  } = input;

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
    if (
      [
        "conversation",
        "project-conversation",
        "project-workspace",
        "unknown-workspace"
      ].includes(routeKind)
    ) {
      return decision("forward-to-pane", "explicit-anchor-intent");
    }

    return decision("reject-route", "anchor-route-not-forwardable");
  }

  if (source === "native-navigation") {
    if (
      explicitProjectActionIntent &&
      [
        "project-conversation",
        "project-workspace"
      ].includes(routeKind)
    ) {
      return decision(
        "forward-to-pane",
        "explicit-project-action-intent"
      );
    }

    return decision("ignore-native-route", "native-route-without-intent");
  }

  return decision("reject-route", "unsupported-routing-source");
}

module.exports = {
  classifyRoute,
  decideSidebarRouting
};
