// SPDX-License-Identifier: MPL-2.0

// Repro: run the L2 worker pipeline directly against the failing workshop
// scene to surface the real Buffer.from(undefined) stack.

import { describe, expect, it } from 'vitest';
import { handleRenderRequest } from '../../scene-renderer-worker';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3204766006/scene.pkg';

describe.skipIf(!process.env.WE_REPRO)('repro 3204766006', () => {
  it('renders', async () => {
    const res = await handleRenderRequest({ requestId: 1, pkgPath: PKG, mode: 'full' });
    console.log('error:', res.error);
    console.log('html length:', res.html ? res.html.length : null);
    expect(true).toBe(true);
  });
});
