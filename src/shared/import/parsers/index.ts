// SPDX-License-Identifier: MPL-2.0

/**
 * # Import Parsers — Barrel Export
 *
 * Re-exports all built-in theme source parsers for convenient registration:
 *
 * ```typescript
 * import { registerAllParsers } from '@shared/import/parsers';
 *
 * registerAllParsers();
 * ```
 */

export { agentskinBuiltParser } from './agentskin-built-parser';
export { codedrobeParser } from './codedrobe-parser';
export { dreamskinParser } from './dreamskin-parser';
export { sourceDirectoryParser } from './source-directory-parser';

import { parserRegistry } from '../theme-source-parser';
import { agentskinBuiltParser } from './agentskin-built-parser';
import { codedrobeParser } from './codedrobe-parser';
import { dreamskinParser } from './dreamskin-parser';
import { sourceDirectoryParser } from './source-directory-parser';

/**
 * Register all built-in parsers with the global `parserRegistry`.
 *
 * Registration order (by priority):
 * 1. `agentskin` (priority 5) — native format, most specific
 * 2. `codedrobe` (priority 10) — single-file JSON, unambiguous
 * 3. `dreamskin` (priority 20) — ZIP package, requires extraction
 * 4. `source-directory` (priority 100) — catch-all, lowest priority
 */
export function registerAllParsers(): void {
  parserRegistry.register(agentskinBuiltParser, 5);
  parserRegistry.register(codedrobeParser, 10);
  parserRegistry.register(dreamskinParser, 20);
  parserRegistry.register(sourceDirectoryParser, 100);
}
