// SPDX-License-Identifier: MPL-2.0

/**
 * # PetViewer
 *
 * Renders the active pet inside the floating pet BrowserWindow. The
 * component drives sprite-sheet animation, handles drag-to-move (reporting
 * the new position to petStore which forwards it to the main process), and
 * exposes a right-click context menu (hide / switch animation / exit).
 *
 * The component is intentionally small and self-contained — it lives in
 * a dedicated `pet.html` renderer that only mounts this component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePetStore } from '@/stores/petStore';

import type { PetAnimation, PetConfig } from '@shared/types/pet';

/** Standard Tailwind 4px-grid spacing values per C6 / design-tokens. */
const ANIMATION_FPS_MIN = 1;
const ANIMATION_FPS_MAX = 30;

/**
 * Resolve a frame path relative to the pet's spriteSheet base. In a real
 * build this resolves to a packaged asset URL; for the prototype the frames
 * are absolute or data URLs supplied by the pet config.
 */
function resolveFramePath(pet: PetConfig, frame: string): string {
  if (frame.startsWith('data:') || frame.startsWith('http') || frame.startsWith('/')) {
    return frame;
  }
  return `${pet.spriteSheet}/${frame}`;
}

export function PetViewer() {
  const getActivePet = usePetStore((s) => s.getActivePet);
  const setPosition = usePetStore((s) => s.setPosition);
  const setDragging = usePetStore((s) => s.setDragging);
  const playAnimation = usePetStore((s) => s.playAnimation);
  const toggleVisibility = usePetStore((s) => s.toggleVisibility);

  const pet = getActivePet();
  const runtime = usePetStore((s) => s.runtime);

  const [frameIndex, setFrameIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  // Pick the current animation, falling back to idle if the current name is
  // not found in the pet definition.
  const animation: PetAnimation | undefined = useMemo(() => {
    if (!pet) return undefined;
    return (
      pet.animations.find((a) => a.name === runtime.currentAnimation) ??
      pet.animations.find((a) => a.name === 'idle') ??
      pet.animations[0]
    );
  }, [pet, runtime.currentAnimation]);

  // Advance the frame index on a timer driven by the animation's fps.
  useEffect(() => {
    if (!animation || animation.frames.length === 0) return;
    const intervalMs =
      1000 / Math.max(ANIMATION_FPS_MIN, Math.min(ANIMATION_FPS_MAX, animation.fps));
    const id = window.setInterval(() => {
      setFrameIndex((i) => {
        const next = i + 1;
        if (next >= animation.frames.length) {
          return animation.loop ? 0 : i;
        }
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [animation]);

  // Drag handling — pointer events on the pet element report deltas.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (!pet) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        posX: runtime.position.x,
        posY: runtime.position.y,
      };
      setDragging(true);
    },
    [pet, runtime.position, setDragging],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const dx = Math.round(e.clientX - start.x);
      const dy = Math.round(e.clientY - start.y);
      setPosition({ x: start.posX + dx, y: start.posY + dy });
    },
    [setPosition],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      dragStart.current = null;
      setDragging(false);
    },
    [setDragging],
  );

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const switchAnimation = useCallback(
    (name: string) => {
      playAnimation(name);
      setFrameIndex(0);
      closeContextMenu();
    },
    [playAnimation, closeContextMenu],
  );

  // Close context menu on outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeContextMenu();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu, closeContextMenu]);

  if (!pet || !animation) {
    return (
      <div className="flex size-full items-center justify-center bg-transparent text-xs text-foreground/60">
        No pet active
      </div>
    );
  }

  const frameSrc =
    animation.frames.length > 0
      ? resolveFramePath(pet, animation.frames[frameIndex % animation.frames.length])
      : pet.thumbnail;

  return (
    <div
      className="relative size-full select-none bg-transparent"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      style={{ cursor: runtime.isDragging ? 'grabbing' : 'grab' }}
    >
      <img
        src={frameSrc}
        alt={pet.name}
        draggable={false}
        className="pointer-events-none size-full object-contain"
        style={{ imageRendering: 'auto' }}
      />

      {contextMenu && (
        <div
          className="absolute z-50 min-w-[120px] rounded-md border border-border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
            onClick={() => {
              switchAnimation('idle');
            }}
          >
            Idle
          </button>
          {pet.animations
            .filter((a) => a.name !== 'idle')
            .map((a) => (
              <button
                key={a.name}
                type="button"
                className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => switchAnimation(a.name)}
              >
                {a.name}
              </button>
            ))}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
            onClick={() => {
              toggleVisibility();
              closeContextMenu();
            }}
          >
            Hide
          </button>
        </div>
      )}
    </div>
  );
}
