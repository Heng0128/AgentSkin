// SPDX-License-Identifier: MPL-2.0

import type { AgentId, AppStatus, SystemStatus } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { findAppStatus } from './status-utils';

function makeAppStatus(appId: AgentId, overrides: Partial<AppStatus> = {}): AppStatus {
  return {
    appId,
    displayName: appId,
    installed: true,
    running: false,
    debugReady: false,
    port: null,
    activeThemeId: null,
    ...overrides,
  };
}

describe('findAppStatus', () => {
  it('returns the matching app status when found', () => {
    const status: SystemStatus = {
      platform: 'win32',
      apps: [makeAppStatus('traework'), makeAppStatus('qoderwork', { running: true, port: 9222 })],
    };
    const result = findAppStatus(status, 'qoderwork');
    expect(result?.appId).toBe('qoderwork');
    expect(result?.running).toBe(true);
    expect(result?.port).toBe(9222);
  });

  it('returns null when the app is not in the status list', () => {
    const status: SystemStatus = {
      platform: 'win32',
      apps: [makeAppStatus('traework')],
    };
    expect(findAppStatus(status, 'doubao')).toBeNull();
  });

  it('returns null when status is null', () => {
    expect(findAppStatus(null, 'traework')).toBeNull();
  });

  it('returns null when the apps array is empty', () => {
    const status: SystemStatus = { platform: 'win32', apps: [] };
    expect(findAppStatus(status, 'traework')).toBeNull();
  });

  it('returns the first match when duplicate appIds exist', () => {
    const status: SystemStatus = {
      platform: 'win32',
      apps: [makeAppStatus('traework', { port: 1111 }), makeAppStatus('traework', { port: 2222 })],
    };
    const result = findAppStatus(status, 'traework');
    expect(result?.port).toBe(1111);
  });
});
