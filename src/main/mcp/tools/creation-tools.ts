// SPDX-License-Identifier: MPL-2.0

/**
 * # Creation Tools (1 tool)
 *
 * Provides image-to-theme creation:
 *   - create_theme_from_image — derive a 14-token palette from an image,
 *     build a per-agent CSS theme package, install it into the theme library,
 *     and optionally auto-apply to target agents.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type { AgentId, InstalledTheme } from '../../../shared/types';
import type { ImagePixelSample, ThemeColorsFromImage } from '../../../shared/types/theme';
import { ThemeInstaller } from '../../catalog/theme-installer';
import { ThemePackageLoader } from '../../catalog/theme-package-loader';
import type { AgentEngineServiceApi, ThemeLibraryApi } from '../../services/contracts';
import { deriveThemeFromImage } from '../../theme/theme-from-image';
import { buildWallpaperTheme, sampleFromImagePath } from '../../theme/wallpaper-theme';
import { syncStatusToGui } from '../status-sync';
import type { McpToolDefinition } from '../tool-registry';
import { registerTool } from '../tool-registry';
import type { McpContext, McpToolResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** Stable theme id from a user-supplied name. */
function slugify(input: string): string {
  const slug =
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'theme';
  return slug.slice(0, 40);
}

/** Access the full engine service for theme apply. */
function getEngine(ctx: McpContext): AgentEngineServiceApi {
  return ctx.core as unknown as AgentEngineServiceApi;
}

/** Access the full theme library for install operations. */
function getLibrary(ctx: McpContext): ThemeLibraryApi {
  return ctx.library as unknown as ThemeLibraryApi;
}

// ---------------------------------------------------------------------------
// create_theme_from_image
// ---------------------------------------------------------------------------

const createThemeFromImageSchema = z.object({
  image_path: z.string().min(1, 'image_path is required'),
  name: z.string().min(1, 'name is required'),
  mode: z.enum(['dark', 'light', 'auto']).optional(),
  target_agents: z.array(z.string()).optional(),
  auto_apply: z.boolean().optional(),
});

async function createThemeFromImageHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const {
    image_path: imagePath,
    name,
    mode,
    target_agents,
    auto_apply,
  } = createThemeFromImageSchema.parse(args);

  // --- 1. Validate image path ------------------------------------------------
  try {
    const stat = await fs.stat(imagePath);
    if (!stat.isFile()) return fail(`"${imagePath}" is not a regular file`);
    if (stat.size > MAX_IMAGE_BYTES) {
      return fail(`Image exceeds 10MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    }
    const ext = path.extname(imagePath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
      return fail(
        `Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTS].join(', ')}`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return fail(`Image file not found: "${imagePath}"`);
    }
    return fail(`Cannot access image: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- 2. Validate target agents (if provided) ------------------------------
  const agentsToApply: AgentId[] = [];
  if (target_agents && target_agents.length > 0) {
    for (const agentId of target_agents) {
      // Validate against the catalog.
      const catalogAgent = ctx.agentCatalog.getAgent(agentId);
      if (!catalogAgent) {
        return fail(`Unknown agent_id: "${agentId}"`);
      }
      agentsToApply.push(agentId as AgentId);
    }
  }

  // --- 3. Sample pixels from the image ---------------------------------------
  const sample: ImagePixelSample | null = sampleFromImagePath(imagePath);
  if (!sample || sample.colors.length === 0) {
    return fail(`Failed to decode or sample colors from image: "${imagePath}"`);
  }

  // --- 4. Build theme package directory -------------------------------------
  const userDataRoot = app.getPath('userData');
  const outRoot = path.join(userDataRoot, 'wallpaper-themes');

  try {
    const themeId = `img-${slugify(name)}`;
    const built = await buildWallpaperTheme({
      wallpaperId: themeId,
      title: name,
      previewPath: imagePath,
      outRoot,
    });

    // --- 5. Load and install the theme into the library ---------------------
    const loader = new ThemePackageLoader(outRoot);
    const pkg = await loader.load(built.themeId);
    const installer = new ThemeInstaller(getLibrary(ctx));
    const installed: InstalledTheme = await installer.install(pkg, outRoot);

    // --- 6. Optionally auto-apply to target agents --------------------------
    const injectedAgents: string[] = [];
    if (auto_apply === true && agentsToApply.length > 0) {
      for (const agentId of agentsToApply) {
        try {
          const response = await getEngine(ctx).apply({
            themeId: installed.id,
            appId: agentId,
          });
          if (response.status === 'applied') {
            injectedAgents.push(agentId);
          }
        } catch {
          // Per-agent apply failure is non-fatal; continue with remaining agents.
        }
      }
    }

    // --- 7. Sync status to GUI before returning ---------------------------
    // The GUI must reflect the newly created theme in real-time.
    syncStatusToGui('create_theme_from_image');

    // --- 8. Build the derived colors for the response -----------------------
    const colors: ThemeColorsFromImage = deriveThemeFromImage(sample);

    return ok({
      theme_id: installed.id,
      name: installed.displayName,
      mode: mode ?? colors.mode,
      derived_mode: colors.mode,
      colors: {
        accent: colors.accent,
        accentMuted: colors.accentMuted,
        secondary: colors.secondary,
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        surface: colors.surface,
        surfaceElevated: colors.surfaceElevated,
        border: colors.border,
        codeBackground: colors.codeBackground,
        codeForeground: colors.codeForeground,
        inputBackground: colors.inputBackground,
        buttonBackground: colors.buttonBackground,
        buttonForeground: colors.buttonForeground,
        focusRing: colors.focusRing,
      },
      status: 'installed',
      injected_agents: injectedAgents.length > 0 ? injectedAgents : undefined,
      supported_agents: installed.supportedAgents,
      message: `Theme "${installed.displayName}" created and installed from image${injectedAgents.length > 0 ? ` (applied to: ${injectedAgents.join(', ')})` : ''}`,
    });
  } catch (err) {
    return fail(
      `Failed to create theme from image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all creation tools in the global tool registry.
 *
 * Call this function once during MCP initialization to make the creation
 * tools available to MCP clients.
 */
export function registerCreationTools(): void {
  registerTool({
    name: 'create_theme_from_image',
    description:
      'Derive a 14-token theme from an image, build a per-agent CSS theme package, ' +
      'install it into the theme library, and optionally auto-apply to target agents.',
    inputSchema: createThemeFromImageSchema,
    handler: createThemeFromImageHandler,
  } satisfies McpToolDefinition);
}
