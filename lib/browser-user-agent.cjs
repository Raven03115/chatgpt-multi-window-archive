"use strict";

const AUTOMATIONS_BASE_PATH = "/backend-api/automations";
const AUTOMATION_DETAIL_BASE_PATH = "/backend-api/automation";
const AUTOMATIONS_REQUEST_FILTER = {
  urls: [
    "https://chatgpt.com/backend-api/automations*",
    "https://chatgpt.com/backend-api/automation*"
  ]
};
const PANE_NETWORK_DIAGNOSTIC_FILTER = {
  urls: [
    "https://chatgpt.com/backend-api/*",
    "https://chatgpt.com/api/*"
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

    if (parsed.origin !== "https://chatgpt.com") {
      return {
        isAutomationsApiRequest: false,
        routeKind: "non-automations"
      };
    }

    if (
      parsed.pathname === AUTOMATIONS_BASE_PATH ||
      parsed.pathname === `${AUTOMATIONS_BASE_PATH}/` ||
      parsed.pathname.startsWith(`${AUTOMATIONS_BASE_PATH}/`)
    ) {
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
    }

    if (
      parsed.pathname.startsWith(
        `${AUTOMATION_DETAIL_BASE_PATH}/`
      )
    ) {
      const remainder = parsed.pathname
        .slice(AUTOMATION_DETAIL_BASE_PATH.length)
        .split("/")
        .filter(Boolean);

      return {
        isAutomationsApiRequest: true,
        routeKind: remainder.length === 1
          ? "automation-detail-item"
          : "automation-detail-action"
      };
    }

    return {
      isAutomationsApiRequest: false,
      routeKind: "non-automations"
    };
  } catch {
    return {
      isAutomationsApiRequest: false,
      routeKind: "invalid"
    };
  }
}

function classifyPaneNetworkEndpoint(value) {
  try {
    const parsed = new URL(value);

    if (parsed.origin !== "https://chatgpt.com") {
      return "non-chatgpt";
    }

    const pathName = parsed.pathname.toLowerCase();

    if (
      pathName === "/backend-api/conversation" ||
      pathName.startsWith("/backend-api/conversation/")
    ) {
      return "conversation-api";
    }

    if (
      pathName === "/backend-api/conversations" ||
      pathName.startsWith("/backend-api/conversations/")
    ) {
      return "conversations-api";
    }

    if (
      pathName === "/backend-api/project" ||
      pathName.startsWith("/backend-api/project/") ||
      pathName === "/backend-api/projects" ||
      pathName.startsWith("/backend-api/projects/")
    ) {
      return "project-api";
    }

    if (
      pathName === "/backend-api/gizmo" ||
      pathName.startsWith("/backend-api/gizmo/") ||
      pathName === "/backend-api/gizmos" ||
      pathName.startsWith("/backend-api/gizmos/")
    ) {
      return "gizmo-api";
    }

    if (pathName.startsWith("/backend-api/")) {
      return "backend-api-other";
    }

    if (pathName.startsWith("/api/")) {
      return "api-other";
    }

    return "non-diagnostic";
  } catch {
    return "invalid";
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
      (
        classification.routeKind === "automations-collection" ||
        classification.routeKind === "automation-detail-item"
      )
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

function createPaneNetworkFailureEvent(
  details = {},
  options = {}
) {
  const routeKind = classifyPaneNetworkEndpoint(details.url);

  if (
    routeKind === "non-chatgpt" ||
    routeKind === "non-diagnostic" ||
    routeKind === "invalid"
  ) {
    return null;
  }

  const resolveWebContentsKind =
    options.resolveWebContentsKind;
  let webContentsKind = "unknown";

  if (typeof resolveWebContentsKind === "function") {
    try {
      const resolved = resolveWebContentsKind(details.webContentsId);
      if (resolved === "pane" || resolved === "sidebar") {
        webContentsKind = resolved;
      }
    } catch {
      webContentsKind = "unknown";
    }
  }

  if (webContentsKind !== "pane") {
    return null;
  }

  const networkError = options.networkError === true;
  const statusCode = Number(details.statusCode);

  if (
    !networkError &&
    !(Number.isFinite(statusCode) && statusCode >= 400)
  ) {
    return null;
  }

  let pane;

  if (typeof options.resolvePaneNumber === "function") {
    try {
      const resolvedPane =
        Number(options.resolvePaneNumber(details.webContentsId));

      if (Number.isInteger(resolvedPane) && resolvedPane > 0) {
        pane = resolvedPane;
      }
    } catch {
      pane = undefined;
    }
  }

  return {
    event: "pane-network-failure",
    pane,
    routeKind,
    source: "pane-network",
    action: "failed",
    reason: networkError ? "network-error" : "http-error",
    stage: networkError ? "error" : "completed",
    method: String(details.method || "unknown").toUpperCase(),
    resourceType: String(details.resourceType || "unknown"),
    webContentsKind: "pane",
    statusCode: Number.isFinite(statusCode)
      ? statusCode
      : undefined,
    networkError,
    errorName: networkError
      ? String(details.error || "network-error")
      : undefined
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
  const paneNetworkDiagnosticsEnabled =
    options.paneNetworkDiagnosticsEnabled === true ||
    (
      options.paneNetworkDiagnosticsEnabled !== false &&
      typeof options.onEvent === "function" &&
      typeof options.resolveWebContentsKind === "function"
    );
  const requestStates = new Map();

  function emit(event) {
    if (typeof options.onEvent !== "function") {
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

  if (!diagnosticsEnabled && !paneNetworkDiagnosticsEnabled) {
    return;
  }

  const completionFilter = paneNetworkDiagnosticsEnabled
    ? PANE_NETWORK_DIAGNOSTIC_FILTER
    : AUTOMATIONS_REQUEST_FILTER;

  if (
    typeof targetSession.webRequest.onCompleted === "function"
  ) {
    targetSession.webRequest.onCompleted(
      completionFilter,
      (details) => {
        if (diagnosticsEnabled) {
          const state = requestStates.get(details.id) ||
            getSafeRequestState(details);
          requestStates.delete(details.id);

          if (state.routeKind !== "non-automations") {
            emit({
              ...state,
              stage: "completed",
              statusCode: Number(details.statusCode),
              networkError: false
            });
          }
        }

        if (paneNetworkDiagnosticsEnabled) {
          const event = createPaneNetworkFailureEvent(
            details,
            {
              resolveWebContentsKind:
                options.resolveWebContentsKind,
              resolvePaneNumber:
                options.resolvePaneNumber,
              networkError: false
            }
          );

          if (event) {
            emit(event);
          }
        }
      }
    );
  }

  if (
    typeof targetSession.webRequest.onErrorOccurred === "function"
  ) {
    targetSession.webRequest.onErrorOccurred(
      completionFilter,
      (details) => {
        if (diagnosticsEnabled) {
          const state = requestStates.get(details.id) ||
            getSafeRequestState(details);
          requestStates.delete(details.id);

          if (state.routeKind !== "non-automations") {
            emit({
              ...state,
              stage: "error",
              networkError: true
            });
          }
        }

        if (paneNetworkDiagnosticsEnabled) {
          const event = createPaneNetworkFailureEvent(
            details,
            {
              resolveWebContentsKind:
                options.resolveWebContentsKind,
              resolvePaneNumber:
                options.resolvePaneNumber,
              networkError: true
            }
          );

          if (event) {
            emit(event);
          }
        }
      }
    );
  }
}

module.exports = {
  applyAutomationsRequestUserAgent,
  classifyAutomationsRequest,
  classifyPaneNetworkEndpoint,
  configureAutomationsRequestUserAgent,
  createPaneNetworkFailureEvent,
  isAutomationsListingRequest,
  isSupportedAutomationsRequest,
  normalizeAutomationsRequestUserAgent
};
