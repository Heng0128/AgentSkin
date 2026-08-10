// SPDX-License-Identifier: MPL-2.0

import { AppMark } from '@/components/app-mark';
import { Kicker } from '@/components/studio/kicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';

import {
  Add01Icon,
  Delete01Icon,
  Edit01Icon,
  Folder01Icon,
  FolderAddIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META } from '@shared/types';

/**
 * Studio left rail — project CRUD + installed-theme library linkage + custom
 * capture controls (pinned selectors / pseudo states / dark-light schemes).
 * Reads shared studio state directly from {@link useStudioStore}.
 */
export function StudioLeftRail({ t }: { t: UiMessages }) {
  const projects = useStudioStore((s) => s.projects);
  const activeProjectId = useStudioStore((s) => s.activeProjectId);
  const creatingProject = useStudioStore((s) => s.creatingProject);
  const newName = useStudioStore((s) => s.newName);
  const newAuthor = useStudioStore((s) => s.newAuthor);
  const newAgent = useStudioStore((s) => s.newAgent);
  const importing = useStudioStore((s) => s.importing);
  const editingId = useStudioStore((s) => s.editingId);
  const editName = useStudioStore((s) => s.editName);
  const editAuthor = useStudioStore((s) => s.editAuthor);
  const installedThemes = useStudioStore((s) => s.installedThemes);
  const themeLibraryOpen = useStudioStore((s) => s.themeLibraryOpen);
  const pinnedSelectors = useStudioStore((s) => s.pinnedSelectors);
  const pseudoStates = useStudioStore((s) => s.pseudoStates);
  const captureSchemes = useStudioStore((s) => s.captureSchemes);
  const customSelectorInput = useStudioStore((s) => s.customSelectorInput);

  const setCreatingProject = useStudioStore((s) => s.setCreatingProject);
  const setNewName = useStudioStore((s) => s.setNewName);
  const setNewAuthor = useStudioStore((s) => s.setNewAuthor);
  const setNewAgent = useStudioStore((s) => s.setNewAgent);
  const setEditingId = useStudioStore((s) => s.setEditingId);
  const setEditName = useStudioStore((s) => s.setEditName);
  const setEditAuthor = useStudioStore((s) => s.setEditAuthor);
  const setThemeLibraryOpen = useStudioStore((s) => s.setThemeLibraryOpen);
  const setCustomSelectorInput = useStudioStore((s) => s.setCustomSelectorInput);
  const selectProject = useStudioStore((s) => s.selectProject);
  const createProject = useStudioStore((s) => s.createProject);
  const importProject = useStudioStore((s) => s.importProject);
  const deleteProject = useStudioStore((s) => s.deleteProject);
  const renameProject = useStudioStore((s) => s.renameProject);
  const loadThemeIntoProject = useStudioStore((s) => s.loadThemeIntoProject);
  const addPinnedSelector = useStudioStore((s) => s.addPinnedSelector);
  const removePinnedSelector = useStudioStore((s) => s.removePinnedSelector);
  const togglePseudo = useStudioStore((s) => s.togglePseudo);
  const setCaptureSchemes = useStudioStore((s) => s.setCaptureSchemes);

  return (
    <div
      className="overflow-y-auto border-r border-border px-3 pt-3"
      style={{ background: 'var(--bg, var(--background))' }}
    >
      {/* Section: Projects */}
      <Kicker>{t.studioProjectTitle}</Kicker>
      <div className="mt-2 flex gap-1 pb-2">
        <button
          type="button"
          onClick={() => setCreatingProject(true)}
          className="flex h-6 items-center gap-1 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
        >
          <HugeIcon icon={Add01Icon} className="size-3" /> {t.studioProjectNew}
        </button>
        <button
          type="button"
          onClick={() => void importProject()}
          disabled={importing}
          className="flex h-6 items-center gap-1 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-40"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
        >
          <HugeIcon icon={FolderAddIcon} className="size-3" /> {t.studioProjectImport}
        </button>
      </div>

      {/* New project form */}
      {creatingProject && (
        <div
          className="mt-1 space-y-1.5 border border-border bg-card p-2"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <input
            aria-label={t.studioProjectNameAria}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createProject();
            }}
            placeholder={t.studioProjectPlaceholder}
            className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <input
            aria-label={t.studioProjectAuthorAria}
            value={newAuthor}
            onChange={(e) => setNewAuthor(e.target.value)}
            placeholder={t.studioProjectAuthorPlaceholder}
            className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
            style={{ borderRadius: 'var(--radius)' }}
          />
          {/* Agent chips */}
          <div className="flex flex-wrap gap-1 pt-1">
            {AGENT_IDS.filter((agentId) => Boolean(appStatusFor(agentId)?.installed)).map(
              (agentId) => (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => setNewAgent(agentId)}
                  className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px]"
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
              ),
            )}
          </div>
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => void createProject()}
              className="h-6 flex-1 border border-border bg-primary px-2 font-mono text-[9.5px] font-bold uppercase text-primary-foreground"
              style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
            >
              {t.studioProjectCreate}
            </button>
            <button
              type="button"
              onClick={() => setCreatingProject(false)}
              className="h-6 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase"
              style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      <div className="mt-2 space-y-1">
        {projects.length === 0 && !creatingProject && (
          <p
            className="font-mono text-[10px] leading-relaxed"
            style={{ color: 'var(--dim, var(--muted-foreground))', opacity: 0.7 }}
          >
            {t.studioProjectEmpty}
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
                    aria-label={t.studioProjectNameAria}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameProject(p, editName, editAuthor);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    placeholder={t.studioProjectPlaceholder}
                    className="h-5 w-full border border-border bg-muted px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                  <input
                    aria-label={t.studioProjectAuthorAria}
                    value={editAuthor}
                    onChange={(e) => setEditAuthor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameProject(p, editName, editAuthor);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    placeholder={t.studioProjectAuthorPlaceholder}
                    className="h-5 w-full border border-border bg-muted px-1.5 font-mono text-[10px] outline-none focus:border-primary"
                    style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void renameProject(p, editName, editAuthor)}
                      className="bg-primary px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-primary-foreground"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {t.studioProjectSave}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-1.5 py-0.5 font-mono text-[9.5px] uppercase"
                      style={{
                        color: 'var(--muted-foreground)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => selectProject(p.id)}
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
                        className="gap-1 px-1 py-0.5 font-mono text-[9.5px] font-bold uppercase text-cr-success border-cr-success/45"
                      >
                        <span className="inline-block size-[5px] rounded-[1px] bg-cr-success" />
                        {t.studioProjectSnapshotted}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="px-1 py-0.5 font-mono text-[9.5px] uppercase text-muted-foreground border-border"
                      >
                        {t.studioProjectIdle}
                      </Badge>
                    )}
                    {p.exportedDir && (
                      <Badge
                        variant="red"
                        className="px-1 py-0.5 font-mono text-[9.5px] font-bold uppercase"
                      >
                        {t.studioProjectExported}
                      </Badge>
                    )}
                    {p.author && (
                      <span
                        className="truncate font-mono text-[9.5px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {t.studioProjectAuthor(p.author)}
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
                    className="p-0.5 text-[10px] transition-opacity opacity-0 group-hover:opacity-100"
                    style={{ color: 'var(--muted-foreground)' }}
                    aria-label={t.studioProjectAriaEdit}
                  >
                    <HugeIcon icon={Edit01Icon} className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteProject(p.id)}
                    className="p-0.5 text-[10px] transition-opacity opacity-0 group-hover:opacity-100 hover:!text-[var(--primary)]"
                    style={{ color: 'var(--muted-foreground)' }}
                    aria-label={t.studioProjectAriaDelete}
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
          <Kicker>{t.studioLibraryTitle}</Kicker>
          <button
            type="button"
            onClick={() => setThemeLibraryOpen(!themeLibraryOpen)}
            className="flex h-5 items-center gap-1 border border-border bg-muted px-1.5 font-mono text-[10px] uppercase transition-colors hover:bg-accent"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            <HugeIcon icon={themeLibraryOpen ? RefreshIcon : Folder01Icon} className="size-2.5" />
            {themeLibraryOpen ? t.studioLibraryToggleClose : t.studioLibraryToggleOpen}
          </button>
        </div>

        {themeLibraryOpen && (
          <div
            className="max-h-40 space-y-1 overflow-y-auto border border-border bg-card p-1.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {installedThemes.length === 0 ? (
              <p
                className="px-1 py-1 font-mono text-[10px]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {t.studioLibraryEmpty}
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
                    activeProjectId
                      ? t.studioLibraryLoadTooltip(theme.name)
                      : t.studioLibraryCreateProjectFirst
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
                    className="min-w-0 flex-1 truncate font-mono text-[10px]"
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
        <Kicker>{t.studioSelectorTitle}</Kicker>

        {pinnedSelectors.length === 0 ? (
          <p
            className="font-mono text-[10px]"
            style={{ color: 'var(--dim, var(--muted-foreground))', opacity: 0.7 }}
          >
            {t.studioSelectorIdle}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {pinnedSelectors.map((sel) => (
              <span
                key={sel}
                className="flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
              >
                {sel.length > 22 ? `${sel.slice(0, 22)}…` : sel}
                <button
                  type="button"
                  onClick={() => removePinnedSelector(sel)}
                  className="hover:text-primary"
                  style={{ color: 'var(--muted-foreground)' }}
                  aria-label={t.studioSelectorRemove}
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
            placeholder={t.studioSelectorPlaceholder}
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
            {t.studioSelectorAdd}
          </Button>
        </div>

        {/* Pseudo-state tags */}
        <div className="flex flex-wrap items-center gap-1">
          <span
            className="font-mono text-[10px] uppercase"
            style={{ letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}
          >
            PSEUDO：
          </span>
          {(['hover', 'focus', 'active'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePseudo(p)}
              className="border px-1.5 py-0.5 font-mono text-[10px]"
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
          onClick={() => setCaptureSchemes(!captureSchemes)}
          className="flex w-full items-center justify-between border border-border px-2 py-1.5 font-mono text-[9.5px] uppercase"
          style={{
            letterSpacing: '0.06em',
            borderRadius: 'var(--radius)',
            background: captureSchemes ? 'var(--accent)' : 'var(--card)',
            color: captureSchemes ? 'var(--primary)' : 'var(--muted-foreground)',
          }}
        >
          <span>{t.studioSchemeVariants}</span>
          <span
            className="px-1 py-0.5 font-mono text-[9.5px] font-bold uppercase"
            style={{
              background: captureSchemes ? 'var(--primary)' : 'var(--border)',
              color: captureSchemes ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
            }}
          >
            {captureSchemes ? t.studioToggleOn : t.studioToggleOff}
          </span>
        </button>
      </div>
    </div>
  );
}
