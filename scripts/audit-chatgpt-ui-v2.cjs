"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPORT_NAME = "chatgpt-multi-pane-ui-audit.json";
const SOURCE_USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "chatgpt-multi-window"
);
const SOURCE_PARTITION = path.join(
  SOURCE_USER_DATA,
  "Partitions",
  "chatgpt-shared"
);
const TEMP_APPDATA_ROOT = path.join(
  os.tmpdir(),
  `chatgpt-multi-ui-audit-appdata-${process.pid}`
);
const TEMP_USER_DATA = path.join(
  TEMP_APPDATA_ROOT,
  "chatgpt-multi-window"
);
const TEMP_PARTITION = path.join(
  TEMP_USER_DATA,
  "Partitions",
  "chatgpt-shared"
);
const AUDIT_SCRIPT = path.join(
  __dirname,
  "audit-chatgpt-ui.cjs"
);
const REPORT_PATH = path.join(
  os.homedir(),
  "Desktop",
  REPORT_NAME
);

const EXCLUDED_NAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Crashpad",
  "blob_storage",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket"
]);

function fail(message) {
  throw new Error(message);
}

function shouldCopy(sourcePath) {
  const name = path.basename(sourcePath);

  if (EXCLUDED_NAMES.has(name)) {
    return false;
  }

  const lower = name.toLowerCase();

  if (
    lower === "lock" ||
    lower.endsWith(".lock") ||
    lower.endsWith(".tmp")
  ) {
    return false;
  }

  return true;
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) {
    return false;
  }

  fs.mkdirSync(path.dirname(destination), {
    recursive: true
  });

  const stat = fs.statSync(source);

  if (stat.isDirectory()) {
    fs.cpSync(source, destination, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: shouldCopy
    });
  } else {
    fs.copyFileSync(source, destination);
  }

  return true;
}

function cleanup() {
  try {
    fs.rmSync(TEMP_APPDATA_ROOT, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 250
    });
  } catch (error) {
    console.error(
      `[UI Audit v2] temp cleanup warning: ${error.message}`
    );
  }
}

function loadReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(REPORT_PATH, "utf8")
    );
  } catch {
    return null;
  }
}

try {
  console.log("ChatGPT Multi Pane UI compatibility audit v2");
  console.log(
    "This run uses a temporary copy of the existing ChatGPT session profile."
  );
  console.log(
    "The formal profile is read only and is not modified by the audit."
  );
  console.log("");

  if (!fs.existsSync(AUDIT_SCRIPT)) {
    fail(`Audit script not found: ${AUDIT_SCRIPT}`);
  }

  if (!fs.existsSync(SOURCE_USER_DATA)) {
    fail(`Formal userData not found: ${SOURCE_USER_DATA}`);
  }

  if (!fs.existsSync(SOURCE_PARTITION)) {
    fail(
      `Formal ChatGPT partition not found: ${SOURCE_PARTITION}`
    );
  }

  cleanup();
  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });

  copyIfExists(
    path.join(SOURCE_USER_DATA, "Local State"),
    path.join(TEMP_USER_DATA, "Local State")
  );

  copyIfExists(
    SOURCE_PARTITION,
    TEMP_PARTITION
  );

  if (!fs.existsSync(TEMP_PARTITION)) {
    fail("Temporary ChatGPT partition copy was not created.");
  }

  try {
    fs.unlinkSync(REPORT_PATH);
  } catch {
    // No previous report to remove.
  }

  const result = spawnSync(
    process.execPath,
    [AUDIT_SCRIPT],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      shell: false,
      windowsHide: false,
      env: {
        ...process.env,
        APPDATA: TEMP_APPDATA_ROOT
      }
    }
  );

  if (result.error) {
    fail(`Audit could not start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Audit exited with code ${result.status}`);
  }

  const report = loadReport();

  if (!report) {
    fail(`Audit report not found or invalid: ${REPORT_PATH}`);
  }

  const initialUrl = String(report?.initial?.url || "");
  const finalUrl = String(report?.final?.url || "");
  const loginSeen =
    initialUrl.includes("/auth/login") ||
    finalUrl.includes("/auth/login");

  if (loginSeen) {
    fail(
      "The copied profile still opened ChatGPT logged out. " +
      "Do not use this report for compatibility conclusions."
    );
  }

  console.log("");
  console.log("UI AUDIT V2: AUTH SESSION OK");
  console.log(`Report: ${REPORT_PATH}`);
} catch (error) {
  console.error("");
  console.error("UI AUDIT V2: FAILED");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  cleanup();
}
