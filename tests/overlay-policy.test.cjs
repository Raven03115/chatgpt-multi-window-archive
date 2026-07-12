"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOverlayShape,
  classifyOverlayControl,
  decideOverlayControl,
  replaceDialogRect,
  replacePopupRects,
  transitionOverlayState
} = require("../lib/overlay-policy.cjs");

const rect = (x, y, width, height) => ({ x, y, width, height });

test("conversation and Project row menu buttons never route or create Project intent", () => {
  for (const rowKind of ["conversation", "project-conversation"]) {
    const kind = classifyOverlayControl({
      actionableKind: "button",
      rowKind,
      insideAnchor: true,
      ariaHaspopup: "menu"
    });
    const decision = decideOverlayControl(kind);

    assert.equal(kind, "menu-trigger");
    assert.equal(decision.route, false);
    assert.equal(decision.projectIntent, false);
  }
});

test("SVG path resolves to menu trigger before its parent conversation anchor", () => {
  assert.equal(classifyOverlayControl({
    targetKind: "path",
    actionableKind: "role-button",
    insideAnchor: true,
    ariaExpanded: "false",
    hasAriaControls: true,
    controlsMenu: true
  }), "menu-trigger");
});

test("normal conversation anchor still routes and Project new chat still creates intent", () => {
  assert.deepEqual(
    decideOverlayControl(classifyOverlayControl({
      actionableKind: "anchor"
    })),
    { route: true, projectIntent: false }
  );
  assert.deepEqual(
    decideOverlayControl(classifyOverlayControl({
      actionableKind: "button"
    })),
    { route: false, projectIntent: true }
  );
});

test("popup state replaces moved/resized rects and removes stale rects", () => {
  const first = replacePopupRects([], [rect(300, 40, 180, 220)]);
  const moved = replacePopupRects(first, [rect(320, 55, 190, 240)]);
  const removed = replacePopupRects(moved, []);

  assert.deepEqual(moved, [rect(320, 55, 190, 240)]);
  assert.deepEqual(removed, []);
});

test("dialog growth, shrink, and replacement keep only the newest rect", () => {
  const large = replaceDialogRect(rect(300, 80, 500, 300), rect(300, 80, 500, 500));
  const small = replaceDialogRect(large, rect(300, 80, 500, 240));

  assert.deepEqual(large, rect(300, 80, 500, 500));
  assert.deepEqual(small, rect(300, 80, 500, 240));
});

test("overlay shape includes sidebar, dialog, and popup but never workspace rect", () => {
  const shape = buildOverlayShape({
    mode: "shaped-dialog",
    bounds: { width: 1200, height: 800 },
    sidebarWidth: 260,
    dialogRect: rect(350, 80, 600, 500),
    popupRects: [rect(900, 100, 180, 220)],
    workspaceRect: rect(260, 0, 940, 800)
  });

  assert.deepEqual(shape, [
    rect(0, 0, 260, 800),
    rect(350, 80, 600, 500),
    rect(900, 100, 180, 220)
  ]);
});

test("pending dialog succeeds only after a surface is detected", () => {
  const pending = transitionOverlayState(
    { mode: "sidebar-only", generation: 0 },
    { type: "overlay-intent" }
  );
  const detected = transitionOverlayState(pending, {
    type: "dialog-detected"
  });

  assert.equal(pending.mode, "overlay-intent-pending");
  assert.equal(detected.mode, "shaped-dialog");
  assert.equal(detected.mainWorkspaceVisible, false);
});

test("missing dialog returns pending state to sidebar without fullscreen or gray residue", () => {
  const pending = transitionOverlayState(
    { mode: "sidebar-only", generation: 1 },
    { type: "overlay-intent" }
  );
  const missing = transitionOverlayState(pending, {
    type: "dialog-missing"
  });

  assert.equal(missing.mode, "sidebar-only");
  assert.equal(missing.suppressPanes, false);
  assert.equal(missing.mainWorkspaceVisible, false);
});

test("closing a pending overlay cancels it without pane suppression", () => {
  const pending = transitionOverlayState(
    { mode: "sidebar-only", generation: 2 },
    { type: "overlay-intent" }
  );
  const cancelled = transitionOverlayState(pending, {
    type: "pending-cancelled"
  });

  assert.equal(cancelled.mode, "sidebar-only");
  assert.equal(cancelled.suppressPanes, false);
  assert.equal(cancelled.mainWorkspaceVisible, false);
});

test("popup and dialog resize never enable fullscreen isolation", () => {
  for (const event of [
    { type: "popup-detected" },
    { type: "dialog-detected" },
    { type: "dialog-resized" }
  ]) {
    const state = transitionOverlayState(
      { mode: "sidebar-only", generation: 0 },
      event
    );
    assert.notEqual(state.mode, "fullscreen");
    assert.equal(state.mainWorkspaceVisible, false);
  }
});

test("only explicit external fullscreen reveals main workspace and normal mode hides it again", () => {
  const rejected = transitionOverlayState(
    { mode: "sidebar-only", generation: 0 },
    { type: "fullscreen", explicitExternal: false }
  );
  const fullscreen = transitionOverlayState(rejected, {
    type: "fullscreen",
    explicitExternal: true
  });
  const normal = transitionOverlayState(fullscreen, {
    type: "close"
  });

  assert.equal(rejected.mode, "sidebar-only");
  assert.equal(fullscreen.mainWorkspaceVisible, true);
  assert.equal(normal.mainWorkspaceVisible, false);
});
