// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDrawer
 *
 * Left-side workspace drawer — collapsible resources panel.
 *
 * Sections:
 *   · Projects  — new / import / active project list
 *   · Resources — theme library + wallpapers + bundles (P1)
 *   · Agents    — per-agent install status
 *
 * When `collapsed`, only the icon rail is shown (48px wide).
 */

import { useState } from 'react';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META, AGENT_SECURITY_PROFILES, type AgentId } from '@shared/types';
import { Image, Layers, LayoutGrid, Lock, Package, Shield, ShieldCheck } from 'lucide-react';

// ---------------------------------------------------------------------------
// Static agent profile data — avoids adding IPC channels. Token counts and
// brand colors sourced from agents-profiles/_profiles-summary.json and
// per-agent <id>-profile.json (tokens.core.dark.accent).
// ---------------------------------------------------------------------------

interface AgentProfileTokens {
  light: number;
  dark: number;
  categories: number;
}

const AGENT_TOKEN_COUNTS: Record<string, AgentProfileTokens> = {
  // Token counts sourced from agents-profiles/_profiles-summary.json (styleVars.dark).
  // Categories count from the same file's categories array length.
  codex: { light: 1246, dark: 1255, categories: 16 },
  doubao: { light: 1199, dark: 2297, categories: 15 },
  traework: { light: 4614, dark: 4613, categories: 16 },
  workbuddy: { light: 3560, dark: 3617, categories: 16 },
  qoderwork: { light: 132, dark: 141, categories: 15 },
  zcode: { light: 390, dark: 410, categories: 15 },
};

// Brand colors sourced from per-agent <id>-profile.json (tokens.core.dark.accent).
// workbuddy uses CSS variable var(--wb-palette-brand-8); fallback to Microsoft blue.
const AGENT_BRAND_COLORS: Record<string, { dark: string; light: string }> = {
  codex: { dark: '#40c977', light: '#40c977' },
  doubao: { dark: '#35a04f', light: '#27ce6e' },
  traework: { dark: '#0c0c0d', light: '#0c0c0d' },
  workbuddy: { dark: '#0078d4', light: '#0078d4' },
  qoderwork: { dark: '#8ee5a1', light: '#8ee5a1' },
  zcode: { dark: '#001d3d', light: '#001d3d' },
};

type StrategyKey =
  | 'studioProfileHighTokens'
  | 'studioProfileMediumTokens'
  | 'studioProfileLowTokens';

function getStrategyKey(tokens: number): StrategyKey {
  if (tokens >= 1000) return 'studioProfileHighTokens';
  if (tokens >= 100) return 'studioProfileMediumTokens';
  return 'studioProfileLowTokens';
}

export function StudioDrawer({ t }: { t: UiMessages }) {
  const { drawer, setDrawerCollapsed } = useWorkspaceStore();

  const {
    projects,
    activeProjectId,
    installedThemes,
    creatingProject,
    createProject,
    selectProject,
    setCreatingProject,
    newName,
    setNewName,
    newAuthor,
    setNewAuthor,
    newAgent,
    setNewAgent,
  } = useStudioStore();

  const [resourcesOpen, setResourcesOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(false);

  // Wallpaper list — sourced from wallpaperStore (loaded once at app init).
  const wallpapers = useWallpaperStore((s) => s.wallpapers);

  if (!drawer.open) {
    return (
      <aside className="ws-drawer" data-collapsed="true">
        <div className="ws-drawer-rail">
          <button
            type="button"
            className="ws-drawer-rail__btn"
            onClick={() => setDrawerCollapsed(false)}
            title={t.expandSidebar}
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ws-drawer">
      <div className="ws-drawer__scroll">
        {/* Projects section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setProjectsOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              {t.studioProjectTitle}
            </span>
            <span>{projectsOpen ? '▾' : '▸'}</span>
          </button>

          {projectsOpen && (
            <div className="flex flex-col gap-[var(--space-1)] mt-[var(--space-1)]">
              <button
                type="button"
                className="ws-btn ws-btn--sm w-full"
                onClick={() => setCreatingProject(true)}
              >
                <span className="text-[var(--fg-1)]">+</span> {t.studioProjectNew}
              </button>

              {creatingProject && (
                <div className="flex flex-col gap-[var(--space-1)] p-[var(--space-2)] rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-1)]">
                  <input
                    type="text"
                    placeholder={t.studioProjectPlaceholder}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="ws-input h-[var(--h-btn-sm)] text-[length:11px]"
                  />
                  <input
                    type="text"
                    placeholder={t.studioProjectAuthorPlaceholder}
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    className="ws-input h-[var(--h-btn-sm)] text-[length:11px]"
                  />
                  <div className="flex flex-wrap gap-[var(--space-1)]">
                    {AGENT_IDS.map((id) => {
                      const meta = AGENT_META[id as AgentId];
                      const installed = Boolean(appStatusFor(id)?.installed);
                      if (!installed) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-selected={newAgent === id}
                          onClick={() => setNewAgent(id)}
                          className="ws-agent-chip"
                        >
                          <AppMark appId={id} size={10} />
                          {meta.displayName}
                        </button>
                      );
                    })}
                  </div>

                  {/* Agent profile summary — visible when an agent is selected */}
                  {(() => {
                    const tokens = AGENT_TOKEN_COUNTS[newAgent];
                    const brand = AGENT_BRAND_COLORS[newAgent];
                    if (!tokens || !brand) return null;
                    const strategyKey = getStrategyKey(tokens.dark);
                    return (
                      <div className="flex flex-col gap-[var(--space-1)] p-[var(--space-2)] rounded-[var(--dl-radius,2px)] border border-[var(--bg-3)]">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[length:10px] text-[var(--fg-2)] uppercase tracking-wider">
                            {t.studioProfileSummary}
                          </span>
                          <span className="font-mono text-[length:10px] text-[var(--fg-3)] tabular-nums">
                            {AGENT_META[newAgent]?.displayName ?? newAgent}
                          </span>
                        </div>
                        <div className="flex items-center gap-[var(--space-2)]">
                          {/* Brand color swatches */}
                          <div className="flex items-center gap-[var(--space-1)]">
                            <span
                              className="size-4 rounded-[var(--r-micro)] border border-[var(--border-subtle)]"
                              style={{ background: brand.dark }}
                              title={`${t.studioProfileAccent} (dark)`}
                            />
                            <span
                              className="size-4 rounded-[var(--r-micro)] border border-[var(--border-subtle)]"
                              style={{ background: brand.light }}
                              title={`${t.studioProfileAccent} (light)`}
                            />
                          </div>
                          <span className="font-mono text-[length:10px] text-[var(--fg-3)]">
                            {t.studioProfileTokens}:
                          </span>
                          <span className="font-mono text-[length:10px] text-[var(--fg-0)] tabular-nums">
                            {tokens.dark}
                          </span>
                          <span className="font-mono text-[length:10px] text-[var(--fg-3)]">
                            {t.studioProfileCategories}:
                          </span>
                          <span className="font-mono text-[length:10px] text-[var(--fg-0)] tabular-nums">
                            {tokens.categories}
                          </span>
                        </div>
                        <div className="flex items-center gap-[var(--space-1)]">
                          <span className="font-mono text-[length:10px] text-[var(--fg-3)]">
                            {t.studioProfileStrategy}:
                          </span>
                          <span className="font-mono text-[length:10px] text-[var(--fg-1)]">
                            {t[strategyKey]}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex gap-[var(--space-1)]">
                    <button
                      type="button"
                      className="ws-btn ws-btn--sm flex-1 ws-btn--primary"
                      onClick={() => void createProject()}
                    >
                      {t.studioProjectCreate}
                    </button>
                    <button
                      type="button"
                      className="ws-btn ws-btn--sm flex-1"
                      onClick={() => setCreatingProject(false)}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              )}

              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className="flex items-center gap-[var(--space-1)] w-full p-[var(--space-1)] rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                  style={{
                    borderColor: activeProjectId === p.id ? 'var(--accent)' : 'transparent',
                    background: activeProjectId === p.id ? 'var(--accent-ghost)' : 'transparent',
                    border: '1px solid',
                  }}
                >
                  <AppMark appId={p.agentId} size={12} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1 text-left">
                    {p.name}
                  </span>
                  {p.hasSnapshot && <span className="ws-badge ws-badge--success">snap</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Resources section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setResourcesOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              {t.studioResourcesTitle}
            </span>
            <span>{resourcesOpen ? '▾' : '▸'}</span>
          </button>

          {resourcesOpen && (
            <div className="flex flex-col gap-[var(--space-2)] mt-[var(--space-1)]">
              {/* Theme library */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Layers className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">
                    {t.themeLibrary}
                  </span>
                </div>
                {installedThemes.length === 0 ? (
                  <p className="font-mono text-[length:10px] text-[var(--fg-3)] pl-[var(--space-4)]">
                    {t.studioLibraryEmpty}
                  </p>
                ) : (
                  <div className="flex flex-col gap-0">
                    {installedThemes.map((theme) => (
                      <div
                        key={theme.id}
                        className="flex items-center gap-[var(--space-1)] p-0 rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                      >
                        <span
                          className="size-[10px] rounded-[var(--r-micro)] border border-[var(--border-subtle)]"
                          style={{ background: theme.colors?.accent || 'var(--bg-4)' }}
                        />
                        <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                          {theme.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Wallpapers (P1 — IPC-backed list) */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Image className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">
                    {t.studioWallpaperAllTitle}
                  </span>
                </div>
                {wallpapers.length === 0 ? (
                  <p className="font-mono text-[length:10px] text-[var(--fg-3)] pl-[var(--space-4)]">
                    {t.studioWallpaperEmpty}
                  </p>
                ) : (
                  <div className="flex flex-col gap-0">
                    {wallpapers.map((wp) => (
                      <div
                        key={wp.id}
                        className="flex items-center gap-[var(--space-1)] p-0 rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                      >
                        <Image className="size-2.5" style={{ color: 'var(--fg-3)' }} />
                        <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                          {wp.title ?? wp.id}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bundles */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Package className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">
                    {t.studioTabBundle}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-[var(--h-btn-sm)] text-[length:10px]"
                >
                  {t.studioBundleImport}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Agents section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setAgentsOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              {t.agentsTitle}
            </span>
            <span>{agentsOpen ? '▾' : '▸'}</span>
          </button>

          {agentsOpen && (
            <div className="flex flex-col gap-[var(--space-1)] mt-[var(--space-1)]">
              {/* Security posture sub-header */}
              <span className="font-mono text-[length:10px] text-[var(--fg-3)] px-[var(--space-1)]">
                {t.studioSecurityLabel}
              </span>

              {AGENT_IDS.map((id) => {
                const meta = AGENT_META[id as AgentId];
                const status = appStatusFor(id);
                const sec = AGENT_SECURITY_PROFILES[id as AgentId];

                // Build tooltip: "Context Isolation: ON / Sandbox: ON / WebSecurity: strict"
                const tooltipParts: string[] = [];
                if (sec) {
                  tooltipParts.push(
                    `${t.studioSecurityContextIsolation}: ${sec.contextIsolation ? t.studioSecurityEnabled : t.studioSecurityDisabled}`,
                  );
                  tooltipParts.push(
                    `${t.studioSecuritySandbox}: ${sec.sandbox ? t.studioSecurityEnabled : t.studioSecurityDisabled}`,
                  );
                  tooltipParts.push(
                    `${t.studioSecurityWebSecurity}: ${
                      sec.webSecurity === 'strict'
                        ? t.studioSecurityStrict
                        : sec.webSecurity === 'standard'
                          ? t.studioSecurityStandard
                          : t.studioSecurityDisabled
                    }`,
                  );
                }

                return (
                  <div
                    key={id}
                    className="flex items-center gap-[var(--space-1)] p-[var(--space-1)] rounded-[var(--r-micro)]"
                  >
                    <AppMark appId={id} size={14} />
                    <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                      {meta.displayName}
                    </span>

                    {/* Security posture icons */}
                    {sec && (
                      <span
                        className="flex items-center gap-[2px]"
                        title={tooltipParts.join(' / ')}
                      >
                        <Lock
                          className="size-[10px]"
                          style={{
                            color: sec.contextIsolation ? 'var(--cr-ok)' : 'var(--fg-3)',
                          }}
                        />
                        <Shield
                          className="size-[10px]"
                          style={{
                            color: sec.sandbox ? 'var(--cr-ok)' : 'var(--fg-3)',
                          }}
                        />
                        {sec.webSecurity === 'strict' ? (
                          <ShieldCheck className="size-[10px]" style={{ color: 'var(--cr-ok)' }} />
                        ) : (
                          <ShieldCheck className="size-[10px]" style={{ color: 'var(--fg-3)' }} />
                        )}
                      </span>
                    )}

                    <span
                      className="size-[5px] rounded-[var(--dl-radius,2px)]"
                      style={{
                        background: status?.installed ? 'var(--cr-ok)' : 'var(--fg-3)',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Collapse handle */}
      <button
        type="button"
        className="flex items-center justify-center h-6 w-full border-t border-[var(--border-subtle)] cursor-pointer shrink-0 bg-transparent"
        onClick={() => setDrawerCollapsed(true)}
        title={t.collapseSidebar}
      >
        <span className="font-mono text-[length:10px] text-[var(--fg-2)]">◀</span>
      </button>
    </aside>
  );
}
