"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  attachGoogleAuthUserAgentCompatibility,
  isChatGptAuthCompletionUrl,
  isGoogleAccountsUrl,
  normalizeGoogleAuthUserAgent
} = require("../lib/google-auth-user-agent.cjs");

const ELECTRON_UA =
  "Mozilla/5.0 Chrome/150.0.0.0 Electron/43.1.0 Safari/537.36";
const NORMALIZED_UA =
  "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36";

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.userAgent = ELECTRON_UA;
    this.userAgents = [];
    this.loadedUrls = [];
  }

  getUserAgent() {
    return this.userAgent;
  }

  setUserAgent(value) {
    this.userAgent = value;
    this.userAgents.push(value);
  }

  loadURL(url) {
    this.loadedUrls.push(url);
    return Promise.resolve();
  }
}

test("normalizes only the Electron token", () => {
  assert.equal(
    normalizeGoogleAuthUserAgent(ELECTRON_UA),
    NORMALIZED_UA
  );
  assert.equal(
    normalizeGoogleAuthUserAgent(NORMALIZED_UA),
    NORMALIZED_UA
  );
});

test("classifies only Google Accounts URLs", () => {
  assert.equal(
    isGoogleAccountsUrl(
      "https://accounts.google.com/o/oauth2/v2/auth"
    ),
    true
  );
  assert.equal(
    isGoogleAccountsUrl(
      "https://chatgpt.com/auth/login"
    ),
    false
  );
  assert.equal(isGoogleAccountsUrl("invalid"), false);
});

test("restores the original UA only after ChatGPT auth completion", () => {
  assert.equal(
    isChatGptAuthCompletionUrl(
      "https://chatgpt.com/auth/callback/google"
    ),
    false
  );
  assert.equal(
    isChatGptAuthCompletionUrl(
      "https://chatgpt.com/"
    ),
    true
  );
  assert.equal(
    isChatGptAuthCompletionUrl(
      "https://accounts.google.com/"
    ),
    false
  );
});

test("restarts the first Google main-frame navigation with compatible UA", async () => {
  const webContents = new FakeWebContents();
  const controller =
    attachGoogleAuthUserAgentCompatibility(webContents);

  let prevented = false;

  webContents.emit(
    "will-navigate",
    {
      preventDefault() {
        prevented = true;
      }
    },
    "https://accounts.google.com/o/oauth2/v2/auth",
    false,
    true
  );

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.equal(controller.isActive(), true);
  assert.deepEqual(
    webContents.userAgents,
    [NORMALIZED_UA]
  );
  assert.deepEqual(
    webContents.loadedUrls,
    ["https://accounts.google.com/o/oauth2/v2/auth"]
  );

  webContents.emit(
    "did-navigate",
    {},
    "https://chatgpt.com/"
  );

  assert.equal(controller.isActive(), false);
  assert.deepEqual(
    webContents.userAgents,
    [NORMALIZED_UA, ELECTRON_UA]
  );
});

test("does not intercept non-main-frame or non-Google navigation", () => {
  const webContents = new FakeWebContents();

  attachGoogleAuthUserAgentCompatibility(webContents);

  let prevented = false;
  const event = {
    preventDefault() {
      prevented = true;
    }
  };

  webContents.emit(
    "will-navigate",
    event,
    "https://accounts.google.com/o/oauth2/v2/auth",
    false,
    false
  );

  webContents.emit(
    "will-navigate",
    event,
    "https://chatgpt.com/",
    false,
    true
  );

  assert.equal(prevented, false);
  assert.deepEqual(webContents.userAgents, []);
  assert.deepEqual(webContents.loadedUrls, []);
});

test("production integration enables scoped Google auth compatibility without an environment flag", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "poc-shaped-sidebar-v4.5.4.js"
    ),
    "utf8"
  );

  assert.equal(
    source.includes("CHATGPT_GOOGLE_AUTH_COMPAT"),
    false
  );
  assert.match(
    source,
    /require\("\.\/lib\/google-auth-user-agent\.cjs"\)/
  );
  assert.match(
    source,
    /attachGoogleAuthUserAgentCompatibility\(\s*view\.webContents\s*\)/
  );
  assert.match(
    source,
    /attachGoogleAuthUserAgentCompatibility\(\s*sidebarOverlayWindow\.webContents\s*\)/
  );
});
