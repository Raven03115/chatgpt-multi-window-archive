"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
  path.join(root, "poc-shaped-sidebar-v4.5.4.js"),
  "utf8"
);
const preloadSource = fs.readFileSync(
  path.join(root, "sidebar-shape-preload-v4.5.4.js"),
  "utf8"
);
const routePolicySource = fs.readFileSync(
  path.join(root, "lib", "route-policy.cjs"),
  "utf8"
);

test("main process uses measured sidebar width for pane and overlay geometry", () => {
  assert.match(
    mainSource,
    /let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;/
  );
  assert.match(
    mainSource,
    /content\.width - sidebarWidth/
  );
  assert.match(
    mainSource,
    /x: sidebarWidth \+ left/
  );
  assert.match(
    mainSource,
    /"chatgpt-sidebar-width-changed"/
  );
  assert.match(
    mainSource,
    /normalizeSidebarWidth\(/
  );
});

test("sidebar preload measures official responsive sidebar geometry", () => {
  assert.match(
    preloadSource,
    /function measureSidebarWidth\(\)/
  );
  assert.match(
    preloadSource,
    /--sidebar-width/
  );
  assert.match(
    preloadSource,
    /#stage-slideover-sidebar/
  );
  assert.match(
    preloadSource,
    /"chatgpt-sidebar-width-changed"/
  );
  assert.match(
    preloadSource,
    /let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;/
  );
});

test("non-anchor role links are eligible explicit sidebar actions", () => {
  assert.match(
    preloadSource,
    /\[role="link"\]/
  );
  assert.match(
    routePolicySource,
    /"role-link"/
  );
});

test("fixed 260px sidebar token is no longer used as runtime geometry", () => {
  assert.doesNotMatch(
    mainSource,
    /\bSIDEBAR_WIDTH\b/
  );
  assert.doesNotMatch(
    preloadSource,
    /\bSIDEBAR_WIDTH\b/
  );
});
