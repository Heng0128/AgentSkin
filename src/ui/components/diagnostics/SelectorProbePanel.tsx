// SPDX-License-Identifier: MPL-2.0

/**
 * # SelectorProbePanel
 *
 * Diagnostics panel for CSS selector testing. Allows:
 *   1. Probing a single selector against a live CDP target
 *   2. Validating a batch of selectors for an agent
 *
 * Data flows from `useSelectorStore`.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useSelectorStore } from '@/stores/selectorStore';

import { Crosshair, FileSearch, Search, ShieldCheck } from 'lucide-react';

export function SelectorProbePanel() {
  const { probeResult, validationReport, probing, validating, probe, validate } =
    useSelectorStore();

  const [port, setPort] = useState('9222');
  const [agentId, setAgentId] = useState('trae');
  const [selector, setSelector] = useState('');
  const [batchSelectors, setBatchSelectors] = useState('');

  return (
    <div className="flex flex-col gap-4">
      {/* Single selector probe */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Crosshair className="size-3.5 text-primary" />
          Selector Probe
        </h3>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="CDP Port"
            className="w-24 text-[12px]"
          />
          <Input
            type="text"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder="e.g. .monaco-editor .overflow-guard"
            className="flex-1 text-[12px]"
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => void probe(Number.parseInt(port, 10) || 9222, selector)}
            disabled={probing || !selector}
          >
            {probing ? <Spinner /> : <Search className="size-3.5" />}
            Probe
          </Button>
        </div>
        {probeResult && (
          <div className="rounded-md border border-border bg-card2 p-2.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">Result</span>
              <span
                className={cn(
                  'tabular-nums',
                  probeResult.kind === 'hit'
                    ? 'text-cr-success'
                    : probeResult.kind === 'miss'
                      ? 'text-muted-foreground'
                      : 'text-destructive',
                )}
              >
                {probeResult.kind} ({probeResult.count} match{probeResult.count === 1 ? '' : 'es'})
              </span>
            </div>
            {probeResult.error && <p className="mt-1 text-destructive">{probeResult.error}</p>}
            {probeResult.boundingBox && (
              <p className="mt-1 font-mono text-muted-foreground">
                Box: {probeResult.boundingBox.width.toFixed(0)}×
                {probeResult.boundingBox.height.toFixed(0)} @ (
                {probeResult.boundingBox.x.toFixed(0)}, {probeResult.boundingBox.y.toFixed(0)})
              </p>
            )}
          </div>
        )}
      </div>

      {/* Batch selector validation */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          Batch Validation
        </h3>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="Agent ID"
            className="w-32 text-[12px]"
          />
          <Input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="Port"
            className="w-24 text-[12px]"
          />
        </div>
        <Textarea
          value={batchSelectors}
          onChange={(e) => setBatchSelectors(e.target.value)}
          placeholder=".monaco-editor&#10;.titlebar&#10;.activitybar"
          className="min-h-[80px] font-mono text-[12px]"
        />
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            const selectors = batchSelectors
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            void validate(Number.parseInt(port, 10) || 9222, agentId, selectors);
          }}
          disabled={validating || !batchSelectors}
        >
          {validating ? <Spinner /> : <FileSearch className="size-3.5" />}
          Validate
        </Button>
        {validationReport && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card2 p-2.5">
            {validationReport.results?.map((r, i) => (
              <div
                key={`val-result-${i}`}
                className={cn(
                  'flex items-center justify-between text-[11px]',
                  r.kind === 'hit' ? 'text-cr-success' : 'text-destructive',
                )}
              >
                <span className="font-mono">{r.selector}</span>
                <span>
                  {r.kind} ({r.count}){r.error ? ` — ${r.error}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
