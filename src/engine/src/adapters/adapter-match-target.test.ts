// SPDX-License-Identifier: MPL-2.0

/**
 * adapter matchTarget tests
 *
 * Verifies that each adapter's matchTarget function correctly accepts its own
 * app targets and rejects other apps' targets. The primary regression case is
 * WorkBuddy vs QoderWork: both use app.asar in their renderer path, and
 * WorkBuddy's broad /app\.asar/ check used to capture QoderWork targets,
 * causing AGENTSKIN_DOM_INCOMPATIBLE on preflight (.teams-container not found
 * in QoderWork's DOM).
 */

import { describe, expect, it } from 'vitest';
import workbuddy from './workbuddy.mjs';
import qoderwork from './qoderwork.mjs';
import codex from './codex.mjs';
import doubao from './doubao.mjs';
import traework from './traework.mjs';
import zcode from './zcode.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal CDP target object for testing matchTarget. */
function makeTarget(overrides: Partial<{
  type: string;
  url: string;
  title: string;
}> = {}): { type: string; url: string; title: string } {
  return {
    type: 'page',
    url: 'about:blank',
    title: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WorkBuddy
// ---------------------------------------------------------------------------

describe('workbuddy matchTarget', () => {
  it('accepts WorkBuddy renderer via app.asar URL', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/WorkBuddy/resources/app.asar/out/renderer/index.html',
      title: 'WorkBuddy',
    });
    expect(workbuddy.matchTarget(target)).toBe(true);
  });

  it('accepts WorkBuddy renderer via workbuddy title', () => {
    const target = makeTarget({
      url: 'file:///C:/Users/test/AppData/Local/WorkBuddy/app.asar/out/renderer/index.html',
      title: 'WorkBuddy - Conversation',
    });
    expect(workbuddy.matchTarget(target)).toBe(true);
  });

  it('accepts WorkBuddy wb- prefixed window', () => {
    const target = makeTarget({
      url: 'http://localhost:50000/index.html',
      title: 'wb-internal-tool',
    });
    expect(workbuddy.matchTarget(target)).toBe(true);
  });

  it('rejects QoderWork CN main window (URL contains qoderwork)', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html#windowId=main',
      title: 'QoderWork',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('rejects QoderWork CN voice overlay (URL contains qoderwork)', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/voice-overlay.html',
      title: 'Voice Input',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('rejects QoderWork by title (contains Qoder)', () => {
    const target = makeTarget({
      url: 'file:///C:/some/path/app.asar/out/renderer/index.html',
      title: 'QoderWork - Chat',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('rejects vscode-file:// pages (TRAE exclusion)', () => {
    const target = makeTarget({
      url: 'vscode-file:///c:/Users/test/AppData/Local/TRAE%20SOLO%20CN/resources/app.asar/out/renderer/solo-lite.html',
      title: 'TRAE SOLO',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('rejects devtools pages', () => {
    const target = makeTarget({
      url: 'devtools://devtools/bundled/devtools_app.html',
      title: 'DevTools',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('rejects non-page types', () => {
    const target = makeTarget({
      type: 'service_worker',
      url: 'file:///C:/Program%20Files/WorkBuddy/resources/app.asar/out/renderer/sw.js',
      title: '',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QoderWork
// ---------------------------------------------------------------------------

describe('qoderwork matchTarget', () => {
  it('accepts QoderWork CN main window', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html#windowId=main',
      title: 'QoderWork',
    });
    expect(qoderwork.matchTarget(target)).toBe(true);
  });

  it('accepts QoderWork by title', () => {
    const target = makeTarget({
      url: 'file:///C:/some/path/app.asar/out/renderer/index.html',
      title: 'QoderWork - Conversation',
    });
    expect(qoderwork.matchTarget(target)).toBe(true);
  });

  it('rejects QoderWork voice overlay (auxiliary window)', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/voice-overlay.html',
      title: 'Voice Input',
    });
    expect(qoderwork.matchTarget(target)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter isolation (QoderWork ↔ WorkBuddy)
// ---------------------------------------------------------------------------

describe('cross-adapter isolation: QoderWork vs WorkBuddy', () => {
  it('QoderWork targets are not captured by workbuddy adapter (URL exclusion)', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html',
      title: 'QoderWork',
    });
    expect(qoderwork.matchTarget(target)).toBe(true);
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('QoderWork voice overlay is not captured by workbuddy adapter', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/voice-overlay.html',
      title: 'Voice Input',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('QoderWork by title is not captured by workbuddy adapter', () => {
    const target = makeTarget({
      url: 'file:///C:/some/path/app.asar/out/renderer/index.html',
      title: 'QoderWork - Chat',
    });
    expect(workbuddy.matchTarget(target)).toBe(false);
  });

  it('WorkBuddy targets are still captured by workbuddy adapter (no regression)', () => {
    const target = makeTarget({
      url: 'file:///C:/Program%20Files/WorkBuddy/resources/app.asar/out/renderer/index.html',
      title: 'WorkBuddy',
    });
    expect(workbuddy.matchTarget(target)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter isolation: live-target matrix (2026-09-07 CDP probe)
//
// The probe observed a real port mis-attribution: codex's live-port cache
// resolved to Doubao's CDP port because codex's matchTarget ended in an
// "any page with a non-empty title" catch-all that accepted Doubao's
// 豆包-titled targets. Each case below is a target shape actually served by
// a running agent (2026-09-07 probe log); NO adapter may claim another
// agent's target.
// ---------------------------------------------------------------------------

const ALL_ADAPTERS = [workbuddy, qoderwork, codex, doubao, traework, zcode];

describe('cross-adapter isolation: live targets are claimed by exactly one adapter', () => {
  interface LiveTarget {
    name: string;
    owner: { matchTarget: (t: { type: string; url: string; title: string }) => boolean };
    target: { type: string; url: string; title: string };
  }

  const LIVE_TARGETS: LiveTarget[] = [
    {
      name: 'doubao main chat',
      owner: doubao,
      target: { type: 'page', url: 'doubao://doubao-chat/chat', title: '豆包' },
    },
    {
      name: 'doubao launcher',
      owner: doubao,
      target: { type: 'page', url: 'doubao://doubao-launcher/chat?viewId=101', title: '豆包' },
    },
    {
      name: 'workbuddy main window',
      owner: workbuddy,
      target: {
        type: 'page',
        url: 'file:///C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html?locale=zh-CN',
        title: 'WorkBuddy',
      },
    },
    {
      name: 'qoderwork main window',
      owner: qoderwork,
      target: {
        type: 'page',
        url: 'file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html#windowId=main',
        title: 'QoderWork',
      },
    },
    {
      name: 'traework solo-lite shell',
      owner: traework,
      target: {
        type: 'page',
        url: 'vscode-file://vscode-app/c:/Users/snowb/AppData/Local/Programs/TRAE%20SOLO%20CN/resources/app.asar/out/vs/code/electron-browser/solo/solo-lite.html',
        title: 'TraeWork CN',
      },
    },
    {
      name: 'zcode main window',
      owner: zcode,
      target: {
        type: 'page',
        url: 'file:///C:/Program%20Files/ZCode/resources/app.asar/out/renderer/index.html?restoreSession',
        title: 'ZCode',
      },
    },
  ];

  for (const { name, owner, target } of LIVE_TARGETS) {
    it(`${name}: owned by its own adapter, rejected by all others`, () => {
      for (const adapter of ALL_ADAPTERS) {
        const claimed = adapter.matchTarget(target);
        if (adapter === owner) expect(claimed, `${name} must be claimed by its owner`).toBe(true);
        else expect(claimed, `${name} must NOT be claimed by a foreign adapter`).toBe(false);
      }
    });
  }

  it('codex catch-all no longer claims Doubao targets (the observed hijack)', () => {
    const target = makeTarget({ url: 'doubao://doubao-chat/chat', title: '豆包' });
    expect(codex.matchTarget(target)).toBe(false);
  });

  it('codex still accepts its own shapes', () => {
    expect(codex.matchTarget(makeTarget({ url: 'app://index.html', title: 'ChatGPT' }))).toBe(true);
    expect(
      codex.matchTarget(makeTarget({ url: 'file:///C:/app.asar/renderer/index.html', title: 'Codex' })),
    ).toBe(true);
  });
});
