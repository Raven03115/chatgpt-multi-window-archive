"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

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

test("nested active dialog remains detectable while workspace stays isolated", () => {
  const electronBinary = resolveElectronBinary();
  const runner = path.join(
    __dirname,
    "fixtures",
    "nested-dialog-visibility-runner.cjs"
  );

  const result = spawnSync(
    electronBinary,
    [runner],
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
