// SPDX-License-Identifier: MPL-2.0

/**
 * # palette-builder.ts — Backward-Compatibility Barrel
 *
 * This file re-exports the public API from the split modules under
 * `src/main/palette/`. Existing imports like
 * `import { buildPaletteCss, hexToRgbTriple, tryEngineInjection, resolveEngineDirDefault, EngineInjectionDeps } from './palette-builder'`
 * continue to work without changes.
 *
 * The actual implementation now lives in:
 *  - `palette/generator.ts` — pure CSS generation (hexToRgbTriple, buildPaletteCss)
 *  - `palette/orchestrator.ts` — engine injection orchestration (tryEngineInjection, resolveEngineDirDefault, EngineInjectionDeps)
 *
 * ## Why a barrel instead of deleting the file?
 *
 * `agent-engine-service.ts` imports `resolveEngineDirDefault` and
 * `tryEngineInjection` from `./palette-builder`, and two test files import
 * `buildPaletteCss` / `hexToRgbTriple` / `EngineInjectionDeps` from
 * `./palette-builder`. The barrel avoids touching every consumer while the
 * actual logic is cleanly split into single-responsibility modules.
 */

export { buildPaletteCss, hexToRgbTriple } from './palette/generator';
export {
  type EngineInjectionDeps,
  resolveEngineDirDefault,
  tryEngineInjection,
} from './palette/orchestrator';
