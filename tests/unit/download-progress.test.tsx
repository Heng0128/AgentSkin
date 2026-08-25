// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadProgress } from '../../src/ui/components/themes/DownloadProgress';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DownloadProgress', () => {
  // --- 1. Basic rendering ---

  it('renders a progress bar', () => {
    render(
      <DownloadProgress
        progress={42}
        bytesDownloaded={0}
        totalBytes={1024}
      />,
    );
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  // --- 2. Progress display ---

  it('displays the correct percentage text', () => {
    render(
      <DownloadProgress
        progress={42}
        bytesDownloaded={0}
        totalBytes={1024}
      />,
    );
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('clamps percentage to 0-100 range', () => {
    const { rerender } = render(
      <DownloadProgress
        progress={150}
        bytesDownloaded={0}
        totalBytes={1024}
      />,
    );
    expect(screen.getByText('100%')).toBeTruthy();

    rerender(
      <DownloadProgress
        progress={-10}
        bytesDownloaded={0}
        totalBytes={1024}
      />,
    );
    expect(screen.getByText('0%')).toBeTruthy();
  });

  // --- 3. Detail row ---

  it('shows downloaded / total when showDetails is true', () => {
    render(
      <DownloadProgress
        progress={50}
        bytesDownloaded={512}
        totalBytes={1024}
        showDetails
      />,
   );
    expect(screen.getByText(/512 B/)).toBeTruthy();
    expect(screen.getByText(/1024 B/)).toBeTruthy();
  });

  it('hides detail row when showDetails is false', () => {
    render(
      <DownloadProgress
        progress={50}
        bytesDownloaded={512}
        totalBytes={1024}
      />,
    );
    expect(screen.queryByText(/512 B/)).toBeNull();
  });

  // --- 4. Byte formatting ---

  it('formats bytes correctly for B / KB / MB', () => {
    const { rerender } = render(
      <DownloadProgress
        progress={10}
        bytesDownloaded={500}
        totalBytes={1024}
        showDetails
      />,
    );
    expect(screen.getByText('500 B')).toBeTruthy();
    expect(screen.getByText('1.0 KB')).toBeTruthy();

    rerender(
      <DownloadProgress
        progress={10}
        bytesDownloaded={1048576}
        totalBytes={2097152}
        showDetails
      />,
    );
    expect(screen.getByText('1.0 MB')).toBeTruthy();
    expect(screen.getByText('2.0 MB')).toBeTruthy();
  });

  // --- 5. Phase icons ---

  it('renders no icon during downloading phase', () => {
    render(
      <DownloadProgress
        progress={30}
        bytesDownloaded={0}
        totalBytes={1024}
        phase="downloading"
      />,
    );
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.getByText('下载中…')).toBeTruthy();
  });

  it('renders a Loader2 icon during verifying phase', () => {
    render(
      <DownloadProgress
        progress={60}
        bytesDownloaded={512}
        totalBytes={1024}
        phase="verifying"
      />,
    );
    const icon = document.querySelector('svg');
    expect(icon).not.toBeNull();
    // Loader2 carries animate-spin
    expect(icon?.className.baseVal).toContain('animate-spin');
    expect(screen.getByText('验证中…')).toBeTruthy();
  });

  it('renders a Package icon during installing phase', () => {
    render(
      <DownloadProgress
        progress={90}
        bytesDownloaded={900}
        totalBytes={1024}
        phase="installing"
      />,
    );
    const icon = document.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(screen.getByText('安装中…')).toBeTruthy();
  });

  // --- 6. Progress bar width ---

  it('sets the fill width to match the progress value', () => {
    render(
      <DownloadProgress
        progress={75}
        bytesDownloaded={0}
        totalBytes={1024}
      />,
    );
    const fill = document.querySelector('[style*="width: 75%"]');
    expect(fill).not.toBeNull();
  });
});
