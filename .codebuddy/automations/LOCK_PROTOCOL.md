# Automation Lock Protocol v1

## Problem

Multiple CatPaw automations (inspection, solidification) concurrently operate on the shared `main` branch, causing:
- HEAD ref-lock conflicts
- Commit hash disordering
- Cross-contamination of uncommitted files

## Protocol

### Lock File Location
`.codebuddy/automations/.lock`

### Lock Format
```json
{
  "automation": "<automation-name>",
  "pid": "<process-id>",
  "acquiredAt": "<ISO-timestamp>",
  "operations": ["git-add", "git-commit", "git-push"]
}
```

### Rules

1. **Acquire before git operations**: Any automation about to perform `git add` / `git commit` / `git push` MUST acquire the lock first
2. **Release after completion**: The lock MUST be released immediately after the git operation completes (success or failure)
3. **Stale lock detection**: If a lock is older than 5 minutes, it is considered stale and MAY be forcibly removed
4. **Pre-commit safe**: Acquiring the lock is NOT required for `git status`, `git log`, `git diff` (read-only operations)
5. **Blocking wait**: If the lock is held, the automation should wait (max 2 min) then retry

### Implementation (Pseudo)

```shell
# Acquire
LOCK_FILE=".codebuddy/automations/.lock"
if [ -f "$LOCK_FILE" ]; then
  # Check staleness (5 min)
  # If stale, remove and acquire
  # If fresh, wait and retry
fi
echo "{\"automation\":\"$NAME\",\"pid\":$$,\"acquiredAt\":\"$(date -Iseconds)\"}" > "$LOCK_FILE"

# ... perform git operations ...

# Release
rm -f "$LOCK_FILE"
```

## Current Status

**This protocol is a recommendation.** Full implementation requires:
- [ ] Acquire/release helpers in each automation
- [ ] Staleness heartbeat detection
- [ ] Timeout + retry with exponential backoff
- [ ] Integration with CatPaw's automation framework

## Usage

### CLI

```bash
# Check current lock status
node scripts/automation-lock.mjs status

# Acquire the lock (returns exit code 0 on success, 1 if held)
node scripts/automation-lock.mjs acquire <automation-name>

# Release the lock (only if held by this PID)
node scripts/automation-lock.mjs release

# Force-remove the lock regardless of owner
node scripts/automation-lock.mjs force-release

# Show help
node scripts/automation-lock.mjs --help
```

### Programmatic API

```js
import { acquireLock, releaseLock, isLockHeld } from '../scripts/automation-lock.mjs';

const ok = acquireLock('my-automation');
if (!ok) {
  console.error('Another automation is running');
  process.exit(1);
}

try {
  // ... perform git operations ...
} finally {
  releaseLock();
}
```

### Typical Automation Flow

```bash
#!/usr/bin/env bash
set -euo pipefail

# Acquire
node scripts/automation-lock.mjs acquire "solidify" || {
  echo "Lock held, retrying in 30s..."
  sleep 30
  node scripts/automation-lock.mjs acquire "solidify"
}

# Perform git operations
git add -A
git commit -m "auto: solidify"
git push origin main

# Release
node scripts/automation-lock.mjs release
```

## Safety Net: pre-push Hook

As a partial mitigation, `.husky/pre-push` blocks direct pushes to `main`. Automations should:
1. Create a feature branch for changes
2. Push to the feature branch
3. Merge via the CatPaw automation framework
