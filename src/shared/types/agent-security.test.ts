// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from './agent';
import { AGENT_SECURITY_PROFILES, type AgentSecurityProfile } from './agent-security';

describe('AGENT_SECURITY_PROFILES', () => {
  it.each(AGENT_IDS.map((id) => [id]))('has security data for %s', (id) => {
    expect(AGENT_SECURITY_PROFILES[id]).toBeDefined();
  });

  it.each(AGENT_IDS.map((id) => [id]))(
    'every profile for %s has contextIsolation set to true',
    (id) => {
      const profile: AgentSecurityProfile = AGENT_SECURITY_PROFILES[id];
      expect(profile.contextIsolation).toBe(true);
    },
  );

  it.each(AGENT_IDS.map((id) => [id]))(
    'every profile for %s has nodeIntegration set to false',
    (id) => {
      expect(AGENT_SECURITY_PROFILES[id].nodeIntegration).toBe(false);
    },
  );

  it.each(AGENT_IDS.map((id) => [id]))(
    'every profile for %s has contextBridge set to true',
    (id) => {
      expect(AGENT_SECURITY_PROFILES[id].contextBridge).toBe(true);
    },
  );

  it.each(AGENT_IDS.map((id) => [id]))('sandbox value for %s is boolean', (id) => {
    const sandbox = AGENT_SECURITY_PROFILES[id].sandbox;
    expect(typeof sandbox).toBe('boolean');
  });

  it.each(AGENT_IDS.map((id) => [id]))(
    'webSecurity value for %s is one of the allowed literals',
    (id) => {
      const allowed: ReadonlySet<string> = new Set(['strict', 'standard', 'disabled']);
      expect(allowed.has(AGENT_SECURITY_PROFILES[id].webSecurity)).toBe(true);
    },
  );

  it.each(AGENT_IDS.map((id) => [id]))(
    'cspLevel value for %s is one of the allowed literals',
    (id) => {
      const allowed: ReadonlySet<string> = new Set(['strict', 'moderate', 'none']);
      expect(allowed.has(AGENT_SECURITY_PROFILES[id].cspLevel)).toBe(true);
    },
  );

  it.each(AGENT_IDS.map((id) => [id]))('agentId field for %s matches the record key', (id) => {
    expect(AGENT_SECURITY_PROFILES[id].agentId).toBe(id);
  });
});
