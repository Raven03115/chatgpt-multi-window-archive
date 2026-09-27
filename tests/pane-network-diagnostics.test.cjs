"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyPaneNetworkEndpoint,
  configureAutomationsRequestUserAgent,
  createPaneNetworkFailureEvent
} = require("../lib/browser-user-agent.cjs");

function details(url, overrides = {}) {
  return {
    id: 17,
    url,
    method: "GET",
    webContentsId: 7,
    resourceType: "xhr",
    statusCode: 404,
    ...overrides
  };
}

const resolveWebContentsKind = (id) =>
  id === 7 ? "pane" : "sidebar";

test("pane endpoint classifier never exposes conversation identifiers", () => {
  const id = "12345678-abcd-4321-9999-sensitive";
  const routeKind = classifyPaneNetworkEndpoint(
    `https://chatgpt.com/backend-api/conversation/${id}?foo=bar`
  );

  assert.equal(routeKind, "conversation-api");
  assert.doesNotMatch(routeKind, /12345678|sensitive|foo|bar/i);
});

test("failed conversation request emits only sanitized pane metadata", () => {
  const id = "12345678-abcd-4321-9999-sensitive";
  const event = createPaneNetworkFailureEvent(
    details(
      `https://chatgpt.com/backend-api/conversation/${id}?foo=bar`,
      { statusCode: 403 }
    ),
    {
      resolveWebContentsKind,
      networkError: false
    }
  );

  assert.deepEqual(event, {
    event: "pane-network-failure",
    pane: undefined,
    routeKind: "conversation-api",
    source: "pane-network",
    action: "failed",
    reason: "http-error",
    stage: "completed",
    method: "GET",
    resourceType: "xhr",
    webContentsKind: "pane",
    statusCode: 403,
    networkError: false,
    errorName: undefined
  });

  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /12345678|sensitive|foo|bar/i);
  assert.doesNotMatch(serialized, /https?:\/\//i);
});

test("successful and sidebar requests are not logged as pane failures", () => {
  assert.equal(
    createPaneNetworkFailureEvent(
      details("https://chatgpt.com/backend-api/conversation/fixture", {
        statusCode: 200
      }),
      { resolveWebContentsKind, networkError: false }
    ),
    null
  );

  assert.equal(
    createPaneNetworkFailureEvent(
      details("https://chatgpt.com/backend-api/conversation/fixture", {
        webContentsId: 8,
        statusCode: 500
      }),
      { resolveWebContentsKind, networkError: false }
    ),
    null
  );
});

test("network errors preserve only generic error and endpoint classification", () => {
  const event = createPaneNetworkFailureEvent(
    details("https://chatgpt.com/backend-api/conversation/fixture", {
      statusCode: undefined,
      error: "net::ERR_CONNECTION_RESET"
    }),
    {
      resolveWebContentsKind,
      networkError: true
    }
  );

  assert.equal(event.routeKind, "conversation-api");
  assert.equal(event.reason, "network-error");
  assert.equal(event.networkError, true);
  assert.equal(event.errorName, "net::ERR_CONNECTION_RESET");
});

test("shared request hook captures pane failures without enabling automations diagnostics", () => {
  const registrations = {
    before: null,
    completed: null,
    error: null
  };
  const events = [];
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders(_filter, listener) {
        registrations.before = listener;
      },
      onCompleted(filter, listener) {
        registrations.completed = { filter, listener };
      },
      onErrorOccurred(filter, listener) {
        registrations.error = { filter, listener };
      }
    }
  };

  configureAutomationsRequestUserAgent(fakeSession, {
    diagnosticsEnabled: false,
    resolveWebContentsKind,
    onEvent: (event) => events.push(event)
  });

  assert.ok(registrations.before);
  assert.deepEqual(registrations.completed.filter, {
    urls: [
      "https://chatgpt.com/backend-api/*",
      "https://chatgpt.com/api/*"
    ]
  });
  assert.deepEqual(registrations.error.filter, registrations.completed.filter);

  registrations.completed.listener(
    details("https://chatgpt.com/backend-api/conversation/fixture", {
      statusCode: 404
    })
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "pane-network-failure");
  assert.equal(events[0].statusCode, 404);
});
