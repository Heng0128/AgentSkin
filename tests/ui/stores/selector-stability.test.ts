// SPDX-License-Identifier: MPL-2.0

/**
 * # Selector Stability Tests (RC4-step6)
 *
 * Verifies that selectors and getState() return stable references when
 * underlying data hasn't meaningfully changed — the core guarantee of
 * the RC1 atomic split.
 */

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useProjectStore } from '@/studio/project-store';
import { useStudioStore } from '@/studio/useStudioStore';

import type { StudioProject } from '@shared/types';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(
  id: string,
  name = 'Test Project',
  updatedAt = '2026-01-01T00:00:00Z',
): StudioProject {
  return {
    schema: 'agentskin-studio-project/v1',
    id,
    name,
    author: 'test-author',
    agentId: 'traework',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt,
    hasSnapshot: false,
  };
}

// ---------------------------------------------------------------------------
// getActiveProject stable reference
// ---------------------------------------------------------------------------

describe('getActiveProjectStable', () => {
  it('returns the same reference when projects array is rebuilt but active project identity is unchanged', () => {
    // Set up initial state
    const p1 = makeProject('p1', 'Project 1', '2026-01-01T00:00:00Z');
    useProjectStore.setState({ projects: [p1], activeProjectId: 'p1' });

    // First call — cache miss, returns found reference
    const first = useProjectStore.getState().getActiveProjectStable();
    expect(first).not.toBeNull();
    expect(first!.id).toBe('p1');

    // Rebuild projects array with a NEW object for the same project (same id + updatedAt)
    const p1Rebuilt = makeProject('p1', 'Project 1', '2026-01-01T00:00:00Z');
    useProjectStore.setState({ projects: [p1Rebuilt], activeProjectId: 'p1' });

    // Second call — should return the CACHED reference (=== first), not p1Rebuilt
    const second = useProjectStore.getState().getActiveProjectStable();
    expect(second).toBe(first); // same reference!
    expect(second).not.toBe(p1Rebuilt); // NOT the new object
  });

  it('returns a new reference when active project id changes', () => {
    const p1 = makeProject('p1', 'Project 1');
    const p2 = makeProject('p2', 'Project 2');
    useProjectStore.setState({ projects: [p1, p2], activeProjectId: 'p1' });

    const first = useProjectStore.getState().getActiveProjectStable();
    expect(first!.id).toBe('p1');

    // Switch active project
    useProjectStore.setState({ activeProjectId: 'p2' });

    const second = useProjectStore.getState().getActiveProjectStable();
    expect(second).not.toBe(first);
    expect(second!.id).toBe('p2');
  });

  it('returns a new reference when the active project is updated (updatedAt changes)', () => {
    const p1 = makeProject('p1', 'Project 1', '2026-01-01T00:00:00Z');
    useProjectStore.setState({ projects: [p1], activeProjectId: 'p1' });

    const first = useProjectStore.getState().getActiveProjectStable();
    expect(first!.updatedAt).toBe('2026-01-01T00:00:00Z');

    // Update the project ((updatedAt changes)
    const p1Updated = makeProject('p1', 'Project 1 Updated', '2026-02-01T00:00:00Z');
    useProjectStore.setState({ projects: [p1Updated], activeProjectId: 'p1' });

    const second = useProjectStore.getState().getActiveProjectStable();
    expect(second).not.toBe(first);
    expect(second!.updatedAt).toBe('2026-02-01T00:00:00Z');
  });

  it('returns null consistently when no project is active', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null });

    const first = useProjectStore.getState().getActiveProjectStable();
    const second = useProjectStore.getState().getActiveProjectStable();

    expect(first).toBeNull();
    expect(second).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useStudioStore.getState() reference stability
// ---------------------------------------------------------------------------

describe('useStudioStore.getState()', () => {
  it('returns the same reference when no sub-store has changed', () => {
    // Read state twice without any changes in between
    const first = useStudioStore.getState();
    const second = useStudioStore.getState();

    expect(first).toBe(second); // same reference
  });

  it('returns a new reference when a sub-store changes', () => {
    const first = useStudioStore.getState();

    // Change project store
    useProjectStore.setState({ activeProjectId: 'some-id' });

    const second = useStudioStore.getState();
    expect(second).not.toBe(first);
  });

  it('returns the same reference after unrelated getState calls', () => {
    // Change something, then read (cache miss), then read again (cache hit)
    useProjectStore.setState({ activeProjectId: 'x' });
    const afterChange = useStudioStore.getState();
    const again = useStudioStore.getState();

    expect(afterChange).toBe(again);
  });
});

// ---------------------------------------------------------------------------
// Workspace store selector stability
// ---------------------------------------------------------------------------

describe('workspaceStore selectors', () => {
  it('returns the same dock reference when unrelated fields change', () => {
    // Read dock state
    const dock1 = useWorkspaceStore.getState().dock;

    // Change an unrelated field (inspector)
    useWorkspaceStore.setState({ rawCss: 'some-css' });

    const dock2 = useWorkspaceStore.getState().dock;

    // dock object reference should be unchanged since we didn't touch dock
    expect(dock2).toBe(dock1);
  });

  it('returns a new dock reference when dock changes', () => {
    const dock1 = useWorkspaceStore.getState().dock;

    useWorkspaceStore.setState({ dock: { ...dock1, open: false } });

    const dock2 = useWorkspaceStore.getState().dock;
    expect(dock2).not.toBe(dock1);
    expect(dock2.open).toBe(false);
  });
});
