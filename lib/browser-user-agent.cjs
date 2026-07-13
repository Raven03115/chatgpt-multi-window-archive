"use strict";

function normalizeAutomationsRequestUserAgent(value) {
  return String(value || "")
    .replace(/(?:^|\s+)Electron\/[0-9.]+(?=\s|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAutomationsListingRequest(details = {}) {
  if (
    details.method !== "GET" ||
    details.resourceType !== "xhr" ||
    !Number.isInteger(details.webContentsId) ||
    details.webContentsId <= 0
  ) {
    return false;
  }

  try {
    const parsed = new URL(details.url);

    return (
      parsed.origin === "https://chatgpt.com" &&
      (
        parsed.pathname === "/backend-api/automations" ||
        parsed.pathname === "/backend-api/automations/"
      )
    );
  } catch {
    return false;
  }
}

function findUserAgentHeaderName(headers = {}) {
  return Object.keys(headers).find(
    (name) => name.toLowerCase() === "user-agent"
  ) || null;
}

function applyAutomationsRequestUserAgent(details = {}) {
  const requestHeaders = details.requestHeaders || {};
  const matchedAutomationsRequest =
    isAutomationsListingRequest(details);

  if (!matchedAutomationsRequest) {
    return {
      requestHeaders,
      matchedAutomationsRequest: false,
      electronMarkerRemoved: false
    };
  }

  const userAgentHeaderName =
    findUserAgentHeaderName(requestHeaders);

  if (!userAgentHeaderName) {
    return {
      requestHeaders,
      matchedAutomationsRequest: true,
      electronMarkerRemoved: false
    };
  }

  const originalUserAgent =
    requestHeaders[userAgentHeaderName];
  const normalizedUserAgent =
    normalizeAutomationsRequestUserAgent(
      originalUserAgent
    );
  const electronMarkerRemoved =
    normalizedUserAgent !== originalUserAgent;

  return {
    requestHeaders: electronMarkerRemoved
      ? {
          ...requestHeaders,
          [userAgentHeaderName]: normalizedUserAgent
        }
      : requestHeaders,
    matchedAutomationsRequest: true,
    electronMarkerRemoved
  };
}

function configureAutomationsRequestUserAgent(
  targetSession,
  onDecision = null
) {
  if (
    !targetSession?.webRequest ||
    typeof targetSession.webRequest.onBeforeSendHeaders !== "function"
  ) {
    throw new TypeError("A valid Electron session is required");
  }

  targetSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://chatgpt.com/backend-api/automations*"
      ]
    },
    (details, callback) => {
      const decision =
        applyAutomationsRequestUserAgent(details);

      if (typeof onDecision === "function") {
        try {
          onDecision({
            matchedAutomationsRequest:
              decision.matchedAutomationsRequest,
            electronMarkerRemoved:
              decision.electronMarkerRemoved
          });
        } catch {
          // Diagnostics must never interrupt the official page request.
        }
      }

      callback({
        requestHeaders: decision.requestHeaders
      });
    }
  );
}

module.exports = {
  applyAutomationsRequestUserAgent,
  configureAutomationsRequestUserAgent,
  isAutomationsListingRequest,
  normalizeAutomationsRequestUserAgent
};
