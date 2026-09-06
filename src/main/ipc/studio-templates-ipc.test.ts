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

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

const { registerStudioTemplatesIpc } = await import('./studio-templates-ipc');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('studio-templates-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
  });

  // -----------------------------------------------------------------------
  // 1. handler registration
  // -----------------------------------------------------------------------
  describe('registerStudioTemplatesIpc()', () => {
    it('registers the STUDIO_TEMPLATES_LIST handler', () => {
      registerStudioTemplatesIpc();
      expect(handlers.has(IpcChannel.STUDIO_TEMPLATES_LIST)).toBe(true);
    });

    it('registers the STUDIO_TEMPLATES_GET handler', () => {
      registerStudioTemplatesIpc();
      expect(handlers.has(IpcChannel.STUDIO_TEMPLATES_GET)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. STUDIO_TEMPLATES_LIST handler
  // -----------------------------------------------------------------------
  describe('STUDIO_TEMPLATES_LIST handler', () => {
    it('returns an array of 5 templates', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_LIST)!;
      const result = (await handler()) as unknown[];

      expect(result).toHaveLength(5);
    });

    it('each template has id, name, mode, category, description (no palette)', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_LIST)!;
      const result = (await handler()) as Array<{
        id: string;
        name: string;
        mode: string;
        category: string;
        description: string;
      }>;

      for (const t of result) {
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('name');
        expect(t).toHaveProperty('mode');
        expect(t).toHaveProperty('category');
        expect(t).toHaveProperty('description');
        // Lightweight list must NOT include palette bytes.
        expect(t).not.toHaveProperty('palette');
        expect(t).not.toHaveProperty('overrides');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. STUDIO_TEMPLATES_GET handler — valid id
  // -----------------------------------------------------------------------
  describe('STUDIO_TEMPLATES_GET handler (valid id)', () => {
    it('returns the full template including palette for a known id', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_GET)!;
      const result = (await handler({}, 'agent-midnight')) as {
        id: string;
        name: string;
        mode: string;
        palette: Record<string, string>;
        overrides: Record<string, number | string> | undefined;
      };

      expect(result).not.toBeNull();
      expect(result.id).toBe('agent-midnight');
      expect(result.name).toBe('深夜对话');
      expect(result.mode).toBe('dark');
      expect(result.palette).toBeDefined();
      expect(typeof result.palette).toBe('object');
      expect(result.palette.accent).toBe('#3B82F6');
    });

    it('returns full template for another known id (mint-fresh)', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_GET)!;
      const result = (await handler({}, 'mint-fresh')) as {
        id: string;
        name: string;
        mode: string;
        palette: Record<string, string>;
      };

      expect(result).not.toBeNull();
      expect(result.id).toBe('mint-fresh');
      expect(result.name).toBe('薄荷清爽');
      expect(result.mode).toBe('light');
      expect(result.palette.accent).toBe('#059669');
    });
  });

  // -----------------------------------------------------------------------
  // 4. STUDIO_TEMPLATES_GET handler — invalid id
  // -----------------------------------------------------------------------
  describe('STUDIO_TEMPLATES_GET handler (invalid id)', () => {
    it('returns null for an unknown templateId', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_GET)!;
      const result = await handler({}, 'nonexistent-template');

      expect(result).toBeNull();
    });

    it('returns null for an empty string templateId', async () => {
      registerStudioTemplatesIpc();
      const handler = handlers.get(IpcChannel.STUDIO_TEMPLATES_GET)!;
      const result = await handler({}, '');

      expect(result).toBeNull();
    });
  });
});
