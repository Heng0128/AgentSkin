// SPDX-License-Identifier: MPL-2.0

/**
 * # Deep Link Commands
 *
 * Defines the `agentskin://` OS-level deep link protocol: command types,
 * URL parsing/serialization, and validation functions.
 *
 * Protocol format: `agentskin://<command>/<target>?<params>`
 *
 * Supported commands:
 *   - `apply/<themeId>`  — Apply a theme to an agent
 *   - `restore`          — Restore an agent to its native appearance
 *   - `install`          — Install a theme from a URL
 *   - `open`             — Open a local theme file
 *   - `navigate/<page>`  — Navigate to an in-app page
 *
 * Separated from the main-process DeepLinkManager so the parsing logic is
 * unit-testable in isolation (no Electron dependency).
 */

import { isSafeThemeId } from './theme-id';

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

/** Supported deep link commands. */
export type DeepLinkCommandType = 'apply' | 'restore' | 'install' | 'open' | 'navigate';

/** Parsed deep link: a discriminated union keyed by `command`. */
export type DeepLinkCommand =
  | { command: 'apply'; themeId: string; appId?: string; schemeId?: string }
  | { command: 'restore'; appId?: string }
  | { command: 'install'; url: string }
  | { command: 'open'; path: string }
  | { command: 'navigate'; page: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Whether `value` is a recognized deep link command. */
export function isDeepLinkCommand(value: string): value is DeepLinkCommandType {
  return (
    value === 'apply' ||
    value === 'restore' ||
    value === 'install' ||
    value === 'open' ||
    value === 'navigate'
  );
}

/**
 * Validate an apply command: themeId must be a safe id (no path separators).
 * Returns an error message string on failure, or null on success.
 */
export function validateApplyParams(
  themeId: string,
  appId?: string,
  schemeId?: string,
): string | null {
  if (!isSafeThemeId(themeId)) {
    return `Invalid theme id: ${themeId}`;
  }
  if (appId !== undefined && appId.length === 0) {
    return 'Empty app id';
  }
  if (schemeId !== undefined && !isSafeThemeId(schemeId)) {
    return 'Invalid scheme id';
  }
  return null;
}

/**
 * Validate an install URL: must be http(s), no embedded credentials.
 * Prevents `agentskin://install?url=file:///etc/passwd` etc.
 */
export function validateInstallUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `Invalid URL: ${value}`;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Unsupported protocol: ${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) {
    return 'URL must not contain credentials';
  }
  return null;
}

/**
 * Validate a local-file open path: must be absolute, must not contain
 * path-traversal segments (`../` or `..\`).
 */
export function validateOpenPath(value: string): string | null {
  // Dynamic import so this module stays importable from the renderer
  // (node:path is unavailable in the browser context). validateOpenPath is
  // only called from the main-process DeepLinkManager, so the async
  // penalty is a non-issue — this is a cold-path security check at the
  // trust boundary, not a hot inner loop.
  const isAbs = value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
  if (!isAbs) {
    return 'Path must be absolute';
  }
  // Platform-agnostic traversal check (covers both /..\ and \..\ patterns).
  if (value.includes('..')) {
    return 'Path must not contain traversal segments';
  }
  return null;
}

/** Valid pages for the navigate command. */
const VALID_PAGES = new Set([
  'dashboard',
  'themes',
  'wallpaper',
  'settings',
  'agents',
  'workspace',
]);

/**
 * Validate a navigation target.
 * Only allow known page names — arbitrary paths are rejected.
 */
export function validateNavigatePage(page: string): string | null {
  if (!VALID_PAGES.has(page)) {
    return `Unknown page: ${page}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an `agentskin://` URL into a structured {@link DeepLinkCommand}.
 * Throws on malformed input so callers can distinguish "not a deep link"
 * (prefix check fails before calling this) from "deep link but invalid".
 */
export function parseDeepLink(raw: string): DeepLinkCommand {
  if (!raw.startsWith('agentskin://')) {
    throw new Error(`Not an agentskin:// URL: ${raw}`);
  }

  const afterScheme = raw.slice('agentskin://'.length);
  const queryIdx = afterScheme.indexOf('?');
  const pathPart = queryIdx === -1 ? afterScheme : afterScheme.slice(0, queryIdx);
  const queryPart = queryIdx === -1 ? '' : afterScheme.slice(queryIdx + 1);

  const segments = pathPart.split('/').filter(Boolean);
  const command = segments[0] ?? '';
  const target = segments[1] ?? '';

  const params = new URLSearchParams(queryPart);

  switch (command) {
    case 'apply': {
      if (!target) throw new Error('apply command missing theme id');
      const appId = params.get('app') ?? undefined;
      const schemeId = params.get('scheme') ?? undefined;
      const error = validateApplyParams(target, appId, schemeId);
      if (error) throw new Error(error);
      return { command: 'apply', themeId: target, appId, schemeId };
    }

    case 'restore': {
      const appId = params.get('app') ?? undefined;
      if (appId !== undefined && appId.length === 0) throw new Error('Empty app id');
      return { command: 'restore', appId };
    }

    case 'install': {
      const url = params.get('url');
      if (!url) throw new Error('install command missing url parameter');
      const error = validateInstallUrl(url);
      if (error) throw new Error(error);
      return { command: 'install', url };
    }

    case 'open': {
      const filePath = params.get('path');
      if (!filePath) throw new Error('open command missing path parameter');
      const error = validateOpenPath(filePath);
      if (error) throw new Error(error);
      return { command: 'open', path: filePath };
    }

    case 'navigate': {
      if (!target) throw new Error('navigate command missing page');
      const error = validateNavigatePage(target);
      if (error) throw new Error(error);
      return { command: 'navigate', page: target };
    }

    default:
      throw new Error(`Unknown deep link command: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a {@link DeepLinkCommand} back to an `agentskin://` URL string.
 * Inverse of {@link parseDeepLink}.
 */
export function serializeDeepLink(cmd: DeepLinkCommand): string {
  switch (cmd.command) {
    case 'apply': {
      const params = new URLSearchParams();
      if (cmd.appId) params.set('app', cmd.appId);
      if (cmd.schemeId) params.set('scheme', cmd.schemeId);
      const qs = params.toString();
      return `agentskin://apply/${encodeURIComponent(cmd.themeId)}${qs ? `?${qs}` : ''}`;
    }

    case 'restore': {
      if (cmd.appId) return `agentskin://restore?app=${encodeURIComponent(cmd.appId)}`;
      return 'agentskin://restore';
    }

    case 'install':
      return `agentskin://install?url=${encodeURIComponent(cmd.url)}`;

    case 'open':
      return `agentskin://open?path=${encodeURIComponent(cmd.path)}`;

    case 'navigate':
      return `agentskin://navigate/${encodeURIComponent(cmd.page)}`;
  }
}
