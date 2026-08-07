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
 *
 * Since the 2026-08 cleanup the page is split into four presentational
 * section components (StudioHeader / StudioLeftRail / StudioCenterPanel /
 * StudioRightInspector) that receive all state + callbacks through props.
 * This file owns the shared state and business logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { buildStudioPalette } from '@/components/studio/palette';
import { type PreviewView, StudioCenterPanel } from '@/components/studio/StudioCenterPanel';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { StudioLeftRail } from '@/components/studio/StudioLeftRail';
import { StudioRightInspector } from '@/components/studio/StudioRightInspector';
import {
  computeSignature,
  type StudioColorSets,
  type ToolOverride,
} from '@/components/studio/Toolbox';
import type { AppController } from '@/hooks/useAppController';
import { useNotifications } from '@/hooks/useNotifications';

import { semanticColorsToPalette } from '@shared/theme-mapping';
import {
  AGENT_META,
  type AgentId,
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

  // Installed-theme library linkage.
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
      setBaselines({} as Record<AgentId, ThemeVisualSnapshot>);
      setBaselineLoadingMap({} as Record<AgentId, boolean>);
      setBaselineErrorMap({} as Record<AgentId, string>);
      return;
    }
    let cancelled = false;
    setSnapshotState((prev) => ({ ...prev, snapshot: null, loading: true, error: null }));
    if (activeAgent) {
      setBaselineLoadingMap((prev) => ({ ...prev, [activeAgent]: true }));
    }
    setBaselineErrorMap({} as Record<AgentId, string>);

    const baselineAgentId = activeAgent;
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
        if (base && baselineAgentId) {
          setBaselines((prev) => ({ ...prev, [baselineAgentId]: base }));
        }
        if (baselineAgentId) {
          setBaselineLoadingMap((prev) => ({ ...prev, [baselineAgentId]: false }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshotState({ snapshot: null, loading: false, error: null, themeName: '' });
        if (baselineAgentId) {
          setBaselineLoadingMap((prev) => ({ ...prev, [baselineAgentId]: false }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeAgent]);

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
  // 基线按 agentId 分组——每个 agent 的真实外观独一无二
  const [baselines, setBaselines] = useState<Record<AgentId, ThemeVisualSnapshot>>(
    {} as Record<AgentId, ThemeVisualSnapshot>,
  );
  const [baselineLoadingMap, setBaselineLoadingMap] = useState<Record<AgentId, boolean>>(
    {} as Record<AgentId, boolean>,
  );
  const [_baselineErrorMap, setBaselineErrorMap] = useState<Record<AgentId, string>>(
    {} as Record<AgentId, string>,
  );
  // 当前 active agent 的派生基线状态
  const baseline = activeAgent ? (baselines[activeAgent] ?? null) : null;
  const baselineLoading = activeAgent ? Boolean(baselineLoadingMap[activeAgent]) : false;
  const [previewView, setPreviewView] = useState<PreviewView>('theme');
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

  // 切换 agent 时，如果该 agent 尚未有基线，自动抓取一次原生态
  const autoBaselineBusyRef = useRef(false);
  useEffect(() => {
    if (!activeAgent || !activeProject) return;
    if (baselines[activeAgent]) return;
    if (autoBaselineBusyRef.current) return;
    let cancelled = false;
    autoBaselineBusyRef.current = true;
    setPreviewView('theme');
    setBaselineLoadingMap((prev: Record<AgentId, boolean>) => ({
      ...prev,
      [activeAgent]: true,
    }));
    setBaselineErrorMap((prev) => ({ ...prev, [activeAgent]: '' }));
    api
      .snapshotBaseline(activeAgent, { pseudoStates, captureSchemes })
      .then((snap) => {
        if (cancelled) return;
        setBaselines((prev) => ({ ...prev, [activeAgent]: snap }));
        return api.saveStudioSnapshot(activeProject.id, snap, 'baseline').catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setBaselineLoadingMap((prev: Record<AgentId, boolean>) => ({
          ...prev,
          [activeAgent]: false,
        }));
        autoBaselineBusyRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [activeAgent, activeProject, pseudoStates, captureSchemes, baselines]);

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

  // Cleanup inspectBusyRef on unmount to prevent permanent lock
  useEffect(() => {
    return () => {
      inspectBusyRef.current = false;
    };
  }, []);

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
            setInspectMode(false);
            setLiveNode(null);
            setLiveError(null);
          });
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
    setBaselineLoadingMap((prev: Record<AgentId, boolean>) => ({
      ...prev,
      [activeAgent]: true,
    }));
    setBaselineErrorMap((prev) => ({ ...prev, [activeAgent]: '' }));
    setPreviewView('theme');
    try {
      const snap = await api.snapshotBaseline(activeAgent, {
        extraSelectors: pinnedSelectors,
        pseudoStates,
        captureSchemes,
      });
      setBaselines((prev) => ({ ...prev, [activeAgent]: snap }));
      setBaselineLoadingMap((prev: Record<AgentId, boolean>) => ({
        ...prev,
        [activeAgent]: false,
      }));
      saveActiveProject({ hasBaseline: true });
      await api.saveStudioSnapshot(activeProject.id, snap, 'baseline');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBaselineErrorMap((prev) => ({ ...prev, [activeAgent]: `基线抓取失败：${msg}` }));
      setBaselineLoadingMap((prev: Record<AgentId, boolean>) => ({
        ...prev,
        [activeAgent]: false,
      }));
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
      {/* SWISS HEADER — 44px height, brand + actions */}
      <StudioHeader
        t={t}
        activeProject={activeProject}
        activeAgent={activeAgent}
        handleChangeAgent={handleChangeAgent}
        snapshotState={snapshotState}
        exportState={exportState}
        handleRestore={handleRestore}
        handleExport={handleExport}
      />

      {/* THREE-PANEL SWISS LAYOUT */}
      <div
        className="min-h-0 flex-1 grid"
        style={{
          gridTemplateColumns: previewView === 'theme' ? '240px 1fr 260px' : '240px 1fr',
          background: 'var(--bg, var(--background))',
        }}
      >
        {/* LEFT PANEL (240px) — project rail + capture controls */}
        <StudioLeftRail
          projects={projects}
          activeProjectId={activeProjectId}
          creatingProject={creatingProject}
          newName={newName}
          newAuthor={newAuthor}
          newAgent={newAgent}
          importing={importing}
          editingId={editingId}
          editName={editName}
          editAuthor={editAuthor}
          installedThemes={installedThemes}
          themeLibraryOpen={themeLibraryOpen}
          pinnedSelectors={pinnedSelectors}
          pseudoStates={pseudoStates}
          captureSchemes={captureSchemes}
          customSelectorInput={customSelectorInput}
          setCreatingProject={setCreatingProject}
          setNewName={setNewName}
          setNewAuthor={setNewAuthor}
          setNewAgent={setNewAgent}
          setEditingId={setEditingId}
          setEditName={setEditName}
          setEditAuthor={setEditAuthor}
          setThemeLibraryOpen={setThemeLibraryOpen}
          setCustomSelectorInput={setCustomSelectorInput}
          setActiveProjectId={setActiveProjectId}
          handleCreateProject={handleCreateProject}
          handleImportProject={handleImportProject}
          handleDeleteProject={handleDeleteProject}
          handleRenameProject={handleRenameProject}
          loadThemeIntoProject={loadThemeIntoProject}
          addPinnedSelector={addPinnedSelector}
          removePinnedSelector={removePinnedSelector}
          togglePseudo={togglePseudo}
          setCaptureSchemes={setCaptureSchemes}
        />

        {/* CENTER PANEL (flex-1) — tabs + canvas + fingerprint */}
        <StudioCenterPanel
          t={t}
          previewView={previewView}
          setPreviewView={setPreviewView}
          snapshotState={snapshotState}
          baseline={baseline}
          baselineLoading={baselineLoading}
          activeProject={activeProject}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          inspectMode={inspectMode}
          toggleInspect={toggleInspect}
          activeAgent={activeAgent}
          handleSnapshot={handleSnapshot}
          handleBaselineSnapshot={handleBaselineSnapshot}
          pinnedSelectors={pinnedSelectors}
          setPinnedSelectors={setPinnedSelectors}
          toolOverrides={toolOverrides}
          studioColorSets={studioColorSets}
          onToast={showToast}
        />

        {/* RIGHT PANEL (260px) — inspector + image-to-theme + toolbox + export */}
        {previewView === 'theme' && (
          <StudioRightInspector
            t={t}
            activeAgent={activeAgent}
            installedThemes={installedThemes}
            snapshotState={snapshotState}
            inspectingLandmark={inspectingLandmark}
            inspectingIdx={inspectingIdx}
            hoveredIdx={hoveredIdx}
            setInspectingIdx={setInspectingIdx}
            setHoveredIdx={setHoveredIdx}
            pseudoView={pseudoView}
            setPseudoView={setPseudoView}
            schemeView={schemeView}
            setSchemeView={setSchemeView}
            activePseudo={activePseudo}
            activeScheme={activeScheme}
            landmarkSearch={landmarkSearch}
            allLandmarks={allLandmarks}
            inspectMode={inspectMode}
            liveNode={liveNode}
            liveError={liveError}
            pinnedSelectors={pinnedSelectors}
            setPinnedSelectors={setPinnedSelectors}
            toolOverrides={toolOverrides}
            setOverride={setOverride}
            resetOverrides={resetOverrides}
            exportName={exportName}
            setExportName={setExportName}
            exportAuthor={exportAuthor}
            setExportAuthor={setExportAuthor}
            exportState={exportState}
            handleExport={handleExport}
            onRefresh={() => void refreshThemeLibrary()}
            onToast={showToast}
            onPaletteLoaded={(palette) => {
              setToolOverrides((prev) => ({ ...prev, colors: palette }) as ToolOverride);
              if (activeProjectId) {
                void (async () => {
                  const proj = projects.find((p) => p.id === activeProjectId);
                  if (proj) {
                    await api.saveStudioProject({ ...proj, palette });
                  }
                })();
              }
            }}
            onImageThemeGenerated={(palette) => {
              setToolOverrides((prev) => ({ ...prev, colors: palette }) as ToolOverride);
            }}
            onShowInFolder={(dir) => api.showInFolder(dir)}
          />
        )}
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
