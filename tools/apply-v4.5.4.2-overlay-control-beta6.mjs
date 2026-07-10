import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const expectedBranch = "fix/explicit-route-only-v4.5.4.2-beta5";
const coreFile = "poc-shaped-sidebar-v4.5.4.js";
const preloadFile = "sidebar-shape-preload-v4.5.4.js";
const expectedVersion = "4.5.4-routefix.5";
const nextVersion = "4.5.4-routefix.6";

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

let main = read("main.js");
let core = read(coreFile);
let preload = read(preloadFile);
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));

if (!main.includes("[Bootstrap v4.5.4.2 Beta 5]")) {
  fail("main.js 不是 Beta 5 狀態。");
}

if (!core.includes("ChatGPT Multi Pane v4.5.4.2 Beta 5 —")) {
  fail("核心檔不是 Beta 5 狀態。");
}

if (!core.includes("native sidebar route ignored:")) {
  fail("核心檔缺少 Beta 5 的明確路由重構。");
}

if (preload.includes("function isDialogBackdropPointer(event)")) {
  fail("preload 仍含舊背景判斷，並非 Beta 5 狀態。");
}

if (!preload.includes("function isOverlayOnlyControl(target)")) {
  fail("preload 缺少 overlay 控制判斷函式。");
}

if (!preload.includes("text.includes(token)")) {
  fail("找不到預期的寬鬆文字包含判斷，可能已經修正過。");
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

const strictOverlayControl = `function isOverlayOnlyControl(target) {
  const control = getControlElement(target);

  if (!control) {
    return false;
  }

  const normalize = (value) =>
    String(value || "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();

  const exactLabels = new Set([
    "設定",
    "settings",
    "搜尋對話",
    "搜尋聊天",
    "search chats",
    "search conversations"
  ]);

  const semanticLabels = [
    control.getAttribute("aria-label"),
    control.getAttribute("title")
  ]
    .map(normalize)
    .filter(Boolean);

  const exactText = normalize(control.textContent);
  const testId = normalize(
    control.getAttribute("data-testid")
  );

  if (
    semanticLabels.some((label) =>
      exactLabels.has(label)
    ) ||
    exactLabels.has(exactText)
  ) {
    return true;
  }

  return (
    /(?:^|[-_])(settings?|preferences?)(?:$|[-_])/.test(testId) ||
    /(?:^|[-_])search(?:[-_](?:chats?|conversations?))?(?:$|[-_])/.test(testId)
  );
}

`;

preload = replaceBetween(
  preload,
  "function isOverlayOnlyControl(target) {",
  "function notifyOverlayOnlyIntent() {",
  strictOverlayControl,
  "將 overlay 控制判斷改為精確語意比對"
);

core = core.replaceAll(
  "ChatGPT Multi Pane v4.5.4.2 Beta 5 —",
  "ChatGPT Multi Pane v4.5.4.2 Beta 6 —"
);

main = replaceOnce(
  main,
  "[Bootstrap v4.5.4.2 Beta 5]",
  "[Bootstrap v4.5.4.2 Beta 6]",
  "Bootstrap Beta 6 標籤"
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

console.log("\n完成 v4.5.4.2 Beta 6 專案名稱誤判修正與語法驗證。");
console.log("尚未 commit，也尚未 push。");
console.log("\n修正重點：");
console.log("  - 專案名稱包含『設定』或『search』時，不再被當成設定／搜尋按鈕");
console.log("  - 只有精確控制標籤或 data-testid 才會啟用 overlay-only 模式");
console.log("\n下一步：");
console.log("  npm start");
