// SPDX-License-Identifier: MPL-2.0

/**
 * # Quick Apply Engine
 *
 * Agent-native "image → theme" pipeline. Takes an image, analyzes its palette,
 * derives a 14-token theme, installs it into the library, and applies it
 * to the target agent — all in a single invoke.
 *
 * ## Pipeline
 *
 *   1. Decode image → raw RGBA pixels (via injected decoder)
 *   2. Analyze dominant colors (image-analyzer)
 *   3. Extract 14-token palette (palette-extractor)
 *   4. Build minimal theme bundle with CSS variables
 *   5. Install to library
 *   6. Apply to target agent
 *   7. Optionally verify
 *
 * ## Design
 *
 * The engine is fully dependency-injected: image decoding, token extraction,
 * library operations, and apply are all injectable. This keeps the core
 * pipeline pure and unit-testable without Electron or filesystem mocks.
 */

import type { AgentId } from '../../shared/types';
import type {
  QuickApplyAnalysis,
  QuickApplyPhase,
  QuickApplyProgress,
  QuickApplyRequest,
  QuickApplyResult,
  QuickApplyTokens,
} from '../../shared/types/ipc';
import type { PixelData } from '../profile/image-analyzer';

// ---------------------------------------------------------------------------
// Types — cross-boundary types (QuickApply*) are defined in shared/types/ipc.ts
// ---------------------------------------------------------------------------

/** Decodes an image file into raw RGBA pixels. */
export type ImageDecoder = (filePath: string) => Promise<PixelData>;

/** Derives 14 tokens from pixel data. */
export type TokenExtractor = (
  pixels: PixelData,
  colorCount: number,
  forceMode?: 'light' | 'dark',
) => QuickApplyTokens;

/** Progress callback for IPC push. */
export type ProgressCallback = (progress: QuickApplyProgress) => void;

/** Dependencies for the Quick Apply engine — all injectable for testing. */
export interface QuickApplyDeps {
  /** Read an image file and return raw pixel data. */
  decodeImage: ImageDecoder;
  /** Derive 14 tokens from pixel data. */
  extractTokens: TokenExtractor;
  /** Build the analysis summary from pixels. */
  analyzePixels: (pixels: PixelData) => Omit<QuickApplyAnalysis, 'averageLuminance'> & {
    averageLuminance: number;
  };
  /** Install a theme bundle (as JSON bytes) and return its id. */
  installTheme: (bundleJson: string, suggestedId: string) => Promise<string>;
  /** Apply a theme to a target agent. */
  applyTheme: (
    themeId: string,
    targetAppId: AgentId,
  ) => Promise<{ status: string; message?: string }>;
  /** Restore an agent to its default look (undo). */
  restoreAgent: (targetAppId: AgentId) => Promise<void>;
  /** Push a progress event (no-op if not provided). */
  onProgress?: ProgressCallback;
}

// ---------------------------------------------------------------------------
// Theme bundle builder
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase token key to its CSS variable name.
 * e.g. `codeBackground` → `code-background`, `surfaceElevated` → `surface-elevated`.
 */
function tokenKeyToCssVar(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Build a minimal theme bundle JSON string from a 14-token palette.
 *
 * The CSS targets only contain `:root` variable declarations — no cosmetic
 * rules, no DeepCore. This is a lightweight "palette-only" theme that the
 * engine-strategy layer can inject via adoptedStyleSheets.
 *
 * @param tokens  Key-value pairs of token name → color value (e.g. accent → "#7AA2F7").
 * @param themeId Unique theme id.
 * @param agentId Target agent for the CSS target entry.
 */
export function buildThemeBundle(
  tokens: QuickApplyTokens,
  themeId: string,
  agentId: AgentId,
): string {
  const vars = Object.entries(tokens)
    .filter(([key]) => key !== 'mode' && typeof tokens[key] === 'string')
    .map(([key, value]) => {
      const varName = tokenKeyToCssVar(key);
      return `  --agentskin-${varName}: ${value};`;
    })
    .join('\n');

  const css = `:root {\n${vars}\n}\n`;

  const bundle = {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: {
      id: themeId,
      displayName: `Quick Apply ${themeId}`,
      version: '1.0.0',
      copy: {
        colors: tokens,
        sourceFormat: 'quick-apply',
      },
    },
    targets: {
      [agentId]: { css },
    },
  };

  return JSON.stringify(bundle);
}

/** Generate a unique theme id from the image basename + timestamp. */
export function generateThemeId(imagePath: string): string {
  const baseName = imagePath
    .replace(/.*[/\\]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 32);
  const ts = Date.now().toString(36);
  return `qa-${baseName}-${ts}`.replace(/_+/g, '_').toLowerCase();
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

/** Create a Quick Apply engine with the given dependencies. */
export function createQuickApplyEngine(deps: QuickApplyDeps) {
  /**
   * Run the full Quick Apply pipeline.
   *
   * @returns QuickApplyResult with success/failure details.
   */
  async function run(request: QuickApplyRequest): Promise<QuickApplyResult> {
    const { imagePath, targetAppId } = request;
    const colorCount = request.colorCount ?? 6;
    const themeId = generateThemeId(imagePath);

    const progress = (phase: QuickApplyPhase, message?: string) => {
      deps.onProgress?.({ phase, message });
    };

    try {
      // 1. Decode image → raw pixels
      progress('decoding');
      const pixels = await deps.decodeImage(imagePath);
      if (!pixels || pixels.width === 0 || pixels.height === 0) {
        throw new Error('Image decoded to zero dimensions');
      }

      // 2. Analyze pixels
      progress('analyzing');
      const analysis = deps.analyzePixels(pixels);

      // 3. Extract 14 tokens
      progress('extracting');
      const tokens = deps.extractTokens(pixels, colorCount, request.forceMode);

      // 4. Build theme bundle + install
      progress('building');
      const bundleJson = buildThemeBundle(tokens, themeId, targetAppId);

      progress('installing');
      const installedId = await deps.installTheme(bundleJson, themeId);

      // 5. Apply to target agent
      progress('applying');
      const applyResult = await deps.applyTheme(installedId, targetAppId);

      if (applyResult.status !== 'applied' && applyResult.status !== 'skipped-concurrent') {
        progress('error', applyResult.message);
        return {
          success: false,
          themeId: installedId,
          tokens,
          analysis,
          error: applyResult.message ?? `Apply returned status: ${applyResult.status}`,
        };
      }

      // 6. Done
      progress('done', applyResult.message);
      return {
        success: true,
        themeId: installedId,
        tokens,
        analysis,
        appliedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress('error', message);
      return {
        success: false,
        error: message,
      };
    }
  }

  /** Undo the last quick-apply by restoring the agent to its default look. */
  async function undo(targetAppId: AgentId): Promise<{ success: boolean; error?: string }> {
    try {
      await deps.restoreAgent(targetAppId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { run, undo };
}

export type QuickApplyEngine = ReturnType<typeof createQuickApplyEngine>;

export type { QuickApplyTokens };
