let currentState = null;

const paneCountButtons =
  document.getElementById(
    "paneCountButtons"
  );

const paneButtons =
  document.getElementById(
    "paneButtons"
  );

const statusText =
  document.getElementById(
    "statusText"
  );

const arrangeButton =
  document.getElementById(
    "arrangeButton"
  );

const lockButton =
  document.getElementById(
    "lockButton"
  );

const showAllButton =
  document.getElementById(
    "showAllButton"
  );

const hideAllButton =
  document.getElementById(
    "hideAllButton"
  );

const ratioControls =
  document.getElementById(
    "ratioControls"
  );

const ratioHint =
  document.getElementById(
    "ratioHint"
  );

const resetRatioButton =
  document.getElementById(
    "resetRatioButton"
  );

function button(
  label,
  className = ""
) {
  const element =
    document.createElement(
      "button"
    );

  element.type = "button";
  element.textContent = label;
  element.className = className;

  return element;
}

function percent(value) {
  return Math.round(
    Number(value) * 100
  );
}

function renderCounts() {
  paneCountButtons.innerHTML = "";

  for (
    let count = 1;
    count <= 6;
    count += 1
  ) {
    const item =
      button(String(count));

    item.classList.toggle(
      "active",
      currentState.paneCount ===
        count
    );

    item.addEventListener(
      "click",
      async () => {
        currentState =
          await window.workspace
            .setPaneCount(count);

        render();
      }
    );

    paneCountButtons.appendChild(
      item
    );
  }
}

function renderModes() {
  document
    .querySelectorAll(
      "[data-mode]"
    )
    .forEach((item) => {
      item.classList.toggle(
        "active",
        item.dataset.mode ===
          currentState.layoutMode
      );
    });
}

function sliderDefinition() {
  const layout =
    currentState.tiledLayout || {};

  switch (
    currentState.paneCount
  ) {
    case 1:
      return [];

    case 2:
      return [{
        key: "x1",
        label: "左欄寬度",
        value: layout.x1
      }];

    case 3:
      return [
        {
          key: "x1",
          label: "第 1 分隔線",
          value: layout.x1
        },
        {
          key: "x2",
          label: "第 2 分隔線",
          value: layout.x2
        }
      ];

    case 4:
      return [
        {
          key: "x1",
          label: "左右分隔",
          value: layout.x1
        },
        {
          key: "y1",
          label: "上下分隔",
          value: layout.y1
        }
      ];

    case 5:
      return [
        {
          key: "y1",
          label: "上下分隔",
          value: layout.y1
        },
        {
          key: "topX1",
          label: "上排分隔 1",
          value: layout.topX1
        },
        {
          key: "topX2",
          label: "上排分隔 2",
          value: layout.topX2
        },
        {
          key: "bottomX1",
          label: "下排分隔",
          value: layout.bottomX1
        }
      ];

    default:
      return [
        {
          key: "x1",
          label: "第 1 直線",
          value: layout.x1
        },
        {
          key: "x2",
          label: "第 2 直線",
          value: layout.x2
        },
        {
          key: "y1",
          label: "上下分隔",
          value: layout.y1
        }
      ];
  }
}

function renderRatios() {
  ratioControls.innerHTML = "";

  const tiled =
    currentState.layoutMode ===
    "tiled";

  resetRatioButton.disabled =
    !tiled ||
    currentState.paneCount === 1;

  if (!tiled) {
    ratioHint.textContent =
      "浮動模式會獨立保存每個視窗的位置與大小；切回並排後不會覆蓋。";

    ratioControls.textContent =
      "切換到「無重疊並排」後，可在這裡調整各欄與各列比例。";

    return;
  }

  if (
    currentState.paneCount === 1
  ) {
    ratioHint.textContent =
      "單一視窗不需要比例設定。";

    ratioControls.textContent =
      "目前使用完整工作區。";

    return;
  }

  ratioHint.textContent =
    "並排模式會固定視窗位置，使用下方比例控制大小，確保沒有重疊或空洞。";

  for (
    const definition
    of sliderDefinition()
  ) {
    const wrapper =
      document.createElement("label");

    wrapper.className =
      "slider-item";

    const label =
      document.createElement("span");

    label.className =
      "slider-label";

    label.textContent =
      definition.label;

    const input =
      document.createElement("input");

    input.type = "range";
    input.min = "10";
    input.max = "90";
    input.step = "1";
    input.value = String(
      percent(definition.value)
    );

    const value =
      document.createElement("span");

    value.className =
      "slider-value";

    value.textContent =
      `${input.value}%`;

    input.addEventListener(
      "input",
      () => {
        value.textContent =
          `${input.value}%`;
      }
    );

    input.addEventListener(
      "change",
      async () => {
        currentState =
          await window.workspace
            .setTiledLayout({
              [definition.key]:
                Number(
                  input.value
                ) / 100
            });

        render();
      }
    );

    wrapper.append(
      label,
      input,
      value
    );

    ratioControls.appendChild(
      wrapper
    );
  }
}

function renderPanes() {
  paneButtons.innerHTML = "";

  for (
    const pane
    of currentState.panes
  ) {
    const item =
      document.createElement(
        "button"
      );

    item.type = "button";
    item.className =
      "pane-button";

    item.classList.toggle(
      "visible",
      pane.visible
    );

    item.classList.toggle(
      "hidden",
      !pane.visible
    );

    item.classList.toggle(
      "current",
      pane.id ===
        currentState.activePaneId
    );

    item.title = pane.visible
      ? "點擊聚焦；按住 Shift 點擊可隱藏"
      : "點擊顯示並聚焦";

    const dot =
      document.createElement("span");

    dot.className = "dot";

    const label =
      document.createElement("span");

    label.textContent =
      `視窗 ${pane.id}`;

    item.append(
      dot,
      label
    );

    item.addEventListener(
      "click",
      async (event) => {
        if (
          event.shiftKey &&
          pane.visible
        ) {
          currentState =
            await window.workspace
              .togglePane(pane.id);
        } else if (
          pane.visible
        ) {
          currentState =
            await window.workspace
              .focusPane(pane.id);
        } else {
          currentState =
            await window.workspace
              .togglePane(pane.id);
        }

        render();
      }
    );

    paneButtons.appendChild(
      item
    );
  }
}

function renderStatus() {
  const visibleCount =
    currentState.panes.filter(
      (pane) => pane.visible
    ).length;

  const tiled =
    currentState.layoutMode ===
    "tiled";

  const mode = tiled
    ? "無重疊並排"
    : "自由浮動";

  const locked =
    !tiled &&
    currentState.layoutLocked
      ? "｜已鎖定"
      : "";

  statusText.textContent =
    `${mode}${locked}` +
    `｜顯示 ${visibleCount}/${currentState.paneCount}` +
    `｜目前視窗 ${currentState.activePaneId}`;

  lockButton.disabled = tiled;

  lockButton.textContent = tiled
    ? "並排模式已固定"
    : currentState.layoutLocked
      ? "解除浮動鎖定"
      : "鎖定浮動位置";

  lockButton.classList.toggle(
    "warning",
    !tiled &&
      currentState.layoutLocked
  );
}

function render() {
  if (!currentState) {
    return;
  }

  renderCounts();
  renderModes();
  renderRatios();
  renderPanes();
  renderStatus();
}

document
  .querySelectorAll(
    "[data-mode]"
  )
  .forEach((item) => {
    item.addEventListener(
      "click",
      async () => {
        currentState =
          await window.workspace
            .setLayoutMode(
              item.dataset.mode
            );

        render();
      }
    );
  });

arrangeButton.addEventListener(
  "click",
  async () => {
    currentState =
      await window.workspace
        .arrange();

    render();
  }
);

lockButton.addEventListener(
  "click",
  async () => {
    if (
      currentState.layoutMode ===
      "tiled"
    ) {
      return;
    }

    currentState =
      await window.workspace
        .setLayoutLocked(
          !currentState
            .layoutLocked
        );

    render();
  }
);

resetRatioButton.addEventListener(
  "click",
  async () => {
    currentState =
      await window.workspace
        .resetTiledLayout();

    render();
  }
);

showAllButton.addEventListener(
  "click",
  async () => {
    currentState =
      await window.workspace
        .showAll();

    render();
  }
);

hideAllButton.addEventListener(
  "click",
  async () => {
    currentState =
      await window.workspace
        .hideAll();

    render();
  }
);

window.workspace.onState(
  (nextState) => {
    currentState = nextState;
    render();
  }
);

(async () => {
  currentState =
    await window.workspace
      .getState();

  render();
})();
