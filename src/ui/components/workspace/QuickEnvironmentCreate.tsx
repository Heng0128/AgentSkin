// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { cn } from '@/lib/utils';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useShellStore } from '@/stores/shellStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { WallpaperInfo } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';

/**
 * # QuickEnvironmentCreate
 *
 * Inline quick-create form for spawning a new environment preset.
 * Mirrors the "创建工程" dialog: project name, optional author, agent picker,
 * and an optional wallpaper binding.
 *
 * On confirm: calls environmentStore.createEnvironment(agentId, null, wallpaperId,
 * name, false) to persist a preset (Agent + Theme + Wallpaper) without applying
 * immediately. The wallpaper half makes the environment a full environment
 * definition (strategic audit P0-3).
 */

export function QuickEnvironmentCreate({
  onCreated,
  onCancel,
}: {
  onCreated?: () => void;
  onCancel?: () => void;
}) {
  const [projectName, setProjectName] = useState('');
  const [author, setAuthor] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>('traework');
  const [wallpaperId, setWallpaperId] = useState<string | null>(null);
  const [wallpapers, setWallpapers] = useState<WallpaperInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const createEnvironment = useEnvironmentStore((s) => s.createEnvironment);
  const locale = useShellStore((s) => s.locale);
  const t: UiMessages = uiMessages[locale];

  useEffect(() => {
    let alive = true;
    api
      .listWallpapers()
      .then((list) => {
        if (alive) setWallpapers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const canSubmit = selectedAgent != null && projectName.trim().length > 0 && !submitting;

  async function handleCreate() {
    if (!canSubmit || !selectedAgent) return;
    setSubmitting(true);
    try {
      const result = await createEnvironment(
        selectedAgent as import('@shared/types').AgentId,
        null,
        wallpaperId,
        projectName.trim(),
        false,
      );
      if (result.success) {
        onCreated?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mt-1 space-y-1.5 border border-border bg-card p-2"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {/* 工程名 */}
      <input
        placeholder="工程名"
        className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
        style={{ borderRadius: 'var(--radius)' }}
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleCreate();
        }}
      />

      {/* 作者 */}
      <input
        placeholder="作者（可选）"
        className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
        style={{ borderRadius: 'var(--radius)' }}
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
      />

      {/* 壁纸绑定（可选） */}
      <select
        className="h-6 w-full border border-border bg-muted px-1 font-mono text-[10px] outline-none focus:border-primary/60"
        style={{ borderRadius: 'var(--radius)' }}
        value={wallpaperId ?? ''}
        onChange={(e) => setWallpaperId(e.target.value || null)}
        title={t.bindWallpaper}
      >
        <option value="">{t.noWallpaper}</option>
        {wallpapers.map((w) => (
          <option key={w.id} value={w.id}>
            {w.title}
          </option>
        ))}
      </select>

      {/* Agent 选择器 */}
      <div className="flex flex-wrap gap-1 pt-1">
        {AGENT_IDS.map((id) => {
          const meta = AGENT_META[id];
          const isSelected = selectedAgent === id;
          return (
            <button
              key={id}
              type="button"
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 font-mono text-[9px]',
                isSelected
                  ? 'border border-primary bg-primary/10 text-primary'
                  : 'border border-border bg-muted text-muted-foreground',
              )}
              style={{ borderRadius: 'var(--radius)', letterSpacing: '0.05em' }}
              onClick={() => setSelectedAgent(id)}
              title={meta.displayName}
            >
              <AppMark appId={id} size={10} />
              {meta.displayName.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          className={cn(
            'h-6 flex-1 border border-border px-2 font-mono text-[9.5px] font-bold uppercase',
            canSubmit
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
          )}
          style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
          disabled={!canSubmit}
          onClick={() => void handleCreate()}
        >
          {submitting ? '...' : '创建'}
        </button>
        <button
          type="button"
          className="h-6 border border-border bg-muted px-2 font-mono text-[9.5px] uppercase text-muted-foreground"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}
