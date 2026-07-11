"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDiagnosticsLogger,
  getRotatedLogPath,
  resolveDefaultLogPath,
  sanitizeText
} = require("../lib/diagnostics.cjs");

function createTempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "chatgpt-multi-diagnostics-")
  );
}

test("sanitizeText removes URLs, route IDs, email, tokens, UUIDs, query, and hash", () => {
  const original = [
    "https://chatgpt.com/c/conversation-secret?email=user@example.com#private",
    "/g/g-p-project-secret/c/conversation-secret",
    "Bearer abcdefghijklmnopqrstuvwxyz012345",
    "token=abcdefghijklmnopqrstuvwxyz012345",
    "opaqueSecretValue123456789012345678901234",
    "123e4567-e89b-12d3-a456-426614174000"
  ].join(" ");
  const sanitized = sanitizeText(original);

  for (const secret of [
    "conversation-secret",
    "project-secret",
    "user@example.com",
    "abcdefghijklmnopqrstuvwxyz012345",
    "opaqueSecretValue123456789012345678901234",
    "123e4567-e89b-12d3-a456-426614174000",
    "https://"
  ]) {
    assert.equal(sanitized.includes(secret), false, secret);
  }
});

test("logger writes JSONL with allowed fields only", (t) => {
  const directory = createTempDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "integration-events.jsonl");
  const logger = createDiagnosticsLogger({
    logPath,
    clock: () => new Date("2026-07-12T00:00:00.000Z")
  });

  assert.equal(logger.log({
    event: "pane-load",
    pane: 2,
    routeKind: "conversation",
    source: "anchor-intent",
    action: "started",
    reason: "test",
    stage: "load",
    elapsedMs: 12,
    errorName: "Error",
    sanitizedErrorMessage:
      "failed https://chatgpt.com/c/private-id?token=secret",
    url: "https://chatgpt.com/c/must-not-be-written",
    authorization: "Bearer must-not-be-written"
  }), true);

  const record = JSON.parse(
    fs.readFileSync(logPath, "utf8").trim()
  );

  assert.deepEqual(Object.keys(record), [
    "timestamp",
    "event",
    "routeKind",
    "source",
    "action",
    "reason",
    "stage",
    "errorName",
    "sanitizedErrorMessage",
    "pane",
    "elapsedMs"
  ]);
  assert.equal(JSON.stringify(record).includes("private-id"), false);
  assert.equal(Object.hasOwn(record, "url"), false);
  assert.equal(Object.hasOwn(record, "authorization"), false);
});

test("sanitizer preserves non-sensitive diagnostic reason names", () => {
  assert.equal(
    sanitizeText("workspace-route-without-intent"),
    "workspace-route-without-intent"
  );
});

test("logger rotates current log to .1 without exceeding the configured current-file limit", (t) => {
  const directory = createTempDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "integration-events.jsonl");
  const logger = createDiagnosticsLogger({
    logPath,
    maxBytes: 260
  });

  for (let index = 0; index < 6; index += 1) {
    assert.equal(logger.log({
      event: "rotation-test",
      action: "recorded",
      reason: `event-${index}`
    }), true);
  }

  assert.equal(fs.existsSync(logPath), true);
  assert.equal(fs.existsSync(getRotatedLogPath(logPath)), true);
  assert.ok(fs.statSync(logPath).size <= 260);
});

test("logger failures never throw into the application", () => {
  const failingFs = {
    mkdirSync() {
      throw new Error("permission denied");
    }
  };
  const logger = createDiagnosticsLogger({
    logPath: path.join("X:", "unavailable", "events.jsonl"),
    fsModule: failingFs
  });

  assert.doesNotThrow(() => {
    assert.equal(logger.log({ event: "failure-test" }), false);
  });
});

test("default Windows log path matches the application userData convention", () => {
  assert.equal(
    resolveDefaultLogPath({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming"
      },
      homedir: "C:\\Users\\tester"
    }),
    path.join(
      "C:\\Users\\tester\\AppData\\Roaming",
      "chatgpt-multi-window",
      "logs",
      "integration-events.jsonl"
    )
  );
});

test("diagnostics command sanitizes displayed fields defensively", (t) => {
  const directory = createTempDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logDirectory = path.join(directory, "logs");
  const logPath = path.join(logDirectory, "integration-events.jsonl");

  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(
    logPath,
    `${JSON.stringify({
      timestamp: "2026-07-12T00:00:00.000Z",
      event: "unsafe-event",
      routeKind: "conversation",
      action: "failed",
      reason:
        "https://chatgpt.com/c/private-conversation?email=user@example.com"
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "scripts", "show-diagnostics.cjs")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CHATGPT_MULTI_WINDOW_USER_DATA: directory
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("private-conversation"), false);
  assert.equal(result.stdout.includes("user@example.com"), false);
  assert.equal(result.stdout.includes("https://"), false);
});
