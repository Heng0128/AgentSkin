// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import type { StudioProject } from '../../shared/types';
import { formatHistoryTime, StudioHistory } from './studio-history';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeProject(name: string, accent = '#FF453A'): StudioProject {
  return {
    schema: 'agentskin-studio-project/v1',
    id: `proj-${name}`,
    name,
    author: 'test',
    agentId: 'traework',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    hasSnapshot: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioHistory', () => {
  let h: StudioHistory;

  beforeEach(() => {
    h = new StudioHistory({ limit: 5 });
  });

  it('starts empty with no undo/redo', () => {
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.size).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('records entries and increases size', () => {
    h.record(makeProject('A'), '创建工程 A');
    h.record(makeProject('B'), '改名');
    expect(h.size).toBe(2);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('undo returns previous snapshot', () => {
    const a = makeProject('A');
    const b = makeProject('B');
    h.record(a, 'state A');
    h.record(b, 'state B');

    const undone = h.undo();
    expect(undone?.name).toBe('A');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo moves forward again', () => {
    const a = makeProject('A');
    const b = makeProject('B');
    h.record(a, 'state A');
    h.record(b, 'state B');
    h.undo();

    const redone = h.redo();
    expect(redone?.name).toBe('B');
    expect(h.canRedo()).toBe(false);
  });

  it('recording after undo discards the redo tail', () => {
    h.record(makeProject('A'), 'A');
    h.record(makeProject('B'), 'B');
    h.record(makeProject('C'), 'C');
    h.undo(); // back to B
    h.undo(); // back to A
    expect(h.canRedo()).toBe(true);

    h.record(makeProject('D'), 'D instead of B/C');
    expect(h.size).toBe(2);
    expect(h.canRedo()).toBe(false);
  });

  it('respects the bounded limit and trims the head', () => {
    for (let i = 0; i < 7; i++) {
      h.record(makeProject(`p${i}`), `edit ${i}`);
    }
    // limit is 5 — last 5 entries survive.
    expect(h.size).toBe(5);
    // Current is p6 (last recorded).
    expect(h.current()?.name).toBe('p6');
    // We can undo back to p2 (5 entries = p2..p6).
    let count = 0;
    while (h.canUndo()) {
      h.undo();
      count++;
    }
    expect(h.current()?.name).toBe('p2');
    expect(count).toBe(4); // from cursor at p6 back to p2 = 4 undos
  });

  it('isolates snapshots — mutating the returned object does not affect history', () => {
    h.record(makeProject('A'), 'A');
    const snap = h.current()!;
    snap.name = 'MUTATED';
    // The stack's copy is untouched.
    expect(h.current()?.name).toBe('A');
  });

  it('reset clears everything', () => {
    h.record(makeProject('A'), 'A');
    h.record(makeProject('B'), 'B');
    h.reset();
    expect(h.size).toBe(0);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('view expose shape for UI consumption', () => {
    h.record(makeProject('A'), 'Created A');
    const view = h.view();
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].description).toBe('Created A');
    expect(view.cursor).toBe(0);
    expect(view.canUndo).toBe(false);
    expect(typeof view.entries[0].timestamp).toBe('string');
  });
});

describe('formatHistoryTime', () => {
  it('returns a string for a valid ISO timestamp', () => {
    expect(typeof formatHistoryTime('2025-08-07T12:34:56.000Z')).toBe('string');
  });

  it('returns raw input on parse failure', () => {
    expect(formatHistoryTime('not-a-date')).toBe('not-a-date');
  });
});
