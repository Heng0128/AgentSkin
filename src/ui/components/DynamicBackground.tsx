// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// P1 perf: rAF batching flag for mousemove-driven parallax. Shared across
// mounts so concurrent effects don't each schedule a separate frame. The
// actual rAF schedule lives inline in the effect (see flushFrame closure).
let _dbRafPending = false;

import {
  buildFilter,
  buildFlipTransform,
  buildIframeElementStyle,
  buildMediaElementStyle,
} from '@/lib/wallpaperRender';
import { useWallpaperVideoUrl, useWallpaperWebUrl } from '@/lib/wallpaperVideo';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import type { WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { VolumeX } from 'lucide-react';
import { ParticleOverlay } from './wallpaper/ParticleOverlay';

/**
 * # DynamicBackground
 *
 * Renders the selected Wallpaper Engine wallpaper as a full-bleed animated
 * backdrop behind the app UI. A tinted scrim (using the app background color)
 * sits over the wallpaper to keep foreground text and surfaces readable while
 * letting the motion show through the frosted sidebar and around opaque cards.
 *
 * The element is `pointer-events-none` and sits at z-0; the app content is
 * layered above it (z-10) with a transparent container background when a
 * wallpaper is active.
 *
 * ## Rendering by playback kind (mirrors the CDP wallpaper injectors)
 *  - `video` — plays via `<video>`, falling back to the still preview image
 *    when the clip can't be decoded. Honors `render.speed` / `render.loop`.
 *  - `gif` — animates via `<img>` (a `<video>` element can't play GIFs).
 *  - `image` — shows the media; `render.alignment`/position/flip/filter apply,
 *    and `tile` renders via CSS background-repeat like the agent injector.
 *  - `scene` / `web` — renders the SAME loopback iframe renderer that gets
 *    injected into agent windows (`wallpaperWebUrl`), so the desktop UI
 *    background matches the agent window exactly — not just a still preview.
 *    flip/filter apply to the iframe itself, and pointer positions are
 *    forwarded into the scene renderer so its internal parallax responds to
 *    the mouse just like in agent windows.
 *
 * ## Render options (global defaults, `controller.wallpaper.render`)
 * Alignment / position / flip / filter / speed are applied here exactly as in
 * the CDP injectors (see `ui/lib/wallpaperRender.ts` — the renderer-side twin
 * of `main/cdp/wallpaper/shared.ts`), so "同一个壁纸在桌面 UI 和 agent 窗口
 * 效果一致". Mouse parallax translates the wallpaper layer (image/video) or
 * forwards pointer coords to the scene renderer (scene/web).
 *
 * Performance: playback pauses when the window loses focus or the document
 * becomes hidden (e.g. Alt-Tab, minimize), and resumes automatically on return.
 */
export function DynamicBackground({
  wallpaper,
  render,
}: {
  wallpaper: WallpaperInfo | null;
  render?: WallpaperRenderOptions;
}) {
  // i18n accessor — follows the project-standard `uiMessages[locale]` pattern
  // derived from shellStore.locale (see WorkspacePage / settingsStore).
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const videoRef = useRef<HTMLVideoElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);
  const webFrameRef = useRef<HTMLIFrameElement>(null);
  // Streaming loopback URL for the active wallpaper's media (video/gif only).
  const wantsMedia = wallpaper
    ? wallpaper.playback === 'video' || wallpaper.playback === 'gif'
    : false;
  const video = useWallpaperVideoUrl(wantsMedia ? (wallpaper?.id ?? null) : null);
  // Loopback renderer URL for scene/web wallpapers (same iframe as agents).
  const wantsWeb = wallpaper ? wallpaper.type === 'web' || wallpaper.type === 'scene' : false;
  const web = useWallpaperWebUrl(wantsWeb ? (wallpaper?.id ?? null) : null);
  // Records which wallpaper id failed to play, so switching wallpapers clears
  // the failure automatically (no reset effect needed).
  const [failedId, setFailedId] = useState<string | null>(null);
  const videoFailed = wallpaper != null && failedId === wallpaper.id;

  // Playback rate: React doesn't expose `playbackRate` as a DOM prop, so it's
  // applied via a callback ref. Stable while `render.speed` is unchanged; a
  // speed change gives the ref a new identity → React detaches/reattaches →
  // the rate is re-applied to the live element.
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el) el.playbackRate = render?.speed ?? 1;
    },
    [render?.speed],
  );

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

  // Mouse parallax — image/video: translate the wallpaper layer opposite the
  // cursor (same math as buildParallaxJs in the CDP injectors: scale(1.1) +
  // MAX_OFFSET 40px × strength, so no exposed edges).
  const layerParallax =
    wallpaper != null &&
    wallpaper.type !== 'web' &&
    wallpaper.type !== 'scene' &&
    (render?.parallax ?? 0) > 0;
  // Mouse parallax — scene/web: the iframe is pointer-events:none (it sits
  // behind the app UI), so it never receives mousemove itself. Forward
  // normalized pointer coords via postMessage — the scene renderer's message
  // listener (same one the CDP agent bridge uses) drives its internal parallax.
  const iframeParallax =
    wallpaper != null &&
    (wallpaper.type === 'web' || wallpaper.type === 'scene') &&
    web.url != null &&
    (render?.parallax ?? 0) > 0;
  const needsParallax = layerParallax || iframeParallax;
  useEffect(() => {
    if (!needsParallax) return;
    const el = parallaxRef.current;
    const strength = Math.min(1, Math.max(0, (render?.parallax ?? 0) / 100));
    const MAX_OFFSET = 40;
    // P1 perf: single mousemove listener with rAF batching replaces two
    // separate listeners that both wrote styles on every frame. The latest
    // pointer snapshot is read once per frame, eliminating redundant writes.
    let latestX = 0;
    let latestY = 0;
    let hasLatest = false;
    let targetOrigin = window.location.origin;
    try {
      targetOrigin = web.url ? new URL(web.url).origin : window.location.origin;
    } catch {
      // Malformed URL — fall back to this window's origin.
    }
    const flushFrame = () => {
      if (!hasLatest) return;
      // Layer parallax: translate the wallpaper layer opposite the cursor
      if (layerParallax && el) {
        el.style.transform = `scale(1.1) translate(${(-latestX * strength * MAX_OFFSET).toFixed(2)}px, ${(-latestY * strength * MAX_OFFSET).toFixed(2)}px)`;
      }
      // Iframe parallax: forward normalized pointer via postMessage
      if (iframeParallax) {
        const frame = webFrameRef.current;
        if (frame?.contentWindow) {
          try {
            frame.contentWindow.postMessage(
              {
                __agentskin: true,
                type: 'pointer',
                data: { x: latestX, y: latestY },
              },
              targetOrigin,
            );
          } catch {
            // Cross-origin posting blocked — parallax silently degrades.
          }
        }
      }
    };
    const onMove = (e: MouseEvent) => {
      // Normalize to [-1, 1] range (centered)
      latestX = (e.clientX / (window.innerWidth || 1) - 0.5) * 2;
      latestY = (e.clientY / (window.innerHeight || 1) - 0.5) * 2;
      hasLatest = true;
      // Coalesce into a single rAF callback per frame
      if (!_dbRafPending) {
        _dbRafPending = true;
        requestAnimationFrame(() => {
          _dbRafPending = false;
          flushFrame();
        });
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      // Reset rAF state for the next mount
      _dbRafPending = false;
    };
  }, [needsParallax, layerParallax, iframeParallax, render?.parallax, web.url]);

  // Media-element style from global render options (object-fit/position,
  // flip/filter; defaults match history: cover + centered + no transforms).
  // P2 perf: memoized so wallpapers don't rebuild these three style objects
  // on every render — they only change when the render options do.
  // (Hooks must run before the early return below to satisfy Rules of Hooks.)
  const mediaStyle = useMemo(() => buildMediaElementStyle(render), [render]);
  const alignment = render?.alignment;
  const flip = useMemo(() => buildFlipTransform(render ?? {}), [render]);
  const filter = useMemo(() => buildFilter(render ?? {}), [render]);

  if (!wallpaper) return null;

  const isSceneOrWeb = wallpaper.type === 'web' || wallpaper.type === 'scene';
  const tileImage = wallpaper.type === 'image' && alignment === 'tile';
  const loopVideo = render?.loop ?? true;

  // I-12 / I-15: scrim + vignette opacities are no longer hardcoded. The scrim
  // opacity is driven by `render.scrimOpacity` (theme-controllable, fallback
  // 55 preserves the historical default). The vignette top/bottom stops are
  // scaled proportionally from the same base so the depth effect tracks the
  // thematic scrim instead of stacking an independent 40%/50% on top of tint.
  const scrimOpacity = render?.scrimOpacity ?? 55;
  const vignetteTop = Math.round((scrimOpacity / 55) * 40);
  const vignetteBottom = Math.round((scrimOpacity / 55) * 50);

  // I-14: desktop video is always muted (Electron autoplay policy), so the
  // `audioLevel` reactivity requested in render has no audible effect here.
  // Surface that to the user via a muted-speaker hint when they have enabled
  // audio reactivity (audioLevel > 0) on a playing video wallpaper.
  const showMutedHint =
    wallpaper.playback === 'video' &&
    video.url != null &&
    !videoFailed &&
    (render?.audioLevel ?? 0) > 0;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[var(--z-bg)] overflow-hidden bg-background"
    >
      <div
        ref={parallaxRef}
        className="absolute inset-0 size-full will-change-transform"
        style={layerParallax ? { transform: 'scale(1.1)' } : undefined}
      >
        {isSceneOrWeb && web.url ? (
          // Scene/web: the same loopback iframe renderer used in agent windows,
          // so the desktop background shows the real animated content.
          <iframe
            key={wallpaper.id}
            ref={webFrameRef}
            src={web.url}
            title={wallpaper.title}
            className="absolute inset-0 size-full border-0"
            style={buildIframeElementStyle(render)}
            // Sandbox the iframe: the loopback URL maps to wallpaper-rendered
            // HTML from the Sucrose engine or WE scene exports. Restrict to
            // scripts + presentation to prevent any wallpaper code from
            // accessing cookies, storage, or navigating the host frame.
            sandbox="allow-scripts allow-presentation"
          />
        ) : wallpaper.playback === 'video' && video.url && !videoFailed ? (
          <video
            ref={setVideoRef}
            key={wallpaper.id}
            src={video.url}
            autoPlay
            loop={loopVideo}
            muted
            playsInline
            disablePictureInPicture
            onError={() => setFailedId(wallpaper.id)}
            className="absolute inset-0 size-full object-cover"
            style={mediaStyle}
          />
        ) : wallpaper.playback === 'gif' && video.url ? (
          // GIFs animate natively as an <img> (a <video> element can't play them).
          <img
            key={wallpaper.id}
            src={video.url}
            alt=""
            className="absolute inset-0 size-full object-cover"
            style={mediaStyle}
          />
        ) : tileImage && wallpaper.previewUrl ? (
          // tile alignment: CSS background-repeat (agent injector parity).
          <div
            key={wallpaper.id}
            className="absolute inset-0 size-full"
            style={{
              backgroundImage: `url("${wallpaper.previewUrl}")`,
              backgroundPosition: `${render?.positionX ?? 0}% ${render?.positionY ?? 0}%`,
              backgroundRepeat: 'repeat',
              ...(flip ? { transform: flip } : {}),
              ...(filter ? { filter } : {}),
            }}
          />
        ) : wallpaper.previewUrl ? (
          // Static image, unsupported video container, or a video that failed
          // to decode — show the still preview.
          <img
            key={wallpaper.id}
            src={wallpaper.previewUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            style={mediaStyle}
          />
        ) : (
          // Nothing to show yet — keep the scrim over the app background colour
          // so the frosted surfaces stay readable.
          <div className="absolute inset-0 bg-background" />
        )}
        {/* Particle overlay — CSS-only animated particles above wallpaper,
            below scrim for readability. Respects prefers-reduced-motion. */}
        {render?.particles && <ParticleOverlay config={render.particles} />}
      </div>
      {/* Readability scrim tinted with the app background color.
          Opacity is driven by `render.scrimOpacity` so themes can tune how
          much of the wallpaper motion punches through (fallback 55 preserves
          the historical default). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: `color-mix(in srgb, var(--background) ${scrimOpacity}%, transparent)`,
        }}
      />
      {/* Gentle top/bottom vignette for depth. Stops scale proportionally
          from the scrim base (40/55, 50/55) so the depth effect tracks the
          thematic scrim instead of stacking a fixed 40%/50% on top of tint. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, var(--background) ${vignetteTop}%, transparent) 0%, transparent 50%, color-mix(in srgb, var(--background) ${vignetteBottom}%, transparent) 100%)`,
        }}
      />
      {/* I-14: muted-audio hint. Desktop video is always muted (Electron
          autoplay policy), so `audioLevel` reactivity requested in render has
          no audible effect here. Surface that to the user via a tooltip. */}
      {showMutedHint && (
        <div
          className="pointer-events-auto absolute bottom-3 right-3 z-[var(--z-content)]"
          title={t.wallpaperAudioMuted}
        >
          <VolumeX className="size-4 text-foreground/60" />
        </div>
      )}
    </div>
  );
}
