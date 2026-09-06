// SPDX-License-Identifier: MPL-2.0
//
// # theme-package-integrity.test.mjs — CLI integration tests
//
// Tests the theme-package-integrity.mjs CLI tool end-to-end by:
//   1. Creating temporary theme directories
//   2. Running the CLI in generate mode
//   3. Running the CLI in verify mode
//   4. Testing edge cases (missing dir, modified files, etc.)
//
// Run with: node scripts/theme-package-integrity.test.mjs

import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_PATH = join(__dirname, 'theme-package-integrity.mjs');

let passed = 0;
let failed = 0;

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'cli-test-'));
}

async function createThemePackage(extraFiles = {}) {
  const dir = await createTempDir();
  await mkdir(join(dir, 'assets', 'css'), { recursive: true });

  const manifest = {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark',
    colors: { accent: '#00ffff', background: '#050816', foreground: '#e0e8ff' },
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, 'icon.png'), Buffer.from('fake-png-data'));
  await writeFile(join(dir, 'preview.png'), Buffer.from('fake-png-data'));
  await writeFile(
    join(dir, 'assets', 'css', 'traework.css'),
    ':root { --agentskin-accent: #00ffff; }\n',
  );

  for (const [relPath, content] of Object.entries(extraFiles)) {
    const fullPath = join(dir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  return dir;
}

function runCli(args) {
  try {
    const output = execSync(`node ${SCRIPT_PATH} ${args}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: output, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.error(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.error('theme-package-integrity CLI Tests');
  console.error('================================\n');

  // Test 1: Generate mode produces valid JSON
  await test('generate mode produces valid JSON to stdout', async () => {
    const dir = await createThemePackage();
    try {
      const result = runCli(dir);
      assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout);
      assert(parsed.algorithm === 'sha256', 'Expected sha256 algorithm');
      assert(typeof parsed.files === 'object', 'Expected files object');
      assert(parsed.files['manifest.json'], 'Expected manifest.json hash');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 2: Verify mode passes for unchanged files
  await test('verify mode passes for unchanged files', async () => {
    const dir = await createThemePackage();
    try {
      const genResult = runCli(`${dir} --output ${dir}/.theme-integrity.json`);
      assert(genResult.exitCode === 0, `Generate failed: ${genResult.stderr}`);
      const verifyResult = runCli(`${dir} --verify`);
      assert(verifyResult.exitCode === 0, `Verify failed: ${verifyResult.stderr}`);
      const report = JSON.parse(verifyResult.stdout);
      assert(report.valid === true, 'Expected valid to be true');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 3: Verify mode fails for modified files
  await test('verify mode fails for modified files', async () => {
    const dir = await createThemePackage();
    try {
      runCli(`${dir} --output ${dir}/.theme-integrity.json`);
      await writeFile(join(dir, 'manifest.json'), '{"tampered": true}');
      const verifyResult = runCli(`${dir} --verify`);
      assert(verifyResult.exitCode === 1, `Expected exit code 1, got ${verifyResult.exitCode}`);
      const report = JSON.parse(verifyResult.stdout);
      assert(report.valid === false, 'Expected valid to be false');
      assert(report.mismatches.includes('manifest.json'), 'Expected manifest.json in mismatches');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 4: Verify mode detects missing files
  await test('verify mode detects missing files', async () => {
    const dir = await createThemePackage();
    try {
      runCli(`${dir} --output ${dir}/.theme-integrity.json`);
      await rm(join(dir, 'icon.png'));
      const verifyResult = runCli(`${dir} --verify`);
      assert(verifyResult.exitCode === 1, `Expected exit code 1, got ${verifyResult.exitCode}`);
      const report = JSON.parse(verifyResult.stdout);
      assert(report.valid === false, 'Expected valid to be false');
      assert(report.missing.includes('icon.png'), 'Expected icon.png in missing');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 5: Verify mode detects extra files
  await test('verify mode detects extra files', async () => {
    const dir = await createThemePackage();
    try {
      runCli(`${dir} --output ${dir}/.theme-integrity.json`);
      await writeFile(join(dir, 'injected.js'), 'console.log("evil")');
      const verifyResult = runCli(`${dir} --verify`);
      assert(verifyResult.exitCode === 1, `Expected exit code 1, got ${verifyResult.exitCode}`);
      const report = JSON.parse(verifyResult.stdout);
      assert(report.valid === false, 'Expected valid to be false');
      assert(report.extra.includes('injected.js'), 'Expected injected.js in extra');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 6: Handles missing directory
  await test('handles missing directory with exit code 2', async () => {
    const result = runCli('/nonexistent/path/to/theme');
    assert(result.exitCode === 2, `Expected exit code 2, got ${result.exitCode}`);
  });

  // Test 7: Handles verify without existing manifest
  await test('verify without existing manifest exits with code 2', async () => {
    const dir = await createThemePackage();
    try {
      const result = runCli(`${dir} --verify`);
      assert(result.exitCode === 2, `Expected exit code 2, got ${result.exitCode}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 8: Handles empty directory
  await test('handles empty directory (no files to hash)', async () => {
    const dir = await createTempDir();
    try {
      const result = runCli(dir);
      assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout);
      assert(Object.keys(parsed.files).length === 0, 'Expected empty files object');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 9: Handles nested directories
  await test('handles nested directories correctly', async () => {
    const dir = await createThemePackage({
      'assets/images/texture.png': 'texture-data',
      'deep/nested/file.txt': 'deep-content',
    });
    try {
      const result = runCli(dir);
      assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout);
      assert(parsed.files['assets/images/texture.png'], 'Expected texture.png hash');
      assert(parsed.files['deep/nested/file.txt'], 'Expected deep/nested/file.txt hash');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 10: Output file mode writes manifest to specified file
  await test('--output flag writes manifest to specified file', async () => {
    const dir = await createThemePackage();
    const outputPath = join(dir, 'custom-integrity.json');
    try {
      const result = runCli(`${dir} --output ${outputPath}`);
      assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);
      const content = await readFile(outputPath, 'utf8');
      const parsed = JSON.parse(content);
      assert(parsed.algorithm === 'sha256', 'Expected sha256 algorithm');
      assert(parsed.files['manifest.json'], 'Expected manifest.json hash');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 11: Hash values are 64-character hex strings
  await test('all hash values are valid 64-character hex strings', async () => {
    const dir = await createThemePackage();
    try {
      const result = runCli(dir);
      const parsed = JSON.parse(result.stdout);
      for (const [filePath, hash] of Object.entries(parsed.files)) {
        assert(/^[0-9a-f]{64}$/.test(hash), `Invalid hash for ${filePath}: ${hash}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Test 12: No arguments shows usage
  await test('no arguments shows usage and exits with code 2', async () => {
    const result = runCli('');
    assert(result.exitCode === 2, `Expected exit code 2, got ${result.exitCode}`);
  });

  // Summary
  console.error(`\n================================`);
  console.error(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
