// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SessionPool, targetKeyFor } from "./session-pool-runtime.mjs";

type Target = { id?: string; url?: string; webSocketDebuggerUrl?: string };

/** Minimal stand-in for CdpSession that needs no WebSocket. */
class FakeSession {
  target: Target;
  closed: boolean;

  constructor(target: Target) {
    this.target = target;
    this.closed = false;
  }
  open() {
    this.closed = false;
    return Promise.resolve(this);
  }
  close() {
    this.closed = true;
  }
}

function fakeTarget(id = "t1"): Target {
  return { id, url: "about:blank", webSocketDebuggerUrl: `ws://127.0.0.1:1/devtools/${id}` };
}

/** Build a pool whose opener always returns a FakeSession. */
function makePool(opts: { ttlMs?: number } = {}): SessionPool {
  return new SessionPool({ open: (target: Target) => Promise.resolve(new FakeSession(target)), ...opts });
}

describe("targetKeyFor", () => {
  it("prefers target.id", () => {
    assert.equal(targetKeyFor(fakeTarget("t1")), "t1");
  });
  it("falls back to the WS URL", () => {
    assert.equal(targetKeyFor({ webSocketDebuggerUrl: "ws://x" }), "ws://x");
  });
  it("falls back to unknown-target", () => {
    assert.equal(targetKeyFor({}), "unknown-target");
  });
});

describe("SessionPool", () => {
  it("acquires a session once and reuses it for the same target", async () => {
    const pool = makePool();
    const target = fakeTarget("t1");
    const a = await pool.acquire(target);
    const b = await pool.acquire(target);
    assert.equal(a, b, "the same pooled session must be reused");
    assert.equal(pool.size, 1);
    pool.dispose();
  });

  it("reuses the same session across release()/acquire()", async () => {
    const pool = makePool();
    const target = fakeTarget("t1");
    const s1 = await pool.acquire(target);
    pool.release(target, s1);
    const s2 = await pool.acquire(target);
    assert.equal(s1, s2);
    pool.dispose();
  });

  it("opens a distinct session per distinct target", async () => {
    const opened: FakeSession[] = [];
    const pool = new SessionPool({
      open: (target: Target) => {
        const s = new FakeSession(target);
        opened.push(s);
        return Promise.resolve(s);
      },
    });
    const a = await pool.acquire(fakeTarget("t1"));
    const b = await pool.acquire(fakeTarget("t2"));
    assert.ok(a !== b);
    assert.equal(opened.length, 2);
    assert.equal(pool.size, 2);
    pool.dispose();
  });

  it("drops a closed cached session and reopens on next acquire", async () => {
    const pool = makePool();
    const target = fakeTarget("t1");
    const s1 = await pool.acquire(target);
    const stale = s1;
    s1.close(); // simulate a remotely-disposed socket
    const s2 = await pool.acquire(target);
    assert.equal(stale.closed, true);
    assert.ok(s2 !== stale, "a closed cached session must not be reused");
    assert.equal(s2.closed, false);
    pool.dispose();
  });

  it("release() closes a foreign (non-pooled) session defensively", async () => {
    const pool = makePool();
    const foreign = new FakeSession(fakeTarget("outsider"));
    pool.release(fakeTarget("outsider"), foreign);
    assert.equal(foreign.closed, true);
    pool.dispose();
  });

  it("invalidate() closes and removes a specific pooled session", async () => {
    const pool = makePool();
    const target = fakeTarget("t1");
    const s1 = await pool.acquire(target);
    pool.invalidate(target);
    assert.equal(s1.closed, true);
    assert.equal(pool.size, 0);
    pool.dispose();
  });

  it("prunes idle entries beyond ttlMs", async () => {
    const pool = makePool({ ttlMs: 10 });
    const target = fakeTarget("t1");
    const s1 = await pool.acquire(target);
    assert.equal(pool.size, 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    pool.prune();
    assert.equal(pool.size, 0);
    assert.equal(s1.closed, true);
    pool.dispose();
  });

  it("dispose() closes every pooled session and clears the pool", async () => {
    const pool = makePool();
    const s1 = await pool.acquire(fakeTarget("t1"));
    const s2 = await pool.acquire(fakeTarget("t2"));
    assert.equal(pool.size, 2);
    pool.dispose();
    assert.equal(s1.closed, true);
    assert.equal(s2.closed, true);
    assert.equal(pool.size, 0);
  });
});