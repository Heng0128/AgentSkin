// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

vi.mock('./trusted-sender', () => ({
  assertTrustedSender: vi.fn(),
}));

/**
 * withMonitoredTimeout mock — passes through the wrapped promise unchanged so
 * tests can assert it was called with the correct channel + timeout.
 */
vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

/**
 * Mock the treatment-classifier module so the IPC handler can be tested in
 * isolation without invoking colour-quantize / WCAG math.
 */
const mockClassifyAll = vi.fn();
const mockBuildTreatmentCss = vi.fn();

vi.mock('../profile/treatment-classifier', () => ({
  classifyAll: mockClassifyAll,
  buildTreatmentCss: mockBuildTreatmentCss,
}));

const { registerTreatmentClassifierIpc } = await import('./treatment-classifier-ipc');
const { withMonitoredTimeout } = await import('./with-monitored-timeout');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal renderer profiles matching the `RendererProfile` interface. */
const sampleProfiles = [
  { role: 'shell', ref: 'root-area', areaRatio: 0.9, hasText: false, zIndex: 0 },
  { role: 'content', ref: 'chat-panel', areaRatio: 0.2, hasText: true, zIndex: 5 },
  { role: 'other', ref: 'small-icon', areaRatio: 0.01, hasText: false, zIndex: 10 },
];

const sampleVerdicts = [
  {
    ref: 'root-area',
    treatment: 'keep',
    confidence: 0.8,
    evidence: {
      rule: 'small-or-fg-leaf',
      areaRatio: 0.9,
      hasBg: false,
      hasText: false,
      hasInteractive: false,
      depth: 0,
    },
  },
  {
    ref: 'chat-panel',
    treatment: 'frost',
    confidence: 0.85,
    evidence: {
      rule: 'text-container',
      areaRatio: 0.2,
      hasBg: true,
      hasText: true,
      hasInteractive: false,
      depth: 1,
      frost: { opacity: 0.65, blurPx: 20 },
      contrastRatio: 7.0,
      contrastPass: true,
    },
  },
  {
    ref: 'small-icon',
    treatment: 'keep',
    confidence: 0.8,
    evidence: {
      rule: 'small-or-fg-leaf',
      areaRatio: 0.01,
      hasBg: false,
      hasText: false,
      hasInteractive: false,
      depth: 2,
    },
  },
];

const sampleSummary = { remove: 0, transparentize: 0, frost: 1, keep: 2 };

const sampleCss =
  '[data-as-ref="chat-panel"] { background: rgba(255,255,255,0.65) !important; backdrop-filter: blur(20px) !important; }';

const rendererCssVerdicts = [
  { ref: 'chat-panel', action: 'frost', params: { opacity: 0.65, blurPx: 20 } },
  { ref: 'root-area', action: 'keep' },
];

const trustedEvent = { sender: { id: 1 }, senderFrame: { parent: null } };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('treatment-classifier-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();

    // Reset mock returns to defaults.
    mockClassifyAll
      .mockReset()
      .mockReturnValue({ verdicts: sampleVerdicts, summary: sampleSummary });
    mockBuildTreatmentCss.mockReset().mockReturnValue(sampleCss);
  });

  // -----------------------------------------------------------------------
  // 1. registerTreatmentClassifierIpc() handler registration
  // -----------------------------------------------------------------------
  describe('registerTreatmentClassifierIpc()', () => {
    it('registers the TREATMENT_CLASSIFY handler', () => {
      registerTreatmentClassifierIpc();
      expect(handlers.has(IpcChannel.TREATMENT_CLASSIFY)).toBe(true);
    });

    it('registers the TREATMENT_CSS handler', () => {
      registerTreatmentClassifierIpc();
      expect(handlers.has(IpcChannel.TREATMENT_CSS)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. TREATMENT_CLASSIFY handler — normal call
  // -----------------------------------------------------------------------
  describe('TREATMENT_CLASSIFY handler', () => {
    it('returns verdicts and summary for valid profiles', async () => {
      registerTreatmentClassifierIpc();
      mockClassifyAll.mockReturnValueOnce({ verdicts: sampleVerdicts, summary: sampleSummary });

      const handler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      const result = await handler(trustedEvent, sampleProfiles);

      expect(mockClassifyAll).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('verdicts');
      expect(result).toHaveProperty('summary');

      const { verdicts, summary } = result as { verdicts: unknown[]; summary: unknown };
      expect(Array.isArray(verdicts)).toBe(true);
      expect(verdicts).toHaveLength(3);
      expect(summary).toEqual(sampleSummary);

      // Verify renderer verdict shape (ref, action, confidence, evidence).
      const firstVerdict = verdicts[0] as Record<string, unknown>;
      expect(firstVerdict).toHaveProperty('ref');
      expect(firstVerdict).toHaveProperty('action');
      expect(firstVerdict).toHaveProperty('confidence');
      expect(firstVerdict).toHaveProperty('evidence');
      expect(Array.isArray(firstVerdict.evidence)).toBe(true);
    });

    it('passes converted ComponentProfile[] to classifyAll', async () => {
      registerTreatmentClassifierIpc();

      const handler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      await handler(trustedEvent, sampleProfiles);

      const calledWith = mockClassifyAll.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(calledWith).toHaveLength(3);
      // First profile: areaRatio 0.9 → area = 0.9 * 1_000_000 = 900000
      expect(calledWith[0].area).toBe(900_000);
      expect(calledWith[0].ref).toBe('root-area');
      expect(calledWith[0].boxModel).toBeNull();
      expect(calledWith[0].depth).toBe(0);
      expect(calledWith[0].hasText).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. TREATMENT_CLASSIFY handler — empty array
  // -----------------------------------------------------------------------
  describe('TREATMENT_CLASSIFY handler with empty array', () => {
    it('returns empty verdicts and zeroed summary', async () => {
      registerTreatmentClassifierIpc();
      mockClassifyAll.mockReturnValueOnce({
        verdicts: [],
        summary: { remove: 0, transparentize: 0, frost: 0, keep: 0 },
      });

      const handler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      const result = await handler(trustedEvent, []);

      expect(mockClassifyAll).toHaveBeenCalledOnce();
      const { verdicts, summary } = result as {
        verdicts: unknown[];
        summary: { remove: number; transparentize: number; frost: number; keep: number };
      };
      expect(verdicts).toHaveLength(0);
      expect(summary).toEqual({ remove: 0, transparentize: 0, frost: 0, keep: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // 4. TREATMENT_CSS handler — CSS generation
  // -----------------------------------------------------------------------
  describe('TREATMENT_CSS handler', () => {
    it('throws when no classify result is cached', async () => {
      registerTreatmentClassifierIpc();

      // Directly call CSS handler without calling classify first.
      // Since cachedVerdicts is module-level state, this test must run
      // before any test that populates the cache via classify.
      const cssHandler = handlers.get(IpcChannel.TREATMENT_CSS)!;

      await expect(cssHandler(trustedEvent, rendererCssVerdicts)).rejects.toThrow(
        'no classify result available',
      );
    });

    it('returns CSS string from renderer verdicts after classify', async () => {
      registerTreatmentClassifierIpc();

      // First call classify to populate the cached verdicts.
      mockClassifyAll.mockReturnValueOnce({ verdicts: sampleVerdicts, summary: sampleSummary });
      const classifyHandler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      await classifyHandler(trustedEvent, sampleProfiles);

      // Then call CSS handler.
      mockBuildTreatmentCss.mockReturnValueOnce(sampleCss);
      const cssHandler = handlers.get(IpcChannel.TREATMENT_CSS)!;
      const result = await cssHandler(trustedEvent, rendererCssVerdicts);

      expect(mockBuildTreatmentCss).toHaveBeenCalledOnce();
      expect(typeof result).toBe('string');
      expect(result).toContain('backdrop-filter');
      expect(result).toContain('blur(20px)');
    });

    it('reconstructs full verdicts from cache by ref', async () => {
      registerTreatmentClassifierIpc();

      // Populate cache via classify.
      mockClassifyAll.mockReturnValueOnce({ verdicts: sampleVerdicts, summary: sampleSummary });
      const classifyHandler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      await classifyHandler(trustedEvent, sampleProfiles);

      // Request CSS for only one element.
      const cssHandler = handlers.get(IpcChannel.TREATMENT_CSS)!;
      await cssHandler(trustedEvent, [{ ref: 'chat-panel', action: 'frost' }]);

      const calledWith = mockBuildTreatmentCss.mock.calls[0][0] as Array<{ ref: unknown }>;
      // Only the matching ref should be passed.
      expect(calledWith).toHaveLength(1);
      expect(calledWith[0].ref).toBe('chat-panel');
      // The full verdict object should carry evidence with frost params.
      expect(calledWith[0]).toHaveProperty('evidence');
    });
  });

  // -----------------------------------------------------------------------
  // 5. withMonitoredTimeout wrapping
  // -----------------------------------------------------------------------
  describe('withMonitoredTimeout wrapping', () => {
    it('wraps the classify handler with 15000ms timeout', async () => {
      registerTreatmentClassifierIpc();

      const handler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      await handler(trustedEvent, sampleProfiles);

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.TREATMENT_CLASSIFY,
        15_000,
        expect.any(Promise),
      );
    });

    it('wraps the CSS handler with 10000ms timeout', async () => {
      registerTreatmentClassifierIpc();

      // Populate cache.
      const classifyHandler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      await classifyHandler(trustedEvent, sampleProfiles);

      // Reset to isolate CSS handler assertion.
      (withMonitoredTimeout as ReturnType<typeof vi.fn>).mockClear();

      const cssHandler = handlers.get(IpcChannel.TREATMENT_CSS)!;
      await cssHandler(trustedEvent, rendererCssVerdicts);

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.TREATMENT_CSS,
        10_000,
        expect.any(Promise),
      );
    });

    it('returns the inner promise result (passthrough semantics)', async () => {
      registerTreatmentClassifierIpc();

      const handler = handlers.get(IpcChannel.TREATMENT_CLASSIFY)!;
      const result = await handler(trustedEvent, sampleProfiles);

      // Since withMonitoredTimeout passes through the promise, the result
      // should be the actual classify output (not wrapped).
      expect(result).toHaveProperty('verdicts');
      expect(result).toHaveProperty('summary');
    });
  });
});
