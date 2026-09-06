// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { DomTreeNode } from '../../shared/types';
import type { BuildProfileOptions } from '../profile/native-profile';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

const mockBuildNativeProfile = vi.fn();

vi.mock('../profile/native-profile', () => ({
  buildNativeProfile: mockBuildNativeProfile,
}));

vi.mock('./trusted-sender', () => ({
  assertTrustedSender: vi.fn(),
}));

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

const { registerNativeProfileIpc } = await import('./native-profile-ipc');
const { withMonitoredTimeout } = await import('./with-monitored-timeout');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleDomTree: DomTreeNode = {
  tag: 'div',
  cls: 'app-shell',
  style: { 'background-color': '#1e1e1e' },
  rect: { w: 1920, h: 1080, x: 0, y: 0 },
  children: [
    {
      tag: 'button',
      cls: 'send-btn',
      style: { 'background-color': '#4c90ff', color: '#ffffff' },
      rect: { w: 80, h: 32, x: 800, y: 1000 },
      children: [],
    },
  ],
};

const sampleOptions: BuildProfileOptions = {
  agentId: 'traework',
  appVersion: '1.2.3',
  scheme: 'dark',
  viewport: { w: 1920, h: 1080 },
};

function createMockProfile(
  agentId: string,
  components: Array<{ role: string }> = [],
  elevationLadder: Array<{ level: number; color: string; deltaLuminance: number }> = [],
) {
  return {
    meta: {
      agentId,
      appVersion: '1.2.3',
      capturedAt: '',
      scheme: 'dark',
      viewport: { w: 1920, h: 1080 },
    },
    components,
    palette: { backgrounds: [], texts: [], accents: [], borders: [] },
    metrics: {
      elevationLadder,
      contrastPairs: [],
      radiusScale: [],
      spacingScale: [],
      blurValues: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('native-profile-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockBuildNativeProfile.mockReset();
  });

  // -----------------------------------------------------------------------
  // 1. registerNativeProfileIpc() registration
  // -----------------------------------------------------------------------
  describe('registerNativeProfileIpc()', () => {
    it('registers the NATIVE_PROFILE_BUILD handler', () => {
      registerNativeProfileIpc();
      expect(handlers.has(IpcChannel.NATIVE_PROFILE_BUILD)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Normal invocation
  // -----------------------------------------------------------------------
  describe('NATIVE_PROFILE_BUILD handler — normal invocation', () => {
    it('returns a summary with agentId, componentCount, roleDistribution', async () => {
      const mockProfile = createMockProfile('traework', [{ role: 'backdrop' }, { role: 'button' }]);
      mockBuildNativeProfile.mockReturnValueOnce(mockProfile);

      registerNativeProfileIpc();
      const handler = handlers.get(IpcChannel.NATIVE_PROFILE_BUILD)!;

      const result = await handler({}, sampleDomTree, sampleOptions);

      expect(mockBuildNativeProfile).toHaveBeenCalledWith(sampleDomTree, sampleOptions);
      expect(result).toMatchObject({
        agentId: 'traework',
        componentCount: 2,
        roleDistribution: { backdrop: 1, button: 1 },
      });
    });

    it('includes elevationLadder in the summary', async () => {
      const ladder = [
        { level: 0, color: '#000000', deltaLuminance: 0 },
        { level: 1, color: '#1a1a1a', deltaLuminance: 0.1 },
      ];
      const mockProfile = createMockProfile('traework', [{ role: 'backdrop' }], ladder);
      mockBuildNativeProfile.mockReturnValueOnce(mockProfile);

      registerNativeProfileIpc();
      const handler = handlers.get(IpcChannel.NATIVE_PROFILE_BUILD)!;

      const result = await handler({}, sampleDomTree, sampleOptions);

      expect(result).toHaveProperty('elevationLadder');
      expect((result as { elevationLadder: unknown }).elevationLadder).toEqual(ladder);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Empty DomTreeNode (null)
  // -----------------------------------------------------------------------
  describe('NATIVE_PROFILE_BUILD handler — empty DomTreeNode', () => {
    it('handles null domTree gracefully', async () => {
      const mockProfile = createMockProfile('traework', []);
      mockBuildNativeProfile.mockReturnValueOnce(mockProfile);

      registerNativeProfileIpc();
      const handler = handlers.get(IpcChannel.NATIVE_PROFILE_BUILD)!;

      const result = await handler({}, null, sampleOptions);

      expect(mockBuildNativeProfile).toHaveBeenCalledWith(null, sampleOptions);
      expect(result).toMatchObject({
        agentId: 'traework',
        componentCount: 0,
        roleDistribution: {},
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. withMonitoredTimeout wrapping
  // -----------------------------------------------------------------------
  describe('NATIVE_PROFILE_BUILD handler — withMonitoredTimeout wrapping', () => {
    it('wraps the handler with withMonitoredTimeout (channel + 15000ms)', async () => {
      const mockProfile = createMockProfile('traework', [{ role: 'backdrop' }]);
      mockBuildNativeProfile.mockReturnValueOnce(mockProfile);

      registerNativeProfileIpc();
      const handler = handlers.get(IpcChannel.NATIVE_PROFILE_BUILD)!;

      await handler({}, sampleDomTree, sampleOptions);

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.NATIVE_PROFILE_BUILD,
        15_000,
        expect.any(Promise),
      );
    });
  });
});
