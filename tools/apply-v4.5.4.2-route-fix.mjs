import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const expectedBranch = "fix/sidebar-route-regression-v4.5.4.2";
const coreFile = "poc-shaped-sidebar-v4.5.4.js";
const preloadFile = "sidebar-shape-preload-v4.5.4.js";

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

function replaceRegexOnce(text, regex, replacement, label) {
  const matches = [...text.matchAll(regex)];

  if (matches.length !== 1) {
    fail(`正規表示式比對數量不是 1：${label}（找到 ${matches.length} 次）`);
  }

  return text.replace(regex, replacement);
}

const branch = run("git", ["branch", "--show-current"]);

if (branch !== expectedBranch) {
  fail(`目前分支是 ${branch}，預期為 ${expectedBranch}`);
}

const trackedStatus = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no"
]);

if (trackedStatus) {
  fail("目前有已追蹤檔案尚未提交，停止以避免覆蓋其他修改。\n" + trackedStatus);
}

const expectedCoreBlob = "d29d51ec91ea8406617120117f0506e4ba564a94";
const expectedPreloadBlob = "28edbbf884d0d44ed543c687c94374ee32f8f7c9";
const actualCoreBlob = run("git", ["hash-object", coreFile]);
const actualPreloadBlob = run("git", ["hash-object", preloadFile]);

if (actualCoreBlob !== expectedCoreBlob) {
  fail(`核心檔案不是已驗證的 v4.5.4.1 來源。\n預期：${expectedCoreBlob}\n實際：${actualCoreBlob}`);
}

if (actualPreloadBlob !== expectedPreloadBlob) {
  fail(`preload 檔案不是已驗證的 v4.5.4.1 來源。\n預期：${expectedPreloadBlob}\n實際：${actualPreloadBlob}`);
}

let core = read(coreFile);

core = replaceOnce(
  core,
  "function unlockDialogShape() {",
  "function unlockDialogShape(suppressSidebarRoute = false) {",
  "unlockDialogShape 參數"
);

core = replaceOnce(
  core,
`  /*
   * Closing Settings/Search can make the sidebar overlay navigate back
   * to its own conversation or home route. That navigation is not a
   * user request to replace the active pane.
   */
  sidebarRouteForwardSuppressionUntil =
    Math.max(
      sidebarRouteForwardSuppressionUntil,
      Date.now() + 1500
    );
`,
`  if (suppressSidebarRoute) {
    /*
     * Only a confirmed Settings/Search close action should block the
     * overlay page's follow-up route. Normal sidebar clicks must not
     * create this guard.
     */
    sidebarRouteForwardSuppressionUntil =
      Math.max(
        sidebarRouteForwardSuppressionUntil,
        Date.now() + 1500
      );
  }
`,
  "關閉設定時的路由保護"
);

core = replaceRegexOnce(
  core,
  /(ipcMain\.on\(\n  "chatgpt-sidebar-dialog-close-intent",[\s\S]*?)(    unlockDialogShape\(\);\n\n    if \(fullscreenOverlayMode\) \{)/g,
  `$1    const hadOverlayDialog =\n      overlayOnlyUiActive ||\n      Boolean(lockedDialogRect) ||\n      fullscreenOverlayMode;\n\n    if (!hadOverlayDialog) {\n      console.log(\n        "[Integration v4.5.4] ignored stray dialog close intent"\n      );\n\n      return;\n    }\n\n    unlockDialogShape(true);\n\n    if (fullscreenOverlayMode) {`,
  "只允許真實對話框關閉事件啟動路由保護"
);

core = core.replaceAll(
  "ChatGPT Multi Pane v4.5.4.1 —",
  "ChatGPT Multi Pane v4.5.4.2 Beta —"
);

write(coreFile, core);

let preload = read(preloadFile);

preload = replaceRegexOnce(
  preload,
  /function isCloseControl\(target\) \{[\s\S]*?\n\}\n\nfunction notifyCloseIntent/g,
`function isCloseControl(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const control = target.closest(
    'button, [role="button"]'
  );

  if (!control) {
    return false;
  }

  const metadata = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();

  const exactText = String(
    control.textContent || ""
  )
    .replace(/\\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    exactText === "x" ||
    exactText === "×" ||
    metadata.includes("close") ||
    metadata.includes("dismiss") ||
    metadata.includes("關閉") ||
    metadata.includes("关闭")
  );
}

function notifyCloseIntent`,
  "縮小關閉按鈕判定範圍"
);

preload = replaceOnce(
  preload,
`  } else {
    interceptExternalRoute(event);
  }
`,
`  } else if (
    !interceptExternalRoute(event)
  ) {
    /*
     * ChatGPT sometimes completes sidebar navigation only on click,
     * rather than pointerdown. Report the route again here; the main
     * process de-duplicates pending and current destinations.
     */
    reportRouteIntent(event.target);
  }
`,
  "click 階段補送正常路由意圖"
);

write(preloadFile, preload);

let main = read("main.js");
main = replaceOnce(
  main,
  "[Bootstrap v4.5.4.1]",
  "[Bootstrap v4.5.4.2 Beta]",
  "Bootstrap 測試版標籤"
);
write("main.js", main);

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(read("package.json"));

if (packageJson.version !== "4.5.4+hotfix.1") {
  fail(`package.json 版本不是 4.5.4+hotfix.1，而是 ${packageJson.version}`);
}

packageJson.version = "4.5.4-routefix.1";
write("package.json", JSON.stringify(packageJson, null, 2));

console.log("更新 package-lock.json...");
execFileSync("npm.cmd", ["install", "--package-lock-only"], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

for (const file of [
  "main.js",
  coreFile,
  preloadFile,
  "pane-chrome-preload-v4.5.4.js"
]) {
  execFileSync("node", ["--check", file], {
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

console.log("\n完成 v4.5.4.2 Beta 路由修正與語法驗證。");
console.log("尚未 commit，也尚未 push。");
console.log("\n下一步：");
console.log("  npm start");
console.log("\n請測試一般對話、新對話，以及設定視窗關閉後是否保持原對話。");
