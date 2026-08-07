// CDP Probe Screenshot — Capture all 6 Agent windows via CDP
// Fallback: Windows GDI for non-CDP agents (TRAE)
// Usage: node scripts/cdp-probe-screenshot.mjs

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'assets', 'probe-shots');

// Agent endpoints (browser-level CDP ports verified via /json/version)
const AGENTS = [
  { id: 'workbuddy',  port: 52743, name: 'WorkBuddy',    wsPath: '/devtools/browser/39562fe2-8212-4135-9d26-d1cfe7c17a5c' },
  { id: 'doubao',     port: 61607, name: 'Doubao',       wsPath: '/devtools/browser/f4dc9f9a-12d7-4be5-81b1-62cd09a9a511' },
  { id: 'qoderwork',  port: 61996, name: 'QoderWork CN', wsPath: '/devtools/browser/df2c19c6-638a-43b9-b4dd-02e801ea9ca7' },
  { id: 'zcode',      port: 65142, name: 'ZCode',        wsPath: '/devtools/browser/33592e93-be76-41a2-bf64-665139cafe58' },
  { id: 'codex',      port: 58360, name: 'Codex',         wsPath: '/devtools/browser/d5a2c72f-e3ef-4d98-a499-54e8997dbad3' },
];

// TRAE: no standard CDP — use Windows GDI fallback
const TRAE = { id: 'trae', name: 'TRAE SOLO CN', windowTitle: 'TRAE SOLO CN' };

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// CDP Client
// ---------------------------------------------------------------------------

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error('WS error')), { once: true });
    });
  }

  #onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) for (const h of handlers) h(msg.params);
    }
  }

  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }

  close() { if (this.ws) this.ws.close(); }
}

// ---------------------------------------------------------------------------
// Probe one Agent via CDP
// ---------------------------------------------------------------------------

async function probeAgent(agent) {
  const result = { id: agent.id, name: agent.name, ok: false, error: null, screenshot: null, target: null };

  try {
    // Connect to browser-level CDP
    const browser = new CdpClient(`ws://127.0.0.1:${agent.port}${agent.wsPath}`);
    await browser.connect();

    // Get page targets list
    // We use the /json HTTP endpoint via fetch
    const targetsResp = await fetch(`http://127.0.0.1:${agent.port}/json`);
    const targets = await targetsResp.json();

    // Find the best page target
    const pageTargets = targets.filter(t =>
      t.type === 'page' &&
      !/^(devtools|chrome-extension|about):/i.test(t.url || '') &&
      !/DevTools/i.test(t.title || '')
    );
    let target = pageTargets[0] || targets.find(t => t.type === 'page');
    if (!target) throw new Error('No page target');

    result.target = { title: target.title?.slice(0, 80), url: target.url?.slice(0, 80) };
    browser.close();

    // Connect directly to the target's websocket
    if (!target.webSocketDebuggerUrl) throw new Error('Target has no WS URL');
    const page = new CdpClient(target.webSocketDebuggerUrl);
    await page.connect();

    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise(r => setTimeout(r, 400));

    const screenshot = await page.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    page.close();

    if (screenshot?.data) {
      const filePath = join(OUTPUT_DIR, `${agent.id}.png`);
      writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
      result.screenshot = filePath;
      result.ok = true;
    } else {
      throw new Error('No screenshot data');
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

// ---------------------------------------------------------------------------
// TRAE fallback — use PowerShell WinForms screen capture
// ---------------------------------------------------------------------------

async function captureTraeWindows() {
  const result = { id: 'trae', name: 'TRAE SOLO CN', ok: false, error: null, screenshot: null };

  try {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class User32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr FindWindowByTitle(string title) {
    foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName("TRAE SOLO CN")) {
      if (p.MainWindowTitle.Contains(title) || title == "") return p.MainWindowHandle;
    }
    return IntPtr.Zero;
  }
}
"@
$hwnd = [User32]::FindWindowByTitle("")
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NOWINDOW"; exit 0 }
$rect = New-Object User32+RECT
[User32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -lt 100 -or $h -lt 100) { Write-Output "TOOSMALL ${w}x${h}"; exit 0 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$outfile = "${OUTPUT_DIR}\\trae.png"
$bmp.Save($outfile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "OK ${w}x${h}"
`;

    const psPath = join(OUTPUT_DIR, '_capture_trae.ps1');
    writeFileSync(psPath, psScript);
    const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
      timeout: 10000,
      encoding: 'utf8',
    });
    import('node:fs').then(fs => fs.unlinkSync(psPath));

    if (output.includes('OK')) {
      const filePath = join(OUTPUT_DIR, 'trae.png');
      result.screenshot = filePath;
      result.ok = true;
    } else {
      result.error = `WinAPI: ${output.trim()}`;
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('=== Agent CDP Probe & Screenshot ===\n');

const cdpResults = await Promise.allSettled(AGENTS.map(a =>
  probeAgent(a).then(r => {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(14)} port=${a.port} ${r.ok ? '→ ' + r.id + '.png' : '→ ' + r.error}`);
    return r;
  })
));

console.log('\n--- TRAE SOLO CN (WinAPI fallback) ---');
const traeResult = await captureTraeWindows();
console.log(`${traeResult.ok ? '✅' : '❌'} TRAE SOLO CN ${traeResult.ok ? '→ trae.png' : '→ ' + traeResult.error}\n`);

const succeeded = [...cdpResults.filter(r => r.status === 'fulfilled' && r.value.ok), ...(traeResult.ok ? [{ value: traeResult }] : [])];
console.log(`=== Done: ${succeeded.length}/6 windows captured ===`);
console.log(`Output: ${OUTPUT_DIR}/`);
