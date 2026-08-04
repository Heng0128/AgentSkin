// SPDX-License-Identifier: MPL-2.0

/**
 * End-to-end pipeline test for the built-in theme packages.
 *
 * Runs the exact boot path (ThemePackageLoader.scan → ThemeInstaller.installAll
 * → ThemeLibrary) against the real themes/ directory and validates every
 * produced bundle through @agentskin/engine's own tooling:
 *
 *   - each package installs and passes core package validation
 *   - each bundle ships CSS + verification for all three active agents
 *   - verification `required` anchors only use selectors that exist in the
 *     real application DOM (cross-checked against the core adapter
 *     landmarks), so the engine's DOM preflight can no longer reject an
 *     apply with AGENTSKIN_DOM_INCOMPATIBLE
 *   - hero artwork is embedded with a real MIME type and surfaces as
 *     artDataUrl / --agentskin-art for the injected CSS
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltinAdapters } from '../adapters/registry';
import {
  resolveThemeTargetFor,
  type ThemeBundle,
  validateTheme,
} from '../legacy/agentskin-core-runtime';
import { ThemeInstaller } from './catalog/theme-installer';
import { ThemePackageLoader } from './catalog/theme-package-loader';
import { ThemeLibrary } from './theme-library';

const THEMES_DIR = path.resolve(__dirname, '..', '..', 'themes');
const ACTIVE_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'zcode'] as const;

/**
 * Selectors known to exist in each application's renderer, taken from the
 * @agentskin/engine v0.6.0 adapter verification landmarks. A theme's blocking
 * (`required`) anchors must stay within this set — anything else makes the
 * engine refuse the apply.
 */
const KNOWN_DOM_SELECTORS: Record<string, Set<string>> = {
  traework: new Set([
    '#root .panel-container',
    '#root .solo-lite-layout',
    '#root',
    '.panel-container',
    '.solo-lite-layout',
    '.task-list-base',
    '.task-list-panel',
    ".chat-input-v2-input-box-editable[contenteditable='true']",
  ]),
  qoderwork: new Set([
    '#root .agents-layout-root',
    '.agents-layout-root',
    '#root',
    '.agents-sidebar',
    '[data-resizable-sidebar]',
    '.agents-content-area',
    '.agents-layout-body',
    ".chat-input-editor-text[contenteditable='true']",
  ]),
  workbuddy: new Set([
    '#root > .teams-container',
    '.teams-container',
    '#root',
    '.conversation-sidebar',
    '.conversation-list',
    '.teams-main-content',
    '.main-content',
    '.chat-container',
    "[role='textbox'][contenteditable='true']",
    ".wb-home-composer [contenteditable='true']",
  ]),
  zcode: new Set(['#root', 'body', "[contenteditable='true']", 'textarea']),
};

/**
 * The full --cb-* design-variable surface of WorkBuddy's renderer, taken
 * from the reference skin implementation (workbuddy-skin-studio skin-css).
 * Overriding these on body[data-application-name="workbuddy"] recolors the
 * whole app; the coverage test below fails if any shipped workbuddy CSS
 * drops one, so the variable list must be grown here when WorkBuddy ships
 * new design tokens.
 */
const WORKBUDDY_DESIGN_VARS = [
  // Backgrounds
  '--cb-bg-primary',
  '--cb-bg-secondary',
  '--cb-panel-bg-primary',
  '--cb-team-member-card-background',
  // Text
  '--cb-text-primary',
  '--cb-text-secondary',
  '--cb-text-disabled',
  '--cb-text-link',
  '--cb-text-error-active',
  // VS Code token wrappers
  '--cb-vscode-editor-background',
  '--cb-vscode-sideBar-background',
  '--cb-vscode-foreground',
  '--cb-vscode-editor-foreground',
  '--cb-vscode-descriptionForeground',
  '--cb-vscode-titleBar-activeBackground',
  '--cb-vscode-titleBar-activeForeground',
  '--cb-vscode-titleBar-inactiveBackground',
  '--cb-vscode-titleBar-inactiveForeground',
  '--cb-titlebar-control-hover-background',
  '--cb-vscode-input-background',
  '--cb-vscode-dropdown-background',
  '--cb-vscode-list-hoverBackground',
  '--cb-vscode-toolbar-hoverBackground',
  '--cb-vscode-scrollbarSlider-background',
  '--cb-vscode-scrollbarSlider-hoverBackground',
  '--cb-vscode-textLink-foreground',
  '--cb-vscode-widget-border',
  '--cb-vscode-panel-border',
  // Buttons
  '--cb-button-dark-background',
  '--cb-button-dark-foreground',
  '--cb-button-dark-hover-background',
  '--cb-vscode-button-background',
  '--cb-vscode-button-foreground',
  '--cb-vscode-button-hoverBackground',
  // Strokes
  '--cb-stroke-secondary',
  '--cb-markdown-hr-border-color',
] as const;

interface VerificationRequirement {
  name: string;
  any: string[];
}

interface TargetVerification {
  required?: VerificationRequirement[];
  recommended?: VerificationRequirement[];
}

let library: ThemeLibrary;
let libraryRoot: string;
const bundles: Map<string, ThemeBundle> = new Map();

beforeAll(async () => {
  registerBuiltinAdapters();
  libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-seed-test-'));
  library = new ThemeLibrary(libraryRoot);
  await library.initialize();

  const loader = new ThemePackageLoader(THEMES_DIR);
  const packages = await loader.scan();
  // The shipped bundle is a single theme (naruto-tobi, 火影 · 带土).
  expect(packages.length).toBeGreaterThanOrEqual(1);

  const installer = new ThemeInstaller(library);
  await installer.installAll(packages);

  for (const entry of await library.entries()) {
    bundles.set(entry.bundle.theme.id, entry.bundle);
  }
}, 120_000);

afterAll(async () => {
  await fs.rm(libraryRoot, { recursive: true, force: true }).catch(() => {});
});

describe('built-in theme packages', () => {
  it('installs every shipped theme into the library', () => {
    expect(bundles.size).toBeGreaterThanOrEqual(1);
  });

  it('produces core-valid bundles with CSS for all three agents', () => {
    for (const [id, bundle] of bundles) {
      // Throws when the bundle violates the core package schema.
      const validated = validateTheme(bundle);
      expect(validated.theme.id).toBe(id);
      for (const agent of ACTIVE_AGENTS) {
        const target = bundle.targets[agent];
        expect(target, `${id}: missing target ${agent}`).toBeTruthy();
        expect(target.css.length, `${id}: empty CSS for ${agent}`).toBeGreaterThan(200);
      }
    }
  });

  it('only uses blocking verification anchors that exist in the real DOM', () => {
    for (const [id, bundle] of bundles) {
      for (const agent of ACTIVE_AGENTS) {
        const verification = bundle.targets[agent].verification as TargetVerification | undefined;
        expect(verification, `${id}/${agent}: missing verification`).toBeTruthy();
        const required = verification?.required ?? [];
        expect(required.length, `${id}/${agent}: no required anchors`).toBeGreaterThan(0);
        for (const requirement of required) {
          for (const selector of requirement.any) {
            expect(
              KNOWN_DOM_SELECTORS[agent],
              `${id}/${agent}: required anchor "${selector}" is not a verified DOM landmark`,
            ).toContain(selector);
          }
        }
      }
    }
  });

  it('embeds hero artwork and exposes it as --agentskin-art for every agent', () => {
    for (const [id, bundle] of bundles) {
      const hero = bundle.assets?.images?.hero;
      expect(hero, `${id}: missing hero image`).toBeTruthy();
      if (!hero) throw new Error(`${id}: missing hero image`);
      expect(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).toContain(hero.mimeType);
      expect(hero.base64.length, `${id}: hero image is empty`).toBeGreaterThan(1000);

      for (const agent of ACTIVE_AGENTS) {
        const resolved = resolveThemeTargetFor(bundle, agent);
        expect(resolved.artDataUrl, `${id}/${agent}: no art data url`).toBeTruthy();
        expect(resolved.imageDataUrls.hero).toBe(resolved.artDataUrl);
      }
    }
  });

  it('ships self-contained CSS (no remote resources) with semantic tokens', () => {
    for (const [id, bundle] of bundles) {
      for (const agent of ACTIVE_AGENTS) {
        const css = bundle.targets[agent].css;
        expect(css, `${id}/${agent}: remote @import`).not.toMatch(/@import\s/);
        expect(css, `${id}/${agent}: remote url()`).not.toMatch(/url\(\s*["']?(?!data:)/i);
        expect(css, `${id}/${agent}: missing --agentskin tokens`).toContain('--agentskin-accent:');
        expect(css, `${id}/${agent}: missing --agentskin-bg`).toContain('--agentskin-bg:');
      }
    }
  });

  it('references the injected hero art variable in the applied backgrounds', () => {
    for (const [id, bundle] of bundles) {
      // Flat / CSS-only themes (manifest art:false) ship no backdrop image by
      // design, so they are exempt from the --agentskin-art reference rule.
      const isFlat = (bundle.theme.copy as { art?: boolean } | undefined)?.art === false;
      if (isFlat) continue;
      for (const agent of ACTIVE_AGENTS) {
        expect(
          bundle.targets[agent].css,
          `${id}/${agent}: CSS never uses --agentskin-art`,
        ).toContain('var(--agentskin-art');
      }
    }
  });

  it('overrides the complete WorkBuddy --cb-* design-variable surface', () => {
    for (const [id, bundle] of bundles) {
      const css = bundle.targets.workbuddy.css;
      for (const variable of WORKBUDDY_DESIGN_VARS) {
        expect(css, `${id}/workbuddy: missing override for ${variable}`).toContain(`${variable}:`);
      }
      // The --wb-* base tokens feed every color-mix() above.
      for (const base of ['--wb-accent', '--wb-secondary', '--wb-surface', '--wb-text']) {
        expect(css, `${id}/workbuddy: missing base token ${base}`).toContain(`${base}:`);
      }
    }
  });

  it('keeps icon assets embedded with a valid MIME type', () => {
    for (const [id, bundle] of bundles) {
      const icon = bundle.assets?.images?.icon;
      expect(icon, `${id}: missing icon`).toBeTruthy();
      if (!icon) throw new Error(`${id}: missing icon`);
      expect(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).toContain(icon.mimeType);
    }
  });
});
