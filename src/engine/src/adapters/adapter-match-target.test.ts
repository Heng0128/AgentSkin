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
