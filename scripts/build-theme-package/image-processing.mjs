// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package — 2a multi-asset image packaging
 *
 * Normalizes `request.images` (image id → base64 data URL) into embeddable
 * image records `{ filename, mimeType, base64 }` or external-file records
 * `{ filename, mimeType, filePath }`, enforcing the SAME gates as the B-line
 * engine validator (RFC themes-asset-injection-2a §2.3).
 */

import { MAX_THEME_IMAGE_BASE64, SAFE_IMAGE_TYPES } from '../../src/engine/src/theme/package.mjs';
import {
  DATA_URL,
  EXT_BY_MIME,
  IMAGE_ID,
  MAX_THEME_CREATIVE_IMAGES,
  RESERVED_IMAGE_IDS,
} from './constants.mjs';

/**
 * Process and validate theme images.
 * Returns null when no images are declared (backward compatible).
 * @param request The Studio export request
 * @returns Normalized images object or null
 */
export function processThemeImages(request) {
  const raw = request?.images;
  if (!raw) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[build-theme-package] images must be an object keyed by image id.');
  }
  const entries = Object.entries(raw);
  if (!entries.length)
    throw new Error('[build-theme-package] images must not be empty when provided.');
  if (entries.length > MAX_THEME_CREATIVE_IMAGES) {
    throw new Error(
      `[build-theme-package] images exceeds ${MAX_THEME_CREATIVE_IMAGES} creative entries ` +
        `(max ${MAX_THEME_IMAGES} minus 3 reserved hero/icon/preview slots).`,
    );
  }
  const images = {};
  let totalBase64 = 0;
  for (const [id, value] of entries) {
    if (!IMAGE_ID.test(id)) throw new Error(`[build-theme-package] invalid image id '${id}'.`);
    if (RESERVED_IMAGE_IDS.has(id)) {
      throw new Error(
        `[build-theme-package] '${id}' is a reserved image id (icon/preview are system-managed).`,
      );
    }

    let mimeType;
    let base64 = null;
    let filePath = null;
    let providedFilename = null;

    if (typeof value === 'string') {
      // Data URL format: data:image/png;base64,...
      const match = DATA_URL.exec(value.trim());
      if (!match) {
        throw new Error(`[build-theme-package] images.${id} dataUrl is not a base64 data URL.`);
      }
      mimeType = match[1].toLowerCase();
      base64 = match[2].replace(/\s+/g, '');
    } else if (value && typeof value === 'object') {
      // Object format: { filename, mimeType, base64 } or { filename, mimeType, file }
      const obj = value;
      if (typeof obj.mimeType !== 'string') {
        throw new Error(`[build-theme-package] images.${id}.mimeType must be a string.`);
      }
      mimeType = obj.mimeType.toLowerCase();
      if (typeof obj.base64 === 'string') {
        base64 = obj.base64.replace(/\s+/g, '');
      } else if (typeof obj.file === 'string') {
        // External-file mode: copy from this path instead of embedding base64.
        filePath = obj.file;
      } else {
        throw new Error(
          `[build-theme-package] images.${id} must provide either base64 or file path.`,
        );
      }
      if (obj.filename != null) {
        if (typeof obj.filename !== 'string') {
          throw new Error(`[build-theme-package] images.${id}.filename must be a string.`);
        }
        providedFilename = obj.filename;
      }
    } else {
      throw new Error(
        `[build-theme-package] images.${id} must be a base64 data URL string or an image object.`,
      );
    }

    if (!SAFE_IMAGE_TYPES.has(mimeType)) {
      throw new Error(
        `[build-theme-package] images.${id} mimeType '${mimeType}' is not supported.`,
      );
    }
    if (base64 != null) {
      totalBase64 += base64.length;
    }
    images[id] = {
      filename: providedFilename || `${id}${EXT_BY_MIME[mimeType]}`,
      mimeType,
      ...(base64 != null ? { base64 } : {}),
      ...(filePath != null ? { filePath } : {}),
    };
  }
  if (totalBase64 > MAX_THEME_IMAGE_BASE64) {
    throw new Error(
      `[build-theme-package] images cumulative base64 exceeds ${MAX_THEME_IMAGE_BASE64} bytes.`,
    );
  }
  return images;
}
