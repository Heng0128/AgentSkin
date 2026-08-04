// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter } from '../base';

/**
 * 豆包 MarsCode — experimental adapter. Registered but not yet backed by
 * @agentskin/engine.
 */
export class MarscodeAdapter extends BaseApplicationAdapter {
  readonly id = 'marscode';
  readonly name = '豆包 MarsCode';
  readonly type = 'agent' as const;
  readonly tier = 'experimental' as const;
  readonly coreId = '';
}
