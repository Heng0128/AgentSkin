// SPDX-License-Identifier: MPL-2.0

/**
 * # useContainerWidth — unit tests
 *
 * Tests the container width hook that uses ResizeObserver.
 *
 * Testing strategy:
 *   - The `ui` vitest project uses `environment: 'node'`, so we manually
 *     set up happy-dom globals before importing `@testing-library/react`.
 *   - ResizeObserver is mocked since it is not available in the node environment.
 *   - A test component attaches the ref to a real rendered element so that
 *     useEffect fires and ResizeObserver is exercised.
 */

import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost' });

// Set up globals that @testing-library/react needs
globalThis.document = window.document as unknown as Document;
globalThis.window = window as unknown as typeof globalThis.window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(
  window,
) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(
  window,
) as unknown as typeof cancelAnimationFrame;

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContainerWidth } from '../useContainerWidth';

// Mock ResizeObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockResizeObserver {
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  mockObserve.mockClear();
  mockDisconnect.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function TestComponent() {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  return <div ref={ref} data-width={width} />;
}

describe('useContainerWidth', () => {
  it('renders without errors and attaches ref', () => {
    const { container } = render(<TestComponent />);
    const div = container.querySelector('div');
    expect(div).toBeTruthy();
    expect(div?.getAttribute('data-width')).toBe('0');
  });

  it('calls observe when element is attached', () => {
    render(<TestComponent />);
    expect(mockObserve).toHaveBeenCalled();
  });

  it('disconnects observer on unmount', () => {
    const { unmount } = render(<TestComponent />);
    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
