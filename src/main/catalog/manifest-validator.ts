// SPDX-License-Identifier: MPL-2.0

/**
 * # manifest-validator
 *
 * Zero-dependency JSON Schema (draft-07 subset) validator driven by the
 * AUTHORITATIVE manifest schema (`./manifest-v2.schema.json`, A1). This closes
 * SPEC-2: the schema previously lived only in `docs/` with zero code
 * references — validation was hand-written in `theme-package-loader.ts`,
 * making two sources of truth that could drift.
 *
 * Supported keywords (enough for the manifest schema; unknown keywords are
 * ignored so the validator stays forward-compatible):
 *   type, enum, const, required, properties, additionalProperties (bool),
 *   items (single schema), oneOf, minLength, maxLength, pattern,
 *   minimum, maximum, $ref / $defs, format (lenient URI/email check).
 *
 * Additionally performs the cross-field checks the JSON Schema cannot
 * express (SPEC-3):
 *   - `targets` keys must be known agent ids (else a typo'd key silently
 *     loads a theme that applies to nothing).
 *   - `supportedAgents` entries must be known agent ids.
 *   - `supportedAgents` must be a superset of `targets` keys.
 *
 * Errors carry a JSON path (e.g. "colors.background") so callers can reject
 * with actionable messages.
 */

import schemaJson from './manifest-v2.schema.json';

/** Known agent ids — the 6 active product agents plus experimental adapters
 *  registered in the registry (see src/shared/types.ts AGENT_META). A targets
 *  key outside this set is a typo, not a new agent. */
export const KNOWN_AGENT_IDS: readonly string[] = [
  // active
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
  // experimental (registered adapters, no engine wiring yet)
  'codebuddy',
  'marscode',
  'comate',
  'tongyi_lingma',
  'tencent_ai_code',
];

export interface SchemaError {
  /** JSON path of the offending node (e.g. "colors.background"). */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Schema model (structural subset of JSON Schema draft-07)
// ---------------------------------------------------------------------------

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  /** boolean = forbid extra properties; schema = validate extra against it. */
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  format?: string;
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true; // unknown type keyword — don't fail closed on forward schema
  }
}

/** Lenient format check: only URI/email shapes are guarded; anything else
 *  passes so a stricter future schema doesn't reject valid packages. */
function checkFormat(value: string, format: string): boolean {
  if (format === 'uri') {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(value) || /^mailto:/.test(value);
  }
  if (format === 'email') {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }
  if (format === 'uri-reference') {
    return typeof value === 'string';
  }
  return true;
}

function validateNode(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: SchemaError[],
  defs: Record<string, JsonSchema>,
): void {
  // $ref resolution (only internal $defs refs are supported).
  if (schema.$ref) {
    const target = defs[schema.$ref] ?? defs[schema.$ref.replace(/^#\/\$defs\//, '')];
    if (target) {
      validateNode(value, target, path, errors, defs);
      return;
    }
    errors.push({ path, message: `unresolvable $ref "${schema.$ref}"` });
    return;
  }

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    errors.push({ path, message: `expected ${schema.type}, got ${describeType(value)}` });
    return; // further keyword checks assume the type — bail early
  }

  if (schema.enum !== undefined && !schema.enum.some((e) => Object.is(e, value))) {
    errors.push({
      path,
      message: `value must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`,
    });
  }

  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    errors.push({ path, message: `value must equal ${JSON.stringify(schema.const)}` });
  }

  if (schema.oneOf !== undefined) {
    const matched = schema.oneOf.filter((sub) => {
      const subErrors: SchemaError[] = [];
      validateNode(value, sub, path, subErrors, defs);
      return subErrors.length === 0;
    }).length;
    if (matched !== 1) {
      errors.push({
        path,
        message: `value must satisfy exactly one alternative (matched ${matched} of ${schema.oneOf.length})`,
      });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `must be at least ${schema.minLength} chars` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `must be at most ${schema.maxLength} chars` });
    }
    if (schema.pattern !== undefined) {
      let re: RegExp;
      try {
        re = new RegExp(schema.pattern);
      } catch {
        errors.push({ path, message: `invalid schema pattern "${schema.pattern}"` });
        return;
      }
      if (!re.test(value)) {
        errors.push({ path, message: `value does not match pattern ${schema.pattern}` });
      }
    }
    if (schema.format !== undefined && !checkFormat(value, schema.format)) {
      errors.push({ path, message: `value is not a valid ${schema.format}` });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    // Local const so the arrow-function closure keeps the narrowing.
    const items = schema.items;
    if (items !== undefined) {
      value.forEach((item, i) => {
        validateNode(item, items, `${path}[${i}]`, errors, defs);
      });
    }
    return;
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in record)) {
          errors.push({ path, message: `missing required property "${key}"` });
        }
      }
    }
    if (schema.properties !== undefined) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in record) {
          validateNode(record[key], subSchema, path ? `${path}.${key}` : key, errors, defs);
        }
      }
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(record)) {
        if (schema.properties && key in schema.properties) continue;
        if (schema.additionalProperties === false) {
          errors.push({ path, message: `unknown property "${key}"` });
        } else if (typeof schema.additionalProperties === 'object') {
          validateNode(record[key], schema.additionalProperties, `${path}.${key}`, errors, defs);
        }
      }
    }
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ---------------------------------------------------------------------------
// Cross-field checks (SPEC-3)
// ---------------------------------------------------------------------------

function crossFieldErrors(manifest: Record<string, unknown>): SchemaError[] {
  const errors: SchemaError[] = [];

  const targets = manifest.targets;
  if (targets !== undefined) {
    if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) {
      errors.push({ path: 'targets', message: 'expected an object keyed by agent id' });
    } else {
      for (const key of Object.keys(targets as Record<string, unknown>)) {
        if (!KNOWN_AGENT_IDS.includes(key)) {
          errors.push({
            path: `targets.${key}`,
            message: `unknown agent id "${key}" (known: ${KNOWN_AGENT_IDS.join(', ')})`,
          });
        }
      }
    }
  }

  const supported = manifest.supportedAgents;
  if (supported !== undefined) {
    if (!Array.isArray(supported)) {
      errors.push({ path: 'supportedAgents', message: 'expected an array of agent ids' });
    } else {
      for (const [i, id] of supported.entries()) {
        if (typeof id !== 'string' || !KNOWN_AGENT_IDS.includes(id)) {
          errors.push({
            path: `supportedAgents[${i}]`,
            message: `unknown agent id "${String(id)}" (known: ${KNOWN_AGENT_IDS.join(', ')})`,
          });
        }
      }
      // supportedAgents must be a superset of targets keys.
      if (typeof targets === 'object' && targets !== null && !Array.isArray(targets)) {
        for (const key of Object.keys(targets as Record<string, unknown>)) {
          if (!supported.includes(key)) {
            errors.push({
              path: 'supportedAgents',
              message: `agent "${key}" declared in targets but missing from supportedAgents`,
            });
          }
        }
      }
    }
  }

  // colorSchemes: each entry must be a safe scheme id (matching the theme-id
  // rule) and must not collide with the reserved 'default' id, which always
  // refers to the manifest's own colors.
  const schemes = manifest.colorSchemes;
  if (schemes !== undefined) {
    if (!Array.isArray(schemes)) {
      errors.push({ path: 'colorSchemes', message: 'expected an array of scheme ids' });
    } else {
      const seen = new Set<string>();
      for (const [i, id] of schemes.entries()) {
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
          errors.push({
            path: `colorSchemes[${i}]`,
            message: `invalid scheme id "${String(id)}" (must match ${'^[a-z0-9][a-z0-9_-]*$'})`,
          });
        } else if (id === 'default') {
          errors.push({
            path: `colorSchemes[${i}]`,
            message: '"default" is reserved for the manifest\'s own colors',
          });
        } else if (seen.has(id)) {
          errors.push({ path: `colorSchemes[${i}]`, message: `duplicate scheme id "${id}"` });
        } else {
          seen.add(id);
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate a parsed manifest against the authoritative schema + cross-field
 *  rules. Returns a flat list of errors (empty = valid). */
export function validateManifest(manifest: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  const defs: Record<string, JsonSchema> = (schemaJson.$defs ?? {}) as Record<string, JsonSchema>;
  validateNode(manifest, schemaJson as unknown as JsonSchema, '', errors, defs);
  if (typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)) {
    errors.push(...crossFieldErrors(manifest as Record<string, unknown>));
  }
  return errors;
}

/** Format errors as a single line for exception messages / warnings. */
export function formatSchemaErrors(errors: SchemaError[]): string {
  return errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
}
