// SPDX-License-Identifier: MPL-2.0
// Type declarations for package.mjs (JS-only engine layer).
// This .d.ts sits alongside .mjs so TypeScript's bundler resolution picks it up.

export const THEME_FORMAT: string;
export const THEME_EXTENSION: string;
export const THEME_SCHEMA_VERSION: number;
export const MAX_THEME_PACKAGE_BYTES: number;
export const MAX_THEME_IMAGES: number;
export const MAX_THEME_IMAGE_BASE64: number;
export const SAFE_IMAGE_TYPES: ReadonlySet<string>;
export function assertString(value: unknown, label: string): void;
export function mimeTypeFor(filename: string): string;
export function validateId(id: string): void;
export function validateImageBuffer(mimeType: string, buffer: Buffer | Uint8Array): void;
export function detectLegacyCodexTheme(pkg: unknown): boolean;
export function readThemePackage(buffer: Uint8Array, opts?: { fileSize?: number }): Promise<Record<string, unknown>>;
export function buildThemePackage(manifest: Record<string, unknown>, images: Array<Map<string, unknown>>): Promise<Buffer>;
