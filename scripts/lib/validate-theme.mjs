// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme.mjs — schema-driven compatibility pre-check engine.
 *
 * Pure functions that validate a theme package's `verification` block
 * against a live DOM snapshot and produce a clear compatibility report.
 *
 * No I/O, no side effects — every function is deterministic and testable.
 *
 * Public API:
 *   - validateThemePackage(manifest, adapterId)
 *       Validates the shape of manifest.verification[adapterId].
 *   - checkLandmarks(landmarks, domSnapshot)
 *       Checks whether each landmark has at least one selector present in the DOM.
 *   - getCompatibilityReport(manifest, adapterId, domSnapshot)
 *       Full compatibility report: required/recommended/contexts.
 *
 * The verification block schema (per adapter):
 *   {
 *     required_landmarks:    [{ name, selectors: string[] }],
 *     recommended_landmarks: [{ name, selectors: string[] }],
 *     contexts:             [{ name, when: string[], required: [{ name, selectors }] }]
 *   }
 *
 *   Required landmarks must all match (or the theme is incompatible).
 *   Recommended landmarks that are missing produce warnings.
 *   Contexts are conditional — only evaluated when `contextTags` includes
 *   ALL of the context's `when` tags.
 */

import { getLandmarksForAdapter } from './landmarks/index.mjs';
import { isValidAdapterId, validateVerificationBlock } from './theme-manifest-schema.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a single landmark matches the DOM snapshot.
 * A landmark matches when at least one of its selectors is found
 * in the snapshot's selector set.
 *
 * @param {{ name: string, selectors: string[] }} landmark
 * @param {Set<string>} selectorSet  Normalized set of DOM selectors.
 * @returns {{ name: string, matched: boolean, checked: string[], missing: string[] }}
 */
function matchLandmark(landmark, selectorSet) {
  const checked = landmark.selectors;
  const missing = [];
  let matched = false;
  for (const sel of checked) {
    if (selectorSet.has(sel)) {
      matched = true;
    } else {
      missing.push(sel);
    }
  }
  return { name: landmark.name, matched, checked, missing };
}

/**
 * Normalize a DomSnapshot (with a `selectors` array) into a Set for O(1) lookups.
 * @param {{ selectors: string[] }} domSnapshot
 * @returns {Set<string>}
 */
function toSelectorSet(domSnapshot) {
  if (!domSnapshot || !Array.isArray(domSnapshot.selectors)) {
    return new Set();
  }
  return new Set(domSnapshot.selectors);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the shape of a theme package's verification block for a given adapter.
 *
 * This is a **structural** check — it confirms the verification block is
 * well-formed (correct types, non-empty arrays, selector strings) without
 * inspecting any live DOM. Use `getCompatibilityReport` for the full check.
 *
 * @param {Object} manifest  The theme manifest (parsed JSON).
 * @param {string} adapterId  One of the six adapter ids.
 * @returns {{ valid: boolean, errors: string[] }}
 *   `valid` is true when the verification block is well-formed (or absent).
 *   `errors` lists structural problems (missing fields, wrong types, etc.).
 */
export function validateThemePackage(manifest, adapterId) {
  if (!isValidAdapterId(adapterId)) {
    return { valid: false, errors: [`unknown adapterId: "${adapterId}"`] };
  }
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest must be a non-null object'] };
  }

  // verification is optional at top level; if absent, nothing to validate.
  const verification = manifest.verification;
  if (verification === undefined) {
    return { valid: true, errors: [] };
  }

  // If verification exists, it must be an object with per-adapter blocks.
  if (typeof verification !== 'object' || Array.isArray(verification)) {
    return { valid: false, errors: ['verification must be an object'] };
  }

  // Validate the per-adapter block (if present for this adapter).
  const adapterBlock = verification[adapterId];
  if (adapterBlock === undefined) {
    return { valid: true, errors: [] };
  }

  const result = validateVerificationBlock(adapterBlock, `verification.${adapterId}`);
  return result;
}

/**
 * Check whether a list of landmarks are present in a DOM snapshot.
 *
 * Pure function — pass in the landmarks array and a snapshot, get back
 * per-landmark match results. Missing selectors are reported explicitly
 * so error messages can guide the user to what is unavailable.
 *
 * @param {{ name: string, selectors: string[] }[]} landmarks
 * @param {{ selectors: string[] }} domSnapshot
 * @returns {{ name: string, matched: boolean, checked: string[], missing: string[] }[]}
 */
export function checkLandmarks(landmarks, domSnapshot) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    return [];
  }
  const selectorSet = toSelectorSet(domSnapshot);
  return landmarks.map((lm) => matchLandmark(lm, selectorSet));
}

/**
 * Generate a full compatibility report for one adapter.
 *
 * Combines the theme's declared `verification` block with the adapter's
 * built-in landmarks and a live DOM snapshot. The result tells you:
 *   - Whether the theme is compatible (all required landmarks matched).
 *   - Which required landmarks are missing (with their selectors).
 *   - Which recommended landmarks are missing (warnings).
 *   - Whether conditional contexts are active and satisfied.
 *
 * @param {Object} manifest  The theme manifest (parsed JSON).
 * @param {string} adapterId  One of the six adapter ids.
 * @param {{ selectors: string[] }} domSnapshot  Live DOM selectors from CDP.
 * @param {Object} [options]
 * @param {string[]} [options.contextTags]  Tags to activate conditional contexts (e.g. ["dark"]).
 * @returns {{
 *   compatible: boolean,
 *   adapterId: string,
 *   required: { name: string, matched: boolean, checked: string[], missing: string[] }[],
 *   recommended: { name: string, matched: boolean, checked: string[], missing: string[] }[],
 *   contexts: { name: string, active: boolean, required: { name: string, matched: boolean, checked: string[], missing: string[] }[] }[],
 *   missing_required: string[],
 *   missing_recommended: string[],
 *   summary: string[],
 * }}
 */
export function getCompatibilityReport(manifest, adapterId, domSnapshot, options = {}) {
  const contextTags = options.contextTags ?? [];
  const selectorSet = toSelectorSet(domSnapshot);

  // Start with the built-in landmarks for this adapter.
  const builtin = getLandmarksForAdapter(adapterId) ?? { required: [], recommended: [] };

  // Merge with any explicit verification block from the manifest.
  const verification = manifest?.verification?.[adapterId] ?? {};
  const declaredRequired = Array.isArray(verification.required_landmarks)
    ? verification.required_landmarks
    : [];
  const declaredRecommended = Array.isArray(verification.recommended_landmarks)
    ? verification.recommended_landmarks
    : [];
  const declaredContexts = Array.isArray(verification.contexts) ? verification.contexts : [];

  // Combined landmark lists: built-in + declared (dedup by name).
  const requiredMap = new Map();
  for (const lm of [...builtin.required, ...declaredRequired]) {
    if (!requiredMap.has(lm.name)) requiredMap.set(lm.name, lm);
  }
  const recommendedMap = new Map();
  for (const lm of [...builtin.recommended, ...declaredRecommended]) {
    if (!recommendedMap.has(lm.name)) recommendedMap.set(lm.name, lm);
  }

  const required = [...requiredMap.values()].map((lm) => matchLandmark(lm, selectorSet));
  const recommended = [...recommendedMap.values()].map((lm) => matchLandmark(lm, selectorSet));

  // Evaluate contexts: active only when ALL `when` tags are in contextTags.
  const contexts = declaredContexts.map((ctx) => {
    const active = ctx.when.every((tag) => contextTags.includes(tag));
    const ctxRequired = active ? ctx.required.map((lm) => matchLandmark(lm, selectorSet)) : [];
    return { name: ctx.name, active, required: ctxRequired };
  });

  const missing_required = required.filter((r) => !r.matched).map((r) => r.name);
  const missing_recommended = recommended.filter((r) => !r.matched).map((r) => r.name);

  // Also count context-required landmarks that are active but missing.
  const missing_context_required = [];
  for (const ctx of contexts) {
    if (ctx.active) {
      for (const r of ctx.required) {
        if (!r.matched) missing_context_required.push(`${ctx.name}/${r.name}`);
      }
    }
  }

  // Compatible = no missing required + no missing active context required.
  const compatible = missing_required.length === 0 && missing_context_required.length === 0;

  // Build human-readable summary.
  const summary = [];
  if (compatible) {
    summary.push(`Adapter "${adapterId}": compatible.`);
  } else {
    summary.push(`Adapter "${adapterId}": INCOMPATIBLE.`);
  }
  if (missing_required.length > 0) {
    summary.push(`  Missing required landmarks: ${missing_required.join(', ')}.`);
  }
  if (missing_recommended.length > 0) {
    summary.push(`  Missing recommended landmarks: ${missing_recommended.join(', ')}.`);
  }
  for (const ctx of contexts) {
    if (ctx.active) {
      const ctxMissing = ctx.required.filter((r) => !r.matched).map((r) => r.name);
      if (ctxMissing.length > 0) {
        summary.push(`  Context "${ctx.name}" missing: ${ctxMissing.join(', ')}.`);
      }
    }
  }

  return {
    compatible,
    adapterId,
    required,
    recommended,
    contexts,
    missing_required,
    missing_recommended,
    missing_context_required,
    summary,
  };
}

export default {
  validateThemePackage,
  checkLandmarks,
  getCompatibilityReport,
};
