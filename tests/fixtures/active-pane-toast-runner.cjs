"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const {
  app,
  BrowserWindow,
  WebContentsView,
  session
} = require("electron");
const {
  createPaneDisplayContext,
  getActivePaneContextToastScript,
  getRemoveActivePaneContextToastScript,
  shouldShowPaneContextToast
} = require("../../lib/active-pane-context.cjs");

const fixtureUserDataPath = path.join(
  os.tmpdir(),
  `chatgpt-multi-window-active-pane-toast-${process.pid}`
);

app.setPath("userData", fixtureUserDataPath);

let workspaceWindow = null;
const paneViews = [];
let lastContext = null;
let activePaneIndex = 0;
let unhandledRejectionCount = 0;

process.on("unhandledRejection", () => {
  unhandledRejectionCount += 1;
});

function paneDocument(label) {
  return `<!doctype html>
    <html>
      <body style="margin:0;min-height:1800px;background:#212121;color:#fff">
        <input id="fixture-input" aria-label="fixture input">
        <button id="fixture-button">${label}</button>
        <div style="height:1500px"></div>
        <script>
          window.fixtureButtonClicks = 0;
          document.getElementById("fixture-button").addEventListener(
            "click",
            () => { window.fixtureButtonClicks += 1; }
          );
        </script>
      </body>
    </html>`;
}

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isUsableView(view) {
  return Boolean(
    view &&
    view.webContents &&
    !view.webContents.isDestroyed()
  );
}

async function removeAllToasts() {
  await Promise.all(
    paneViews
      .filter(isUsableView)
      .map((view) =>
        view.webContents.executeJavaScript(
          getRemoveActivePaneContextToastScript(),
          true
        )
      )
  );
}

async function showContext(index, input, options = {}) {
  const view = paneViews[index];
  const context = createPaneDisplayContext({
    paneIndex: index,
    paneCount: 2,
    ...input
  });
  const shouldShow = shouldShowPaneContextToast({
    signature: context.signature,
    lastSignature: options.force
      ? ""
      : lastContext?.signature || "",
    userInitiated: options.userInitiated === true,
    suppressed: options.suppressed === true,
    viewUsable: isUsableView(view)
  });

  if (!shouldShow) {
    if (options.suppressed) {
      await removeAllToasts();
    }

    return false;
  }

  activePaneIndex = index;
  await removeAllToasts();
  await view.webContents.executeJavaScript(
    getActivePaneContextToastScript(context),
    true
  );
  lastContext = context;
  return true;
}

async function inspectToast(view) {
  return view.webContents.executeJavaScript(`
    (() => {
      const toast = document.getElementById(
        "chatgpt-multi-pane-context-toast"
      );

      if (!toast) {
        return { exists: false };
      }

      const rect = toast.getBoundingClientRect();
      const style = getComputedStyle(toast);
      return {
        exists: true,
        text: toast.textContent,
        count: document.querySelectorAll(
          "#chatgpt-multi-pane-context-toast"
        ).length,
        pointerEvents: style.pointerEvents,
        position: style.position,
        left: toast.style.left,
        top: toast.style.top,
        rectTop: rect.top,
        centerX: rect.left + rect.width / 2,
        viewportWidth: document.documentElement.clientWidth,
        titleOverflow: toast.lastElementChild?.style.textOverflow || ""
      };
    })()
  `, true);
}

async function run() {
  await app.whenReady();

  const partition = `active-pane-toast-fixture-${Date.now()}`;
  session.fromPartition(partition);

  workspaceWindow = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      partition,
      backgroundThrottling: false
    }
  });

  for (let index = 0; index < 2; index += 1) {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        backgroundThrottling: false
      }
    });
    workspaceWindow.contentView.addChildView(view);
    view.setBounds({
      x: index * 440,
      y: 0,
      width: 440,
      height: 560
    });
    paneViews.push(view);
    await view.webContents.loadURL(
      dataUrl(paneDocument(`pane-${index + 1}`))
    );
  }

  const paneA = {
    url: "https://chatgpt.com/c/conversation-a",
    title: "ChatGPT - Conversation A"
  };
  const paneB = {
    url: "https://chatgpt.com/c/conversation-b",
    title: "Conversation B | ChatGPT"
  };

  assert.equal(
    await showContext(0, paneA, { userInitiated: false }),
    false,
    "startup displayed a toast without user interaction"
  );

  lastContext = createPaneDisplayContext({
    paneIndex: 0,
    paneCount: 2,
    ...paneA
  });
  assert.equal(
    await showContext(0, paneA, { userInitiated: true }),
    false,
    "same active pane displayed a duplicate toast"
  );

  await paneViews[1].webContents.executeJavaScript(
    'document.getElementById("fixture-input").focus()',
    true
  );
  assert.equal(
    await showContext(1, paneB, { userInitiated: true, force: true }),
    true,
    "switching to pane B did not display a toast"
  );

  const paneBToast = await inspectToast(paneViews[1]);
  assert.equal(paneBToast.exists, true);
  assert.equal(paneBToast.count, 1);
  assert.match(paneBToast.text, /窗格 2 \/ 2/);
  assert.match(paneBToast.text, /Conversation B/);
  assert.equal(paneBToast.pointerEvents, "none");
  assert.equal(paneBToast.position, "fixed");
  assert.equal(paneBToast.left, "50%");
  assert.equal(paneBToast.top, "24px");
  assert.ok(
    Math.abs(paneBToast.centerX - paneBToast.viewportWidth / 2) < 2
  );
  assert.ok(Math.abs(paneBToast.rectTop - 24) < 2);
  assert.equal(
    await paneViews[1].webContents.executeJavaScript(
      'document.activeElement?.id === "fixture-input"',
      true
    ),
    true,
    "toast stole input focus"
  );
  assert.equal(
    (await inspectToast(paneViews[0])).exists,
    false,
    "inactive pane retained a toast"
  );

  await showContext(0, paneA, { userInitiated: true, force: true });
  await showContext(1, paneB, { userInitiated: true, force: true });
  await showContext(0, paneA, { userInitiated: true, force: true });
  assert.equal(activePaneIndex, 0);
  assert.equal((await inspectToast(paneViews[0])).count, 1);
  assert.equal((await inspectToast(paneViews[1])).exists, false);

  const originalDocumentUrl = paneViews[0].webContents.getURL();
  await showContext(0, {
    url: "https://chatgpt.com/c/conversation-c",
    title: "Conversation C"
  }, { userInitiated: true });
  assert.match(
    (await inspectToast(paneViews[0])).text,
    /Conversation C/
  );
  assert.equal(
    paneViews[0].webContents.getURL(),
    originalDocumentUrl,
    "toast changed the pane URL"
  );

  await showContext(0, {
    url: "https://chatgpt.com/",
    title: "ChatGPT"
  }, { userInitiated: true });
  assert.match((await inspectToast(paneViews[0])).text, /新對話/);
  await showContext(0, {
    url: "https://chatgpt.com/",
    title: "Formal conversation title"
  }, { userInitiated: true });
  assert.match(
    (await inspectToast(paneViews[0])).text,
    /Formal conversation title/
  );

  await showContext(0, {
    url: "https://chatgpt.com/c/long-title",
    title: "長".repeat(160)
  }, { userInitiated: true });
  const longTitleToast = await inspectToast(paneViews[0]);
  assert.equal(longTitleToast.titleOverflow, "ellipsis");
  assert.equal(
    Array.from(lastContext.displayTitle).length,
    120,
    "long title was not safely limited"
  );

  await paneViews[0].webContents.executeJavaScript(`
    document.getElementById("fixture-input").value = "still editable";
    document.getElementById("fixture-button").click();
    scrollTo(0, 500);
  `, true);
  const interactionState =
    await paneViews[0].webContents.executeJavaScript(`({
      value: document.getElementById("fixture-input").value,
      clicks: window.fixtureButtonClicks,
      scrollY
    })`, true);
  assert.deepEqual(interactionState, {
    value: "still editable",
    clicks: 1,
    scrollY: 500
  });

  assert.equal(
    await showContext(0, paneA, {
      userInitiated: true,
      suppressed: true,
      force: true
    }),
    false,
    "Settings-like suppression displayed a toast"
  );
  assert.equal((await inspectToast(paneViews[0])).exists, false);
  assert.equal(
    await showContext(1, paneB, {
      userInitiated: true,
      suppressed: true,
      force: true
    }),
    false,
    "Search-like suppression displayed a toast"
  );

  await showContext(0, paneA, { userInitiated: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal(
    (await inspectToast(paneViews[0])).exists,
    false,
    "toast did not remove itself after its bounded lifecycle"
  );

  await paneViews[0].webContents.loadURL(
    dataUrl(paneDocument("pane-1-reloaded"))
  );
  assert.equal(
    await showContext(0, paneA, { userInitiated: true, force: true }),
    true,
    "toast failed after pane reload"
  );

  workspaceWindow.contentView.removeChildView(paneViews[1]);
  const destroyedWebContents = paneViews[1].webContents;
  const destroyed = new Promise((resolve) => {
    if (destroyedWebContents.isDestroyed()) {
      resolve();
      return;
    }

    destroyedWebContents.once("destroyed", resolve);
  });
  destroyedWebContents.close();
  await destroyed;
  assert.equal(
    await showContext(1, paneB, { userInitiated: true, force: true }),
    false,
    "destroyed pane accepted a toast"
  );
  assert.equal(unhandledRejectionCount, 0);

  console.log("ACTIVE PANE TOAST FIXTURE: PASS");
}

run()
  .then(() => {
    app.quit();
  })
  .catch((error) => {
    console.error(error?.stack || String(error));
    app.exit(1);
  });

app.on("will-quit", () => {
  for (const view of paneViews) {
    if (isUsableView(view)) {
      try {
        workspaceWindow?.contentView.removeChildView(view);
      } catch {
        // The view may already be detached.
      }

      view.webContents.close();
    }
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.destroy();
  }

  try {
    fs.rmSync(fixtureUserDataPath, {
      recursive: true,
      force: true
    });
  } catch {
    // The OS may still hold a short-lived lock while Electron exits.
  }
});
