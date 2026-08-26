// SPDX-License-Identifier: MPL-2.0

/**
 * Static agent profile data — avoids adding IPC channels. Token counts and
 * brand colors sourced from agents-profiles/_profiles-summary.json and
 * per-agent <id>-profile.json (tokens.core.dark.accent).
 */

import type { AgentId } from '@shared/types';

export interface AgentProfileTokens {
  light: number;
  dark: number;
  categories: number;
}

export const AGENT_TOKEN_COUNTS: Record<string, AgentProfileTokens> = {
  // Token counts sourced from agents-profiles/_profiles-summary.json (styleVars.dark).
  // Categories count from the same file's categories array length.
  codex: { light: 1246, dark: 1255, categories: 16 },
  doubao: { light: 1199, dark: 2297, categories: 15 },
  traework: { light: 4614, dark: 4613, categories: 16 },
  workbuddy: { light: 3560, dark: 3617, categories: 16 },
  qoderwork: { light: 132, dark: 141, categories: 15 },
  zcode: { light: 390, dark: 410, categories: 15 },
};

// Brand colors sourced from per-agent <id>-profile.json (tokens.core.dark.accent).
// workbuddy uses CSS variable var(--wb-palette-brand-8); fallback to Microsoft blue.
export const AGENT_BRAND_COLORS: Record<string, { dark: string; light: string }> = {
  codex: { dark: '#40c977', light: '#40c977' },
  doubao: { dark: '#35a04f', light: '#27ce6e' },
  traework: { dark: '#0c0c0d', light: '#0c0c0d' },
  workbuddy: { dark: '#0078d4', light: '#0078d4' },
  qoderwork: { dark: '#8ee5a1', light: '#8ee5a1' },
  zcode: { dark: '#001d3d', light: '#001d3d' },
};

export type StrategyKey =
  | 'studioProfileHighTokens'
  | 'studioProfileMediumTokens'
  | 'studioProfileLowTokens';

export function getStrategyKey(tokens: number): StrategyKey {
  if (tokens >= 1000) return 'studioProfileHighTokens';
  if (tokens >= 100) return 'studioProfileMediumTokens';
  return 'studioProfileLowTokens';
}

export type { AgentId };
