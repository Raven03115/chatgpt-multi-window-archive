"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPaneContextSignature,
  createPaneDisplayContext,
  extractConversationId,
  getActivePaneContextToastScript,
  getRemoveActivePaneContextToastScript,
  normalizePaneDisplayTitle,
  shouldShowPaneContextToast
} = require("../lib/active-pane-context.cjs");

const integrationSource = fs.readFileSync(
  path.join(__dirname, "..", "poc-shaped-sidebar-v4.5.4.js"),
  "utf8"
);
const sidebarPreloadSource = fs.readFileSync(
  path.join(__dirname, "..", "sidebar-shape-preload-v4.5.4.js"),
  "utf8"
);

test("extracts a conversation ID from an ordinary conversation URL", () => {
  assert.equal(
    extractConversationId("https://chatgpt.com/c/conversation-123"),
    "conversation-123"
  );
});

test("extracts a conversation ID from a Project conversation URL", () => {
  assert.equal(
    extractConversationId(
      "https://chatgpt.com/g/g-p-project-123/c/conversation-456"
    ),
    "conversation-456"
  );
});

test("invalid URLs have no conversation ID", () => {
  assert.equal(extractConversationId("not a URL"), null);
});

test("removes an exact ChatGPT title prefix", () => {
  assert.equal(
    normalizePaneDisplayTitle("ChatGPT - Research dashboard"),
    "Research dashboard"
  );
});

test("removes an exact ChatGPT title suffix", () => {
  assert.equal(
    normalizePaneDisplayTitle("Research dashboard | ChatGPT"),
    "Research dashboard"
  );
});

test("removes an exact ChatGPT pipe prefix", () => {
  assert.equal(
    normalizePaneDisplayTitle("ChatGPT | Research dashboard"),
    "Research dashboard"
  );
});

test("does not remove ChatGPT from the middle of a legitimate title", () => {
  assert.equal(
    normalizePaneDisplayTitle("Using ChatGPT for research"),
    "Using ChatGPT for research"
  );
});

test("removes control characters from titles", () => {
  assert.equal(
    normalizePaneDisplayTitle("Quarterly\u0000\u0007 report"),
    "Quarterly report"
  );
});

test("limits titles to 120 Unicode code points", () => {
  const result = normalizePaneDisplayTitle("測".repeat(140));
  assert.equal(Array.from(result).length, 120);
});

test("new-chat route uses the new conversation fallback", () => {
  assert.equal(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 2,
      url: "https://chatgpt.com/",
      title: "ChatGPT"
    }).displayTitle,
    "新對話"
  );
});

test("conversation route without a usable title uses the conversation fallback", () => {
  assert.equal(
    createPaneDisplayContext({
      paneIndex: 2,
      paneCount: 6,
      url: "https://chatgpt.com/c/conversation-123",
      title: "ChatGPT"
    }).displayTitle,
    "目前對話"
  );
});

test("GPT routes use the GPT fallback", () => {
  assert.equal(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 4,
      url: "https://chatgpt.com/g/g-custom-gpt",
      title: "ChatGPT"
    }).displayTitle,
    "GPT"
  );
});

test("Project workspace routes use the Project fallback", () => {
  assert.equal(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 4,
      url: "https://chatgpt.com/g/g-p-project-123/project",
      title: "ChatGPT"
    }).displayTitle,
    "Project"
  );
});

test("invalid URLs use a safe current-page fallback", () => {
  const context = createPaneDisplayContext({
    paneIndex: 1,
    paneCount: 2,
    url: "invalid",
    title: ""
  });
  assert.equal(context.routeKind, "invalid");
  assert.equal(context.displayTitle, "目前頁面");
});

test("context includes pane and route identity in its signature", () => {
  const context = createPaneDisplayContext({
    paneIndex: 1,
    paneCount: 4,
    url: "https://chatgpt.com/c/conversation-123",
    title: "Research"
  });
  assert.equal(context.paneIndex, 1);
  assert.equal(context.paneCount, 4);
  assert.equal(context.conversationId, "conversation-123");
  assert.equal(
    context.signature,
    buildPaneContextSignature(context)
  );
});

test("identical display contexts have identical signatures", () => {
  const input = {
    paneIndex: 0,
    paneCount: 2,
    url: "https://chatgpt.com/c/conversation-123",
    title: "Research"
  };
  assert.equal(
    createPaneDisplayContext(input).signature,
    createPaneDisplayContext(input).signature
  );
});

test("a changed pane index changes the signature", () => {
  const base = {
    paneCount: 2,
    url: "https://chatgpt.com/c/conversation-123",
    title: "Research"
  };
  assert.notEqual(
    createPaneDisplayContext({ ...base, paneIndex: 0 }).signature,
    createPaneDisplayContext({ ...base, paneIndex: 1 }).signature
  );
});

test("navigation to another conversation changes the signature", () => {
  const base = { paneIndex: 0, paneCount: 2, title: "Research" };
  assert.notEqual(
    createPaneDisplayContext({
      ...base,
      url: "https://chatgpt.com/c/conversation-a"
    }).signature,
    createPaneDisplayContext({
      ...base,
      url: "https://chatgpt.com/c/conversation-b"
    }).signature
  );
});

test("title wrapper changes do not change the signature", () => {
  const base = {
    paneIndex: 0,
    paneCount: 2,
    url: "https://chatgpt.com/c/conversation-a"
  };
  assert.equal(
    createPaneDisplayContext({
      ...base,
      title: "ChatGPT - Research"
    }).signature,
    createPaneDisplayContext({
      ...base,
      title: "Research | ChatGPT"
    }).signature
  );
});

test("a formal title replacing new conversation changes the signature", () => {
  const base = {
    paneIndex: 0,
    paneCount: 2,
    url: "https://chatgpt.com/"
  };
  assert.notEqual(
    createPaneDisplayContext({ ...base, title: "ChatGPT" }).signature,
    createPaneDisplayContext({ ...base, title: "Formal title" }).signature
  );
});

test("same signature does not show again", () => {
  assert.equal(
    shouldShowPaneContextToast({
      signature: "same",
      lastSignature: "same",
      userInitiated: true,
      suppressed: false,
      viewUsable: true
    }),
    false
  );
});

test("a changed active context shows", () => {
  assert.equal(
    shouldShowPaneContextToast({
      signature: "pane-b",
      lastSignature: "pane-a",
      userInitiated: true,
      suppressed: false,
      viewUsable: true
    }),
    true
  );
});

test("startup without user interaction does not show", () => {
  assert.equal(
    shouldShowPaneContextToast({
      signature: "initial",
      lastSignature: "",
      userInitiated: false,
      suppressed: false,
      viewUsable: true
    }),
    false
  );
});

test("overlay suppression prevents display", () => {
  assert.equal(
    shouldShowPaneContextToast({
      signature: "settings",
      lastSignature: "",
      userInitiated: true,
      suppressed: true,
      viewUsable: true
    }),
    false
  );
});

test("destroyed views are safely rejected", () => {
  assert.equal(
    shouldShowPaneContextToast({
      signature: "destroyed",
      lastSignature: "",
      userInitiated: true,
      suppressed: false,
      viewUsable: false
    }),
    false
  );
});

test("toast script uses textContent and never innerHTML", () => {
  const script = getActivePaneContextToastScript(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 2,
      url: "https://chatgpt.com/c/conversation-a",
      title: "Research"
    })
  );
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
});

test("toast script is non-interactive", () => {
  const script = getActivePaneContextToastScript(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 2,
      url: "https://chatgpt.com/c/conversation-a",
      title: "Research"
    })
  );
  assert.match(script, /pointerEvents\s*=\s*["']none["']/);
  assert.match(script, /top\s*=\s*["']24px["']/);
  assert.match(script, /left\s*=\s*["']50%["']/);
  assert.match(script, /transform\s*=\s*["']translateX\(-50%\)["']/);
  assert.doesNotMatch(script, /translate\(-50%, -50%\)/);
  assert.doesNotMatch(script, /\.focus\s*\(/);
  assert.doesNotMatch(script, /\.click\s*\(/);
  assert.doesNotMatch(script, /scrollIntoView/);
});

test("toast script replaces the existing element and clears timers", () => {
  const script = getActivePaneContextToastScript(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 2,
      url: "https://chatgpt.com/c/conversation-a",
      title: "Research"
    })
  );
  assert.match(script, /clearTimeout/);
  assert.match(script, /existing\.remove\(\)/);
});

test("toast removal script clears timers and removes the DOM", () => {
  const script = getRemoveActivePaneContextToastScript();
  assert.match(script, /clearTimeout/);
  assert.match(script, /\.remove\(\)/);
});

test("toast script does not modify sidebar or accessibility selection state", () => {
  const script = getActivePaneContextToastScript(
    createPaneDisplayContext({
      paneIndex: 0,
      paneCount: 2,
      url: "https://chatgpt.com/c/conversation-a",
      title: "Research"
    })
  );
  assert.doesNotMatch(script, /aria-current/);
  assert.doesNotMatch(script, /aria-selected/);
  assert.doesNotMatch(script, /Escape/);
});

test("production imports the shared active pane context module", () => {
  assert.match(
    integrationSource,
    /require\("\.\/lib\/active-pane-context\.cjs"\)/
  );
});

test("production listens for title updates without a MutationObserver", () => {
  assert.match(integrationSource, /"page-title-updated"/);
  assert.doesNotMatch(
    integrationSource,
    /active-pane-context[\s\S]{0,500}MutationObserver/
  );
});

test("overlay transitions clear pane context toasts", () => {
  assert.match(
    integrationSource,
    /isPaneContextToastSuppressed\(\)[\s\S]{0,100}clearAllPaneContextToasts\(\)/
  );
});

test("actual active pane changes request a forced latest toast", () => {
  assert.match(
    integrationSource,
    /activePaneIndex !== previousActivePaneIndex[\s\S]{0,600}requestActivePaneContextToast\(\{[\s\S]{0,100}force: true/
  );
});

test("sidebar preload remains free of pane toast behavior", () => {
  assert.doesNotMatch(
    sidebarPreloadSource,
    /chatgpt-multi-pane-context-toast|active-pane-context/
  );
});
