"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyAutomationsRequestUserAgent,
  configureAutomationsRequestUserAgent,
  normalizeAutomationsRequestUserAgent
} = require("../lib/browser-user-agent.cjs");

const ORIGINAL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 Chrome/150.0.7871.47 " +
  "Safari/537.36 Electron/43.1.0";

function requestDetails(url, overrides = {}) {
  return {
    id: 1,
    url,
    method: "GET",
    webContentsId: 7,
    resourceType: "xhr",
    referrer: "https://chatgpt.com/scheduled",
    requestHeaders: {
      "User-Agent": ORIGINAL_USER_AGENT,
      Cookie: "session=unchanged",
      Authorization: "Bearer unchanged",
      "X-Fixture": "unchanged"
    },
    uploadData: [{ bytes: Buffer.from("unchanged") }],
    ...overrides
  };
}

function assertUnchanged(details) {
  const decision = applyAutomationsRequestUserAgent(details);

  assert.equal(decision.matchedAutomationsRequest, false);
  assert.equal(decision.electronMarkerRemoved, false);
  assert.strictEqual(decision.requestHeaders, details.requestHeaders);
  assert.equal(
    decision.requestHeaders["User-Agent"],
    ORIGINAL_USER_AGENT
  );
}

test("ordinary ChatGPT main-frame request retains the Electron UA", () => {
  assertUnchanged(requestDetails("https://chatgpt.com/", {
    resourceType: "mainFrame"
  }));
});

test("Settings and Upgrade document or XHR requests retain the Electron UA", () => {
  for (const details of [
    requestDetails("https://chatgpt.com/?settings=1", {
      resourceType: "mainFrame"
    }),
    requestDetails("https://chatgpt.com/backend-api/settings"),
    requestDetails("https://chatgpt.com/upgrade", {
      resourceType: "mainFrame"
    }),
    requestDetails("https://chatgpt.com/backend-api/subscriptions")
  ]) {
    assertUnchanged(details);
  }
});

test("only automations listing removes the Electron product marker", () => {
  for (const url of [
    "https://chatgpt.com/backend-api/automations",
    "https://chatgpt.com/backend-api/automations/",
    "https://chatgpt.com/backend-api/automations?limit=20"
  ]) {
    const details = requestDetails(url);
    const decision = applyAutomationsRequestUserAgent(details);

    assert.equal(decision.matchedAutomationsRequest, true);
    assert.equal(decision.electronMarkerRemoved, true);
    assert.equal(
      decision.requestHeaders["User-Agent"],
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 Chrome/150.0.7871.47 Safari/537.36"
    );
  }
});

test("other backend requests and non-page requests retain the original UA", () => {
  for (const details of [
    requestDetails("https://chatgpt.com/backend-api/conversations"),
    requestDetails("https://chatgpt.com/backend-api/automations/jobs"),
    requestDetails("https://example.com/backend-api/automations"),
    requestDetails("https://chatgpt.com:444/backend-api/automations"),
    requestDetails("https://chatgpt.com/backend-api/automations", {
      method: "POST"
    }),
    requestDetails("https://chatgpt.com/backend-api/automations", {
      resourceType: "mainFrame"
    }),
    requestDetails("https://chatgpt.com/backend-api/automations", {
      webContentsId: undefined
    }),
    requestDetails("https://chatgpt.com/backend-api/automations", {
      webContentsId: -1
    })
  ]) {
    assertUnchanged(details);
  }
});

test("automations policy preserves URL method body cookie and all other headers", () => {
  const details = requestDetails(
    "https://chatgpt.com/backend-api/automations?limit=20"
  );
  const original = {
    url: details.url,
    method: details.method,
    uploadData: details.uploadData,
    cookie: details.requestHeaders.Cookie,
    authorization: details.requestHeaders.Authorization,
    fixture: details.requestHeaders["X-Fixture"]
  };
  const decision = applyAutomationsRequestUserAgent(details);

  assert.equal(details.url, original.url);
  assert.equal(details.method, original.method);
  assert.strictEqual(details.uploadData, original.uploadData);
  assert.match(
    details.requestHeaders["User-Agent"],
    /Electron\/43\.1\.0/
  );
  assert.equal(decision.requestHeaders.Cookie, original.cookie);
  assert.equal(
    decision.requestHeaders.Authorization,
    original.authorization
  );
  assert.equal(decision.requestHeaders["X-Fixture"], original.fixture);
});

test("shared session installs one composable request-header listener", () => {
  const registrations = [];
  const diagnostics = [];
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders(filter, listener) {
        registrations.push({ filter, listener });
      }
    }
  };

  configureAutomationsRequestUserAgent(
    fakeSession,
    (decision) => diagnostics.push(decision)
  );

  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].filter, {
    urls: ["https://chatgpt.com/backend-api/automations*"]
  });

  let callbackResult = null;
  registrations[0].listener(
    requestDetails("https://chatgpt.com/backend-api/automations"),
    (result) => {
      callbackResult = result;
    }
  );

  assert.doesNotMatch(
    callbackResult.requestHeaders["User-Agent"],
    /Electron\/[0-9.]+/i
  );
  assert.deepEqual(diagnostics, [{
    matchedAutomationsRequest: true,
    electronMarkerRemoved: true
  }]);
});

test("diagnostics failure cannot interrupt the automations request", () => {
  let listener = null;
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders(_filter, nextListener) {
        listener = nextListener;
      }
    }
  };
  let callbackResult = null;

  configureAutomationsRequestUserAgent(
    fakeSession,
    () => {
      throw new Error("diagnostics unavailable");
    }
  );
  listener(
    requestDetails("https://chatgpt.com/backend-api/automations"),
    (result) => {
      callbackResult = result;
    }
  );

  assert.doesNotMatch(
    callbackResult.requestHeaders["User-Agent"],
    /Electron\/[0-9.]+/i
  );
});

test("automations UA normalization is idempotent and changes no browser tokens", () => {
  const expected =
    "Mozilla/5.0 Chrome/150.0.7871.47 Safari/537.36";

  assert.equal(
    normalizeAutomationsRequestUserAgent(
      `${expected} Electron/43.1.0`
    ),
    expected
  );
  assert.equal(
    normalizeAutomationsRequestUserAgent(expected),
    expected
  );
});

test("production keeps the shared partition and has no global UA override", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "poc-shaped-sidebar-v4.5.4.js"),
    "utf8"
  );
  const sharedPartitionUses = source.match(
    /partition: CHATGPT_PARTITION/g
  ) || [];

  assert.match(
    source,
    /const CHATGPT_PARTITION = "persist:chatgpt-shared";/
  );
  assert.equal(sharedPartitionUses.length, 2);
  assert.doesNotMatch(source, /\.setUserAgent\s*\(/);
  assert.doesNotMatch(source, /webContents\.setUserAgent\s*\(/);
  assert.match(
    source,
    /configureAutomationsRequestUserAgent\s*\(/
  );
});
