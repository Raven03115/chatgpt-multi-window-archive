"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyAutomationsRequestUserAgent,
  classifyAutomationsRequest,
  isSupportedAutomationsRequest
} = require("../lib/browser-user-agent.cjs");

const ORIGINAL_USER_AGENT =
  "Mozilla/5.0 Chrome/150.0.7871.47 " +
  "Safari/537.36 Electron/43.1.0";

function requestDetails(url, overrides = {}) {
  return {
    id: 501,
    url,
    method: "GET",
    webContentsId: 7,
    resourceType: "xhr",
    requestHeaders: {
      "User-Agent": ORIGINAL_USER_AGENT,
      Cookie: "session=unchanged",
      Authorization: "Bearer unchanged"
    },
    ...overrides
  };
}

test("observed scheduled-task result GET is a supported automation detail action", () => {
  const details = requestDetails(
    "https://chatgpt.com/backend-api/automation/fixture-item-id/result"
  );
  const classification = classifyAutomationsRequest(details);

  assert.equal(classification.isAutomationsApiRequest, true);
  assert.equal(classification.routeKind, "automation-detail-action");
  assert.equal(isSupportedAutomationsRequest(details), true);

  const decision = applyAutomationsRequestUserAgent(details);

  assert.equal(decision.matchedAutomationsRequest, true);
  assert.equal(decision.electronMarkerRemoved, true);
  assert.doesNotMatch(
    decision.requestHeaders["User-Agent"],
    /Electron\/[0-9.]+/i
  );
  assert.equal(
    decision.requestHeaders.Cookie,
    details.requestHeaders.Cookie
  );
  assert.equal(
    decision.requestHeaders.Authorization,
    details.requestHeaders.Authorization
  );
});

test("automation detail actions remain limited to observed GET requests", () => {
  const postDetails = requestDetails(
    "https://chatgpt.com/backend-api/automation/fixture-item-id/result",
    { method: "POST" }
  );
  const pluralAction = requestDetails(
    "https://chatgpt.com/backend-api/automations/fixture-item-id/action"
  );

  assert.equal(isSupportedAutomationsRequest(postDetails), false);
  assert.equal(isSupportedAutomationsRequest(pluralAction), false);

  for (const details of [postDetails, pluralAction]) {
    const decision = applyAutomationsRequestUserAgent(details);

    assert.equal(decision.matchedAutomationsRequest, false);
    assert.equal(decision.electronMarkerRemoved, false);
    assert.strictEqual(decision.requestHeaders, details.requestHeaders);
    assert.match(
      decision.requestHeaders["User-Agent"],
      /Electron\/43\.1\.0/i
    );
  }
});
