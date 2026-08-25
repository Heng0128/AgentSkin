// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Tools (3 tools)
 *
 * Provides wallpaper management and image-to-theme preview:
 *   - list_wallpapers          — list all available wallpapers
 *   - set_wallpaper            — set a wallpaper for a specific agent
 *   - preview_theme_from_image — derive a 14-token theme preview from an image (no install)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import { z } from 'zod';
import type { AgentId } from '../../../shared/types';
import type { ImagePixelSample } from '../../../shared/types/theme';
import type { AgentEngineServiceApi } from '../../services/contracts';
import { deriveThemeFromImage } from '../../theme/theme-from-image';
import { sampleFromBitmap } from '../../theme/wallpaper-theme';
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

/** Access the full engine service for wallpaper injection. */
function getEngine(ctx: McpContext): AgentEngineServiceApi {
  return ctx.core as unknown as AgentEngineServiceApi;
}

/**
 * Validate an image file path: must exist, have a supported extension,
 * and be within the size limit. Returns null on success, error message on failure.
 */
async function validateImagePath(imagePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(imagePath);
    if (!stat.isFile()) return `"${imagePath}" is not a regular file`;
    if (stat.size > MAX_IMAGE_BYTES) {
      return `Image exceeds 10MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`;
    }
    const ext = path.extname(imagePath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
      return `Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTS].join(', ')}`;
    }
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return `Image file not found: "${imagePath}"`;
    }
    return `Cannot access image: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// list_wallpapers
// ---------------------------------------------------------------------------

const listWallpapersSchema = z.object({});

async function listWallpapersHandler(_args: unknown, ctx: McpContext): Promise<McpToolResult> {
  try {
    const wallpaper = ctx.settings.wallpaper();
    return ok({
      enabled: wallpaper.enabled,
      activeWallpaperId: wallpaper.id,
      globalRender: wallpaper.render ?? null,
      agentSettings: Object.entries(wallpaper.agents).map(([appId, setting]) => ({
        agent_id: appId,
        enabled: setting.enabled,
        wallpaperId: setting.id,
        render: setting.render ?? null,
      })),
    });
  } catch (err) {
    return fail(`Failed to list wallpapers: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// set_wallpaper
// ---------------------------------------------------------------------------

const setWallpaperSchema = z.object({
  wallpaper_id: z.string().min(1, 'wallpaper_id is required'),
  agent_id: z.string().min(1, 'agent_id is required'),
});

async function setWallpaperHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { wallpaper_id, agent_id } = setWallpaperSchema.parse(args);
  try {
    const result = await getEngine(ctx).applyWallpaperToAgent(wallpaper_id, agent_id as AgentId);
    syncStatusToGui('set_wallpaper');
    return ok({
      ok: result.ok,
      wallpaper_id,
      agent_id,
      reason: result.reason ?? null,
      detail: result.detail ?? null,
    });
  } catch (err) {
    return fail(`Failed to set wallpaper: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// preview_theme_from_image
// ---------------------------------------------------------------------------

const previewThemeFromImageSchema = z.object({
  image_path: z.string().min(1, 'image_path is required'),
  mode: z.enum(['dark', 'light', 'auto']).optional(),
});

async function previewThemeFromImageHandler(
  args: unknown,
  ctx: McpContext,
): Promise<McpToolResult> {
  const { image_path: imagePath, mode } = previewThemeFromImageSchema.parse(args);

  const validationError = await validateImagePath(imagePath);
  if (validationError) {
    return fail(validationError);
  }

  try {
    // Decode the image via Electron nativeImage and down-sample to 48px edge.
    const img = nativeImage.createFromPath(imagePath);
    if (img.isEmpty()) {
      return fail(`Failed to decode image: "${imagePath}"`);
    }

    const size = img.getSize();
    const scale = Math.min(1, 48 / Math.max(size.width, size.height));
    const resized = scale < 1 ? img.resize({ width: Math.round(size.width * scale) }) : img;
    const { width, height } = resized.getSize();

    // Convert BGRA bitmap to de-duplicated weighted color sample.
    const sample: ImagePixelSample = {
      colors: sampleFromBitmap(width, height, resized.toBitmap()),
    };

    // Derive the 14-token palette.
    const colors = deriveThemeFromImage(sample);

    return ok({
      image_path: imagePath,
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
      status: 'preview',
      message: 'Theme preview generated (not saved). Use create_theme_from_image to install.',
    });
  } catch (err) {
    return fail(
      `Failed to preview theme from image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all wallpaper tools in the global tool registry.
 *
 * Call this function once during MCP initialization to make the three wallpaper
 * management tools available to MCP clients.
 */
export function registerWallpaperTools(): void {
  registerTool({
    name: 'list_wallpapers',
    description: 'List the current wallpaper settings (active wallpaper + per-agent settings).',
    inputSchema: listWallpapersSchema,
    handler: listWallpapersHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'set_wallpaper',
    description: 'Set a wallpaper for a specific agent (injects via CDP).',
    inputSchema: setWallpaperSchema,
    handler: setWallpaperHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'preview_theme_from_image',
    description: 'Preview a 14-token theme derived from an image file (no install, no apply).',
    inputSchema: previewThemeFromImageSchema,
    handler: previewThemeFromImageHandler,
  } satisfies McpToolDefinition);
}
