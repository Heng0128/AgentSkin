// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Studio Page — Swiss Edition
 *
 * Three-panel Swiss/International Typographic Style layout:
 *   Left (240px) — project rail + capture controls
 *   Center (flex-1) — iframe preview with tab bar + fingerprint
 *   Right (260px) — inspector + toolbox 8-dim + export
 *
 * All core features preserved: snapshot, inspect, baseline, export, toolbox.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { RealDomPreview } from '@/components/studio/RealDomPreview';
import {
  computeSignature,
  fingerprintFromSnapshot,
  type StudioColorSets,
  ToolboxPanel,
  type ToolOverride,
} from '@/components/studio/Toolbox';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import type { AppController } from '@/hooks/useAppController';
import { useNotifications } from '@/hooks/useNotifications';

import {
  Add01Icon,
  BeakerIcon,
  Delete01Icon,
  Download01Icon,
  Edit01Icon,
  EyeIcon,
  Folder01Icon,
  FolderAddIcon,
  Package01Icon,
  RefreshIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type CssMatchedRule,
  type InspectedNode,
  type StudioProject,
  type ThemeCatalogItem,
  type ThemeVisualSnapshot,
} from '@shared/types';

type SnapshotState = {
  snapshot: ThemeVisualSnapshot | null;
  loading: boolean;
  error: string | null;
  themeName: string;
};

// ---------------------------------------------------------------------------
// P4 helpers — derive a coherent `--agentskin-*` palette from a snapshot
// ---------------------------------------------------------------------------

function hexToRgb8(hex: string): [number, number, number] | null {
  let h = (hex || '').replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexMix(a: string, b: string, t: number): string {
  const A = hexToRgb8(a) || [0, 0, 0];
  const B = hexToRgb8(b) || [255, 255, 255];
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[m(A[0], B[0]), m(A[1], B[1]), m(A[2], B[2])].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb8(hex) || [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function lumOf(hex: string): number {
  const rgb = hexToRgb8(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pull bg / fg / accent out of a snapshot's computed styles. */
function paletteFromSnapshot(snapshot: ThemeVisualSnapshot): {
  bg: string;
  fg: string;
  accent: string;
} {
  const find = (sel: string) => snapshot.landmarks.find((l) => l.selector === sel || l.tag === sel);
  const root = find(':root') || find('html') || snapshot.landmarks[0];
  const map = new Map((root?.styles ?? []).map((s) => [s.property, s.value]));
  const clean = (v: string | undefined) =>
    v && !/transparent|rgba\(0, 0, 0, 0\)/.test(v) ? v : undefined;
  const scan = (prop: string): string | undefined => {
    for (const l of snapshot.landmarks) {
      const f = l.styles.find((s) => s.property === prop && clean(s.value));
      if (f) return f.value;
    }
    return undefined;
  };
  const bg = clean(map.get('background-color')) || scan('background-color') || '#201a40';
  const fg = clean(map.get('color')) || scan('color') || '#e8e2ff';
  const accent = scan('border-color') || scan('outline') || bg;
  return { bg, fg, accent };
}

/** Build the full `--agentskin-*` token set sent to the export builder. */
export function buildStudioPalette(snapshot: ThemeVisualSnapshot): Record<string, string> {
  const { bg, fg, accent } = paletteFromSnapshot(snapshot);
  const dark = lumOf(bg) < 0.5;
  const surface = dark ? hexMix(bg, '#ffffff', 0.12) : hexMix(bg, '#000000', 0.06);
  const surfaceElev = dark ? hexMix(bg, '#ffffff', 0.2) : hexMix(bg, '#000000', 0.1);
  const muted = dark ? hexMix(fg, '#000000', 0.4) : hexMix(fg, '#ffffff', 0.45);
  const codeBg = dark ? hexMix(bg, '#000000', 0.3) : hexMix(bg, '#ffffff', 0.55);
  const inputBg = dark ? hexMix(surface, '#ffffff', 0.06) : hexMix(surface, '#000000', 0.04);
  return {
    '--agentskin-accent': accent,
    '--agentskin-secondary': accent,
    '--agentskin-bg': bg,
    '--agentskin-surface': surface,
    '--agentskin-surface-elevated': surfaceElev,
    '--agentskin-text': fg,
    '--agentskin-muted': muted,
    '--agentskin-border': toRgba(accent, dark ? 0.18 : 0.3),
    '--agentskin-code-bg': codeBg,
    '--agentskin-code-fg': fg,
    '--agentskin-input-bg': inputBg,
    '--agentskin-button-bg': accent,
    '--agentskin-focus-ring': toRgba(accent, dark ? 0.38 : 0.5),
    '--agentskin-selection': toRgba(accent, 0.32),
  };
}

// ---------------------------------------------------------------------------
// Micro-helpers
// ---------------------------------------------------------------------------

/** Swiss section label (kopf / section kicker) */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase"
      style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}
    >
      <span className="size-[3px] rounded-full" style={{ background: 'var(--primary)' }} />
      <span>{children}</span>
    </div>
  );
}

export function ThemeStudioPage({ controller }: { controller: AppController }) {
  const { t } = controller;
  const { showToast } = useNotifications(t);

  // --- Projects: self-contained theme "工程" (no installed-theme dependency) ---
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newAgent, setNewAgent] = useState<AgentId>('traework');
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAuthor, setEditAuthor] = useState('');

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const activeAgent = activeProject?.agentId ?? null;

  // Installed-theme library linkage: list catalog themes and load a theme's
  // semantic colors into the active project palette (副本模式 — the project
  // stays self-contained; the loaded palette is just a starting point).
  const [installedThemes, setInstalledThemes] = useState<ThemeCatalogItem[]>([]);
  const [themeLibraryOpen, setThemeLibraryOpen] = useState(false);

  const refreshThemeLibrary = useCallback(async () => {
    try {
      setInstalledThemes((await api.catalog.themes.list()).items);
    } catch {
      /* ignore — library linkage is best-effort */
    }
  }, []);

  useEffect(() => {
    if (themeLibraryOpen) void refreshThemeLibrary();
  }, [themeLibraryOpen, refreshThemeLibrary]);

  const loadThemeIntoProject = useCallback(
    async (themeId: string) => {
      const project = projects.find((p) => p.id === activeProjectId) ?? null;
      if (!project) return;
      try {
        const item = await api.catalog.themes.get(themeId);
        if (!item?.colors) {
          showToast('该主题不包含可加载的调色板', 'destructive');
          return;
        }
        const palette = semanticColorsToPalette(item.colors);
        if (Object.keys(palette).length === 0) {
          showToast('该主题不包含可加载的调色板', 'destructive');
          return;
        }
        // Merge the loaded palette into the active project and persist it —
        // mirrors saveActiveProject without depending on its declaration order.
        const next = { ...project, palette, updatedAt: new Date().toISOString() };
        setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
        void api.saveStudioProject(next).catch(() => {});
        showToast(`已从「${item.name}」加载调色板`);
      } catch {
        showToast('加载主题调色板失败', 'destructive');
      }
    },
    [projects, activeProjectId, showToast],
  );

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.listStudioProjects();
      setProjects(list);
      setActiveProjectId((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // Keep export name/author in sync with the active project.
  useEffect(() => {
    if (activeProject) {
      setExportName(activeProject.name);
      setExportAuthor(activeProject.author);
    }
  }, [activeProject]);

  // Restore a previously persisted real-DOM snapshot when the active project
  // changes, so the crafted preview survives a window close / reload.
  useEffect(() => {
    if (!activeProjectId) {
      setSnapshotState({ snapshot: null, loading: false, error: null, themeName: '' });
      setBaseline(null);
      setBaselineLoading(false);
      setBaselineError(null);
      return;
    }
    let cancelled = false;
    setSnapshotState((prev) => ({ ...prev, snapshot: null, loading: true, error: null }));
    setBaseline(null);
    setBaselineLoading(true);
    setBaselineError(null);

    Promise.all([
      api.loadStudioSnapshot(activeProjectId, 'current'),
      api.loadStudioSnapshot(activeProjectId, 'baseline'),
    ])
      .then(([snap, base]) => {
        if (cancelled) return;
        setSnapshotState({
          snapshot: snap,
          loading: false,
          error: null,
          themeName: snap?.themeName ?? '',
        });
        setBaseline(base);
        setBaselineLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshotState({ snapshot: null, loading: false, error: null, themeName: '' });
        setBaseline(null);
        setBaselineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const saveActiveProject = useCallback(
    (patch: Partial<StudioProject>) => {
      if (!activeProject) return;
      const next = { ...activeProject, ...patch, updatedAt: new Date().toISOString() };
      setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      void api.saveStudioProject(next).catch(() => {});
    },
    [activeProject],
  );

  const [snapshotState, setSnapshotState] = useState<SnapshotState>({
    snapshot: null,
    loading: false,
    error: null,
    themeName: '',
  });
  const [baseline, setBaseline] = useState<ThemeVisualSnapshot | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [_baselineError, setBaselineError] = useState<string | null>(null);
  const [previewView, setPreviewView] = useState<'design' | 'current' | 'baseline'>('design');
  const [inspectingIdx, setInspectingIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [toolOverrides, setToolOverrides] = useState<ToolOverride | null>(null);
  const studioColorSets = useMemo<StudioColorSets | undefined>(() => {
    const snap = snapshotState.snapshot;
    if (!snap) return undefined;
    const sig = computeSignature(snap);
    const primaryBg = sig.color.rootBackground || sig.color.backgrounds[0] || null;
    return {
      primaryBg,
      surfaceBgs: sig.color.backgrounds.filter((b) => b !== primaryBg),
      texts: sig.color.texts,
      accents: sig.color.accents,
    };
  }, [snapshotState.snapshot]);
  const [inspectMode, setInspectMode] = useState(false);
  const inspectBusyRef = useRef(false);
  const [liveNode, setLiveNode] = useState<InspectedNode | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [exportName, setExportName] = useState('');
  const [exportAuthor, setExportAuthor] = useState('');
  const [exportState, setExportState] = useState<{
    loading: boolean;
    dir: string | null;
    error: string | null;
  }>({ loading: false, dir: null, error: null });
  const [pinnedSelectors, setPinnedSelectors] = useState<string[]>([]);
  const [pseudoStates, setPseudoStates] = useState<string[]>([]);
  const [captureSchemes, setCaptureSchemes] = useState(false);
  const [customSelectorInput, setCustomSelectorInput] = useState('');
  const [pseudoView, setPseudoView] = useState<string | null>(null);
  const [schemeView, setSchemeView] = useState<'light' | 'dark' | null>(null);

  // Subscribe to picked-node results while in live inspect mode.
  useEffect(() => {
    const off = api.onInspectResult((node) => {
      if ('error' in node) {
        setLiveError(node.error);
        return;
      }
      setLiveNode(node);
      setLiveError(null);
    });
    return off;
  }, []);

  const toggleInspect = useCallback(async () => {
    if (inspectBusyRef.current) return;
    inspectBusyRef.current = true;
    try {
      if (inspectMode) {
        try {
          await api.stopInspect();
        } catch {
          /* ignore */
        }
        setInspectMode(false);
        return;
      }
      try {
        await api.startInspect(activeAgent as AgentId);
        setInspectMode(true);
        setLiveNode(null);
        setLiveError(null);
      } catch {
        showToast('进入检查模式失败', 'destructive');
      }
    } finally {
      inspectBusyRef.current = false;
    }
  }, [inspectMode, activeAgent, showToast]);

  const setOverride = useCallback(
    (key: keyof ToolOverride, value: string | number | boolean | undefined) => {
      setToolOverrides((prev): ToolOverride | null => {
        const next: Partial<ToolOverride> = { ...(prev ?? {}) };
        if (value === undefined || value === '') {
          delete next[key];
        } else {
          (next as Record<keyof ToolOverride, string | number | boolean | undefined>)[key] = value;
        }
        return Object.keys(next).length ? (next as ToolOverride) : null;
      });
    },
    [],
  );
  const resetOverrides = useCallback(() => setToolOverrides(null), []);

  // --- Project CRUD handlers ---
  const handleCreateProject = useCallback(async () => {
    const name = newName.trim() || '未命名工程';
    try {
      const p = await api.createStudioProject({
        name,
        author: newAuthor.trim(),
        agentId: newAgent,
      });
      setProjects((prev) => [p, ...prev]);
      setActiveProjectId(p.id);
      setNewName('');
      setNewAuthor('');
      setCreatingProject(false);
    } catch {
      showToast('创建工程失败', 'destructive');
    }
  }, [newName, newAuthor, newAgent, showToast]);

  const handleImportProject = useCallback(async () => {
    setImporting(true);
    try {
      const p = await api.importStudioProject();
      if (p) {
        setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
        setActiveProjectId(p.id);
        showToast(`已导入工程「${p.name}」`);
      }
    } catch (err) {
      showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'destructive');
    } finally {
      setImporting(false);
    }
  }, [showToast]);

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        await api.deleteStudioProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setActiveProjectId((cur) => (cur === id ? null : cur));
      } catch {
        showToast('删除工程失败', 'destructive');
      }
    },
    [showToast],
  );

  const handleRenameProject = useCallback(
    async (p: StudioProject, name: string, author: string) => {
      const next: StudioProject = {
        ...p,
        name: name.trim() || p.name,
        author: author.trim(),
        updatedAt: new Date().toISOString(),
      };
      setProjects((prev) => prev.map((x) => (x.id === p.id ? next : x)));
      try {
        await api.saveStudioProject(next);
        showToast('已保存工程信息');
      } catch {
        showToast('保存失败', 'destructive');
      } finally {
        setEditingId(null);
      }
    },
    [showToast],
  );

  const handleChangeAgent = useCallback(
    (agentId: AgentId) => {
      saveActiveProject({ agentId });
      setSnapshotState((prev) => ({ ...prev, snapshot: null }));
      if (inspectMode || inspectBusyRef.current) {
        inspectBusyRef.current = true;
        api
          .stopInspect()
          .catch(() => {})
          .finally(() => {
            inspectBusyRef.current = false;
          });
        setInspectMode(false);
        setLiveNode(null);
      }
    },
    [saveActiveProject, inspectMode],
  );

  const addPinnedSelector = useCallback(() => {
    const v = customSelectorInput.trim();
    if (!v) return;
    setPinnedSelectors((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setCustomSelectorInput('');
  }, [customSelectorInput]);

  const removePinnedSelector = useCallback((sel: string) => {
    setPinnedSelectors((prev) => prev.filter((s) => s !== sel));
  }, []);

  const togglePseudo = useCallback((state: string) => {
    setPseudoStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state],
    );
  }, []);

  const handleSnapshot = useCallback(async () => {
    if (!activeAgent || !activeProject) return;
    const liveName = activeProject.name;
    setSnapshotState({ snapshot: null, loading: true, error: null, themeName: liveName });
    try {
      const snap = await api.snapshotThemeDom(activeAgent, undefined, {
        extraSelectors: pinnedSelectors,
        pseudoStates,
        captureSchemes,
      });
      setSnapshotState({ snapshot: snap, loading: false, error: null, themeName: liveName });
      setInspectingIdx(0);
      setPseudoView(null);
      setSchemeView(null);
      await api.saveStudioSnapshot(activeProject.id, snap);
      saveActiveProject({ hasSnapshot: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSnapshotState({
        snapshot: null,
        loading: false,
        error: `Snapshot failed: ${msg}`,
        themeName: liveName,
      });
      showToast('主题快照失败', 'destructive');
    }
  }, [
    activeAgent,
    activeProject,
    showToast,
    pinnedSelectors,
    pseudoStates,
    captureSchemes,
    saveActiveProject,
  ]);

  const handleBaselineSnapshot = useCallback(async () => {
    if (!activeAgent || !activeProject) return;
    const _liveName = activeProject.name;
    setBaselineLoading(true);
    setBaselineError(null);
    setPreviewView('baseline');
    try {
      const snap = await api.snapshotBaseline(activeAgent, {
        extraSelectors: pinnedSelectors,
        pseudoStates,
        captureSchemes,
      });
      setBaseline(snap);
      setBaselineLoading(false);
      saveActiveProject({ hasBaseline: true });
      await api.saveStudioSnapshot(activeProject.id, snap, 'baseline');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBaselineError(`基线抓取失败：${msg}`);
      setBaselineLoading(false);
      showToast('基线快照失败', 'destructive');
    }
  }, [
    activeAgent,
    activeProject,
    showToast,
    pinnedSelectors,
    pseudoStates,
    captureSchemes,
    saveActiveProject,
  ]);

  const handleRestore = useCallback(async () => {
    if (!activeAgent) return;
    try {
      await api.restoreApp(activeAgent);
      showToast(`已恢复 ${AGENT_META[activeAgent].displayName} 原生界面`);
    } catch (_err) {
      showToast('恢复失败', 'destructive');
    }
  }, [activeAgent, showToast]);

  const handleExport = useCallback(async () => {
    if (!activeAgent || !activeProject) return;
    setExportState({ loading: true, dir: null, error: null });
    try {
      const root =
        snapshotState.snapshot != null ? buildStudioPalette(snapshotState.snapshot) : undefined;
      const payload = {
        meta: {
          name: exportName.trim() || activeProject.name,
          author: exportAuthor.trim() || activeProject.author || 'AgentSkin Studio',
        },
        agentId: activeAgent,
        root: root as Record<string, string> | undefined,
        signature: (toolOverrides ?? undefined) as unknown as Record<string, unknown> | undefined,
      };
      const res = await api.exportStudioTheme(payload);
      setExportState({ loading: false, dir: res.packageDir, error: null });
      saveActiveProject({
        hasSnapshot: true,
        exportedDir: res.packageDir,
        palette: root,
        signature: payload.signature,
        overrides: (toolOverrides ?? undefined) as Record<string, unknown> | undefined,
      });
      showToast('主题包已导出');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportState({ loading: false, dir: null, error: msg });
      showToast('导出失败', 'destructive');
    }
  }, [
    activeAgent,
    activeProject,
    snapshotState.snapshot,
    exportName,
    exportAuthor,
    toolOverrides,
    showToast,
    saveActiveProject,
  ]);

  const inspectingLandmark = snapshotState.snapshot?.landmarks[inspectingIdx ?? -1] ?? null;
  const activePseudo = pseudoView ? inspectingLandmark?.pseudo?.[pseudoView] : undefined;
  const activeScheme = schemeView ? inspectingLandmark?.scheme?.[schemeView] : undefined;

  // Landmarks filtered by search query
  const allLandmarks = snapshotState.snapshot?.landmarks ?? [];
  const landmarkSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allLandmarks;
    return allLandmarks.filter(
      (lm) => lm.selector.toLowerCase().includes(q) || lm.tag.toLowerCase().includes(q),
    );
  }, [allLandmarks, searchQuery]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* ================================================================
          SWISS HEADER — 44px height, brand + actions
          ================================================================ */}
      <div
        className="flex h-[44px] shrink-0 items-center border-b border-border px-4"
        style={{ background: 'var(--surface)' }}
      >
        {/* Left: brand cluster */}
        <div className="flex items-center gap-2.5">
          {/* Brand star icon */}
          <span
            className="font-display text-sm font-bold"
            style={{ color: 'var(--primary)', lineHeight: 1 }}
          >
            ✦
          </span>
          <span
            className="font-mono text-[11px] font-semibold uppercase"
            style={{ color: 'var(--foreground)', letterSpacing: '0.08em' }}
          >
            Theme Studio
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase"
            style={{
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              letterSpacing: '0.1em',
            }}
          >
            BETA
          </span>
          {activeProject && (
            <span
              className="ml-1 font-mono text-[10px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              / {activeProject.name}
            </span>
          )}
        </div>

        {/* Center: agent selector */}
        {activeProject && (
          <div className="ml-6 flex items-center gap-1.5">
            <span
              className="font-mono text-[9px] uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
            >
              AGENT
            </span>
            <select
              id="studio-agent-select"
              value={activeAgent ?? ''}
              onChange={(e) => handleChangeAgent(e.target.value as AgentId)}
              className="h-6 border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {AGENT_IDS.map((agentId) => (
                <option key={agentId} value={agentId}>
                  {AGENT_META[agentId].displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Right: action buttons */}
        <div className="ml-auto flex items-center gap-1">
          {/* Undo / Inspire / Reset */}
          <button
            type="button"
            className="flex h-7 items-center gap-1 border border-border px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-30"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            title="撤销 (undo)"
          >
            ↶ UNDO
          </button>
          <button
            type="button"
            className="flex h-7 items-center gap-1 border border-border px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            title="灵感 (inspire)"
          >
            ✦ INSPIRE
          </button>
          {snapshotState.snapshot && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRestore}
              className="h-7 gap-1 px-2 font-mono text-[9.5px] uppercase"
              style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            >
              <HugeIcon icon={RefreshIcon} className="size-3" />
              {t.studioRestoreDefault}
            </Button>
          )}
          <button
            type="button"
            className="flex h-7 items-center gap-1 border border-border bg-primary px-3 font-mono text-[9.5px] font-bold uppercase text-primary-foreground transition-opacity hover:opacity-90"
            style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
            onClick={handleExport}
            disabled={!snapshotState.snapshot || exportState.loading}
          >
            <HugeIcon icon={Download01Icon} className="size-3" />
            EXPORT
          </button>
        </div>
      </div>

      {/* ================================================================
          THREE-PANEL SWISS LAYOUT
          ================================================================ */}
      <div
        className="min-h-0 flex-1 grid"
        style={{
          gridTemplateColumns: '240px 1fr 260px',
          background: 'var(--bg, var(--background))',
        }}
      >
        {/* =============================================================
            LEFT PANEL (240px) — project rail + capture controls
            ============================================================= */}
        <div
          className="overflow-y-auto border-r border-border px-3 pt-3"
          style={{ background: 'var(--bg, var(--background))' }}
        >
          {/* Section: Projects */}
          <Kicker>工程 · PROJECT</Kicker>
          <div className="mt-2 flex gap-1 pb-2">
            <button
              type="button"
              onClick={() => setCreatingProject((v) => !v)}
              className="flex h-6 items-center gap-1 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent"
              style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            >
              <HugeIcon icon={Add01Icon} className="size-3" /> NEW
            </button>
            <button
              type="button"
              onClick={handleImportProject}
              disabled={importing}
              className="flex h-6 items-center gap-1 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-40"
              style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            >
              <HugeIcon icon={FolderAddIcon} className="size-3" /> IMPORT
            </button>
          </div>

          {/* New project form */}
          {creatingProject && (
            <div
              className="mt-1 space-y-1.5 border border-border bg-card p-2"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="PROJECT NAME"
                className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
                style={{ borderRadius: 'var(--radius)' }}
              />
              <input
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
                placeholder="AUTHOR (OPTIONAL)"
                className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
                style={{ borderRadius: 'var(--radius)' }}
              />
              {/* Agent chips */}
              <div className="flex flex-wrap gap-1 pt-1">
                {AGENT_IDS.map((agentId) => (
                  <button
                    key={agentId}
                    type="button"
                    onClick={() => setNewAgent(agentId)}
                    className="flex items-center gap-1 px-2 py-0.5 font-mono text-[9px]"
                    style={{
                      border:
                        newAgent === agentId
                          ? '1px solid var(--primary)'
                          : '1px solid var(--border)',
                      background: newAgent === agentId ? 'var(--accent)' : 'var(--muted)',
                      color: newAgent === agentId ? 'var(--primary)' : 'var(--muted-foreground)',
                      borderRadius: 'var(--radius)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    <AppMark appId={agentId} size={10} />
                    {AGENT_META[agentId].displayName.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={handleCreateProject}
                  className="h-6 flex-1 border border-border bg-primary px-2 font-mono text-[9.5px] font-bold uppercase text-primary-foreground"
                  style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
                >
                  CREATE
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingProject(false)}
                  className="h-6 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase"
                  style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* Project list */}
          <div className="mt-2 space-y-1">
            {projects.length === 0 && !creatingProject && (
              <p
                className="font-mono text-[9px] leading-relaxed"
                style={{ color: 'var(--dim, var(--muted-foreground))', opacity: 0.7 }}
              >
                还没有工程。点「NEW」从零设计，或「IMPORT」载入一个 .agentskin-theme。
              </p>
            )}
            {[...projects]
              .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
              .map((p) => (
                <div
                  key={p.id}
                  className="group border border-border p-2"
                  style={{
                    borderRadius: 'var(--radius)',
                    background: activeProjectId === p.id ? 'var(--accent)' : 'var(--card)',
                    borderColor: activeProjectId === p.id ? 'var(--primary)' : 'var(--border)',
                  }}
                >
                  {editingId === p.id ? (
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        aria-label="工程名称"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameProject(p, editName, editAuthor);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder="PROJECT NAME"
                        className="h-5 w-full border border-border bg-muted px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
                        style={{ borderRadius: 'var(--radius)' }}
                      />
                      <input
                        aria-label="作者"
                        value={editAuthor}
                        onChange={(e) => setEditAuthor(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameProject(p, editName, editAuthor);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder="AUTHOR"
                        className="h-5 w-full border border-border bg-muted px-1.5 font-mono text-[9px] outline-none focus:border-primary"
                        style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handleRenameProject(p, editName, editAuthor)}
                          className="bg-primary px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-primary-foreground"
                          style={{ borderRadius: 'var(--radius)' }}
                        >
                          SAVE
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-1.5 py-0.5 font-mono text-[8px] uppercase"
                          style={{
                            color: 'var(--muted-foreground)',
                            borderRadius: 'var(--radius)',
                          }}
                        >
                          CANC
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveProjectId(p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <AppMark appId={p.agentId} size={12} />
                        <span
                          className="truncate font-mono text-[10px] font-medium"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {p.name}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1">
                        {p.hasSnapshot ? (
                          <span
                            className="px-1 py-0.5 font-mono text-[7px] font-bold uppercase"
                            style={{
                              background: 'var(--cr-success, #2ED573)',
                              color: '#0A0A0C',
                              letterSpacing: '0.06em',
                            }}
                          >
                            SNAPPED
                          </span>
                        ) : (
                          <span
                            className="px-1 py-0.5 font-mono text-[7px] uppercase"
                            style={{
                              background: 'var(--muted)',
                              color: 'var(--muted-foreground)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            IDLE
                          </span>
                        )}
                        {p.exportedDir && (
                          <span
                            className="px-1 py-0.5 font-mono text-[7px] font-bold uppercase"
                            style={{
                              background: 'var(--primary)',
                              color: 'var(--primary-foreground)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            EXP
                          </span>
                        )}
                        {p.author && (
                          <span
                            className="truncate font-mono text-[8px]"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            by {p.author}
                          </span>
                        )}
                      </div>
                    </button>
                  )}
                  {editingId !== p.id && (
                    <div className="flex shrink-0 items-center gap-0.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditName(p.name);
                          setEditAuthor(p.author || '');
                        }}
                        className="p-0.5 text-[9px] transition-opacity opacity-0 group-hover:opacity-100"
                        style={{ color: 'var(--muted-foreground)' }}
                        aria-label="编辑工程"
                      >
                        <HugeIcon icon={Edit01Icon} className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(p.id)}
                        className="p-0.5 text-[9px] transition-opacity opacity-0 group-hover:opacity-100 hover:!text-[var(--primary)]"
                        style={{ color: 'var(--muted-foreground)' }}
                        aria-label="删除工程"
                      >
                        <HugeIcon icon={Delete01Icon} className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>

          {/* Section: Installed theme library linkage */}
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <Kicker>主题库 · LIBRARY</Kicker>
              <button
                type="button"
                onClick={() => {
                  setThemeLibraryOpen((v) => !v);
                }}
                className="flex h-5 items-center gap-1 border border-border bg-muted px-1.5 font-mono text-[8.5px] uppercase transition-colors hover:bg-accent"
                style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
              >
                <HugeIcon
                  icon={themeLibraryOpen ? RefreshIcon : Folder01Icon}
                  className="size-2.5"
                />
                {themeLibraryOpen ? 'CLOSE' : 'OPEN'}
              </button>
            </div>

            {themeLibraryOpen && (
              <div
                className="max-h-40 space-y-1 overflow-y-auto border border-border bg-card p-1.5"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {installedThemes.length === 0 ? (
                  <p
                    className="px-1 py-1 font-mono text-[8.5px]"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    暂无已安装主题
                  </p>
                ) : (
                  installedThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      disabled={!activeProject}
                      onClick={() => void loadThemeIntoProject(theme.id)}
                      className="flex w-full items-center gap-1.5 rounded-[2px] px-1.5 py-1 text-left transition-colors hover:bg-accent disabled:opacity-40"
                      title={
                        activeProject ? `加载「${theme.name}」调色板到当前工程` : '先新建/选择工程'
                      }
                    >
                      {theme.icon ? (
                        <img src={theme.icon} alt="" className="size-3.5 shrink-0 rounded-[2px]" />
                      ) : (
                        <span
                          className="size-3.5 shrink-0 rounded-[2px] border border-border"
                          style={{ background: theme.colors?.background ?? 'var(--muted)' }}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[9px]"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {theme.name}
                      </span>
                      <HugeIcon
                        icon={FolderAddIcon}
                        className="size-2.5 shrink-0"
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Section: Custom capture controls */}
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <Kicker>选择器 · SELECTORS</Kicker>

            {pinnedSelectors.length === 0 ? (
              <p
                className="font-mono text-[9px]"
                style={{ color: 'var(--dim, var(--muted-foreground))', opacity: 0.7 }}
              >
                点选元素后「加入快照」，或手动添加选择器。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {pinnedSelectors.map((sel) => (
                  <span
                    key={sel}
                    className="flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 font-mono text-[8.5px]"
                    style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
                  >
                    {sel.length > 22 ? `${sel.slice(0, 22)}…` : sel}
                    <button
                      type="button"
                      onClick={() => removePinnedSelector(sel)}
                      className="hover:text-primary"
                      style={{ color: 'var(--muted-foreground)' }}
                      aria-label="移除"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-1">
              <input
                value={customSelectorInput}
                onChange={(e) => setCustomSelectorInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPinnedSelector();
                }}
                placeholder=".class 或 #id"
                className="h-6 min-w-0 flex-1 border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
                style={{ borderRadius: 'var(--radius)' }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addPinnedSelector}
                className="h-6 px-2 font-mono text-[9.5px] uppercase"
                style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
              >
                ADD
              </Button>
            </div>

            {/* Pseudo-state tags */}
            <div className="flex flex-wrap items-center gap-1">
              <span
                className="font-mono text-[9px] uppercase"
                style={{ letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}
              >
                PSEUDO:
              </span>
              {(['hover', 'focus', 'active'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePseudo(p)}
                  className="border px-1.5 py-0.5 font-mono text-[8.5px]"
                  style={{
                    borderColor: pseudoStates.includes(p) ? 'var(--primary)' : 'var(--border)',
                    background: pseudoStates.includes(p) ? 'var(--accent)' : 'var(--muted)',
                    color: pseudoStates.includes(p) ? 'var(--primary)' : 'var(--muted-foreground)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  :{p}
                </button>
              ))}
            </div>

            {/* Capture schemes toggle */}
            <button
              type="button"
              onClick={() => setCaptureSchemes((v) => !v)}
              className="flex w-full items-center justify-between border border-border px-2 py-1.5 font-mono text-[9.5px] uppercase"
              style={{
                letterSpacing: '0.06em',
                borderRadius: 'var(--radius)',
                background: captureSchemes ? 'var(--accent)' : 'var(--card)',
                color: captureSchemes ? 'var(--primary)' : 'var(--muted-foreground)',
              }}
            >
              <span>LIGHT/DARK VARIANTS</span>
              <span
                className="px-1 py-0.5 font-mono text-[8px] font-bold uppercase"
                style={{
                  background: captureSchemes ? 'var(--primary)' : 'var(--border)',
                  color: captureSchemes ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                  borderRadius: 'var(--radius)',
                }}
              >
                {captureSchemes ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>

        {/* =============================================================
            CENTER PANEL (flex-1) — tabs + canvas + fingerprint
            ============================================================= */}
        <div
          className="flex min-h-0 flex-col"
          style={{ background: 'var(--bg, var(--background))' }}
        >
          {/* Tools tab bar */}
          <div
            className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3"
            style={{ background: 'var(--surface)' }}
          >
            {/* Tab segment control */}
            <div className="flex items-center gap-0.5">
              {(
                [
                  ['design', 'DESIGN'],
                  ['current', 'RENDER'],
                  ['baseline', 'RAW'],
                ] as const
              ).map(([view, label]) => {
                const disabled =
                  view === 'design' || view === 'current'
                    ? !snapshotState.snapshot
                    : !baseline && !baselineLoading;
                return (
                  <button
                    key={view}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPreviewView(view)}
                    className="h-6 px-2.5 font-mono text-[9.5px] font-medium uppercase transition-colors"
                    style={{
                      letterSpacing: '0.06em',
                      borderRadius: 'var(--radius)',
                      background: previewView === view ? 'var(--primary)' : 'transparent',
                      color:
                        previewView === view
                          ? 'var(--primary-foreground)'
                          : disabled
                            ? 'var(--muted-foreground)'
                            : 'var(--muted-foreground)',
                      opacity: disabled ? 0.35 : 1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Search + Inspect + Snapshot buttons */}
            <div className="ml-auto flex items-center gap-1">
              <InputGroup className="h-6 w-40">
                <InputGroupInput
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="筛选节点…"
                  aria-label="Filter landmarks"
                  className="h-6 font-mono text-[10px]"
                />
                <InputGroupAddon align="inline-start">
                  <HugeIcon
                    icon={Search01Icon}
                    className="size-2.5"
                    style={{ color: 'var(--muted-foreground)' }}
                  />
                </InputGroupAddon>
              </InputGroup>
              <Button
                size="sm"
                variant={inspectMode ? 'default' : 'outline'}
                disabled={!activeAgent}
                onClick={toggleInspect}
                className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
                style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
              >
                <HugeIcon icon={Search01Icon} className="size-2.5" />
                {inspectMode ? 'STOP' : 'INSPECT'}
              </Button>
              <Button
                size="sm"
                disabled={!activeAgent || snapshotState.loading}
                onClick={handleSnapshot}
                className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
                style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
              >
                {snapshotState.loading ? (
                  <Spinner data-icon="inline-start" className="size-2.5" />
                ) : (
                  <HugeIcon icon={EyeIcon} className="size-2.5" />
                )}
                {snapshotState.loading ? t.studioSnapshooting : t.studioSnapshotButton}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!activeAgent || baselineLoading}
                onClick={handleBaselineSnapshot}
                className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
                style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
                title="还原 agent 到无主题原生态后抓取，抓完自动重上原主题"
              >
                {baselineLoading ? (
                  <Spinner data-icon="inline-start" className="size-2.5" />
                ) : (
                  <HugeIcon icon={RefreshIcon} className="size-2.5" />
                )}
                BASELINE
              </Button>
            </div>
          </div>

          {/* Canvas area */}
          <div
            className="relative flex-1 overflow-auto p-4"
            style={{ background: 'var(--bg, var(--background))' }}
          >
            {/* Empty state overlay */}
            {!snapshotState.snapshot && !baseline && !snapshotState.loading && !baselineLoading && (
              <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
                <div
                  className="flex size-14 items-center justify-center border border-border"
                  style={{ background: 'var(--card)', borderRadius: 'var(--radius)' }}
                >
                  <HugeIcon icon={BeakerIcon} className="size-7 text-muted-foreground/40" />
                </div>
                {!activeProject ? (
                  <>
                    <p
                      className="font-mono text-[11px] font-medium"
                      style={{ color: 'var(--foreground)' }}
                    >
                      请先新建或导入一个工程
                    </p>
                    <p
                      className="max-w-xs font-mono text-[10px] leading-relaxed"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      工作室不再依赖已安装主题。左侧「NEW」从零设计，或「IMPORT」载入一个
                      .agentskin-theme。
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className="font-mono text-[11px] font-medium"
                      style={{ color: 'var(--foreground)' }}
                    >
                      点击「SNAP」复刻 {activeProject.name} 的真实界面
                    </p>
                    <p
                      className="max-w-xs font-mono text-[10px] leading-relaxed"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      可抓取「CURRENT」（带主题）或「RAW」（无主题）两种状态，切换上方标签对照查看。
                    </p>
                  </>
                )}
              </div>
            )}
            {snapshotState.snapshot && previewView !== 'baseline' && (
              <RealDomPreview
                domTree={snapshotState.snapshot.domTree}
                overrides={previewView === 'design' ? toolOverrides : null}
                colorSets={previewView === 'design' ? studioColorSets : undefined}
              />
            )}
            {previewView === 'baseline' &&
              (baseline ? (
                <RealDomPreview domTree={baseline.domTree} overrides={null} />
              ) : (
                !baselineLoading && (
                  <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center">
                    <p
                      className="font-mono text-[10px]"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      尚无原始无主题快照，点击上方「BASELINE」
                    </p>
                  </div>
                )
              ))}
          </div>

          {/* Fingerprint bar */}
          {snapshotState.snapshot && (
            <div
              className="flex h-6 shrink-0 items-center border-t border-border px-3 font-mono text-[9px]"
              style={{
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
                letterSpacing: '0.1em',
              }}
            >
              <span>FINGERPRINT</span>
              <span className="mx-2" style={{ color: 'var(--border)' }}>
                |
              </span>
              <span style={{ color: 'var(--foreground)' }}>
                {fingerprintFromSnapshot(snapshotState.snapshot)}
              </span>
            </div>
          )}
        </div>

        {/* =============================================================
            RIGHT PANEL (260px) — inspector + toolbox + export
            ============================================================= */}
        <div
          className="overflow-y-auto border-l border-border px-3 pt-3"
          style={{ background: 'var(--bg, var(--background))' }}
        >
          {/* Inspector section */}
          {inspectingLandmark && (
            <>
              <Kicker>检视器 · INSPECTOR</Kicker>
              <div className="mt-2 mb-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="truncate font-mono text-[10px] font-medium"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {inspectingLandmark.selector}
                  </span>
                  <span
                    className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[8px]"
                    style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                  >
                    {inspectingLandmark.tag}
                  </span>
                  {inspectingLandmark.boxModel && (
                    <span
                      className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[8px]"
                      style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                    >
                      {inspectingLandmark.boxModel.width}×{inspectingLandmark.boxModel.height}
                    </span>
                  )}
                </div>
                <div
                  className="border border-border bg-card p-1.5"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {inspectingLandmark.styles.map((style) => (
                    <div
                      key={style.property}
                      className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[9.5px]"
                    >
                      <span
                        className="w-[120px] shrink-0 truncate"
                        style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                      >
                        {style.property}
                      </span>
                      <span className="truncate" style={{ color: 'var(--foreground)' }}>
                        {style.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* P5: pseudo-state variants */}
                {inspectingLandmark.pseudo && (
                  <div className="mt-2 space-y-1">
                    <div
                      className="font-mono text-[9px] uppercase"
                      style={{
                        letterSpacing: '0.1em',
                        color: 'var(--muted-foreground)',
                        opacity: 0.7,
                      }}
                    >
                      伪状态 · PSEUDO
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.keys(inspectingLandmark.pseudo).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPseudoView(p === pseudoView ? null : p)}
                          className="px-1.5 py-0.5 font-mono text-[8.5px]"
                          style={{
                            background: pseudoView === p ? 'var(--primary)' : 'var(--muted)',
                            color:
                              pseudoView === p
                                ? 'var(--primary-foreground)'
                                : 'var(--muted-foreground)',
                            borderRadius: 'var(--radius)',
                          }}
                        >
                          :{p}
                        </button>
                      ))}
                    </div>
                    {pseudoView && activePseudo && (
                      <div
                        className="border border-border bg-card p-1.5"
                        style={{ borderRadius: 'var(--radius)' }}
                      >
                        <div
                          className="mb-1 font-mono text-[9px] font-medium"
                          style={{ color: 'var(--foreground)' }}
                        >
                          :{pseudoView} 计算样式
                        </div>
                        {activePseudo.computed.map((s) => (
                          <div
                            key={s.property}
                            className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[9px]"
                          >
                            <span
                              className="w-[120px] truncate"
                              style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                            >
                              {s.property}
                            </span>
                            <span className="truncate" style={{ color: 'var(--foreground)' }}>
                              {s.value}
                            </span>
                          </div>
                        ))}
                        <CascadeView cascade={activePseudo} />
                      </div>
                    )}
                  </div>
                )}

                {/* P5: light/dark scheme variants */}
                {inspectingLandmark.scheme && (
                  <div className="mt-2 space-y-1">
                    <div
                      className="font-mono text-[9px] uppercase"
                      style={{
                        letterSpacing: '0.1em',
                        color: 'var(--muted-foreground)',
                        opacity: 0.7,
                      }}
                    >
                      明暗变体 · SCHEME
                    </div>
                    <div className="flex gap-1">
                      {(['light', 'dark'] as const).map((sc) => (
                        <button
                          key={sc}
                          type="button"
                          onClick={() => setSchemeView(sc)}
                          className="px-1.5 py-0.5 font-mono text-[8.5px]"
                          style={{
                            background: schemeView === sc ? 'var(--primary)' : 'var(--muted)',
                            color:
                              schemeView === sc
                                ? 'var(--primary-foreground)'
                                : 'var(--muted-foreground)',
                            borderRadius: 'var(--radius)',
                          }}
                        >
                          {sc.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    {schemeView && activeScheme && (
                      <div
                        className="border border-border bg-card p-1.5"
                        style={{ borderRadius: 'var(--radius)' }}
                      >
                        <div
                          className="mb-1 font-mono text-[9px] font-medium"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {schemeView.toUpperCase()} 计算样式
                        </div>
                        {activeScheme.styles.map((s) => (
                          <div
                            key={s.property}
                            className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[9px]"
                          >
                            <span
                              className="w-[120px] truncate"
                              style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                            >
                              {s.property}
                            </span>
                            <span className="truncate" style={{ color: 'var(--foreground)' }}>
                              {s.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {inspectingLandmark.matchedRules?.length > 0 && (
                  <CascadeView
                    cascade={{
                      matchedRules: inspectingLandmark.matchedRules,
                      platformFonts: inspectingLandmark.platformFonts,
                      boxModel: inspectingLandmark.boxModel,
                    }}
                  />
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-border" />
            </>
          )}

          {/* Live inspect (Tier B) */}
          {inspectMode && (
            <>
              <div
                className="flex items-center justify-between border border-primary/40 bg-accent p-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <span
                  className="font-mono text-[10px] font-semibold uppercase"
                  style={{ color: 'var(--primary)', letterSpacing: '0.08em' }}
                >
                  ● LIVE INSPECT
                </span>
                <span className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
                  {AGENT_META[activeAgent as AgentId].displayName}
                </span>
              </div>
              {liveError && (
                <p className="mt-1 font-mono text-[9px]" style={{ color: 'var(--primary)' }}>
                  {liveError}
                </p>
              )}
              {liveNode && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span
                      className="truncate font-mono text-[10px] font-medium"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {liveNode.path}
                    </span>
                    <span
                      className="shrink-0 bg-muted px-1 py-0.5 font-mono text-[8px]"
                      style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                    >
                      {liveNode.tag}
                    </span>
                    {liveNode.cascade.boxModel && (
                      <span
                        className="shrink-0 bg-muted px-1 py-0.5 font-mono text-[8px]"
                        style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                      >
                        {liveNode.cascade.boxModel.width}×{liveNode.cascade.boxModel.height}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPinnedSelectors((prev) =>
                        prev.includes(liveNode.path) ? prev : [...prev, liveNode.path],
                      )
                    }
                    className="mb-2 flex items-center gap-1 border border-border bg-muted px-2 py-1 font-mono text-[9.5px] uppercase"
                    style={{
                      letterSpacing: '0.06em',
                      borderRadius: 'var(--radius)',
                      color: pinnedSelectors.includes(liveNode.path)
                        ? 'var(--primary)'
                        : 'var(--muted-foreground)',
                    }}
                  >
                    {pinnedSelectors.includes(liveNode.path) ? '✓ PINNED' : '+ PIN TO SNAPSHOT'}
                  </button>
                  <CascadeView cascade={liveNode.cascade} />
                </div>
              )}
              {!liveNode && !liveError && (
                <p
                  className="mt-2 font-mono text-[9px]"
                  style={{ color: 'var(--dim, var(--muted-foreground))' }}
                >
                  已为真实 Agent 开启放大镜，点击任意元素即可抓取它的完整级联。
                </p>
              )}
              <div className="mt-2 border-t border-border" />
            </>
          )}

          {/* Dimension fingerprint card */}
          {snapshotState.snapshot && (
            <>
              <Kicker>维度 · SIGNATURE</Kicker>
              <div
                className="mt-1.5 mb-3 border border-border bg-card p-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-1.5">
                  <HugeIcon icon={SlidersHorizontalIcon} className="size-3 text-primary" />
                  <span
                    className="font-mono text-[10px] font-semibold uppercase"
                    style={{ letterSpacing: '0.08em', color: 'var(--foreground)' }}
                  >
                    {t.studioDimensions}
                  </span>
                </div>
                <p
                  className="mt-1 break-all font-mono text-[9px] leading-tight"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {fingerprintFromSnapshot(snapshotState.snapshot)}
                </p>
              </div>
            </>
          )}

          {/* Landmark list — compact node tree */}
          {snapshotState.snapshot && (
            <>
              <Kicker>节点 · LANDMARKS</Kicker>
              <div className="mt-1 mb-2 flex items-baseline justify-between">
                <span
                  className="font-mono text-[9px]"
                  style={{ color: 'var(--dim, var(--muted-foreground))' }}
                >
                  {landmarkSearch.length} / {allLandmarks.length}
                </span>
              </div>
              {landmarkSearch.length === 0 ? (
                <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                  无匹配节点
                </p>
              ) : (
                <div className="space-y-0.5 mb-3">
                  {landmarkSearch.map((lm, _idx) => {
                    const realIdx = allLandmarks.indexOf(lm);
                    return (
                      <button
                        key={`${lm.selector}-${realIdx}`}
                        type="button"
                        onClick={() => {
                          setInspectingIdx(realIdx);
                          setHoveredIdx(null);
                        }}
                        onMouseEnter={() => setHoveredIdx(realIdx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[9.5px]"
                        style={{
                          borderRadius: 'var(--radius)',
                          background:
                            inspectingIdx === realIdx
                              ? 'var(--accent)'
                              : hoveredIdx === realIdx
                                ? 'var(--muted)'
                                : 'transparent',
                          color:
                            inspectingIdx === realIdx
                              ? 'var(--primary)'
                              : hoveredIdx === realIdx
                                ? 'var(--foreground)'
                                : 'var(--muted-foreground)',
                          outline: inspectingIdx === realIdx ? '1px solid var(--primary)' : 'none',
                        }}
                      >
                        <span className="truncate">{lm.selector}</span>
                        <span
                          className="ml-auto shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[8px] uppercase"
                          style={{ borderRadius: 'var(--radius)' }}
                        >
                          {lm.tag}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {!inspectingLandmark && !snapshotState.loading && snapshotState.snapshot && (
            <p
              className="mt-2 text-center font-mono text-[10px]"
              style={{ color: 'var(--dim, var(--muted-foreground))' }}
            >
              {t.studioInspectorEmpty}
            </p>
          )}

          {/* P3: Toolbox */}
          {snapshotState.snapshot && (
            <ToolboxPanel
              t={t}
              originalSig={computeSignature(snapshotState.snapshot)}
              overrides={toolOverrides}
              onOverride={setOverride}
              onReset={resetOverrides}
            />
          )}

          {/* P4: Export */}
          {snapshotState.snapshot && (
            <div
              className="mt-4 border border-border bg-card p-3"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <div className="mb-2 flex items-center gap-1.5 border-b border-border pb-1.5">
                <HugeIcon icon={Package01Icon} className="size-3.5 text-primary" />
                <span
                  className="font-mono text-[10px] font-semibold uppercase"
                  style={{ letterSpacing: '0.1em', color: 'var(--foreground)' }}
                >
                  导出 · EXPORT
                </span>
              </div>
              <p
                className="mb-2 font-mono text-[9px] leading-relaxed"
                style={{ color: 'var(--muted-foreground)' }}
              >
                将当前调色板与工具箱微调导出为可导入的{' '}
                <code style={{ color: 'var(--primary)' }}>.agentskin-theme</code> 包。
              </p>
              <div className="space-y-1.5">
                <input
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="THEME NAME"
                  className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <input
                  value={exportAuthor}
                  onChange={(e) => setExportAuthor(e.target.value)}
                  placeholder="AUTHOR (OPTIONAL)"
                  className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <Button
                  size="sm"
                  disabled={exportState.loading || !activeAgent}
                  onClick={handleExport}
                  className="h-6 w-full gap-1 font-mono text-[9.5px] uppercase"
                  style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
                >
                  {exportState.loading ? (
                    <Spinner data-icon="inline-start" className="size-3" />
                  ) : (
                    <HugeIcon icon={Download01Icon} className="size-3" />
                  )}
                  {exportState.loading ? 'EXPORTING…' : 'EXPORT PACKAGE'}
                </Button>
                {exportState.dir && (
                  <div
                    className="border border-border bg-muted p-2"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <p
                      className="font-mono text-[9px]"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      已导出到：
                    </p>
                    <p
                      className="break-all font-mono text-[9px]"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {exportState.dir}
                    </p>
                    <Button
                      size="sm"
                      onClick={() => api.showInFolder(exportState.dir!)}
                      className="mt-1 h-5 gap-1 font-mono text-[9px] uppercase"
                      style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
                    >
                      <HugeIcon icon={Folder01Icon} className="size-2.5" />
                      REVEAL
                    </Button>
                  </div>
                )}
                {exportState.error && (
                  <p className="font-mono text-[9px]" style={{ color: 'var(--primary)' }}>
                    导出失败：{exportState.error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error bar */}
      {snapshotState.error && (
        <div
          className="border-t border-border px-4 py-2 font-mono text-[10px] uppercase"
          style={{
            background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
            color: 'var(--primary)',
            letterSpacing: '0.08em',
          }}
        >
          {snapshotState.error}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cascade View — DevTools-grade cascade for a selected node
// ---------------------------------------------------------------------------

function CascadeView({
  cascade,
}: {
  cascade: {
    matchedRules: CssMatchedRule[];
    platformFonts: string[];
    boxModel: { width?: number; height?: number; left?: number; top?: number } | null;
    computed?: Array<{ property: string; value: string }>;
  };
}) {
  return (
    <div className="space-y-2">
      {cascade.platformFonts.length > 0 && (
        <div
          className="border border-border bg-card p-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div
            className="mb-1 font-mono text-[9px] uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
          >
            RENDER FONTS
          </div>
          <div className="flex flex-wrap gap-1">
            {cascade.platformFonts.map((f) => (
              <span
                key={f}
                className="bg-muted px-1 py-0.5 font-mono text-[8px]"
                style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border border-border bg-card p-1.5" style={{ borderRadius: 'var(--radius)' }}>
        <div
          className="mb-1 font-mono text-[9px] uppercase"
          style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
        >
          CASCADE
        </div>
        {cascade.matchedRules.length === 0 ? (
          <p className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
            无（CDP CSS 域不可用）
          </p>
        ) : (
          <div className="space-y-1.5">
            {cascade.matchedRules.map((rule) => {
              const firstDecl = rule.declarations[0];
              const declKey = firstDecl
                ? `${firstDecl.name}:${firstDecl.value}${firstDecl.important ? '!important' : ''}`
                : 'no-decls';
              const stableKey = `${rule.origin}::${rule.selector ?? ''}::${declKey}`;
              return (
                <div
                  key={stableKey}
                  className="border border-border bg-muted p-1"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="px-1 py-0.5 font-mono text-[8px]"
                      style={{
                        borderRadius: 'var(--radius)',
                        color: 'var(--primary)',
                        background: 'var(--accent)',
                      }}
                    >
                      {rule.origin}
                    </span>
                    <span
                      className="truncate font-mono text-[8.5px]"
                      style={{ color: 'var(--foreground)' }}
                      title={rule.selector ?? ''}
                    >
                      {rule.selector ?? '(inline style)'}
                    </span>
                  </div>
                  {rule.declarations.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {rule.declarations.slice(0, 14).map((d) => {
                        const declKey = `${d.name}:${d.value}${d.important ? '!important' : ''}`;
                        return (
                          <div
                            key={declKey}
                            className="flex items-baseline gap-1 px-0.5 font-mono text-[8.5px]"
                          >
                            <span
                              className="w-[110px] shrink-0 truncate"
                              style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                            >
                              {d.name}
                            </span>
                            <span className="truncate" style={{ color: 'var(--foreground)' }}>
                              {d.value}
                              {d.important ? ' !important' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
