"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fixtureSource = fs.readFileSync(
  path.join(
    __dirname,
    "fixtures",
    "sidebar-overlay-runner.cjs"
  ),
  "utf8"
);

test(
  "Electron fixture isolates userData before app readiness",
  () => {
    const setPathIndex = fixtureSource.indexOf(
      'app.setPath("userData", fixtureUserDataPath)'
    );
    const whenReadyIndex = fixtureSource.indexOf(
      "app.whenReady()"
    );

    assert.ok(setPathIndex >= 0);
    assert.ok(whenReadyIndex > setPathIndex);
    assert.match(fixtureSource, /os\.tmpdir\(\)/);
  }
);

test(
  "Electron fixture uses one isolated partition for pane and overlay",
  () => {
    assert.match(
      fixtureSource,
      /sidebar-overlay-fixture-\$\{Date\.now\(\)\}/
    );
    assert.match(
      fixtureSource,
      /paneView\.webContents\.session === fixtureSession/
    );
    assert.match(
      fixtureSource,
      /overlayWindow\.webContents\.session === fixtureSession/
    );
  }
);

test(
  "production runtime is not modified for fixture isolation",
  () => {
    const mainSource = fs.readFileSync(
      path.join(__dirname, "..", "main.js"),
      "utf8"
    );
    const runtimeSource = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "poc-shaped-sidebar-v4.5.4.js"
      ),
      "utf8"
    );

    assert.doesNotMatch(
      mainSource,
      /CHATGPT_MULTI_WINDOW_TEST_MARKER/
    );
    assert.doesNotMatch(
      runtimeSource,
      /sidebar-overlay-fixture-/
    );
  }
);
