"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyAutomationsRequest,
  configureAutomationsRequestUserAgent
} = require("../lib/browser-user-agent.cjs");

const ORIGINAL_USER_AGENT =
  "Mozilla/5.0 Chrome/150.0.7871.47 " +
  "Safari/537.36 Electron/43.1.0";

function createDetails(overrides = {}) {
  return {
    id: 41,
    url:
      "https://chatgpt.com/backend-api/automations/" +
      "automation-secret-id?private=query-secret",
    method: "POST",
    resourceType: "xhr",
    webContentsId: 9,
    requestHeaders: {
      "User-Agent": ORIGINAL_USER_AGENT,
      Cookie: "session=secret-cookie",
      Authorization: "Bearer secret-token",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/scheduled"
    },
    uploadData: [{ bytes: Buffer.from("secret-body") }],
    ...overrides
  };
}

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

test("automations path classification never exposes IDs or query", () => {
  const collection = classifyAutomationsRequest(createDetails({
    url: "https://chatgpt.com/backend-api/automations?limit=20",
    method: "GET"
  }));
  const item = classifyAutomationsRequest(createDetails({
    url:
      "https://chatgpt.com/backend-api/automations/" +
      "automation-secret-id?private=query-secret"
  }));
  const action = classifyAutomationsRequest(createDetails({
    url:
      "https://chatgpt.com/backend-api/automations/" +
      "automation-secret-id/pause?private=query-secret"
  }));

  assert.equal(collection.routeKind, "automations-collection");
  assert.equal(item.routeKind, "automations-item");
  assert.equal(action.routeKind, "automations-item-action");

  for (const result of [collection, item, action]) {
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("automation-secret-id"), false);
    assert.equal(serialized.includes("query-secret"), false);
    assert.equal(Object.hasOwn(result, "url"), false);
  }
});

test("diagnostics records a normalized POST item request that completes successfully", () => {
  const { session, listeners } = createFakeSession();
  const events = [];

  configureAutomationsRequestUserAgent(session, {
    diagnosticsEnabled: true,
    resolveWebContentsKind: (id) => id === 9 ? "sidebar" : "unknown",
    onEvent: (event) => events.push(event)
  });

  assert.ok(listeners.before);
  assert.ok(listeners.completed);
  assert.ok(listeners.error);

  const details = createDetails();
  let callbackCount = 0;
  let callbackResult = null;

  listeners.before.listener(details, (result) => {
    callbackCount += 1;
    callbackResult = result;
  });
  listeners.completed.listener({
    ...details,
    statusCode: 200
  });

  assert.equal(callbackCount, 1);
  assert.notStrictEqual(callbackResult.requestHeaders, details.requestHeaders);
  assert.doesNotMatch(
    callbackResult.requestHeaders["User-Agent"],
    /Electron\/43\.1\.0/
  );
  assert.deepEqual(events.map((event) => event.stage), [
    "before-send-headers",
    "completed"
  ]);
  assert.equal(events[0].method, "POST");
  assert.equal(events[0].resourceType, "xhr");
  assert.equal(events[0].webContentsId, 9);
  assert.equal(events[0].webContentsKind, "sidebar");
  assert.equal(events[0].routeKind, "automations-item");
  assert.equal(events[0].originalUserAgentHasElectronToken, true);
  assert.equal(events[0].electronMarkerRemoved, true);
  assert.equal(events[0].matchedAutomationsRequest, true);
  assert.equal(events[1].statusCode, 200);
  assert.equal(events[1].networkError, false);

  const serialized = JSON.stringify(events);
  for (const secret of [
    "automation-secret-id",
    "query-secret",
    "secret-cookie",
    "secret-token",
    "secret-body"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  for (const forbidden of [
    "url",
    "requestHeaders",
    "uploadData",
    "Cookie",
    "Authorization",
    "Origin",
    "Referer"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("network errors are recorded without exposing the error payload", () => {
  const { session, listeners } = createFakeSession();
  const events = [];

  configureAutomationsRequestUserAgent(session, {
    diagnosticsEnabled: true,
    resolveWebContentsKind: () => "pane",
    onEvent: (event) => events.push(event)
  });

  const details = createDetails({ id: 73, webContentsId: 12 });
  listeners.before.listener(details, () => {});
  listeners.error.listener({
    ...details,
    error: "net::ERR_SECRET_PRIVATE"
  });

  assert.equal(events.at(-1).stage, "error");
  assert.equal(events.at(-1).networkError, true);
  assert.equal(events.at(-1).webContentsKind, "pane");
  assert.equal(
    JSON.stringify(events).includes("ERR_SECRET_PRIVATE"),
    false
  );
});

test("disabled diagnostics installs no completion or error observers", () => {
  const { session, listeners } = createFakeSession();

  configureAutomationsRequestUserAgent(session, {
    diagnosticsEnabled: false,
    onEvent() {
      throw new Error("must not run");
    }
  });

  assert.ok(listeners.before);
  assert.equal(listeners.completed, undefined);
  assert.equal(listeners.error, undefined);
});
