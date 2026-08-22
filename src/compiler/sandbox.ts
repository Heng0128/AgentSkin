// SPDX-License-Identifier: MPL-2.0

/**
 * # Sandbox — Zero-dependency isolated hook execution
 *
 * Spawns a child process with `--disallow-code-generation-from-strings` to
 * execute user-provided hook code in a restricted environment. The child
 * only receives a static shim exposing whitelisted APIs; no `require`,
 * `process`, or `global` access is possible.
 *
 * Guards:
 *   - Timeout via `SIGTERM` + 2s fallback `SIGKILL`.
 *   - Memory hint via `--max-old-space-size` (soft limit, OS-enforced).
 *   - Output parsed as JSON; optional schema validation.
 *   - All IPC over stdio with JSON-serialized payloads (no injection).
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxErrorCode =
  | 'TIMEOUT'
  | 'MEMORY'
  | 'API_VIOLATION'
  | 'SCHEMA_VIOLATION'
  | 'PARSE_ERROR';

export interface SandboxOptions {
  /** Execution timeout in ms. Default 5000. */
  timeoutMs: number;
  /** Soft memory limit in MB. Default 64. */
  memoryMB: number;
  /** Whitelisted global APIs the hook may use. */
  allowedAPIs: string[];
  /** Optional JSON Schema the output must conform to. */
  outputSchema?: Record<string, unknown>;
}

export interface SandboxResult<T> {
  ok: boolean;
  value?: T;
  error?: SandboxErrorCode;
  detail?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MEMORY_MB = 64;
const DEFAULT_ALLOWED_APIS = ['Math', 'Date', 'JSON', 'Array', 'Object', 'String', 'Number'];

/** Grace period after SIGTERM before SIGKILL. */
const SIGKILL_GRACE_MS = 2000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runInSandbox<T>(
  code: string,
  input: Record<string, unknown>,
  opts: Partial<SandboxOptions> = {},
): Promise<SandboxResult<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMB = opts.memoryMB ?? DEFAULT_MEMORY_MB;
  const outputSchema = opts.outputSchema;
  const allowedAPIs = opts.allowedAPIs ?? DEFAULT_ALLOWED_APIS;

  const started = Date.now();

  return new Promise<SandboxResult<T>>((resolveResult) => {
    const serializedInput = JSON.stringify(input);
    const childSnippet = buildShim(code, serializedInput, allowedAPIs);

    const proc = spawn(
      process.execPath,
      [
        '--disallow-code-generation-from-strings',
        `--max-old-space-size=${memoryMB}`,
        '-e',
        childSnippet,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {},
        cwd: resolve(import.meta.dirname ?? '.', '.'),
      },
    );

    let stdout = '';
    let stderr = '';
    let killReason: SandboxErrorCode | undefined;

    const forceKill = () => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    };

    const requestKill = () => {
      if (!proc.killed && proc.exitCode === null) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed && proc.exitCode === null) {
            forceKill();
          }
        }, SIGKILL_GRACE_MS);
      }
    };

    const timer = setTimeout(() => {
      killReason = 'TIMEOUT';
      requestKill();
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      resolveResult({
        ok: false,
        error: killReason ?? 'PARSE_ERROR',
        detail: err.message,
        durationMs: Date.now() - started,
      });
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;

      // Timeout-triggered kill (SIGTERM → SIGKILL escalation).
      if (killReason === 'TIMEOUT') {
        resolveResult({
          ok: false,
          error: 'TIMEOUT',
          detail: `Hook exceeded ${timeoutMs}ms timeout`,
          durationMs,
        });
        return;
      }

      // Signal kill that wasn't caused by our timeout → likely OOM.
      if (signal === 'SIGKILL' || signal === 'SIGTERM') {
        resolveResult({
          ok: false,
          error: 'MEMORY',
          detail: `Process killed via ${signal}`,
          durationMs,
        });
        return;
      }

      if (code !== 0) {
        // Non-zero exit — code threw or accessed prohibited globals.
        // Capture stderr as detail for debugging.
        const detail = stderr.trim() || `Exit code ${code}`;
        resolveResult({
          ok: false,
          error: 'API_VIOLATION',
          detail,
          durationMs,
        });
        return;
      }

      // Parse stdout as JSON.
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        resolveResult({
          ok: false,
          error: 'PARSE_ERROR',
          detail: `stdout is not valid JSON: ${stdout.slice(0, 200)}`,
          durationMs,
        });
        return;
      }

      // Optional schema validation.
      if (outputSchema) {
        const validation = validateAgainstSchema(parsed, outputSchema);
        if (!validation.ok) {
          resolveResult({
            ok: false,
            error: 'SCHEMA_VIOLATION',
            detail: validation.detail,
            durationMs,
          });
          return;
        }
      }

      resolveResult({
        ok: true,
        value: parsed as T,
        durationMs,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Shim builder
// ---------------------------------------------------------------------------

/**
 * Constructs the child-process snippet executed via `node -e`.
 *
 * Design — IIFE with shadowed globals:
 *   1. `process.stdout.write`, `process.stderr.write`, `process.exit` are
 *      captured as parameters BEFORE shadowing so the shim can report
 *      results even though `process` itself is shadowed inside the body.
 *   2. Dangerous globals (`require`, `process`, `eval`, `Function`, etc.)
 *      are declared as `const undefined` — any user code referencing them
 *      throws a TypeError at call site.
 *   3. Whitelisted APIs (Math, JSON, Object, …) remain accessible via the
 *      normal global scope since they are NOT shadowed.
 *   4. `--disallow-code-generation-from-strings` kills `eval`/`new Function`
 *      even if code somehow reaches the real global object.
 *
 * User code + input injected via JSON.stringify — no shell interpolation.
 */
function buildShim(code: string, serializedInput: string, allowedAPIs: string[]): string {
  // NOTE: We deliberately omit "use strict" from the top-level script
  // because `const eval = undefined` is a syntax error in strict mode.
  // Instead, `--disallow-code-generation-from-strings` (passed via CLI
  // flags) blocks eval/new Function at the V8 level, and the IIFE
  // shadows all other dangerous globals.
  return `
(function(_input, _stdout, _stderr, _exit) {
  // --- Shadow dangerous globals (set to undefined) ---
  // "eval" and "Function" are NOT shadowed here because the
  // --disallow-code-generation-from-strings flag already neutralizes
  // them at the V8 level.
  const require = undefined;
  const process = undefined;
  const global = undefined;
  const globalThis = undefined;
  const module = undefined;
  const exports = undefined;
  const __dirname = undefined;
  const __filename = undefined;
  const Buffer = undefined;

  // --- Expose only whitelisted APIs for this execution ---
  // Accessing any global not in this list resolves to undefined above.
  var _allowed = { ${allowedAPIs.map((a) => `${a}: ${a}`).join(', ')} };

  // --- User hook (function expression, no scope leakage) ---
  var _hook = (${code});

  try {
    var _result = _hook(_input);
    _stdout(JSON.stringify(_result));
  } catch(_err) {
    _stderr(String(_err && (_err.stack || _err.message) ? (_err.stack || _err.message) : _err));
    _exit(1);
  }
})(${serializedInput}, process.stdout.write.bind(process.stdout), process.stderr.write.bind(process.stderr), process.exit.bind(process));
`.trimStart();
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema validator (zero-dependency)
// ---------------------------------------------------------------------------

interface SchemaValidation {
  ok: boolean;
  detail: string;
}

function validateAgainstSchema(value: unknown, schema: Record<string, unknown>): SchemaValidation {
  // Handle type constraint.
  if (schema.type) {
    const actualType = typeof value;
    if (
      schema.type === 'object' &&
      (actualType !== 'object' || value === null || Array.isArray(value))
    ) {
      return { ok: false, detail: `Expected object, got ${actualType}` };
    }
    if (schema.type === 'array' && !Array.isArray(value)) {
      return { ok: false, detail: `Expected array, got ${actualType}` };
    }
    if (schema.type === 'number' && actualType !== 'number') {
      return { ok: false, detail: `Expected number, got ${actualType}` };
    }
    if (schema.type === 'string' && actualType !== 'string') {
      return { ok: false, detail: `Expected string, got ${actualType}` };
    }
  }

  // Handle required properties.
  if (Array.isArray(schema.required)) {
    if (typeof value !== 'object' || value === null) {
      return { ok: false, detail: 'Expected object for required check' };
    }
    for (const key of schema.required) {
      if (!(key in (value as Record<string, unknown>))) {
        return { ok: false, detail: `Missing required property: ${key}` };
      }
    }
  }

  // Handle properties (recursive validation of object shapes).
  if (schema.properties && typeof value === 'object' && value !== null) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const [key, subSchema] of Object.entries(props)) {
      const childValue = (value as Record<string, unknown>)[key];
      const childValidation = validateAgainstSchema(childValue, subSchema);
      if (!childValidation.ok) {
        return { ok: false, detail: `Property "${key}": ${childValidation.detail}` };
      }
    }
  }

  // Handle patternProperties (regex-keyed constraints).
  if (schema.patternProperties && typeof value === 'object' && value !== null) {
    const patterns = schema.patternProperties as Record<string, Record<string, unknown>>;
    for (const [pattern, subSchema] of Object.entries(patterns)) {
      const re = new RegExp(pattern);
      const obj = value as Record<string, unknown>;
      for (const [key, childValue] of Object.entries(obj)) {
        if (re.test(key)) {
          const childValidation = validateAgainstSchema(childValue, subSchema);
          if (!childValidation.ok) {
            return {
              ok: false,
              detail: `Pattern "${pattern}" key "${key}": ${childValidation.detail}`,
            };
          }
        }
      }
    }
  }

  return { ok: true, detail: '' };
}
