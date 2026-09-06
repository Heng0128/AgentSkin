// SPDX-License-Identifier: MPL-2.0

/**
 * # Texture Scorer
 *
 * Scores and selects the "best" texture from a Wallpaper Engine Scene's
 * object list for static-frame extraction. Uses weighted multi-criteria
 * scoring to identify the most visually prominent texture.
 *
 * Scoring dimensions (weights sum to 1.0):
 * - Resolution (0.30): larger textures are more likely to be the main art
 * - Name heuristic (0.20): "hero", "main", "background", "art" keywords
 * - Scene size match (0.15): aspect ratio close to scene aspect ratio
 * - Aspect ratio (0.15): 16:9 or 4:3 preferred over square/odd ratios
 * - Position (0.10): centered textures score higher
 * - Opacity/blend (0.10): full opacity + normal blend mode preferred
 */

/** A candidate texture extracted from a scene object. */
export interface TextureCandidate {
  /** Object ID from scene.json */
  id: string;
  /** Object name from scene.json (may be empty) */
  name: string;
  /** Texture width in pixels */
  width: number;
  /** Texture height in pixels */
  height: number;
  /** Object position in scene coordinates */
  position: { x: number; y: number };
  /** Object opacity (0.0 - 1.0) */
  opacity: number;
  /** Blend mode string (e.g., "normal", "additive", "multiply") */
  blendMode: string;
}

/** Context for scoring: scene dimensions. */
export interface ScoringContext {
  /** Scene width in pixels */
  sceneWidth: number;
  /** Scene height in pixels */
  sceneHeight: number;
  /** Pre-computed scene aspect ratio (width / height) */
  sceneAspectRatio: number;
}

/** Scoring weights (sum = 1.0). */
const WEIGHTS = {
  resolution: 0.3,
  nameHeuristic: 0.2,
  sceneSizeMatch: 0.15,
  aspectRatio: 0.15,
  position: 0.1,
  opacityBlend: 0.1,
} as const;

/** Reference resolution for normalization (4096² = "maximum useful detail"). */
const REFERENCE_PIXELS = 4096 * 4096;

/** Preferred aspect ratios (16:9, 4:3, 16:10, 21:9). */
const PREFERRED_RATIOS = [16 / 9, 4 / 3, 16 / 10, 21 / 9];

/** Keywords that suggest a "main art" texture (case-insensitive). */
const HERO_KEYWORDS = [
  'hero',
  'main',
  'background',
  'art',
  'backdrop',
  'base',
  'wallpaper',
  'scene',
  'bg',
  'foreground',
  'center',
];

/** Keywords that suggest a non-main texture (decorative/effect). */
const MASK_KEYWORDS = [
  'mask',
  'effect',
  'particle',
  'overlay',
  'decoration',
  'accent',
  'highlight',
  'shadow',
  'glow',
  'light',
  'sparkle',
  'bokeh',
];

/**
 * Score a single texture candidate against the scene context.
 * Returns a score in [0.0, 1.0] where higher is better.
 */
export function scoreTexture(candidate: TextureCandidate, context: ScoringContext): number {
  const { width, height } = candidate;
  if (width <= 0 || height <= 0) return 0;

  // 1. Resolution score (logarithmic, normalized to 4096²)
  const pixelCount = width * height;
  const resolutionScore = Math.min(Math.log2(pixelCount) / Math.log2(REFERENCE_PIXELS), 1);

  // 2. Name heuristic score
  const nameLower = candidate.name.toLowerCase();
  let nameScore = 0.5; // neutral default
  if (HERO_KEYWORDS.some((kw) => nameLower.includes(kw))) {
    nameScore = 1.0;
  } else if (MASK_KEYWORDS.some((kw) => nameLower.includes(kw))) {
    nameScore = 0.0;
  }

  // 3. Scene size match (aspect ratio similarity)
  const candidateAspectRatio = width / height;
  const aspectDiff = Math.abs(candidateAspectRatio - context.sceneAspectRatio);
  const sceneSizeMatchScore = Math.max(0, 1 - aspectDiff / context.sceneAspectRatio);

  // 4. Aspect ratio preference (closer to a preferred ratio = higher score)
  let aspectRatioScore = 0;
  for (const ratio of PREFERRED_RATIOS) {
    const score = Math.max(0, 1 - Math.abs(candidateAspectRatio - ratio) / ratio);
    aspectRatioScore = Math.max(aspectRatioScore, score);
  }

  // 5. Position score (distance from scene center, normalized)
  const centerX = context.sceneWidth / 2;
  const centerY = context.sceneHeight / 2;
  const dx = (candidate.position.x - centerX) / context.sceneWidth;
  const dy = (candidate.position.y - centerY) / context.sceneHeight;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
  const positionScore = Math.max(0, 1 - distanceFromCenter);

  // 6. Opacity/blend score
  const opacityScore = candidate.opacity >= 1.0 ? 1.0 : candidate.opacity;
  const blendScore = candidate.blendMode === 'normal' ? 1.0 : 0.5;
  const opacityBlendScore = opacityScore * blendScore;

  // Weighted sum
  return (
    WEIGHTS.resolution * resolutionScore +
    WEIGHTS.nameHeuristic * nameScore +
    WEIGHTS.sceneSizeMatch * sceneSizeMatchScore +
    WEIGHTS.aspectRatio * aspectRatioScore +
    WEIGHTS.position * positionScore +
    WEIGHTS.opacityBlend * opacityBlendScore
  );
}

/**
 * Select the best texture from a list of candidates.
 * Returns null if the list is empty or all scores are 0.
 */
export function selectBestTexture(
  candidates: TextureCandidate[],
  context: ScoringContext,
): TextureCandidate | null {
  if (candidates.length === 0) return null;

  let best: TextureCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = scoreTexture(candidate, context);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // If all scores are 0 (e.g., all have zero dimensions), return null
  if (bestScore <= 0) return null;

  return best;
}

/**
 * Create a ScoringContext from scene dimensions.
 */
export function createScoringContext(sceneWidth: number, sceneHeight: number): ScoringContext {
  return {
    sceneWidth,
    sceneHeight,
    sceneAspectRatio: sceneWidth > 0 && sceneHeight > 0 ? sceneWidth / sceneHeight : 16 / 9,
  };
}
