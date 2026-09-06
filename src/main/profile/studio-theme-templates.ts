// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Theme Templates
 *
 * A curated set of starter palettes for Theme Studio. Each template seeds
 * a new StudioProject with a complete 14-token palette + optional tool
 * overrides, so the user tweaks a real starting point instead of a blank
 * canvas.
 *
 * Curation rules:
 *   - Contrast-first: every template hits WCAG AA on text/background.
 *   - Mode-diverse: 3 dark + 2 light.
 *   - Accent-varied: red/blue/green/amber/violet each appear at least once.
 *   - One-line-add: a template is a single object literal.
 */

import type { AgentId, ImagePaletteKey } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 14-agentskin token palette. */
export type StudioPalette = Record<ImagePaletteKey, string>;

/** Subset of ToolOverride that meaningfully changes the "feel". */
export interface TemplateOverrides {
  radius?: string;
  spacing?: number;
  shadowLevel?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  blurPx?: number;
  fontSize?: number;
  fontFam?: string;
}

export interface StudioThemeTemplate {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  category: 'chat-dark' | 'chat-light' | 'ide' | 'terminal' | 'reading';
  palette: StudioPalette;
  overrides?: TemplateOverrides;
  defaultAgent: AgentId;
}

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------

export function wcagContrast(fg: string, bg: string): number {
  const lum = (hexOrRgba: string): number => {
    // Fast path: #hex. Pass non-hex strings through rgba parser.
    const m = hexOrRgba.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    let r = 0;
    let g = 0;
    let b = 0;
    if (m) {
      const raw =
        m[1].length === 3
          ? m[1]
              .split('')
              .map((c) => c + c)
              .join('')
          : m[1];
      const n = parseInt(raw, 16);
      if (!Number.isNaN(n)) {
        r = (n >> 16) & 0xff;
        g = (n >> 8) & 0xff;
        b = n & 0xff;
      }
    } else {
      // Fallback: rgba() / rgb() — used by template authors for translucent borders.
      const rgbaMatch = hexOrRgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (rgbaMatch) {
        r = Number(rgbaMatch[1]);
        g = Number(rgbaMatch[2]);
        b = Number(rgbaMatch[3]);
      }
      // If still no match (unrecognized string), fall back to 0 luminance.
    }
    const f = (v: number) => {
      const s = Math.min(255, Math.max(0, v)) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const L1 = lum(fg);
  const L2 = lum(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function passesAA(fg: string, bg: string, isLargeText = false): boolean {
  return wcagContrast(fg, bg) >= (isLargeText ? 3 : 4.5);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const STUDIO_THEME_TEMPLATES: StudioThemeTemplate[] = [
  // -- Dark chat -------------------------------------------------------------
  {
    id: 'agent-midnight',
    name: '深夜对话',
    description: '专为长时间对话设计的低蓝光深色主题。温暖的灰阶降低眼部疲劳，蓝色点缀保持活力。',
    mode: 'dark',
    category: 'chat-dark',
    defaultAgent: 'traework',
    palette: {
      accent: '#3B82F6',
      secondary: '#60A5FA',
      background: '#0E1116',
      foreground: '#E5E7EB',
      muted: '#9CA3AF',
      surface: '#151921',
      surfaceElevated: '#1C212C',
      border: 'rgba(59, 130, 246, 0.18)',
      codeBackground: '#0A0D12',
      codeForeground: '#D1D5DB',
      inputBackground: '#1A1F29',
      buttonBackground: 'rgba(59, 130, 246, 0.14)',
      buttonForeground: '#60A5FA',
      focusRing: '#3B82F660',
    },
    overrides: { radius: '8px', fontSize: 14 },
  },
  {
    id: 'terminal-ops',
    name: '终端作战室',
    description: '经典 ANSI 琥珀色终端风格。黑色背景上的暖琥珀色，让代码像老式 CRT 一样锐利。',
    mode: 'dark',
    category: 'terminal',
    defaultAgent: 'traework',
    palette: {
      accent: '#FFB020',
      secondary: '#F59E0B',
      background: '#0A0A0A',
      foreground: '#E8D5B7',
      muted: '#927650',
      surface: '#111111',
      surfaceElevated: '#1A1A1A',
      border: 'rgba(255, 176, 32, 0.15)',
      codeBackground: '#050505',
      codeForeground: '#FFD699',
      inputBackground: '#161616',
      buttonBackground: 'rgba(255, 176, 32, 0.12)',
      buttonForeground: '#FFB020',
      focusRing: '#FFB02060',
    },
    overrides: {
      radius: '4px',
      fontSize: 13,
      fontFam: 'IBM Plex Mono, ui-monospace, monospace',
      shadowLevel: 'sm',
    },
  },
  {
    id: 'code-deck',
    name: '代码甲板 IDE',
    description:
      '深色 IDE 风格，为代码块使用对比面板。蓝紫色调，层级清晰，让 IDE 与该聊天窗口融为一体。',
    mode: 'dark',
    category: 'ide',
    defaultAgent: 'traework',
    palette: {
      accent: '#7C3AED',
      secondary: '#A78BFA',
      background: '#0F172A',
      foreground: '#CBD5E1',
      muted: '#64748B',
      surface: '#1E293B',
      surfaceElevated: '#334155',
      border: 'rgba(124, 58, 237, 0.18)',
      codeBackground: '#020617',
      codeForeground: '#E2E8F0',
      inputBackground: '#1E293B',
      buttonBackground: 'rgba(124, 58, 237, 0.15)',
      buttonForeground: '#A78BFA',
      focusRing: '#7C3AED60',
    },
    overrides: { radius: '6px', fontSize: 14, shadowLevel: 'md' },
  },
  // -- Light chat ------------------------------------------------------------
  {
    id: 'focus-paper',
    name: '纸质聚焦',
    description: '浅色阅读主题，米色背景护眼。深色代码块形成对比，适合白天使用与文字工作者。',
    mode: 'light',
    category: 'reading',
    defaultAgent: 'traework',
    palette: {
      accent: '#B45309',
      secondary: '#D97706',
      background: '#FAF7F2',
      foreground: '#1C1917',
      muted: '#78716C',
      surface: '#F5F2EC',
      surfaceElevated: '#FFFFFF',
      border: 'rgba(180, 83, 9, 0.2)',
      codeBackground: '#1C1917',
      codeForeground: '#FAF7F2',
      inputBackground: '#FFFFFF',
      buttonBackground: 'rgba(180, 83, 9, 0.1)',
      buttonForeground: '#B45309',
      focusRing: '#B4530960',
    },
    overrides: { radius: '4px', fontSize: 14, spacing: 8 },
  },
  {
    id: 'mint-fresh',
    name: '薄荷清爽',
    description:
      '清透的浅色主题，绿色点缀传递安全与活力。白色主背景，让你的聊天窗像清晨的空气一样干净。',
    mode: 'light',
    category: 'chat-light',
    defaultAgent: 'traework',
    palette: {
      accent: '#059669',
      secondary: '#34D399',
      background: '#F8FAFC',
      foreground: '#0F172A',
      muted: '#64748B',
      surface: '#FFFFFF',
      surfaceElevated: '#F1F5F9',
      border: 'rgba(5, 150, 105, 0.18)',
      codeBackground: '#0F172A',
      codeForeground: '#F8FAFC',
      inputBackground: '#FFFFFF',
      buttonBackground: 'rgba(5, 150, 105, 0.1)',
      buttonForeground: '#059669',
      focusRing: '#05966960',
    },
    overrides: { radius: '8px', fontSize: 14 },
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getTemplate(id: string): StudioThemeTemplate | undefined {
  return STUDIO_THEME_TEMPLATES.find((t) => t.id === id);
}

export function templatesByMode(mode: 'dark' | 'light'): StudioThemeTemplate[] {
  return STUDIO_THEME_TEMPLATES.filter((t) => t.mode === mode);
}

export function templatesByCategory(
  category: StudioThemeTemplate['category'],
): StudioThemeTemplate[] {
  return STUDIO_THEME_TEMPLATES.filter((t) => t.category === category);
}

export function templateCategories(): StudioThemeTemplate['category'][] {
  return [...new Set(STUDIO_THEME_TEMPLATES.map((t) => t.category))];
}
