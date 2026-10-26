// SPDX-License-Identifier: MPL-2.0
// AgentSkin Doctor — One-click environment diagnostics for AgentSkin
//
// Scans the six supported AI apps, checks installation paths, CDP port
// availability, and running process state. Produces a formatted terminal
// report with actionable fix suggestions.
//
// Usage:
//   node scripts/doctor.mjs              # full diagnostic
//   node scripts/doctor.mjs --json       # JSON output
//   node scripts/doctor.mjs --app workbuddy  # single-app diagnostic
//
// Ports sourced from competitor analysis (cdredfox/workbuddy-skin-studio):

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';

/** App definitions: id, display name, CDP port, install paths per platform. */
const APPS = [
  {
    id: 'traework',
    name: 'TRAE Work',
    cdpPort: 9341,
    procNames: ['TRAE SOLO CN.exe', 'TRAE.exe', 'traework'],
    paths: {
      win32: [
        `%LOCALAPPDATA%\\Programs\\TRAE SOLO CN\\TRAE SOLO CN.exe`,
        `%LOCALAPPDATA%\\Programs\\TRAE\\TRAE.exe`,
        `%PROGRAMFILES%\\TRAE SOLO CN\\TRAE SOLO CN.exe`,
      ],
      darwin: [
        '/Applications/TRAE.app/Contents/MacOS/TRAE',
        '/Applications/TRAE SOLO CN.app/Contents/MacOS/TRAE SOLO CN',
      ],
      linux: ['/opt/traework/traework', '/usr/bin/traework'],
    },
    downloadUrl: 'https://trae.ai.cn/',
  },
  {
    id: 'qoderwork',
    name: 'QoderWork',
    cdpPort: 9342,
    procNames: ['QoderWork CN.exe', 'QoderWork.exe', 'qoderwork'],
    paths: {
      win32: [
        `%LOCALAPPDATA%\\Programs\\QoderWork CN\\QoderWork CN.exe`,
        `%LOCALAPPDATA%\\Programs\\QoderWork\\QoderWork.exe`,
      ],
      darwin: ['/Applications/QoderWork.app/Contents/MacOS/QoderWork'],
      linux: ['/opt/qoderwork/qoderwork', '/usr/bin/qoderwork'],
    },
    downloadUrl: 'https://qoder.com/',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    cdpPort: 9339,
    procNames: ['WorkBuddy.exe', 'workbuddy'],
    paths: {
      win32: [
        `%LOCALAPPDATA%\\workbuddy\\WorkBuddy.exe`,
        `%PROGRAMFILES%\\WorkBuddy\\WorkBuddy.exe`,
      ],
      darwin: ['/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy'],
      linux: ['/opt/workbuddy/workbuddy', '/usr/bin/workbuddy'],
    },
    downloadUrl: 'https://workbuddy.codefuture.cn/',
  },
  {
    id: 'doubao',
    name: '豆包 Desktop',
    cdpPort: 9349,
    procNames: ['Doubao.exe', 'doubao'],
    paths: {
      win32: [
        `%LOCALAPPDATA%\\Doubao\\Application\\app\\Doubao.exe`,
        `%PROGRAMFILES%\\Doubao\\Doubao.exe`,
      ],
      darwin: [
        '/Applications/豆包.app/Contents/MacOS/豆包',
        '/Applications/Doubao.app/Contents/MacOS/Doubao',
      ],
      linux: ['/opt/doubao/doubao', '/usr/bin/doubao'],
    },
    downloadUrl: 'https://www.doubao.com/',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    cdpPort: 9340,
    procNames: ['ChatGPT.exe', 'Codex.exe', 'codex'],
    paths: {
      win32: [
        `%LOCALAPPDATA%\\Programs\\Codex\\ChatGPT.exe`,
        `%LOCALAPPDATA%\\Programs\\OpenAI Codex\\ChatGPT.exe`,
        `%PROGRAMFILES%\\Codex\\ChatGPT.exe`,
      ],
      darwin: ['/Applications/Codex.app/Contents/MacOS/Codex'],
      linux: ['/opt/codex/codex', '/usr/bin/codex'],
    },
    downloadUrl: 'https://openai.com/codex/',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    cdpPort: 9344,
    procNames: ['ZCode.exe', 'zcode'],
    paths: {
      win32: [`%LOCALAPPDATA%\\Programs\\ZCode\\ZCode.exe`, `%PROGRAMFILES%\\ZCode\\ZCode.exe`],
      darwin: ['/Applications/ZCode.app/Contents/MacOS/ZCode'],
      linux: ['/opt/zcode/zcode', '/usr/bin/zcode'],
    },
    downloadUrl: 'https://www.coze.cn/',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandPath(filepath) {
  if (process.platform !== 'win32') return filepath;
  return filepath
    .replace(/%LOCALAPPDATA%/g, process.env.LOCALAPPDATA || '')
    .replace(/%PROGRAMFILES%/g, process.env.ProgramFiles || '')
    .replace(/%PROGRAMFILES\(X86\)%/g, process.env['ProgramFiles(x86)'] || '');
}

function checkInstalled(app) {
  const paths = app.paths[process.platform] || [];
  for (const p of paths) {
    const expanded = expandPath(p);
    if (existsSync(expanded)) {
      return { installed: true, path: expanded };
    }
  }
  return { installed: false, path: null };
}

function checkTcpPort(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function checkProcessRunning(procNames) {
  if (process.platform === 'win32') {
    try {
      const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 5000 });
      const running = output
        .split('\n')
        .map((line) => line.replace(/^"(.+?)".*/, '$1').toLowerCase());
      for (const name of procNames) {
        if (running.includes(name.toLowerCase())) return { running: true, process: name };
      }
      return { running: false, process: null };
    } catch {
      return { running: false, process: null, error: true };
    }
  }
  try {
    const output = execSync('ps -eo comm', { encoding: 'utf8', timeout: 5000 });
    const running = output.split('\n').map((line) => line.trim());
    for (const name of procNames) {
      const baseName = name.replace(/\.exe$/i, '');
      if (running.includes(baseName)) return { running: true, process: name };
    }
    return { running: false, process: null };
  } catch {
    return { running: false, process: null, error: true };
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

async function runDiagnostics(appFilter = null) {
  const appsToScan = appFilter ? APPS.filter((a) => a.id === appFilter) : APPS;
  if (appFilter && appsToScan.length === 0) {
    console.error(`Unknown app id "${appFilter}". Supported: ${APPS.map((a) => a.id).join(', ')}`);
    process.exit(1);
  }

  const results = {
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname(),
      node: process.version,
    },
    apps: [],
    suggestions: [],
  };

  for (const app of appsToScan) {
    const install = checkInstalled(app);
    const portOpen = await checkTcpPort(app.cdpPort);
    const proc = checkProcessRunning(app.procNames);

    results.apps.push({
      id: app.id,
      name: app.name,
      cdpPort: app.cdpPort,
      installed: install.installed,
      installPath: install.path,
      portOpen,
      processRunning: proc.running,
      processName: proc.process,
    });

    // Build suggestions
    if (!install.installed) {
      results.suggestions.push({
        type: 'not_installed',
        severity: 'warn',
        message: `${app.name} is not installed`,
        action: `Download from ${app.downloadUrl}`,
      });
    } else if (!portOpen) {
      results.suggestions.push({
        type: 'port_closed',
        severity: 'info',
        message: `${app.name} (port ${app.cdpPort}) is not accessible`,
        action: `Start ${app.name} with --remote-debugging-port=${app.cdpPort}`,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatTextReport(results) {
  const lines = [];
  const sep = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

  lines.push(`🔍 AgentSkin Doctor v${VERSION}`);
  lines.push(sep);
  lines.push(
    `📋 System: ${results.system.platform} ${results.system.release} (${results.system.arch})`,
  );
  lines.push(`⬢ Node: ${results.system.node}`);
  lines.push(`🖥️ Hostname: ${results.system.hostname}`);
  lines.push('');

  lines.push('📦 App Detection:');
  for (const app of results.apps) {
    const icon = app.installed ? '✅' : '❌';
    const path = app.installed ? ` — installed at ${app.installPath}` : ' — not found';
    lines.push(`  ${icon} ${app.name}${path}`);
  }
  lines.push('');

  lines.push('🔌 CDP Port Status:');
  for (const app of results.apps) {
    const icon = app.portOpen ? '✅' : '❌';
    const status = app.portOpen ? 'open' : 'closed';
    const running = app.processRunning ? ` (app running: ${app.processName})` : '';
    lines.push(`  ${icon} ${app.name}:${app.cdpPort} — ${status}${running}`);
  }
  lines.push('');

  lines.push('⚙️ Process Status:');
  for (const app of results.apps) {
    const icon = app.processRunning ? '🟢' : '⚫';
    const status = app.processRunning ? `running (${app.processName})` : 'not running';
    lines.push(`  ${icon} ${app.name}: ${status}`);
  }
  lines.push('');

  // Summary
  const installed = results.apps.filter((a) => a.installed).length;
  const portsOpen = results.apps.filter((a) => a.portOpen).length;
  lines.push(
    `📊 Summary: ${installed}/${results.apps.length} installed, ${portsOpen}/${results.apps.length} ports accessible`,
  );
  lines.push('');

  // Suggestions
  if (results.suggestions.length > 0) {
    lines.push('💡 Suggestions:');
    for (const s of results.suggestions) {
      const icon = s.severity === 'warn' ? '⚠️' : 'ℹ️';
      lines.push(`  ${icon} ${s.message} → ${s.action}`);
    }
  } else {
    lines.push('💡 All clear! No issues detected.');
  }

  return lines.join('\n');
}

function formatJsonReport(results) {
  return JSON.stringify(results, null, 2);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { json: false, app: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--app' && argv[i + 1]) {
      args.app = argv[i + 1];
      i++;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Usage: node scripts/doctor.mjs [options]`);
      console.log('');
      console.log('Options:');
      console.log('  --json         Output JSON format');
      console.log('  --app <appId>  Diagnose a single app');
      console.log('  --help, -h     Show this help');
      console.log('');
      console.log(`Supported apps: ${APPS.map((a) => a.id).join(', ')}`);
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const results = await runDiagnostics(args.app);

  if (args.json) {
    console.log(formatJsonReport(results));
  } else {
    console.log(formatTextReport(results));
  }

  // Exit code: 1 if any app has issues
  const hasIssues =
    results.apps.some((a) => !a.installed || !a.portOpen) ||
    results.suggestions.some((s) => s.severity === 'warn');
  process.exit(hasIssues ? 1 : 0);
}

main().catch((err) => {
  console.error('Doctor error:', err.message);
  process.exit(2);
});
