// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter } from '../base';

/**
 * 通义灵码 — experimental adapter. Registered but not yet backed by
 * @agentskin/engine.
 */
export class TongyiLingmaAdapter extends BaseApplicationAdapter {
  readonly id = 'tongyi_lingma';
  readonly name = '通义灵码';
  readonly type = 'ide' as const;
  readonly tier = 'experimental' as const;
  readonly coreId = '';
}
