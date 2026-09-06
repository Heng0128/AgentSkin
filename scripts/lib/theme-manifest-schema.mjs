// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-manifest-schema.mjs — Schema-driven compatibility pre-check
 *
 * Defines the schema contracts for theme manifest `verification` blocks.
 * Pure types + constants only — no I/O, no side effects.
 *
 * The verification schema lets a theme declare which DOM landmarks it depends
 * on for each adapter. Before applying a theme, `validate-theme.mjs` checks
 * the declarations against a live DOM snapshot and produces a clear兼容性
 * report — missing landmarks are flagged explicitly instead of silently
 * producing broken UI.
 *
 * Schema shape (per-adapter `verification` block):
 *
 *   required_landmarks:    [{ name: string, selectors: string[] }]
 *   recommended_landmarks: [{ name: string, selectors: string[] }]
 *   contexts:             [{ name: string, when: string[], required: [{ name: string, selectors: string[] }] }]
 *
 *   - `required_landmarks`:  must all be present for the theme to render correctly.
 *   - `recommended_landmarks`: optional; missing ones trigger warnings, not errors.
 *   - `contexts`: conditional landmark groups — only checked when the adapter
 *     matches ALL of the `when` tags (e.g. ["dark", "sidebar-collapsed"]).
 *
 * Inspired by CodeDrobe's schema-driven pre-check, adapted for AgentSkin's
 * six-adapter CDP injection model.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The six built-in adapter identifiers — frozen for immutability. */
export const ADAPTER_IDS = Object.freeze([
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
]);

/** Result severity levels for compatibility reports. */
export const SEVERITY = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
});

/** Maximum number of landmarks allowed per category (guards against abuse). */
export const MAX_LANDMARKS_PER_CATEGORY = 50;

/** Maximum number of contexts allowed per verification block. */
export const MAX_CONTEXTS = 20;

/** Maximum selector length (guards against garbage input). */
export const MAX_SELECTOR_LENGTH = 500;

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current schema version for the verification block. */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Type definitions (JSDoc for editor support — runtime uses plain objects)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Landmark
 * @property {string} name        Human-readable landmark identifier (e.g. "sidebar", "composer").
 * @property {string[]} selectors CSS selectors that could match this landmark (OR semantics).
 */

/**
 * @typedef {Object} Context
 * @property {string} name        Context name (e.g. "dark-sidebar").
 * @property {string[]} when      Adapter tags that must ALL be present for this context to activate.
 * @property {Landmark[]} required  Landmarks required when this context is active.
 */

/**
 * @typedef {Object} VerificationBlock
 * @property {Landmark[]} required_landmarks     Must all be present.
 * @property {Landmark[]} [recommended_landmarks] Optional; missing = warning.
 * @property {Context[]}  [contexts]             Conditional landmark groups.
 */

/**
 * @typedef {Object} DomSnapshot
 * @property {string[]} selectors  All CSS selectors found in the live DOM (from CDP snapshot).
 */

/**
 * @typedef {Object} LandmarkResult
 * @property {string} name       Landmark name.
 * @property {boolean} matched   Whether at least one selector matched the DOM.
 * @property {string[]} checked  Selectors that were checked.
 * @property {string[]} missing  Selectors that did not match (only present when matched=false).
 */

/**
 * @typedef {Object} CompatibilityReport
 * @property {compatible: boolean} compatible  True when all required landmarks matched.
 * @property {adapterId: string} adapterId     Adapter that was checked.
 * @property {LandmarkResult[]} required       Results for required landmarks.
 * @property {LandmarkResult[]} recommended    Results for recommended landmarks.
 * @property {LandmarkResult[]} contexts       Results for context-conditional landmarks.
 * @property {string[]} missing_required       Names of unmatched required landmarks.
 * @property {string[]} missing_recommended    Names of unmatched recommended landmarks.
 * @property {string[]} summary                Human-readable summary lines.
 */

// ---------------------------------------------------------------------------
// Schema validator — pure function
// ---------------------------------------------------------------------------

/**
 * Validate the shape of a single Landmark object.
 * @param {unknown} landmark
 * @param {string} path JSON-path prefix for error messages.
 * @returns {string[]} Array of error strings (empty = valid).
 */
export function validateLandmark(landmark, path) {
  const errors = [];
  if (!landmark || typeof landmark !== 'object' || Array.isArray(landmark)) {
    errors.push(`${path}: must be a non-null object`);
    return errors;
  }
  const lm = landmark;
  if (typeof lm.name !== 'string' || lm.name.trim() === '') {
    errors.push(`${path}.name: must be a non-empty string`);
  }
  if (!Array.isArray(lm.selectors)) {
    errors.push(`${path}.selectors: must be an array of strings`);
  } else if (lm.selectors.length === 0) {
    errors.push(`${path}.selectors: must contain at least one selector`);
  } else {
    for (let i = 0; i < lm.selectors.length; i++) {
      const sel = lm.selectors[i];
      if (typeof sel !== 'string' || sel.trim() === '') {
        errors.push(`${path}.selectors[${i}]: must be a non-empty string`);
      } else if (sel.length > MAX_SELECTOR_LENGTH) {
        errors.push(`${path}.selectors[${i}]: exceeds max length (${MAX_SELECTOR_LENGTH})`);
      }
    }
  }
  return errors;
}

/**
 * Validate a Context object.
 * @param {unknown} context
 * @param {string} path
 * @returns {string[]} Array of error strings (empty = valid).
 */
export function validateContext(context, path) {
  const errors = [];
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    errors.push(`${path}: must be a non-null object`);
    return errors;
  }
  const ctx = context;
  if (typeof ctx.name !== 'string' || ctx.name.trim() === '') {
    errors.push(`${path}.name: must be a non-empty string`);
  }
  if (!Array.isArray(ctx.when) || ctx.when.length === 0) {
    errors.push(`${path}.when: must be a non-empty array of tag strings`);
  } else {
    for (let i = 0; i < ctx.when.length; i++) {
      if (typeof ctx.when[i] !== 'string' || ctx.when[i].trim() === '') {
        errors.push(`${path}.when[${i}]: must be a non-empty string`);
      }
    }
  }
  if (!Array.isArray(ctx.required)) {
    errors.push(`${path}.required: must be an array of landmarks`);
  } else {
    for (let i = 0; i < ctx.required.length; i++) {
      errors.push(...validateLandmark(ctx.required[i], `${path}.required[${i}]`));
    }
  }
  return errors;
}

/**
 * Validate a complete VerificationBlock.
 *
 * All fields are optional at the schema level (a theme may declare only
 * required_landmarks, only recommended_landmarks, or any combination).
 * But if present, each must conform to the shape defined above.
 *
 * @param {unknown} verification
 * @param {string} [path='verification'] JSON-path prefix.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateVerificationBlock(verification, path = 'verification') {
  const errors = [];

  if (verification === undefined || verification === null) {
    return { valid: true, errors: [] };
  }
  if (typeof verification !== 'object' || Array.isArray(verification)) {
    return { valid: false, errors: [`${path}: must be an object`] };
  }
  const v = verification;

  // required_landmarks
  if (v.required_landmarks !== undefined) {
    if (!Array.isArray(v.required_landmarks)) {
      errors.push(`${path}.required_landmarks: must be an array`);
    } else if (v.required_landmarks.length > MAX_LANDMARKS_PER_CATEGORY) {
      errors.push(`${path}.required_landmarks: exceeds max count (${MAX_LANDMARKS_PER_CATEGORY})`);
    } else {
      for (let i = 0; i < v.required_landmarks.length; i++) {
        errors.push(
          ...validateLandmark(v.required_landmarks[i], `${path}.required_landmarks[${i}]`),
        );
      }
    }
  }

  // recommended_landmarks
  if (v.recommended_landmarks !== undefined) {
    if (!Array.isArray(v.recommended_landmarks)) {
      errors.push(`${path}.recommended_landmarks: must be an array`);
    } else if (v.recommended_landmarks.length > MAX_LANDMARKS_PER_CATEGORY) {
      errors.push(
        `${path}.recommended_landmarks: exceeds max count (${MAX_LANDMARKS_PER_CATEGORY})`,
      );
    } else {
      for (let i = 0; i < v.recommended_landmarks.length; i++) {
        errors.push(
          ...validateLandmark(v.recommended_landmarks[i], `${path}.recommended_landmarks[${i}]`),
        );
      }
    }
  }

  // contexts
  if (v.contexts !== undefined) {
    if (!Array.isArray(v.contexts)) {
      errors.push(`${path}.contexts: must be an array`);
    } else if (v.contexts.length > MAX_CONTEXTS) {
      errors.push(`${path}.contexts: exceeds max count (${MAX_CONTEXTS})`);
    } else {
      for (let i = 0; i < v.contexts.length; i++) {
        errors.push(...validateContext(v.contexts[i], `${path}.contexts[${i}]`));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that an adapterId is one of the six built-in adapters.
 * @param {unknown} adapterId
 * @returns {boolean}
 */
export function isValidAdapterId(adapterId) {
  return typeof adapterId === 'string' && ADAPTER_IDS.includes(adapterId);
}

export default {
  ADAPTER_IDS,
  SEVERITY,
  MAX_LANDMARKS_PER_CATEGORY,
  MAX_CONTEXTS,
  MAX_SELECTOR_LENGTH,
  SCHEMA_VERSION,
  validateLandmark,
  validateContext,
  validateVerificationBlock,
  isValidAdapterId,
};
