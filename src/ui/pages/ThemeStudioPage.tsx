// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Studio Page — Swiss Edition
 *
 * Three-panel Swiss/International Typographic Style layout:
 *   Left (240px) — project rail + capture controls
 *   Center (flex-1) — iframe preview with tab bar + fingerprint
 *   Right (260px) — inspector + toolbox 8-dim + export
 *
 * Since the P1-4 state convergence the page is a thin shell: all shared
 * state + business logic lives in {@link useStudioStore} (zustand), and the
 * four panel components (StudioHeader / StudioLeftRail / StudioCenterPanel /
 * StudioRightInspector) read the store directly. This file only owns the
 * layout grid, the snapshot error bar, and the top-level effects that are
 * inherently reactive (project switching, live-inspect result routing).
 */

import { useEffect } from 'react';
import { api } from '@/api/agentSkinClient';
import { StudioCenterPanel } from '@/components/studio/StudioCenterPanel';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { StudioLeftRail } from '@/components/studio/StudioLeftRail';
import { StudioRightInspector } from '@/components/studio/StudioRightInspector';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';

export function ThemeStudioPage({ t }: { t: UiMessages }) {
  const previewView = useStudioStore((s) => s.previewView);
  const snapshotError = useStudioStore((s) => s.snapshotError);
  const refreshProjects = useStudioStore((s) => s.refreshProjects);
  const ensureBaseline = useStudioStore((s) => s.ensureBaseline);
  const setInspectResult = useStudioStore((s) => s.setInspectResult);
  const activeProject = useStudioStore((s) => s.getActiveProject());

  // Initial project list load.
  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // Auto-capture the agent's native baseline once per agent (best-effort).
  const activeAgent = activeProject?.agentId ?? null;
  useEffect(() => {
    if (!activeAgent) return;
    void ensureBaseline();
  }, [activeAgent, ensureBaseline]);

  // Route live-inspect picks/errors into the shared store (single subscription —
  // both the inspector panel and the live-inspect tab read from it).
  useEffect(() => {
    const off = api.onInspectResult((node) => setInspectResult(node));
    return off;
  }, [setInspectResult]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* SWISS HEADER — 44px height, brand + actions */}
      <StudioHeader t={t} />

      {/* THREE-PANEL SWISS LAYOUT */}
      <div
        className="min-h-0 flex-1 grid"
        style={{
          gridTemplateColumns:
            previewView === 'theme' || previewView === 'generator' || previewView === 'raw'
              ? '240px 1fr 260px'
              : '240px 1fr',
          background: 'var(--bg, var(--background))',
        }}
      >
        {/* LEFT PANEL (240px) — project rail + capture controls */}
        <StudioLeftRail t={t} />

        {/* CENTER PANEL (flex-1) — tabs + canvas + fingerprint */}
        <StudioCenterPanel t={t} />

        {/* RIGHT PANEL (260px) — inspector + image-to-theme + toolbox + export */}
        {(previewView === 'theme' || previewView === 'generator' || previewView === 'raw') && (
          <StudioRightInspector t={t} />
        )}
      </div>

      {/* Error bar */}
      {snapshotError && (
        <div
          className="border-t border-border px-4 py-2 font-mono text-[10px] uppercase"
          style={{
            background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
            color: 'var(--primary)',
            letterSpacing: '0.08em',
          }}
        >
          {snapshotError}
        </div>
      )}
    </section>
  );
}
