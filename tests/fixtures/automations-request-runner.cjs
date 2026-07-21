"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const {
  configureAutomationsRequestUserAgent
} = require("../../lib/browser-user-agent.cjs");

const ORIGINAL_USER_AGENT =
  "Mozilla/5.0 Chrome/150.0.7871.47 " +
  "Safari/537.36 Electron/43.1.0";

function createFakeSession() {
  const listeners = {};

  return {
    listeners,
    session: {
      webRequest: {
        onBeforeSendHeaders(filter, listener) {
          listeners.before = { filter, listener };
        },
        onCompleted(filter, listener) {
          listeners.completed = { filter, listener };
        },
        onErrorOccurred(filter, listener) {
          listeners.error = { filter, listener };
        }
      }
    }
  };
}

function createDetails(id, overrides = {}) {
  return {
    id,
    url:
      "https://chatgpt.com/backend-api/automations/" +
      `fixture-item-${id}`,
    method: "POST",
    resourceType: "xhr",
    webContentsId: 8,
    requestHeaders: {
      "User-Agent": ORIGINAL_USER_AGENT,
      Cookie: "fixture=unchanged",
      Authorization: "Bearer fixture-unchanged",
      "X-Fixture": "unchanged"
    },
    uploadData: [{ bytes: Buffer.from("fixture-body") }],
    ...overrides
  };
}

function dispatchBefore(listener, details) {
  let callbackCount = 0;
  let callbackResult = null;

  listener(details, (result) => {
    callbackCount += 1;
    callbackResult = result;
  });

  assert.equal(callbackCount, 1);
  assert.ok(callbackResult);
  return callbackResult;
}

async function run() {
  const events = [];
  const { session, listeners } = createFakeSession();

  configureAutomationsRequestUserAgent(session, {
    diagnosticsEnabled: true,
    resolveWebContentsKind: () => "pane",
    onEvent: (event) => events.push(event)
  });

  assert.ok(listeners.before);
  assert.ok(listeners.completed);
  assert.ok(listeners.error);

  const listing = createDetails(1, {
    url: "https://chatgpt.com/backend-api/automations?limit=20",
    method: "GET"
  });
  const listingResult = dispatchBefore(
    listeners.before.listener,
    listing
  );
  assert.doesNotMatch(
    listingResult.requestHeaders["User-Agent"],
    /Electron\/[0-9.]+/i
  );
  listeners.completed.listener({ ...listing, statusCode: 200 });

  for (const id of [2, 3, 4, 5]) {
    const writeRequest = createDetails(id);
    const result = dispatchBefore(
      listeners.before.listener,
      writeRequest
    );

    assert.doesNotMatch(
      result.requestHeaders["User-Agent"],
      /Electron\/[0-9.]+/i
    );
    assert.equal(
      result.requestHeaders.Cookie,
      writeRequest.requestHeaders.Cookie
    );
    assert.equal(
      result.requestHeaders.Authorization,
      writeRequest.requestHeaders.Authorization
    );
    assert.equal(result.requestHeaders["X-Fixture"], "unchanged");
    assert.equal(writeRequest.method, "POST");
    assert.equal(writeRequest.uploadData[0].bytes.toString(), "fixture-body");

    listeners.completed.listener({
      ...writeRequest,
      statusCode: 200
    });
  }

  const unsupported = createDetails(6, {
    url:
      "https://chatgpt.com/backend-api/automations/" +
      "fixture-item-6/action"
  });
  const unsupportedResult = dispatchBefore(
    listeners.before.listener,
    unsupported
  );
  assert.strictEqual(
    unsupportedResult.requestHeaders,
    unsupported.requestHeaders
  );
  assert.match(
    unsupportedResult.requestHeaders["User-Agent"],
    /Electron\/43\.1\.0/
  );

  const failed = createDetails(7);
  dispatchBefore(listeners.before.listener, failed);
  listeners.error.listener({
    ...failed,
    error: "net::ERR_FIXTURE_PRIVATE"
  });

  const safeEvents = JSON.stringify(events);
  assert.equal(safeEvents.includes("fixture-body"), false);
  assert.equal(safeEvents.includes("fixture-unchanged"), false);
  assert.equal(safeEvents.includes("ERR_FIXTURE_PRIVATE"), false);
  assert.equal(
    events.filter((event) =>
      event.stage === "completed" &&
      event.statusCode === 200
    ).length,
    5
  );
  assert.equal(events.at(-1).stage, "error");
  assert.equal(events.at(-1).networkError, true);

  const failingLoggerSession = createFakeSession();
  configureAutomationsRequestUserAgent(
    failingLoggerSession.session,
    {
      diagnosticsEnabled: true,
      onEvent() {
        throw new Error("fixture logger unavailable");
      }
    }
  );
  const loggerFailureResult = dispatchBefore(
    failingLoggerSession.listeners.before.listener,
    createDetails(8)
  );
  assert.doesNotMatch(
    loggerFailureResult.requestHeaders["User-Agent"],
    /Electron\/[0-9.]+/i
  );

  console.log("AUTOMATIONS REQUEST FIXTURE: PASS");
}

const fixtureUserData = fs.mkdtempSync(path.join(
  os.tmpdir(),
  "chatgpt-multi-window-automations-fixture-"
));
app.setPath("userData", fixtureUserData);

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error?.stack || String(error));
    app.exit(1);
  });

app.on("quit", () => {
  fs.rmSync(fixtureUserData, { recursive: true, force: true });
});
