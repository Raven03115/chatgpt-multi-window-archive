"use strict";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_PANE_WORKSPACE_WIDTH = 400;

function normalizeSidebarWidth(
  value,
  workspaceWidth = Number.POSITIVE_INFINITY
) {
  const numericValue = Number(value);
  const numericWorkspaceWidth = Number(workspaceWidth);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  const workspaceLimitedMaximum =
    Number.isFinite(numericWorkspaceWidth)
      ? Math.max(
          MIN_SIDEBAR_WIDTH,
          numericWorkspaceWidth - MIN_PANE_WORKSPACE_WIDTH
        )
      : MAX_SIDEBAR_WIDTH;

  const maximum = Math.min(
    MAX_SIDEBAR_WIDTH,
    workspaceLimitedMaximum
  );

  return Math.round(
    Math.min(
      maximum,
      Math.max(MIN_SIDEBAR_WIDTH, numericValue)
    )
  );
}

function shouldUpdateSidebarWidth(currentWidth, nextWidth) {
  return (
    Number.isFinite(Number(currentWidth)) &&
    Number.isFinite(Number(nextWidth)) &&
    Math.abs(Number(currentWidth) - Number(nextWidth)) >= 1
  );
}

module.exports = {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_PANE_WORKSPACE_WIDTH,
  MIN_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
  shouldUpdateSidebarWidth
};
