// SPDX-License-Identifier: MPL-2.0

/**
 * # DeviceFrame
 *
 * Reusable device viewport frame component for PreviewWindow.
 *
 * Simulates common desktop monitor resolutions via CSS `transform: scale()`,
 * without modifying the actual iframe content. An optional monitor-like shell
 * (bezel + stand) can be toggled on for presentation contexts.
 *
 * Only desktop resolutions are supported — desktop agents produce domTree
 * snapshots that would render misleadingly in a tablet/mobile chassis.
 *
 * Exports:
 *   · DeviceFrame      — visual wrapper component
 *   · useResolutionPreset — hook managing active preset + frame visibility
 *   · RESOLUTION_PRESETS  — constant map of supported resolutions
 *   · DesktopResolution   — union type of preset keys
 */

import { useState } from 'react';

// ─── Types & Constants ─────────────────────────────────────────────────────

export type DesktopResolution = '1280x720' | '1440x900' | '1920x1080' | '2560x1440';

export const RESOLUTION_PRESETS: Record<
  DesktopResolution,
  { width: number; height: number; label: string }
> = {
  '1280x720': { width: 1280, height: 720, label: 'HD (1280×720)' },
  '1440x900': { width: 1440, height: 900, label: 'WXGA+ (1440×900)' },
  '1920x1080': { width: 1920, height: 1080, label: 'FHD (1920×1080)' },
  '2560x1440': { width: 2560, height: 1440, label: 'QHD (2560×1440)' },
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DeviceFrameProps {
  /** Content rendered inside the frame (typically an iframe). */
  children: React.ReactNode;
  /** Resolution preset key. */
  preset: DesktopResolution;
  /** Whether to render the outer monitor-like shell. */
  showFrame?: boolean;
  /** Visual scale factor applied via CSS transform. */
  scale: number;
  /** Optional className for the root wrapper. */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DeviceFrame({
  children,
  preset,
  showFrame = false,
  scale,
  className = '',
}: DeviceFrameProps) {
  const { width, height, label } = RESOLUTION_PRESETS[preset];

  // Computed scaled dimensions for the scroll wrapper.
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  if (showFrame) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        {/* Monitor shell */}
        <div className="flex flex-col items-center">
          {/* Bezel */}
          <div className="rounded-lg border-2 border-border bg-muted p-2 shadow-lg">
            {/* Screen area */}
            <div
              className="overflow-hidden rounded-sm border border-border bg-background"
              style={{
                width: `${scaledWidth}px`,
                height: `${scaledHeight}px`,
              }}
            >
              <div
                style={{
                  width: `${width}px`,
                  height: `${height}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {children}
              </div>
            </div>
          </div>
          {/* Stand neck */}
          <div className="h-4 w-8 bg-muted" />
          {/* Stand base — trapezoid-ish via clip-path */}
          <div
            className="h-2 w-24 rounded-b-sm bg-muted"
            style={{ clipPath: 'polygon(10% 0, 90% 0, 100% 100%, 0 100%)' }}
          />
        </div>
        {/* Resolution label */}
        <span className="mt-2 text-[10px] text-muted-foreground">{label}</span>
      </div>
    );
  }

  // Plain mode — no outer shell.
  return (
    <div className={className}>
      <div
        className="overflow-hidden"
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        }}
      >
        <div
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
      {/* Resolution label */}
      <span className="mt-1 block text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useResolutionPreset(defaultPreset: DesktopResolution = '1920x1080') {
  const [preset, setPreset] = useState<DesktopResolution>(defaultPreset);
  const [showFrame, setShowFrame] = useState(false);
  return { preset, setPreset, showFrame, setShowFrame };
}
