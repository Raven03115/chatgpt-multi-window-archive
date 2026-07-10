import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const expectedBranch = "fix/explicit-route-only-v4.5.4.2-beta5";
const coreFile = "poc-shaped-sidebar-v4.5.4.js";
const preloadFile = "sidebar-shape-preload-v4.5.4.js";
const expectedVersion = "4.5.4-routefix.3";
const nextVersion = "4.5.4-routefix.5";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: false
  });
}

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function read(file) {
  return fs
    .readFileSync(path.join(root, file), "utf8")
    .replace(/\r\n/g, "\n");
}

function write(file, content) {
  fs.writeFileSync(
    path.join(root, file),
    content.replace(/\r\n/g, "\n").replace(/\s+$/u, "") + "\n",
    "utf8"
  );
}

function replaceOnce(text, search, replacement, label) {
  const first = text.indexOf(search);
  const last = text.lastIndexOf(search);

  if (first < 0) {
    fail(`找不到要修改的內容：${label}`);
  }

  if (first !== last) {
    fail(`要修改的內容出現超過一次：${label}`);
  }

  return (
    text.slice(0, first) +
    replacement +
    text.slice(first + search.length)
  );
}

function replaceBetween(
  text,
  startMarker,
  endMarker,
  replacement,
  label
) {
  const start = text.indexOf(startMarker);
  const secondStart = text.indexOf(
    startMarker,
    start + startMarker.length
  );

  if (start < 0) {
    fail(`找不到起始標記：${label}`);
  }

  if (secondStart >= 0) {
    fail(`起始標記出現超過一次：${label}`);
  }

  const end = text.indexOf(
    endMarker,
    start + startMarker.length
  );

  if (end < 0) {
    fail(`找不到結束標記：${label}`);
  }

  return (
    text.slice(0, start) +
    replacement +
    text.slice(end)
  );
}

const branch = run("git", [
  "branch",
  "--show-current"
]).trim();

if (branch !== expectedBranch) {
  fail(`目前分支是 ${branch}，預期為 ${expectedBranch}`);
}

const trackedStatus = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no"
]).trim();

if (trackedStatus) {
  fail(
    "目前有已追蹤檔案尚未提交。請先保持此 Beta 5 分支乾淨後再執行。\n" +
      trackedStatus
  );
}

let main = read("main.js");
let core = read(coreFile);
let preload = read(preloadFile);
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));

if (!main.includes("[Bootstrap v4.5.4.2 Beta 3]")) {
  fail("main.js 不是已驗收的 Beta 3 基礎版本。");
}

if (!core.includes("ChatGPT Multi Pane v4.5.4.2 Beta 3 —")) {
  fail("核心檔不是已驗收的 Beta 3 基礎版本。");
}

if (!core.includes("function handleSidebarNavigation(url)")) {
  fail("核心檔缺少側欄原生導覽處理函式。");
}

if (!preload.includes("function isDialogBackdropPointer(event)")) {
  fail("preload 缺少 Beta 3 背景判斷，無法安全移除。");
}

if (packageJson.version !== expectedVersion) {
  fail(
    `package.json 版本應為 ${expectedVersion}，實際為 ${packageJson.version}`
  );
}

if (packageLock.version !== expectedVersion) {
  fail(
    `package-lock.json 頂層版本應為 ${expectedVersion}，實際為 ${packageLock.version}`
  );
}

if (packageLock.packages?.[""]?.version !== expectedVersion) {
  fail(
    `package-lock.json 根套件版本應為 ${expectedVersion}，實際為 ${packageLock.packages?.[""]?.version}`
  );
}

const explicitOnlyNavigation = `function handleSidebarNavigation(url) {
  if (!sidebarInitialLoadComplete) {
    return;
  }

  if (isExternalAccountRouteUrl(url)) {
    openFullscreenAccountRoute(url);
    return;
  }

  if (isOverlayOnlyRouteUrl(url)) {
    setOverlayOnlyUiActive(true);
    return;
  }

  if (isWorkspaceRouteUrl(url)) {
    console.log(
      "[Integration v4.5.4.2] native sidebar route ignored:",
      url
    );

    if (
      overlayOnlyUiActive ||
      Boolean(lockedDialogRect)
    ) {
      unlockDialogShape(false);
    }

    return;
  }
}
`;

core = replaceBetween(
  core,
  "function handleSidebarNavigation(url) {",
  "function setOverlayOnlyUiActive(active) {",
  explicitOnlyNavigation + "\n",
  "將原生側欄導覽改為只更新覆蓋視窗狀態"
);

const explicitOnlyWindowOpen = `  sidebarOverlayWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (isExternalAccountRouteUrl(url)) {
        openFullscreenAccountRoute(url);
      } else if (
        isOverlayOnlyRouteUrl(url)
      ) {
        setOverlayOnlyUiActive(true);
      } else if (
        isWorkspaceRouteUrl(url)
      ) {
        console.log(
          "[Integration v4.5.4.2] native sidebar window route ignored:",
          url
        );
      } else if (!isChatGPTUrl(url)) {
        shell.openExternal(url).catch((error) => {
          console.error(
            "[Integration v4.5.4.2] sidebar external link failed:",
            error.message
          );
        });
      }

      return {
        action: "deny"
      };
    }
  );
`;

core = replaceBetween(
  core,
  "  sidebarOverlayWindow.webContents.setWindowOpenHandler(",
  `  sidebarOverlayWindow.webContents.on(\n    "render-process-gone"`,
  explicitOnlyWindowOpen + "\n",
  "停用原生新視窗工作區路由轉送"
);

const explicitPreloadHandlers = `function handlePointerDown(event) {
  if (isUpgradeControl(event.target)) {
    notifyFullscreenOverlayIntent(true);
  } else if (
    isOverlayOnlyControl(event.target)
  ) {
    notifyOverlayOnlyIntent();
  } else if (
    !interceptExternalRoute(event)
  ) {
    reportRouteIntent(event.target);
  }

  if (isCloseControl(event.target)) {
    notifyCloseIntent();
    notifyFullscreenOverlayIntent(false);
  }

  scheduleReportBurst();
}

function handleClick(event) {
  if (isUpgradeControl(event.target)) {
    notifyFullscreenOverlayIntent(true);
  } else if (
    isOverlayOnlyControl(event.target)
  ) {
    notifyOverlayOnlyIntent();
  } else if (
    !interceptExternalRoute(event)
  ) {
    reportRouteIntent(event.target);
  }

  scheduleReportBurst();
}
`;

preload = replaceBetween(
  preload,
  "let suppressClickAfterBackdropUntil = 0;",
  "function handleKeyDown(event) {",
  explicitPreloadHandlers + "\n",
  "移除背景幾何與計時補丁"
);

core = core.replaceAll(
  "ChatGPT Multi Pane v4.5.4.2 Beta 3 —",
  "ChatGPT Multi Pane v4.5.4.2 Beta 5 —"
);

main = replaceOnce(
  main,
  "[Bootstrap v4.5.4.2 Beta 3]",
  "[Bootstrap v4.5.4.2 Beta 5]",
  "Bootstrap Beta 5 標籤"
);

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[""].version = nextVersion;

write(coreFile, core);
write(preloadFile, preload);
write("main.js", main);
write("package.json", JSON.stringify(packageJson, null, 2));
write("package-lock.json", JSON.stringify(packageLock, null, 2));

for (const file of [
  "main.js",
  coreFile,
  preloadFile,
  "pane-chrome-preload-v4.5.4.js"
]) {
  execFileSync(process.execPath, ["--check", file], {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
}

execFileSync("git", ["diff", "--check"], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

console.log("\n完成 v4.5.4.2 Beta 5 明確路由重構與語法驗證。");
console.log("尚未 commit，也尚未 push。");
console.log("\n重要行為：");
console.log("  - 明確側欄點擊：允許載入右側活動窗格");
console.log("  - 側欄頁面自行導覽：只記錄並忽略，不得改變右側窗格");
console.log("\n下一步：");
console.log("  npm start");
