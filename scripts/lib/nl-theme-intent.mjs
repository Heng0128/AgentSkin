// SPDX-License-Identifier: MIT
//
// # nl-theme-intent.mjs — Natural Language Theme Intent Parser
//
// Parses freeform user input (Chinese or English) into a structured
// {@link ThemeIntent}, then converts that intent into concrete
// {@link ThemeParams} suitable for the 14-token theme system.
//
// Pipeline:
//
//   user input (string)
//        │
//        ▼
//   parseThemeIntent(input)  →  ThemeIntent
//        │
//        ▼
//   intentToParams(intent)   →  ThemeParams
//
// The parser is deliberately keyword-based and deterministic — no ML, no
// network calls. Confidence is computed from keyword coverage so the caller
// can decide whether to surface a confirmation dialog.

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

/**
 * @typedef {'apply'|'adjust'|'restore'|'preview'|'unknown'} ActionType
 */

/**
 * @typedef {Object} ThemeIntent
 * @property {ActionType} action
 * @property {string} [colorHint]
 * @property {[number, number]} [hueRange]
 * @property {number} [saturation]
 * @property {number} [lightness]
 * @property {number} [intensity]
 * @property {string} [scene]
 * @property {number} confidence
 */

/**
 * @typedef {Object} ThemeParams
 * @property {string} [accent]
 * @property {string} [surface]
 * @property {string} [bg]
 * @property {number} intensity
 * @property {'dark'|'light'} mode
 * @property {string} description
 */

/**
 * Color keyword → { colorHint, hueRange } mapping.
 * Order matters: first match wins (more specific patterns first).
 * @type {Array<{ keywords: string[], colorHint: string, hueRange: [number, number] }>}
 */
const COLOR_KEYWORDS = [
  { keywords: ['蓝色系', '蓝色', 'blue'], colorHint: 'blue', hueRange: [200, 240] },
  { keywords: ['暖色调', '暖色', '温暖', 'warm'], colorHint: 'warm', hueRange: [0, 60] },
  { keywords: ['冷色', 'cool'], colorHint: 'cool', hueRange: [180, 300] },
];

/**
 * Mode-only hints (dark / light / neutral) have no hueRange.
 * These are matched separately so they set only colorHint.
 * @type {Array<{ keywords: string[], colorHint: string }>}
 */
const MODE_KEYWORDS = [
  { keywords: ['暗色', '暗', '深色', 'dark'], colorHint: 'dark' },
  { keywords: ['亮色', '亮', '浅色', 'light'], colorHint: 'light' },
  { keywords: ['中性', 'neutral'], colorHint: 'neutral' },
];

/**
 * Scene keyword → scene identifier.
 * @type {Array<{ keywords: string[], scene: string }>}
 */
const SCENE_KEYWORDS = [
  { keywords: ['投屏', '投影', '演示', 'presentation'], scene: 'presentation' },
  { keywords: ['护眼', 'eye-care'], scene: 'eye-care' },
  { keywords: ['夜间', '夜晚', 'night'], scene: 'night' },
  { keywords: ['阅读', 'reading'], scene: 'reading' },
  { keywords: ['专注', '工作', 'focus'], scene: 'focus' },
];

/**
 * Intensity keyword → value.
 * @type {Array<{ keywords: string[], intensity: number }>}
 */
const INTENSITY_KEYWORDS = [
  { keywords: ['低调', '淡一点', '收敛'], intensity: 0.3 },
  { keywords: ['浓郁', '重一点', '强烈'], intensity: 0.8 },
];

/**
 * Action keyword → action type.
 * @type {Array<{ keywords: string[], action: ActionType }>}
 */
const ACTION_KEYWORDS = [
  { keywords: ['恢复', '还原', 'reset', 'restore'], action: 'restore' },
  { keywords: ['预览', '试试', 'preview'], action: 'preview' },
  { keywords: ['换成', '切换', 'set'], action: 'apply' },
  { keywords: ['调整', '亮一点', '暗一点'], action: 'adjust' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize input for matching: trim, lowercase (English), collapse whitespace.
 * @param {string} input
 * @returns {string}
 */
function normalize(input) {
  return input.trim().toLowerCase();
}

/**
 * Check if any keyword exists in the normalized input.
 * @param {string} normalized
 * @param {string[]} keywords
 * @returns {string|undefined}
 */
function matchKeyword(normalized, keywords) {
  for (const kw of keywords) {
    if (normalized.includes(kw.toLowerCase())) return kw;
  }
  return undefined;
}

/**
 * Compute confidence from how many signal dimensions were detected.
 * Each dimension (color, scene, intensity, action-explicit) adds to the score.
 * @param {object} signals
 * @returns {number}
 */
function computeConfidence({ color, scene, intensity, actionExplicit }) {
  let score = 0;
  let total = 0;

  // Color hint is the strongest signal.
  total += 2;
  if (color) score += 2;

  // Scene is a strong signal.
  total += 2;
  if (scene) score += 2;

  // Intensity modifier.
  total += 1;
  if (intensity) score += 1;

  // Explicit action keyword (vs. implicit "apply").
  total += 1;
  if (actionExplicit) score += 1;

  return total === 0 ? 0 : score / total;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language theme intent from user input.
 *
 * Supports Chinese and English keywords for colours, scenes, intensity,
 * and actions. Returns a structured {@link ThemeIntent} with a confidence
 * score (0–1) reflecting how many signal dimensions were detected.
 *
 * @param {string} input - User input (e.g. "把主题换成蓝色系", "投屏模式")
 * @returns {ThemeIntent} Structured intent
 */
export function parseThemeIntent(input) {
  const text = normalize(input);

  if (!text) {
    return { action: 'unknown', confidence: 0 };
  }

  const intent = {
    action: 'unknown',
    confidence: 0,
  };

  // --- Color hint ---
  for (const entry of COLOR_KEYWORDS) {
    if (matchKeyword(text, entry.keywords)) {
      intent.colorHint = entry.colorHint;
      intent.hueRange = entry.hueRange;
      break;
    }
  }

  // --- Mode hint (only if no color hint found, to avoid overwriting) ---
  if (!intent.colorHint) {
    for (const entry of MODE_KEYWORDS) {
      if (matchKeyword(text, entry.keywords)) {
        intent.colorHint = entry.colorHint;
        break;
      }
    }
  }

  // --- Scene ---
  for (const entry of SCENE_KEYWORDS) {
    if (matchKeyword(text, entry.keywords)) {
      intent.scene = entry.scene;
      break;
    }
  }

  // --- Intensity ---
  for (const entry of INTENSITY_KEYWORDS) {
    if (matchKeyword(text, entry.keywords)) {
      intent.intensity = entry.intensity;
      break;
    }
  }

  // --- Action ---
  let actionExplicit = false;
  for (const entry of ACTION_KEYWORDS) {
    if (matchKeyword(text, entry.keywords)) {
      intent.action = entry.action;
      actionExplicit = true;
      break;
    }
  }

  // Default action: if we detected any signal but no explicit action,
  // assume "apply".
  const hasSignal = intent.colorHint || intent.scene || intent.intensity;
  if (intent.action === 'unknown' && hasSignal) {
    intent.action = 'apply';
  }

  // --- Confidence ---
  intent.confidence = computeConfidence({
    color: !!intent.colorHint,
    scene: !!intent.scene,
    intensity: !!intent.intensity,
    actionExplicit,
  });

  return intent;
}

// ---------------------------------------------------------------------------
// Intent → Params conversion
// ---------------------------------------------------------------------------

/**
 * Convert a {@link ThemeIntent} into concrete {@link ThemeParams}.
 *
 * Derives HSL-based colour values from the hueRange, adjusts saturation
 * and lightness per intent, and maps scene to appropriate mode/intensity
 * defaults.
 *
 * @param {ThemeIntent} intent
 * @returns {ThemeParams} Theme parameters ready for the 14-token system
 */
export function intentToParams(intent) {
  const params = {
    intensity: intent.intensity ?? 0.5,
    mode: 'dark',
    description: '',
  };

  // --- Accent from hueRange ---
  if (intent.hueRange) {
    const [hMin, hMax] = intent.hueRange;
    const h = Math.round((hMin + hMax) / 2);
    const s = intent.saturation ?? 70;
    const l = intent.lightness ?? 60;
    params.accent = `hsl(${h}, ${s}%, ${l}%)`;
  } else {
    // Default accent fallback.
    params.accent = 'hsl(220, 70%, 60%)';
  }

  // --- Scene overrides ---
  switch (intent.scene) {
    case 'presentation':
      // High contrast, low atmosphere.
      params.mode = 'dark';
      params.intensity = Math.min(params.intensity, 0.3);
      params.surface = 'hsl(220, 10%, 12%)';
      params.bg = 'hsl(220, 10%, 6%)';
      break;

    case 'eye-care':
      // Warm, low saturation.
      params.mode = 'light';
      params.intensity = Math.min(params.intensity, 0.4);
      params.accent = 'hsl(30, 40%, 55%)';
      params.surface = 'hsl(35, 30%, 92%)';
      params.bg = 'hsl(35, 25%, 96%)';
      break;

    case 'night':
      // Dark, low brightness.
      params.mode = 'dark';
      params.intensity = Math.min(params.intensity, 0.4);
      params.surface = 'hsl(220, 15%, 10%)';
      params.bg = 'hsl(220, 15%, 4%)';
      break;

    case 'reading':
      // Neutral, medium brightness.
      params.mode = 'light';
      params.intensity = 0.5;
      params.accent = 'hsl(210, 20%, 50%)';
      params.surface = 'hsl(210, 10%, 94%)';
      params.bg = 'hsl(210, 10%, 98%)';
      break;

    case 'focus':
      // Cool, low atmosphere.
      params.mode = 'dark';
      params.intensity = Math.min(params.intensity, 0.35);
      params.accent = 'hsl(210, 60%, 55%)';
      params.surface = 'hsl(210, 12%, 12%)';
      params.bg = 'hsl(210, 12%, 5%)';
      break;

    default:
      // No scene: derive mode from colorHint.
      if (intent.colorHint === 'dark' || intent.colorHint === 'light') {
        params.mode = intent.colorHint;
      }
      break;
  }

  // --- Mode default for dark hints without scene ---
  if (!intent.scene && intent.colorHint === 'dark') {
    params.mode = 'dark';
  }

  // --- Description ---
  params.description = buildDescription(intent, params);

  return params;
}

/**
 * Build a human-readable description from intent + resolved params.
 * @param {ThemeIntent} intent
 * @params {ThemeParams} params
 * @returns {string}
 */
function buildDescription(intent, params) {
  const parts = [];

  if (intent.scene) {
    const sceneLabels = {
      presentation: '投屏演示',
      'eye-care': '护眼',
      night: '夜间',
      reading: '阅读',
      focus: '专注',
    };
    parts.push(sceneLabels[intent.scene] ?? intent.scene);
  }

  if (intent.colorHint) {
    const colorLabels = {
      blue: '蓝色',
      warm: '暖色',
      cool: '冷色',
      dark: '暗色',
      light: '亮色',
      neutral: '中性',
    };
    parts.push(colorLabels[intent.colorHint] ?? intent.colorHint);
  }

  if (intent.intensity !== undefined) {
    if (intent.intensity <= 0.3) parts.push('低调');
    else if (intent.intensity >= 0.8) parts.push('浓郁');
  }

  if (parts.length === 0) {
    return `${params.mode} 主题`;
  }

  return `${parts.join(' · ')} 主题 (${params.mode})`;
}
