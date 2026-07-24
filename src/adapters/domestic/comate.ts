// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter } from '../base';

/**
 * 百度 Comate — experimental adapter. Registered but not yet backed by
 * @agentskin/core.
 */
export class ComateAdapter extends BaseApplicationAdapter {
  readonly id = 'comate';
  readonly name = '百度 Comate';
  readonly type = 'ide' as const;
  readonly tier = 'experimental' as const;
  readonly coreId = '';
}
