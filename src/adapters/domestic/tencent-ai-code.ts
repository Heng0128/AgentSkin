// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter } from '../base';

/**
 * 腾讯云 AI Code — experimental adapter. Registered but not yet backed by
 * @agentskin/engine.
 */
export class TencentAiCodeAdapter extends BaseApplicationAdapter {
  readonly id = 'tencent_ai_code';
  readonly name = '腾讯云 AI Code';
  readonly type = 'ide' as const;
  readonly tier = 'experimental' as const;
  readonly coreId = '';
}
