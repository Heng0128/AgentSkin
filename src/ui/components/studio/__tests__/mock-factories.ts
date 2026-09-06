// SPDX-License-Identifier: MPL-2.0

/**
 * # Shared Mock Factories
 *
 * Centralized mock factory functions for studio component tests.
 * Eliminates duplication of hand-crafted mocks across test files.
 *
 * Provides:
 *   - createMockUiMessages() — complete UiMessages mock
 *   - createMockFile() — simulated File object
 *   - createMockAdapter() — simulated ApplicationAdapter
 */

import type { UiMessages } from '@shared/i18n';

// ---------------------------------------------------------------------------
// UiMessages
// ---------------------------------------------------------------------------

/**
 * Returns a complete UiMessages mock covering all keys used by studio
 * components. Cast via `as unknown as UiMessages` is acceptable because
 * the real type has 200+ keys and tests only exercise a subset.
 */
export function createMockUiMessages(): UiMessages {
  return {
    // --- studio: image-to-theme panel ---
    studioImageToThemePanelTitle: 'Image to Theme',
    studioImageToThemeClear: 'Clear',
    studioImageToThemeDropToUpload: 'Drop to Upload',
    studioImageToThemeDragOrClick: 'Drag or Click to Upload',
    studioImageToThemeSupportedFormats: 'PNG · JPG · WebP · BMP · AVIF',
    studioImageToThemeErrorInvalidFormat:
      'Unsupported format. Please upload PNG / JPEG / WebP / BMP / AVIF.',
    studioImageToThemeErrorReadFailed: 'Failed to read image',
    studioImageToThemeErrorExtractFailed: 'Color extraction failed',
    studioImageToThemeExtracting: 'Extracting…',
    studioImageToThemeExtractButton: 'Extract Palette',
    studioImageToThemeGeneratedPalette: 'Generated Palette',
    studioImageToThemeTonalDerivative: 'Tonal Scale',
    studioImageToThemeTonalHint: 'Click any tone to set it as the accent color',
    studioImageToThemeApplyToProject: 'Apply to Project',
    studioImageToThemeHintText:
      'For best results, use images with high saturation and a clear subject.',
    studioImageToThemeSwatchExpand: 'Click to expand color details',
    studioImageToThemeCopyFormat: (label: string) => `Copy ${label}`,
    studioImageToThemeGroupCore: 'CORE',
    studioImageToThemeGroupSurface: 'SURFACE',
    studioImageToThemeGroupText: 'TEXT',
    studioImageToThemeGroupCode: 'CODE',
    studioImageToThemeGroupInput: 'INPUT',
    studioImageToThemeGroupButton: 'BUTTON',
    studioImageToThemeGroupInteraction: 'INTERACTION',

    // --- studio: drawer / project ---
    expandSidebar: 'Expand',
    collapseSidebar: 'Collapse',
    studioProjectTitle: 'Project · PROJECT',
    studioProjectNew: 'New',
    studioProjectPlaceholder: 'Project name',
    studioProjectAuthorPlaceholder: 'Author (optional)',
    studioProjectCreate: 'Create',
    studioProfileSummary: 'Agent Profile',
    studioProfileTokens: 'Tokens',
    studioProfileCategories: 'Categories',
    studioProfileAccent: 'Accent',
    studioProfileStrategy: 'Strategy',
    studioProfileHighTokens: 'High token coverage — recommend Token Mapper',
    studioProfileMediumTokens: 'Medium coverage — combine with Override',
    studioProfileLowTokens: 'Low coverage — Override recommended',
    studioProfileSelectAbove: 'Select an agent to view details',
    cancel: 'Cancel',
    studioResourcesTitle: 'Resources',
    themeLibrary: 'Theme Library',
    studioLibraryEmpty: 'No installed themes',
    studioWallpaperAllTitle: 'Wallpapers',
    studioWallpaperEmpty: 'No wallpapers',
    studioTabBundle: 'Bundles',
    studioBundleImport: 'Import Bundle',
    agentsTitle: 'Agents',
    studioSecurityLabel: 'Security',
    studioSecurityContextIsolation: 'Context Isolation',
    studioSecuritySandbox: 'Sandbox',
    studioSecurityWebSecurity: 'WebSecurity',
    studioSecurityEnabled: 'ON',
    studioSecurityDisabled: 'OFF',
    studioSecurityStrict: 'strict',
    studioSecurityStandard: 'standard',

    // --- studio: inspector ---
    studioExpandInspector: 'Expand Inspector',
    studioTabProfile: 'Profile',
    studioTabElement: 'Element',
  } as unknown as UiMessages;
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

export interface MockFileOptions {
  name?: string;
  type?: string;
  size?: number;
  lastModified?: number;
}

/**
 * Creates a lightweight mock File object suitable for unit tests.
 * The real File constructor is unavailable in node / SSR environments;
 * this factory returns a plain object with the File-shaped interface
 * (name, type, size, lastModified, arrayBuffer, slice, text).
 */
export function createMockFile(options: MockFileOptions = {}): File {
  const {
    name = 'test-image.png',
    type = 'image/png',
    size = 1024,
    lastModified = Date.now(),
  } = options;

  const blob = new Blob([new ArrayBuffer(size)], { type });

  // Copy over File-specific properties from the Blob
  Object.defineProperty(blob, 'name', { value: name, writable: false });
  Object.defineProperty(blob, 'lastModified', { value: lastModified, writable: false });

  return blob as unknown as File;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface MockAdapterOptions {
  id?: string;
  name?: string;
  type?: 'agent' | 'ide' | 'desktop';
  tier?: 'active' | 'experimental';
  coreId?: string;
}

/**
 * Creates a minimal mock ApplicationAdapter for tests.
 * All async methods return resolved promises with safe defaults.
 */
export function createMockAdapter(options: MockAdapterOptions = {}): Record<string, unknown> {
  const {
    id = 'traework',
    name = 'TraeWork',
    type = 'agent',
    tier = 'active',
    coreId = 'traework',
  } = options;

  return {
    id,
    name,
    type,
    tier,
    coreId,
    detect: async () => true,
    getPath: async () => null,
    applyTheme: async () => ({ success: true }),
    restoreTheme: async () => ({ success: true }),
    discover: async () => null,
    findTargets: async () => [],
    findRunningPids: async () => [],
    resolveDebugPorts: async () => [],
    defaultPort: () => 9222,
    displayName: () => name,
    rendererHints: () => undefined,
  };
}
