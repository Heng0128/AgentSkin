// SPDX-License-Identifier: MPL-2.0

/**
 * MCP Auth - Simple API Key validation
 */

const VALID_KEYS = new Set<string>();

export function registerApiKey(key: string): void {
  VALID_KEYS.add(key);
}

export function validateApiKey(key: string | undefined): boolean {
  if (VALID_KEYS.size === 0) return true;
  return key !== undefined && VALID_KEYS.has(key);
}

export function generateApiKey(): string {
  const key = `agentskin_${crypto.randomUUID().replace(/-/g, '')}`;
  VALID_KEYS.add(key);
  return key;
}
