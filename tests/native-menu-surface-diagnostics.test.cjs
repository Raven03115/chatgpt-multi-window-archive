"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createDiagnosticsLogger
} = require("../lib/diagnostics.cjs");
const {
  CONSOLE_PREFIX,
  buildNativeMenuActionDiagnosticsScript,
  extractConsoleMessage,
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

test("console message extraction supports current and legacy Electron event shapes", () => {
  assert.equal(
    extractConsoleMessage(
      { message: `${CONSOLE_PREFIX}{}` },
      "legacy"
    ),
    `${CONSOLE_PREFIX}{}`
  );
  assert.equal(
    extractConsoleMessage(1, `${CONSOLE_PREFIX}{}`),
    `${CONSOLE_PREFIX}{}`
  );
  assert.equal(extractConsoleMessage(null, null), "");
});

test("structural surface metadata survives the shared diagnostics allowlist", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatgpt-native-menu-diag-")
  );
  t.after(() => fs.rmSync(
    directory,
    { recursive: true, force: true }
  ));

  const logPath = path.join(
    directory,
    "integration-events.jsonl"
  );
  const logger = createDiagnosticsLogger({
    logPath,
    clock: () => new Date("2026-09-28T00:00:00.000Z")
  });

  const normalized = normalizeSurfaceDiagnostic({
    event: "native-menu-surface-snapshot",
    action: "inspect",
    reason: "post-native-menu-action",
    elapsedMs: 50,
    rectWidth: 480,
    rectHeight: 220,
    rectCount: 1,
    surfaceTag: "section",
    surfaceRole: "dialog",
    surfaceState: "open",
    surfaceTestId: "rename-modal",
    surfacePosition: "fixed",
    surfaceVisibility: "visible",
    surfaceDisplay: "flex",
    surfacePointerEvents: "auto",
    surfaceInsideMain: false,
    surfaceAriaModal: true,
    surfaceHasInput: true,
    surfaceHasButton: true,
    surfaceAddedAfterAction: true,
    surfaceContainsAddedNode: true
  });

  assert.equal(logger.log(normalized), true);

  const record = JSON.parse(
    fs.readFileSync(logPath, "utf8").trim()
  );

  assert.equal(record.surfaceTag, "section");
  assert.equal(record.surfaceRole, "dialog");
  assert.equal(record.surfaceState, "open");
  assert.equal(record.surfaceTestId, "rename-modal");
  assert.equal(record.surfacePosition, "fixed");
  assert.equal(record.surfaceVisibility, "visible");
  assert.equal(record.surfaceDisplay, "flex");
  assert.equal(record.surfacePointerEvents, "auto");
  assert.equal(record.surfaceInsideMain, false);
  assert.equal(record.surfaceAriaModal, true);
  assert.equal(record.surfaceHasInput, true);
  assert.equal(record.surfaceAddedAfterAction, true);
  assert.equal(record.rectWidth, 480);
  assert.equal(record.rectHeight, 220);
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
