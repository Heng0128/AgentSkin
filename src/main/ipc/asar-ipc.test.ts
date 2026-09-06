// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR IPC Tests
 *
 * Tests for the ASAR discovery pipeline:
 *   - AGENT_INSTALL_PATHS candidate resolution
 *   - resolveAppBaseDir auto-discovery
 *   - assignRoles multi-layout detection
 *   - ASAR_DISCOVER handler with {appPath, agentId}
 */

/* biome-ignore-all lint/suspicious/noExplicitAny: test mocks for node:fs require partial type assertions */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

/** asar:discover handler 的返回条目（测试只关心 role/path/kind/layout）。 */
interface AsarEntry {
  role?: string;
  path?: string;
  kind?: string;
  layout?: string;
}

/** asar:discover handler 的调用签名。 */
type AsarDiscoverHandler = (
  event: unknown,
  payload: { appPath?: string; agentId?: string },
) => Promise<AsarEntry[]>;

/** 取 asar:discover handler 并绑定具体返回类型，避免调用方拿到 unknown。 */
function getAsarDiscoverHandler(): AsarDiscoverHandler {
  return handlers.get('asar:discover')! as AsarDiscoverHandler;
}

vi.mock('electron', () => createElectronMock(handlers));

// Mock node:fs for existsSync
const existsSyncPaths = new Set<string>();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => existsSyncPaths.has(path),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ size: 1024, isDirectory: () => false })),
  };
});

const { registerAsarIpc } = await import('./asar-ipc');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ASAR_DISCOVER handler', () => {
  beforeEach(() => {
    handlers.clear();
    existsSyncPaths.clear();
    vi.clearAllMocks();
  });

  it('registers ASAR_DISCOVER handler', () => {
    registerAsarIpc();
    expect(handlers.has('asar:discover')).toBe(true);
  });

  it('throws when neither appPath nor agentId provided', async () => {
    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    await expect(handler({}, {})).rejects.toThrow(/未找到/);
  });

  it('throws when agentId has no matching candidates', async () => {
    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    // No paths exist → should throw
    await expect(handler({}, { agentId: 'codex' })).rejects.toThrow(/未找到 codex/);
  });

  it('resolves from AGENT_INSTALL_PATHS when appPath not provided', async () => {
    // Simulate codex install at APPDATA/Codex with resources/
    existsSyncPaths.add(
      join(process.env.APPDATA ?? 'C:\\fake\\AppData\\Roaming', 'Codex', 'resources'),
    );
    // Add an .asar file in resources/
    existsSyncPaths.add(
      join(process.env.APPDATA ?? 'C:\\fake\\AppData\\Roaming', 'Codex', 'resources', 'app.asar'),
    );

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    // Mock readdirSync to return our asar
    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr.endsWith('Codex')) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr.endsWith('resources')) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { agentId: 'codex' });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].role).toBe('root');
    expect(result[0].layout).toBe('asar');
  });

  it('prefers appPath when provided and exists', async () => {
    const customPath = 'C:\\custom\\agent\\resources';
    existsSyncPaths.add(customPath);
    existsSyncPaths.add(join(customPath, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === customPath) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { appPath: customPath, agentId: 'codex' });
    expect(result.length).toBe(1);
    expect(result[0].path).toContain('app.asar');
  });

  it('handles .exe path by going up one level', async () => {
    const exeDir = 'C:\\Program Files\\Agent';
    const exePath = join(exeDir, 'agent.exe');
    existsSyncPaths.add(exePath); // exe itself must "exist"
    existsSyncPaths.add(exeDir);
    existsSyncPaths.add(join(exeDir, 'resources'));
    existsSyncPaths.add(join(exeDir, 'resources', 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === exeDir) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr.endsWith('resources')) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { appPath: join(exeDir, 'agent.exe'), agentId: 'codex' });
    expect(result.length).toBe(1);
    expect(result[0].role).toBe('root');
  });
});

// ---------------------------------------------------------------------------
// Tests — assignRoles (via handler behavior)
// ---------------------------------------------------------------------------

describe('assignRoles — multi-layout detection', () => {
  beforeEach(() => {
    handlers.clear();
    existsSyncPaths.clear();
    vi.clearAllMocks();
  });

  it('detects resources/app.asar as root', async () => {
    const baseDir = 'C:\\App\\resources';
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(join(baseDir, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if ((dir as string) === baseDir) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { appPath: baseDir });
    expect(result[0].role).toBe('root');
  });

  it('detects app.asar (minimal layout) as root', async () => {
    const baseDir = 'C:\\App\\dist';
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(join(baseDir, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if ((dir as string) === baseDir) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });
    vi.mocked(fs.statSync).mockImplementation((path) => {
      if (typeof path === 'string' && path === baseDir) {
        return { size: 0, isDirectory: () => true } as any;
      }
      return { size: 1024, isDirectory: () => false } as any;
    });

    const result = await handler({}, { appPath: baseDir });
    expect(result[0].role).toBe('root');
  });

  it('detects out/app.asar (VS Code layout) as root', async () => {
    const baseDir = 'C:\\App\\out';
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(join(baseDir, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if ((dir as string) === baseDir) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });
    vi.mocked(fs.statSync).mockImplementation((path) => {
      if (typeof path === 'string' && path === baseDir) {
        return { size: 0, isDirectory: () => true } as any;
      }
      return { size: 1024, isDirectory: () => false } as any;
    });

    const result = await handler({}, { appPath: baseDir });
    expect(result[0].role).toBe('root');
  });

  it('marks non-root asar as webview', async () => {
    const baseDir = 'C:\\App\\resources';
    const parentDir = 'C:\\App';
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(join(baseDir, 'app.asar'));
    existsSyncPaths.add(join(baseDir, 'webview.asar'));
    existsSyncPaths.add(join(parentDir, 'resources'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === parentDir) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr === baseDir) {
        return [
          { name: 'app.asar', isDirectory: () => false, isFile: () => true },
          { name: 'webview.asar', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [];
    });
    vi.mocked(fs.statSync).mockImplementation((path) => {
      if (typeof path === 'string' && (path === baseDir || path === parentDir)) {
        return { size: 0, isDirectory: () => true } as any;
      }
      return { size: 1024, isDirectory: () => false } as any;
    });

    const result = await handler({}, { appPath: baseDir });
    const rootAsar = result.find((a) => a.path?.includes('app.asar'));
    const webviewAsar = result.find((a) => a.path?.includes('webview.asar'));
    expect(rootAsar?.role).toBe('root');
    expect(webviewAsar?.role).toBe('webview');
  });
});

// ---------------------------------------------------------------------------
// Tests — resolveAppBaseDir via handler
// ---------------------------------------------------------------------------

describe('resolveAppBaseDir — candidate path resolution', () => {
  beforeEach(() => {
    handlers.clear();
    existsSyncPaths.clear();
    vi.clearAllMocks();
  });

  it('returns null for unknown agentId', async () => {
    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    await expect(handler({}, { agentId: 'unknown-agent' })).rejects.toThrow(/未找到/);
  });

  it('prefers directory with resources/ subfolder', async () => {
    // Two candidates: one without resources, one with
    const candidate1 = join(process.env.LOCALAPPDATA ?? 'C:\\fake\\Local', 'Codex');
    const candidate2 = join(process.env.APPDATA ?? 'C:\\fake\\Roaming', 'Codex');
    existsSyncPaths.add(candidate1);
    existsSyncPaths.add(candidate2);
    existsSyncPaths.add(join(candidate2, 'resources'));
    existsSyncPaths.add(join(candidate2, 'resources', 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === candidate2) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr.endsWith('resources')) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { agentId: 'codex' });
    // Should resolve to candidate2 (the one with resources/)
    expect(result[0].path).toContain(candidate2);
  });

  it('falls back to existing directory without resources/', async () => {
    const candidate = join(process.env.LOCALAPPDATA ?? 'C:\\fake\\Local', 'traework');
    existsSyncPaths.add(candidate);
    existsSyncPaths.add(join(candidate, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      if ((dir as string) === candidate) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { agentId: 'traework' });
    expect(result.length).toBe(1);
    expect(result[0].path).toContain(candidate);
  });
});

// ---------------------------------------------------------------------------
// Tests — Loose layout (TRAE SOLO CN, Doubao)
// ---------------------------------------------------------------------------

describe('loose layout — no app.asar', () => {
  beforeEach(() => {
    handlers.clear();
    existsSyncPaths.clear();
    vi.clearAllMocks();
  });

  it('returns loose layout for TRAE SOLO CN (no asar, loose files)', async () => {
    // Simulate TRAE SOLO CN install with resources/app/ directory
    const baseDir = join(process.env.LOCALAPPDATA ?? 'C:\\fake\\Local', 'Programs', 'TRAE SOLO CN');
    const resourcesApp = join(baseDir, 'resources', 'app');
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(join(baseDir, 'resources'));
    existsSyncPaths.add(resourcesApp);

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      // The walkAsars call — return empty (no asar files)
      if (dirStr === baseDir) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr.endsWith('resources')) {
        return [{ name: 'app', isDirectory: () => true, isFile: () => false }] as any;
      }
      // The findLooseSourceDir call — return JS files
      if (dirStr === resourcesApp) {
        return [
          { name: 'out', isDirectory: () => true, isFile: () => false },
          { name: 'package.json', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [];
    });

    // Mock statSync to return isDirectory for the loose dir
    vi.mocked(fs.statSync).mockImplementation((path) => {
      if (typeof path === 'string' && path === resourcesApp) {
        return { size: 0, isDirectory: () => true } as any;
      }
      return { size: 1024, isDirectory: () => false } as any;
    });

    const result = await handler({}, { agentId: 'traework' });
    expect(result.length).toBe(1);
    expect(result[0].layout).toBe('loose');
    expect(result[0].role).toBe('root');
  });

  it('returns loose layout for Doubao (pure Chromium, no asar)', async () => {
    // Simulate Doubao install at C:\MyAppPrograms\...\app\
    const baseDir = 'C:\\MyAppPrograms\\com.tencent.pcgame.doubao\\Doubao\\app';
    existsSyncPaths.add(baseDir);

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === baseDir) {
        return [
          { name: 'index.html', isDirectory: () => false, isFile: () => true },
          { name: 'Doubao.dll', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [];
    });

    vi.mocked(fs.statSync).mockImplementation((path) => {
      if (typeof path === 'string' && path === baseDir) {
        return { size: 0, isDirectory: () => true } as any;
      }
      return { size: 1024, isDirectory: () => false } as any;
    });

    const result = await handler({}, { agentId: 'doubao' });
    expect(result.length).toBe(1);
    expect(result[0].layout).toBe('loose');
  });
});

// ---------------------------------------------------------------------------
// Tests — Program Files path resolution
// ---------------------------------------------------------------------------

describe('Program Files path resolution', () => {
  beforeEach(() => {
    handlers.clear();
    existsSyncPaths.clear();
    vi.clearAllMocks();
  });

  it('resolves WorkBuddy from C:\\Program Files\\WorkBuddy', async () => {
    const baseDir = 'C:\\Program Files\\WorkBuddy';
    const resourcesDir = join(baseDir, 'resources');
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(resourcesDir);
    existsSyncPaths.add(join(resourcesDir, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === baseDir) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr === resourcesDir) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { agentId: 'workbuddy' });
    expect(result.length).toBe(1);
    expect(result[0].path).toContain('app.asar');
    expect(result[0].layout).toBe('asar');
  });

  it('resolves QoderWork from nested C:\\Program Files\\QoderWork CN\\QoderWork CN', async () => {
    const baseDir = 'C:\\Program Files\\QoderWork CN\\QoderWork CN';
    const resourcesDir = join(baseDir, 'resources');
    existsSyncPaths.add(baseDir);
    existsSyncPaths.add(resourcesDir);
    existsSyncPaths.add(join(resourcesDir, 'app.asar'));

    registerAsarIpc();
    const handler = getAsarDiscoverHandler();

    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const dirStr = dir as string;
      if (dirStr === baseDir) {
        return [{ name: 'resources', isDirectory: () => true, isFile: () => false }] as any;
      }
      if (dirStr === resourcesDir) {
        return [{ name: 'app.asar', isDirectory: () => false, isFile: () => true }] as any;
      }
      return [];
    });

    const result = await handler({}, { agentId: 'qoderwork' });
    expect(result.length).toBe(1);
    expect(result[0].path).toContain('app.asar');
  });
});

// Helper
function join(...parts: string[]): string {
  return parts.join('\\');
}
