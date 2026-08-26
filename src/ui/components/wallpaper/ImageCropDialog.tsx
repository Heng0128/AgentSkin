// SPDX-License-Identifier: MPL-2.0

/**
 * # ImageCropDialog
 *
 * Reusable image cropping dialog with drag-to-position, zoom slider,
 * and fixed-aspect crop frame. Outputs a full-resolution cropped image
 * plus a 400x400 preview, both as JPEG data URLs.
 *
 * Built on the Canvas API — no third-party dependencies.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface ImageCropDialogProps {
  imageSrc: string;
  open: boolean;
  onSave: (croppedDataUrl: string, previewDataUrl: string) => void;
  onCancel: () => void;
  cropSize?: number;
  aspectRatio?: number;
}

const DEFAULT_CROP_SIZE = 300;
const DEFAULT_ASPECT_RATIO = 1;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2.0;
const PREVIEW_SIZE = 400;
const JPEG_QUALITY = 0.92;

export function ImageCropDialog({
  imageSrc,
  open,
  onSave,
  onCancel,
  cropSize = DEFAULT_CROP_SIZE,
  aspectRatio = DEFAULT_ASPECT_RATIO,
}: ImageCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  // Derived crop dimensions from aspect ratio
  const cropW = cropSize;
  const cropH = cropSize / aspectRatio;

  // Display canvas size (scaled for viewport)
  const displaySize = Math.min(cropSize, 320);
  const displayW = displaySize;
  const displayH = displaySize / aspectRatio;

  // Reset state when dialog opens with a new image
  useEffect(() => {
    if (!open) {
      setLoaded(false);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setLoaded(true);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => {
      imageRef.current = null;
      setLoaded(false);
    };
    img.src = imageSrc;
  }, [open, imageSrc]);

  // Draw the crop preview on canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !loaded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = displayW;
    canvas.height = displayH;

    ctx.clearRect(0, 0, displayW, displayH);

    // Draw the image scaled and positioned
    const imgW = img.naturalWidth * scale;
    const imgH = img.naturalHeight * scale;
    const x = offset.x + (displayW - imgW) / 2;
    const y = offset.y + (displayH - imgH) / 2;

    ctx.drawImage(img, x, y, imgW, imgH);
  }, [loaded, scale, offset, displayW, displayH]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Mouse drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // Touch drag handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    draggingRef.current = true;
    lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!draggingRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - lastPosRef.current.x;
    const dy = e.touches[0].clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleTouchEnd = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // ESC key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  // Produce cropped output
  const handleSave = useCallback(() => {
    const img = imageRef.current;
    if (!img || !loaded) return;

    // Render at full crop resolution
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = cropW;
    fullCanvas.height = cropH;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) return;

    // Map display-space offset to full-resolution space
    const scaleX = cropW / displayW;
    const scaleY = cropH / displayH;
    const imgW = img.naturalWidth * scale * scaleX;
    const imgH = img.naturalHeight * scale * scaleY;
    const x = offset.x * scaleX + (cropW - imgW) / 2;
    const y = offset.y * scaleY + (cropH - imgH) / 2;

    fullCtx.drawImage(img, x, y, imgW, imgH);
    const croppedDataUrl = fullCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

    // Render preview at 400x400
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = PREVIEW_SIZE;
    previewCanvas.height = PREVIEW_SIZE;
    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return;

    // Center-crop the full output into a square preview
    const minDim = Math.min(cropW, cropH);
    const sx = (cropW - minDim) / 2;
    const sy = (cropH - minDim) / 2;
    previewCtx.drawImage(fullCanvas, sx, sy, minDim, minDim, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const previewDataUrl = previewCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

    onSave(croppedDataUrl, previewDataUrl);
  }, [loaded, scale, offset, cropW, cropH, displayW, displayH, onSave]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: modal overlay — a <button> element would interfere with focus management and form semantics inside the dialog.
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/40 animate-in fade-in duration-base"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      role="button"
      tabIndex={0}
      aria-label="Cancel"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — prevents background close when clicking inside the dialog content. No keyboard equivalent needed. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only — no keyboard action needed. */}
      <div
        className="w-[420px] rounded-lg border border-border bg-card p-5 shadow-float animate-page-enter duration-base"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium">Crop Image</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Drag to position. Use the slider to zoom.
        </p>

        {/* Crop canvas area */}
        <div className="mt-4 flex items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md border border-border bg-secondary"
            style={{ width: displayW, height: displayH }}
          >
            <canvas
              ref={canvasRef}
              className="cursor-grab active:cursor-grabbing"
              style={{ width: displayW, height: displayH }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
            {/* Crop frame overlay */}
            <div className="as-crop-mask pointer-events-none absolute inset-0 border-2 border-primary/60" />
          </div>
        </div>

        {/* Zoom slider */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">10%</span>
          <input
            type="range"
            min={MIN_SCALE * 100}
            max={MAX_SCALE * 100}
            value={scale * 100}
            onChange={(e) => setScale(Number(e.target.value) / 100)}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary"
            aria-label="Zoom scale"
          />
          <span className="text-[11px] text-muted-foreground">200%</span>
          <span className="w-10 text-right font-mono text-[11px] tabular-nums text-foreground">
            {Math.round(scale * 100)}%
          </span>
        </div>

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!loaded}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
