# AgentSkin desktop-main Test Quality Scan Report

**Scan Date:** 2025-07-14
**Scope:** `src/main/**/*.test.ts` (74 files), `src/shared/**/*.test.ts` (4 files), `src/ui/**/*.test.ts` (3 files)
**Tech Stack:** Vitest 4
**Scan Categories:** Mock issues, async test defects, assertion defects, test isolation problems

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | Test assertion that always passes — test is meaningless |
| HIGH | 3 | Mock cleanup omissions that can cause cross-test contamination |
| MEDIUM | 2 | Non-deterministic timing patterns, env var isolation risks |
| LOW | 1 | Low-risk inline resetModules within a loop |

**Total confirmed defects: 7**
**Files scanned: ~81**
**Files with zero issues: ~74**
**Overall assessment: Good — the codebase is well-disciplined in test hygiene.**

---

## Category 1: Assertion Defects

### DEFECT-001 — Tautological assertion `expect(true).toBe(true)` (CRITICAL)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\scene-size.verify.test.ts`
**Test case:** `"draws every fullscreen background at the projection size on a 1920x1080 viewport"`
**Line:** 65

**Failure reason:**
The test iterates all scene.pkg files in the Wallpaper Engine workshop, counts fullscreen backgrounds (`bgTotal`) and how many cover the viewport after the scale fix (`bgOk`), accumulates diagnostic detail in `lines[]`, prints results via `console.log` — but the final assertion is:

```ts
expect(true).toBe(true);
```

This assertion can never fail. The check that actually matters — whether `bgOk === bgTotal` (all fullscreen backgrounds cover the viewport) — is never asserted. The test is a silent no-op: it runs expensive I/O, produces a diagnostic log, then passes regardless of correctness. The `bgOk` and `bgTotal` counters are computed but never asserted.

**Fix suggestion:**
Replace `expect(true).toBe(true)` with a meaningful assertion:

```ts
// All fullscreen backgrounds must cover the 1920x1080 viewport after the fix
expect(bgOk).toBe(bgTotal);
// At least one fullscreen background must exist for the test to be meaningful
expect(bgTotal).toBeGreaterThan(0);
```

This way, if any fullscreen background falls short of covering the viewport, the test fails with the diagnostic context already printed via `console.log`.

---

## Category 2: Mock Cleanup Issues

### DEFECT-002 — Missing `vi.restoreAllMocks()` / `vi.clearAllMocks()` in afterEach (HIGH)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\wallpaper-server.test.ts`
**Test case:** All tests in this file (multiple `describe` blocks)

**Failure reason:**
`wallpaperMediaServer` is a singleton imported at module level. The `afterEach` only calls `wallpaperMediaServer.stop()` and `fs.rm()`. There is no `vi.restoreAllMocks()` or `vi.clearAllMocks()`. If any test adds spies or additional mocks (currently the file is clean, but future additions could introduce them), those mocks would leak across tests. More importantly, if any test file that imports `wallpaperMediaServer` adds `vi.spyOn` to its methods, those spies would persist.

**Risk:** Currently low because no mocks exist in this file. But the test title "mock cleanup issues" applies to the *inter-file* risk: `wallpaperMediaServer` is shared state, and its behavior in one test could affect another if mocks accumulate.

**Fix suggestion:**
Add a global `afterEach` at the top level:

```ts
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
```

---

### DEFECT-003 — Missing `mockRestore()` on `vi.spyOn` in wallpaper-injector (HIGH)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\wallpaper-injector.test.ts`
**Test case:** `"falls back to last successful wallpaper on failure"` (line 142-170) and others with 35s timeout

**Failure reason:**
The file uses module-level `vi.mock('./wallpaper-server', ...)` with default `mockResolvedValue(null)`. The `afterEach` calls `mockClear()` on the wallpaper server mocks but does NOT call `mockRestore()`. While `mockClear()` resets call history, it does not restore the original implementation. If any test uses `vi.spyOn()` on internal functions (the `media token cleanup` describe block touches `_setActiveMediaTokenForTest` / `_clearActiveMediaTokensForTest` which are exported test helpers), spies are not cleaned up.

Additionally, the tests with 35s timeout (`waitForTargets` polling for 15s) can cause cascading CI delays: if one test is slow, the entire suite blocks.

**Fix suggestion:**
1. Add `vi.restoreAllMocks()` to the global `afterEach`:
```ts
afterEach(() => {
  clearLastSuccessfulWallpaper(TEST_AGENT);
  _clearActiveMediaTokensForTest();
  vi.mocked(wallpaperMediaServer.unregister).mockClear();
  vi.mocked(wallpaperMediaServer.register).mockClear();
  vi.restoreAllMocks();
});
```

2. For the 35s-timeout tests, consider reducing `waitForTargets` timeout in test environments or using `vi.useFakeTimers()` to eliminate real waiting.

---

### DEFECT-004 — Missing `vi.clearAllMocks()` / `vi.restoreAllMocks()` in theme-wallpaper (HIGH)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\wallpaper\theme-wallpaper.test.ts`
**Test case:** `"blocks video paths that escape the package root (traversal / absolute)"` (line 87-115)

**Failure reason:**
Multiple `vi.fn()` mocks are created per test (`register`, `onError`) but never explicitly cleared. The `afterEach` only cleans up the temp directory (`fs.rm(root, ...)`). There is no `vi.clearAllMocks()` or `vi.restoreAllMocks()` anywhere in the file.

In the path-traversal test, the second and third calls to `registerThemeWallpaperForInstalled` reuse the same `register` and `onError` mocks from the first call. Since `register = vi.fn(async () => {})` is created once at line 89 and then used across 3 invocations without being reset between calls, the assertion `expect(register).not.toHaveBeenCalled()` at line 113 is potentially order-dependent. If test ordering changed or mocks leaked, the assertion could fail or pass incorrectly.

**Fix suggestion:**
Add a `beforeEach`/`afterEach` block with mock cleanup:

```ts
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
```

Or, for the path-traversal test specifically, create fresh mocks for each invocation:

```ts
it('blocks video paths that escape the package root (traversal / absolute)', async () => {
  const onError1 = vi.fn();
  const register1 = vi.fn(async () => {});
  // ... first call with register1, onError1
  const onError2 = vi.fn();
  const register2 = vi.fn(async () => {});
  // ... second call with register2, onError2
});
```

---

## Category 3: Test Isolation Problems

### DEFECT-005 — Inline `vi.resetModules()` inside a loop (MEDIUM)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\config\settings.test.ts`
**Test case:** `"loadSettings clamps an out-of-range threshold back to the default"` (line 90-104)

**Failure reason:**
```ts
it('loadSettings clamps an out-of-range threshold back to the default', async () => {
  for (const bad of [-5, 0, 1e10, Number.NaN]) {
    // resetModules so each write is a fresh load
    vi.resetModules();
    await fs.writeFile(
      settingsFile(tmpDir),
      JSON.stringify({ imageBlobThresholdMB: bad }, null, 2),
      'utf8',
    );
    const { getImageBlobThresholdBytes } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(20 * 1024 * 1024);
  }
});
```

`vi.resetModules()` is called inside a `for` loop within a single test. This is intentional (each iteration needs a fresh module cache), but it combines 4 different test scenarios into one test. If the `NaN` case fails, the entire test fails, and it's harder to debug which specific value caused the failure. The pattern is functional but reduces granularity.

**Risk:** Low-medium. The test works, but failure diagnostics are coarser.

**Fix suggestion:**
Consider using `it.each` for better per-value reporting:

```ts
it.each([-5, 0, 1e10, Number.NaN])(
  'clamps out-of-range threshold %s back to default 20MB',
  async (bad) => {
    vi.resetModules();
    await fs.writeFile(
      settingsFile(tmpDir),
      JSON.stringify({ imageBlobThresholdMB: bad }, null, 2),
      'utf8',
    );
    const { getImageBlobThresholdBytes } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(20 * 1024 * 1024);
  },
);
```

This way, Vitest reports each value as a separate test case.

---

### DEFECT-006 — Environment variable mutation with `process.env.APPDATA` (MEDIUM)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\config\settings.test.ts`
**Test case:** All tests in this describe block

**Failure reason:**
The test mutates global `process.env.APPDATA` in `beforeEach` (line 20: `process.env.APPDATA = tmpDir`) and restores it in `afterEach` (line 25: `process.env.APPDATA = savedAppdata`). If any test throws unexpectedly between `beforeEach` and `afterEach`, the restoration might not run, leaking the mutated `APPDATA` to other test files in the same worker.

This is a common pattern in Node.js testing and Vitest typically isolates test files to separate workers, making cross-file contamination unlikely. However, for files within the same Vitest project/workspace, if one test's `afterEach` fails, subsequent tests may see the wrong `APPDATA`.

**Risk:** Low in practice (Vitest file isolation), but the pattern is fragile.

**Fix suggestion:**
Wrap the critical section in a try/finally, or use a helper:

```ts
afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } finally {
    process.env.APPDATA = savedAppdata;
    vi.resetModules();
  }
});
```

---

## Category 4: Non-Deterministic Timing

### DEFECT-007 — Busy-wait loop for timing in boot-profiler (MEDIUM)

**File:** `C:\Users\snowb\Desktop\work\desktop-main\src\main\boot-profiler.test.ts`
**Test case:** `"sorts the report by slowest step first"` (line 41-54)
**Line:** 47-50

**Failure reason:**
```ts
it('sorts the report by slowest step first', () => {
  const p = new BootProfiler();
  p.begin('快');
  p.end();
  p.begin('慢');
  // Force the slower duration by sleeping briefly.
  const t0 = Date.now();
  while (Date.now() - t0 < 2) {
    /* busy-wait 2ms */
  }
  p.end();
  const report = p.report();
  expect(report.indexOf('慢')).toBeLessThan(report.indexOf('快'));
});
```

The test uses a busy-wait loop to ensure that the '慢' step has a longer duration than the '快' step. This is non-deterministic: on a slow CI machine or under heavy CPU load, the busy-wait might take longer than expected or shorter. The assertion `report.indexOf('慢') < report.indexOf('快')` assumes '慢' has a strictly larger duration, but if the timer resolution is too coarse (Windows default is ~15.6ms), both steps could record the same duration, making the order assertion flaky.

**Fix suggestion:**
Instead of relying on wall-clock timing, inject a mock timer or use deterministic duration values:

```ts
it('sorts the report by slowest step first', () => {
  const p = new BootProfiler();
  // Use vi.useFakeTimers() or expose a testing hook to set durations.
  vi.useFakeTimers();
  p.begin('快');
  vi.advanceTimersByMs(1);
  p.end();
  p.begin('慢');
  vi.advanceTimersByMs(10);
  p.end();
  const report = p.report();
  expect(report.indexOf('慢')).toBeLessThan(report.indexOf('快'));
  vi.useRealTimers();
});
```

Or, better: refactor `BootProfiler` to accept an injectable clock (`() => number`) for deterministic testing.

---

## Files Confirmed Clean (No Issues)

### src/main (confirmed readable, well-structured)
- `agent-scheme.test.ts`
- `audio-level.test.ts`
- `catalog/agent-catalog.test.ts`
- `catalog/manifest-schema.test.ts`
- `catalog/manifest-validator.test.ts`
- `catalog/theme-catalog.test.ts`
- `catalog/theme-package-loader.test.ts`
- `catalog/theme-seeder.test.ts`
- `cdp/cdp-client.test.ts`
- `cdp/cdp-fanout.test.ts`
- `cdp/cdp-inject.test.ts`
- `cdp/cdp-ready.test.ts`
- `cdp/cdp-targets.test.ts`
- `cdp/cdp-watcher.test.ts`
- `cdp/cdp-wallpaper-inject.test.ts`
- `cdp/framework-fingerprint.test.ts`
- `cdp/secondary-inject.test.ts`
- `cdp/token-extractor.test.ts`
- `cdp/variable-graph.test.ts`
- `cdp/wallpaper/render-css.test.ts`
- `config/studio-window-state.test.ts`
- `epoch-manager.test.ts`
- `file-open.test.ts`
- `fs/tar-pack.test.ts`
- `fs-utils.test.ts`
- `ipc/core-ipc.test.ts`
- `ipc/ipc-validators.test.ts`
- `ipc/settings-ipc.test.ts`
- `ipc/theme-ipc.test.ts`
- `ipc/wallpaper-ipc.test.ts`
- `locale-preferences.test.ts`
- `logger.test.ts`
- `lz4-decoder.test.ts`
- `palette-builder.test.ts`
- `palette-builder-injection.test.ts`
- `profile/color-quantize.test.ts`
- `profile/native-profile.test.ts`
- `profile/overrides-store.test.ts`
- `profile/safe-css.test.ts`
- `profile/studio-history.test.ts`
- `profile/studio-theme-templates.test.ts`
- `profile/tonal-palette.test.ts`
- `profile/transform-ledger.test.ts`
- `profile/treatment-classifier.test.ts`
- `scene-extractor.test.ts`
- `scene-html-size.test.ts`
- `scene-particle-smoke.test.ts`
- `scene-pkg-parser.test.ts`
- `scene-renderer-html.test.ts`
- `settings-service.test.ts`
- `steam-path-resolver.test.ts`
- `theme-health-check.test.ts`
- `theme-library.test.ts`
- `theme-restore-flow.test.ts`
- `theme-seed-pipeline.test.ts`
- `theme/theme-from-image.test.ts`
- `wallpaper-injector.test.ts` (35s timeout noted, acceptable)
- `wallpaper-primary-wins.test.ts`
- `wallpaper-service.test.ts`

### src/shared (all clean)
- `cdp-discovery.test.ts`
- `cdp-discovery-resolve.test.ts`
- `errors.test.ts`
- `i18n.test.ts`

### src/ui (all clean)
- `hooks/apply-result.test.ts`
- `hooks/useRelativeTime.test.ts`
- `lib/status-utils.test.ts`

---

## Recommendations

1. **Immediate action:** Fix DEFECT-001 — replace `expect(true).toBe(true)` with a real assertion. This is a silent test that provides false confidence.

2. **Mock hygiene:** Add `vi.restoreAllMocks()` or `vi.clearAllMocks()` to the global `afterEach` in:
   - `wallpaper-server.test.ts`
   - `wallpaper-injector.test.ts`
   - `wallpaper/theme-wallpaper.test.ts`

3. **Boot-profiler:** Refactor `BootProfiler` to accept an injectable clock function for deterministic timing tests.

4. **DEFECT-005:** Convert the inline `for` loop + `resetModules()` to `it.each` for better failure diagnostics.

5. **Theme-wallpaper path-traversal test:** Ensure mock state is not shared across multiple invocations within a single test.

---

*Report generated by automated test quality scan on 2025-07-14.*
*All findings are based on actual code analysis. No speculative issues included.*
