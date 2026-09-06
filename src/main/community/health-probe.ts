// SPDX-License-Identifier: MPL-2.0

/**
 * # Source Health Probe
 *
 * 检测远程社区API是否可用。用于source注册时的初始健康检查，
 * 以及UI层定期轮询source状态时调用。
 *
 * 使用 Node.js 原生 https 模块（与 codedrobe-api 保持一致，
 * 避免 Electron net.fetch 被 codedrobe.app CDN 返回 400）。
 */

import * as https from 'node:https';
import type { CommunitySourceId, CommunitySourceProbeResult } from '../../shared/types/community';
import { API_BASE } from './community-theme-api';
import { CODE_DROBE_API_BASE, IS_API_AVAILABLE } from './codedrobe-api';

const PROBE_TIMEOUT_MS = 2000;

export interface ProbeResult {
  healthy: boolean;
  statusCode?: number;
  errorMessage?: string;
  responseTimeMs: number;
}

function getSourceApiBase(sourceId: CommunitySourceId): string | undefined {
  switch (sourceId) {
    case 'dreamskin':
      return API_BASE;
    case 'codedrobe':
      return IS_API_AVAILABLE ? CODE_DROBE_API_BASE : undefined;
    default:
      return undefined;
  }
}

export async function probeCommunitySource(
  sourceId: CommunitySourceId,
): Promise<CommunitySourceProbeResult> {
  const base = getSourceApiBase(sourceId);
  if (!base) {
    return {
      sourceId,
      activated: false,
      healthy: false,
      errorMessage: 'Source not activated yet',
      responseTimeMs: 0,
    };
  }
  const result = await probeUrlHealth(base);
  return { sourceId, activated: true, ...result };
}

/**
 * 使用 Node.js 原生 https 模块探测 URL 健康状态（HEAD 请求）。
 * 直接传入完整 URL 字符串，让 Node 处理所有细节。
 */
export async function probeUrlHealth(url: string): Promise<ProbeResult> {
  const start = Date.now();
  return new Promise<ProbeResult>((resolve) => {
    const req = https.get(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'AgentSkin/1.0 HealthProbe',
        },
      },
      (res) => {
        resolve({
          healthy: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
          statusCode: res.statusCode,
          responseTimeMs: Date.now() - start,
        });
      },
    );

    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      req.destroy();
      resolve({
        healthy: false,
        errorMessage: `Timeout after ${PROBE_TIMEOUT_MS}ms`,
        responseTimeMs: Date.now() - start,
      });
    });

    req.on('error', (err) => {
      resolve({
        healthy: false,
        errorMessage: err.message,
        responseTimeMs: Date.now() - start,
      });
    });

    req.end();
  });
}

export function inferSourceStatus(recentResults: ProbeResult[]): 'online' | 'degraded' | 'offline' {
  if (recentResults.length === 0) return 'offline';

  if (recentResults[recentResults.length - 1]?.healthy) return 'online';

  let consecutiveFailures = 0;
  for (let i = recentResults.length - 1; i >= 0; i--) {
    if (!recentResults[i].healthy) consecutiveFailures++;
    else break;
  }

  if (consecutiveFailures >= 5) return 'offline';
  if (consecutiveFailures >= 2) return 'degraded';
  return 'online';
}
