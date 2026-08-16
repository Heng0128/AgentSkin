import fs from "node:fs/promises";
import path from "node:path";
import { CdpSession, listCdpTargets } from "../cdp/session.mjs";
import { buildDomSnapshotExpression, DOM_SNAPSHOT_DEFAULT_MAX_NODES } from "./dom-snapshot.mjs";
import { SessionPool } from "./session-pool-runtime.mjs";
import { buildApplyExpression, buildPersistenceScript, buildProbeExpression, buildRemoveExpression, buildVerifyExpression, SESSION_DISABLED_KEY } from "./renderer-payload.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// ---------------------------------------------------------------------------
// Persistence-script identifier tracking (RFC 2026-08-17 P1, cf. main-process
// engine-strategy.ts P1 audit #8)
// ---------------------------------------------------------------------------

/**
 * Tracks the `Page.addScriptToEvaluateOnNewDocument` identifier returned by CDP
 * for each target's persistence script, keyed by `${port}:${targetId}` (the
 * same key convention as the CV-08 SessionPool).
 *
 * Why this exists: without tracking, every apply registered a fresh persistence
 * script via `Page.addScriptToEvaluateOnNewDocument` and no call ever removed
 * it — after N theme switches the target carried N scripts, all executing on
 * every navigation.
 *
 * ## Session-bound registrations (verified 2026-08-17)
 *
 * `Page.addScriptToEvaluateOnNewDocument` registrations are **session-bound**,
 * not target-bound: closing the WebSocket session that registered the script
 * drops the registration (empirically verified — a marker registered on a
 * session that is then closed never fires on the next reload, and
 * `Page.removeScriptToEvaluateOnNewDocument` reports "Script not found" from a
 * different session). This contradicts the RFC's original §4.4 assumption.
 *
 * Consequence: persistence must be registered on a **dedicated long-lived
 * session** ({@link persistenceSessions}) that survives the apply operation's
 * SessionPool disposal and stays open until `removeTheme` closes it. Removal
 * must go through that same session.
 */
const persistenceScriptIds = new Map();

/**
 * Dedicated per-target sessions that OWN persistence registrations, keyed by
 * `${port}:${targetId}`. These must stay open for the registered
 * `Page.addScriptToEvaluateOnNewDocument` script to survive reload/navigation
 * (session-bound registrations — see {@link persistenceScriptIds}). They are
 * created on apply/watch, reused across re-applies, and only closed by
 * `removeTheme` (or lazily re-opened once the socket dies with its target).
 */
const persistenceSessions = new Map();

/** Open (or reuse) the dedicated persistence session for a target key. */
async function acquirePersistenceSession(target, key, timeoutMs) {
  let session = persistenceSessions.get(key);
  if (session && !session.closed) return session;
  if (session) persistenceSessions.delete(key); // stale — socket died with its target
  session = await new CdpSession(target, timeoutMs).open();
  persistenceSessions.set(key, session);
  return session;
}

export function persistenceKeyFor(port, targetId) {
  return `${port}:${targetId}`;
}

/** Read-only snapshot of the tracked persistence identifiers (test/diagnostics). */
export function listPersistenceScriptIds(key) {
  return [...(persistenceScriptIds.get(key) ?? [])];
}

/**
 * Remove all previously-registered persistence scripts for a target key from
 * the given session. Best-effort: identifiers from a previous target (e.g.
 * after an app restart) are invalid and the CDP call silently fails — the old
 * target is gone and took its scripts with it.
 */
export async function removePersistenceScripts(session, key) {
  const ids = persistenceScriptIds.get(key);
  if (!ids?.size) return;
  for (const identifier of ids) {
    try {
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    } catch {
      // Identifier may be from a previous target — silently ignore.
    }
  }
  ids.clear();
}

/**
 * Register a new-document persistence script on a target, replacing any
 * previously-tracked scripts for the key (no accumulation across applies).
 */
export async function registerPersistenceScript(session, key, scriptSource) {
  await removePersistenceScripts(session, key);
  const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: scriptSource,
    runImmediately: false,
  });
  if (result?.identifier) {
    let set = persistenceScriptIds.get(key);
    if (!set) {
      set = new Set();
      persistenceScriptIds.set(key, set);
    }
    set.add(result.identifier);
  }
  return result?.identifier ?? null;
}

/** Clear the disabled flag so a freshly-registered persistence script takes
 * effect on the next navigation. Best-effort (sessionStorage may be absent). */
async function clearDisabledFlag(session) {
  try {
    await session.evaluate(`(() => {
      try { sessionStorage.removeItem(${JSON.stringify(SESSION_DISABLED_KEY)}); } catch (e) {}
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }
}

/** Set the disabled flag so any non-removable persistence script skips on the
 * next navigation (belt-and-suspenders behind explicit script removal). */
async function setDisabledFlag(session) {
  try {
    await session.evaluate(`(() => {
      try { sessionStorage.setItem(${JSON.stringify(SESSION_DISABLED_KEY)}, '1'); } catch (e) {}
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }
}

export async function findTargets(adapter, port, timeoutMs = 1500) {
  const targets = await listCdpTargets(port, timeoutMs);
  return targets.filter((target) => adapter.matchTarget(target));
}

export async function waitForTargets(adapter, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const targets = await findTargets(adapter, port, Math.min(1500, remaining));
      if (targets.length) return targets;
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(350, remaining));
  }
  const error = new Error(`No ${adapter.displayName} renderer target on 127.0.0.1:${port} within ${timeoutMs}ms: ${lastError?.message ?? "timed out"}`);
  error.code = "AGENTSKIN_TARGET_TIMEOUT";
  error.appId = adapter.id;
  error.port = port;
  error.timeoutMs = timeoutMs;
  throw error;
}

async function withSessions(targets, callback, sessionTimeoutMs = 10000, pool = null) {
  const results = [];
  for (const target of targets) {
    // When a pool is supplied (CV-08) the target's session is borrowed and
    // returned for reuse across sibling operations, avoiding a fresh CDP
    // handshake for each preflight/apply/verify pass over the same target.
    const session = pool
      ? await pool.acquire(target, sessionTimeoutMs)
      : await new CdpSession(target, sessionTimeoutMs).open();
    try {
      results.push({ targetId: target.id, title: target.title, url: target.url, result: await callback(session, target) });
    } finally {
      if (pool) pool.release(target, session);
      else session.close();
    }
  }
  return results;
}

export function describeMissingRequirements(missing) {
  return missing
    .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
    .join("; ");
}

export function describeTarget(item) {
  return item.title || item.url || item.targetId || "unknown target";
}

function compatibilityError(adapter, results) {
  const failures = results.filter((item) => !item.result?.compatible);
  const missing = failures.flatMap((item) => item.result?.missing ?? []);
  const detail = failures
    .map((item) => `${describeTarget(item)} → ${describeMissingRequirements(item.result?.missing ?? []) || "no DOM response"}`)
    .join(" ‖ ");
  const error = new Error(
    `${adapter.displayName} DOM preflight failed for ${failures.length} of ${results.length} renderer target(s)` +
    `${detail ? `: ${detail}` : "."}` +
    ` The app may have updated since this adapter was last verified (${JSON.stringify(adapter.lastVerified ?? {})}).`,
  );
  error.code = "AGENTSKIN_DOM_INCOMPATIBLE";
  error.missing = missing;
  error.results = results;
  return error;
}

function ensureCompatible(adapter, results) {
  if (results.every((item) => item.result?.compatible)) return results;
  throw compatibilityError(adapter, results);
}

/**
 * Waits for the page to pass the compatibility probe. A page whose root
 * landmark is absent is still booting (splash/loading screen), so it gets the
 * full boot budget; once the skeleton exists, a genuine selector mismatch
 * fails after the shorter settle budget instead of stalling the caller.
 */
async function waitForCompatibility(session, expression, settleTimeoutMs = 5000, bootTimeoutMs = settleTimeoutMs) {
  const start = Date.now();
  let structuredAt = null;
  let result;
  do {
    try {
      result = await session.evaluate(expression);
    } catch {
      // Boot-time navigations tear down the execution context mid-evaluate;
      // treat it like a page that has not rendered yet and retry.
      result = undefined;
    }
    if (result?.compatible) return result;
    const now = Date.now();
    const hasRoot = Boolean(result?.rootMatches?.length);
    if (hasRoot && structuredAt === null) structuredAt = now;
    const deadline = hasRoot
      ? Math.min(start + bootTimeoutMs, structuredAt + settleTimeoutMs)
      : start + bootTimeoutMs;
    if (now >= deadline) return result;
    await delay(250);
  } while (true);
}

export async function probeApp({ adapter, targetTheme = null, port, timeoutMs = 5000, pool = null }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildProbeExpression(adapter, targetTheme?.verification ?? null);
  return withSessions(targets, (session) => waitForCompatibility(session, expression, Math.min(timeoutMs, 5000)), Math.max(5000, timeoutMs), pool);
}

export async function snapshotDom({
  adapter,
  port,
  timeoutMs = 5000,
  maxNodes = DOM_SNAPSHOT_DEFAULT_MAX_NODES,
  includeHidden = false,
  pool = null,
}) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildDomSnapshotExpression(adapter, { maxNodes, includeHidden });
  const results = await withSessions(targets, (session) => session.evaluate(expression), timeoutMs, pool);
  return results.map(({ targetId, result }) => ({ targetId, result }));
}

export async function applyTheme({ adapter, targetTheme, port, timeoutMs = 30000, pool = null }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
  // CV-08: share one pool across the preflight + apply passes so each CDP
  // target is handshaked once instead of once per pass. A caller-provided
  // `pool` (e.g. across a whole skin run) is kept alive by the caller;
  // otherwise an operation-scoped pool is closed when apply finishes.
  let ownedPool = null;
  const activePool = pool ?? (ownedPool = new SessionPool({ ttlMs: timeoutMs }));
  // A splash/loading screen may keep the DOM empty for a long while after the
  // CDP target exists, so booting pages get the full apply budget while
  // rendered-but-mismatched pages still fail within the settle budget.
  try {
    const preflight = await withSessions(
      targets,
      (session) => waitForCompatibility(session, preflightExpression, Math.min(timeoutMs, 10000), timeoutMs),
      Math.max(10000, timeoutMs),
      activePool,
    );
    // Secondary windows (popped-out chats, floating panels) legitimately lack
    // parts of the main-window DOM. Theme every compatible target and report the
    // rest as skipped instead of refusing the whole apply.
    const compatibleIds = new Set(preflight.filter((item) => item.result?.compatible).map((item) => item.targetId));
    if (!compatibleIds.size) throw compatibilityError(adapter, preflight);
    const skipped = preflight
      .filter((item) => !compatibleIds.has(item.targetId))
      .map((item) => ({
        targetId: item.targetId,
        title: item.title,
        url: item.url,
        skipped: true,
        missing: item.result?.missing ?? [],
      }));
    const expression = buildApplyExpression({ adapter, targetTheme });
    // P1: persistence script reuses the exact same injection body, so reload /
    // navigation re-applies the theme automatically (until removeTheme).
    const persistenceScript = buildPersistenceScript({ adapter, targetTheme });
    let rendererMutated = false;
    try {
      const applied = await withSessions(
        targets.filter((target) => compatibleIds.has(target.id)),
        async (session, target) => {
          // Explicit apply must override a stale disabled flag left by an
          // earlier removeTheme/restoreSkin: the flag is scoped to
          // sessionStorage and survives reloads, so clearing it must happen
          // BEFORE evaluating the apply body — otherwise `ensure()` sees
          // disabled() and bails without creating the theme <style>.
          await clearDisabledFlag(session);
          await session.evaluate(expression);
          // P1: register new-document persistence (replaces any previously
          // tracked script for this target — no accumulation). The flag was
          // already cleared above, so the script takes effect on the next
          // navigation.
          //
          // The registration MUST live on a dedicated long-lived session, not
          // the operation-scoped pooled `session`: `Page.addScriptToEvaluateOnNewDocument`
          // registrations are session-bound and the ownedPool is disposed in
          // `finally` below — closing it would silently drop the persistence
          // script (verified 2026-08-17). The dedicated session stays open
          // until `removeTheme` closes it.
          const persistSession = await acquirePersistenceSession(target, persistenceKeyFor(port, target.id), timeoutMs);
          await registerPersistenceScript(persistSession, persistenceKeyFor(port, target.id), persistenceScript);
          rendererMutated = true;
          await delay(500);
          return session.evaluate(buildVerifyExpression(adapter, targetTheme.theme, targetTheme.verification, targetTheme));
        },
        Math.max(10000, timeoutMs),
        activePool,
      );
      return [...applied, ...skipped];
    } catch (error) {
      error.rendererMutated = rendererMutated;
      throw error;
    }
  } finally {
    if (ownedPool) ownedPool.dispose();
  }
}

export async function verifyTheme({ adapter, targetTheme, port, timeoutMs = 30000, pool = null }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(targets, (session) => session.evaluate(buildVerifyExpression(
    adapter,
    targetTheme?.theme ?? null,
    targetTheme?.verification ?? null,
    targetTheme,
  )), Math.max(10000, timeoutMs), pool);
}

export async function removeTheme({ adapter, port, timeoutMs = 30000, pool = null }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(
    targets,
    async (session, target) => {
      // P1: explicitly remove the tracked persistence scripts so the theme is
      // fully torn down (not just disabled). Removal must go through the same
      // dedicated session that registered the script — registrations are
      // session-bound (verified 2026-08-17), so the pooled `session` cannot
      // remove it ("Script not found"). Identifiers from a previous target are
      // already gone — removal is a silent no-op.
      const key = persistenceKeyFor(port, target.id);
      const persistSession = persistenceSessions.get(key);
      await removePersistenceScripts(persistSession ?? session, key);
      // Close the dedicated session: closing the WebSocket drops every
      // `Page.addScriptToEvaluateOnNewDocument` registration it owned.
      if (persistSession) {
        persistenceSessions.delete(key);
        try {
          persistSession.close();
        } catch {
          /* already closed with its target */
        }
      }
      // Belt-and-suspenders: any persistence script we could not remove
      // (e.g. registered by a previous process incarnation) skips on future
      // navigations because of this flag.
      await setDisabledFlag(session);
      // Current-document cleanup (unchanged behaviour).
      return session.evaluate(buildRemoveExpression(adapter));
    },
    Math.max(10000, timeoutMs),
    pool,
  );
}

export async function captureScreenshot({ adapter, port, output, timeoutMs = 30000 }) {
  const [target] = await waitForTargets(adapter, port, timeoutMs);
  const session = await new CdpSession(target).open();
  try {
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, Buffer.from(result.data, "base64"));
    return filename;
  } finally {
    session.close();
  }
}

export async function watchTheme({ adapter, targetTheme, port, timeoutMs = 30000, onEvent = () => {}, signal = null }) {
  const expression = buildApplyExpression({ adapter, targetTheme });
  const persistenceScript = buildPersistenceScript({ adapter, targetTheme });
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
  const sessions = new Map();
  // Incompatible targets (e.g. popped-out windows) retry on a cooldown instead
  // of blocking every poll cycle for the full preflight wait.
  const incompatibleUntil = new Map();
  const INCOMPATIBLE_RETRY_MS = 15000;
  let stopping = Boolean(signal?.aborted);
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  signal?.addEventListener("abort", stop, { once: true });

  try {
    while (!stopping) {
      let targets = [];
      try {
        targets = await waitForTargets(adapter, port, Math.min(timeoutMs, 2000));
      } catch (error) {
        onEvent({ type: "waiting", message: error.message });
        await delay(900);
        continue;
      }
      const activeIds = new Set(targets.map((target) => target.id));
      for (const [id, session] of sessions) {
        if (!activeIds.has(id) || session.closed) {
          session.close();
          sessions.delete(id);
        }
      }
      for (const id of incompatibleUntil.keys()) {
        if (!activeIds.has(id)) incompatibleUntil.delete(id);
      }
      for (const target of targets) {
        if (sessions.has(target.id)) continue;
        if ((incompatibleUntil.get(target.id) ?? 0) > Date.now()) continue;
        let session;
        try {
          session = await new CdpSession(target).open();
          const key = persistenceKeyFor(port, target.id);
          const applyCompatible = async () => {
            const result = await waitForCompatibility(session, preflightExpression, Math.min(timeoutMs, 5000));
            ensureCompatible(adapter, [{ targetId: target.id, title: target.title, url: target.url, result }]);
            // Clear a stale disabled flag (from a previous remove) before
            // applying — same ordering contract as applyTheme.
            await clearDisabledFlag(session);
            await session.evaluate(expression);
            // P3: register new-document persistence so navigation / reload
            // re-applies automatically; the loadEventFired handler then only
            // reports (see below). Same script as applyTheme, no drift.
            // Registered on the dedicated long-lived persistence session (not
            // this watch session) — see applyTheme for the session-bound reason.
            const persistSession = await acquirePersistenceSession(target, key, timeoutMs);
            await registerPersistenceScript(persistSession, key, persistenceScript);
          };
          session.on("Page.loadEventFired", () => {
            // P3: re-injection responsibility moved to the persistence script —
            // the new document self-heals, so we only report the navigation.
            // Fallback: if persistence registration failed (best-effort, no
            // tracked identifier), re-apply explicitly as before.
            if (listPersistenceScriptIds(key).length === 0) {
              setTimeout(() => applyCompatible().catch((error) => {
                onEvent({ type: "error", code: error.code, message: error.message, missing: error.missing ?? [] });
                session.close();
                sessions.delete(target.id);
              }), 250);
              return;
            }
            onEvent({ type: "reloaded", targetId: target.id });
          });
          await applyCompatible();
          sessions.set(target.id, session);
          onEvent({ type: "injected", targetId: target.id, title: target.title });
        } catch (error) {
          session?.close();
          if (error.code === "AGENTSKIN_DOM_INCOMPATIBLE") incompatibleUntil.set(target.id, Date.now() + INCOMPATIBLE_RETRY_MS);
          onEvent({ type: "error", targetId: target.id, code: error.code, message: error.message, missing: error.missing ?? [] });
        }
      }
      await delay(900);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    signal?.removeEventListener("abort", stop);
    for (const session of sessions.values()) session.close();
  }
}
