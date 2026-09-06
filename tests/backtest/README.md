# Backtest Framework

Layered regression testing for AgentSkin's CDP (Chrome DevTools Protocol) modules.

## Three-Layer Testing Philosophy

```
L0 ── Static        pure functions, no I/O, no timers        ~instant
L1 ── Unit          mocked side effects (fs, process, timers) ~fast
L2 ── Integration   mocked protocol (WebSocket), real timers  ~medium+
```

Each layer is a strict superset of the layers below it in terms of what it
validates, but *not* in terms of runtime. L0 tests are the fastest and most
stable; L2 tests are the slowest but cover the most ground.

### L0 — Static (no side effects)

**What belongs here:**
- Pure functions that compute outputs from inputs deterministically
- Type-level invariants (e.g., "6 adapters must have unique ports")
- Color math, string parsing, key derivation, configuration lookups

**What does NOT belong here:**
- Anything that touches `fs`, `process`, `setTimeout`, `Math.random()`, or `Date.now()`
- Anything that imports a module with side effects at module scope

**Files:**
- `l0-static.test.ts` — port-config, contrast-utils, session-pool key derivation

### L1 — Unit (mocked side effects)

**What belongs here:**
- Logic that *would* touch the filesystem, network, or process, but is tested
  with those operations mocked via `vi.mock()`
- The `WatchdogDeps` pattern: inject all side effects so the core logic is
  testable without real signals or CPU sampling
- The `PortLeasePool` pattern: mock `fs.mkdir`/`fs.writeFile`/`fs.rm` to
  simulate port contention without real filesystem I/O

**What does NOT belong here:**
- Real `setInterval`/`setTimeout` with wall-clock waits (use `vi.useFakeTimers()`)
- Real filesystem or network I/O

**Files:**
- `l1-port-lease.test.ts` — PortLeasePool with mocked fs
- `l1-watchdog.test.ts` — Watchdog with mocked process/timers

### L2 — Integration (mocked protocol, real timers)

**What belongs here:**
- Full lifecycle testing: create → use → destroy
- State machines with real timing (real `setInterval` for scan timers)
- Protocol-level behavior: CDP WebSocket message dispatch, request/response
  matching, event routing
- Concurrent operations: parallel acquires, race conditions

**What does NOT belong here:**
- Real network connections to actual CDP targets (use mocked WebSocket)
- Real process spawning

**Files:**
- `l2-session-pool.test.ts` — Session pool lifecycle
- `l2-cdp-client.test.ts` — CDP client state transitions

## Running Tests

```bash
# Run all backtest layers
npm run test:backtest

# Run individual layers
npm run test:backtest:l0    # L0 static only
npm run test:backtest:l1    # L1 mocked only
npm run test:backtest:l2    # L2 integration only
```

## Adding New Tests

### Convention

1. Place the test file in `tests/backtest/` with the appropriate layer prefix.
2. Use the SPDX header: `// SPDX-License-Identifier: MPL-2.0`
3. Follow the pattern: each layer has its own conditions and mocked modules.
4. Use `vi.mock()` to mock dependencies.

### File naming

```
l0-<module>.test.ts   — L0 static tests for <module>
l1-<module>.test.ts   — L1 unit tests for <module>
l2-<module>.test.ts   — L2 integration tests for <module>
```

### When to add a test

| Change type | Layer to add |
|---|---|
| New pure function (color math, config lookup) | L0 |
| Bug fix in pure function | L0 (regression guard) |
| New side-effecting logic (watchdog, port lease) | L1 with mocked deps |
| Bug fix in side-effecting logic | L1 (regression guard) |
| New lifecycle or state machine | L2 |
| Bug fix in lifecycle behavior | L2 (regression guard) |

### Test runtime budget

| Layer | Target per test file | Max acceptable |
|---|---|---|
| L0 | < 500ms | 2s |
| L1 | < 2s | 5s |
| L2 | < 10s | 30s |

## Architecture Notes

### Why not a single flat test directory?

The existing tests under `src/main/cdp/*.test.ts` are colocated with their
source. This is excellent for discoverability. The `tests/backtest/` directory
complements (not replaces) them by providing:

1. **Convention enforcement** — the layer prefix makes the testing strategy
   explicit and grep-able.
2. **Fast CI gates** — `npm run test:backtest:l0` runs in < 2s and catches
   regressions in pure functions before the slower L1/L2 suites.
3. **New-contributor onboarding** — the README documents *what* to test and
   *where*, eliminating guesswork.

### Relationship to colocated tests

Colocated tests (`src/main/cdp/watchdog.test.ts`, `port-lease-pool.test.ts`,
etc.) remain the canonical, exhaustive test suites. The backtest framework
curates a subset of cross-cutting regression tests organized by layer.
