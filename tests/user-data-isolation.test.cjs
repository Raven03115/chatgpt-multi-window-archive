"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "fixtures",
    "sidebar-overlay-runner.cjs"
  ),
  "utf8"
);

test(
  "manual Electron fixture never uses the production userData path",
  () => {
    assert.match(
      source,
      /const fixtureUserDataPath = path\.join\(/
    );
    assert.match(source, /os\.tmpdir\(\)/);
    assert.match(
      source,
      /app\.setPath\("userData", fixtureUserDataPath\)/
    );
    assert.doesNotMatch(
      source,
      /app\.getPath\("appData"\)/
    );
  }
);
