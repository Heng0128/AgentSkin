// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from 'react';
import type { WallpaperInfo } from '@shared/types';

/**
 * # DynamicBackground
 *
 * Renders the selected Wallpaper Engine video as a full-bleed animated backdrop
 * behind the app UI. A tinted scrim (using the app background color) sits over
 * the video to keep foreground text and surfaces readable while letting the
 * motion show through the frosted sidebar and around opaque cards.
 *
 * The element is `pointer-events-none` and sits at z-0; the app content is
 * layered above it (z-10) with a transparent container background when a
 * wallpaper is active.
 *
 * Performance: playback pauses when the window loses focus or the document
 * becomes hidden (e.g. Alt-Tab, minimize), and resumes automatically on return.
 */
export function DynamicBackground({ wallpaper }: { wallpaper: WallpaperInfo | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pause/resume on visibility change and window blur/focus.
  useEffect(() => {
    if (!wallpaper) return;

    const pause = () => videoRef.current?.pause();
    const resume = () => {
      // Only resume if the document is visible AND the window is focused.
      if (!document.hidden && document.hasFocus()) {
        void videoRef.current?.play().catch(() => {});
      }
    };

    const onVisibility = () => (document.hidden ? pause() : resume());
    const onBlur = () => pause();
    const onFocus = () => resume();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [wallpaper]);

  if (!wallpaper) return null;

  const isImage = wallpaper.type === 'image';

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-background">
      {isImage ? (
        <img
          key={wallpaper.id}
          src={wallpaper.videoUrl ?? undefined}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          key={wallpaper.id}
          src={wallpaper.videoUrl ?? undefined}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* Readability scrim tinted with the app background color.
          Opacity is centralized in a CSS variable so themes can tune how
          much of the wallpaper motion punches through without editing this
          component. */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--background) 55%, transparent)' }}
      />
      {/* Gentle top/bottom vignette for depth */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--background) 40%, transparent) 0%, transparent 50%, color-mix(in srgb, var(--background) 50%, transparent) 100%)',
        }}
      />
    </div>
  );
}
