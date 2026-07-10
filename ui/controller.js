let currentState = null;

const paneCountButtons = document.getElementById("paneCountButtons");
const paneButtons = document.getElementById("paneButtons");
const statusText = document.getElementById("statusText");
const arrangeButton = document.getElementById("arrangeButton");
const lockButton = document.getElementById("lockButton");
const showAllButton = document.getElementById("showAllButton");
const hideAllButton = document.getElementById("hideAllButton");

function button(label, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  return element;
}

function renderCounts() {
  paneCountButtons.innerHTML = "";

  for (let count = 1; count <= 6; count += 1) {
    const item = button(String(count));
    item.classList.toggle("active", currentState.paneCount === count);
    item.addEventListener("click", async () => {
      currentState = await window.workspace.setPaneCount(count);
      render();
    });
    paneCountButtons.appendChild(item);
  }
}

function renderModes() {
  document.querySelectorAll("[data-mode]").forEach((item) => {
    item.classList.toggle("active", item.dataset.mode === currentState.layoutMode);
  });
}

function renderPanes() {
  paneButtons.innerHTML = "";

  for (const pane of currentState.panes) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "pane-button";
    item.classList.toggle("visible", pane.visible);
    item.classList.toggle("hidden", !pane.visible);
    item.classList.toggle("current", pane.id === currentState.activePaneId);
    item.title = pane.visible
      ? "點擊聚焦；按住 Shift 點擊可隱藏"
      : "點擊顯示並聚焦";

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.textContent = `視窗 ${pane.id}`;

    item.append(dot, label);

    item.addEventListener("click", async (event) => {
      if (event.shiftKey && pane.visible) {
        currentState = await window.workspace.togglePane(pane.id);
      } else if (pane.visible) {
        currentState = await window.workspace.focusPane(pane.id);
      } else {
        currentState = await window.workspace.togglePane(pane.id);
      }
      render();
    });

    paneButtons.appendChild(item);
  }
}

function renderStatus() {
  const visibleCount = currentState.panes.filter((pane) => pane.visible).length;
  const mode = currentState.layoutMode === "tiled" ? "自動並排" : "自由浮動";
  const locked = currentState.layoutLocked ? "｜已鎖定" : "";

  statusText.textContent =
    `${mode}${locked}｜顯示 ${visibleCount}/${currentState.paneCount}` +
    `｜目前視窗 ${currentState.activePaneId}`;

  lockButton.textContent = currentState.layoutLocked ? "解除鎖定" : "鎖定位置";
  lockButton.classList.toggle("warning", currentState.layoutLocked);
}

function render() {
  if (!currentState) return;
  renderCounts();
  renderModes();
  renderPanes();
  renderStatus();
}

document.querySelectorAll("[data-mode]").forEach((item) => {
  item.addEventListener("click", async () => {
    currentState = await window.workspace.setLayoutMode(item.dataset.mode);
    render();
  });
});

arrangeButton.addEventListener("click", async () => {
  currentState = await window.workspace.arrange();
  render();
});

lockButton.addEventListener("click", async () => {
  currentState = await window.workspace.setLayoutLocked(!currentState.layoutLocked);
  render();
});

showAllButton.addEventListener("click", async () => {
  currentState = await window.workspace.showAll();
  render();
});

hideAllButton.addEventListener("click", async () => {
  currentState = await window.workspace.hideAll();
  render();
});

window.workspace.onState((nextState) => {
  currentState = nextState;
  render();
});

(async () => {
  currentState = await window.workspace.getState();
  render();
})();
