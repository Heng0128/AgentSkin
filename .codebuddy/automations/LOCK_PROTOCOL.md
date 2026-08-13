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

## Safety Net: pre-push Hook

As a partial mitigation, `.husky/pre-push` blocks direct pushes to `main`. Automations should:
1. Create a feature branch for changes
2. Push to the feature branch
3. Merge via the CatPaw automation framework
