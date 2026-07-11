"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_STRING_LENGTH = 1000;

const STRING_FIELDS = [
  "event",
  "routeKind",
  "source",
  "action",
  "reason",
  "stage",
  "errorName",
  "sanitizedErrorMessage"
];

const NUMBER_FIELDS = [
  "pane",
  "elapsedMs"
];

function sanitizeText(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  let sanitized = String(value);

  sanitized = sanitized
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[email]"
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(
      /\/g\/g-p-[^/\s?#]+/gi,
      "/g/g-p-[redacted]"
    )
    .replace(/\/c\/[^/\s?#]+/gi, "/c/[redacted]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[uuid]"
    )
    .replace(
      /\b(?:authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]"
    )
    .replace(
      /\b(?:[0-9a-f]{24,}|(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+)\b/gi,
      "[long-id]"
    )
    .replace(/[?#][^\s]*/g, "[query-or-hash-redacted]");

  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH)}…`;
  }

  return sanitized;
}

function getRotatedLogPath(logPath) {
  return logPath.endsWith(".jsonl")
    ? `${logPath.slice(0, -6)}.1.jsonl`
    : `${logPath}.1`;
}

function resolveDefaultLogPath(options = {}) {
  const {
    app,
    env = process.env,
    platform = process.platform,
    homedir = os.homedir()
  } = options;

  let userDataPath = env.CHATGPT_MULTI_WINDOW_USER_DATA;

  if (!userDataPath && app?.getPath) {
    try {
      userDataPath = app.getPath("userData");
    } catch {
      userDataPath = undefined;
    }
  }

  if (!userDataPath) {
    if (platform === "win32") {
      userDataPath = path.join(
        env.APPDATA || path.join(homedir, "AppData", "Roaming"),
        "chatgpt-multi-window"
      );
    } else if (platform === "darwin") {
      userDataPath = path.join(
        homedir,
        "Library",
        "Application Support",
        "chatgpt-multi-window"
      );
    } else {
      userDataPath = path.join(
        env.XDG_CONFIG_HOME || path.join(homedir, ".config"),
        "chatgpt-multi-window"
      );
    }
  }

  return path.join(
    userDataPath,
    "logs",
    "integration-events.jsonl"
  );
}

function createRecord(event, clock) {
  let now;

  try {
    now = clock();
  } catch {
    now = new Date();
  }

  const date = now instanceof Date
    ? now
    : new Date(now);
  const timestamp = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();

  const record = {
    timestamp
  };

  for (const field of STRING_FIELDS) {
    const sanitized = sanitizeText(event?.[field]);

    if (sanitized !== undefined && sanitized !== "") {
      record[field] = sanitized;
    }
  }

  for (const field of NUMBER_FIELDS) {
    const numeric = Number(event?.[field]);

    if (Number.isFinite(numeric)) {
      record[field] = numeric;
    }
  }

  return record;
}

function createDiagnosticsLogger(options = {}) {
  const fsModule = options.fsModule || fs;
  const logPath = options.logPath ||
    resolveDefaultLogPath(options);
  const rotatedLogPath = getRotatedLogPath(logPath);
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(1, options.maxBytes)
    : DEFAULT_MAX_BYTES;
  const clock = options.clock || (() => new Date());

  function rotateIfNeeded(incomingBytes) {
    let currentBytes = 0;

    try {
      currentBytes = fsModule.statSync(logPath).size;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    if (currentBytes + incomingBytes <= maxBytes) {
      return;
    }

    try {
      fsModule.rmSync(rotatedLogPath, {
        force: true
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    if (currentBytes > 0) {
      fsModule.renameSync(
        logPath,
        rotatedLogPath
      );
    }
  }

  function log(event) {
    try {
      const record = createRecord(event, clock);
      const line = `${JSON.stringify(record)}\n`;
      const incomingBytes = Buffer.byteLength(line, "utf8");

      fsModule.mkdirSync(path.dirname(logPath), {
        recursive: true
      });
      rotateIfNeeded(incomingBytes);
      fsModule.appendFileSync(logPath, line, "utf8");

      return true;
    } catch {
      return false;
    }
  }

  return {
    log,
    logPath,
    rotatedLogPath
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  createDiagnosticsLogger,
  getRotatedLogPath,
  resolveDefaultLogPath,
  sanitizeText
};
