"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyRoute,
  decideProjectActionCandidate,
  decideSidebarRouting,
  isProjectActionIntentValid
} = require("../lib/route-policy.cjs");

const TEST_NOW = 10_000;

function createProjectIntent(overrides = {}) {
  return {
    paneIndex: 2,
    generation: 7,
    createdAt: TEST_NOW - 100,
    consumed: false,
    ...overrides
  };
}

test("a role-button resolved from an SVG or path target is an eligible candidate", () => {
  const result = decideProjectActionCandidate({
    phase: "pointerdown",
    targetKind: "path",
    controlKind: "role-button",
    hasAnchor: false,
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  });

  assertAction(result, "create-project-intent");
});

test("sidebar preload resolves nested targets through the full actionable-control selector", () => {
  const preloadSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "sidebar-shape-preload-v4.5.4.js"
    ),
    "utf8"
  );

  assert.match(
    preloadSource,
    /return target\.closest\(\s*'a\[href\], button, \[role="button"\], \[role="menuitem"\]'\s*\)/
  );
});

test("Upgrade classification precedes native menu actions with a defensive exclusion", () => {
  const preloadSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "sidebar-shape-preload-v4.5.4.js"
    ),
    "utf8"
  );
  const pointerHandler = preloadSource.slice(
    preloadSource.indexOf("function handlePointerDown"),
    preloadSource.indexOf("function handleClick")
  );
  const clickHandler = preloadSource.slice(
    preloadSource.indexOf("function handleClick"),
    preloadSource.indexOf("function handleKeyDown")
  );

  for (const handler of [pointerHandler, clickHandler]) {
    assert(
      handler.indexOf("isUpgradeControl(event.target)") <
        handler.indexOf("isOverlayOnlyControl(event.target)")
    );
    assert(
      handler.indexOf("isOverlayOnlyControl(event.target)") <
        handler.indexOf("isNativeMenuAction(event.target)")
    );
  }
  assert(
    pointerHandler.indexOf("isNativeMenuAction(event.target)") <
      pointerHandler.indexOf("reportProjectActionCandidate(event.target)")
  );
  assert.match(
    preloadSource,
    /function isNativeMenuAction\(target\)[\s\S]*?control\.matches\('\[role="menuitem"\]'\) &&\s*!isUpgradeControl\(control\)/
  );
});

test("pointerdown creates a candidate while its following click never clears it", () => {
  const input = {
    controlKind: "button",
    hasAnchor: false,
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  };
  const pointerResult = decideProjectActionCandidate({
    ...input,
    phase: "pointerdown"
  });
  const clickResult = decideProjectActionCandidate({
    ...input,
    phase: "click"
  });

  assertAction(pointerResult, "create-project-intent");
  assertAction(clickResult, "ignore-control");
  assert.notEqual(clickResult.action, "clear-project-intent");
});

test("a native menuitem is not a Project action candidate", () => {
  assertAction(decideProjectActionCandidate({
    phase: "pointerdown",
    controlKind: "menuitem",
    hasAnchor: false,
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  }), "ignore-control");
});

test("Settings, dialogs, anchors, backdrops, close, and external controls never create candidates", () => {
  const base = {
    phase: "pointerdown",
    controlKind: "menuitem",
    hasAnchor: false,
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  };

  for (const excluded of [
    { hasAnchor: true },
    { insideDialog: true },
    { overlayState: "settings" },
    { overlayState: "search" },
    { overlayControl: true },
    { closeControl: true },
    { externalControl: true },
    { backdropControl: true }
  ]) {
    assertAction(
      decideProjectActionCandidate({
        ...base,
        ...excluded
      }),
      "ignore-control"
    );
  }
});

function decide(overrides = {}) {
  return decideSidebarRouting({
    routeKind: "conversation",
    source: "anchor-intent",
    overlayState: "closed",
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
  const closeResult = decide({
    routeKind: "unknown-workspace",
    source: "dialog-close",
    overlayState: "settings",
    projectActionIntent: createProjectIntent(),
    activePaneIndex: 2,
    now: TEST_NOW
  });
  const followingNativeResult = decide({
    routeKind: "conversation",
    source: "native-navigation",
    overlayState: "closed",
    projectActionIntent: null,
    activePaneIndex: 2,
    now: TEST_NOW
  });

  assertAction(closeResult, "clear-project-intent");
  assertAction(followingNativeResult, "ignore-native-route");
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
  for (const routeKind of [
    "project-workspace",
    "project-conversation"
  ]) {
    assertAction(
      decide({
        routeKind,
        source: "native-navigation",
        projectActionIntent: createProjectIntent(),
        activePaneIndex: 2,
        currentProjectIntentGeneration: 7,
        now: TEST_NOW
      }),
      "forward-to-pane"
    );
  }
});

test("consumed Project intent cannot forward a second native route", () => {
  const intent = createProjectIntent();
  const first = decide({
    routeKind: "project-workspace",
    source: "native-navigation",
    projectActionIntent: intent,
    activePaneIndex: 2,
    currentProjectIntentGeneration: 7,
    now: TEST_NOW
  });
  const second = decide({
    routeKind: "project-workspace",
    source: "native-navigation",
    projectActionIntent: {
      ...intent,
      consumed: true
    },
    activePaneIndex: 2,
    currentProjectIntentGeneration: 7,
    now: TEST_NOW
  });

  assertAction(first, "forward-to-pane");
  assertAction(second, "ignore-native-route");
});

test("Project intent is valid only for its pane, generation, lifetime, and unused state", () => {
  assert.equal(
    isProjectActionIntentValid(
      createProjectIntent(),
      {
        activePaneIndex: 2,
        currentGeneration: 7,
        now: TEST_NOW
      }
    ),
    true
  );

  for (const invalidState of [
    {
      activePaneIndex: 1,
      currentGeneration: 7,
      now: TEST_NOW
    },
    {
      activePaneIndex: 2,
      currentGeneration: 8,
      now: TEST_NOW
    },
    {
      activePaneIndex: 2,
      currentGeneration: 7,
      now: TEST_NOW + 1_001
    }
  ]) {
    assert.equal(
      isProjectActionIntentValid(
        createProjectIntent(),
        invalidState
      ),
      false
    );
  }

  assert.equal(
    isProjectActionIntentValid(
      createProjectIntent({ consumed: true }),
      {
        activePaneIndex: 2,
        currentGeneration: 7,
        now: TEST_NOW
      }
    ),
    false
  );

  assert.equal(
    isProjectActionIntentValid(
      createProjectIntent({ paneIndex: -1 }),
      {
        activePaneIndex: -1,
        currentGeneration: 7,
        now: TEST_NOW
      }
    ),
    false
  );
});

test("Project intent never forwards an ordinary native conversation", () => {
  assertAction(
    decide({
      routeKind: "conversation",
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }),
    "ignore-native-route"
  );
});

test("Project intent cannot forward after the active pane changes", () => {
  assertAction(
    decide({
      routeKind: "project-workspace",
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 1,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }),
    "ignore-native-route"
  );
});

test("a bare boolean cannot bypass Project intent validation", () => {
  assertAction(
    decide({
      routeKind: "project-workspace",
      source: "native-navigation",
      explicitProjectActionIntent: true
    }),
    "ignore-native-route"
  );
});

test("suppression guard ignores a duplicate route", () => {
  assertAction(
    decide({ suppressionActive: true }),
    "ignore-duplicate"
  );
});

test("anchor selection forwards once and its following native event is suppressed", () => {
  const anchorResult = decide({
    routeKind: "project-conversation",
    source: "anchor-intent",
    suppressionActive: false
  });
  const nativeResult = decide({
    routeKind: "project-conversation",
    source: "native-navigation",
    suppressionActive: true
  });

  assertAction(anchorResult, "forward-to-pane");
  assertAction(nativeResult, "ignore-duplicate");
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
