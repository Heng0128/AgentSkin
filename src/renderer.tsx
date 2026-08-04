// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';

import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { applyThemeMode, getStoredThemeMode } from './ui/design/theme-mode';
import './ui/globals.css';

// Apply the persisted theme before the first paint to avoid a flash.
applyThemeMode(getStoredThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
