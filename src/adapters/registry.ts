// SPDX-License-Identifier: MPL-2.0

/**
 * # Adapter Registry
 *
 * The SINGLE source of ApplicationAdapter instances. agent-engine-service and
 * any future consumer look up adapters through `getAdapter(id)` / `listAdapters()`
 * — never by constructing adapters directly or switching on app ids.
 *
 * `registerBuiltinAdapters()` is idempotent and wires the built-in set:
 *
 *   active (backed by @agentskin/engine):
 *     traework, qoderwork, workbuddy, doubao, codex
 *
 *   experimental (registered for discovery, not yet functional):
 *     codebuddy, marscode, comate, tongyi_lingma, tencent_ai_code
 *
 * Call it once during startup (see main.ts). Custom adapters can be added
 * later via `registerAdapter()` — the registry does not care where an adapter
 * comes from, only that it implements the contract.
 */

import type { AdapterTier, ApplicationAdapter } from './base';
import { CodebuddyAdapter } from './domestic/codebuddy';
import { CodexAdapter } from './domestic/codex';
import { ComateAdapter } from './domestic/comate';
import { DoubaoAdapter } from './domestic/doubao';
import { MarscodeAdapter } from './domestic/marscode';
import { QoderAdapter } from './domestic/qoder';
import { TencentAiCodeAdapter } from './domestic/tencent-ai-code';
import { TongyiLingmaAdapter } from './domestic/tongyi-lingma';
import { TraeAdapter } from './domestic/trae';
import { WorkbuddyAdapter } from './domestic/workbuddy';
import { ZcodeAdapter } from './domestic/zcode';

const adapters = new Map<string, ApplicationAdapter>();
let builtinRegistered = false;

/** Register a single adapter. Later registrations with the same id replace earlier ones. */
export function registerAdapter(adapter: ApplicationAdapter): void {
  adapters.set(adapter.id, adapter);
}

/** Look up an adapter by id. Returns undefined when the id is not registered. */
export function getAdapter(id: string): ApplicationAdapter | undefined {
  return adapters.get(id);
}

/**
 * Look up an adapter by id, throwing if it is missing. Use this in code paths
 * where a missing adapter is a programming error (e.g. agent-engine-service).
 */
export function requireAdapter(id: string): ApplicationAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`No application adapter registered for id "${id}".`);
  return adapter;
}

/** All registered adapters, in insertion order. */
export function listAdapters(): ApplicationAdapter[] {
  return [...adapters.values()];
}

/** Registered adapters filtered by tier. */
export function listAdaptersByTier(tier: AdapterTier): ApplicationAdapter[] {
  return listAdapters().filter((adapter) => adapter.tier === tier);
}

/** Convenience: the ids of all active adapters. */
export function activeAdapterIds(): string[] {
  return listAdaptersByTier('active').map((adapter) => adapter.id);
}

/**
 * Register the built-in adapter set. Idempotent — safe to call more than once
 * (subsequent calls are no-ops). Called once during app startup in main.ts.
 */
export function registerBuiltinAdapters(): void {
  if (builtinRegistered) return;
  builtinRegistered = true;

  // --- Active: backed by @agentskin/engine ---
  registerAdapter(new TraeAdapter());
  registerAdapter(new QoderAdapter());
  registerAdapter(new WorkbuddyAdapter());
  registerAdapter(new DoubaoAdapter());
  registerAdapter(new CodexAdapter());
  registerAdapter(new ZcodeAdapter());

  // --- Experimental: registered for discovery, not yet wired to core ---
  registerAdapter(new CodebuddyAdapter());
  registerAdapter(new MarscodeAdapter());
  registerAdapter(new ComateAdapter());
  registerAdapter(new TongyiLingmaAdapter());
  registerAdapter(new TencentAiCodeAdapter());
}
