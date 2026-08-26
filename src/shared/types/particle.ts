// SPDX-License-Identifier: MPL-2.0

/**
 * Particle system types for AgentSkin's Wallpaper feature.
 *
 * Design principles (inspired by sysxdc/workbuddy-skin-lab):
 * - Pure CSS animations (no Canvas, no rAF loop)
 * - pointer-events: none (never blocks interaction)
 * - Respects prefers-reduced-motion
 * - Max 150 particles for performance
 */

export type ParticleType =
  | 'rain'
  | 'thunderstorm'
  | 'snow'
  | 'hearts'
  | 'stars'
  | 'leaves'
  | 'custom';

export type ParticleSpeed = 'slow' | 'normal' | 'fast';

export interface ParticleConfig {
  type: ParticleType;
  /** Particle count multiplier 1-100 → maps to ~15-150 elements. */
  density: number;
  speed: ParticleSpeed;
  /** Global opacity multiplier 0-1. */
  opacity: number;
  /** Custom symbol URL (AI-generated transparent PNG) for type='custom'. */
  customSymbol?: string;
  /** Color override (hex). Falls back to theme token if unset. */
  color?: string;
}

export const PARTICLE_TYPES: ParticleType[] = [
  'rain',
  'thunderstorm',
  'snow',
  'hearts',
  'stars',
  'leaves',
  'custom',
];

export const PARTICLE_SPEED_TIERS: Record<ParticleSpeed, number> = {
  slow: 1.6,
  normal: 1.0,
  fast: 0.6,
};

/** Map density (1-100) to element count — capped at 150. */
export function densityToCount(density: number): number {
  const clamped = Math.max(1, Math.min(100, density));
  // Logarithmic scale: density=1 → ~12, density=100 → 150
  return Math.round(12 + (clamped / 100) * 138);
}

/** Speed tier to animation-duration multiplier. */
export function speedToDuration(speed: ParticleSpeed, baseSeconds: number): number {
  return baseSeconds * PARTICLE_SPEED_TIERS[speed];
}

export function isParticleConfig(value: unknown): value is ParticleConfig {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !PARTICLE_TYPES.includes(obj.type as ParticleType))
    return false;
  if (typeof obj.density !== 'number' || obj.density < 1 || obj.density > 100) return false;
  if (typeof obj.speed !== 'string' || !['slow', 'normal', 'fast'].includes(obj.speed))
    return false;
  if (typeof obj.opacity !== 'number' || obj.opacity < 0 || obj.opacity > 1) return false;
  if (obj.customSymbol !== undefined && typeof obj.customSymbol !== 'string') return false;
  if (obj.color !== undefined && typeof obj.color !== 'string') return false;
  return true;
}

export const DEFAULT_PARTICLE_CONFIG: ParticleConfig = {
  type: 'snow',
  density: 30,
  speed: 'normal',
  opacity: 0.6,
};
