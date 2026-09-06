// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

/**
 * TransformLedger mock — the real class is a pure in-memory container but we
 * mock it to isolate the IPC handler logic from storage internals. Each
 * method is a standalone vi.fn() so tests can assert call args and control
 * return values per-test.
 */
const mockLedgerUpsert = vi.fn();
const mockLedgerFindByRef = vi.fn();
const mockLedgerToggle = vi.fn();
const mockLedgerSetActionEnabled = vi.fn();
const mockLedgerToCss = vi.fn();
const mockLedgerAll = vi.fn();
const mockLedgerSummary = vi.fn();

vi.mock('../profile/transform-ledger', () => ({
  TransformLedger: class {
    upsert = mockLedgerUpsert;
    findByRef = mockLedgerFindByRef;
    toggle = mockLedgerToggle;
    setActionEnabled = mockLedgerSetActionEnabled;
    toCss = mockLedgerToCss;
    all = mockLedgerAll;
    summary = mockLedgerSummary;
  },
}));

/**
 * OverridesStore mock — same rationale as TransformLedger. The IPC layer only
 * cares about method signatures and return shapes, not the in-memory state.
 */
const mockOverridesWhitelist = vi.fn();
const mockOverridesBlacklist = vi.fn();
const mockOverridesConfirm = vi.fn();
const mockOverridesMetrics = vi.fn();

vi.mock('../profile/overrides-store', () => ({
  OverridesStore: class {
    whitelist = mockOverridesWhitelist;
    blacklist = mockOverridesBlacklist;
    confirm = mockOverridesConfirm;
    metrics = mockOverridesMetrics;
  },
}));

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

const { registerTransformLedgerIpc } = await import('./transform-ledger-ipc');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transform-ledger-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockLedgerUpsert.mockReset();
    mockLedgerFindByRef.mockReset();
    mockLedgerToggle.mockReset();
    mockLedgerSetActionEnabled.mockReset();
    mockLedgerToCss.mockReset();
    mockLedgerAll.mockReset();
    mockLedgerSummary.mockReset();
    mockOverridesWhitelist.mockReset();
    mockOverridesBlacklist.mockReset();
    mockOverridesConfirm.mockReset();
    mockOverridesMetrics.mockReset();
  });

  // -----------------------------------------------------------------------
  // 1. registerTransformLedgerIpc() — handler registration
  // -----------------------------------------------------------------------
  describe('registerTransformLedgerIpc()', () => {
    it('registers all 9 IPC channels', () => {
      registerTransformLedgerIpc();
      expect(handlers.size).toBe(9);
      expect(handlers.has(IpcChannel.TRANSFORM_LEDGER_UPSERT)).toBe(true);
      expect(handlers.has(IpcChannel.TRANSFORM_LEDGER_TOGGLE)).toBe(true);
      expect(handlers.has(IpcChannel.TRANSFORM_LEDGER_SET_ACTION)).toBe(true);
      expect(handlers.has(IpcChannel.TRANSFORM_LEDGER_CSS)).toBe(true);
      expect(handlers.has(IpcChannel.TRANSFORM_LEDGER_GET)).toBe(true);
      expect(handlers.has(IpcChannel.OVERRIDES_WHITELIST)).toBe(true);
      expect(handlers.has(IpcChannel.OVERRIDES_BLACKLIST)).toBe(true);
      expect(handlers.has(IpcChannel.OVERRIDES_CONFIRM)).toBe(true);
      expect(handlers.has(IpcChannel.OVERRIDES_METRICS)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. TRANSFORM_LEDGER_UPSERT handler
  // -----------------------------------------------------------------------
  describe('TRANSFORM_LEDGER_UPSERT handler', () => {
    it('returns { ok: true } for a valid entry', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_UPSERT)!;

      const entry = { targetRef: 'ref-1', action: 'frost' };
      const result = await (handler({}, entry) as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockLedgerUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ targetRef: 'ref-1', action: 'frost' }),
      );
    });

    it('passes through optional params and source', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_UPSERT)!;

      const entry = {
        targetRef: 'ref-2',
        action: 'remove',
        params: { opacity: 0.5 },
        source: 'auto',
        enabled: false,
      };
      const result = await (handler({}, entry) as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockLedgerUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRef: 'ref-2',
          action: 'remove',
          params: { opacity: 0.5 },
          source: 'auto',
          enabled: false,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. TRANSFORM_LEDGER_TOGGLE handler
  // -----------------------------------------------------------------------
  describe('TRANSFORM_LEDGER_TOGGLE handler', () => {
    it('returns { ok: true, enabled: boolean }', async () => {
      mockLedgerFindByRef.mockReturnValueOnce({ id: 'ledger-1', targetRef: 'ref-1' });
      mockLedgerToggle.mockReturnValueOnce(true);

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_TOGGLE)!;

      const result = await (handler({}, 'ref-1') as { ok: boolean; enabled: boolean });

      expect(result).toEqual({ ok: true, enabled: true });
      expect(mockLedgerFindByRef).toHaveBeenCalledWith('ref-1');
      expect(mockLedgerToggle).toHaveBeenCalledWith('ledger-1');
    });

    it('returns { ok: true, enabled: false } when toggled off', async () => {
      mockLedgerFindByRef.mockReturnValueOnce({ id: 'ledger-2', targetRef: 'ref-2' });
      mockLedgerToggle.mockReturnValueOnce(false);

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_TOGGLE)!;

      const result = await (handler({}, 'ref-2') as { ok: boolean; enabled: boolean });

      expect(result).toEqual({ ok: true, enabled: false });
    });

    it('throws when targetRef is not found', async () => {
      mockLedgerFindByRef.mockReturnValueOnce(undefined);

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_TOGGLE)!;

      await expect(handler({}, 'unknown-ref')).rejects.toThrow(
        'No ledger entry for targetRef: unknown-ref',
      );
    });
  });

  // -----------------------------------------------------------------------
  // 4. TRANSFORM_LEDGER_SET_ACTION handler
  // -----------------------------------------------------------------------
  describe('TRANSFORM_LEDGER_SET_ACTION handler', () => {
    it('returns { ok: true }', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_SET_ACTION)!;

      const result = await (handler({}, 'frost', true) as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockLedgerSetActionEnabled).toHaveBeenCalledWith('frost', true);
    });

    it('passes enabled=false to disable an action globally', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_SET_ACTION)!;

      const result = await (handler({}, 'remove', false) as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockLedgerSetActionEnabled).toHaveBeenCalledWith('remove', false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. TRANSFORM_LEDGER_CSS handler
  // -----------------------------------------------------------------------
  describe('TRANSFORM_LEDGER_CSS handler', () => {
    it('returns a string', async () => {
      mockLedgerToCss.mockReturnValueOnce(
        '[data-as-ref="ref-1"] { background: transparent !important; }',
      );

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_CSS)!;

      const result = await (handler({}) as string);

      expect(typeof result).toBe('string');
      expect(mockLedgerToCss).toHaveBeenCalledOnce();
    });

    it('returns empty string when no CSS rules are generated', async () => {
      mockLedgerToCss.mockReturnValueOnce('');

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_CSS)!;

      const result = await (handler({}) as string);

      expect(result).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 6. TRANSFORM_LEDGER_GET handler
  // -----------------------------------------------------------------------
  describe('TRANSFORM_LEDGER_GET handler', () => {
    it('returns { entries: [...], summary: {...} }', async () => {
      mockLedgerAll.mockReturnValueOnce([
        {
          id: 'ledger-1',
          targetRef: 'ref-1',
          action: 'frost',
          enabled: true,
          source: 'auto',
          params: undefined,
          baseline: {},
          after: undefined,
        },
      ]);
      mockLedgerSummary.mockReturnValueOnce({
        total: 1,
        enabled: 1,
        byAction: { remove: 0, transparentize: 0, frost: 1, keep: 0 },
      });

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_GET)!;

      const result = await handler({});

      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('summary');
      const typed = result as { entries: unknown[]; summary: { total: number; enabled: number } };
      expect(Array.isArray(typed.entries)).toBe(true);
      expect(typed.entries).toHaveLength(1);
      expect(typed.summary.total).toBe(1);
      expect(typed.summary.enabled).toBe(1);
    });

    it('returns empty entries when ledger is empty', async () => {
      mockLedgerAll.mockReturnValueOnce([]);
      mockLedgerSummary.mockReturnValueOnce({
        total: 0,
        enabled: 0,
        byAction: { remove: 0, transparentize: 0, frost: 0, keep: 0 },
      });

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.TRANSFORM_LEDGER_GET)!;

      const result = (await handler({})) as { entries: unknown[]; summary: { total: number } };

      expect(result.entries).toEqual([]);
      expect(result.summary.total).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. OVERRIDES_WHITELIST handler
  // -----------------------------------------------------------------------
  describe('OVERRIDES_WHITELIST handler', () => {
    it('returns { ok: true }', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_WHITELIST)!;

      const result = await (handler({}, 'ref-1', 'frost', 'should be treated as frost') as {
        ok: boolean;
      });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesWhitelist).toHaveBeenCalledWith({
        targetRef: 'ref-1',
        treatment: 'frost',
        note: 'should be treated as frost',
      });
    });

    it('works without a note', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_WHITELIST)!;

      const result = await (handler({}, 'ref-2', 'keep') as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesWhitelist).toHaveBeenCalledWith({
        targetRef: 'ref-2',
        treatment: 'keep',
        note: undefined,
      });
    });
  });

  // -----------------------------------------------------------------------
  // 7b. OVERRIDES_BLACKLIST handler
  // -----------------------------------------------------------------------
  describe('OVERRIDES_BLACKLIST handler', () => {
    it('returns { ok: true }', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_BLACKLIST)!;

      const result = await (handler({}, 'ref-1', 'remove', 'false positive') as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesBlacklist).toHaveBeenCalledWith('ref-1', 'false positive');
    });

    it('works without a note', async () => {
      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_BLACKLIST)!;

      const result = await (handler({}, 'ref-2', 'keep') as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesBlacklist).toHaveBeenCalledWith('ref-2', undefined);
    });
  });

  // -----------------------------------------------------------------------
  // 8. OVERRIDES_CONFIRM handler
  // -----------------------------------------------------------------------
  describe('OVERRIDES_CONFIRM handler', () => {
    it('returns { ok: true }', async () => {
      mockLedgerFindByRef.mockReturnValueOnce({ action: 'frost' });

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_CONFIRM)!;

      const result = await (handler({}, 'ref-1', 'keep') as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesConfirm).toHaveBeenCalledWith('ref-1', 'frost', 'keep');
    });

    it('falls back to "keep" when ledger has no matching entry', async () => {
      mockLedgerFindByRef.mockReturnValueOnce(undefined);

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_CONFIRM)!;

      const result = await (handler({}, 'ref-3', 'remove') as { ok: boolean });

      expect(result).toEqual({ ok: true });
      expect(mockOverridesConfirm).toHaveBeenCalledWith('ref-3', 'keep', 'remove');
    });
  });

  // -----------------------------------------------------------------------
  // 9. OVERRIDES_METRICS handler
  // -----------------------------------------------------------------------
  describe('OVERRIDES_METRICS handler', () => {
    it('returns metrics object when data exists', async () => {
      mockOverridesMetrics.mockReturnValueOnce({
        precision: 0.9,
        recall: 0.8,
        truePositive: 9,
        falsePositive: 1,
        falseNegative: 2,
      });

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_METRICS)!;

      const result = await (handler({}) as {
        precision: number;
        recall: number;
        tp: number;
        fp: number;
        fn: number;
      });

      expect(result).toEqual({
        precision: 0.9,
        recall: 0.8,
        tp: 9,
        fp: 1,
        fn: 2,
      });
    });

    it('returns null when no confirmations exist', async () => {
      mockOverridesMetrics.mockReturnValueOnce(null);

      registerTransformLedgerIpc();
      const handler = handlers.get(IpcChannel.OVERRIDES_METRICS)!;

      const result = await (handler({}) as null);

      expect(result).toBeNull();
    });
  });
});
