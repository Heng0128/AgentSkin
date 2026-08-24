// SPDX-License-Identifier: MPL-2.0

/**
 * # project-store
 *
 * Studio project CRUD state: projects list, active project selection,
 * creation form, import, rename, inline editing.
 *
 * Extracted from the monolithic `studioStore.ts` as part of the
 * 5-store decomposition (P1-4 weight reduction).
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import type { AgentId, StudioProject } from '@shared/types';
import { create } from 'zustand';

/** Read current i18n message table (project-standard pattern). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export interface ProjectForm {
  name: string;
  author: string;
  agentId: AgentId;
}

export interface EditingState {
  id: string;
  name: string;
  author: string;
}

export interface ProjectState {
  // --- Core ---
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  projectForm: ProjectForm;
  importing: boolean;
  editing: EditingState | null;

  // --- Derived helper ---
  getActiveProject(): StudioProject | null;

  // --- Actions ---
  refreshProjects(): Promise<void>;
  selectProject(id: string | null): void;
  createProject(): Promise<void>;
  importProject(): Promise<void>;
  deleteProject(id: string): Promise<void>;
  renameProject(p: StudioProject, name: string, author: string): Promise<void>;
  saveActiveProject(patch: Partial<StudioProject>): Promise<void>;
  startEditing(id: string): void;
  cancelEditing(): void;
  updateEditingField(field: 'name' | 'author', value: string): void;
  setCreatingProject(v: boolean): void;
  setProjectName(name: string): void;
  setProjectAuthor(author: string): void;
  setProjectAgent(agentId: AgentId): void;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  activeProjectId: null,
  creatingProject: false,
  projectForm: { name: '', author: '', agentId: 'traework' },
  importing: false,
  editing: null,

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    return projects.find((p) => p.id === activeProjectId) ?? null;
  },

  refreshProjects: async () => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const list = await api.listStudioProjects();
      set({ projects: list, activeProjectId: get().activeProjectId ?? list[0]?.id ?? null });
    } catch (e) {
      showToast(currentT().studioLoadProjectsFailed(toMessage(e)), 'destructive');
    }
  },

  selectProject: (id) => {
    if (get().activeProjectId === id) return;
    set({ activeProjectId: id });
  },

  createProject: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const { projectForm } = get();
    const name = projectForm.name.trim() || '未命名工程';
    try {
      const p = await api.createStudioProject({
        name,
        author: projectForm.author.trim(),
        agentId: projectForm.agentId,
      });
      set((s) => ({
        projects: [p, ...s.projects],
        activeProjectId: p.id,
        projectForm: { name: '', author: '', agentId: s.projectForm.agentId },
        creatingProject: false,
      }));
    } catch (e) {
      showToast(currentT().studioCreateProjectFailed(toMessage(e)), 'destructive');
    }
  },

  importProject: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ importing: true });
    try {
      const p = await api.importStudioProject();
      if (p) {
        set((s) => ({
          projects: [p, ...s.projects.filter((x) => x.id !== p.id)],
          activeProjectId: p.id,
        }));
        showToast(currentT().studioImportProjectSuccess(p.name));
      }
    } catch (err) {
      showToast(currentT().studioImportProjectFailed(toMessage(err)), 'destructive');
    } finally {
      set({ importing: false });
    }
  },

  deleteProject: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      await api.deleteStudioProject(id);
      set((s) => {
        const next = s.projects.filter((p) => p.id !== id);
        return {
          projects: next,
          activeProjectId: s.activeProjectId === id ? (next[0]?.id ?? null) : s.activeProjectId,
        };
      });
    } catch (err) {
      showToast(currentT().studioDeleteProjectFailed(toMessage(err)), 'destructive');
    }
  },

  renameProject: async (p, name, author) => {
    const showToast = useNotificationStore.getState().showToast;
    const nameOut = name.trim() || p.name;
    const authorOut = author.trim();
    const prevName = p.name;
    const prevAuthor = p.author;
    const next: StudioProject = {
      ...p,
      name: nameOut,
      author: authorOut,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? next : x)) }));
    try {
      await api.saveStudioProject(next);
      showToast(currentT().studioProjectInfoSaved);
    } catch (e) {
      set((s) => ({
        projects: s.projects.map((x) =>
          x.id === p.id ? { ...x, name: prevName, author: prevAuthor } : x,
        ),
      }));
      showToast(currentT().studioRenameFailed(toMessage(e)), 'destructive');
    } finally {
      set({ editing: null });
    }
  },

  saveActiveProject: async (patch) => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const next = { ...project, ...patch, updatedAt: new Date().toISOString() };
    set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
    try {
      await api.saveStudioProject(next);
    } catch (e) {
      showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
    }
  },

  startEditing: (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    set({ editing: { id, name: project.name, author: project.author } });
  },

  cancelEditing: () => set({ editing: null }),

  updateEditingField: (field, value) => {
    set((s) => {
      if (!s.editing) return {};
      return { editing: { ...s.editing, [field]: value } };
    });
  },

  setCreatingProject: (v) => set({ creatingProject: v }),
  setProjectName: (name) => set((s) => ({ projectForm: { ...s.projectForm, name } })),
  setProjectAuthor: (author) => set((s) => ({ projectForm: { ...s.projectForm, author } })),
  setProjectAgent: (agentId) => set((s) => ({ projectForm: { ...s.projectForm, agentId } })),
}));
