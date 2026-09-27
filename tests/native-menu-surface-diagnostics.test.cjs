"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONSOLE_PREFIX,
  buildNativeMenuActionDiagnosticsScript,
  normalizeSurfaceDiagnostic
} = require("../lib/native-menu-surface-diagnostics.cjs");

test("native menu diagnostics normalization keeps only structural metadata", () => {
  const normalized = normalizeSurfaceDiagnostic({
    event: "native-menu-surface-snapshot",
    action: "inspect",
    reason: "post-native-menu-action",
    elapsedMs: 150,
    rectWidth: 420,
    rectHeight: 180,
    rectCount: 3,
    surfaceTag: "DIV",
    surfaceRole: "dialog",
    surfaceState: "open",
    surfaceTestId: "rename-dialog",
    surfacePosition: "fixed",
    surfaceVisibility: "visible",
    surfaceDisplay: "flex",
    surfacePointerEvents: "auto",
    surfaceInsideMain: true,
    surfaceAriaModal: true,
    surfaceHasInput: true,
    surfaceHasButton: true,
    surfaceAddedAfterAction: true,
    surfaceContainsAddedNode: true,
    text: "private conversation title",
    href: "https://chatgpt.com/c/private-id",
    className: "contains-private-data",
    value: "private rename value"
  });

  assert.deepEqual(normalized, {
    event: "native-menu-surface-snapshot",
    action: "inspect",
    reason: "post-native-menu-action",
    surfaceTag: "div",
    surfaceRole: "dialog",
    surfaceState: "open",
    surfaceTestId: "rename-dialog",
    surfacePosition: "fixed",
    surfaceVisibility: "visible",
    surfaceDisplay: "flex",
    surfacePointerEvents: "auto",
    elapsedMs: 150,
    rectWidth: 420,
    rectHeight: 180,
    rectCount: 3,
    surfaceInsideMain: true,
    surfaceAriaModal: true,
    surfaceHasInput: true,
    surfaceHasButton: true,
    surfaceAddedAfterAction: true,
    surfaceContainsAddedNode: true
  });

  assert.equal(Object.hasOwn(normalized, "text"), false);
  assert.equal(Object.hasOwn(normalized, "href"), false);
  assert.equal(Object.hasOwn(normalized, "className"), false);
  assert.equal(Object.hasOwn(normalized, "value"), false);
});

test("native menu diagnostics rejects unsupported event names and unsafe attribute tokens", () => {
  assert.equal(
    normalizeSurfaceDiagnostic({
      event: "arbitrary-event",
      surfaceTestId: "anything"
    }),
    null
  );

  const normalized = normalizeSurfaceDiagnostic({
    event: "native-menu-surface-snapshot",
    surfaceTestId: "unsafe value with spaces and user text",
    surfaceRole: "dialog"
  });

  assert.equal(normalized.surfaceRole, "dialog");
  assert.equal(normalized.surfaceTestId, "[redacted-attribute]");
});

test("browser diagnostic script observes native menuitem actions without reading user content", () => {
  const script = buildNativeMenuActionDiagnosticsScript();

  assert.match(script, /role=\\"menuitem\\"/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /\[0, 50, 150, 500\]/);
  assert.ok(script.includes(CONSOLE_PREFIX));

  for (const forbidden of [
    "textContent",
    "innerText",
    ".value",
    "document.cookie",
    "localStorage",
    "sessionStorage"
  ]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `diagnostic script must not read ${forbidden}`
    );
  }
});
