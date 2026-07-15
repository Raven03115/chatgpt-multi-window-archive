"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "sidebar-shape-preload-v4.5.4.js"
  ),
  "utf8"
);

function hasListener(eventName, handlerName) {
  const pattern = new RegExp(
    [
      "document\\.addEventListener\\s*\\(",
      `\\s*["']${eventName}["']`,
      "\\s*,",
      `\\s*${handlerName}`,
      "\\s*,",
      "\\s*true",
      "\\s*\\)"
    ].join(""),
    "m"
  );

  return pattern.test(source);
}

test(
  "Settings synthetic outside-click handlers are not registered",
  () => {
    assert.equal(
      hasListener(
        "pointerdown",
        "handleSettingsOutsidePointerDown"
      ),
      false
    );
    assert.equal(
      hasListener(
        "pointerup",
        "handleSettingsOutsidePointerUp"
      ),
      false
    );
    assert.equal(
      hasListener(
        "click",
        "handleSettingsOutsideClick"
      ),
      false
    );
  }
);

test(
  "ordinary overlay pointer and click handlers remain registered",
  () => {
    assert.equal(
      hasListener("pointerdown", "handlePointerDown"),
      true
    );
    assert.equal(
      hasListener("pointerup", "handlePointerUp"),
      true
    );
    assert.equal(
      hasListener("click", "handleClick"),
      true
    );
  }
);
