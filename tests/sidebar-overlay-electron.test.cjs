"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("offline Electron fixture preserves overlay interaction and dynamic shape integrity", () => {
  const electronPath = require("electron");
  const result = spawnSync(
    electronPath,
    [path.join(
      __dirname,
      "fixtures",
      "sidebar-overlay-runner.cjs"
    )],
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      timeout: 20000
    }
  );

  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`
  );
  assert.match(
    result.stdout,
    /SIDEBAR OVERLAY FIXTURE: PASS/
  );
});

test("offline Electron fixture validates active pane context toast behavior", () => {
  const electronPath = require("electron");
  const result = spawnSync(
    electronPath,
    [path.join(
      __dirname,
      "fixtures",
      "active-pane-toast-runner.cjs"
    )],
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      timeout: 20000
    }
  );

  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`
  );
  assert.match(
    result.stdout,
    /ACTIVE PANE TOAST FIXTURE: PASS/
  );
});

test("offline Electron fixture validates automations request lifecycle policy", () => {
  const electronPath = require("electron");
  const result = spawnSync(
    electronPath,
    [path.join(
      __dirname,
      "fixtures",
      "automations-request-runner.cjs"
    )],
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      timeout: 20000
    }
  );

  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`
  );
  assert.match(
    result.stdout,
    /AUTOMATIONS REQUEST FIXTURE: PASS/
  );
});
