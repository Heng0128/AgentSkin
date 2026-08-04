// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';

import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { applyThemeMode, getStoredThemeMode } from './ui/design/theme-mode';
import './ui/globals.css';

// Swiss typography — bundled locally (electron is offline-capable; CDN fonts
// would be blocked by CSP anyway). Space Grotesk for display, IBM Plex Mono
// for labels/numbers; Chinese falls back to system fonts (YaHei/PingFang).
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';

// Apply the persisted theme before the first paint to avoid a flash.
applyThemeMode(getStoredThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
