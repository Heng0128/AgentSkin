// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR architecture profiler tests
 *
 * Exercises the profiler against a synthetic extracted package that mirrors the
 * shapes seen in the field: a multi-page renderer with hashed chunk names, a
 * VS Code-style `out/` tree, a bundled extensions directory, and a strict CSP
 * on one entry only.
 *
 * The interesting assertions are about the facts the CDP side consumes —
 * entry roles, resolved dependency edges, the strongest CSP across entries, and
 * which surfaces need their own target.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileArchitecture } from './asar-architecture';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let root = '';

function write(relPath: string, contents: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentskin-arch-'));

  write('package.json', JSON.stringify({ name: 'fixture-app', main: 'out/main.js' }));

  // Primary entry — ES module, one stylesheet, allow-list CSP.
  write(
    'out/renderer/index.html',
    [
      '<!doctype html><html><head>',
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;">',
      '<link rel="stylesheet" href="./assets/index-B0dxQZal.css">',
      '<script type="module" src="./assets/index-d7y5DUOa.js"></script>',
      '</head><body><div id="root"></div></body></html>',
    ].join('\n'),
  );

  // Secondary entries — each opens its own BrowserWindow in the real app.
  write(
    'out/renderer/voice-overlay.html',
    '<script type="module" src="./assets/voice-overlay-CFf4J4a4.js"></script>',
  );
  write(
    'out/renderer/mcp-app-preview.html',
    '<script type="module" src="./assets/mcp-bridge.js"></script>',
  );

  // Strictest CSP in the package lives on a secondary entry.
  write(
    'out/renderer/quickpick.html',
    [
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;self&#39; &#39;sha256-abc&#39;">',
      '<script src="./assets/quickpick.js"></script>',
    ].join('\n'),
  );

  // Bundled JS: static import, dynamic import, CJS require, AMD define.
  write(
    'out/renderer/assets/index-d7y5DUOa.js',
    [
      'import{x}from"./chunk-1.js";',
      'import("./lazy.js");',
      'const React=require("react");',
      'define(["vs/base/common","vs/platform"],function(a,b){});',
      'export*from"./globals.js";',
    ].join('\n'),
  );
  write('out/renderer/assets/chunk-1.js', 'export const x=1;');
  write('out/renderer/assets/lazy.js', 'export const lazy=1;');
  write('out/renderer/assets/globals.js', 'export const g=1;');
  write('out/renderer/assets/voice-overlay-CFf4J4a4.js', 'import"./chunk-1.js";');
  write('out/renderer/assets/mcp-bridge.js', 'export const bridge=1;');
  write('out/renderer/assets/quickpick.js', 'export const quick=1;');

  write(
    'out/renderer/assets/index-B0dxQZal.css',
    ':root{--vscode-foreground:#ccc;--vscode-icube-colorBg1:#1a1a1a;--agentskin-bg:#000;}',
  );

  // VS Code-style extension tree — large and irrelevant to theming.
  write('out/extensions/markdown-basics/extension.js', 'export const ext=1;');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('profileArchitecture — entry points', () => {
  it('finds every HTML entry and classifies its role', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const roles = new Map(profile.entryPoints.map((e) => [e.file, e.role]));

    expect(roles.get('out/renderer/index.html')).toBe('main');
    expect(roles.get('out/renderer/voice-overlay.html')).toBe('voice-overlay');
    expect(roles.get('out/renderer/mcp-app-preview.html')).toBe('mcp-preview');
    expect(roles.get('out/renderer/quickpick.html')).toBe('quickpick');
  });

  it('sorts the primary entry first and records it', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    expect(profile.entryPoints[0]?.role).toBe('main');
    expect(profile.primaryEntry).toBe('out/renderer/index.html');
  });

  it('records script/module/style edges from the HTML', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const main = profile.entryPoints.find((e) => e.file === 'out/renderer/index.html');

    expect(main?.moduleType).toBe('module');
    expect(main?.scripts).toEqual(['./assets/index-d7y5DUOa.js']);
    expect(main?.styles).toEqual(['./assets/index-B0dxQZal.css']);

    // The module-less quickpick script must not inherit type="module".
    const quickpick = profile.entryPoints.find((e) => e.file === 'out/renderer/quickpick.html');
    expect(quickpick?.moduleType).toBe('classic');
  });

  it('reads the package.json main field', () => {
    expect(profileArchitecture(root, 'qoderwork').packageMain).toBe('out/main.js');
  });
});

describe('profileArchitecture — dependency graph', () => {
  it('resolves relative specifiers to files inside the package', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const edges = profile.dependencies.filter(
      (e) => e.from === 'out/renderer/assets/index-d7y5DUOa.js',
    );
    const byTarget = new Map(edges.map((e) => [e.to, e]));

    expect(byTarget.get('./chunk-1.js')?.resolved).toBe('out/renderer/assets/chunk-1.js');
    expect(byTarget.get('./chunk-1.js')?.kind).toBe('import');
    expect(byTarget.get('./lazy.js')?.kind).toBe('dynamic-import');
    expect(byTarget.get('./globals.js')?.kind).toBe('import');
  });

  it('keeps bare specifiers unresolved rather than guessing', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const react = profile.dependencies.find((e) => e.to === 'react');
    expect(react?.kind).toBe('require');
    expect(react?.resolved).toBeUndefined();
  });

  it('captures AMD dependency arrays', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    expect(profile.dependencies.some((e) => e.kind === 'amd' && e.to === 'vs/base/common')).toBe(
      true,
    );
  });

  it('emits script/style edges from the HTML entries', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const scriptEdge = profile.dependencies.find(
      (e) => e.kind === 'script' && e.from === 'out/renderer/index.html',
    );
    expect(scriptEdge?.resolved).toBe('out/renderer/assets/index-d7y5DUOa.js');

    const styleEdge = profile.dependencies.find(
      (e) => e.kind === 'style' && e.from === 'out/renderer/index.html',
    );
    expect(styleEdge?.resolved).toBe('out/renderer/assets/index-B0dxQZal.css');
  });

  it('does not duplicate identical edges', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const chunkEdges = profile.dependencies.filter(
      (e) => e.from === 'out/renderer/assets/index-d7y5DUOa.js' && e.to === './chunk-1.js',
    );
    // The file both imports and re-imports chunk-1; one edge per kind.
    expect(chunkEdges).toHaveLength(1);
  });
});

describe('profileArchitecture — CSP and inject strategy', () => {
  it('grades the package by its strictest entry, not its first', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    // index.html is medium ('self'), quickpick.html is extreme ('none' + hash).
    expect(profile.csp).toBe('extreme');
    expect(profile.cspFrom).toBe('out/renderer/quickpick.html');
  });

  it('recommends adoptedStyleSheets for a locked-down package', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    expect(profile.inject.mechanism).toBe('adoptedStyleSheets');
  });
});

describe('profileArchitecture — tokens and surfaces', () => {
  it('collects CSS custom-property namespaces', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    expect(profile.tokenNamespaces).toContain('vscode');
    expect(profile.tokenNamespaces).toContain('agentskin');
  });

  it('flags only the multi-page surfaces as needing their own target', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    const separate = profile.surfaces.filter((s) => s.requiresSeparateTarget);
    expect(separate.map((s) => s.role).sort()).toEqual([
      'mcp-preview',
      'quickpick',
      'voice-overlay',
    ]);
  });
});

describe('profileArchitecture — scan family behaviour', () => {
  it('skips the bundled extensions tree for the VS Code family', () => {
    const vscode = profileArchitecture(root, 'traework');
    const react = profileArchitecture(root, 'qoderwork');

    // The extensions tree is walked for a bundled SPA but skipped for VS Code,
    // where it holds hundreds of irrelevant, very large bundled extensions.
    expect(react.stats.js).toBeGreaterThan(vscode.stats.js);
    expect(vscode.scanFamily).toBe('vscode');
    expect(react.scanFamily).toBe('react');
  });

  it('reports file counts per language', () => {
    const profile = profileArchitecture(root, 'qoderwork');
    expect(profile.stats.html).toBe(4);
    expect(profile.stats.css).toBe(1);
    expect(profile.stats.js).toBeGreaterThanOrEqual(8);
    expect(profile.stats.bytes).toBeGreaterThan(0);
  });
});

describe('profileArchitecture — reuse of a caller-supplied file list', () => {
  it('produces the same profile from a pre-collected list', () => {
    const walked = profileArchitecture(root, 'qoderwork');
    const files = [
      join(root, 'out/renderer/index.html'),
      join(root, 'out/renderer/assets/index-d7y5DUOa.js'),
    ];
    const supplied = profileArchitecture(root, 'qoderwork', files);

    expect(supplied.entryPoints.map((e) => e.file)).toEqual(['out/renderer/index.html']);
    expect(walked.entryPoints.length).toBeGreaterThan(supplied.entryPoints.length);
  });
});
