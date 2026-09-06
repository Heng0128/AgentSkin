// SPDX-License-Identifier: MPL-2.0

/**
 * Static agent token-count metadata, shared between the main-process visual
 * analyzer (`visual-analyzer-ipc.ts`) and the UI studio profile summary
 * (`agent-profile-utils.ts`). Lives in `src/shared` so the main layer never
 * imports from the UI layer (architecture boundary C4).
 */

export interface AgentProfileTokens {
  light: number;
  dark: number;
  categories: number;
}

// Token counts sourced from agents-profiles/_profiles-summary.json (styleVars.dark).
// Categories count from the same file's categories array length.
export const AGENT_TOKEN_COUNTS: Record<string, AgentProfileTokens> = {
  codex: { light: 1246, dark: 1255, categories: 16 },
  doubao: { light: 1199, dark: 2297, categories: 15 },
  traework: { light: 4614, dark: 4613, categories: 16 },
  workbuddy: { light: 3560, dark: 3617, categories: 16 },
  qoderwork: { light: 132, dark: 141, categories: 15 },
  zcode: { light: 390, dark: 410, categories: 15 },
};
