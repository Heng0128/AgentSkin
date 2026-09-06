// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentLivePreview — snapshot retry tests (REQ-D5)
 *
 * Covers three confirmed fixes:
 *   1. Snapshot failure displays the ErrorBanner component
 *   2. ErrorBanner includes a retry button
 *   3. Clicking retry triggers a re-fetch of the snapshot
 *
 * This test requires DOM (useEffect for data fetching), so we use
 * @testing-library/react under the `happy-dom` environment.
 */

/**
 * @vitest-environment happy-dom
 */

import type { UiMessages } from '@shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock api.snapshotBaseline ------------------------------------------

const { mockSnapshotBaseline } = vi.hoisted(() => ({
  mockSnapshotBaseline: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    snapshotBaseline: mockSnapshotBaseline,
  },
}));

// --- Mock RealDomPreview (child component) ------------------------------

vi.mock('@/components/studio/RealDomPreview', () => ({
  RealDomPreview: () => '<div data-testid="real-dom-preview">Preview</div>',
}));

// --- Mock cn utility ------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// --- Mock lucide icons ---------------------------------------------------

vi.mock('lucide-react', () => ({
  Loader2: () => null,
}));

// --- Import component AFTER mocks are registered ------------------------

import { AgentLivePreview } from './AgentLivePreview';

// --- Minimal UiMessages mock ---------------------------------------------

const mockT = {
  workspacePreviewLoading: 'Loading preview...',
  workspacePreviewRefreshFailed: 'Preview refresh failed',
  workspacePreviewLoadFailed: 'Preview load failed',
  workspacePreviewRetry: 'Retry',
  workspacePreviewDualA: 'Current',
  workspacePreviewDualB: 'Baseline',
} as unknown as UiMessages;

// --- Tests ----------------------------------------------------------------

describe('AgentLivePreview — snapshot retry (REQ-D5)', () => {
  beforeEach(() => {
    mockSnapshotBaseline.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // D5.1: Snapshot failure displays the ErrorBanner
  it('D5.1: shows ErrorBanner when snapshot fetch fails', async () => {
    mockSnapshotBaseline.mockRejectedValue(new Error('CDP timeout'));

    render(<AgentLivePreview agentId="traework" overrides={{}} t={mockT} />);

    // Wait for the error banner to appear.
    await waitFor(() => {
      const banner = document.querySelector('[data-slot="error-banner"]');
      expect(banner).not.toBeNull();
    });
  });

  // D5.1b: ErrorBanner shows the failure message
  it('D5.1b: ErrorBanner displays the localized failure message and detail', async () => {
    mockSnapshotBaseline.mockRejectedValue(new Error('Connection refused'));

    render(<AgentLivePreview agentId="traework" overrides={{}} t={mockT} />);

    await waitFor(() => {
      // The ErrorBanner message prop uses workspacePreviewRefreshFailed.
      expect(screen.getByText('Preview refresh failed')).toBeTruthy();
      // The detail line shows the underlying error message.
      expect(screen.getByText('Connection refused')).toBeTruthy();
    });
  });

  // D5.2: ErrorBanner includes a retry button
  it('D5.2: ErrorBanner contains a retry button', async () => {
    mockSnapshotBaseline.mockRejectedValue(new Error('Timeout'));

    render(<AgentLivePreview agentId="traework" overrides={{}} t={mockT} />);

    await waitFor(() => {
      const retryButton = screen.getByText('Retry');
      expect(retryButton).toBeTruthy();
    });
  });

  // D5.3: Clicking retry triggers a re-fetch
  it('D5.3: clicking retry triggers a new snapshot fetch', async () => {
    // First call fails, second call (after retry) succeeds.
    mockSnapshotBaseline.mockRejectedValueOnce(new Error('First failure')).mockResolvedValueOnce({
      domTree: { tag: 'div', children: [] },
    });

    render(<AgentLivePreview agentId="traework" overrides={{}} t={mockT} />);

    // Wait for the failure banner.
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });

    // Click retry.
    fireEvent.click(screen.getByText('Retry'));

    // After retry, snapshotBaseline should have been called twice.
    await waitFor(() => {
      expect(mockSnapshotBaseline).toHaveBeenCalledTimes(2);
    });
  });

  // Baseline: successful snapshot does NOT show ErrorBanner
  it('D5.4: no ErrorBanner when snapshot succeeds', async () => {
    mockSnapshotBaseline.mockResolvedValue({
      domTree: { tag: 'div', children: [] },
    });

    render(<AgentLivePreview agentId="traework" overrides={{}} t={mockT} />);

    // Wait for loading to finish.
    await waitFor(() => {
      expect(document.querySelector('[data-slot="error-banner"]')).toBeNull();
    });
  });
});
