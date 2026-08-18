// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from './agent';
import { AGENT_SECURITY_PROFILES, type AgentSecurityProfile } from './agent-security';

describe('AGENT_SECURITY_PROFILES', () => {
  it('has security data for all 6 formal agents', () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_SECURITY_PROFILES[id]).toBeDefined();
    }
  });

  it('every profile has contextIsolation set to true', () => {
    for (const id of AGENT_IDS) {
      const profile: AgentSecurityProfile = AGENT_SECURITY_PROFILES[id];
      expect(profile.contextIsolation).toBe(true);
    }
  });

  it('every profile has nodeIntegration set to false', () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_SECURITY_PROFILES[id].nodeIntegration).toBe(false);
    }
  });

  it('every profile has contextBridge set to true', () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_SECURITY_PROFILES[id].contextBridge).toBe(true);
    }
  });

  it('sandbox values are boolean', () => {
    for (const id of AGENT_IDS) {
      const sandbox = AGENT_SECURITY_PROFILES[id].sandbox;
      expect(typeof sandbox).toBe('boolean');
    }
  });

  it('webSecurity values are one of the allowed literals', () => {
    const allowed: ReadonlySet<string> = new Set(['strict', 'standard', 'disabled']);
    for (const id of AGENT_IDS) {
      expect(allowed.has(AGENT_SECURITY_PROFILES[id].webSecurity)).toBe(true);
    }
  });

  it('cspLevel values are one of the allowed literals', () => {
    const allowed: ReadonlySet<string> = new Set(['strict', 'moderate', 'none']);
    for (const id of AGENT_IDS) {
      expect(allowed.has(AGENT_SECURITY_PROFILES[id].cspLevel)).toBe(true);
    }
  });

  it('agentId field matches the record key', () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_SECURITY_PROFILES[id].agentId).toBe(id);
    }
  });
});
