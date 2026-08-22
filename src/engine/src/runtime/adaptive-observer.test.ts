import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock MutationObserver for Node.js test environment
// ---------------------------------------------------------------------------

interface MockMutationRecord {
  target: Node;
  type: string;
  addedNodes: Node[];
  removedNodes: Node[];
}

function createMockNode(id: string): Node {
  return { nodeType: 1, nodeName: id } as unknown as Node;
}

class MockMutationObserver {
  private callback: (records: MockMutationRecord[]) => void;
  public target: Node | null = null;
  public options: Record<string, unknown> | null = null;
  public connected = false;
  private static _instances: MockMutationObserver[] = [];

  constructor(callback: (records: MockMutationRecord[]) => void) {
    this.callback = callback;
    MockMutationObserver._instances.push(this);
  }

  observe(target: Node, options: Record<string, unknown>): void {
    this.target = target;
    this.options = options;
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  takeRecords(): MockMutationRecord[] {
    return [];
  }

  /** Dispatch mock mutation records (test helper) */
  _dispatch(records: MockMutationRecord[]): void {
    if (this.connected) {
      this.callback(records);
    }
  }

  static get instances(): MockMutationObserver[] {
    return MockMutationObserver._instances;
  }

  static reset(): void {
    MockMutationObserver._instances = [];
  }
}

// ---------------------------------------------------------------------------
// Import after mock setup
// ---------------------------------------------------------------------------

type MutationCallback = (records: MockMutationRecord[]) => void;

interface AdaptiveMutationObserverInterface {
  observe(target: unknown, options: unknown): void;
  disconnect(): void;
  takeRecords(): MockMutationRecord[];
  // Expose internals for testing
  isThrottled: boolean;
  attemptCount: number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdaptiveMutationObserver', () => {
  let AdaptiveMutationObserver: new (
    callback: MutationCallback,
    options?: Partial<{
      throttleWindow: number;
      throttleMaxAttempts: number;
      retryTimeout: number;
      loopThreshold: number;
      loopMaxCycles: number;
    }>,
  ) => AdaptiveMutationObserverInterface;

  beforeEach(async () => {
    MockMutationObserver.reset();
    vi.restoreAllMocks();

    // Set global MutationObserver mock
    (globalThis as Record<string, unknown>).MutationObserver =
      MockMutationObserver;

    // Dynamic import after mock is set
    const mod = await import('./adaptive-observer.mjs');
    AdaptiveMutationObserver = mod.AdaptiveMutationObserver as unknown as new (
      callback: MutationCallback,
    ) => AdaptiveMutationObserverInterface;
  });

  afterEach(() => {
    vi.useRealTimers();
    MockMutationObserver.reset();
  });

  // -------------------------------------------------------------------------
  // Test 1: Normal mutation handling
  // -------------------------------------------------------------------------
  it('should process normal mutations without throttling', () => {
    const callback = vi.fn();
    const obs = new AdaptiveMutationObserver(callback);
    const mockTarget = createMockNode('body');

    obs.observe(mockTarget, { childList: true, subtree: true });

    // Simulate normal mutation batch (5 calls, well under the 50/10s limit)
    const innerObs = MockMutationObserver.instances[0];
    for (let i = 0; i < 5; i++) {
      innerObs._dispatch([
        { target: createMockNode(`el${i}`), type: 'childList', addedNodes: [createMockNode('a')], removedNodes: [] },
      ]);
    }

    expect(callback).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  // Test 2: Throttle trigger (51 mutations in same window)
  // -------------------------------------------------------------------------
  it('should enter cooldown after exceeding throttleMaxAttempts', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 10000,
      throttleMaxAttempts: 50,
      retryTimeout: 2000,
    });

    const mockTarget = createMockNode('body');
    obs.observe(mockTarget, { childList: true });

    const innerObs = MockMutationObserver.instances[0];

    // Dispatch 51 mutations rapidly (each targeting a unique element to avoid loop detection)
    for (let i = 0; i < 51; i++) {
      innerObs._dispatch([
        {
          target: createMockNode(`unique_${i}`),
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }

    // First 50 should be processed, 51st triggers cooldown
    expect(callback).toHaveBeenCalledTimes(50);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[AgentSkin] MutationObserver throttled for 2000ms',
    );

    // After cooldown triggered, further mutations should be silently dropped
    innerObs._dispatch([
      {
        target: createMockNode('after_throttle'),
        type: 'childList',
        addedNodes: [],
        removedNodes: [],
      },
    ]);
    expect(callback).toHaveBeenCalledTimes(50); // still 50, no new calls

    consoleWarnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 3: Cooldown recovery
  // -------------------------------------------------------------------------
  it('should resume processing after cooldown period elapses', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 10000,
      throttleMaxAttempts: 5,
      retryTimeout: 2000,
      loopThreshold: 1000,
      loopMaxCycles: 10,
    });

    obs.observe(createMockNode('body'), { childList: true });
    const innerObs = MockMutationObserver.instances[0];

    // Trigger throttle with 6 rapid unique mutations (limit is 5)
    for (let i = 0; i < 6; i++) {
      innerObs._dispatch([
        {
          target: createMockNode(`storm_${i}`),
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }
    expect(callback).toHaveBeenCalledTimes(5);

    // Advance past cooldown period
    vi.advanceTimersByTime(2100);

    // After cooldown, should be able to process again
    innerObs._dispatch([
      {
        target: createMockNode('recovery'),
        type: 'childList',
        addedNodes: [],
        removedNodes: [],
      },
    ]);
    expect(callback).toHaveBeenCalledTimes(6);
  });

  // -------------------------------------------------------------------------
  // Test 4: Loop detection (same element mutating rapidly)
  // -------------------------------------------------------------------------
  it('should skip mutations from elements in a rapid change loop', () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 10000,
      throttleMaxAttempts: 50,
      retryTimeout: 2000,
      loopThreshold: 1000,
      loopMaxCycles: 3, // low threshold for testing
    });

    obs.observe(createMockNode('body'), { childList: true, subtree: true });
    const innerObs = MockMutationObserver.instances[0];

    const loopingEl = createMockNode('looping-element');

    // Send 5 mutations targeting the same element within 1000ms
    for (let i = 0; i < 5; i++) {
      innerObs._dispatch([
        {
          target: loopingEl,
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }

    // 1st mutation: recorded (count=1, not yet > loopMaxCycles)
    // 2nd: count=2, processed
    // 3rd: count=3, processed (not > 3)
    // 4th: count=4 > 3 → skipped (looping)
    // 5th: count=5 > 3 → skipped (looping)
    expect(callback).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Test 5: Disconnect cleanup
  // -------------------------------------------------------------------------
  it('should disconnect cleanly and cancel pending cooldown timers', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 10000,
      throttleMaxAttempts: 3,
      retryTimeout: 5000,
    });

    const mockTarget = createMockNode('body');
    obs.observe(mockTarget, { childList: true });

    const innerObs = MockMutationObserver.instances[0];
    expect(innerObs.connected).toBe(true);

    // Trigger cooldown
    for (let i = 0; i < 4; i++) {
      innerObs._dispatch([
        {
          target: createMockNode(`disc_${i}`),
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }
    expect(callback).toHaveBeenCalledTimes(3);

    // Disconnect should clean up the cooldown timer
    obs.disconnect();
    expect(innerObs.connected).toBe(false);

    // Advancing time past the original cooldown should not cause issues
    vi.advanceTimersByTime(6000);
    // No error, no additional callback calls
    expect(callback).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Test 6: Window reset after throttle window expires
  // -------------------------------------------------------------------------
  it('should reset attempt count when throttle window expires', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 5000,
      throttleMaxAttempts: 5,
      retryTimeout: 2000,
    });

    obs.observe(createMockNode('body'), { childList: true });
    const innerObs = MockMutationObserver.instances[0];

    // Use up 3 attempts
    for (let i = 0; i < 3; i++) {
      innerObs._dispatch([
        {
          target: createMockNode(`win_${i}`),
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }
    expect(callback).toHaveBeenCalledTimes(3);
    expect(obs.attemptCount).toBe(3);

    // Advance past window size — window reset is lazy (applies on next mutation)
    vi.advanceTimersByTime(5100);

    // Next mutation triggers window reset: attemptCount → 0, then → 1
    innerObs._dispatch([
      {
        target: createMockNode('after_window_reset'),
        type: 'childList',
        addedNodes: [],
        removedNodes: [],
      },
    ]);
    expect(callback).toHaveBeenCalledTimes(4);
    expect(obs.attemptCount).toBe(1); // reset to 0, then incremented to 1
  });

  // -------------------------------------------------------------------------
  // Test 7: Custom options merge correctly
  // -------------------------------------------------------------------------
  it('should accept custom options and override defaults', () => {
    const callback = vi.fn();
    const obs = new AdaptiveMutationObserver(callback, {
      throttleMaxAttempts: 100,
      retryTimeout: 5000,
    });

    obs.observe(createMockNode('body'), { childList: true });
    const innerObs = MockMutationObserver.instances[0];

    // Process 50 mutations — should NOT throttle (limit is now 100)
    for (let i = 0; i < 50; i++) {
      innerObs._dispatch([
        {
          target: createMockNode(`custom_${i}`),
          type: 'childList',
          addedNodes: [],
          removedNodes: [],
        },
      ]);
    }
    expect(callback).toHaveBeenCalledTimes(50); // no throttle yet
    expect(obs.isThrottled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 8: Callback receives filtered records
  // -------------------------------------------------------------------------
  it('should pass filtered mutation records to callback (without looping ones)', () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    const obs = new AdaptiveMutationObserver(callback, {
      throttleWindow: 10000,
      throttleMaxAttempts: 50,
      retryTimeout: 2000,
      loopThreshold: 1000,
      loopMaxCycles: 2,
    });

    obs.observe(createMockNode('body'), { childList: true });
    const innerObs = MockMutationObserver.instances[0];

    const normalEl = createMockNode('normal');
    const loopingEl = createMockNode('looping');

    // Build a batch with one looping element and one normal element
    // First: send 3 mutations for the looping element to trigger loop detection
    innerObs._dispatch([{ target: loopingEl, type: 'childList', addedNodes: [createMockNode('a')], removedNodes: [] }]);
    innerObs._dispatch([{ target: loopingEl, type: 'childList', addedNodes: [createMockNode('b')], removedNodes: [] }]);
    innerObs._dispatch([{ target: loopingEl, type: 'childList', addedNodes: [createMockNode('c')], removedNodes: [] }]);

    // Now: looping el is in a loop (count=3 > 2). 
    // Batch: one looping record + one normal record
    callback.mockClear();
    innerObs._dispatch([
      { target: loopingEl, type: 'childList', addedNodes: [createMockNode('d')], removedNodes: [] },
      { target: normalEl, type: 'childList', addedNodes: [createMockNode('e')], removedNodes: [] },
    ]);

    // Callback should receive only the normal record, not the looping one
    expect(callback).toHaveBeenCalledTimes(1);
    const receivedRecords = callback.mock.calls[0][0] as MockMutationRecord[];
    expect(receivedRecords).toHaveLength(1);
    expect(receivedRecords[0].target).toBe(normalEl);
  });
});
