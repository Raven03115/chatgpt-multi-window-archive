"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
  shouldUpdateSidebarWidth
} = require("../lib/sidebar-geometry.cjs");

test("sidebar width keeps the previous 260px baseline as the fallback", () => {
  assert.equal(
    normalizeSidebarWidth(Number.NaN),
    DEFAULT_SIDEBAR_WIDTH
  );
  assert.equal(DEFAULT_SIDEBAR_WIDTH, 260);
});

test("sidebar width accepts current responsive widths within the safe range", () => {
  for (const width of [240, 260, 280, 320, 360, 400]) {
    assert.equal(normalizeSidebarWidth(width, 1400), width);
  }
});

test("sidebar width is clamped to safe minimum and maximum bounds", () => {
  assert.equal(
    normalizeSidebarWidth(100, 1400),
    MIN_SIDEBAR_WIDTH
  );
  assert.equal(
    normalizeSidebarWidth(900, 1400),
    MAX_SIDEBAR_WIDTH
  );
});

test("sidebar width leaves at least the minimum pane workspace width", () => {
  assert.equal(
    normalizeSidebarWidth(420, 700),
    300
  );
  assert.equal(
    normalizeSidebarWidth(420, 600),
    MIN_SIDEBAR_WIDTH
  );
});

test("sidebar width updates only for a meaningful finite change", () => {
  assert.equal(shouldUpdateSidebarWidth(260, 320), true);
  assert.equal(shouldUpdateSidebarWidth(260, 260.4), false);
  assert.equal(shouldUpdateSidebarWidth(260, 261), true);
  assert.equal(shouldUpdateSidebarWidth(Number.NaN, 320), false);
});
