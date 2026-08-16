// SPDX-License-Identifier: MPL-2.0

import { it } from 'vitest';
import { getAdapter, registerBuiltinAdapters } from '../../adapters/registry';
import { resolveLivePort } from '../../shared/cdp-discovery';
import { connectCdp } from './cdp-client';

registerBuiltinAdapters();
const noop = (): void => {};

it('dump codex DOM root structure', async () => {
  const adapter = getAdapter('codex')!;
  const port = await resolveLivePort(adapter, 'codex', noop);
  console.log('[probe] codex port =', port);
  if (!port) return;

  const targets = (await adapter.findTargets(port, 1200)) as { webSocketDebuggerUrl?: string; title?: string; url?: string }[];
  console.log('[probe] targets =', JSON.stringify(targets));

  for (const t of targets) {
    if (!t.webSocketDebuggerUrl) continue;
    const session = await connectCdp(t.webSocketDebuggerUrl, 5000, 8000);
    try {
      const expr = `
        (() => {
          const mainCandidates = Array.from(document.querySelectorAll('main')).map((n) => ({
            tag: 'main',
            cls: n.className?.toString?.().slice(0, 120),
            visible: n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0,
          }));
          const roleMain = Array.from(document.querySelectorAll('[role="main"]')).map((n) => ({
            tag: 'main[role]',
            cls: n.className?.toString?.().slice(0, 120),
            visible: n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0,
          }));
          const topLevel = Array.from(document.body?.children ?? []).slice(0, 20).map((n) => ({
            tag: n.tagName,
            cls: n.className?.toString?.().slice(0, 80),
            id: n.id,
          }));
          const g = globalThis;
          const versionProbe = {
            ua: navigator.userAgent,
            appVersion: g.appVersion ?? null,
            chrome: Boolean(g.chrome),
            hasProcess: Boolean(g.process),
            versionProps: Object.keys(g).filter((k) => /app|version|electron|codex/i.test(k)).slice(0, 30),
          };
          return JSON.stringify({ mainCandidates, roleMain, topLevel, bodyChildren: document.body?.children?.length ?? 0, versionProbe });
        })()
      `;
      const res = await session.evaluate(expr);
      console.log(`[probe] target ${t.title} (${t.url})`);
      console.log(JSON.stringify(res, null, 2));
    } finally {
      session.close();
    }
  }
}, 30000);