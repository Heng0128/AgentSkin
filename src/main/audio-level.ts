// SPDX-License-Identifier: MPL-2.0

/**
 * # audio-level — System output audio level (Sucrose/Wallpaper-Engine style)
 *
 * Reads the peak level of the system's DEFAULT output device so scene
 * wallpapers can pulse/breath with music. Agent pages are sandboxes with no
 * audio source of their own, so the level is sampled in the MAIN process and
 * broadcast to agents via CDP (`window.AGENTSKIN_WP_AUDIO(level)`) — which the
 * scene renderer's message bridge forwards into the wallpaper iframe.
 *
 * ## Implementation
 *
 * A single long-lived PowerShell process embeds a small C# type via
 * `Add-Type` that calls the Windows CoreAudio COM interface
 * `IAudioMeterInformation.GetPeakValue` on the default render device — the
 * same interface Sucrose's NAudio wrapper uses, minus the external library.
 * The PowerShell loop prints `L:<level>` lines every `intervalMs`; Node parses
 * stdout as it streams, so there is no per-poll process spawn cost.
 *
 *   - No NAudio dependency: `IAudioMeterInformation` is part of Windows
 *     CoreAudio (COM, win32) and works on any Win10+.
 *   - Best-effort: if PowerShell/CoreAudio is unavailable (headless, non-Win32,
 *     stripped sandbox) the poller silently yields 0 and callers degrade —
 *     wallpapers simply don't pulse.
 *   - The level is 0..1 (peak, unsmoothed); smoothing happens in the scene
 *     renderer's envelope.
 */

import { spawn } from 'node:child_process';

const DEFAULT_INTERVAL_MS = 200;

let proc: ReturnType<typeof spawn> | null = null;
let timer: NodeJS.Timeout | null = null;
let currentLevel = 0;
let buf = '';
const listeners = new Set<(level: number) => void>();

/**
 * Parse a single PowerShell stdout line into a level, or null when the line
 * isn't a level report. Exported for unit testing.
 */
export function parseAudioLevelLine(line: string): number | null {
  const m = /^L:([0-9]*\.?[0-9]+)$/.exec(line.trim());
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

/**
 * Start polling the system output level. Idempotent. `onLevel` (if provided)
 * is invoked immediately with the current level and on every update.
 * Returns an unsubscribe function.
 */
export function startAudioLevelPolling(
  onLevel?: (level: number) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  if (onLevel) {
    listeners.add(onLevel);
    onLevel(currentLevel);
  }
  if (timer) return () => listeners.delete(onLevel!);
  if (process.platform !== 'win32') return () => listeners.delete(onLevel!);

  // Launch the long-lived sampler. ${process.pid} = AgentSkin main process
  // pid — injected so the script can detect parent exit (orphan fallback).
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr device);
  int GetDevice(string id, out IntPtr device);
  int RegisterEndpointNotificationCallback(IntPtr client);
  int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
  int OpenPropertyStore(int access, out IntPtr store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
  int GetPeakValue(out float peak);
  int GetMeteringChannelCount(out int channels);
  int GetChannelsPeakValues(int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] peak);
  int QueryHardwareSupport(out int support);
}

public static class AudioMeter {
  static readonly Guid IID_IAudioMeterInformation = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
  public static float GetPeak() {
    try {
      object com = new MMDeviceEnumeratorCom();
      IntPtr dev;
      int hr = ((IMMDeviceEnumerator)com).GetDefaultAudioEndpoint(0, 0, out dev);
      if (hr != 0) return 0f;
      try {
        var device = (IMMDevice)Marshal.GetObjectForIUnknown(dev);
        IntPtr iface;
        hr = device.Activate(ref IID_IAudioMeterInformation, 23, IntPtr.Zero, out iface);
        if (hr != 0) return 0f;
        try {
          var meter = (IAudioMeterInformation)Marshal.GetObjectForIUnknown(iface);
          float peak;
          meter.GetPeakValue(out peak);
          return peak;
        } finally { Marshal.Release(iface); }
      } finally { Marshal.Release(dev); }
    } catch { return 0f; }
  }
}
"@
$i = 0
while ($true) {
  $lvl = [AudioMeter]::GetPeak()
  Write-Output ("L:{0:F3}" -f $lvl)
  # 父进程（AgentSkin 主进程）退出后自动终止 —— app 崩溃/被强杀时
  # stopAudioLevelPolling 不会执行，没有这个兜底 PowerShell 采样进程会
  # 变成孤儿永久运行。每 5 次采样（约 1s）查一次，.NET 查进程几乎零开销。
  if (($i++ % 5) -eq 0) {
    try { [System.Diagnostics.Process]::GetProcessById(${process.pid}) | Out-Null } catch { exit }
  }
  Start-Sleep -Milliseconds ${intervalMs}
}
`;

  try {
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const level = parseAudioLevelLine(line);
        if (level !== null) {
          currentLevel = level;
          for (const cb of listeners) cb(level);
        }
        nl = buf.indexOf('\n');
      }
    });
    proc.on('error', () => {
      proc = null;
      timer = null;
    });
    proc.on('exit', () => {
      proc = null;
      timer = null;
    });
  } catch {
    proc = null;
  }

  // Safety net: if the sampler process dies silently, stop polling.
  timer = setInterval(() => {
    if (!proc) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  }, 5000);

  return () => {
    listeners.delete(onLevel!);
  };
}

/** Stop polling and kill the sampler process. */
export function stopAudioLevelPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (proc) {
    try {
      // Remove the stdout data listener to avoid leaking the closure (which
      // captures `buf`, `listeners`, `currentLevel`) after stop. Without
      // this, a restarted poller would inherit stale state from the orphaned
      // listener's captured scope.
      proc.stdout?.removeAllListeners('data');
      proc.kill();
    } catch {
      // already gone
    }
    proc = null;
  }
  listeners.clear();
  buf = '';
}

/** Current smoothed-free peak level (0..1). */
export function getAudioLevel(): number {
  return currentLevel;
}

/** Subscribe to level updates. Returns unsubscribe. */
export function onAudioLevel(cb: (level: number) => void): () => void {
  listeners.add(cb);
  cb(currentLevel);
  return () => listeners.delete(cb);
}
