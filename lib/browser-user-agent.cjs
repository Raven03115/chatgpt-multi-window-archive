"use strict";

const AUTOMATIONS_BASE_PATH = "/backend-api/automations";
const AUTOMATIONS_REQUEST_FILTER = {
  urls: [
    "https://chatgpt.com/backend-api/automations*"
  ]
};

function normalizeAutomationsRequestUserAgent(value) {
  return String(value || "")
    .replace(/(?:^|\s+)Electron\/[0-9.]+(?=\s|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyAutomationsRequest(details = {}) {
  try {
    const parsed = new URL(details.url);

    if (
      parsed.origin !== "https://chatgpt.com" ||
      (
        parsed.pathname !== AUTOMATIONS_BASE_PATH &&
        parsed.pathname !== `${AUTOMATIONS_BASE_PATH}/` &&
        !parsed.pathname.startsWith(`${AUTOMATIONS_BASE_PATH}/`)
      )
    ) {
      return {
        isAutomationsApiRequest: false,
        routeKind: "non-automations"
      };
    }

    const remainder = parsed.pathname
      .slice(AUTOMATIONS_BASE_PATH.length)
      .split("/")
      .filter(Boolean);

    return {
      isAutomationsApiRequest: true,
      routeKind: remainder.length === 0
        ? "automations-collection"
        : remainder.length === 1
          ? "automations-item"
          : "automations-item-action"
    };
  } catch {
    return {
      isAutomationsApiRequest: false,
      routeKind: "invalid"
    };
  }
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

  const classification = classifyAutomationsRequest(details);

  return (
    classification.isAutomationsApiRequest &&
    classification.routeKind === "automations-collection"
  );
}

function isSupportedAutomationsRequest(details = {}) {
  if (
    details.resourceType !== "xhr" ||
    !Number.isInteger(details.webContentsId) ||
    details.webContentsId <= 0
  ) {
    return false;
  }

  const classification = classifyAutomationsRequest(details);

  if (!classification.isAutomationsApiRequest) {
    return false;
  }

  return (
    (
      details.method === "GET" &&
      classification.routeKind === "automations-collection"
    ) ||
    (
      details.method === "POST" &&
      classification.routeKind === "automations-item"
    )
  );
}

function findUserAgentHeaderName(headers = {}) {
  return Object.keys(headers).find(
    (name) => name.toLowerCase() === "user-agent"
  ) || null;
}

function applyAutomationsRequestUserAgent(details = {}) {
  const requestHeaders = details.requestHeaders || {};
  const matchedAutomationsRequest =
    isSupportedAutomationsRequest(details);

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
  inputOptions = null
) {
  if (
    !targetSession?.webRequest ||
    typeof targetSession.webRequest.onBeforeSendHeaders !== "function"
  ) {
    throw new TypeError("A valid Electron session is required");
  }

  const options = typeof inputOptions === "function"
    ? { onDecision: inputOptions }
    : inputOptions || {};
  const diagnosticsEnabled = options.diagnosticsEnabled === true;
  const requestStates = new Map();

  function emit(event) {
    if (
      !diagnosticsEnabled ||
      typeof options.onEvent !== "function"
    ) {
      return;
    }

    try {
      options.onEvent(event);
    } catch {
      // Diagnostics must never interrupt the official page request.
    }
  }

  function resolveWebContentsKind(webContentsId) {
    if (typeof options.resolveWebContentsKind !== "function") {
      return "unknown";
    }

    try {
      const kind = options.resolveWebContentsKind(webContentsId);
      return kind === "sidebar" || kind === "pane"
        ? kind
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  function getSafeRequestState(details, decision = null) {
    const classification = classifyAutomationsRequest(details);
    const requestHeaders = details.requestHeaders || {};
    const userAgentHeaderName = findUserAgentHeaderName(requestHeaders);
    const originalUserAgent = userAgentHeaderName
      ? String(requestHeaders[userAgentHeaderName] || "")
      : "";

    return {
      event: "automations-request",
      method: String(details.method || "unknown").toUpperCase(),
      resourceType: String(details.resourceType || "unknown"),
      webContentsId: Number.isInteger(details.webContentsId)
        ? details.webContentsId
        : undefined,
      webContentsKind: resolveWebContentsKind(details.webContentsId),
      routeKind: classification.routeKind,
      originalUserAgentHasElectronToken:
        /(?:^|\s)Electron\/[0-9.]+(?=\s|$)/i.test(originalUserAgent),
      electronMarkerRemoved:
        decision?.electronMarkerRemoved === true,
      matchedAutomationsRequest:
        decision?.matchedAutomationsRequest === true
    };
  }

  targetSession.webRequest.onBeforeSendHeaders(
    AUTOMATIONS_REQUEST_FILTER,
    (details, callback) => {
      const decision =
        applyAutomationsRequestUserAgent(details);

      if (typeof options.onDecision === "function") {
        try {
          options.onDecision({
            matchedAutomationsRequest:
              decision.matchedAutomationsRequest,
            electronMarkerRemoved:
              decision.electronMarkerRemoved
          });
        } catch {
          // Diagnostics must never interrupt the official page request.
        }
      }

      if (diagnosticsEnabled) {
        const state = getSafeRequestState(details, decision);

        if (state.routeKind !== "non-automations") {
          if (Number.isInteger(details.id)) {
            requestStates.set(details.id, state);
          }

          emit({
            ...state,
            stage: "before-send-headers"
          });
        }
      }

      callback({
        requestHeaders: decision.requestHeaders
      });
    }
  );

  if (!diagnosticsEnabled) {
    return;
  }

  if (
    typeof targetSession.webRequest.onCompleted === "function"
  ) {
    targetSession.webRequest.onCompleted(
      AUTOMATIONS_REQUEST_FILTER,
      (details) => {
        const state = requestStates.get(details.id) ||
          getSafeRequestState(details);
        requestStates.delete(details.id);

        if (state.routeKind === "non-automations") {
          return;
        }

        emit({
          ...state,
          stage: "completed",
          statusCode: Number(details.statusCode),
          networkError: false
        });
      }
    );
  }

  if (
    typeof targetSession.webRequest.onErrorOccurred === "function"
  ) {
    targetSession.webRequest.onErrorOccurred(
      AUTOMATIONS_REQUEST_FILTER,
      (details) => {
        const state = requestStates.get(details.id) ||
          getSafeRequestState(details);
        requestStates.delete(details.id);

        if (state.routeKind === "non-automations") {
          return;
        }

        emit({
          ...state,
          stage: "error",
          networkError: true
        });
      }
    );
  }
}

module.exports = {
  applyAutomationsRequestUserAgent,
  classifyAutomationsRequest,
  configureAutomationsRequestUserAgent,
  isAutomationsListingRequest,
  isSupportedAutomationsRequest,
  normalizeAutomationsRequestUserAgent
};
