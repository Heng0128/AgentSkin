// SPDX-License-Identifier: MPL-2.0

/**
 * # Compiler Module
 *
 * Entry point for the AgentSkin theme compiler. Re-exports sandbox
 * execution and dependency audit utilities.
 *
 * @module compiler
 */

export { checkDependencyAudit } from './dependency-audit.mjs';
export type { SandboxErrorCode, SandboxOptions, SandboxResult } from './sandbox';
export { runInSandbox } from './sandbox';
