// SPDX-License-Identifier: MPL-2.0

/**
 * InspectorPulseInjector unit tests.
 *
 * Every side-effect dependency (process.kill, port discovery, CDP fetch) is
 * injected as a fake so the tests run without real processes or sockets.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  InspectorPulseInjector,
  getPulseInjector,
  enablePersistentPulse,
  disablePersistentPulse,
} from "./pulse-injector.mjs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Minimal stand-in for CdpSession that records evaluate() calls. */
class FakeCdpSession {
  target: { id: string; webSocketDebuggerUrl: string; type?: string };
  closed = false;
  opened = false;
  evaluations: string[] = [];
  shouldFailOpen: Error | null = null;
  shouldFailEval: Error | null = null;

  constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }, _timeoutMs?: number) {
    this.target = target;
  }

  async open() {
    if (this.shouldFailOpen) throw this.shouldFailOpen;
    this.opened = true;
  }

  async evaluate(expression: string) {
    if (this.shouldFailEval) throw this.shouldFailEval;
    this.evaluations.push(expression);
    return { applied: true, appId: "test-app" };
  }

  close() {
    this.closed = true;
  }
}

/** Factory that returns a configurable fake session. */
function makeSessionFactory(instances: FakeCdpSession[]) {
  return (target: { id: string; webSocketDebuggerUrl: string; type?: string }, timeoutMs?: number) => {
    const s = new FakeCdpSession(target, timeoutMs);
    instances.push(s);
    return s;
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const fakeTarget = {
  id: "target-1",
  type: "page",
  url: "http://localhost:9222/page",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/target-1",
};

/** Build a fully-mocked injector with controllable dependencies. */
function makeInjector(overrides: Record<string, unknown> = {}) {
  const defaultKillFn = vi.fn((_pid: number, _signal: NodeJS.Signals | number) => {});
  const defaultReadPortFileFn = vi.fn(async () => null);
  const defaultIsOccupiedFn = vi.fn(async () => false);
  const defaultDiscoverPortFn = vi.fn(async () => 9222);
  const defaultFetchFn = vi.fn(async () => ({
    ok: true,
    json: async () => [fakeTarget],
  }));

  const killFn = (overrides.killFn as typeof defaultKillFn) ?? defaultKillFn;
  const readPortFileFn = (overrides.readPortFileFn as typeof defaultReadPortFileFn) ?? defaultReadPortFileFn;
  const isOccupiedFn = (overrides.isOccupiedFn as typeof defaultIsOccupiedFn) ?? defaultIsOccupiedFn;
  const discoverPortFn = (overrides.discoverPortFn as typeof defaultDiscoverPortFn) ?? defaultDiscoverPortFn;
  const fetchFn = (overrides.fetchFn as typeof defaultFetchFn) ?? defaultFetchFn;

  const injector = new InspectorPulseInjector({
    killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
    readPortFileFn: readPortFileFn as unknown as (portFile: string) => Promise<number | null>,
    isOccupiedFn: isOccupiedFn as unknown as (port: number, timeoutMs?: number) => Promise<boolean>,
    discoverPortFn: discoverPortFn as unknown as (
      start: number,
      end: number,
      timeoutMs: number,
    ) => Promise<number | null>,
    fetchFn: fetchFn as unknown as typeof fetch,
  });

  return { injector, killFn, readPortFileFn, isOccupiedFn, discoverPortFn, fetchFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InspectorPulseInjector — pulseInject success path", () => {
  let sessions: FakeCdpSession[];

  beforeEach(() => {
    sessions = [];
    // Patch CdpSession globally for this test module.
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. sends SIGUSR1 then discovers port and injects CSS", async () => {
    const { injector, killFn, discoverPortFn, fetchFn } = makeInjector();

    // Patch the CdpSession import used inside pulse-injector.mjs.
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        target: { id: string; webSocketDebuggerUrl: string; type?: string };
        closed = false;
        evaluations: string[] = [];
        constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }) {
          this.target = target;
          sessions.push(this as unknown as FakeCdpSession);
        }
        async open() {}
        async evaluate(expression: string) {
          this.evaluations.push(expression);
          return { applied: true };
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // Re-import to pick up the mock.
    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?success1");

    const reInjector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: discoverPortFn as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await reInjector.pulseInject(1234, "body { background: red; }", { appId: "test-app" });

    // SIGUSR1 was sent.
    expect(killFn).toHaveBeenCalledWith(1234, 0); // existence check
    expect(killFn).toHaveBeenCalledWith(1234, "SIGUSR1"); // actual signal

    // Port was discovered.
    expect(discoverPortFn).toHaveBeenCalled();

    // CSS was injected.
    expect(result.ok).toBe(true);
    expect(result.port).toBe(9222);
    expect(result.targetId).toBe("target-1");

    // Session was closed after injection.
    expect(sessions[0]?.closed).toBe(true);

    vi.doUnmock("../cdp/session.mjs");
  });

  it("2. uses explicit port when provided (skips discovery)", async () => {
    const { injector, killFn, discoverPortFn, fetchFn } = makeInjector();

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        target: { id: string; webSocketDebuggerUrl: string; type?: string };
        closed = false;
        evaluations: string[] = [];
        constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }) {
          this.target = target;
        }
        async open() {}
        async evaluate(expression: string) {
          this.evaluations.push(expression);
          return { applied: true };
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?success2");

    const reInjector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: discoverPortFn as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await reInjector.pulseInject(1234, "body { color: blue; }", {
      appId: "my-app",
      port: 9333,
    });

    // Discovery was NOT called because explicit port was given.
    expect(discoverPortFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.port).toBe(9333);

    vi.doUnmock("../cdp/session.mjs");
  });

  it("3. reads DevToolsActivePort file when configured", async () => {
    const { injector, killFn, readPortFileFn, discoverPortFn, fetchFn } = makeInjector({
      readPortFileFn: vi.fn(async () => 9444) as unknown as (f: string) => Promise<number | null>,
    });

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        target: { id: string; webSocketDebuggerUrl: string; type?: string };
        closed = false;
        evaluations: string[] = [];
        constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }) {
          this.target = target;
        }
        async open() {}
        async evaluate(_expression: string) {
          return { applied: true };
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?success3");

    const reInjector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: readPortFileFn as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: discoverPortFn as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await reInjector.pulseInject(5678, "h1 { font-size: 20px; }", {
      appId: "port-file-app",
      devToolsActivePortFile: "/tmp/DevToolsActivePort",
    });

    // Port file was read.
    expect(readPortFileFn).toHaveBeenCalledWith("/tmp/DevToolsActivePort");
    // Range discovery was NOT called because port file gave us a port.
    expect(discoverPortFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.port).toBe(9444);

    vi.doUnmock("../cdp/session.mjs");
  });
});

describe("InspectorPulseInjector — error handling", () => {
  let killFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../cdp/session.mjs");
  });

  it("4. throws AGENTSKIN_PULSE_PROCESS_NOT_FOUND when process does not exist", async () => {
    killFn = vi.fn((_pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) {
        const err = new Error("ESRCH");
        throw err;
      }
    });

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?err1");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch,
    });

    await expect(injector.pulseInject(99999, "body {}", {})).rejects.toMatchObject({
      code: "AGENTSKIN_PULSE_PROCESS_NOT_FOUND",
    });
  });

  it("5. throws AGENTSKIN_PULSE_PORT_TIMEOUT when no port is discovered", async () => {
    killFn = vi.fn(() => {});

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?err2");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => null) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch,
    });

    await expect(
      injector.pulseInject(1234, "body {}", { portDiscoveryTimeoutMs: 50 }),
    ).rejects.toMatchObject({
      code: "AGENTSKIN_PULSE_PORT_TIMEOUT",
    });
  });

  it("6. throws AGENTSKIN_PULSE_NO_TARGET when no page target exists", async () => {
    killFn = vi.fn(() => {});

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?err3");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => [{ id: "svc", type: "service_worker", webSocketDebuggerUrl: "ws://x" }],
      })) as unknown as typeof fetch,
    });

    await expect(injector.pulseInject(1234, "body {}", {})).rejects.toMatchObject({
      code: "AGENTSKIN_PULSE_NO_TARGET",
    });
  });

  it("7. throws AGENTSKIN_PULSE_INJECT_FAILED when CDP evaluate throws", async () => {
    killFn = vi.fn(() => {});

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          throw new Error("Renderer evaluation failed: foo is not defined");
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?err4");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => [fakeTarget],
      })) as unknown as typeof fetch,
    });

    await expect(injector.pulseInject(1234, "body {}", {})).rejects.toMatchObject({
      code: "AGENTSKIN_PULSE_INJECT_FAILED",
    });
  });

  it("8. closes the CDP session even when injection fails", async () => {
    killFn = vi.fn(() => {});
    const closeSpy = vi.fn();

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          throw new Error("boom");
        }
        close() {
          this.closed = true;
          closeSpy();
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?err5");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => [fakeTarget],
      })) as unknown as typeof fetch,
    });

    await expect(injector.pulseInject(1234, "body {}", {})).rejects.toThrow();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe("InspectorPulseInjector — persistent mode", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../cdp/session.mjs");
  });

  it("9. enablePersistentPulse registers an agent", async () => {
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?persist1");
    const injector = new Reimported({
      killFn: vi.fn() as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [fakeTarget] })) as unknown as typeof fetch,
    });

    const result = injector.enablePersistentPulse("agent-alpha", "body { color: green; }");
    expect(result.enabled).toBe(true);
    expect(result.agentId).toBe("agent-alpha");
    expect(injector.listPersistentAgents()).toContain("agent-alpha");
  });

  it("10. enablePersistentPulse throws if agent already registered", async () => {
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?persist2");
    const injector = new Reimported({
      killFn: vi.fn() as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [fakeTarget] })) as unknown as typeof fetch,
    });

    injector.enablePersistentPulse("agent-beta", "body {}");
    expect(() => injector.enablePersistentPulse("agent-beta", "body {}")).toThrow(/already enabled/);
  });

  it("11. disablePersistentPulse unregisters an agent", async () => {
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?persist3");
    const injector = new Reimported({
      killFn: vi.fn() as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [fakeTarget] })) as unknown as typeof fetch,
    });

    injector.enablePersistentPulse("agent-gamma", "body {}");
    const result = injector.disablePersistentPulse("agent-gamma");
    expect(result.disabled).toBe(true);
    expect(result.agentId).toBe("agent-gamma");
    expect(injector.listPersistentAgents()).not.toContain("agent-gamma");
  });

  it("12. disablePersistentPulse returns reason=not-registered for unknown agent", async () => {
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?persist4");
    const injector = new Reimported({
      killFn: vi.fn() as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [fakeTarget] })) as unknown as typeof fetch,
    });

    const result = injector.disablePersistentPulse("nonexistent");
    expect(result.disabled).toBe(false);
    expect(result.reason).toBe("not-registered");
  });

  it("13. listPersistentAgents returns all registered agent ids", async () => {
    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        closed = false;
        async open() {}
        async evaluate() {
          return {};
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?persist5");
    const injector = new Reimported({
      killFn: vi.fn() as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({ ok: true, json: async () => [fakeTarget] })) as unknown as typeof fetch,
    });

    injector.enablePersistentPulse("a1", "body {}");
    injector.enablePersistentPulse("a2", "body {}");
    injector.enablePersistentPulse("a3", "body {}");

    const agents = injector.listPersistentAgents();
    expect(agents).toHaveLength(3);
    expect(agents).toContain("a1");
    expect(agents).toContain("a2");
    expect(agents).toContain("a3");
  });
});

describe("InspectorPulseInjector — CSS expression building", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../cdp/session.mjs");
  });

  it("14. injects CSS with correct appId marker in the expression", async () => {
    const killFn = vi.fn(() => {});
    const capturedExpressions: string[] = [];

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        target: { id: string; webSocketDebuggerUrl: string; type?: string };
        closed = false;
        constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }) {
          this.target = target;
        }
        async open() {}
        async evaluate(expression: string) {
          capturedExpressions.push(expression);
          return { applied: true };
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?css1");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => [fakeTarget],
      })) as unknown as typeof fetch,
    });

    const css = "div.header { background: #333 !important; }";
    await injector.pulseInject(1234, css, { appId: "my-skin" });

    expect(capturedExpressions).toHaveLength(1);
    expect(capturedExpressions[0]).toContain("my-skin");
    // The expression builds the id via concatenation: 'agentskin-pulse-' + APP_ID.
    // Verify both halves are present (the runtime result is agentskin-pulse-my-skin).
    expect(capturedExpressions[0]).toContain("'agentskin-pulse-' + APP_ID");
    expect(capturedExpressions[0]).toContain("#333");
  });

  it("15. removes existing style element with same appId before injecting", async () => {
    const killFn = vi.fn(() => {});
    const capturedExpressions: string[] = [];

    vi.doMock("../cdp/session.mjs", () => ({
      CdpSession: class MockSession {
        target: { id: string; webSocketDebuggerUrl: string; type?: string };
        closed = false;
        constructor(target: { id: string; webSocketDebuggerUrl: string; type?: string }) {
          this.target = target;
        }
        async open() {}
        async evaluate(expression: string) {
          capturedExpressions.push(expression);
          return { applied: true };
        }
        close() {
          this.closed = true;
        }
      },
    }));

    // @ts-ignore - query string import for vi.resetModules() re-import
    const { InspectorPulseInjector: Reimported } = await import("./pulse-injector.mjs?css2");
    const injector = new Reimported({
      killFn: killFn as unknown as (pid: number, signal: NodeJS.Signals) => void,
      readPortFileFn: vi.fn(async () => null) as unknown as (f: string) => Promise<number | null>,
      isOccupiedFn: vi.fn(async () => false) as unknown as (p: number, t?: number) => Promise<boolean>,
      discoverPortFn: vi.fn(async () => 9222) as unknown as (s: number, e: number, t: number) => Promise<number | null>,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => [fakeTarget],
      })) as unknown as typeof fetch,
    });

    await injector.pulseInject(1234, "body {}", { appId: "reapply-test" });

    // The expression should contain logic to remove the previous element.
    expect(capturedExpressions[0]).toContain("remove()");
    expect(capturedExpressions[0]).toContain("getElementById");
  });
});

describe("InspectorPulseInjector — singleton exports", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../cdp/session.mjs");
  });

  it("16. getPulseInjector returns a singleton instance", async () => {
    // @ts-ignore - query string import for vi.resetModules() re-import
    const { getPulseInjector: getIt } = await import("./pulse-injector.mjs?singleton1");
    const a = getIt();
    const b = getIt();
    expect(a).toBe(b);
  });

  it("17. convenience functions delegate to the singleton", async () => {
    // We can't easily test the convenience functions without mocking the
    // singleton, but we verify they are exported and callable.
    expect(typeof enablePersistentPulse).toBe("function");
    expect(typeof disablePersistentPulse).toBe("function");
  });
});
