// SPDX-License-Identifier: MPL-2.0

/**
 * Pipeline abstraction for apply/restore background tasks.
 * Each stage declares its dependencies and error policy.
 */

import type { AgentId } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageErrorPolicy = 'fail-fast' | 'continue' | 'retry';

export interface StageContext {
  appId: AgentId;
  port: number;
  epoch: number;
  isEpochCurrent: () => boolean;
  signal?: AbortSignal;
}

export interface Stage<T = unknown> {
  name: string;
  deps?: string[];
  policy?: StageErrorPolicy;
  maxRetries?: number;
  run: (ctx: StageContext) => Promise<T>;
}

export interface PipelineResult {
  completed: string[];
  failed: { name: string; error: Error }[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
  private stages = new Map<string, Stage>();

  add(stage: Stage): this {
    this.stages.set(stage.name, stage);
    return this;
  }

  async exec(ctx: StageContext): Promise<PipelineResult> {
    const result: PipelineResult = { completed: [], failed: [], skipped: [] };
    const completed = new Set<string>();
    const failed = new Set<string>();

    const runStage = async (name: string): Promise<void> => {
      if (completed.has(name) || failed.has(name)) return;
      const stage = this.stages.get(name);
      if (!stage) {
        result.skipped.push(name);
        return;
      }

      // Run dependencies first
      if (stage.deps) {
        for (const dep of stage.deps) {
          if (failed.has(dep) && stage.policy !== 'continue') {
            result.skipped.push(name);
            return;
          }
          await runStage(dep);
        }
      }

      if (ctx.isEpochCurrent && !ctx.isEpochCurrent()) {
        result.skipped.push(name);
        return;
      }

      // Execute with retry
      let lastError: Error | null = null;
      const maxRetries = stage.maxRetries ?? (stage.policy === 'retry' ? 2 : 0);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await stage.run(ctx);
          completed.add(name);
          result.completed.push(name);
          return;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          }
        }
      }

      failed.add(name);
      result.failed.push({ name, error: lastError! });
    };

    await Promise.all([...this.stages.keys()].map(runStage));
    return result;
  }
}

export function createPipeline(): Pipeline {
  return new Pipeline();
}
