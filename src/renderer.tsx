// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';

import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { applyThemeMode, getStoredThemeMode } from './ui/design/theme-mode';
import './ui/globals.css';

// Typography — bundled locally (electron is offline-capable; CDN fonts
// would be blocked by CSP anyway). IBM Patin-only for labels/numbers;
// Chinese falls back to system fonts (YaHei/PingFang).
// Note: Space Grotesk removed — not used in any UI component.
// Only latin subset needed (no cyrillic/vietnamese for code display).
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';

// Apply the persisted theme before the first paint to avoid a flash.
applyThemeMode(getStoredThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
