"use strict";

const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  installExecuteJavaScriptLoadGate,
  shouldWaitForRendererLoad,
  wrapExecuteJavaScript
} = require("../lib/webcontents-execute-javascript-load-gate.cjs");

class FakeWebContents extends EventEmitter {
  constructor({ url = "", loading = false } = {}) {
    super();
    this.url = url;
    this.loading = loading;
    this.destroyed = false;
    this.calls = [];
    this.executeJavaScript = async (...args) => {
      this.calls.push(args);
      return args[0];
    };
  }

  getURL() {
    return this.url;
  }

  isLoadingMainFrame() {
    return this.loading;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

test("renderer load policy mirrors Electron executeJavaScript wait conditions", () => {
  const ready = new FakeWebContents({
    url: "https://chatgpt.com/",
    loading: false
  });
  const loading = new FakeWebContents({
    url: "https://chatgpt.com/",
    loading: true
  });
  const empty = new FakeWebContents({
    url: "",
    loading: false
  });

  assert.equal(shouldWaitForRendererLoad(ready), false);
  assert.equal(shouldWaitForRendererLoad(loading), true);
  assert.equal(shouldWaitForRendererLoad(empty), true);
});

test("concurrent executeJavaScript calls share one did-stop-loading listener", async () => {
  const webContents = new FakeWebContents({
    url: "https://chatgpt.com/c/fixture",
    loading: true
  });

  assert.equal(wrapExecuteJavaScript(webContents), true);

  const pending = Array.from(
    { length: 12 },
    (_value, index) =>
      webContents.executeJavaScript(`script-${index}`, true)
  );

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(webContents.calls.length, 0);
  assert.equal(
    webContents.listenerCount("did-stop-loading"),
    1
  );
  assert.equal(
    webContents.listenerCount("destroyed"),
    1
  );

  webContents.loading = false;
  webContents.emit("did-stop-loading");

  const results = await Promise.all(pending);

  assert.equal(webContents.calls.length, 12);
  assert.deepEqual(
    results,
    Array.from(
      { length: 12 },
      (_value, index) => `script-${index}`
    )
  );
  assert.equal(
    webContents.listenerCount("did-stop-loading"),
    0
  );
  assert.equal(
    webContents.listenerCount("destroyed"),
    0
  );
});

test("ready webContents executes immediately without load listeners", async () => {
  const webContents = new FakeWebContents({
    url: "https://chatgpt.com/c/fixture",
    loading: false
  });

  wrapExecuteJavaScript(webContents);

  const result = await webContents.executeJavaScript(
    "ready-script",
    true
  );

  assert.equal(result, "ready-script");
  assert.equal(webContents.calls.length, 1);
  assert.equal(
    webContents.listenerCount("did-stop-loading"),
    0
  );
});

test("installer wraps each created webContents only once and can detach", async () => {
  const app = new EventEmitter();
  const detach = installExecuteJavaScriptLoadGate({ app });
  const first = new FakeWebContents({
    url: "https://chatgpt.com/",
    loading: false
  });

  app.emit("web-contents-created", {}, first);
  app.emit("web-contents-created", {}, first);

  await first.executeJavaScript("first");
  assert.equal(first.calls.length, 1);

  detach();

  const second = new FakeWebContents({
    url: "https://chatgpt.com/",
    loading: false
  });
  const original = second.executeJavaScript;

  app.emit("web-contents-created", {}, second);

  assert.strictEqual(second.executeJavaScript, original);
});
