"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyRoute,
  decideMenuRouteCandidate,
  decideProjectActionCandidate,
  decideSidebarRouting,
  isMenuRouteIntentValid,
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

function createMenuRouteIntent(overrides = {}) {
  return {
    paneIndex: 2,
    generation: 11,
    createdAt: TEST_NOW - 100,
    consumed: false,
    ...overrides
  };
}

function getNativeMenuPointerBranch(preloadSource) {
  const pointerHandler = preloadSource.slice(
    preloadSource.indexOf("function handlePointerDown"),
    preloadSource.indexOf("function handleClick")
  );
  const match = pointerHandler.match(
    /else if \(snapshot\.nativeMenu\) \{([\s\S]*?)\}\s*else if \(\s*reportProjectActionCandidate\(event\.target\)/
  );

  assert.ok(
    match,
    "native menu pointer branch was not found"
  );

  return match[1];
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
    /return target\.closest\(\s*'a\[href\], button, \[role="button"\], \[role="link"\], \[role="menuitem"\]'\s*\)/
  );
});

test("pointer gesture snapshot keeps Close and Upgrade ahead of native menu navigation intents", () => {
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
  const snapshotBuilder = preloadSource.slice(
    preloadSource.indexOf("function createPointerGestureSnapshot"),
    preloadSource.indexOf("function handlePointerUp")
  );

  assert(
    snapshotBuilder.indexOf("isCloseControl(event.target)") <
      snapshotBuilder.indexOf("isUpgradeControl(event.target)")
  );
  assert.match(
    snapshotBuilder,
    /upgradeControl\s*=\s*!closeControl\s*&&\s*isUpgradeControl\(event\.target\)/
  );
  assert(
    pointerHandler.indexOf("if (snapshot.closeControl)") <
      pointerHandler.indexOf("else if (snapshot.upgradeControl)")
  );
  assert(
    pointerHandler.indexOf("else if (snapshot.upgradeControl)") <
      pointerHandler.indexOf("else if (snapshot.nativeMenu)")
  );
  const nativeMenuBranch =
    getNativeMenuPointerBranch(preloadSource);
  assert.match(
    nativeMenuBranch,
    /reportMenuRouteCandidate\(event\.target\)/
  );
  assert.doesNotMatch(
    nativeMenuBranch,
    /reportProjectActionCandidate\(event\.target\)/
  );
  assert(
    clickHandler.indexOf("if (completedPointerGesture)") <
      clickHandler.indexOf("isUpgradeControl(event.target)")
  );
  assert(
    clickHandler.indexOf("isUpgradeControl(event.target)") <
      clickHandler.indexOf("else if (overlayOnlyKind)") &&
      clickHandler.indexOf("else if (overlayOnlyKind)") <
        clickHandler.indexOf("isNativeMenuAction(event.target)")
  );
  assert.match(
    preloadSource,
    /function isNativeMenuAction\(target\)[\s\S]*?control\.matches\('\[role="menuitem"\]'\) &&\s*!isUpgradeControl\(control\)/
  );
});

test("native menu navigation uses a dedicated IPC channel instead of Project intent", () => {
  const preloadSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "sidebar-shape-preload-v4.5.4.js"
    ),
    "utf8"
  );
  const mainSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "poc-shaped-sidebar-v4.5.4.js"
    ),
    "utf8"
  );

  assert.match(
    preloadSource,
    /ipcRenderer\.send\(\s*"chatgpt-sidebar-menu-route-candidate"/
  );
  assert.match(
    mainSource,
    /ipcMain\.on\(\s*"chatgpt-sidebar-menu-route-candidate"/
  );

  const nativeMenuBranch =
    getNativeMenuPointerBranch(preloadSource);

  assert.match(
    nativeMenuBranch,
    /reportMenuRouteCandidate\(event\.target\)/
  );
  assert.doesNotMatch(
    nativeMenuBranch,
    /reportProjectActionCandidate\(event\.target\)/
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

test("a native menuitem may create a dedicated menu route candidate", () => {
  assertAction(decideMenuRouteCandidate({
    phase: "pointerdown",
    controlKind: "menuitem",
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  }), "create-menu-route-intent");
});

test("dialog, overlay, close, external, and backdrop menuitems never create menu route candidates", () => {
  const base = {
    phase: "pointerdown",
    controlKind: "menuitem",
    insideDialog: false,
    overlayState: "closed",
    overlayControl: false,
    closeControl: false,
    externalControl: false,
    backdropControl: false
  };

  for (const excluded of [
    { insideDialog: true },
    { overlayState: "settings" },
    { overlayState: "search" },
    { overlayControl: true },
    { closeControl: true },
    { externalControl: true },
    { backdropControl: true }
  ]) {
    assertAction(
      decideMenuRouteCandidate({
        ...base,
        ...excluded
      }),
      "ignore-control"
    );
  }
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

test("profile Settings page and nested sections are never workspace routes", () => {
  for (const url of [
    "https://chatgpt.com/profile",
    "https://chatgpt.com/profile/",
    "https://chatgpt.com/profile/security",
    "https://chatgpt.com/profile?tab=general"
  ]) {
    const routeKind = classifyRoute(url);
    assert.equal(routeKind, "settings-page");
    assertAction(decide({
      routeKind,
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }), "keep-in-overlay");
    assertAction(decide({
      routeKind,
      source: "anchor-intent",
      activePaneValid: true
    }), "keep-in-overlay");
  }
  assert.equal(
    classifyRoute("https://chatgpt.com/profiles"),
    "unknown-workspace"
  );
});

test("Settings routes remain in persistent settings-page overlay", () => {
  for (const url of [
    "https://chatgpt.com/settings",
    "https://chatgpt.com/settings/",
    "https://chatgpt.com/settings/security",
    "https://chatgpt.com/settings?tab=appearance",
    "https://chatgpt.com/profile",
    "https://chatgpt.com/profile/security"
  ]) {
    const routeKind = classifyRoute(url);
    assert.equal(routeKind, "settings-page");
    assertAction(decide({ routeKind }), "keep-in-overlay");
    assertAction(decide({
      routeKind,
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }), "keep-in-overlay");
  }
  for (const url of [
    "https://chatgpt.com/settings-extra",
    "https://chatgpt.com/profiles",
    "https://example.com/settings"
  ]) {
    assert.notEqual(classifyRoute(url), "settings-page");
  }
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

test("Explore-style menu route intent forwards only an unknown workspace route", () => {
  assertAction(
    decide({
      routeKind: "unknown-workspace",
      source: "native-navigation",
      menuRouteIntent: createMenuRouteIntent(),
      activePaneIndex: 2,
      currentMenuRouteIntentGeneration: 11,
      now: TEST_NOW
    }),
    "forward-to-pane"
  );

  for (const routeKind of [
    "conversation",
    "project-workspace",
    "project-conversation"
  ]) {
    assertAction(
      decide({
        routeKind,
        source: "native-navigation",
        menuRouteIntent: createMenuRouteIntent(),
        activePaneIndex: 2,
        currentMenuRouteIntentGeneration: 11,
        now: TEST_NOW
      }),
      "ignore-native-route"
    );
  }
});

test("menu route intent is valid only for its pane, generation, lifetime, and unused state", () => {
  assert.equal(
    isMenuRouteIntentValid(
      createMenuRouteIntent(),
      {
        activePaneIndex: 2,
        currentGeneration: 11,
        now: TEST_NOW
      }
    ),
    true
  );

  for (const invalidState of [
    {
      activePaneIndex: 1,
      currentGeneration: 11,
      now: TEST_NOW
    },
    {
      activePaneIndex: 2,
      currentGeneration: 12,
      now: TEST_NOW
    },
    {
      activePaneIndex: 2,
      currentGeneration: 11,
      now: TEST_NOW + 1_001
    }
  ]) {
    assert.equal(
      isMenuRouteIntentValid(
        createMenuRouteIntent(),
        invalidState
      ),
      false
    );
  }

  assert.equal(
    isMenuRouteIntentValid(
      createMenuRouteIntent({ consumed: true }),
      {
        activePaneIndex: 2,
        currentGeneration: 11,
        now: TEST_NOW
      }
    ),
    false
  );
});

test("native workspace routes with one-time explicit button intent forward", () => {
  for (const routeKind of [
    "conversation",
    "project-workspace",
    "project-conversation",
    "unknown-workspace"
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

test("explicit sidebar action intent forwards an ordinary native conversation", () => {
  assertAction(
    decide({
      routeKind: "conversation",
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }),
    "forward-to-pane"
  );
});

test("explicit sidebar action intent forwards a native unknown workspace route", () => {
  assertAction(
    decide({
      routeKind: classifyRoute("https://chatgpt.com/library"),
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    }),
    "forward-to-pane"
  );
});

test("explicit sidebar action intent still cannot forward overlay, external, blocked, or invalid routes", () => {
  for (const routeKind of [
    "overlay-only",
    "external-account",
    "blocked",
    "invalid"
  ]) {
    const result = decide({
      routeKind,
      source: "native-navigation",
      projectActionIntent: createProjectIntent(),
      activePaneIndex: 2,
      currentProjectIntentGeneration: 7,
      now: TEST_NOW
    });

    assert.notEqual(result.action, "forward-to-pane");
  }
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

test("ordinary native conversation never forwards without explicit intent", () => {
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
