// SPDX-License-Identifier: MPL-2.0
/**
 * # Component Inventory — Design System Audit
 *
 * 完整组件清单，标记可复用/需重写项。
 * 日期: 2026-08-26
 */

# Component Inventory — 2026-08-26

## Atoms (`src/ui/components/ui/`)

| Component | Status | Notes |
|-----------|--------|-------|
| `accordion.tsx` | ✅ | Radix-based, dark/light ready |
| `avatar.tsx` | ✅ | — |
| `badge.tsx` | ✅ | text-[11px] baseline, 7 variants |
| `button.tsx` | ✅ | 7 variants × 7 sizes, duration-base |
| `checkbox.tsx` | ✅ | — |
| `collapsible.tsx` | ✅ | — |
| `command.tsx` | ✅ | cmdk-based |
| `date-picker.tsx` | ✅ | react-day-picker |
| `dialog.tsx` | ✅ | Radix-based |
| `dropdown-menu.tsx` | ✅ | Radix-based |
| `empty-state.tsx` | ✅ | as-breathe animation |
| `filter-chips.tsx` | ✅ | — |
| `huge-icon.tsx` | ✅ | — |
| `input-group.tsx` | ✅ | — |
| `input.tsx` | ✅ | text-[12px] baseline |
| `navigation-menu.tsx` | ✅ | — |
| `page-header.tsx` | ✅ | — |
| `page-toolbar.tsx` | ✅ | — |
| `pagination.tsx` | ✅ | — |
| `popover.tsx` | ✅ | — |
| `progress.tsx` | ✅ | determinate + indeterminate |
| `resizable.tsx` | ✅ | — |
| `scroll-area.tsx` | ✅ | — |
| `section-label.tsx` | ✅ | — |
| `segmented-control.tsx` | ✅ | radiogroup ARIA, arrow keys |
| `select.tsx` | ✅ | — |
| `separator.tsx` | ✅ | — |
| `sheet.tsx` | ✅ | — |
| `skeleton.tsx` | ✅ | shimmer effect |
| `sonner.tsx` | ✅ | toast |
| `spinner.tsx` | ✅ | i18n label |
| `switch.tsx` | ✅ | — |
| `table.tsx` | ✅ | — |
| `tabs.tsx` | ✅ | line + default variants |
| `textarea.tsx` | ✅ | — |
| `toggle-group.tsx` | ✅ | — |
| `toggle.tsx` | ✅ | — |
| `tooltip.tsx` | ✅ | — |

## Molecules

| Component | Status | Notes |
|-----------|--------|-------|
| `ThemeCard.tsx` | ✅ | as-shine, hover lift |
| `CommunityThemeCard.tsx` | ⚠️ | onClick/className props partially added |
| `ThemeDetailPanel.tsx` | ✅ | w-[400px] standardized |
| `DetailPanel.tsx` | ✅ | aria-label, w-[400px] |
| `WallpaperCard.tsx` | ✅ | IntersectionObserver lazy-load |
| `InjectResultsPanel.tsx` | ✅ | w-[360px] |
| `RenderSettingsPanel.tsx` | ✅ | — |
| `EnvironmentCard.tsx` | ✅ | — |
| `EnvironmentGrid.tsx` | ✅ | — |
| `AgentDetailSheet.tsx` | ✅ | — |
| `AgentStatusBar.tsx` | ✅ | — |
| `AgentStatusDot.tsx` | ✅ | — |
| `AgentLivePreview.tsx` | ✅ | dual preview |
| `TweakPanel.tsx` | ✅ | collapsible groups |
| `AppCard.tsx` | ✅ | — |

## Studio Components

| Component | Status | Notes |
|-----------|--------|-------|
| `StudioTopBar.tsx` | ✅ | rounded-md standardized |
| `StudioDrawer.tsx` | ✅ | cn() refactor done |
| `StudioStatusBar.tsx` | ✅ | — |
| `FloatingToolbar.tsx` | ✅ | — |
| `PreviewWindow.tsx` | ✅ | — |
| `StudioInspector.tsx` | ✅ | — |
| `StudioImageToThemePanel.tsx` | ✅ | — |
| `ParticleOverlay.tsx` | ✅ New | CSS-only particle system |
| `DynamicBackground.tsx` | ✅ | parallax + scrim |
| `CenterTabThemeEditor.tsx` | ✅ | design language controls |
| `CenterTabWallpaper.tsx` | ✅ | — |
| `CenterTabRaw.tsx` | ✅ | — |
| `CenterTabBundle.tsx` | ✅ | — |

## Pages

| Page | Status | Notes |
|------|--------|-------|
| `AppsPage.tsx` | ✅ | DOM slimmed |
| `ThemesPage.tsx` | ✅ | VirtualThemeGrid + tabs |
| `WorkspacePage.tsx` | ✅ | 3-column layout |
| `SettingsPage.tsx` | ✅ | — |
| `StudioPage.tsx` | ✅ | — |

## Design Token Layers

| Layer | Source | Notes |
|-------|--------|-------|
| CSS Variables | `globals.css` | 5-level depth, dark/light |
| TS Color Contract | `design/colors.ts` | semanticColors + brandColors |
| Theme Mode | `design/theme-mode.ts` | dark/light/system + matchMedia |
| Tailwind Config | `shadcn-tailwind.css` | @theme inline, @utility |
| Animations | `globals.css` | as-shine, as-breathe, as-slide-up-enter, as-particle-* |
