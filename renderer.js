let currentState = null;

function $(selector) {
  return document.querySelector(selector);
}

function createButton(text, className) {
  const button = document.createElement("button");
  button.textContent = text;

  if (className) {
    button.className = className;
  }

  return button;
}

function renderLayoutButtons(state) {
  const buttons = document.querySelectorAll("[data-layout]");

  buttons.forEach((button) => {
    const count = Number(button.dataset.layout);
    button.classList.toggle("active", count === state.paneCount);
  });
}

function renderPaneList(state) {
  const container = $("#paneList");
  container.innerHTML = "";

  for (let i = 0; i < state.paneCount; i++) {
    const button = createButton(
      i === state.activePaneIndex ? `窗格 ${i + 1}｜目前` : `窗格 ${i + 1}`,
      "pane-button"
    );

    if (i === state.activePaneIndex) {
      button.classList.add("active");
    }

    button.addEventListener("click", async () => {
      await window.chatgptMulti.selectPane(i);
    });

    container.appendChild(button);
  }
}

function renderSavedChats(state) {
  const container = $("#savedChatList");
  container.innerHTML = "";

  if (!state.savedChats || state.savedChats.length === 0) {
    container.className = "saved-list empty";
    container.textContent = "尚未保存對話";
    return;
  }

  container.className = "saved-list";

  state.savedChats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "saved-item";

    const label = document.createElement("div");
    label.className = "saved-label";
    label.textContent = chat.label || "未命名對話";

    const url = document.createElement("div");
    url.className = "saved-url";
    url.textContent = chat.url;

    const actions = document.createElement("div");
    actions.className = "saved-actions";

    const loadButton = createButton("載入到目前窗格");
    loadButton.addEventListener("click", async () => {
      await window.chatgptMulti.loadSavedChat(chat.id);
    });

    const deleteButton = createButton("刪除", "delete-button");
    deleteButton.addEventListener("click", async () => {
      await window.chatgptMulti.deleteSavedChat(chat.id);
    });

    actions.appendChild(loadButton);
    actions.appendChild(deleteButton);

    item.appendChild(label);
    item.appendChild(url);
    item.appendChild(actions);

    container.appendChild(item);
  });
}

function render(state) {
  currentState = state;

  renderLayoutButtons(state);
  renderPaneList(state);
  renderSavedChats(state);
}

function bindEvents() {
  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", async () => {
      const count = Number(button.dataset.layout);
      const nextState = await window.chatgptMulti.setLayout(count);
      render(nextState);
    });
  });

  $("#newChatButton").addEventListener("click", async () => {
    const state = await window.chatgptMulti.newChatActive();
    render(state);
  });

  $("#reloadActiveButton").addEventListener("click", async () => {
    const state = await window.chatgptMulti.reloadActive();
    render(state);
  });

  $("#reloadAllButton").addEventListener("click", async () => {
    const state = await window.chatgptMulti.reloadAll();
    render(state);
  });

  $("#saveChatButton").addEventListener("click", async () => {
    const result = await window.chatgptMulti.saveCurrentChat();

    if (result && result.state) {
      render(result.state);
    }
  });

  window.chatgptMulti.onStateUpdated((state) => {
    render(state);
  });
}

async function init() {
  bindEvents();

  const state = await window.chatgptMulti.getState();
  render(state);
}

init();