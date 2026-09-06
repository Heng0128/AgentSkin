// SPDX-License-Identifier: MPL-2.0
//
// # variations-loader.mjs — Component Variations loader and CSS generator.
//
// Reads a theme package's `componentVariations` declarations from manifest.json,
// loads each `variations/<id>.json` file, and produces a CSS string ready for
// CDP injection (Layer 5.5). The module is pure I/O: no global state, no engine
// coupling. Consumed by the theme apply pipeline and Theme Studio preview.

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

/**
 * Convert a tokenOverrides map into a CSS custom-property block.
 *
 * Each key/value pair becomes `  key: value;` inside `{host} { ... }`.
 * Returns an empty string when the map is empty so callers can concatenate
 * without producing a dangling selector.
 *
 * @param {Record<string, string>} tokenOverrides - CSS variable overrides
 * @param {string} [host] - CSS selector block (default ':root')
 * @returns {string} CSS block, or '' when tokenOverrides is empty
 */
export function tokenOverridesToCss(tokenOverrides, host = ':root') {
  const entries = Object.entries(tokenOverrides ?? {});
  if (entries.length === 0) return '';

  const lines = entries.map(([key, value]) => `  ${key}: ${value};`);
  return `${host} {\n${lines.join('\n')}\n}`;
}

/**
 * Convert a componentSpecific map into CSS rule blocks.
 *
 * Each key is treated as a CSS selector; each value is the declaration block
 * (without braces). A `/* component *\/` comment precedes each rule so the
 * output is human-readable when injected into the CDP stylesheet.
 *
 * @param {Record<string, string>} componentSpecific - Component CSS declarations
 * @returns {string} Concatenated CSS rules, or '' when empty
 */
export function componentSpecificToCss(componentSpecific) {
  const entries = Object.entries(componentSpecific ?? {});
  if (entries.length === 0) return '';

  return entries
    .map(([component, declarations]) => `/* ${component} */\n${component} { ${declarations}; }`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filter variations to only those that support the given agent.
 *
 * A variation passes the filter when:
 * - Its `agents` array is empty/undefined (supports all agents), OR
 * - Its `agents` array explicitly includes `agentId`.
 *
 * @param {Array<{ agents?: string[] }>} variations - Loaded variation list
 * @param {string} agentId - Target agent id
 * @returns {Array<{ agents?: string[] }>} Filtered array (same references)
 */
export function filterByAgent(variations, agentId) {
  if (!Array.isArray(variations)) return [];
  return variations.filter((v) => {
    const agents = v.agents;
    if (!agents || agents.length === 0) return true;
    return agents.includes(agentId);
  });
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load all component variations declared in a theme package's manifest.json.
 *
 * For each entry in `manifest.componentVariations`, reads the referenced JSON
 * file, validates it has an `id` field, and generates CSS via
 * `tokenOverridesToCss` + `componentSpecificToCss`. Files missing the `id`
 * field are skipped with a console.warn.
 *
 * @param {string} themeDir - Theme package root directory (contains manifest.json)
 * @returns {Promise<Array<{ id: string, name: string, css: string, agents: string[] }>>>}
 *   One entry per successfully loaded variation.
 */
export async function loadVariations(themeDir) {
  const manifestPath = path.join(themeDir, 'manifest.json');
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    console.warn(`[variations-loader] manifest.json not found in ${themeDir}`);
    return [];
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    console.warn(`[variations-loader] manifest.json is not valid JSON in ${themeDir}`);
    return [];
  }

  const variations = manifest.componentVariations ?? {};
  const results = [];

  for (const [key, entry] of Object.entries(variations)) {
    if (!entry || typeof entry.path !== 'string') {
      console.warn(`[variations-loader] variation "${key}" has no valid path — skipped`);
      continue;
    }

    const variationPath = path.join(themeDir, entry.path);
    let variationRaw;
    try {
      variationRaw = await fs.readFile(variationPath, 'utf8');
    } catch {
      console.warn(`[variations-loader] variation file not found: ${entry.path} — skipped`);
      continue;
    }

    let variation;
    try {
      variation = JSON.parse(variationRaw);
    } catch {
      console.warn(`[variations-loader] variation file is not valid JSON: ${entry.path} — skipped`);
      continue;
    }

    if (!variation.id) {
      console.warn(
        `[variations-loader] variation file missing "id" field: ${entry.path} — skipped`,
      );
      continue;
    }

    const tokenCss = tokenOverridesToCss(variation.tokenOverrides);
    const componentCss = componentSpecificToCss(variation.componentSpecific);
    const css = [tokenCss, componentCss].filter(Boolean).join('\n');

    results.push({
      id: variation.id,
      name: variation.name ?? entry.name ?? variation.id,
      css,
      agents: variation.supportedAgents ?? [],
    });
  }

  return results;
}
