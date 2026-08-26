// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Project IPC — self-contained theme projects (no installed themes)
 *
 * Replaces the Studio's dependency on the app's installed-theme catalog. A
 * "工程" (project) is a directory under `theme-workbench/projects/<id>/`
 * containing a `project.json`:
 *
 *   {
 *     schema: 'agentskin-studio-project/v1',
 *     id, name, author, agentId, createdAt, updatedAt,
 *     hasSnapshot, exportedDir?, palette?, signature?, overrides?
 *   }
 *
 * The heavy real-DOM snapshot lives in a SEPARATE `snapshot.json` inside the
 * same project directory (written via `STUDIO_SNAPSHOT_SAVE` / read via
 * `STUDIO_SNAPSHOT_LOAD`). Keeping it out of `project.json` stops the
 * lightweight project metadata from ballooning, while still letting the
 * crafted preview survive a window close / reload without re-capturing.
 *
 * `import` opens a directory picker and accepts either:
 *   - a Studio project JSON (`project.json` with the schema above), or
 *   - a `.agentskin-theme` package (`manifest.json` — semantic `colors` are
 *     mapped back onto the `--agentskin-*` palette).
 * The imported project is copied into `projects/<newId>/` so it is persisted.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import { getMainLocale, getMainMessages, uiMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { isSafeThemeId } from '../../shared/theme-id';
import { semanticColorsToPalette } from '../../shared/theme-mapping';
import {
  AGENT_IDS,
  type AgentId,
  type StudioProject,
  type ThemeVisualSnapshot,
} from '../../shared/types';

// Use a writable per-user data directory. `app.getAppPath()` points at the
// read-only asar bundle when packaged, so writing projects there would fail
// in production builds. userData is always writable and survives updates.
const PROJECTS_DIR = path.join(app.getPath('userData'), 'theme-workbench', 'projects');
const PROJECT_SCHEMA = 'agentskin-studio-project/v1';

function ensureDir(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function isValidAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && (AGENT_IDS as readonly string[]).includes(id);
}

function readProjectFile(file: string): StudioProject | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    // TODO: type-guard — 待渐进式加固
    const data = JSON.parse(raw) as Partial<StudioProject>;
    if (data.schema !== PROJECT_SCHEMA || typeof data.id !== 'string') return null;
    if (!isValidAgentId(data.agentId)) return null;
    return {
      schema: PROJECT_SCHEMA,
      id: data.id,
      name: String(data.name ?? '未命名工程'),
      author: String(data.author ?? ''),
      agentId: data.agentId,
      createdAt: String(data.createdAt ?? new Date().toISOString()),
      updatedAt: String(data.updatedAt ?? new Date().toISOString()),
      hasSnapshot: Boolean(data.hasSnapshot),
      hasBaseline: Boolean(data.hasBaseline),
      exportedDir: data.exportedDir,
      palette: data.palette,
      signature: data.signature,
      overrides: data.overrides,
    };
  } catch {
    return null;
  }
}

function writeProject(project: StudioProject): void {
  ensureDir();
  const dir = path.join(PROJECTS_DIR, project.id);
  // R6-1: 路径归属校验 — 防止 project.id 包含 ".." 或绝对路径导致写入
  // PROJECTS_DIR 之外的任意位置（如被 XSS 利用写入系统目录）。
  if (!dir.startsWith(`${PROJECTS_DIR}${path.sep}`))
    throw new Error('Invalid project id: path traversal detected');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'project.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  // On Windows, renameSync fails if target exists — delete first (best-effort).
  try {
    fs.unlinkSync(file);
  } catch {
    /* target doesn't exist — fine */
  }
  fs.renameSync(tmp, file);
}

function listProjects(): StudioProject[] {
  ensureDir();
  const out: StudioProject[] = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PROJECTS_DIR, entry.name, 'project.json');
    const p = readProjectFile(file);
    if (p) out.push(p);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

function slugify(s: string): string {
  // Produce a SAFE ASCII id that satisfies `isSafeThemeId` (lowercase
  // alphanumeric + `_`/`-`, must start alphanumeric). Non-ASCII characters
  // (e.g. CJK project names like "我的第一个工程") are stripped rather than
  // kept, so the derived id stays path-safe and passes the snapshot/delete
  // guards. The human-readable name stays in `project.name`; only the id is
  // slugified.
  const base = (s || 'studio')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'studio';
}

/** Derive a StudioProject from an `.agentskin-theme` (or `.agentskin-theme`) manifest.json. */
function projectFromManifest(manifest: Record<string, unknown>): StudioProject | null {
  const name = String(manifest.name ?? '');
  const author =
    typeof manifest.author === 'object' && manifest.author !== null
      ? String((manifest.author as { name?: unknown }).name ?? '')
      : String(manifest.author ?? '');
  const agentId = Array.isArray(manifest.supportedAgents)
    ? ((manifest.supportedAgents as unknown[]).find(isValidAgentId) ?? undefined)
    : undefined;
  if (!name || !agentId) return null;

  const palette = semanticColorsToPalette(manifest.colors as Record<string, unknown> | undefined);

  const now = new Date().toISOString();
  return {
    schema: PROJECT_SCHEMA,
    id: `${slugify(name)}-${randomUUID().slice(0, 8)}`,
    name,
    author,
    agentId,
    createdAt: now,
    updatedAt: now,
    hasSnapshot: false,
    palette: Object.keys(palette).length ? palette : undefined,
  };
}

function createDefaultProject(): StudioProject {
  ensureDir();
  const now = new Date().toISOString();
  const project: StudioProject = {
    schema: PROJECT_SCHEMA,
    id: `default-${randomUUID().slice(0, 8)}`,
    name: '我的第一个工程',
    author: '',
    // Keep in sync with the frontend's default `newAgent` ('traework') so the
    // auto-seeded project doesn't switch the user to a different agent than
    // the one pre-selected in the "new project" form.
    agentId: 'traework',
    createdAt: now,
    updatedAt: now,
    hasSnapshot: false,
  };
  writeProject(project);
  return project;
}

export function registerStudioProjectIpc(): void {
  ipcMain.handle(IpcChannel.STUDIO_PROJECT_LIST, (): StudioProject[] => {
    const list = listProjects();
    // Auto-seed a default project so entering Studio never shows an empty state.
    if (list.length === 0) {
      const def = createDefaultProject();
      return [def];
    }
    return list;
  });

  ipcMain.handle(
    IpcChannel.STUDIO_PROJECT_CREATE,
    (_event, req: { name?: unknown; author?: unknown; agentId?: unknown }): StudioProject => {
      const agentId = req.agentId;
      if (!isValidAgentId(agentId)) throw new Error('Invalid agentId');
      const name = String(req.name ?? '').trim() || '未命名工程';
      const now = new Date().toISOString();
      const project: StudioProject = {
        schema: PROJECT_SCHEMA,
        id: `${slugify(name)}-${randomUUID().slice(0, 8)}`,
        name,
        author: String(req.author ?? '').trim(),
        agentId,
        createdAt: now,
        updatedAt: now,
        hasSnapshot: false,
      };
      // Defensive: the id must always satisfy isSafeThemeId so downstream
      // snapshot save/load/delete guards accept it. If slugify ever regresses
      // (e.g. a non-ASCII id slips through), fail fast here instead of letting
      // a project be created that can never be saved/loaded/deleted.
      if (!isSafeThemeId(project.id)) throw new Error('Generated project id is not safe');
      writeProject(project);
      return project;
    },
  );

  ipcMain.handle(
    IpcChannel.STUDIO_PROJECT_SAVE,
    (_event, project: StudioProject): StudioProject => {
      if (project.schema !== PROJECT_SCHEMA || !isValidAgentId(project.agentId)) {
        throw new Error('Invalid project payload');
      }
      const next: StudioProject = {
        ...project,
        updatedAt: new Date().toISOString(),
      };
      writeProject(next);
      return next;
    },
  );

  ipcMain.handle(
    IpcChannel.STUDIO_PROJECT_DELETE,
    (_event, req: { id?: unknown }): { ok: boolean; error?: string } => {
      const id = String(req.id ?? '');
      // R6-1: 校验项目 ID 防止路径遍历攻击（如 "../../../../important-folder"）。
      // 项目 ID 格式为 `${slug}-${uuid8}`，由 ASCII 字母数字 + 连字符组成。
      if (!id || !isSafeThemeId(id)) return { ok: false, error: 'Invalid project ID' };
      const dir = path.join(PROJECTS_DIR, id);
      // 二次确认解析后的路径仍在 PROJECTS_DIR 内（防御符号链接等边缘情况）。
      if (!dir.startsWith(`${PROJECTS_DIR}${path.sep}`))
        return { ok: false, error: 'Path traversal blocked' };
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(IpcChannel.STUDIO_PROJECT_IMPORT, async (): Promise<StudioProject | null> => {
    const result = await dialog.showOpenDialog({
      title: uiMessages[getMainLocale()].studioImportProjectDialogTitle,
      message: uiMessages[getMainLocale()].studioImportProjectDialogMessage,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0];
    const asProject = readProjectFile(path.join(dir, 'project.json'));
    const project = asProject ?? projectFromManifest(readManifest(dir));
    if (!project) throw new Error(uiMessages[getMainLocale()].studioUnrecognizedProjectDir);
    // Persist a copy under a fresh id so imported projects live alongside others.
    const persisted: StudioProject = {
      ...project,
      id: `${slugify(project.name)}-${randomUUID().slice(0, 8)}`,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeProject(persisted);
    return persisted;
  });

  // The heavy real-DOM snapshot is stored separately from `project.json` so the
  // lightweight project metadata stays small; written atomically (tmp + rename).
  // `kind` selects which capture to store: 'current' (themed render, default)
  // or 'baseline' (native/un-themed) — persisted as snapshot.json / baseline.json.
  ipcMain.handle(
    IpcChannel.STUDIO_SNAPSHOT_SAVE,
    (
      _event,
      req: { projectId?: unknown; snapshot?: unknown; kind?: unknown },
    ): { ok: boolean; error?: string } => {
      const id = String(req.projectId ?? '');
      if (!id || !isSafeThemeId(id)) return { ok: false, error: 'Invalid project ID' };
      if (req.snapshot == null) return { ok: false, error: 'No snapshot data' };
      const kind = req.kind === 'baseline' ? 'baseline' : 'current';
      const dir = path.join(PROJECTS_DIR, id);
      // R6-1: 二次确认解析后的路径仍在 PROJECTS_DIR 内。
      if (!dir.startsWith(`${PROJECTS_DIR}${path.sep}`))
        return { ok: false, error: 'Path traversal blocked' };
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file =
          kind === 'baseline' ? path.join(dir, 'baseline.json') : path.join(dir, 'snapshot.json');
        const tmp = `${file}.tmp`;
        const serialized = JSON.stringify(req.snapshot);
        // Guard against excessively large snapshots that could cause OOM on load
        const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024; // 16 MiB
        if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
          return { ok: false, error: 'Snapshot data exceeds 16 MiB limit' };
        }
        fs.writeFileSync(tmp, serialized, 'utf8');
        // On Windows, renameSync fails if target exists — delete first.
        try {
          fs.unlinkSync(file);
        } catch {
          /* not exist — fine */
        }
        fs.renameSync(tmp, file);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.STUDIO_SNAPSHOT_LOAD,
    (_event, req: { projectId?: unknown; kind?: unknown }): ThemeVisualSnapshot | null => {
      const id = String(req.projectId ?? '');
      // R6-1: 校验项目 ID 防止路径遍历读取任意文件。
      if (!id || !isSafeThemeId(id)) return null;
      const kind = req.kind === 'baseline' ? 'baseline' : 'current';
      const file =
        kind === 'baseline'
          ? path.join(PROJECTS_DIR, id, 'baseline.json')
          : path.join(PROJECTS_DIR, id, 'snapshot.json');
      try {
        // TODO: type-guard — 待渐进式加固
        return JSON.parse(fs.readFileSync(file, 'utf8')) as ThemeVisualSnapshot;
      } catch {
        return null;
      }
    },
  );
}

function readManifest(dir: string): Record<string, unknown> {
  try {
    // TODO: type-guard — 待渐进式加固
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}
