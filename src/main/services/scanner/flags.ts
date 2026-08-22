// SPDX-License-Identifier: MPL-2.0

export type ScannerPipeline = 'v1' | 'v2';

export function scannerPipeline(): ScannerPipeline {
  return process.env.AGENTSKIN_SCANNER === 'v2' ? 'v2' : 'v1';
}
