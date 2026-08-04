// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter } from '../base';

/**
 * CodeBuddy — experimental adapter. Registered for discovery but NOT yet
 * wired to @agentskin/engine. Calling apply/restore/detect throws
 * AGENTSKIN_EXPERIMENTAL_ADAPTER so callers get an honest error.
 */
export class CodebuddyAdapter extends BaseApplicationAdapter {
  readonly id = 'codebuddy';
  readonly name = 'CodeBuddy';
  readonly type = 'agent' as const;
  readonly tier = 'experimental' as const;
  readonly coreId = '';
}
