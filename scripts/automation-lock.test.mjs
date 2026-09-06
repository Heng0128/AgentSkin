// SPDX-License-Identifier: MPL-2.0

/**
 * automation-lock.mjs 持有者身份验证单测
 *
 * 验证 v2 锁格式（schemaVersion + pid + startedAt）、进程存活检测、
 * isOwnLock() 区分自体/他体持有、v1 向后兼容。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireLock,
  forceReleaseLock,
  getLockStatus,
  isLockHeld,
  isOwnLock,
  releaseLock,
} from './automation-lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCK_DIR = path.join(ROOT, '.agentskin', 'automations');
const LOCK_FILE = path.join(LOCK_DIR, '.lock');

function cleanupLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // File doesn't exist
  }
}

function writeLock(lockData) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
}

describe('automation-lock holder identity verification', () => {
  beforeEach(() => {
    cleanupLock();
  });

  afterEach(() => {
    cleanupLock();
  });

  // --- v2 lock format ---

  describe('v2 lock format', () => {
    it('acquireLock writes schemaVersion, pid, startedAt', () => {
      const ok = acquireLock('test-automation');
      expect(ok).toBe(true);

      const raw = fs.readFileSync(LOCK_FILE, 'utf8');
      const lock = JSON.parse(raw);

      expect(lock.schemaVersion).toBe(2);
      expect(lock.pid).toBe(process.pid);
      expect(typeof lock.startedAt).toBe('string');
      expect(new Date(lock.startedAt).getTime()).not.toBeNaN();
      expect(lock.automation).toBe('test-automation');
      expect(lock.operations).toEqual(['git-add', 'git-commit', 'git-push']);
    });

    it('startedAt is ISO 8601 format', () => {
      acquireLock('test');
      const raw = fs.readFileSync(LOCK_FILE, 'utf8');
      const lock = JSON.parse(raw);

      // ISO 8601 regex (basic)
      expect(lock.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  // --- isOwnLock ---

  describe('isOwnLock', () => {
    it('returns true when current process holds the lock', () => {
      acquireLock('my-task');
      expect(isOwnLock()).toBe(true);
    });

    it('returns false when no lock exists', () => {
      expect(isOwnLock()).toBe(false);
    });

    it('returns false when lock is held by a different PID', () => {
      // Simulate a lock held by another process (use a large PID unlikely to be ours)
      writeLock({
        schemaVersion: 2,
        automation: 'other-task',
        pid: 99999999,
        startedAt: new Date().toISOString(),
        operations: [],
      });
      expect(isOwnLock()).toBe(false);
    });

    it('returns false when lock is stale (dead process)', () => {
      // Write a lock with current PID but expired timestamp
      writeLock({
        schemaVersion: 2,
        automation: 'dead-task',
        pid: process.pid,
        startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
        operations: [],
      });
      expect(isOwnLock()).toBe(false);
    });
  });

  // --- process liveness check ---

  describe('process liveness detection', () => {
    it('treats lock with dead PID as stale even within threshold', () => {
      // PID 99999999 is almost certainly not alive
      writeLock({
        schemaVersion: 2,
        automation: 'dead-process',
        pid: 99999999,
        startedAt: new Date().toISOString(), // just now, within threshold
        operations: [],
      });
      expect(isLockHeld()).toBe(false);
    });

    it('keeps lock held when holding process is alive', () => {
      // Current process is alive
      acquireLock('alive-task');
      expect(isLockHeld()).toBe(true);
    });

    it('treats lock with invalid PID as stale', () => {
      writeLock({
        schemaVersion: 2,
        automation: 'invalid-pid',
        pid: -1,
        startedAt: new Date().toISOString(),
        operations: [],
      });
      expect(isLockHeld()).toBe(false);
    });

    it('treats lock with non-numeric PID as stale', () => {
      writeLock({
        schemaVersion: 2,
        automation: 'bad-pid',
        pid: 'not-a-number',
        startedAt: new Date().toISOString(),
        operations: [],
      });
      expect(isLockHeld()).toBe(false);
    });
  });

  // --- acquire with dead holder ---

  describe('acquire when holder is dead', () => {
    it('succeeds when existing lock holder process is dead', () => {
      // Write a lock with a dead PID within threshold
      writeLock({
        schemaVersion: 2,
        automation: 'dead-holder',
        pid: 99999999,
        startedAt: new Date().toISOString(),
        operations: [],
      });

      const ok = acquireLock('new-task');
      expect(ok).toBe(true);

      const raw = fs.readFileSync(LOCK_FILE, 'utf8');
      const lock = JSON.parse(raw);
      expect(lock.automation).toBe('new-task');
      expect(lock.pid).toBe(process.pid);
    });

    it('fails when existing lock holder is alive and within threshold', () => {
      // Current process holds it (alive)
      acquireLock('alive-holder');

      // Try to acquire again — should fail
      const ok = acquireLock('another-task');
      expect(ok).toBe(false);
    });
  });

  // --- getLockStatus with own field ---

  describe('getLockStatus', () => {
    it('reports own=true when current process holds the lock', () => {
      acquireLock('my-task');
      const status = getLockStatus();
      expect(status.held).toBe(true);
      expect(status.own).toBe(true);
      expect(status.stale).toBe(false);
      expect(status.lock).not.toBeNull();
    });

    it('reports own=false when another process holds the lock', () => {
      writeLock({
        schemaVersion: 2,
        automation: 'other-task',
        pid: 99999999,
        startedAt: new Date().toISOString(),
        operations: [],
      });
      const status = getLockStatus();
      // Dead PID → stale → held=false, own=false
      expect(status.held).toBe(false);
      expect(status.own).toBe(false);
    });

    it('reports own=false when lock is free', () => {
      const status = getLockStatus();
      expect(status.held).toBe(false);
      expect(status.own).toBe(false);
      expect(status.lock).toBeNull();
    });
  });

  // --- backward compatibility (v1 format) ---

  describe('backward compatibility with v1 lock files', () => {
    it('treats v1 lock file (acquiredAt) as valid when process alive', () => {
      // v1 format uses "acquiredAt" instead of "startedAt"
      writeLock({
        automation: 'v1-task',
        pid: process.pid, // alive
        acquiredAt: new Date().toISOString(),
        operations: ['git-commit'],
      });

      expect(isLockHeld()).toBe(true);
      expect(isOwnLock()).toBe(true);
    });

    it('treats v1 lock file as stale when expired', () => {
      writeLock({
        automation: 'v1-expired',
        pid: process.pid,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        operations: [],
      });

      expect(isLockHeld()).toBe(false);
      expect(isOwnLock()).toBe(false);
    });

    it('reads v1 lock status correctly via getLockStatus', () => {
      writeLock({
        automation: 'v1-status',
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        operations: [],
      });

      const status = getLockStatus();
      expect(status.held).toBe(true);
      expect(status.own).toBe(true);
      expect(status.lock?.automation).toBe('v1-status');
    });

    it('can overwrite v1 lock with v2 format on acquire after expiry', () => {
      writeLock({
        automation: 'v1-old',
        pid: 99999999,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        operations: [],
      });

      const ok = acquireLock('v2-new');
      expect(ok).toBe(true);

      const raw = fs.readFileSync(LOCK_FILE, 'utf8');
      const lock = JSON.parse(raw);
      expect(lock.schemaVersion).toBe(2);
      expect(lock.startedAt).toBeDefined();
      expect(lock.acquiredAt).toBeUndefined();
    });
  });

  // --- releaseLock with identity check ---

  describe('releaseLock identity check', () => {
    it('releases lock held by current process', () => {
      acquireLock('my-lock');
      expect(isLockHeld()).toBe(true);

      releaseLock();
      expect(isLockHeld()).toBe(false);
    });

    it('does not release lock held by different PID', () => {
      writeLock({
        schemaVersion: 2,
        automation: 'other-pid',
        pid: 99999999,
        startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        operations: [],
      });

      releaseLock();
      // Lock file should still exist (not ours to release)
      expect(fs.existsSync(LOCK_FILE)).toBe(true);
    });
  });

  // --- forceReleaseLock ---

  describe('forceReleaseLock', () => {
    it('removes lock regardless of owner', () => {
      writeLock({
        schemaVersion: 2,
        automation: 'force-test',
        pid: 99999999,
        startedAt: new Date().toISOString(),
        operations: [],
      });

      forceReleaseLock();
      expect(fs.existsSync(LOCK_FILE)).toBe(false);
    });
  });
});
