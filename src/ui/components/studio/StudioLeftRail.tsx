// SPDX-License-Identifier: MPL-2.0

import { AppMark } from '@/components/app-mark';
import { Kicker } from '@/components/studio/kicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';

import {
  Add01Icon,
  Delete01Icon,
  Edit01Icon,
  Folder01Icon,
  FolderAddIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import type { AgentId, StudioProject, ThemeCatalogItem } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';

/**
 * Studio left rail — project CRUD + installed-theme library linkage + custom
 * capture controls (pinned selectors / pseudo states / dark-light schemes).
 * Controlled presentational component; all state flows in via props.
 */
export function StudioLeftRail({
  projects,
  activeProjectId,
  creatingProject,
  newName,
  newAuthor,
  newAgent,
  importing,
  editingId,
  editName,
  editAuthor,
  installedThemes,
  themeLibraryOpen,
  pinnedSelectors,
  pseudoStates,
  captureSchemes,
  customSelectorInput,
  setCreatingProject,
  setNewName,
  setNewAuthor,
  setNewAgent,
  setEditingId,
  setEditName,
  setEditAuthor,
  setThemeLibraryOpen,
  setCustomSelectorInput,
  setActiveProjectId,
  handleCreateProject,
  handleImportProject,
  handleDeleteProject,
  handleRenameProject,
  loadThemeIntoProject,
  addPinnedSelector,
  removePinnedSelector,
  togglePseudo,
  setCaptureSchemes,
}: {
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  newName: string;
  newAuthor: string;
  newAgent: AgentId;
  importing: boolean;
  editingId: string | null;
  editName: string;
  editAuthor: string;
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  setCreatingProject: React.Dispatch<React.SetStateAction<boolean>>;
  setNewName: (v: string) => void;
  setNewAuthor: (v: string) => void;
  setNewAgent: (v: AgentId) => void;
  setEditingId: (v: string | null) => void;
  setEditName: (v: string) => void;
  setEditAuthor: (v: string) => void;
  setThemeLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomSelectorInput: (v: string) => void;
  setActiveProjectId: (v: string) => void;
  handleCreateProject: () => void;
  handleImportProject: () => void;
  handleDeleteProject: (id: string) => void;
  handleRenameProject: (p: StudioProject, name: string, author: string) => void;
  loadThemeIntoProject: (themeId: string) => void;
  addPinnedSelector: () => void;
  removePinnedSelector: (sel: string) => void;
  togglePseudo: (state: string) => void;
  setCaptureSchemes: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
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
          <HugeIcon icon={Add01Icon} className="size-3" /> 新建
        </button>
        <button
          type="button"
          onClick={handleImportProject}
          disabled={importing}
          className="flex h-6 items-center gap-1 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-40"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
        >
          <HugeIcon icon={FolderAddIcon} className="size-3" /> 导入
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
            placeholder="工程名"
            className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <input
            value={newAuthor}
            onChange={(e) => setNewAuthor(e.target.value)}
            placeholder="作者（可选）"
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
                    newAgent === agentId ? '1px solid var(--primary)' : '1px solid var(--border)',
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
              创建
            </button>
            <button
              type="button"
              onClick={() => setCreatingProject(false)}
              className="h-6 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase"
              style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            >
              取消
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
                    placeholder="工程名"
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
                    placeholder="作者"
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
                      保存
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
                      取消
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
                      <Badge
                        variant="outline"
                        className="gap-1 px-1 py-0.5 font-mono text-[7px] font-bold uppercase text-cr-success border-cr-success/45"
                      >
                        <span className="inline-block size-[5px] rounded-full bg-cr-success animate-breathe" />
                        已快照
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="px-1 py-0.5 font-mono text-[7px] uppercase text-muted-foreground border-border"
                      >
                        空闲
                      </Badge>
                    )}
                    {p.exportedDir && (
                      <Badge
                        variant="red"
                        className="px-1 py-0.5 font-mono text-[7px] font-bold uppercase"
                      >
                        已导出
                      </Badge>
                    )}
                    {p.author && (
                      <span
                        className="truncate font-mono text-[8px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        作者：{p.author}
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
            <HugeIcon icon={themeLibraryOpen ? RefreshIcon : Folder01Icon} className="size-2.5" />
            {themeLibraryOpen ? '关闭' : '打开'}
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
                  disabled={!activeProjectId}
                  onClick={() => void loadThemeIntoProject(theme.id)}
                  className="flex w-full items-center gap-1.5 rounded-[2px] px-1.5 py-1 text-left transition-colors hover:bg-accent disabled:opacity-40"
                  title={
                    activeProjectId ? `加载「${theme.name}」调色板到当前工程` : '先新建/选择工程'
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
        <Kicker>选择器</Kicker>

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
            添加
          </Button>
        </div>

        {/* Pseudo-state tags */}
        <div className="flex flex-wrap items-center gap-1">
          <span
            className="font-mono text-[9px] uppercase"
            style={{ letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}
          >
            PSEUDO：
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
          <span>深浅色变体</span>
          <span
            className="px-1 py-0.5 font-mono text-[8px] font-bold uppercase"
            style={{
              background: captureSchemes ? 'var(--primary)' : 'var(--border)',
              color: captureSchemes ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
            }}
          >
            {captureSchemes ? '开' : '关'}
          </span>
        </button>
      </div>
    </div>
  );
}
