// SPDX-License-Identifier: MPL-2.0
// SINGLE SOURCE OF TRUTH for AgentSkin brand palette + installer skin specs.
// Consumed by:
//   - scripts/generate-nsis-assets.mjs  -> BMP gradients + build/brand.nsh
//   - build/installer.nsh               -> via !include "brand.nsh"
// Keep all brand colors / installer-bitmap specs here.

export const BRAND = {
  primary: '#241B54',
  accent: '#7C3AED',
  accentLight: '#9F67F2',
  surface: '#F6F5FB',
  text: '#1A1A2E',
  textLight: '#6B6B80',

  sidebar: { top: '#241B54', bottom: '#0B0918' },
  uninstallerSidebar: { top: '#18181C', bottom: '#0B0914' },
  header: { top: '#241B54', bottom: '#4C1D95' },

  bmp: {
    header: { w: 150, h: 57, name: 'header' },
    sidebar: { w: 164, h: 314, name: 'sidebar' },
    uninstallerSidebar: { w: 164, h: 314, name: 'uninstaller-sidebar' },
  },

  title: 'AgentSkin',
  subtitle: 'Themes for AI Coding Tools',
  uninstallSubtitle: 'Uninstall',
};

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

export const hexToNsis = (hex) => '0x' + hex.replace('#', '').toUpperCase();
