// SPDX-License-Identifier: MPL-2.0

/**
 * # ParticleOverlay
 *
 * CSS-only animated particle layer for the DynamicBackground.
 * Renders floating particles above the wallpaper but below the scrim,
 * using pure CSS animations (no canvas/WebGL) for zero-overhead ambiance.
 *
 * Respects `prefers-reduced-motion`: when the user has reduced motion
 * enabled, particles are rendered static (no animation).
 *
 * Config is driven by `WallpaperRenderOptions.particles` — the type/density/
 * speed/opacity/color spec from theme render options.
 */

import { type CSSProperties, memo, useMemo } from 'react';

type ParticleType = 'rain' | 'thunderstorm' | 'snow' | 'hearts' | 'stars' | 'leaves' | 'custom';

interface ParticleConfig {
  type: ParticleType;
  density: number;
  speed: 'slow' | 'normal' | 'fast';
  opacity: number;
  customSymbol?: string;
  color?: string;
}

/** Base duration per particle type (seconds). */
const BASE_DURATIONS: Record<ParticleType, number> = {
  rain: 1.2,
  thunderstorm: 1.0,
  snow: 6,
  hearts: 5,
  stars: 7,
  leaves: 8,
  custom: 5,
};

/** Shape characters for symbol-based particles. */
const PARTICLE_GLYPHS: Record<ParticleType, string> = {
  rain: '\u2771',
  thunderstorm: '\u2771',
  snow: '\u2744',
  hearts: '\u2665',
  stars: '\u2726',
  leaves: '\uD83C\uDF43',
  custom: '',
};

/** Color fallback per type (overridden by config.color). */
const PARTICLE_COLORS: Record<ParticleType, string> = {
  rain: 'var(--cr-blue-fg, rgba(180,200,220,0.55))',
  thunderstorm: 'var(--cr-blue-fg, rgba(200,210,230,0.7))',
  snow: 'var(--cr-white-fg, rgba(255,255,255,0.85))',
  hearts: 'var(--cr-pink-fg, rgba(230,80,120,0.7))',
  stars: 'var(--cr-yellow-fg, rgba(255,230,150,0.8))',
  leaves: 'var(--cr-olive-fg, rgba(180,160,100,0.7))',
  custom: 'var(--cr-white-fg, rgba(255,255,255,0.6))',
};

interface ParticleItem {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  sway: boolean;
}

/** Map density (0–100) to DOM element count (0–120). */
function densityToCount(density: number): number {
  return Math.min(120, Math.max(0, Math.round((density / 100) * 120)));
}

/** Adjust base duration by speed setting. */
function speedToDuration(speed: ParticleConfig['speed'], base: number): number {
  switch (speed) {
    case 'slow':
      return base * 1.5;
    case 'fast':
      return base * 0.6;
    default:
      return base;
  }
}

function generateParticles(
  count: number,
  type: ParticleType,
  speed: ParticleConfig['speed'],
): ParticleItem[] {
  const baseDuration = BASE_DURATIONS[type];
  const items: ParticleItem[] = [];

  for (let i = 0; i < count; i++) {
    const left = Math.random() * 100;
    const delay = -Math.random() * baseDuration;
    const durationJitter = 0.7 + Math.random() * 0.6;
    const duration = speedToDuration(speed, baseDuration) * durationJitter;

    let size: number;
    switch (type) {
      case 'rain':
      case 'thunderstorm':
        size = 10 + Math.random() * 8;
        break;
      case 'snow':
        size = 6 + Math.random() * 10;
        break;
      case 'hearts':
      case 'stars':
        size = 14 + Math.random() * 12;
        break;
      case 'leaves':
        size = 18 + Math.random() * 10;
        break;
      default:
        size = 12 + Math.random() * 8;
    }

    const sway = type === 'snow' || type === 'leaves';
    items.push({ id: i, left, delay, duration, size, sway });
  }

  return items;
}

function ParticleOverlayImpl({ config }: { config: ParticleConfig }) {
  const count = densityToCount(config.density);

  const particles = useMemo(
    () => generateParticles(count, config.type, config.speed),
    [count, config.type, config.speed],
  );

  const color = config.color ?? PARTICLE_COLORS[config.type];
  const glyph = PARTICLE_GLYPHS[config.type];
  const isCustom = config.type === 'custom' && config.customSymbol;
  const isRainType = config.type === 'rain' || config.type === 'thunderstorm';

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: config.opacity } as CSSProperties}
      aria-hidden="true"
    >
      {particles.map((p) => {
        const baseStyle: CSSProperties = {
          left: `${p.left}%`,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.duration}s`,
          color,
          fontSize: `${p.size}px`,
          willChange: 'transform, opacity',
        };

        if (isRainType) {
          return (
            <span key={p.id} className="as-particle as-rain absolute" style={baseStyle}>
              {glyph}
            </span>
          );
        }

        if (isCustom) {
          return (
            <span
              key={p.id}
              className="as-particle as-float absolute block"
              style={{
                ...baseStyle,
                backgroundImage: `url(${config.customSymbol})`,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                width: `${p.size}px`,
                height: `${p.size}px`,
              }}
            />
          );
        }

        const cls = p.sway ? 'as-particle as-sway absolute' : 'as-particle as-float absolute';
        return (
          <span key={p.id} className={cls} style={baseStyle}>
            {glyph}
          </span>
        );
      })}

      {config.type === 'thunderstorm' && (
        <div className="as-flash pointer-events-none absolute inset-0" aria-hidden="true" />
      )}
    </div>
  );
}

export const ParticleOverlay = memo(ParticleOverlayImpl);
