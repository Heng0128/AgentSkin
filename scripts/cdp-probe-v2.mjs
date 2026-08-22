// SPDX-License-Identifier: MPL-2.0
// CDP Probe Screenshot v2 — Use browser-level sessions for reliability

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'assets', 'probe-shots');

const AGENTS = [
  { id: 'workbuddy', port: 52743, name: 'WorkBuddy' },
  { id: 'doubao', port: 61607, name: 'Doubao' },
  { id: 'qoderwork', port: 61996, name: 'QoderWork CN' },
  { id: 'zcode', port: 65142, name: 'ZCode' },
  { id: 'codex', port: 58360, name: 'Codex' },
];
const _TRAE = { id: 'trae', name: 'TRAE SOLO CN' };

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout:${method}`));
        }
      }, 15000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function probeViaCDP(agent) {
  const r = { id: agent.id, ok: false, error: null, file: null };
  try {
    // Get browser WS endpoint
    const vResp = await fetch(`http://127.0.0.1:${agent.port}/json/version`);
    const ver = await vResp.json();
    const browserWs = ver.webSocketDebuggerUrl;
    if (!browserWs) throw new Error('No browser WS');

    // Connect to browser
    const browser = await CDP.connect(browserWs);

    // Get targets
    const tResp = await fetch(`http://127.0.0.1:${agent.port}/json`);
    const targets = await tResp.json();
    const pages = targets.filter(
      (t) =>
        t.type === 'page' &&
        !/^(devtools|chrome|about:)$/i.test(t.url || '') &&
        t.webSocketDebuggerUrl,
    );

    if (!pages.length) throw new Error('No pages');

    // Use the first valid page
    const page = pages[0];

    // Attach to target via browser-level (creating a session)
    const { sessionId: _sessionId } = await browser.send('Target.attachToTarget', {
      targetId: page.id,
      flatten: true,
    });
    browser.close();

    // Connect to the page's own WS (simpler, more reliable)
    const pageClient = await CDP.connect(page.webSocketDebuggerUrl);

    // Enable domains
    await pageClient.send('Page.enable');
    await pageClient.send('Runtime.enable');

    // Navigate to force a fresh paint (optional — helps if page is idle)
    // Just capture current state
    await new Promise((res) => setTimeout(res, 200));

    const shot = await pageClient.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    pageClient.close();

    if (shot?.data) {
      const f = join(OUTPUT_DIR, `${agent.id}.png`);
      writeFileSync(f, Buffer.from(shot.data, 'base64'));
      r.file = f;
      r.ok = true;
      r.title = page.title?.slice(0, 60);
    } else {
      throw new Error('No data');
    }
  } catch (e) {
    r.error = e.message;
  }
  return r;
}

// Windows GDI for TRAE
async function captureTRAE() {
  const r = { id: 'trae', ok: false, error: null, file: null };
  try {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class WinCap {
  [DllImport("user32.dll")] static extern IntPtr GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public struct RECT { public int L, T, R, B; }
  public static string Capture(string title, string outFile) {
    foreach (var p in Process.GetProcesses()) {
      try { if (p.MainWindowTitle != "" && (title == "" || p.MainWindowTitle.Contains(title))) {
        var rc = new RECT(); GetWindowRect(p.MainWindowHandle, out rc);
        int w = rc.R - rc.L, h = rc.B - rc.T;
        if (w < 100 || h < 100) continue;
        var bmp = new System.Drawing.Bitmap(w, h);
        var g = System.Drawing.Graphics.FromImage(bmp);
        g.CopyFromScreen(rc.L, rc.T, 0, 0, bmp.Size);
        bmp.Save(outFile, System.Drawing.Imaging.ImageFormat.Png);
        g.Dispose(); bmp.Dispose();
        return "OK " + w + "x" + h;
      } catch {}
    } catch {}
    return "NO_WINDOW";
  }
}
"@
[WinCap]::Capture("TRAE SOLO CN", "${OUTPUT_DIR}\\traae.png") | Out-File "${OUTPUT_DIR}\\_result.txt" -Encoding utf8
`;
    const psFile = join(OUTPUT_DIR, '_trae.ps1');
    writeFileSync(psFile, ps);
    try {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
        timeout: 15000,
      });
    } finally {
      try {
        unlinkSync(psFile);
      } catch {
        /* ignore cleanup errors */
      }
    }

    const result = (
      existsSync(join(OUTPUT_DIR, '_result.txt'))
        ? readFileSync(join(OUTPUT_DIR, '_result.txt'), 'utf8')
        : ''
    ).trim();
    if (existsSync(join(OUTPUT_DIR, '_result.txt'))) unlinkSync(join(OUTPUT_DIR, '_result.txt'));

    if (result.startsWith('OK')) {
      // Rename to standard name
      const src = join(OUTPUT_DIR, 'traae.png');
      const dst = join(OUTPUT_DIR, 'trae.png');
      if (existsSync(src)) {
        writeFileSync(dst, readFileSync(src));
        unlinkSync(src);
      }
      r.file = dst;
      r.ok = true;
    } else {
      r.error = result;
    }
  } catch (e) {
    r.error = e.message;
  }
  return r;
}

// Main
console.log('=== Agent CDP Probe v2 ===\n');
const results = await Promise.allSettled([
  ...AGENTS.map((a) =>
    probeViaCDP(a).then((r) => {
      console.log(
        `${r.ok ? '✅' : '❌'} ${r.name || a.name} ${r.ok ? `→ ${r.file.split('\\').pop()}` : `→ ${r.error}`}`,
      );
      return r;
    }),
  ),
  captureTRAE().then((r) => {
    console.log(`${r.ok ? '✅' : '❌'} TRAE SOLO CN ${r.ok ? '→ trae.png' : `→ ${r.error}`}`);
    return r;
  }),
]);

const okCount = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
console.log(`\n=== Done: ${okCount}/6 captured ===`);
