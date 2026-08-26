// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentsSection
 *
 * Per-agent install status + security posture section of the Studio drawer.
 */

import { useState } from 'react';
import { AppMark } from '@/components/AppMark';
import { appStatusFor } from '@/stores/agentStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META, AGENT_SECURITY_PROFILES, type AgentId } from '@shared/types';
import { Lock, Shield, ShieldCheck } from 'lucide-react';

export function AgentsSection({ t }: { t: UiMessages }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ws-drawer__section">
      <button
        type="button"
        className="ws-drawer__section-header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1">
          <span className="dot" />
          {t.agentsTitle}
        </span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-1 mt-1">
          {/* Security posture sub-header */}
          <span className="text-micro text-muted-foreground px-1">{t.studioSecurityLabel}</span>

          {AGENT_IDS.map((id) => {
            const meta = AGENT_META[id as AgentId];
            const status = appStatusFor(id);
            const sec = AGENT_SECURITY_PROFILES[id as AgentId];

            // Build tooltip: "Context Isolation: ON / Sandbox: ON / WebSecurity: strict"
            const tooltipParts: string[] = [];
            if (sec) {
              tooltipParts.push(
                `${t.studioSecurityContextIsolation}: ${sec.contextIsolation ? t.studioSecurityEnabled : t.studioSecurityDisabled}`,
              );
              tooltipParts.push(
                `${t.studioSecuritySandbox}: ${sec.sandbox ? t.studioSecurityEnabled : t.studioSecurityDisabled}`,
              );
              tooltipParts.push(
                `${t.studioSecurityWebSecurity}: ${
                  sec.webSecurity === 'strict'
                    ? t.studioSecurityStrict
                    : sec.webSecurity === 'standard'
                      ? t.studioSecurityStandard
                      : t.studioSecurityDisabled
                }`,
              );
            }

            return (
              <div key={id} className="flex items-center gap-1 p-1 rounded-md">
                <AppMark appId={id} size={14} />
                <span className="text-micro text-foreground truncate flex-1">
                  {meta.displayName}
                </span>

                {/* Security posture icons */}
                {sec && (
                  <span className="flex items-center gap-0.5" title={tooltipParts.join(' / ')}>
                    <Lock
                      className="size-[10px]"
                      style={{
                        color: sec.contextIsolation
                          ? 'var(--cr-success)'
                          : 'var(--muted-foreground)',
                      }}
                    />
                    <Shield
                      className="size-[10px]"
                      style={{
                        color: sec.sandbox ? 'var(--cr-success)' : 'var(--muted-foreground)',
                      }}
                    />
                    {sec.webSecurity === 'strict' ? (
                      <ShieldCheck className="size-[10px]" style={{ color: 'var(--cr-success)' }} />
                    ) : (
                      <ShieldCheck
                        className="size-[10px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    )}
                  </span>
                )}

                <span
                  className="size-[5px] rounded-md"
                  style={{
                    background: status?.installed ? 'var(--cr-success)' : 'var(--muted-foreground)',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
