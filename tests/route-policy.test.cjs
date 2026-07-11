"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyRoute,
  decideSidebarRouting
} = require("../lib/route-policy.cjs");

function decide(overrides = {}) {
  return decideSidebarRouting({
    routeKind: "conversation",
    source: "anchor-intent",
    overlayState: "closed",
    explicitProjectActionIntent: false,
    suppressionActive: false,
    activePaneValid: true,
    ...overrides
  });
}

function assertAction(actual, expected) {
  assert.equal(
    actual.action,
    expected,
    `expected ${expected}, received ${actual.action} (${actual.reason})`
  );
}

test("ordinary anchor conversation forwards to the active pane", () => {
  assert.equal(
    classifyRoute("https://chatgpt.com/c/conversation-id"),
    "conversation"
  );
  assertAction(decide(), "forward-to-pane");
});

test("Project conversation anchor forwards to the active pane", () => {
  const routeKind = classifyRoute(
    "https://chatgpt.com/g/g-p-project-id/c/conversation-id"
  );
  assert.equal(routeKind, "project-conversation");
  assertAction(decide({ routeKind }), "forward-to-pane");
});

test("Settings remains in the overlay", () => {
  const routeKind = classifyRoute("https://chatgpt.com/settings");
  assert.equal(routeKind, "overlay-only");
  assertAction(decide({ routeKind }), "keep-in-overlay");
});

test("Search remains in the overlay", () => {
  const routeKind = classifyRoute("https://chatgpt.com/search");
  assert.equal(routeKind, "overlay-only");
  assertAction(decide({ routeKind }), "keep-in-overlay");
});

test("Settings background close clears Project intent and never forwards", () => {
  const result = decide({
    routeKind: "unknown-workspace",
    source: "dialog-close",
    overlayState: "settings",
    explicitProjectActionIntent: true
  });
  assertAction(result, "clear-project-intent");
});

test("native Project workspace without explicit intent is ignored", () => {
  assertAction(
    decide({
      routeKind: "project-workspace",
      source: "native-navigation"
    }),
    "ignore-native-route"
  );
});

test("native Project workspace with one-time explicit intent forwards", () => {
  assertAction(
    decide({
      routeKind: "project-workspace",
      source: "native-navigation",
      explicitProjectActionIntent: true
    }),
    "forward-to-pane"
  );
});

test("consumed Project intent cannot forward a second native route", () => {
  const first = decide({
    routeKind: "project-workspace",
    source: "native-navigation",
    explicitProjectActionIntent: true
  });
  const second = decide({
    routeKind: "project-workspace",
    source: "native-navigation",
    explicitProjectActionIntent: false
  });

  assertAction(first, "forward-to-pane");
  assertAction(second, "ignore-native-route");
});

test("suppression guard ignores a duplicate route", () => {
  assertAction(
    decide({ suppressionActive: true }),
    "ignore-duplicate"
  );
});

test("external account, upgrade, and billing routes stay out of panes", () => {
  for (const url of [
    "https://chatgpt.com/upgrade",
    "https://chatgpt.com/billing",
    "https://chatgpt.com/subscription"
  ]) {
    const routeKind = classifyRoute(url);
    assert.equal(routeKind, "external-account");
    assertAction(decide({ routeKind }), "keep-in-overlay");
  }
});

test("login, auth, and backend API routes are rejected", () => {
  for (const url of [
    "https://chatgpt.com/login",
    "https://chatgpt.com/auth/callback",
    "https://chatgpt.com/backend-api/conversations"
  ]) {
    const routeKind = classifyRoute(url);
    assert.equal(routeKind, "blocked");
    assertAction(decide({ routeKind }), "reject-route");
  }
});

test("ordinary native conversation never forwards without explicit anchor intent", () => {
  assertAction(
    decide({ source: "native-navigation" }),
    "ignore-native-route"
  );
});

test("invalid active pane prevents forwarding", () => {
  assertAction(
    decide({ activePaneValid: false }),
    "reject-route"
  );
});

test("Project IDs containing settings text are not overlay routes", () => {
  assert.equal(
    classifyRoute(
      "https://chatgpt.com/g/g-p-settings-project/project"
    ),
    "project-workspace"
  );
});

test("non-ChatGPT and malformed URLs are invalid", () => {
  assert.equal(classifyRoute("not a url"), "invalid");
  assert.equal(classifyRoute("https://example.com/c/id"), "invalid");
});

test("unknown same-origin workspace routes remain explicitly classified", () => {
  assert.equal(
    classifyRoute("https://chatgpt.com/library"),
    "unknown-workspace"
  );
});
