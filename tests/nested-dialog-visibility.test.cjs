"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  ACTIVE_DIALOG_SELECTOR,
  NESTED_DIALOG_VISIBILITY_CSS,
  isChatGPTPage
} = require("../lib/nested-dialog-visibility-compat.cjs");

function resolveElectronBinary() {
  try {
    const resolved = require("electron");
    if (typeof resolved === "string") {
      return resolved;
    }
  } catch {
    // Fall through to the repository-local binary.
  }

  return path.join(
    __dirname,
    "..",
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
}

test("nested dialog compatibility targets only ChatGPT pages by default", () => {
  assert.equal(isChatGPTPage("https://chatgpt.com/"), true);
  assert.equal(isChatGPTPage("https://chatgpt.com/c/example"), true);
  assert.equal(isChatGPTPage("https://example.com/"), false);
  assert.equal(isChatGPTPage("file:///fixture.html"), false);
});

test("nested dialog compatibility is limited to explicit active dialog semantics", () => {
  assert.match(ACTIVE_DIALOG_SELECTOR, /data-state=\\?"open\\?"/);
  assert.match(ACTIVE_DIALOG_SELECTOR, /aria-modal=\\?"true\\?"/);
  assert.doesNotMatch(
    ACTIVE_DIALOG_SELECTOR,
    /role=\\?"menu\\?"|role=\\?"listbox\\?"/
  );
  assert.match(
    NESTED_DIALOG_VISIBILITY_CSS,
    /pointer-events: none !important/
  );
  assert.match(
    NESTED_DIALOG_VISIBILITY_CSS,
    /pointer-events: auto !important/
  );
});

test("nested active dialog remains detectable while workspace stays isolated", () => {
  const electronBinary = resolveElectronBinary();
  const runner = path.join(
    __dirname,
    "fixtures",
    "nested-dialog-visibility-runner.cjs"
  );
  const electronArgs =
    process.platform === "linux"
      ? ["--no-sandbox", runner]
      : [runner];

  const result = spawnSync(
    electronBinary,
    electronArgs,
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      }
    }
  );

  assert.equal(
    result.status,
    0,
    [
      "nested-dialog visibility fixture failed",
      result.stdout,
      result.stderr
    ]
      .filter(Boolean)
      .join("\n")
  );
});
