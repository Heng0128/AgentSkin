// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package.mjs — Theme Studio export builder
 *
 * Receives a {@link ThemeStudioExportRequest}-shaped payload from the renderer
 * (via `studio:export`) and writes a directory-based `.agentskin-theme` package
 * under `theme-workbench/out/<id>.agentskin-theme/`:
 *
 *   <id>/
 *     manifest.json
 *     preview.png
 *     icon.png
 *     assets/css/<agentId>.css
 *
 * The CSS reuses the same contract as the hand-authored themes:
 *   1. a `:root` block declaring the `--agentskin-*` palette tokens,
 *   2. a host-scoped override block that redirects the agent's OWN design-token
 *      namespace (--vscode-*, --color-*, --wb-*, --cb-*, --dbx-*, --text-*, …)
 *      onto the crafted palette, so the recolor actually takes effect,
 *   3. an optional "craft" layer derived from the 8-dimension toolbox overrides
 *      (radius / spacing / shadow / blur / font / motion).
 *
 * No third-party deps: the preview/icon PNGs are emitted with a tiny zlib-based
 * encoder so the builder runs inside the packaged app without network access.
 *
 * @type {import('node:fs')}
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
// λ safety guardrails (P0-2 sanitize + P0-1 specificity)
import { sanitizeDeclarationBlock, sanitizeKeyframes } from '../src/compiler/sanitize.js';
import { AGENT_SPECIFICITY_PROFILES, validateSpecificity } from '../src/compiler/specificity.js';
import { getAdapter } from '../src/engine/src/adapters/index.mjs';
// 2a multi-asset: reuse the B-line engine gates (SAFE_IMAGE_TYPES /
// MAX_THEME_IMAGES / MAX_THEME_IMAGE_BASE64) so the Studio-exported package
// obeys the same quantity/volume contract as hand-authored bundles
// (RFC themes-asset-injection-2a §2.3).
import {
  MAX_THEME_IMAGE_BASE64,
  MAX_THEME_IMAGES,
  SAFE_IMAGE_TYPES,
} from '../src/engine/src/theme/package.mjs';
// Build fingerprint: SHA-256 integrity manifest for theme package files.
import {
  FINGERPRINT_FILENAME,
  generateBuildFingerprint,
} from '../src/shared/theme-build-fingerprint.js';
import { hexToRgb, luminance } from './utils/color-utils.mjs';

// ---------------------------------------------------------------------------
// Default palette (used when the renderer sends nothing / partial)
// ---------------------------------------------------------------------------

const DEFAULT_TOKENS = {
  '--agentskin-accent': '#9d8bff',
  '--agentskin-secondary': '#f097c8',
  '--agentskin-bg': '#201a40',
  '--agentskin-surface': '#2b254a',
  '--agentskin-surface-elevated': '#363153',
  '--agentskin-text': '#e8e2ff',
  '--agentskin-muted': '#8e88a9',
  '--agentskin-border': '#9d8bff2e',
  '--agentskin-code-bg': '#15112a',
  '--agentskin-code-fg': '#c9cbe9',
  '--agentskin-input-bg': '#332e51',
  '--agentskin-button-bg': '#9d8bff',
  '--agentskin-focus-ring': '#9d8bff60',
  '--agentskin-selection': 'rgba(157, 139, 255, 0.32)',
};

// ---------------------------------------------------------------------------
// Agent host selectors + native token namespaces to remap
// ---------------------------------------------------------------------------

const HOST_SELECTOR = {
  // Aligned with theme-utils.mjs HOSTS (single source of truth).
  // These selectors match both the runtime adapter injection points and the
  // CI generator pipeline. See theme-utils.mjs L780-787 for the canonical list.
  traework: 'html.agentskin-host-traework',
  qoderwork: 'html.agentskin-host-qoderwork',
  workbuddy: 'body[data-application-name="workbuddy"]',
  doubao: 'html.agentskin-host-doubao',
  codex: ':root.agentskin-host-codex',
  zcode: 'html.agentskin-host-zcode',
};

// Representative semantic tokens per agent namespace. These are redirected onto
// the crafted palette via valueForToken() so the recolor is visible.
const AGENT_REMAP = {
  traework: [
    '--vscode-editor-background',
    '--vscode-foreground',
    '--vscode-editor-foreground',
    '--vscode-sideBar-background',
    '--vscode-activityBar-background',
    '--vscode-statusBar-background',
    '--vscode-titleBar-activeBackground',
    '--vscode-titleBar-activeForeground',
    '--vscode-titleBar-inactiveBackground',
    '--vscode-tab-activeBackground',
    '--vscode-input-background',
    '--vscode-dropdown-background',
    '--vscode-list-hoverBackground',
    '--vscode-toolbar-hoverBackground',
    '--vscode-textLink-foreground',
    '--vscode-textLink-activeForeground',
    '--vscode-button-background',
    '--vscode-button-foreground',
    '--vscode-button-hoverBackground',
    '--vscode-focusBorder',
    '--vscode-panel-border',
    '--vscode-widget-border',
    '--vscode-scrollbarSlider-background',
    '--vscode-scrollbarSlider-hoverBackground',
    '--vscode-scrollbarSlider-activeBackground',
    '--vscode-descriptionForeground',
    '--vscode-disabledForeground',
    '--vscode-editor-selectionBackground',
    '--vscode-input-foreground',
    '--vscode-input-placeholderForeground',
    '--vscode-editorWidget-background',
    '--vscode-badge-background',
    '--vscode-badge-foreground',
    '--vscode-dropdown-foreground',
    '--vscode-dropdown-border',
    '--vscode-checkbox-background',
    '--vscode-checkbox-foreground',
    '--vscode-checkbox-border',
    '--vscode-list-activeSelectionBackground',
    '--vscode-list-activeSelectionForeground',
    '--vscode-menu-background',
    '--vscode-menu-foreground',
    '--vscode-menu-border',
    '--vscode-menu-separatorBackground',
    '--vscode-chat-requestBorder',
    // icube design system tokens
    '--vscode-icube-bg',
    '--vscode-icube-fg',
    '--vscode-icube-colorDefaultText',
    '--vscode-icube-colorHighlightText',
    '--vscode-icube-colorGrayText',
    '--vscode-icube-colorDisableText',
    '--vscode-icube-colorBrand',
    '--vscode-icube-colorLine1',
    '--vscode-icube-colorLine2',
    '--vscode-icube-colorBtnHover',
    '--vscode-icube-colorBtnHover2',
    '--vscode-icube-colorBg1',
    '--vscode-icube-colorBg2',
    '--vscode-icube-colorBg3',
    '--vscode-icube-colorTextDefault',
    '--vscode-icube-colorTextGray',
    // icube flat namespace tokens
    '--vscode-icube--text-text-default',
    '--vscode-icube--text-text-secondary',
    '--vscode-icube--text-text-brand',
    '--vscode-icube--text-text-tertiary',
    '--vscode-icube--text-text-disabled',
    '--vscode-icube--text-text-onaccent',
    '--vscode-icube--text-text-default-hover',
    '--vscode-icube--text-text-default-active',
    '--vscode-icube--bg-bg-base-default',
    '--vscode-icube--bg-bg-base-secondary',
    '--vscode-icube--bg-bg-base-tertiary',
    '--vscode-icube--bg-bg-menu',
    '--vscode-icube--bg-bg-tooltip',
    '--vscode-icube--bg-bg-overlay-l2',
    '--vscode-icube--bg-bg-overlay-l3',
    '--vscode-icube--bg-bg-overlay-l4',
    '--vscode-icube--bg-bg-invert',
    '--vscode-icube--bg-bg-invert-hover',
    '--vscode-icube--bg-bg-invert-active',
    '--vscode-icube--bg-bg-invert-disabled',
    '--vscode-icube--icon-icon-default',
    '--vscode-icube--icon-icon-secondary',
    '--vscode-icube--icon-icon-tertiary',
    '--vscode-icube--icon-icon-disabled',
    '--vscode-icube--icon-icon-onaccent',
    '--vscode-icube--icon-icon-default-hover',
    '--vscode-icube--border-border-neutral-l1',
    '--vscode-icube--border-border-neutral-l2',
    '--vscode-icube--border-border-neutral-l3',
    // flat namespace tokens (bare)
    '--bg-bg-base-default',
    '--bg-bg-base-tertiary',
    '--bg-bg-menu',
    '--bg-bg-tooltip',
    '--bg-bg-overlay-l3',
    '--bg-bg-overlay-l4',
    '--bg-bg-brand',
    '--bg-bg-brand-hover',
    '--bg-bg-brand-active',
    '--bg-bg-brand-disabled',
    '--bg-bg-invert',
    '--bg-bg-invert-hover',
    '--bg-bg-invert-active',
    '--bg-bg-invert-disabled',
    '--text-text-default',
    '--text-text-secondary',
    '--text-text-tertiary',
    '--text-text-default-hover',
    '--text-text-default-active',
    '--text-text-brand',
    '--icon-icon-default',
    '--icon-icon-secondary',
    '--icon-icon-tertiary',
    '--icon-icon-default-hover',
    '--icon-icon-onaccent',
    '--icon-icon-disabled',
  ],
  qoderwork: [
    '--color-bg-primary',
    '--color-bg-secondary',
    '--color-bg-tertiary',
    '--color-bg-overlay',
    '--color-bg-container',
    '--color-bg-elevated',
    '--color-bg-layout',
    '--color-bg-spotlight',
    '--color-bg-base',
    '--color-bg-mask',
    '--color-bg-highlight',
    '--color-bg-highlight-hover',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--color-text-quaternary',
    '--color-text-base',
    '--color-text-disabled',
    '--color-text-link',
    '--color-muted',
    '--color-muted-foreground',
    '--color-accent',
    '--color-accent-hover',
    '--color-brand',
    '--color-brand-hover',
    '--color-fill-input',
    '--color-fill-secondary',
    '--color-fill-tertiary',
    '--color-fill-quaternary',
    '--color-fill-disable',
    '--color-line-border',
    '--color-line-divider',
    '--color-code-bg',
    '--color-code-fg',
    '--color-focus-ring',
    '--color-selection',
    '--color-link',
    '--color-background',
    '--color-popover',
    '--color-border-secondary',
    '--color-border-tertiary',
    '--color-error',
    '--color-error-hover',
    '--color-error-bg',
    '--color-error-border',
    '--color-info',
    '--color-info-hover',
    '--color-info-bg',
    '--color-info-border',
    '--color-success',
    '--color-success-hover',
    '--color-success-bg',
    '--color-success-border',
    '--color-warning',
    '--color-warning-hover',
    '--color-warning-bg',
    '--color-warning-border',
    '--color-diff-insert',
    '--color-diff-insert-bg',
    '--color-diff-remove',
    '--color-diff-remove-bg',
    '--color-pink',
    '--color-pink-bg',
    '--color-pink-hover',
    '--color-purple',
    '--color-purple-bg',
    '--color-purple-hover',
    '--color-yellow',
    '--color-yellow-bg',
    '--color-yellow-hover',
    '--color-orange',
    '--color-orange-bg',
    '--color-orange-hover',
    '--color-teal',
    '--color-teal-bg',
    '--color-teal-hover',
    '--color-blue',
    '--color-blue-bg',
    '--color-blue-hover',
    '--color-mauve',
    '--color-mauve-bg',
    '--color-mauve-hover',
    '--color-slate',
    '--color-slate-bg',
    '--color-slate-hover',
    '--color-lavender',
    '--color-lavender-bg',
    '--color-lavender-hover',
    '--color-sage',
    '--color-sage-bg',
    '--color-sage-hover',
    '--color-shadow-2xs',
    '--color-shadow-xs',
    '--color-shadow-sm',
    '--color-shadow-md',
    '--color-shadow-lg',
    '--color-shadow-xl',
    '--color-shadow-2xl',
    '--color-shadow-3xl',
    '--color-shadow-scrim',
    '--color-highlight-xs',
    '--color-highlight-sm',
    '--color-highlight-md',
    '--color-highlight-lg',
    '--color-highlight-xl',
  ],
  workbuddy: [
    '--wb-accent',
    '--wb-secondary',
    '--wb-surface',
    '--wb-text',
    // --cb-* wrapper tokens
    '--cb-bg-primary',
    '--cb-bg-secondary',
    '--cb-bg-tertiary',
    '--cb-bg-overlay',
    '--cb-panel-bg-primary',
    '--cb-panel-bg-secondary',
    '--cb-team-member-card-background',
    '--cb-text-primary',
    '--cb-text-secondary',
    '--cb-text-disabled',
    '--cb-text-link',
    '--cb-text-link-hover',
    '--cb-text-tertiary',
    '--cb-text-error-active',
    '--cb-stroke-secondary',
    '--cb-markdown-hr-border-color',
    '--cb-button-dark-background',
    '--cb-button-dark-foreground',
    '--cb-button-dark-hover-background',
    '--cb-button-ghost-hover-background',
    '--cb-icon-button-hover-background',
    // --cb-vscode-* wrapper tokens
    '--cb-vscode-editor-background',
    '--cb-vscode-sideBar-background',
    '--cb-vscode-foreground',
    '--cb-vscode-editor-foreground',
    '--cb-vscode-descriptionForeground',
    '--cb-vscode-titleBar-activeBackground',
    '--cb-vscode-titleBar-activeForeground',
    '--cb-vscode-titleBar-inactiveBackground',
    '--cb-vscode-titleBar-inactiveForeground',
    '--cb-titlebar-control-hover-background',
    '--cb-vscode-input-background',
    '--cb-vscode-dropdown-background',
    '--cb-vscode-list-hoverBackground',
    '--cb-vscode-toolbar-hoverBackground',
    '--cb-vscode-scrollbarSlider-background',
    '--cb-vscode-scrollbarSlider-hoverBackground',
    '--cb-vscode-textLink-foreground',
    '--cb-vscode-widget-border',
    '--cb-vscode-panel-border',
    '--cb-vscode-button-background',
    '--cb-vscode-button-foreground',
    '--cb-vscode-button-hoverBackground',
    '--cb-vscode-button-secondaryBackground',
    '--cb-vscode-focusBorder',
    '--cb-vscode-list-activeSelectionForeground',
    '--cb-vscode-list-inactiveSelectionBackground',
    // native --vscode-* workbench layer
    '--vscode-foreground',
    '--vscode-descriptionForeground',
    '--vscode-disabledForeground',
    '--vscode-icon-foreground',
    '--vscode-focusBorder',
    '--vscode-errorForeground',
    '--vscode-textLink-foreground',
    '--vscode-textLink-activeForeground',
    '--vscode-textPreformat-foreground',
    '--vscode-textPreformat-background',
    '--vscode-textBlockQuote-background',
    '--vscode-textBlockQuote-border',
    '--vscode-textCodeBlock-background',
    '--vscode-editor-background',
    '--vscode-editor-foreground',
    '--vscode-editorWidget-background',
    '--vscode-editorWidget-foreground',
    '--vscode-editorWidget-border',
    '--vscode-editorHoverWidget-background',
    '--vscode-editorHoverWidget-foreground',
    '--vscode-editorHoverWidget-border',
    '--vscode-editor-selectionBackground',
    '--vscode-editor-inactiveSelectionBackground',
    '--vscode-editorCursor-foreground',
    '--vscode-input-background',
    '--vscode-input-foreground',
    '--vscode-input-border',
    '--vscode-input-placeholderForeground',
    '--vscode-inputOption-activeBorder',
    '--vscode-inputOption-activeBackground',
    '--vscode-button-foreground',
    '--vscode-button-background',
    '--vscode-button-hoverBackground',
    '--vscode-button-secondaryForeground',
    '--vscode-button-secondaryBackground',
    '--vscode-button-secondaryHoverBackground',
    '--vscode-list-activeSelectionBackground',
    '--vscode-list-activeSelectionForeground',
    '--vscode-list-hoverBackground',
    '--vscode-list-focusOutline',
    '--vscode-list-highlightForeground',
    '--vscode-menu-background',
    '--vscode-menu-foreground',
    '--vscode-menu-border',
    '--vscode-menu-selectionBackground',
    '--vscode-menu-selectionForeground',
    '--vscode-menu-separatorBackground',
    '--vscode-dropdown-background',
    '--vscode-dropdown-listBackground',
    '--vscode-dropdown-foreground',
    '--vscode-dropdown-border',
    '--vscode-sideBar-background',
    '--vscode-sideBar-foreground',
    '--vscode-sideBar-border',
    '--vscode-sideBarTitle-foreground',
    '--vscode-panel-background',
    '--vscode-panel-border',
    '--vscode-panelTitle-activeForeground',
    '--vscode-panelTitle-inactiveForeground',
    '--vscode-tab-activeBackground',
    '--vscode-tab-activeForeground',
    '--vscode-tab-activeBorderTop',
    '--vscode-tab-inactiveBackground',
    '--vscode-tab-inactiveForeground',
    '--vscode-badge-background',
    '--vscode-badge-foreground',
    '--vscode-diffEditor-insertedTextBackground',
    '--vscode-diffEditor-removedTextBackground',
    '--vscode-diffEditor-insertedLineBackground',
    '--vscode-diffEditor-removedLineBackground',
    '--vscode-terminal-background',
    '--vscode-terminal-foreground',
    '--vscode-terminal-selectionBackground',
    '--vscode-terminalCursor-foreground',
    '--vscode-scrollbarSlider-background',
    '--vscode-scrollbarSlider-hoverBackground',
    '--vscode-scrollbarSlider-activeBackground',
    // --sc-ui-* component library
    '--sc-ui-text',
    '--sc-ui-text-muted',
    '--sc-ui-text-on-primary',
    '--sc-ui-bg',
    '--sc-ui-bg-subtle',
    '--sc-ui-surface',
    '--sc-ui-surface-border',
    '--sc-ui-hover',
    '--sc-ui-active',
    '--sc-ui-focus-ring',
    '--sc-ui-border',
    '--sc-ui-separator',
    '--sc-ui-primary',
    '--sc-ui-primary-hover',
    '--sc-ui-primary-active',
    '--sc-ui-danger',
    '--sc-ui-success',
    '--sc-ui-warning',
    '--sc-ui-info',
    '--sc-text-default',
    '--sc-inline-code-bg',
    '--sc-bg-grey_background',
    '--sc-border-grey',
    '--sc-divider-default',
  ],
  doubao: [
    // --dbx-* semantic tokens
    '--dbx-bg-body-web',
    '--dbx-bg-base-web',
    '--dbx-bg-base-2',
    '--dbx-bg-base-5',
    '--dbx-bg-float',
    '--dbx-bg-body-overlay-web',
    '--dbx-bg-body-white',
    '--dbx-bg-body-mac',
    '--dbx-bg-base-mac',
    '--dbx-bg-browser-win',
    '--dbx-bg-browser-mac',
    '--dbx-bg-body-launcher',
    '--dbx-bg-body-overlay-launcher',
    '--dbx-bg-float-launcher',
    '--dbx-bg-body-overlay-mac',
    '--dbx-bg-body-overlay-white',
    '--dbx-bg-base-2-mobile',
    '--dbx-bg-base-2-overlay-mobile',
    '--dbx-bg-base-3-mobile',
    '--dbx-bg-base-3-enterprisebubble',
    '--dbx-bg-base-4-action',
    '--dbx-bg-base-1-overlay-mobile',
    '--dbx-bg-mask',
    '--dbx-text-primary',
    '--dbx-text-secondary',
    '--dbx-text-tertiary',
    '--dbx-text-disable',
    '--dbx-text-markdown',
    '--dbx-text-n00-primary',
    '--dbx-text-n00-secondary',
    '--dbx-text-n00-tertiary',
    '--dbx-text-n00-disable',
    '--dbx-text-highlight',
    '--dbx-text-highlight-secondary',
    '--dbx-text-highlight-hover',
    '--dbx-text-highlight-disable',
    '--dbx-brand-default',
    '--dbx-fill-highlight',
    '--dbx-fill-highlight-hover',
    '--dbx-fill-highlight-disable',
    '--dbx-fill-highlight-trans-10',
    '--dbx-fill-primary-50',
    '--dbx-fill-primary-60',
    '--dbx-fill-primary-transparent-1',
    '--dbx-fill-banner',
    '--dbx-fill-trans-10',
    '--dbx-fill-trans-10-hover',
    '--dbx-fill-trans-20',
    '--dbx-fill-trans-20-hover',
    '--dbx-fill-trans-30',
    '--dbx-fill-trans-30-hover',
    '--dbx-line-divider-5',
    '--dbx-line-divider-10',
    '--dbx-line-7',
    '--dbx-line-10',
    '--dbx-line-15',
    '--dbx-line-20-hover',
    '--dbx-line-highlight',
    '--dbx-code-text',
    '--dbx-code-doc',
    '--dbx-code-link',
    '--dbx-function-info',
    '--dbx-function-info-hover',
    '--dbx-function-info-disable',
    '--dbx-symbol-switch-toggle-disable',
    // --semi-color-* design system
    '--semi-color-bg-0',
    '--semi-color-bg-1',
    '--semi-color-bg-2',
    '--semi-color-bg-3',
    '--semi-color-bg-4',
    '--semi-color-text-0',
    '--semi-color-text-1',
    '--semi-color-text-2',
    '--semi-color-text-3',
    '--semi-color-primary',
    '--semi-color-primary-hover',
    '--semi-color-primary-active',
    '--semi-color-primary-light-default',
    '--semi-color-primary-light-hover',
    '--semi-color-primary-light-active',
    '--semi-color-primary-disabled',
    '--semi-color-focus-border',
    '--semi-color-secondary',
    '--semi-color-secondary-hover',
    '--semi-color-secondary-active',
    '--semi-color-secondary-light-default',
    '--semi-color-secondary-light-hover',
    '--semi-color-tertiary',
    '--semi-color-tertiary-hover',
    '--semi-color-tertiary-light-default',
    '--semi-color-fill-0',
    '--semi-color-fill-1',
    '--semi-color-fill-2',
    '--semi-color-border',
    '--semi-color-disabled-bg',
    '--semi-color-disabled-border',
    '--semi-color-disabled-fill',
    '--semi-color-disabled-text',
    '--semi-color-link',
    '--semi-color-link-hover',
    '--semi-color-link-active',
    '--semi-color-link-visited',
    '--semi-color-highlight',
    '--semi-color-highlight-bg',
    '--semi-color-shadow',
    '--semi-color-nav-bg',
    '--semi-color-overlay-bg',
    '--semi-color-info',
    '--semi-color-info-hover',
    '--semi-color-info-active',
    '--semi-color-info-disabled',
    '--semi-color-success',
    '--semi-color-success-hover',
    '--semi-color-success-active',
    '--semi-color-success-disabled',
    '--semi-color-warning',
    '--semi-color-warning-hover',
    '--semi-color-warning-active',
    '--semi-color-warning-disabled',
    '--semi-color-danger',
    '--semi-color-danger-hover',
    '--semi-color-danger-active',
    '--semi-color-danger-disabled',
    '--semi-color-black',
    '--semi-color-white',
    '--semi-color-default',
    '--semi-color-default-hover',
    '--semi-color-default-active',
    // markdown kit
    '--md-box-samantha-normal-text-color',
    '--md-box-samantha-deep-text-color',
    '--md-box-samantha-li-maker-color',
    '--md-box-samantha-split-line-color',
    '--md-box-samantha-blockquote-left-border-color',
    // links
    '--color-link-text',
    '--color-link-text-active',
    // gray ramp
    '--gray1',
    '--gray2',
    '--gray3',
    '--gray4',
    '--gray5',
    '--gray6',
    '--gray7',
    '--gray8',
    '--gray9',
    '--gray10',
    '--gray11',
    '--gray12',
    // semantic vars
    '--normal-bg',
    '--normal-bg-hover',
    '--normal-text',
    '--normal-border',
    '--hover-bg-color',
    '--active-bg-color',
    '--static-bg-color',
    '--error-bg',
    '--error-border',
    '--error-text',
    '--warning-bg',
    '--warning-border',
    '--warning-text',
    '--success-bg',
    '--success-border',
    '--success-text',
    '--info-bg',
    '--info-border',
    '--info-text',
    '--scrollbar-color-active',
    '--scrollbar-color-hover',
    '--scrollthumbcolor',
    '--input-guidance-input-container-background',
    '--input-guidance-input-container-border',
    '--input-guidance-input-editor-color',
    '--input-guidance-input-editor-placeholder-color',
    '--left-side',
  ],
  codex: [
    // flat shell tokens (consumed by engine adapter)
    '--text-primary',
    '--text-secondary',
    '--text-tertiary',
    '--text-quaternary',
    '--text-disabled',
    '--text-link',
    '--bg-primary',
    '--bg-secondary',
    '--bg-tertiary',
    '--bg-elevated',
    '--bg-base',
    '--bg-canvas',
    '--bg-surface',
    '--bg-hover',
    '--bg-active',
    '--bg-selected',
    '--fill-input',
    '--line-border',
    '--brand',
    '--brand-hover',
    '--code-bg',
    '--code-fg',
    '--focus-ring',
    '--border-xsubtle',
    '--border-subtle',
    '--border-medium',
    '--border-strong',
    '--accent',
    '--accent-hover',
    '--accent-pressed',
    '--accent-soft',
    '--accent-soft-hover',
    '--button-primary-bg',
    '--button-primary-fg',
    '--button-primary-hover',
    '--button-secondary-bg',
    '--button-secondary-fg',
    '--link',
    '--link-hover',
    '--input-bg',
    '--input-border',
    '--input-focus-ring',
    '--sidebar-bg',
    '--panel-bg',
    '--shadow-sm',
    '--shadow-md',
    '--shadow-lg',
    '--shadow-xl',
    '--selection-bg',
    // codex-native --color-token-* system
    '--color-token-primary',
    '--color-token-text-link-foreground',
    '--color-token-focus-border',
    '--color-token-bg-primary',
    '--color-token-side-bar-background',
    '--color-token-bg-secondary',
    '--color-token-bg-tertiary',
    '--color-token-main-surface-primary',
    '--color-token-diff-surface',
    '--color-token-dropdown-background',
    '--color-token-dropdown-foreground',
    '--color-token-foreground',
    '--color-token-text-primary',
    '--color-token-text-secondary',
    '--color-token-text-tertiary',
    '--color-token-description-foreground',
    '--color-token-border',
    '--color-token-border-default',
    '--color-token-border-light',
    '--color-token-border-heavy',
    '--color-token-input-border',
    '--color-token-list-hover-background',
    '--color-token-scrollbar-slider-hover-background',
  ],
  zcode: [
    // flat shell tokens (consumed by engine adapter)
    '--text-primary',
    '--text-secondary',
    '--text-tertiary',
    '--text-quaternary',
    '--bg-primary',
    '--bg-secondary',
    '--bg-tertiary',
    '--bg-elevated',
    '--bg-base',
    '--bg-canvas',
    '--bg-surface',
    '--bg-hover',
    '--bg-active',
    '--bg-selected',
    '--fill-input',
    '--line-border',
    '--brand',
    '--brand-hover',
    '--code-bg',
    '--code-fg',
    '--focus-ring',
    '--border-xsubtle',
    '--border-subtle',
    '--border-medium',
    '--border-strong',
    '--accent',
    '--accent-hover',
    '--accent-pressed',
    '--accent-soft',
    '--accent-soft-hover',
    '--button-primary-bg',
    '--button-primary-fg',
    '--button-primary-hover',
    '--button-secondary-bg',
    '--button-secondary-fg',
    '--link',
    '--link-hover',
    '--input-bg',
    '--input-border',
    '--input-focus-ring',
    '--sidebar-bg',
    '--panel-bg',
    '--shadow-sm',
    '--shadow-md',
    '--shadow-lg',
    '--shadow-xl',
    '--selection-bg',
    // zcode-native --color-* Tailwind v4 system
    '--color-background',
    '--color-surface',
    '--color-card',
    '--color-panel',
    '--color-sidebar',
    '--color-header',
    '--color-tab',
    '--color-tab-active',
    '--color-popover',
    '--color-menu',
    '--color-toast',
    '--color-tooltip',
    '--color-input',
    '--color-input-focused',
    '--color-background-alt',
    '--color-background-win-alt',
    '--color-surface-hover',
    '--color-selected',
    '--color-hover',
    '--color-foreground',
    '--color-foreground-subtle',
    '--color-foreground-subtlest',
    '--color-foreground-inverse',
    '--color-border',
    '--color-border-hover',
    '--color-input-border',
    '--color-input-border-hover',
    '--color-input-border-focused',
    '--color-card-border',
    '--color-tab-border',
    '--color-popover-border',
    '--color-accent',
    '--color-brand',
    '--color-primary',
    '--color-primary-foreground',
    '--color-secondary',
    '--color-destructive',
    '--color-destructive-foreground',
    '--color-success',
    '--color-success-foreground',
    '--color-warning',
    '--color-warning-foreground',
    '--color-interaction-ask-fill',
    '--color-interaction-ask-surface',
    '--color-interaction-ask-foreground',
    '--color-interaction-confirmation-surface',
    '--color-interaction-confirmation-foreground',
    '--color-command-node',
    '--color-command-node-hover',
    '--color-command-node-foreground',
    '--color-session-node',
    '--color-session-node-hover',
    '--color-session-node-foreground',
    '--color-file-node',
    '--color-file-node-hover',
    '--color-file-node-foreground',
    '--color-terminal-bg',
    '--color-terminal-fg',
    '--color-terminal-selection',
    '--color-terminal-selection-inactive',
    '--color-markdown-inline-code',
    '--color-diff-added',
    '--color-diff-removed',
    '--color-find-highlight',
    '--color-find-highlight-active',
    '--color-popover-foreground',
    '--color-popover-header',
    '--color-menu-hover',
    '--color-tooltip-tag',
    '--color-tooltip-tag-foreground',
    '--color-card-selected',
    '--color-diff-added-foreground',
    '--color-diff-removed-foreground',
    '--color-subagent-node',
    '--color-subagent-node-hover',
    '--color-subagent-node-foreground',
    '--color-plugin-node',
    '--color-plugin-node-hover',
    '--color-plugin-node-foreground',
    '--color-skill-node',
    '--color-skill-node-hover',
    '--color-skill-node-foreground',
    '--color-icon-blue',
  ],
};

// Minimal apply-time verification landmarks (mirrors deepspace-star manifest).
const VERIFICATION = {
  traework: { name: 'solo-shell', any: ['.panel-container', '.solo-lite-layout'] },
  qoderwork: { name: 'agents-root', any: ['.agents-layout-root'] },
  workbuddy: { name: 'teams-root', any: ['.teams-container'] },
  doubao: { name: 'doubao-root', any: ['#root', 'body'] },
  codex: { name: 'codex-root', any: ['main.main-surface', "main[class*='MainContentSurface']"] },
};

const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.18)',
  md: '0 4px 14px rgba(0,0,0,0.22)',
  lg: '0 10px 30px rgba(0,0,0,0.28)',
  xl: '0 20px 50px rgba(0,0,0,0.34)',
};

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * 优先级规则数组 — 先命中先返回。按语义特异性递减排序。
 *
 * 设计原则（修复 P1）：
 *   1. sideBar / titleBar 等半透明 surface 优先于 bg/background 泛化分支，
 *      避免 --vscode-sideBar-background 被错误映射到 --agentskin-bg（不透明），
 *      破坏 hand-authored 的 color-mix 透 hero 效果。
 *   2. description / muted 优先于 text/foreground 泛化分支，
 *      避免 --vscode-descriptionForeground 被误映射到 --agentskin-text。
 *   3. surface/panel 优先于 bg/background，因为侧栏背景本质是微透明 surface。
 */
const TOKEN_RULES = [
  // --- hover 类（最具体） ---
  {
    pattern: (t) => t.includes('hover'),
    result: (t, _v) => {
      if (
        t.includes('button') ||
        t.includes('accent') ||
        t.includes('brand') ||
        t.includes('primary')
      )
        return 'color-mix(in srgb, var(--agentskin-accent) 85%, #000)';
      if (t.includes('text') || t.includes('link'))
        return 'color-mix(in srgb, var(--agentskin-accent) 80%, #fff)';
      return null; // 非匹配 hover -> 继续
    },
  },
  // --- 侧边栏/标题栏：半透明 surface，必须在 bg/background 之前 ---
  {
    pattern: (t) =>
      t.includes('sidebar') ||
      t.includes('titlebar') ||
      t.includes('statusbar') ||
      t.includes('activitybar'),
    result: (_t, _v) => 'color-mix(in srgb, var(--agentskin-surface) 15%, transparent)',
  },
  // --- elevated / overlay ---
  {
    pattern: (t) => t.includes('elevated') || t.includes('overlay'),
    result: (_t, v) => v('--agentskin-surface-elevated'),
  },
  // --- surface / panel ---
  {
    pattern: (t) => t.includes('surface') || t.includes('panel'),
    result: (_t, v) => v('--agentskin-surface'),
  },
  // --- muted / disabled / description（必须在 text/foreground 之前） ---
  {
    pattern: (t) => t.includes('muted') || t.includes('disabled') || t.includes('description'),
    result: (_t, v) => v('--agentskin-muted'),
  },
  // --- secondary ---
  {
    pattern: (t) => t.includes('secondary'),
    result: (_t, v) => v('--agentskin-secondary'),
  },
  // --- border / line / stroke / divider / widget ---
  {
    pattern: (t) =>
      t.includes('border') ||
      t.includes('line') ||
      t.includes('stroke') ||
      t.includes('divider') ||
      t.includes('widget'),
    result: (_t, v) => v('--agentskin-border'),
  },
  // --- input / fill ---
  {
    pattern: (t) => t.includes('input') || t.includes('fill'),
    result: (_t, v) => v('--agentskin-input-bg'),
  },
  // --- code boundaries (-code- 或尾部 -code-bg/-code-fg) ---
  {
    pattern: (t) => t.includes('-code-') || /-code(?:-bg|-fg)$/.test(t),
    result: (t, v) => (/code-fg/.test(t) ? v('--agentskin-code-fg') : v('--agentskin-code-bg')),
  },
  // --- scrollbar / focus / selection / ring ---
  {
    pattern: (t) =>
      t.includes('scrollbar') ||
      t.includes('focus') ||
      t.includes('selection') ||
      t.includes('ring'),
    result: (_t, v) => v('--agentskin-focus-ring'),
  },
  // --- text / foreground / fg（泛化） ---
  {
    pattern: (t) => t.includes('text') || t.includes('foreground') || t.includes('fg'),
    result: (_t, v) => v('--agentskin-text'),
  },
  // --- accent / brand / link / primary / button ---
  {
    pattern: (t) =>
      t.includes('accent') ||
      t.includes('brand') ||
      t.includes('link') ||
      t.includes('primary') ||
      t.includes('button'),
    result: (_t, v) => v('--agentskin-accent'),
  },
  // --- bg / background（最终 fallback） ---
  {
    pattern: (t) => t.includes('bg') || t.includes('background'),
    result: (_t, v) => v('--agentskin-bg'),
  },
];

/** Map a native agent token name to a crafted palette value (CSS expression).
 *  @see TOKEN_RULES 优先级规则数组。 */
function valueForToken(token) {
  const t = token.toLowerCase();
  const v = (name) => `var(${name})`;
  for (const rule of TOKEN_RULES) {
    if (rule.pattern(t)) {
      const out = rule.result(t, v);
      if (out !== null) return out;
    }
  }
  return v('--agentskin-bg');
}

// ---------------------------------------------------------------------------
// Tiny PNG encoder (zlib only, no native deps)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** pixelFn(x, y) -> [r, g, b] */
function makePng(width, height, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Palette assembly
// ---------------------------------------------------------------------------

export function buildAgentCss(agentId, palette, signature, bridge, rawKeyframes) {
  // Delegate to the internal implementation (defined below) so the compiler
  // CLI can reuse the same CSS generation without disk I/O.
  return buildAgentCssInternal(agentId, palette, signature, bridge, rawKeyframes);
}

export function deriveTokens(root) {
  // A-08 / Q18：拒绝"残缺提取"——调用方传入非空 root 却无任何 --agentskin-* token，
  // 静默回退 DEFAULT_TOKENS 会让产物被默认紫色污染而不报错。此处直接拒绝并说明原因。
  if (root && typeof root === 'object' && Object.keys(root).length > 0) {
    const themed = Object.keys(root).filter((k) => k.startsWith('--agentskin-'));
    if (themed.length === 0) {
      throw new Error(
        `[build-theme-package] deriveTokens: root 含 ${Object.keys(root).length} 个键但无任何 ` +
          '`--agentskin-*` 主题 token —— 疑似残缺提取，拒绝回退到 DEFAULT_TOKENS 掩蔽。',
      );
    }
  }
  const tokens = { ...DEFAULT_TOKENS };
  if (root && typeof root === 'object') {
    for (const [k, val] of Object.entries(root)) {
      if (typeof k === 'string' && k.startsWith('--agentskin-') && typeof val === 'string') {
        tokens[k] = val;
      }
    }
  }
  // --- P1 fix: selection / focus-ring 从 accent 派生，避免 DEFAULT 紫色泄漏 ---
  // 与 build-palette.mjs 行为一致：selection = color-mix(accent 32%), focus-ring = color-mix(accent 40%)。
  // 调用方传入 explicit 值时保留；DEFAULT_TOKENS 仅作回退基线。
  const rootSelection =
    root && typeof root === 'object' ? root['--agentskin-selection'] : undefined;
  const rootFocusRing =
    root && typeof root === 'object' ? root['--agentskin-focus-ring'] : undefined;
  if (rootSelection === undefined || rootSelection === DEFAULT_TOKENS['--agentskin-selection']) {
    tokens['--agentskin-selection'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 32%, transparent)`;
  }
  if (rootFocusRing === undefined || rootFocusRing === DEFAULT_TOKENS['--agentskin-focus-ring']) {
    tokens['--agentskin-focus-ring'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 40%, transparent)`;
  }
  // --- P2 fix: input-bg / button-bg post-override 派生，与 tokenBlock() 一致 ---
  // input-bg = color-mix(surface 82% + accent 18%) 45% + transparent（theme-utils.mjs L220）。
  // button-bg = accent（theme-utils.mjs L208）。
  // 避免 deriveTokens() 在 accent/surface 被 override 后仍回退到 DEFAULT 硬编码值。
  const rootInputBg = root && typeof root === 'object' ? root['--agentskin-input-bg'] : undefined;
  const rootButtonBg = root && typeof root === 'object' ? root['--agentskin-button-bg'] : undefined;
  if (rootInputBg === undefined || rootInputBg === DEFAULT_TOKENS['--agentskin-input-bg']) {
    tokens['--agentskin-input-bg'] =
      `color-mix(in srgb, color-mix(in srgb, ${tokens['--agentskin-surface']} 82%, ${tokens['--agentskin-accent']} 18%) 45%, transparent)`;
  }
  if (rootButtonBg === undefined || rootButtonBg === DEFAULT_TOKENS['--agentskin-button-bg']) {
    tokens['--agentskin-button-bg'] = tokens['--agentskin-accent'];
  }
  // --- button-fg / text-shadow 派生，与 tokenBlock() 一致 ---
  // button-fg: 根据背景色亮度选择 #000000 或 #ffffff，保证对比度。
  // text-shadow: 亮色主题为空，暗色主题为 0 1px 2px rgba(0,0,0,0.3)。
  if (!('--agentskin-button-fg' in tokens)) {
    tokens['--agentskin-button-fg'] =
      luminance(tokens['--agentskin-bg']) < 0.5 ? '#ffffff' : '#000000';
  }
  if (!('--agentskin-text-shadow' in tokens)) {
    tokens['--agentskin-text-shadow'] =
      luminance(tokens['--agentskin-bg']) < 0.5 ? '0 1px 2px rgba(0,0,0,0.3)' : '';
  }
  const mode = luminance(tokens['--agentskin-bg']) < 0.5 ? 'dark' : 'light';
  return { tokens, mode };
}

function manifestColors(tokens) {
  const accent = tokens['--agentskin-accent'];
  const buttonBg = tokens['--agentskin-button-bg'] || accent;
  // buttonForeground: 基于按钮背景亮度决定文字色（暗色背景 -> 白字，亮色背景 -> 近黑）。
  // 替代硬编码 '#ffffff'，与源主题 buttonForeground 语义一致。
  const buttonFg = luminance(buttonBg) < 0.5 ? '#ffffff' : '#1a1a2e';
  return {
    accent,
    secondary: tokens['--agentskin-secondary'],
    background: tokens['--agentskin-bg'],
    foreground: tokens['--agentskin-text'],
    muted: tokens['--agentskin-muted'],
    surface: tokens['--agentskin-surface'],
    surfaceElevated: tokens['--agentskin-surface-elevated'],
    border: tokens['--agentskin-border'],
    codeBackground: tokens['--agentskin-code-bg'],
    codeForeground: tokens['--agentskin-code-fg'],
    inputBackground: tokens['--agentskin-input-bg'],
    buttonBackground: tokens['--agentskin-button-bg'],
    buttonForeground: buttonFg,
    focusRing: tokens['--agentskin-focus-ring'],
    selection: tokens['--agentskin-selection'],
  };
}

// ---------------------------------------------------------------------------
// CSS assembly
// ---------------------------------------------------------------------------

function buildAgentCssInternal(agentId, palette, signature, bridge, rawKeyframes) {
  const lines = [];
  const mode = palette.mode === 'light' ? 'light' : 'dark';
  const host = HOST_SELECTOR[agentId] || `html.agentskin-host-${agentId}`;
  lines.push(`/* AgentSkin Studio export — ${agentId} */`);
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const [k, val] of Object.entries(palette.tokens)) lines.push(`  ${k}: ${val};`);
  lines.push('}');

  // λ P0-2: sanitize user-declared keyframes before emit (fail-closed).
  if (rawKeyframes) {
    const sanitized = sanitizeKeyframes(rawKeyframes, {
      allowPaletteTokens: true,
      namespacePrefix: 'agentskin-',
    });
    if (sanitized.isBlocked) {
      console.warn(
        `[build-theme-package] ⚠ keyframes blocked for ${agentId}: ${sanitized.violations.join('; ')}`,
      );
      // fail-closed: skip this keyframes, continue build.
    } else {
      if (sanitized.violations.length > 0) {
        console.warn(
          `[build-theme-package] ⚠ keyframes warnings for ${agentId}: ${sanitized.violations.join('; ')}`,
        );
      }
      lines.push(sanitized.clean);
    }
  }
  // Variable bridge: when the Studio export request declares a bridge mapping,
  // emit client-native variable declarations that resolve through agentskin tokens.
  // SECURITY: sanitize each bridge value to prevent CSS injection.
  if (bridge && typeof bridge === 'object' && Object.keys(bridge).length > 0) {
    lines.push('/* Variable bridge (Studio): client-native → agentskin tokens */');
    lines.push(`${host} {`);
    for (const [k, val] of Object.entries(bridge)) {
      const bridgeSanitized = sanitizeDeclarationBlock(String(val), {
        allowPaletteTokens: true,
      });
      if (bridgeSanitized.isBlocked) {
        console.warn(
          `[build-theme-package] ⚠ bridge value for "${k}" blocked (agent=${agentId}): ${bridgeSanitized.violations.join('; ')}`,
        );
        continue;
      }
      lines.push(`  ${k}: ${bridgeSanitized.clean};`);
    }
    lines.push('}');
  }
  lines.push('');

  // host 已在函数顶部定义，此处复用。
  const remap = AGENT_REMAP[agentId] || [];
  lines.push(`/* Redirect ${agentId} native design tokens onto the crafted palette */`);
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const tk of remap) lines.push(`  ${tk}: ${valueForToken(tk)} !important;`);
  lines.push('}');
  lines.push('');

  const craft = buildCraft(agentId, signature);
  if (craft) {
    lines.push(craft);
    lines.push('');
  }
  return lines.join('\n');
}

function buildCraft(agentId, signature) {
  if (!signature || typeof signature !== 'object') return '';
  const el = `html.agentskin-host-${agentId}`;
  const out = ['/* Craft overrides — Studio toolbox dimensions */'];
  if (signature.radius) {
    out.push(
      `${el} button, ${el} input, ${el} textarea, ${el} select, ${el} [role="textbox"], ${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"] { border-radius: ${signature.radius} !important; }`,
    );
    out.push(`:root { --as-radius: ${signature.radius}; }`);
  }
  if (signature.spacing != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="sidebar"], ${el} [class*="Panel"], ${el} [class*="Sidebar"] { padding: ${signature.spacing}px !important; }`,
    );
    out.push(`:root { --as-spacing: ${signature.spacing}px; }`);
  }
  if (signature.shadowLevel && signature.shadowLevel !== 'none' && SHADOWS[signature.shadowLevel]) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="card"], ${el} [class*="elevated"], ${el} [class*="surface"] { box-shadow: ${SHADOWS[signature.shadowLevel]} !important; }`,
    );
    out.push(`:root { --as-shadow-level: ${signature.shadowLevel}; }`);
  }
  if (signature.blurPx != null && signature.blurPx > 0) {
    out.push(
      `${el} [class*="sidebar"], ${el} [class*="overlay"], ${el} [class*="modal"], ${el} [class*="navbar"], ${el} [class*="topbar"], ${el} header { backdrop-filter: blur(${signature.blurPx}px) !important; }`,
    );
    out.push(`:root { --as-blur: ${signature.blurPx}px; }`);
  }
  if (signature.fontSize != null) {
    out.push(`${el} body { font-size: ${signature.fontSize}px !important; }`);
    out.push(`:root { --as-font-size: ${signature.fontSize}px; }`);
  }
  if (signature.fontFam) {
    out.push(`${el} body { font-family: ${signature.fontFam} !important; }`);
    out.push(`:root { --as-font-family: ${signature.fontFam}; }`);
  }
  if (signature.duration) {
    out.push(`${el} body, ${el} body * { transition-duration: ${signature.duration} !important; }`);
    out.push(`:root { --as-transition-duration: ${signature.duration}; }`);
  }
  if (signature.timing) {
    out.push(
      `${el} body, ${el} body * { transition-timing-function: ${signature.timing} !important; }`,
    );
    out.push(`:root { --as-transition-timing: ${signature.timing}; }`);
  }
  // color (re-themed by role)
  if (signature.accent) {
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="active"], ${el} [class*="Active"], ${el} [class*="selected"], ${el} [class*="Selected"], ${el} a { color: ${signature.accent} !important; border-color: ${signature.accent} !important; }`,
    );
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="selected"], ${el} [class*="Selected"] { background-color: ${signature.accent} !important; }`,
    );
    out.push(
      `:root { --agentskin-accent: ${signature.accent}; --as-accent: ${signature.accent}; }`,
    );
  }
  if (signature.background) {
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-color: ${signature.background} !important; }`,
    );
    out.push(
      `:root { --agentskin-background: ${signature.background}; --as-bg: ${signature.background}; }`,
    );
  }
  if (signature.foreground) {
    out.push(`${el} body { color: ${signature.foreground} !important; }`);
    out.push(
      `:root { --agentskin-foreground: ${signature.foreground}; --as-fg: ${signature.foreground}; }`,
    );
  }
  if (signature.surface) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"] { background-color: ${signature.surface} !important; }`,
    );
    out.push(
      `:root { --agentskin-surface: ${signature.surface}; --as-surface: ${signature.surface}; }`,
    );
  }
  // gradient accent background (bakeable)
  if (signature.gradientAccent) {
    const g =
      signature.accent && signature.background
        ? `linear-gradient(135deg, ${signature.accent} 0%, ${signature.background} 72%)`
        : 'linear-gradient(135deg, var(--agentskin-accent) 0%, var(--agentskin-bg) 72%)';
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-image: ${g} !important; }`,
    );
    out.push(`:root { --as-grad: ${g}; }`);
  }
  // structure
  if (signature.borderWidth != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"], ${el} [class*="sidebar"], ${el} [class*="Sidebar"] { border-width: ${signature.borderWidth}px !important; }`,
    );
  }
  if (signature.lineHeight != null) {
    out.push(`${el} body { line-height: ${signature.lineHeight} !important; }`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 2a multi-asset: image packaging
// ---------------------------------------------------------------------------

const IMAGE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/;
const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
/** Installer reserves 3 bundle slots (hero/icon/preview); the creative image
 *  set the Studio may declare is therefore 32 − 3 = 29, so the final bundle
 *  never trips the engine's MAX_THEME_IMAGES gate at install time. */
const MAX_THEME_CREATIVE_IMAGES = MAX_THEME_IMAGES - 3;
const RESERVED_IMAGE_IDS = new Set(['icon', 'preview']);

/**
 * Normalize `request.images` (image id → base64 data URL) into embeddable
 * image records `{ filename, mimeType, base64 }` or external-file records
 * `{ filename, mimeType, filePath }`, enforcing the SAME gates as the B-line
 * engine validator (RFC themes-asset-injection-2a §2.3):
 * SAFE_ID ids, SAFE_IMAGE_TYPES mime whitelist, ≤29 creative images and the
 * 8MB cumulative base64 ceiling (external-file images are exempt from the
 * base64 ceiling since they are copied as raw bytes). `hero` is the backdrop
 * special case.
 * Returns null when no images are declared (backward compatible).
 */
function processThemeImages(request) {
  const raw = request?.images;
  if (!raw) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[build-theme-package] images must be an object keyed by image id.');
  }
  const entries = Object.entries(raw);
  if (!entries.length)
    throw new Error('[build-theme-package] images must not be empty when provided.');
  if (entries.length > MAX_THEME_CREATIVE_IMAGES) {
    throw new Error(
      `[build-theme-package] images exceeds ${MAX_THEME_CREATIVE_IMAGES} creative entries ` +
        `(max ${MAX_THEME_IMAGES} minus ${3} reserved hero/icon/preview slots).`,
    );
  }
  const images = {};
  let totalBase64 = 0;
  for (const [id, value] of entries) {
    if (!IMAGE_ID.test(id)) throw new Error(`[build-theme-package] invalid image id '${id}'.`);
    if (RESERVED_IMAGE_IDS.has(id)) {
      throw new Error(
        `[build-theme-package] '${id}' is a reserved image id (icon/preview are system-managed).`,
      );
    }

    let mimeType;
    let base64 = null;
    let filePath = null;
    let providedFilename = null;

    if (typeof value === 'string') {
      // Data URL format: data:image/png;base64,...
      const match = DATA_URL.exec(value.trim());
      if (!match) {
        throw new Error(`[build-theme-package] images.${id} dataUrl is not a base64 data URL.`);
      }
      mimeType = match[1].toLowerCase();
      base64 = match[2].replace(/\s+/g, '');
    } else if (value && typeof value === 'object') {
      // Object format: { filename, mimeType, base64 } or { filename, mimeType, file }
      const obj = value;
      if (typeof obj.mimeType !== 'string') {
        throw new Error(`[build-theme-package] images.${id}.mimeType must be a string.`);
      }
      mimeType = obj.mimeType.toLowerCase();
      if (typeof obj.base64 === 'string') {
        base64 = obj.base64.replace(/\s+/g, '');
      } else if (typeof obj.file === 'string') {
        // External-file mode: copy from this path instead of embedding base64.
        filePath = obj.file;
      } else {
        throw new Error(
          `[build-theme-package] images.${id} must provide either base64 or file path.`,
        );
      }
      if (obj.filename != null) {
        if (typeof obj.filename !== 'string') {
          throw new Error(`[build-theme-package] images.${id}.filename must be a string.`);
        }
        providedFilename = obj.filename;
      }
    } else {
      throw new Error(
        `[build-theme-package] images.${id} must be a base64 data URL string or an image object.`,
      );
    }

    if (!SAFE_IMAGE_TYPES.has(mimeType)) {
      throw new Error(
        `[build-theme-package] images.${id} mimeType '${mimeType}' is not supported.`,
      );
    }
    if (base64 != null) {
      totalBase64 += base64.length;
    }
    images[id] = {
      filename: providedFilename || `${id}${EXT_BY_MIME[mimeType]}`,
      mimeType,
      ...(base64 != null ? { base64 } : {}),
      ...(filePath != null ? { filePath } : {}),
    };
  }
  if (totalBase64 > MAX_THEME_IMAGE_BASE64) {
    throw new Error(
      `[build-theme-package] images cumulative base64 exceeds ${MAX_THEME_IMAGE_BASE64} bytes.`,
    );
  }
  return images;
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

function slugify(name) {
  return (
    (name || 'studio-theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'studio-theme'
  );
}

function buildManifest(request, agentId, palette, images) {
  const id =
    (request.meta?.id && slugify(request.meta.id)) ||
    slugify(request.meta?.name) ||
    `${agentId}-studio-${new Date().toISOString().slice(0, 10)}`;
  const name = request.meta?.name || 'Studio Theme';
  const author = request.meta?.author || 'AgentSkin Studio';
  const mode = palette.mode;
  const verify = VERIFICATION[agentId];
  // 2a multi-asset: `hero` (backdrop special case of `images.hero`) +
  // `assets.images` (id → relative file path) mirror the B-line
  // `bundle.assets.images` contract so the installer can embed them.
  const imageEntries = images ? Object.entries(images) : [];
  const heroFile = images?.hero ? `assets/images/${images.hero.filename}` : undefined;
  const assets = imageEntries.length
    ? {
        images: Object.fromEntries(
          imageEntries.map(([imgId, img]) => [imgId, `assets/images/${img.filename}`]),
        ),
      }
    : undefined;
  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    format: 'agentskin-theme',
    id,
    name,
    displayName: name,
    version: '1.0.0',
    description: `由 AgentSkin 工作室导出（${agentId}）`,
    author: { name: author },
    mode,
    targets: {
      [agentId]: {
        css: `assets/css/${agentId}.css`,
        verification: verify ? { required: [{ name: verify.name, any: verify.any }] } : undefined,
      },
    },
    colors: manifestColors(palette.tokens),
    preview: 'preview.png',
    icon: 'icon.png',
    ...(heroFile ? { hero: heroFile } : {}),
    ...(assets ? { assets } : {}),
    category: 'studio',
    tags: ['studio', 'custom', mode],
    unofficial: true,
    supportedAgents: [agentId],
    probe: {
      tokenNamespaces: [
        '--agentskin-',
        '--cb-',
        '--vscode-',
        '--color-',
        '--dbx-',
        '--wb-',
        '--text-',
      ],
      styleContract: 'THEME_SPEC.md#探针样式契约',
    },
  };
}

// ---------------------------------------------------------------------------
// Preview / icon raster (palette-driven)
// ---------------------------------------------------------------------------

function buildPreview(palette) {
  const bg = hexToRgb(palette.tokens['--agentskin-bg']) || [32, 26, 64];
  const surface = hexToRgb(palette.tokens['--agentskin-surface']) || [43, 37, 74];
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 480;
  const H = 300;
  return makePng(W, H, (x, y) => {
    const t = y / H;
    const r = Math.round(bg[0] + (surface[0] - bg[0]) * t);
    const g = Math.round(bg[1] + (surface[1] - bg[1]) * t);
    const b = Math.round(bg[2] + (surface[2] - bg[2]) * t);
    // accent rounded bar near bottom
    const inBar = y > H - 70 && x > 40 && x < W - 40 && y - (H - 70) < 36;
    if (inBar) return accent;
    return [r, g, b];
  });
}

function buildIcon(palette) {
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 128;
  const H = 128;
  const rad = 28;
  return makePng(W, H, (x, y) => {
    const dx = Math.min(x, W - 1 - x);
    const dy = Math.min(y, H - 1 - y);
    const corner = Math.min(dx, dy);
    if (corner < rad - 6) {
      const edge = rad - corner;
      if (edge > 6) return [0, 0, 0]; // transparent-ish (will be clipped by rounded corner)
    }
    return accent;
  });
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function buildThemePackage(request, outDir) {
  // A-10 / Q13：非法或缺失 agentId 直接拒绝，避免静默生成"空白主题包"。
  if (!request?.agentId || typeof request.agentId !== 'string') {
    throw new Error(
      '[build-theme-package] Missing request.agentId — must be one of: ' +
        ['codex', 'doubao', 'workbuddy', 'qoderwork', 'traework', 'zcode'].join(', '),
    );
  }
  getAdapter(request.agentId); // 抛错即拒绝非法 agentId
  const agentId = request.agentId;
  const palette = deriveTokens(request?.root);
  // 2a multi-asset: normalize + gate the declared image set (null when absent).
  const images = processThemeImages(request);
  const manifest = buildManifest(request, agentId, palette, images);
  const bridge =
    request?.variableBridge && typeof request.variableBridge === 'object'
      ? request.variableBridge
      : null;
  const css = buildAgentCss(
    agentId,
    palette,
    request?.signature,
    bridge,
    request?.declarations?.keyframes,
  );

  // λ P0-1: specificity guard — detect + warn only (backward compatible).
  const agentProfile = AGENT_SPECIFICITY_PROFILES[agentId];
  if (agentProfile) {
    const report = validateSpecificity(css, agentProfile);
    if (report.violated) {
      console.warn(
        `[build-theme-package] ⚠ specificity budget exceeded for ${agentId}: ` +
          `${report.actualBudget}/${agentProfile.importantBudget}`,
      );
      console.warn(`  Recommendations: ${report.recommendations.join('; ')}`);
    }
  }

  const pkgDir = path.join(outDir, `${manifest.id}.agentskin-theme`);
  fs.mkdirSync(path.join(pkgDir, 'assets', 'css'), { recursive: true });
  if (images) fs.mkdirSync(path.join(pkgDir, 'assets', 'images'), { recursive: true });

  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(pkgDir, 'assets', 'css', `${agentId}.css`), css, 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'preview.png'), buildPreview(palette));
  fs.writeFileSync(path.join(pkgDir, 'icon.png'), buildIcon(palette));

  // 2a multi-asset: write each image into assets/images/<id>.<ext> so the
  // manifest's `hero` + `assets.images` references resolve at install time.
  // External-file images are copied from their source path; base64 images are
  // decoded and written.
  if (images) {
    for (const img of Object.values(images)) {
      const destPath = path.join(pkgDir, 'assets', 'images', img.filename);
      if (img.filePath) {
        fs.copyFileSync(img.filePath, destPath);
      } else {
        fs.writeFileSync(destPath, Buffer.from(img.base64, 'base64'));
      }
    }
  }

  // Build fingerprint: generate SHA-256 integrity manifest covering
  // manifest.json + per-agent CSS files. Written last so it hashes the
  // final state of all fingerprinted files.
  const fingerprint = await generateBuildFingerprint(pkgDir);
  fs.writeFileSync(
    path.join(pkgDir, FINGERPRINT_FILENAME),
    `${JSON.stringify(fingerprint, null, 2)}\n`,
    'utf8',
  );

  return pkgDir;
}

// Allow direct CLI invocation for local testing (not used by the app).
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.join(process.cwd(), 'theme-workbench', 'out');
  const dir = await buildThemePackage(
    {
      agentId: 'workbuddy',
      meta: { name: 'CLI Test', author: 'tester' },
      root: {},
      signature: { radius: '14px', shadowLevel: 'md' },
    },
    out,
  );
  console.log('wrote', dir);
}
