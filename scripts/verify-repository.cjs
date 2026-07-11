const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
let failureCount = 0;

function pass(check, detail = '') {
  console.log(`PASS: ${check}${detail ? ` - ${detail}` : ''}`);
}

function fail(check, detail) {
  failureCount += 1;
  console.error(`FAIL: ${check} - ${detail}`);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
}

function commandFailure(result) {
  if (result.error) {
    return result.error.message;
  }

  return (result.stderr || result.stdout || `exit code ${result.status}`).trim();
}

function validateJson(relativePath) {
  try {
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
    pass(`${relativePath} is valid JSON`);
  } catch (error) {
    fail(`${relativePath} is valid JSON`, error.message);
  }
}

function isProbablyText(buffer) {
  if (buffer.includes(0)) {
    return false;
  }

  const sampleLength = Math.min(buffer.length, 8192);
  let controlByteCount = 0;

  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index];
    const isAllowedWhitespace = byte === 9 || byte === 10 || byte === 13;
    if ((byte < 32 && !isAllowedWhitespace) || byte === 127) {
      controlByteCount += 1;
    }
  }

  return sampleLength === 0 || controlByteCount / sampleLength < 0.1;
}

validateJson('package.json');
validateJson('package-lock.json');

const repositoryFilesResult = run('git', [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
]);
let repositoryFiles = [];

if (repositoryFilesResult.status === 0) {
  repositoryFiles = [...new Set(repositoryFilesResult.stdout.split('\0').filter(Boolean))];
  pass(
    'git ls-files --cached --others --exclude-standard',
    `${repositoryFiles.length} tracked and untracked files found`,
  );
} else {
  fail(
    'git ls-files --cached --others --exclude-standard',
    commandFailure(repositoryFilesResult),
  );
}

for (const relativePath of repositoryFiles.filter((file) => /\.(?:cjs|js)$/i.test(file))) {
  const syntaxResult = run(process.execPath, ['--check', relativePath]);
  if (syntaxResult.status === 0) {
    pass(`node --check ${relativePath}`);
  } else {
    fail(`node --check ${relativePath}`, commandFailure(syntaxResult));
  }
}

const conflictMarkerPattern = /^(?:<{7}|={7}|>{7})(?:\s|$)/;
let scannedTextFileCount = 0;
let skippedBinaryFileCount = 0;
let conflictMarkerFailureCount = 0;

for (const relativePath of repositoryFiles) {
  try {
    const buffer = fs.readFileSync(path.join(repositoryRoot, relativePath));
    if (!isProbablyText(buffer)) {
      skippedBinaryFileCount += 1;
      continue;
    }

    scannedTextFileCount += 1;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const markerMatch = conflictMarkerPattern.exec(lines[index]);
      if (markerMatch) {
        conflictMarkerFailureCount += 1;
        fail(
          'Git conflict marker scan',
          `${relativePath}:${index + 1} starts with ${markerMatch[0].trim()}`,
        );
      }
    }
  } catch (error) {
    conflictMarkerFailureCount += 1;
    fail('Git conflict marker scan', `${relativePath}: ${error.message}`);
  }
}

if (conflictMarkerFailureCount === 0) {
  pass(
    'Git conflict marker scan',
    `${scannedTextFileCount} text files scanned, ${skippedBinaryFileCount} binary files skipped`,
  );
}

const diffCheckResult = run('git', ['diff', '--check']);
if (diffCheckResult.status === 0) {
  pass('git diff --check');
} else {
  fail('git diff --check', commandFailure(diffCheckResult));
}

const cachedDiffCheckResult = run('git', ['diff', '--cached', '--check']);
if (cachedDiffCheckResult.status === 0) {
  pass('git diff --cached --check');
} else {
  fail('git diff --cached --check', commandFailure(cachedDiffCheckResult));
}

const requiredFiles = [
  'main.js',
  'package.json',
  'package-lock.json',
  'poc-shaped-sidebar-v4.5.4.js',
];

for (const relativePath of requiredFiles) {
  if (fs.existsSync(path.join(repositoryRoot, relativePath))) {
    pass(`required file exists: ${relativePath}`);
  } else {
    fail(`required file exists: ${relativePath}`, 'file not found');
  }
}

const sidebarPath = path.join(repositoryRoot, 'poc-shaped-sidebar-v4.5.4.js');
try {
  const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');
  for (const requiredContent of ['function closeActivePane', 'CommandOrControl+Alt+W']) {
    if (sidebarSource.includes(requiredContent)) {
      pass(`poc-shaped-sidebar-v4.5.4.js contains: ${requiredContent}`);
    } else {
      fail(
        `poc-shaped-sidebar-v4.5.4.js contains: ${requiredContent}`,
        'required content not found',
      );
    }
  }
} catch (error) {
  fail('poc-shaped-sidebar-v4.5.4.js content checks', error.message);
}

if (failureCount === 0) {
  console.log('REPOSITORY VERIFY: PASS');
} else {
  console.error(`REPOSITORY VERIFY: FAIL (${failureCount} failure(s))`);
  process.exitCode = 1;
}
