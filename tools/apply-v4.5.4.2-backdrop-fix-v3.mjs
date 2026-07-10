import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const expectedBranch = "fix/sidebar-route-regression-v4.5.4.2";
const coreFile = "poc-shaped-sidebar-v4.5.4.js";
const preloadFile = "sidebar-shape-preload-v4.5.4.js";
const expectedVersion = "4.5.4-routefix.3";
const nextVersion = "4.5.4-routefix.4";

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

if (!main.includes("[Bootstrap v4.5.4.2 Beta 3]")) {
  fail("main.js 不是已驗收的 v4.5.4.2 Beta 3 狀態。");
}

if (!core.includes("ChatGPT Multi Pane v4.5.4.2 Beta 3 —")) {
  fail("核心檔不是已驗收的 v4.5.4.2 Beta 3 狀態。");
}

if (!preload.includes("function isDialogBackdropPointer(event)")) {
  fail("preload 缺少 Beta 3 的背景點擊修正。");
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

const oldBackdropDetector = `function isDialogBackdropPointer(event) {
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
}`;

const newBackdropDetector = `function isDialogBackdropPointer(event) {
  if (
    !event ||
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY)
  ) {
    return false;
  }

  const dialogRect = findBestDialogSurface();

  if (!dialogRect) {
    return false;
  }

  const right =
    dialogRect.x + dialogRect.width;
  const bottom =
    dialogRect.y + dialogRect.height;

  return (
    event.clientX < dialogRect.x ||
    event.clientX > right ||
    event.clientY < dialogRect.y ||
    event.clientY > bottom
  );
}`;

preload = replaceOnce(
  preload,
  oldBackdropDetector,
  newBackdropDetector,
  "以座標判斷取代 DOM contains 背景判斷"
);

core = core.replaceAll(
  "ChatGPT Multi Pane v4.5.4.2 Beta 3 —",
  "ChatGPT Multi Pane v4.5.4.2 Beta 4 —"
);

main = replaceOnce(
  main,
  "[Bootstrap v4.5.4.2 Beta 3]",
  "[Bootstrap v4.5.4.2 Beta 4]",
  "Bootstrap Beta 4 標籤"
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

console.log("\n完成 v4.5.4.2 Beta 4 幾何背景判斷修正與語法驗證。");
console.log("尚未 commit，也尚未 push。");
console.log("\n下一步：");
console.log("  npm start");
console.log("\n請重複測試背景關閉至少 10 次，再測試關閉按鈕、Escape 與連續切換對話。");
