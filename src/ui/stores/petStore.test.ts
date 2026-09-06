// SPDX-License-Identifier: MPL-2.0

/**
 * # petStore tests
 *
 * Covers the pet store: install/uninstall, setActivePet, setPosition,
 * toggleVisibility, playAnimation, localStorage persistence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPetShow = vi.fn();
const mockPetHide = vi.fn();
const mockPetMove = vi.fn();
const mockPetSet = vi.fn();

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    petShow: (...args: unknown[]) => mockPetShow(...args),
    petHide: () => mockPetHide(),
    petMove: (...args: unknown[]) => mockPetMove(...args),
    petSet: (...args: unknown[]) => mockPetSet(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { PetConfig } from '@shared/types/pet';
import { resetPetStore, usePetStore } from './petStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePet: PetConfig = {
  id: 'miku-floating',
  name: 'Miku Float',
  description: 'A gentle floating companion',
  thumbnail: '/pets/miku/thumbnail.png',
  spriteSheet: '/pets/miku',
  width: 120,
  height: 120,
  animations: [
    { name: 'idle', frames: ['idle_0.png', 'idle_1.png'], fps: 4, loop: true },
    { name: 'hover', frames: ['hover_0.png', 'hover_1.png'], fps: 8, loop: true },
    { name: 'drag', frames: ['drag_0.png'], fps: 1, loop: true },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('petStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetPetStore();
  });

  // -----------------------------------------------------------------------
  // installPet
  // -----------------------------------------------------------------------

  describe('installPet', () => {
    it('adds a new pet to installedPets', () => {
      usePetStore.getState().installPet(samplePet);
      expect(usePetStore.getState().installedPets).toHaveLength(1);
      expect(usePetStore.getState().installedPets[0].id).toBe('miku-floating');
    });

    it('does not add a pet with a duplicate id', () => {
      usePetStore.getState().installPet(samplePet);
      usePetStore.getState().installPet(samplePet);
      expect(usePetStore.getState().installedPets).toHaveLength(1);
    });

    it('persists installed pets to localStorage', () => {
      usePetStore.getState().installPet(samplePet);
      const raw = window.localStorage.getItem('agentskin.pet.installed');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw ?? '[]');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('miku-floating');
    });
  });

  // -----------------------------------------------------------------------
  // uninstallPet
  // -----------------------------------------------------------------------

  describe('uninstallPet', () => {
    beforeEach(() => {
      usePetStore.getState().installPet(samplePet);
    });

    it('removes an installed pet', () => {
      usePetStore.getState().uninstallPet('miku-floating');
      expect(usePetStore.getState().installedPets).toHaveLength(0);
    });

    it('clears activePetId when the active pet is removed', () => {
      usePetStore.getState().setActivePet('miku-floating');
      expect(usePetStore.getState().runtime.activePetId).toBe('miku-floating');
      usePetStore.getState().uninstallPet('miku-floating');
      expect(usePetStore.getState().runtime.activePetId).toBeNull();
      expect(usePetStore.getState().runtime.isVisible).toBe(false);
    });

    it('does not affect other pets when removing non-active one', () => {
      const otherPet: PetConfig = {
        ...samplePet,
        id: 'other-pet',
        name: 'Other',
      };
      usePetStore.getState().installPet(otherPet);
      usePetStore.getState().setActivePet('other-pet');
      usePetStore.getState().uninstallPet('miku-floating');
      expect(usePetStore.getState().runtime.activePetId).toBe('other-pet');
      expect(usePetStore.getState().installedPets).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // setActivePet
  // -----------------------------------------------------------------------

  describe('setActivePet', () => {
    beforeEach(() => {
      usePetStore.getState().installPet(samplePet);
    });

    it('sets activePetId and marks the pet visible', () => {
      usePetStore.getState().setActivePet('miku-floating');
      const { runtime } = usePetStore.getState();
      expect(runtime.activePetId).toBe('miku-floating');
      expect(runtime.isVisible).toBe(true);
    });

    it('calls api.petShow with the pet id', () => {
      usePetStore.getState().setActivePet('miku-floating');
      expect(mockPetShow).toHaveBeenCalledWith('miku-floating');
    });

    it('clears activePetId and hides when set to null', () => {
      usePetStore.getState().setActivePet('miku-floating');
      usePetStore.getState().setActivePet(null);
      const { runtime } = usePetStore.getState();
      expect(runtime.activePetId).toBeNull();
      expect(runtime.isVisible).toBe(false);
      expect(mockPetHide).toHaveBeenCalled();
    });

    it('persists runtime to localStorage', () => {
      usePetStore.getState().setActivePet('miku-floating');
      const raw = window.localStorage.getItem('agentskin.pet.runtime');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.activePetId).toBe('miku-floating');
      expect(parsed.isVisible).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // setPosition
  // -----------------------------------------------------------------------

  describe('setPosition', () => {
    it('updates runtime position', () => {
      usePetStore.getState().setPosition({ x: 200, y: 300 });
      expect(usePetStore.getState().runtime.position).toEqual({ x: 200, y: 300 });
    });

    it('calls api.petMove with the new position', () => {
      usePetStore.getState().setPosition({ x: 200, y: 300 });
      expect(mockPetMove).toHaveBeenCalledWith({ x: 200, y: 300 });
    });

    it('persists position to localStorage', () => {
      usePetStore.getState().setPosition({ x: 100, y: 150 });
      const raw = window.localStorage.getItem('agentskin.pet.runtime');
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.position).toEqual({ x: 100, y: 150 });
    });
  });

  // -----------------------------------------------------------------------
  // toggleVisibility
  // -----------------------------------------------------------------------

  describe('toggleVisibility', () => {
    beforeEach(() => {
      usePetStore.getState().installPet(samplePet);
      usePetStore.getState().setActivePet('miku-floating');
    });

    it('toggles isVisible from true to false', () => {
      expect(usePetStore.getState().runtime.isVisible).toBe(true);
      usePetStore.getState().toggleVisibility();
      expect(usePetStore.getState().runtime.isVisible).toBe(false);
    });

    it('calls api.petHide when toggled to hidden', () => {
      usePetStore.getState().toggleVisibility();
      expect(mockPetHide).toHaveBeenCalled();
    });

    it('calls api.petShow when toggled to visible', () => {
      usePetStore.getState().toggleVisibility();
      mockPetShow.mockClear();
      usePetStore.getState().toggleVisibility();
      expect(mockPetShow).toHaveBeenCalledWith('miku-floating');
    });
  });

  // -----------------------------------------------------------------------
  // playAnimation
  // -----------------------------------------------------------------------

  describe('playAnimation', () => {
    it('updates the current animation name', () => {
      usePetStore.getState().playAnimation('hover');
      expect(usePetStore.getState().runtime.currentAnimation).toBe('hover');
    });

    it('persists the animation change', () => {
      usePetStore.getState().playAnimation('drag');
      const raw = window.localStorage.getItem('agentskin.pet.runtime');
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.currentAnimation).toBe('drag');
    });
  });

  // -----------------------------------------------------------------------
  // getActivePet
  // -----------------------------------------------------------------------

  describe('getActivePet', () => {
    it('returns null when no pet is active', () => {
      expect(usePetStore.getState().getActivePet()).toBeNull();
    });

    it('returns the active pet definition', () => {
      usePetStore.getState().installPet(samplePet);
      usePetStore.getState().setActivePet('miku-floating');
      const active = usePetStore.getState().getActivePet();
      expect(active).not.toBeNull();
      expect(active?.id).toBe('miku-floating');
    });

    it('returns null when the active pet id is not found', () => {
      setActivePetWithoutInstall('ghost-pet');
      expect(usePetStore.getState().getActivePet()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // setDragging
  // -----------------------------------------------------------------------

  describe('setDragging', () => {
    it('sets isDragging to true', () => {
      usePetStore.getState().setDragging(true);
      expect(usePetStore.getState().runtime.isDragging).toBe(true);
    });

    it('sets isDragging to false', () => {
      usePetStore.getState().setDragging(true);
      usePetStore.getState().setDragging(false);
      expect(usePetStore.getState().runtime.isDragging).toBe(false);
    });
  });
});

// Helper: bypass install step and directly set the active pet id in state
// (simulates a sync edge case where the pet was removed from the list but
// the runtime reference lingers).
function setActivePetWithoutInstall(petId: string) {
  usePetStore.setState((s) => ({
    runtime: { ...s.runtime, activePetId: petId, isVisible: true },
  }));
}
