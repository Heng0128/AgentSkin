// SPDX-License-Identifier: MPL-2.0

/**
 * # petStore
 *
 * State store for the AgentSkin Desktop Pet system — a floating desktop
 * companion that runs in its own transparent, frameless, always-on-top
 * BrowserWindow. This store owns: the list of installed pets, the active
 * pet, visibility, position (memory-persisted), and the current animation.
 *
 * Persistence is via localStorage (mirrors settingsStore / shellStore):
 *   - position survives reload so the pet returns to where the user left it
 *   - active pet + visibility restore on next session
 *
 * All mutations update state optimistically then persist quietly —
 * localStorage quota / parse errors never throw so the UI stays responsive.
 */

import { api } from '@/api/agentSkinClient';

import type { PetConfig, PetMoveRequest, PetRuntimeState } from '@shared/types/pet';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY_INSTALLED = 'agentskin.pet.installed';
const STORAGE_KEY_RUNTIME = 'agentskin.pet.runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function loadInstalled(): PetConfig[] {
  return safeParse<PetConfig[]>(window.localStorage.getItem(STORAGE_KEY_INSTALLED), []);
}

function loadRuntime(): PetRuntimeState {
  return safeParse<PetRuntimeState>(window.localStorage.getItem(STORAGE_KEY_RUNTIME), {
    activePetId: null,
    position: { x: 80, y: 80 },
    isDragging: false,
    currentAnimation: 'idle',
    isVisible: false,
  });
}

function persistInstalled(pets: PetConfig[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_INSTALLED, JSON.stringify(pets));
  } catch {
    /* quota exceeded — degrade to in-session only */
  }
}

function persistRuntime(runtime: PetRuntimeState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_RUNTIME, JSON.stringify(runtime));
  } catch {
    /* quota exceeded — degrade to in-session only */
  }
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface PetState {
  /** List of installed pet definitions. */
  installedPets: PetConfig[];
  /** Runtime state (active pet, position, visibility, animation). */
  runtime: PetRuntimeState;

  // --- queries ---
  /** Resolve the currently active pet definition, or null. */
  getActivePet: () => PetConfig | null;

  // --- commands ---
  /** Install a new pet (appends to installedPets). Returns true on success. */
  installPet: (pet: PetConfig) => void;
  /** Uninstall a pet by id. Clears activePetId if it was the removed pet. */
  uninstallPet: (petId: string) => void;
  /** Set the active pet (shows the pet window). */
  setActivePet: (petId: string | null) => void;
  /** Update the pet's persisted position (called on drag end). */
  setPosition: (position: { x: number; y: number }) => void;
  /** Toggle visibility of the pet window. */
  toggleVisibility: () => void;
  /** Update visibility explicitly. */
  setVisibility: (visible: boolean) => void;
  /** Switch the currently playing animation. */
  playAnimation: (animationName: string) => void;
  /** Mark the pet as being dragged. */
  setDragging: (dragging: boolean) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialRuntime = loadRuntime();
const initialInstalled = loadInstalled();

export const usePetStore = create<PetState>((set, get) => ({
  installedPets: initialInstalled,
  runtime: initialRuntime,

  getActivePet: () => {
    const { installedPets, runtime } = get();
    if (!runtime.activePetId) return null;
    return installedPets.find((p) => p.id === runtime.activePetId) ?? null;
  },

  installPet: (pet) => {
    const { installedPets } = get();
    if (installedPets.some((p) => p.id === pet.id)) return;
    const next = [...installedPets, pet];
    persistInstalled(next);
    set({ installedPets: next });
  },

  uninstallPet: (petId) => {
    const { installedPets, runtime } = get();
    const next = installedPets.filter((p) => p.id !== petId);
    persistInstalled(next);
    const runtimeNext: PetRuntimeState =
      runtime.activePetId === petId ? { ...runtime, activePetId: null, isVisible: false } : runtime;
    persistRuntime(runtimeNext);
    set({ installedPets: next, runtime: runtimeNext });
  },

  setActivePet: (petId) => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, activePetId: petId, isVisible: petId !== null };
    persistRuntime(next);
    set({ runtime: next });
    if (petId) {
      void api.petShow(petId);
    } else {
      void api.petHide();
    }
  },

  setPosition: (position) => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, position };
    persistRuntime(next);
    set({ runtime: next });
    const req: PetMoveRequest = { x: position.x, y: position.y };
    void api.petMove(req);
  },

  toggleVisibility: () => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, isVisible: !runtime.isVisible };
    persistRuntime(next);
    set({ runtime: next });
    if (next.isVisible) {
      void api.petShow(next.activePetId ?? '');
    } else {
      void api.petHide();
    }
  },

  setVisibility: (visible) => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, isVisible: visible };
    persistRuntime(next);
    set({ runtime: next });
    if (visible) {
      void api.petShow(next.activePetId ?? '');
    } else {
      void api.petHide();
    }
  },

  playAnimation: (animationName) => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, currentAnimation: animationName };
    persistRuntime(next);
    set({ runtime: next });
  },

  setDragging: (dragging) => {
    const { runtime } = get();
    const next: PetRuntimeState = { ...runtime, isDragging: dragging };
    set({ runtime: next });
  },
}));

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export const selectActivePet = (s: PetState): PetConfig | null => {
  if (!s.runtime.activePetId) return null;
  return s.installedPets.find((p) => p.id === s.runtime.activePetId) ?? null;
};

// ---------------------------------------------------------------------------
// Test reset helper
// ---------------------------------------------------------------------------

export function resetPetStore(): void {
  usePetStore.setState({
    installedPets: [],
    runtime: {
      activePetId: null,
      position: { x: 80, y: 80 },
      isDragging: false,
      currentAnimation: 'idle',
      isVisible: false,
    },
  });
}
