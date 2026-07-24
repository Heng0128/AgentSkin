// SPDX-License-Identifier: MPL-2.0

import type { AgentSkinApi } from './shared/types';

declare global {
  interface Window {
    agentSkin: AgentSkinApi;
  }
}

export {};
