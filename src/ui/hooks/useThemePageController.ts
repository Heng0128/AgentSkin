// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemePageController
 *
 * 编排 ThemesPage 的全部页面级状态、副作用与回调。将业务逻辑从主页面剥离，
 * 使页面退化为纯编排层（与 useWallpaperPageController 对齐）。
 *
 * 职责边界:
 *   - 持有所有 useState (activeTab/dragOver/pasteDialog/schemeId/pendingApps/...)
 *   - 封装 useEffect (selection → schemeId reset)
 *   - 封装 useMemo (activeAgentsByTheme / activeThemeCount / dynamicCount)
 *   - 封装所有 async handler (copyThemeString/handlePasteImport/applyToApp/...)
 *
 * 返回扁平对象供页面和子组件使用。禁止导出任何 React 组件。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useThemeCenter } from '@/hooks/useThemeCenter';
import { useThemeStore } from '@/stores/themeStore';

import type { AgentId } from '@shared/types';
import type { ThemeManifest } from '@shared/types/theme';
import {
  decodeThemeFromString,
  encodeThemeToString,
  validateThemeString,
} from '@shared/utils/theme-string-format';
import type { AppController } from './useAppController';

export interface ThemePageController {
  // ── Tab state ───────────────────────────────────────────────────────
  activeTab: 'installed' | 'community';
  setActiveTab: (tab: 'installed' | 'community') => void;

  // ── Drag-and-drop import state ───────────────────────────────────────
  dragOver: boolean;
  handleDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  // ── Paste-from-string dialog state ──────────────────────────────────
  showPasteDialog: boolean;
  setShowPasteDialog: (open: boolean) => void;
  pasteInput: string;
  setPasteInput: (value: string) => void;
  pasteError: string | null;
  setPasteError: (error: string | null) => void;
  importing: boolean;
  handlePasteImport: () => Promise<void>;

  // ── Selection / scheme state ────────────────────────────────────────
  schemeId: string | undefined;
  setSchemeId: (id: string | undefined) => void;
  handleSelect: (id: string) => void;

  // ── Apply-to-apps state ─────────────────────────────────────────────
  pendingApps: Set<AgentId>;
  pendingAll: boolean;

  // ── Derived data ────────────────────────────────────────────────────
  activeAgentsByTheme: Map<string, AgentId[]>;
  activeThemeCount: number;
  dynamicCount: number;

  // ── Actions ─────────────────────────────────────────────────────────
  handleCopyThemeString: () => Promise<void>;
  handleApplyToApp: (appId: AgentId) => Promise<unknown>;
  handleApplyAll: () => Promise<void>;
}

export function useThemePageController(controller: AppController): ThemePageController {
  const { t, status, selection, setSelection, applyToApp, dropThemeFiles } = controller;
  const tc = useThemeCenter();

  // ── Tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'installed' | 'community'>('installed');

  // ── Drag-and-drop state ───────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) dropThemeFiles(files);
    },
    [dropThemeFiles],
  );

  // ── Paste-from-string dialog state ────────────────────────────────
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [pasteInput, setPasteInput] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handlePasteImport = useCallback(async () => {
    const trimmed = pasteInput.trim();
    const validation = validateThemeString(trimmed);
    if (!validation.valid) {
      setPasteError(validation.errors.join('; '));
      return;
    }
    const manifest = decodeThemeFromString(trimmed);
    if (!manifest) {
      setPasteError(t.importFailed);
      return;
    }
    const bytes = new TextEncoder().encode(trimmed);
    setImporting(true);
    try {
      const result = await api.importThemeBytes(bytes, manifest.id);
      if (result?.theme?.displayName) {
        setShowPasteDialog(false);
        setPasteInput('');
        setPasteError(null);
        controller.showToast?.(t.importSuccess(result.theme.displayName));
        await controller.refreshThemes?.();
        // Refresh the installed-themes catalog so the new theme appears in ThemesPage
        void useThemeStore.getState().refreshThemes();
      }
    } catch {
      setPasteError(t.importFailed);
      controller.showToast?.(t.importFailed, 'destructive');
    } finally {
      setImporting(false);
    }
  }, [pasteInput, t, controller]);

  // ── Selection / scheme state ──────────────────────────────────────
  const [schemeId, setSchemeId] = useState<string | undefined>(undefined);
  const lastSelectionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const current = selection?.theme.id ?? null;
    if (lastSelectionIdRef.current !== current) {
      lastSelectionIdRef.current = current;
      setSchemeId(undefined);
    }
  }, [selection]);

  const handleSelect = useCallback(
    (id: string) => {
      if (!tc.themes.some((th) => th.id === id)) return;
      const theme = controller.installedById(id);
      if (theme) setSelection({ kind: 'installed', theme });
    },
    [tc.themes, controller, setSelection],
  );

  // ── Apply-to-apps state ───────────────────────────────────────────
  const [pendingApps, setPendingApps] = useState<Set<AgentId>>(new Set());
  const [pendingAll, setPendingAll] = useState(false);

  const runApply = useCallback(
    async (appId: AgentId) => {
      if (selection?.kind !== 'installed') return;
      setPendingApps((prev) => new Set(prev).add(appId));
      try {
        await applyToApp(selection.theme.id, selection.theme.name, appId, { schemeId });
      } finally {
        setPendingApps((prev) => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });
      }
    },
    [selection, applyToApp, schemeId],
  );

  const handleApplyAll = useCallback(async () => {
    if (selection?.kind !== 'installed') return;
    const supportedAgents = selection.theme.supportedAgents;
    const eligibleApps = supportedAgents.filter((appId) =>
      Boolean(controller.appStatusFor(appId)?.installed),
    );
    if (eligibleApps.length === 0) return;

    setPendingAll(true);
    try {
      const queue = [...eligibleApps];
      const CONCURRENCY = 6;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        let ok = 0;
        let fail = 0;
        for (;;) {
          const appId = queue.shift();
          if (!appId) break;
          try {
            await runApply(appId);
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        return { ok, fail };
      });
      const results = await Promise.all(workers);
      const totalOk = results.reduce((sum, r) => sum + r.ok, 0);
      const totalFail = results.reduce((sum, r) => sum + r.fail, 0);
      if (totalFail === 0) {
        controller.showToast?.(t.applyAllSuccess(totalOk));
      } else {
        controller.showToast?.(t.applyAllPartial(totalOk, totalFail), 'destructive');
      }
    } finally {
      setPendingAll(false);
    }
  }, [selection, controller, runApply, t]);

  // ── Derived: active agents by theme ───────────────────────────────
  const activeAgentsByTheme = useMemo(() => {
    const map = new Map<string, AgentId[]>();
    for (const app of status?.apps ?? []) {
      if (app.activeThemeId) {
        const list = map.get(app.activeThemeId) ?? [];
        list.push(app.appId);
        map.set(app.activeThemeId, list);
      }
    }
    return map;
  }, [status]);

  const activeThemeCount = useMemo(() => activeAgentsByTheme.size, [activeAgentsByTheme]);
  const dynamicCount = useMemo(() => tc.themes.filter((th) => th.hasWallpaper).length, [tc.themes]);

  // ── Copy theme string ────────────────────────────────────────────
  const handleCopyThemeString = useCallback(async () => {
    if (selection?.kind !== 'installed') return;
    const theme = selection.theme as unknown as ThemeManifest;
    const str = encodeThemeToString(theme);
    try {
      await navigator.clipboard.writeText(str);
      controller.showToast?.(t.copyThemeString);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = str;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, [selection, t, controller]);

  return {
    activeTab,
    setActiveTab,
    dragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    showPasteDialog,
    setShowPasteDialog,
    pasteInput,
    setPasteInput,
    pasteError,
    setPasteError,
    importing,
    handlePasteImport,
    schemeId,
    setSchemeId,
    handleSelect,
    pendingApps,
    pendingAll,
    activeAgentsByTheme,
    activeThemeCount,
    dynamicCount,
    handleCopyThemeString,
    handleApplyToApp: runApply,
    handleApplyAll,
  };
}
