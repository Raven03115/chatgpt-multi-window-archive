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

test("transparent compact role=dialog rename surface is detected", () => {
  const electronBinary = resolveElectronBinary();
  const runner = path.join(
    __dirname,
    "fixtures",
    "transparent-compact-dialog-runner.cjs"
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
      "transparent compact dialog fixture failed",
      result.stdout,
      result.stderr
    ]
      .filter(Boolean)
      .join("\n")
  );
});
