// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Entry Point
 *
 * Standalone entry for the Theme Studio window. Mirrors `src/renderer.tsx`
 * (the main window entry) but mounts `StudioApp` instead of `App` so the
 * studio renders in its own dedicated {@link BrowserWindow} without the
 * sidebar / workspace navigation of the main app.
 *
 * Shared with the main window:
 *   - same preload bridge (`window.agentSkin`) and IPC surface
 *   - same global stylesheet (Tailwind tokens, theme-mode)
 *   - same `useAppController` bootstrap (locale, status, installed themes)
 */

import { StrictMode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

import { createRoot } from 'react-dom/client';
import { applyThemeMode, getStoredThemeMode } from './ui/design/theme-mode';
import StudioApp from './ui/StudioApp';
import './ui/globals.css';
import './ui/styles/workspace.css';

// Apply the persisted theme before the first paint to avoid a flash.
applyThemeMode(getStoredThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StudioApp />
    </ErrorBoundary>
  </StrictMode>,
);
