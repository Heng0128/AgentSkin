// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR architecture classification tests
 *
 * Guards the classification tables that three modules now share. The tables
 * encode verified facts about each Agent's packaging (which apps ship an ASAR,
 * which ship loose files, which are Chromium shells), so a wrong entry silently
 * mis-scans an app rather than failing loudly.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_ARCH_FAMILY,
  AGENT_SCAN_FAMILY,
  architectureFamilyFor,
  classifyCspStrength,
  classifyEntryRole,
  compareEntries,
  decodeHtmlEntities,
  extractCspFromHtml,
  parseCspDirectives,
  recommendInjectStrategy,
  requiresSeparateTarget,
  scanFamilyForAgent,
} from './asar-architecture';

describe('family tables', () => {
  it('covers every supported agent', () => {
    // A missing entry silently falls back to the bundled-SPA walk, so an
    // incomplete table is a bug rather than a partial feature.
    expect(Object.keys(AGENT_SCAN_FAMILY).sort()).toEqual([
      'codex',
      'doubao',
      'qoderwork',
      'traework',
      'workbuddy',
      'zcode',
    ]);
    expect(Object.keys(AGENT_ARCH_FAMILY).sort()).toEqual(Object.keys(AGENT_SCAN_FAMILY).sort());
  });

  it('classifies only TRAE SOLO CN as the VS Code layout', () => {
    // TRAE ships VS Code OSS loose files (no app.asar; node_modules.asar is a
    // 28-byte shell). Everything else is a bundled SPA — including WorkBuddy,
    // whose WebView UI lives in cli/dist/web-ui/.
    expect(scanFamilyForAgent('traework')).toBe('vscode');
    for (const id of ['workbuddy', 'qoderwork', 'zcode', 'codex', 'doubao']) {
      expect(scanFamilyForAgent(id)).toBe('react');
    }
  });

  it('falls back to react for unknown or missing ids', () => {
    expect(scanFamilyForAgent('nonexistent')).toBe('react');
    expect(scanFamilyForAgent(undefined)).toBe('react');
    expect(architectureFamilyFor(undefined)).toBe('react-renderer');
  });

  it('maps architecture families to the documented shapes', () => {
    expect(architectureFamilyFor('workbuddy')).toBe('react-webview');
    expect(architectureFamilyFor('codex')).toBe('react-webview');
    expect(architectureFamilyFor('qoderwork')).toBe('react-renderer');
    expect(architectureFamilyFor('zcode')).toBe('react-renderer');
    expect(architectureFamilyFor('traework')).toBe('vscode-loose');
    expect(architectureFamilyFor('doubao')).toBe('chromium-native');
  });
});

describe('classifyEntryRole', () => {
  it('recognises the multi-page roles each host actually ships', () => {
    expect(classifyEntryRole('out/renderer/index.html')).toBe('main');
    expect(classifyEntryRole('out/renderer/voice-overlay.html')).toBe('voice-overlay');
    expect(classifyEntryRole('out/renderer/mcp-app-preview.html')).toBe('mcp-preview');
    expect(classifyEntryRole('out/renderer/artifact-preview.html')).toBe('artifact-preview');
    expect(classifyEntryRole('out/renderer/quickpick.html')).toBe('quickpick');
    expect(classifyEntryRole('out/renderer/cua-permission-panel.html')).toBe('permission-panel');
    expect(classifyEntryRole('out/renderer/process-monitor.html')).toBe('process-monitor');
  });

  it('recognises the VS Code workbench host and Doubao extension pages', () => {
    expect(classifyEntryRole('vs/code/electron-browser/solo/solo-lite.html')).toBe('main');
    expect(classifyEntryRole('local_webcontents/extensions/ai-views/side_panel.html')).toBe(
      'extension-page',
    );
    expect(classifyEntryRole('local_webcontents/extensions/ai-views/options.html')).toBe(
      'extension-page',
    );
  });

  it('returns unknown for pages with no recognised role', () => {
    expect(classifyEntryRole('assets/embedded-frame.html')).toBe('unknown');
  });

  it('accepts Windows separators', () => {
    expect(classifyEntryRole('out\\renderer\\voice-overlay.html')).toBe('voice-overlay');
  });
});

describe('requiresSeparateTarget', () => {
  it('is true only for roles the host opens in their own window', () => {
    expect(requiresSeparateTarget('voice-overlay')).toBe(true);
    expect(requiresSeparateTarget('quickpick')).toBe(true);
    expect(requiresSeparateTarget('extension-page')).toBe(true);
    expect(requiresSeparateTarget('main')).toBe(false);
    expect(requiresSeparateTarget('unknown')).toBe(false);
  });
});

describe('compareEntries', () => {
  it('sorts the primary surface first, then shallower paths', () => {
    const entries = [
      { file: 'out/renderer/voice-overlay.html', role: 'voice-overlay' as const },
      { file: 'index.html', role: 'main' as const },
      { file: 'deep/nested/index.html', role: 'main' as const },
    ];
    expect([...entries].sort(compareEntries).map((e) => e.file)).toEqual([
      'index.html',
      'deep/nested/index.html',
      'out/renderer/voice-overlay.html',
    ]);
  });
});

describe('CSP parsing', () => {
  it('decodes entities in directive values', () => {
    expect(decodeHtmlEntities('default-src &#39;none&#39;')).toBe("default-src 'none'");
  });

  it('splits directives into sources', () => {
    expect(parseCspDirectives("default-src 'self'; img-src *")).toEqual({
      'default-src': ["'self'"],
      'img-src': ['*'],
    });
  });

  it('extracts a CSP meta tag from HTML', () => {
    const html =
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;self&#39;">';
    expect(extractCspFromHtml(html)).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'"],
    });
  });

  it('returns undefined when the document declares no CSP', () => {
    expect(extractCspFromHtml('<html><head></head></html>')).toBeUndefined();
  });
});

describe('classifyCspStrength', () => {
  it('grades Codex-style lockdown as extreme', () => {
    // default-src 'none' + hash-gated scripts — the harshest policy in the field.
    expect(
      classifyCspStrength({
        'default-src': ["'none'"],
        'script-src': ["'self'", "'sha256-Z2/iFzh'", "'wasm-unsafe-eval'"],
      }),
    ).toBe('extreme');
  });

  it('grades default-src none without hashes as high', () => {
    expect(classifyCspStrength({ 'default-src': ["'none'"] })).toBe('high');
  });

  it('grades allow-listed sources as medium', () => {
    expect(classifyCspStrength({ 'default-src': ["'self'"] })).toBe('medium');
  });

  it('inherits default-src when script-src/style-src are absent', () => {
    // `default-src 'self'` still blocks inline <style>, so this must not be
    // graded 'low' — otherwise we recommend a mechanism the page rejects.
    expect(classifyCspStrength({ 'default-src': ["'self'"] })).toBe('medium');
    expect(classifyCspStrength({ 'default-src': ["'none'"] })).toBe('high');
  });

  it('lets an explicit style-src loosen an inherited lock-down', () => {
    expect(
      classifyCspStrength({ 'default-src': ["'self'"], 'style-src': ["'unsafe-inline'"] }),
    ).toBe('low');
  });

  it('grades unsafe-inline and wildcards as low', () => {
    expect(classifyCspStrength({ 'script-src': ["'unsafe-inline'"] })).toBe('low');
    expect(classifyCspStrength({ 'default-src': ['*'] })).toBe('low');
  });

  it('grades an absent policy as none', () => {
    expect(classifyCspStrength(undefined)).toBe('none');
    expect(classifyCspStrength({})).toBe('none');
  });
});

describe('recommendInjectStrategy', () => {
  it('forces adoptedStyleSheets under a locked-down CSP', () => {
    const strategy = recommendInjectStrategy('extreme', 'react-webview');
    expect(strategy.mechanism).toBe('adoptedStyleSheets');
    // Both the CSP reason and the WebView-sandbox reason should be reported.
    expect(strategy.reasons.length).toBeGreaterThan(1);
  });

  it('allows inline style when no CSP is declared', () => {
    expect(recommendInjectStrategy('none', 'react-renderer').mechanism).toBe('inline-style');
  });

  it('tells the operator that Doubao needs a debug port', () => {
    const strategy = recommendInjectStrategy('medium', 'chromium-native');
    expect(strategy.mechanism).toBe('adoptedStyleSheets');
    expect(strategy.reasons.some((r) => r.includes('--remote-debugging-port'))).toBe(true);
  });

  it('warns that VS Code themes must layer onto --vscode-* variables', () => {
    const strategy = recommendInjectStrategy('low', 'vscode-loose');
    expect(strategy.reasons.some((r) => r.includes('--vscode-'))).toBe(true);
  });
});
