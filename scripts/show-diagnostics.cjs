"use strict";

const fs = require("node:fs");

const {
  getRotatedLogPath,
  resolveDefaultLogPath,
  sanitizeText
} = require("../lib/diagnostics.cjs");

function parseArguments(argv) {
  let last = 100;
  let errorsOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--errors-only") {
      errorsOnly = true;
      continue;
    }

    if (argv[index] === "--last") {
      const requested = Number(argv[index + 1]);

      if (Number.isInteger(requested) && requested > 0) {
        last = Math.min(requested, 5000);
      }

      index += 1;
    }
  }

  return {
    last,
    errorsOnly
  };
}

function readJsonLines(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function formatEvent(event) {
  const safe = (value, fallback = "-") =>
    sanitizeText(value) || fallback;
  const values = [
    safe(event.timestamp),
    safe(event.event),
    Number.isFinite(event.pane)
      ? `pane=${event.pane}`
      : "pane=-",
    `route=${safe(event.routeKind)}`,
    `action=${safe(event.action)}`,
    `reason=${safe(event.reason)}`
  ];

  for (const [label, key] of [
    ["stage", "stage"],
    ["method", "method"],
    ["resource", "resourceType"],
    ["webContents", "webContentsKind"]
  ]) {
    if (event[key] !== undefined) {
      values.push(`${label}=${safe(event[key])}`);
    }
  }

  if (Number.isFinite(event.statusCode)) {
    values.push(`status=${event.statusCode}`);
  }

  for (const [label, key] of [
    ["networkError", "networkError"],
    ["uaHadElectron", "originalUserAgentHasElectronToken"],
    ["electronRemoved", "electronMarkerRemoved"],
    ["requestMatched", "matchedAutomationsRequest"]
  ]) {
    if (typeof event[key] === "boolean") {
      values.push(`${label}=${event[key]}`);
    }
  }

  if (event.errorName || event.sanitizedErrorMessage) {
    values.push(
      `error=${safe(event.errorName, "Error")}:` +
      safe(event.sanitizedErrorMessage, "")
    );
  }

  return values.join(" | ");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const logPath = resolveDefaultLogPath();
  const events = [
    ...readJsonLines(getRotatedLogPath(logPath)),
    ...readJsonLines(logPath)
  ]
    .filter((event) => !options.errorsOnly ||
      Boolean(event.errorName || event.sanitizedErrorMessage))
    .sort((left, right) =>
      String(left.timestamp).localeCompare(String(right.timestamp))
    )
    .slice(-options.last);

  if (events.length === 0) {
    console.log("No diagnostic events found.");
    console.log(`Log path: ${logPath}`);
    return;
  }

  for (const event of events) {
    console.log(formatEvent(event));
  }
}

main();
