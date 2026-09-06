// SPDX-License-Identifier: MPL-2.0

/**
 * # Performance Trace Service
 *
 * Barrel export for the performance tracing module. Consumers import from
 * `services/performance` and reach {@link PerformanceRecorder} and the
 * trace/step types.
 */

export * from './performance-logger';
export * from './performance-recorder';
export * from './types';
