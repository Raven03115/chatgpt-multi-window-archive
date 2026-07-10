import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const expectedBranch = "fix/sidebar-route-regression-v4.5.4.2";
const coreFile = "poc-shaped-sidebar-v4.5.4.js";
const preloadFile = "sidebar-shape-preload-v4.5.4.js";
const expectedVersion = "4.5.4-routefix.2";
const nextVersion = "4.5.4-routefix.3";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: false
  }).trim();
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

const branch = run("git", ["branch", "--show-current"]);

if (branch !== expectedBranch) {
  fail(`目前分支是 ${branch}，預期為 ${expectedBranch}`);
}

let main = read("main.js");
let core = read(coreFile);
let preload = read(preloadFile);
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));

if (!main.includes("[Bootstrap v4.5.4.2 Beta 2]")) {
  fail("main.js 不是已測試的 v4.5.4.2 Beta 2 狀態。");
}

if (!core.includes("ChatGPT Multi Pane v4.5.4.2 Beta 2 —")) {
  fail("核心檔不是已測試的 v4.5.4.2 Beta 2 狀態。");
}

if (!core.includes("Only an explicit timed guard may suppress a")) {
  fail("核心檔缺少 Beta 2 的限縮路由保護修正。");
}

if (!preload.includes("ChatGPT sometimes resolves a sidebar destination only on click.")) {
  fail("preload 缺少 Beta 2 的 click 路由補送修正。");
}

if (preload.includes("function isDialogBackdropPointer(event)")) {
  fail("背景關閉修正已經套用，請勿重複執行。");
}

if (packageJson.version !== expectedVersion) {
  fail(`package.json 版本應為 ${expectedVersion}，實際為 ${packageJson.version}`);
}

if (packageLock.version !== expectedVersion) {
  fail(`package-lock.json 頂層版本應為 ${expectedVersion}，實際為 ${packageLock.version}`);
}

if (packageLock.packages?.[""]?.version !== expectedVersion) {
  fail(`package-lock.json 根套件版本應為 ${expectedVersion}，實際為 ${packageLock.packages?.[""]?.version}`);
}

const backdropHelper = `let suppressClickAfterBackdropUntil = 0;

function isDialogBackdropPointer(event) {
  if (!(event?.target instanceof Element)) {
    return false;
  }

  let foundVisibleSurface = false;

  for (
    const root of collectElements(
      DIALOG_ROOT_SELECTORS
    )
  ) {
    if (!isVisible(root)) {
      continue;
    }

    for (
      const element of
        getDialogSurfaceCandidates(root)
    ) {
      if (!isVisible(element)) {
        continue;
      }

      const rect = getRect(element);

      if (
        !isReasonableDialogSurface(
          element,
          rect
        )
      ) {
        continue;
      }

      foundVisibleSurface = true;

      if (element.contains(event.target)) {
        return false;
      }
    }
  }

  return foundVisibleSurface;
}

function handlePointerDown(event) {`;

preload = replaceOnce(
  preload,
  "function handlePointerDown(event) {",
  backdropHelper,
  "加入設定背景點擊偵測"
);

preload = replaceOnce(
  preload,
`function handlePointerDown(event) {
  if (isUpgradeControl(event.target)) {`,
`function handlePointerDown(event) {
  if (isDialogBackdropPointer(event)) {
    suppressClickAfterBackdropUntil =
      Date.now() + 250;

    notifyCloseIntent();
    notifyFullscreenOverlayIntent(false);
    scheduleReportBurst();

    return;
  }

  if (isUpgradeControl(event.target)) {`,
  "背景 pointerdown 先送出關閉意圖"
);

preload = replaceOnce(
  preload,
`function handleClick(event) {
  if (isUpgradeControl(event.target)) {`,
`function handleClick(event) {
  if (
    Date.now() <
      suppressClickAfterBackdropUntil
  ) {
    scheduleReportBurst();
    return;
  }

  if (isUpgradeControl(event.target)) {`,
  "阻止背景關閉後的同次 click 觸發路由"
);

core = core.replaceAll(
  "ChatGPT Multi Pane v4.5.4.2 Beta 2 —",
  "ChatGPT Multi Pane v4.5.4.2 Beta 3 —"
);

main = replaceOnce(
  main,
  "[Bootstrap v4.5.4.2 Beta 2]",
  "[Bootstrap v4.5.4.2 Beta 3]",
  "Bootstrap Beta 3 標籤"
);

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[""].version = nextVersion;

write(preloadFile, preload);
write(coreFile, core);
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

console.log("\n完成 v4.5.4.2 Beta 3 背景關閉修正與語法驗證。");
console.log("尚未 commit，也尚未 push。");
console.log("\n下一步：");
console.log("  npm start");
console.log("\n請測試設定背景關閉、關閉按鈕、Escape，以及後續連續切換對話。");
